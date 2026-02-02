/**
 * MGRS Grid Generation Web Worker
 * 
 * Generates grid lines and labels for a given tile at the appropriate resolution.
 * Runs in a separate thread to avoid blocking the main UI.
 */

import proj4 from 'proj4';
import type { TileRequest, TileResponse, GridLine, GridLabel, LatLonBounds, UTMZone, Generate100kmRequest, Generate100kmResponse, Generate10kmRequest, Generate10kmResponse } from '../types/mgrs';
import { generate100kmSquaresForGZD, getGZDHemisphere } from '../utils/generate100kmSquares';
import { generate10kmGridForSquare } from '../utils/generate10kmGrid';

// Re-implement projection functions here since workers have separate scope
const UTM_PROJ_CACHE: Map<number, string> = new Map();

function getUTMProjection(zone: number, hemisphere: 'N' | 'S'): string {
  const epsg = hemisphere === 'N' ? 32600 + zone : 32700 + zone;
  
  if (!UTM_PROJ_CACHE.has(epsg)) {
    const proj = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
    UTM_PROJ_CACHE.set(epsg, proj);
  }
  
  return UTM_PROJ_CACHE.get(epsg)!;
}

function tileToLatLonBounds(x: number, y: number, z: number): LatLonBounds {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const north = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  const south = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
  
  const west = (x / Math.pow(2, z)) * 360 - 180;
  const east = ((x + 1) / Math.pow(2, z)) * 360 - 180;
  
  return { west, south, east, north };
}

function utmToLatLon(easting: number, northing: number, zone: number, hemisphere: 'N' | 'S'): [number, number] {
  const utmProj = getUTMProjection(zone, hemisphere);
  const [lon, lat] = proj4(utmProj, 'WGS84', [easting, northing]);
  return [lon, lat];
}

function latLonToUTM(lon: number, lat: number, zone: number, hemisphere: 'N' | 'S'): [number, number] {
  const utmProj = getUTMProjection(zone, hemisphere);
  const [easting, northing] = proj4('WGS84', utmProj, [lon, lat]);
  return [easting, northing];
}

function getUTMZoneForLongitude(lon: number): number {
  let normalizedLon = lon;
  while (normalizedLon < -180) normalizedLon += 360;
  while (normalizedLon >= 180) normalizedLon -= 360;
  return Math.floor((normalizedLon + 180) / 6) + 1;
}

function getUTMZoneBounds(zone: number): { west: number; east: number } {
  const west = (zone - 1) * 6 - 180;
  const east = zone * 6 - 180;
  return { west, east };
}

function getUTMZonesForBounds(bounds: LatLonBounds): UTMZone[] {
  const zones: UTMZone[] = [];
  const westZone = getUTMZoneForLongitude(bounds.west);
  const eastZone = getUTMZoneForLongitude(bounds.east);
  const minZone = Math.min(westZone, eastZone);
  const maxZone = Math.max(westZone, eastZone);
  
  for (let zone = minZone; zone <= maxZone; zone++) {
    if (bounds.north > 0) {
      zones.push({ zone, hemisphere: 'N', epsg: 32600 + zone });
    }
    if (bounds.south < 0) {
      zones.push({ zone, hemisphere: 'S', epsg: 32700 + zone });
    }
  }
  return zones;
}

function getResolutionsForZoom(zoom: number): number[] {
  if (zoom < 8) return [];               // GZD + 100km handled by dedicated layer
  if (zoom < 13) return [10000];         // 10km
  if (zoom < 16) return [10000, 1000];   // 10km + 1km
  return [10000, 1000, 100];             // 10km + 1km + 100m
}

function getLevelForResolution(resolution: number): GridLine['level'] {
  switch (resolution) {
    case 100000: return '100km';
    case 10000: return '10km';
    case 1000: return '1km';
    case 100: return '100m';
    default: return '100km';
  }
}

// MGRS 100km square letter lookup
const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

function get100kmSquareId(easting: number, northing: number, zone: number): string {
  const setIndex = (zone - 1) % 3;
  const colIndex = Math.floor(easting / 100000) - 1;
  const col = COLUMN_SETS[setIndex][Math.abs(colIndex) % 8] || 'A';
  
  const rowIndex = Math.floor(northing / 100000) % 20;
  const rowOffset = zone % 2 === 0 ? 5 : 0;
  const row = ROW_LETTERS[(rowIndex + rowOffset) % 20];
  
  return col + row;
}

function getLatitudeBand(lat: number): string {
  // Latitude bands: C-X (omit I and O), each 8° except X which is 12°
  const bands = 'CDEFGHJKLMNPQRSTUVWX';
  if (lat < -80) return 'A'; // Antarctic
  if (lat >= 84) return 'Z'; // Arctic
  const index = Math.floor((lat + 80) / 8);
  return bands[Math.min(index, bands.length - 1)];
}

/**
 * Generate grid lines for a tile at the specified resolution
 */
function generateGridLinesForTile(
  bounds: LatLonBounds,
  zone: number,
  hemisphere: 'N' | 'S',
  resolution: number
): { lines: GridLine[]; labels: GridLabel[] } {
  const lines: GridLine[] = [];
  const labels: GridLabel[] = [];
  const level = getLevelForResolution(resolution);
  
  // Get zone boundaries for clipping
  const zoneBounds = getUTMZoneBounds(zone);
  const clippedBounds: LatLonBounds = {
    west: Math.max(bounds.west, zoneBounds.west),
    east: Math.min(bounds.east, zoneBounds.east),
    south: Math.max(bounds.south, hemisphere === 'N' ? 0 : -80),
    north: Math.min(bounds.north, hemisphere === 'N' ? 84 : 0)
  };
  
  // Skip if clipped bounds are invalid
  if (clippedBounds.west >= clippedBounds.east || clippedBounds.south >= clippedBounds.north) {
    return { lines, labels };
  }
  
  try {
    // Convert bounds corners to UTM
    const [swE, swN] = latLonToUTM(clippedBounds.west, clippedBounds.south, zone, hemisphere);
    const [neE, neN] = latLonToUTM(clippedBounds.east, clippedBounds.north, zone, hemisphere);
    
    // Round to resolution grid
    const minE = Math.floor(Math.min(swE, neE) / resolution) * resolution;
    const maxE = Math.ceil(Math.max(swE, neE) / resolution) * resolution;
    const minN = Math.floor(Math.min(swN, neN) / resolution) * resolution;
    const maxN = Math.ceil(Math.max(swN, neN) / resolution) * resolution;
    
    // Generate vertical lines (constant easting)
    for (let e = minE; e <= maxE; e += resolution) {
      // Sample points along the line to create a curved line in Web Mercator
      const points: [number, number][] = [];
      const numSegments = 10;
      const nStep = (maxN - minN) / numSegments;
      
      for (let i = 0; i <= numSegments; i++) {
        const n = minN + i * nStep;
        const [lon, lat] = utmToLatLon(e, n, zone, hemisphere);

        // Clip to zone bounds (epsilon buffer for floating-point boundary precision)
        if (lon >= zoneBounds.west - 0.0001 && lon <= zoneBounds.east + 0.0001) {
          points.push([lon, lat]);
        }
      }
      
      // Create line segments from points
      for (let i = 0; i < points.length - 1; i++) {
        lines.push({
          start: points[i],
          end: points[i + 1],
          level
        });
      }
    }
    
    // Generate horizontal lines (constant northing)
    for (let n = minN; n <= maxN; n += resolution) {
      const points: [number, number][] = [];
      const numSegments = 10;
      const eStep = (maxE - minE) / numSegments;
      
      for (let i = 0; i <= numSegments; i++) {
        const e = minE + i * eStep;
        const [lon, lat] = utmToLatLon(e, n, zone, hemisphere);
        
        if (lon >= zoneBounds.west - 0.0001 && lon <= zoneBounds.east + 0.0001) {
          points.push([lon, lat]);
        }
      }

      for (let i = 0; i < points.length - 1; i++) {
        lines.push({
          start: points[i],
          end: points[i + 1],
          level
        });
      }
    }

    // Generate labels at grid intersections (bottom-left per NATO standard)
    for (let e = minE; e <= maxE; e += resolution) {
      for (let n = minN; n <= maxN; n += resolution) {
        const [lon, lat] = utmToLatLon(e, n, zone, hemisphere);
        
        if (lon >= clippedBounds.west && lon <= clippedBounds.east &&
            lat >= clippedBounds.south && lat <= clippedBounds.north) {
          
          let text: string;
          
          if (resolution === 100000) {
            // 100km: Show zone + band + square ID
            const band = getLatitudeBand(lat);
            const squareId = get100kmSquareId(e, n, zone);
            text = `${zone.toString().padStart(2, '0')}${band}${squareId}`;
          } else {
            // Smaller grids: Show truncated coordinates
            const eDigits = Math.floor(e / resolution) % 10;
            const nDigits = Math.floor(n / resolution) % 10;
            text = `${eDigits}${nDigits}`;
          }
          
          labels.push({
            position: [lon, lat],
            text,
            level
          });
        }
      }
    }
  } catch {
    // Projection errors can occur near zone boundaries
    console.warn(`Projection error for zone ${zone}${hemisphere}`);
  }
  
  return { lines, labels };
}

/**
 * Process a tile request and generate grid data
 */
function processTileRequest(request: TileRequest): TileResponse {
  const { x, y, z, zoom, requestId } = request;
  const resolutions = getResolutionsForZoom(zoom);

  // At low zoom, use static GZD layer
  if (resolutions.length === 0) {
    return { lines: [], labels: [], requestId };
  }

  const bounds = tileToLatLonBounds(x, y, z);
  const zones = getUTMZonesForBounds(bounds);

  const allLines: GridLine[] = [];
  const allLabels: GridLabel[] = [];

  for (const resolution of resolutions) {
    for (const { zone, hemisphere } of zones) {
      const { lines, labels } = generateGridLinesForTile(bounds, zone, hemisphere, resolution);
      allLines.push(...lines);
      allLabels.push(...labels);
    }
  }

  return {
    lines: allLines,
    labels: allLabels,
    requestId
  };
}

/**
 * Process a generate-100km request for a single GZD
 */
function processGenerate100km(request: Generate100kmRequest): Generate100kmResponse {
  const { gzd, zone, band, bounds } = request;
  const hemisphere = getGZDHemisphere(band);
  const features = generate100kmSquaresForGZD(zone, band, hemisphere, bounds);
  return { gzd, features };
}

// Worker message handler
self.onmessage = (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'request') {
    try {
      const response = processTileRequest(payload as TileRequest);
      self.postMessage({ type: 'response', payload: response, requestId: response.requestId });
    } catch (error) {
      self.postMessage({
        type: 'error',
        payload: error instanceof Error ? error.message : 'Unknown error',
        requestId: (payload as TileRequest)?.requestId
      });
    }
  } else if (type === 'generate-100km') {
    try {
      const response = processGenerate100km(payload as Generate100kmRequest);
      self.postMessage({ type: 'generate-100km-result', payload: response });
    } catch (error) {
      self.postMessage({
        type: 'error',
        payload: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } else if (type === 'generate-10km') {
    try {
      const req = payload as Generate10kmRequest;
      // DEBUG LOGGING for problematic squares
      if (req.squareId.startsWith('05QK') || req.squareId.startsWith('05QKB')) {
        console.log(`[Worker] Generating 10km grid for ${req.squareId}. Zone: ${req.zone}, Hemisphere: ${req.hemisphere}`);
      }

      const features = generate10kmGridForSquare(req.zone, req.hemisphere, req.bounds, req.squareId);
      
      if (req.squareId.startsWith('05QK')) {
        console.log(`[Worker] Generated ${features.length} features for ${req.squareId}`);
      }

      const response: Generate10kmResponse = { squareId: req.squareId, features };
      self.postMessage({ type: 'generate-10km-result', payload: response });
    } catch (error) {
      self.postMessage({
        type: 'generate-10km-error',
        payload: {
          squareId: (payload as Generate10kmRequest).squareId,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }
};
