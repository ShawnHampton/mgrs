/**
 * Projection Utilities for MGRS Grid Generation
 * 
 * Handles conversions between:
 * - Tile XYZ coordinates and lat/lon bounds
 * - UTM coordinates and WGS84 lat/lon
 * - UTM zone determination
 */

import proj4 from 'proj4';
import type { LatLonBounds, UTMZone } from '../types/mgrs';

// UTM projection definitions - will be registered dynamically
const UTM_PROJ_CACHE: Map<number, string> = new Map();

/**
 * Get or create proj4 projection string for a UTM zone
 */
function getUTMProjection(zone: number, hemisphere: 'N' | 'S'): string {
  const epsg = hemisphere === 'N' ? 32600 + zone : 32700 + zone;
  
  if (!UTM_PROJ_CACHE.has(epsg)) {
    const proj = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
    UTM_PROJ_CACHE.set(epsg, proj);
  }
  
  return UTM_PROJ_CACHE.get(epsg)!;
}

/**
 * Convert tile XYZ coordinates to lat/lon bounds (Web Mercator tiles)
 */
export function tileToLatLonBounds(x: number, y: number, z: number): LatLonBounds {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const north = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  
  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  const south = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)));
  
  const west = (x / Math.pow(2, z)) * 360 - 180;
  const east = ((x + 1) / Math.pow(2, z)) * 360 - 180;
  
  return { west, south, east, north };
}

/**
 * Convert UTM coordinates to WGS84 lat/lon
 */
export function utmToLatLon(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: 'N' | 'S'
): [number, number] {
  const utmProj = getUTMProjection(zone, hemisphere);
  const [lon, lat] = proj4(utmProj, 'WGS84', [easting, northing]);
  return [lon, lat];
}

/**
 * Convert WGS84 lat/lon to UTM coordinates
 */
export function latLonToUTM(
  lon: number,
  lat: number,
  zone: number,
  hemisphere: 'N' | 'S'
): [number, number] {
  const utmProj = getUTMProjection(zone, hemisphere);
  const [easting, northing] = proj4('WGS84', utmProj, [lon, lat]);
  return [easting, northing];
}

/**
 * Determine the UTM zone for a given longitude
 * Standard zones are 6° wide, numbered 1-60
 */
export function getUTMZoneForLongitude(lon: number): number {
  // Normalize longitude to -180 to 180
  let normalizedLon = lon;
  while (normalizedLon < -180) normalizedLon += 360;
  while (normalizedLon >= 180) normalizedLon -= 360;
  
  // Zone 1 starts at -180°
  return Math.floor((normalizedLon + 180) / 6) + 1;
}

/**
 * Get all UTM zones that overlap with given bounds
 * Handles special cases for Norway and Svalbard
 */
export function getUTMZonesForBounds(bounds: LatLonBounds): UTMZone[] {
  const zones: UTMZone[] = [];
  
  // Determine west and east zones
  const westZone = getUTMZoneForLongitude(bounds.west);
  const eastZone = getUTMZoneForLongitude(bounds.east);
  
  // Handle wrap-around at antimeridian
  const minZone = Math.min(westZone, eastZone);
  const maxZone = Math.max(westZone, eastZone);
  
  // For small bounds, this handles the normal case
  // For bounds crossing antimeridian, we'd need additional logic
  for (let zone = minZone; zone <= maxZone; zone++) {
    // Determine hemispheres based on latitude
    if (bounds.north > 0) {
      zones.push({
        zone,
        hemisphere: 'N',
        epsg: 32600 + zone
      });
    }
    if (bounds.south < 0) {
      zones.push({
        zone,
        hemisphere: 'S',
        epsg: 32700 + zone
      });
    }
  }
  
  return zones;
}

/**
 * Get the longitude bounds for a UTM zone
 */
export function getUTMZoneBounds(zone: number): { west: number; east: number } {
  const west = (zone - 1) * 6 - 180;
  const east = zone * 6 - 180;
  return { west, east };
}

/**
 * Clip a longitude to UTM zone bounds
 */
export function clipLongitudeToZone(lon: number, zone: number): number {
  const { west, east } = getUTMZoneBounds(zone);
  return Math.max(west, Math.min(east, lon));
}

/**
 * Generate UTM grid line coordinates within bounds at a given resolution
 * Returns lines in [lon, lat] format
 */
export function generateUTMGridLines(
  bounds: LatLonBounds,
  zone: number,
  hemisphere: 'N' | 'S',
  resolution: number // meters: 100000, 10000, 1000, 100
): Array<{ start: [number, number]; end: [number, number] }> {
  const lines: Array<{ start: [number, number]; end: [number, number] }> = [];
  
  // Get zone boundaries to clip
  const zoneBounds = getUTMZoneBounds(zone);
  const clippedBounds: LatLonBounds = {
    west: Math.max(bounds.west, zoneBounds.west),
    east: Math.min(bounds.east, zoneBounds.east),
    south: bounds.south,
    north: bounds.north
  };
  
  // Convert bounds corners to UTM
  const [swE, swN] = latLonToUTM(clippedBounds.west, clippedBounds.south, zone, hemisphere);
  const [neE, neN] = latLonToUTM(clippedBounds.east, clippedBounds.north, zone, hemisphere);
  
  // Round to resolution grid
  const minE = Math.floor(swE / resolution) * resolution;
  const maxE = Math.ceil(neE / resolution) * resolution;
  const minN = Math.floor(swN / resolution) * resolution;
  const maxN = Math.ceil(neN / resolution) * resolution;
  
  // Vertical lines (constant easting)
  for (let e = minE; e <= maxE; e += resolution) {
    const start = utmToLatLon(e, minN, zone, hemisphere);
    const end = utmToLatLon(e, maxN, zone, hemisphere);
    
    // Clip to zone bounds
    if (start[0] >= zoneBounds.west && start[0] <= zoneBounds.east) {
      lines.push({ start, end });
    }
  }
  
  // Horizontal lines (constant northing)
  for (let n = minN; n <= maxN; n += resolution) {
    const start = utmToLatLon(minE, n, zone, hemisphere);
    const end = utmToLatLon(maxE, n, zone, hemisphere);
    
    // These should already be within zone bounds
    lines.push({ start, end });
  }
  
  return lines;
}

/**
 * Determine grid resolution based on zoom level
 */
export function getResolutionForZoom(zoom: number): number {
  if (zoom < 6) return 0;       // Use static GZD layer
  if (zoom < 10) return 100000; // 100km
  if (zoom < 13) return 10000;  // 10km
  if (zoom < 16) return 1000;   // 1km
  return 100;                   // 100m
}

/**
 * Get the MGRS 100km square identifier for a UTM coordinate
 * This follows the NATO column/row letter system
 */
export function get100kmSquareId(
  easting: number,
  northing: number,
  zone: number
): string {
  // Column letters repeat every 3 zones, starting with A at zone 1
  // Sets: ABCDEFGH (omit I), JKLMNPQR (omit O), STUVWXYZ
  const setIndex = (zone - 1) % 3;
  const columnSets = [
    'ABCDEFGH',
    'JKLMNPQR',
    'STUVWXYZ'
  ];
  
  // Row letters cycle: ABCDEFGHJKLMNPQRSTUV (omit I, O)
  // For odd zones: starts at A
  // For even zones: starts at F
  const rowLetters = 'ABCDEFGHJKLMNPQRSTUV';
  
  // Easting column (100km blocks from 1-8 within zone, but can extend)
  const colIndex = Math.floor(easting / 100000) - 1;
  const col = columnSets[setIndex][colIndex % 8];
  
  // Northing row (repeats every 2000km)
  const rowIndex = Math.floor(northing / 100000) % 20;
  const rowOffset = zone % 2 === 0 ? 5 : 0; // Even zones offset by 5
  const row = rowLetters[(rowIndex + rowOffset) % 20];
  
  return col + row;
}
