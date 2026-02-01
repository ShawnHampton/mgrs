/**
 * Generate 100km MGRS squares for a given GZD (Grid Zone Designator).
 *
 * For each visible GZD, we:
 * 1. Project GZD polygon corners to UTM to find the grid range
 * 2. Build UTM rectangles for each 100km cell
 * 3. Project them to WGS84 with dense edge sampling (captures curvature)
 * 4. Clip to the GZD boundary using JSTS polygon intersection
 * 5. Label each square using mgrs.forward() for authoritative MGRS IDs
 */

import proj4 from 'proj4';
import { forward as mgrsForward } from 'mgrs';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import type { MGRSSquareFeature } from '../types/mgrs';

// JSTS v2 type declarations are incomplete — many runtime methods
// (isEmpty, getGeometryType, getExteriorRing, etc.) are missing from .d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JSTSGeometry = any;

const geometryFactory = new GeometryFactory();

// UTM projection string cache
const UTM_PROJ_CACHE: Map<number, string> = new Map();

function getUTMProjection(zone: number, hemisphere: 'N' | 'S'): string {
  const epsg = hemisphere === 'N' ? 32600 + zone : 32700 + zone;
  if (!UTM_PROJ_CACHE.has(epsg)) {
    const proj = `+proj=utm +zone=${zone} ${hemisphere === 'S' ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
    UTM_PROJ_CACHE.set(epsg, proj);
  }
  return UTM_PROJ_CACHE.get(epsg)!;
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

/**
 * Determine hemisphere from MGRS latitude band letter.
 * Bands C-M are southern hemisphere, N-X are northern.
 */
export function getGZDHemisphere(band: string): 'N' | 'S' {
  return band >= 'N' ? 'N' : 'S';
}

/**
 * Project a UTM rectangle to WGS84, sampling points along each edge
 * to capture the curvature of UTM → WGS84 projection.
 */
function utmRectToWGS84Polygon(
  eMin: number,
  nMin: number,
  size: number,
  zone: number,
  hemisphere: 'N' | 'S',
  samplesPerEdge: number = 20
): number[][] {
  const eMax = eMin + size;
  const nMax = nMin + size;
  const points: number[][] = [];

  // Bottom edge: left to right
  for (let i = 0; i < samplesPerEdge; i++) {
    const e = eMin + (eMax - eMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(e, nMin, zone, hemisphere);
    points.push([lon, lat]);
  }
  // Right edge: bottom to top
  for (let i = 0; i < samplesPerEdge; i++) {
    const n = nMin + (nMax - nMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(eMax, n, zone, hemisphere);
    points.push([lon, lat]);
  }
  // Top edge: right to left
  for (let i = 0; i < samplesPerEdge; i++) {
    const e = eMax - (eMax - eMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(e, nMax, zone, hemisphere);
    points.push([lon, lat]);
  }
  // Left edge: top to bottom
  for (let i = 0; i < samplesPerEdge; i++) {
    const n = nMax - (nMax - nMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(eMin, n, zone, hemisphere);
    points.push([lon, lat]);
  }

  // Close the ring
  points.push([...points[0]]);
  return points;
}

/**
 * Convert a GeoJSON-style coordinate ring to a JSTS Polygon geometry.
 */
function coordsToJSTSPolygon(coords: number[][]): JSTSGeometry {
  const jtsCoords = coords.map(c => new Coordinate(c[0], c[1]));
  const ring = geometryFactory.createLinearRing(jtsCoords);
  return geometryFactory.createPolygon(ring);
}

/**
 * Convert a JSTS geometry to GeoJSON coordinate rings.
 * Handles Polygon and MultiPolygon results from intersection.
 */
function jstsToGeoJSONCoords(geom: JSTSGeometry): number[][][][] {
  const results: number[][][][] = [];

  const type = geom.getGeometryType();
  if (type === 'Polygon') {
    const exterior = (geom as any).getExteriorRing();
    const coords = exterior.getCoordinates().map((c: any) => [c.x, c.y]);
    results.push([coords]);
  } else if (type === 'MultiPolygon') {
    const n = geom.getNumGeometries();
    for (let i = 0; i < n; i++) {
      const poly = geom.getGeometryN(i);
      const exterior = (poly as any).getExteriorRing();
      const coords = exterior.getCoordinates().map((c: any) => [c.x, c.y]);
      results.push([coords]);
    }
  }

  return results;
}

/**
 * Generate all 100km MGRS square features for a single GZD.
 */
export function generate100kmSquaresForGZD(
  zone: number,
  band: string,
  hemisphere: 'N' | 'S',
  gzdPolygonCoords: number[][][]
): MGRSSquareFeature[] {
  const features: MGRSSquareFeature[] = [];
  const gzdName = `${zone}${band}`;

  // Build JSTS geometry for the GZD boundary
  let gzdGeom: JSTSGeometry;
  try {
    gzdGeom = coordsToJSTSPolygon(gzdPolygonCoords[0]);
  } catch (e) {
    console.warn(`[generate100km] Failed to create GZD geometry for ${gzdName}:`, e);
    return features;
  }

  // Project GZD polygon corners to UTM to find the easting/northing range
  let minE = Infinity, maxE = -Infinity;
  let minN = Infinity, maxN = -Infinity;

  for (const coord of gzdPolygonCoords[0]) {
    try {
      const [e, n] = latLonToUTM(coord[0], coord[1], zone, hemisphere);
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    } catch {
      // Skip points that fail to project (can happen at extreme latitudes)
    }
  }

  if (!isFinite(minE) || !isFinite(maxE)) {
    return features;
  }

  // Snap to 100km grid
  const gridSize = 100000;
  minE = Math.floor(minE / gridSize) * gridSize;
  maxE = Math.ceil(maxE / gridSize) * gridSize;
  minN = Math.floor(minN / gridSize) * gridSize;
  maxN = Math.ceil(maxN / gridSize) * gridSize;

  // Iterate over each 100km cell
  for (let e = minE; e < maxE; e += gridSize) {
    for (let n = minN; n < maxN; n += gridSize) {
      try {
        // Build UTM rectangle projected to WGS84
        const wgs84Ring = utmRectToWGS84Polygon(e, n, gridSize, zone, hemisphere, 20);

        // Create JSTS polygon from the projected ring
        let cellGeom: JSTSGeometry;
        try {
          cellGeom = coordsToJSTSPolygon(wgs84Ring);
        } catch {
          continue;
        }

        // Intersect cell with GZD boundary
        let intersection: JSTSGeometry;
        try {
          intersection = OverlayOp.intersection(gzdGeom, cellGeom);
        } catch {
          // Topology exceptions can occur with near-degenerate geometries
          continue;
        }

        if (intersection.isEmpty() || intersection.getArea() < 1e-8) {
          continue;
        }

        // Get center of the UTM cell for MGRS labeling
        const centerE = e + gridSize / 2;
        const centerN = n + gridSize / 2;
        const [centerLon, centerLat] = utmToLatLon(centerE, centerN, zone, hemisphere);

        // Use mgrs.forward() for authoritative MGRS ID at 100km precision
        let mgrsString: string;
        try {
          mgrsString = mgrsForward([centerLon, centerLat], 0);
        } catch {
          // Fallback: skip squares where mgrs.forward fails
          continue;
        }

        // Extract the 2-letter 100km square ID (characters after zone+band, e.g. "18SUJ" → "UJ")
        // MGRS at accuracy 0 returns something like "18SUJ"
        const squareId = mgrsString.replace(/^(\d{1,2})([A-Z])/, '');
        const fullId = mgrsString;

        // Convert intersection geometry to GeoJSON coordinates
        const polyCoords = jstsToGeoJSONCoords(intersection);

        for (const coords of polyCoords) {
          features.push({
            type: 'Feature',
            properties: {
              id: fullId,
              squareId,
              gzd: gzdName,
            },
            geometry: {
              type: 'Polygon',
              coordinates: coords,
            },
          });
        }
      } catch (err) {
        // Skip individual cells that fail
        console.warn(`[generate100km] Error processing cell at ${e},${n} in ${gzdName}:`, err);
      }
    }
  }

  return features;
}
