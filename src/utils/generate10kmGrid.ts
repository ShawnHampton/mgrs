/**
 * Generate 10km MGRS grid cells for a given 100km square.
 *
 * Follows the same pattern as generate100kmSquares.ts:
 * 1. Project 100km square polygon corners to UTM to find the grid range
 * 2. Build UTM rectangles for each 10km cell
 * 3. Project them to WGS84 with dense edge sampling (captures curvature)
 * 4. Clip to the 100km square boundary using JSTS polygon intersection
 * 5. Label each cell using mgrs.forward() for authoritative MGRS IDs
 */

import proj4 from 'proj4';
import { forward as mgrsForward } from 'mgrs';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp';
import type { MGRSSquareFeature } from '../types/mgrs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JSTSGeometry = any;

const geometryFactory = new GeometryFactory();

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

function utmRectToWGS84Polygon(
  eMin: number,
  nMin: number,
  size: number,
  zone: number,
  hemisphere: 'N' | 'S',
  samplesPerEdge: number = 10
): number[][] {
  const eMax = eMin + size;
  const nMax = nMin + size;
  const points: number[][] = [];

  for (let i = 0; i < samplesPerEdge; i++) {
    const e = eMin + (eMax - eMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(e, nMin, zone, hemisphere);
    points.push([lon, lat]);
  }
  for (let i = 0; i < samplesPerEdge; i++) {
    const n = nMin + (nMax - nMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(eMax, n, zone, hemisphere);
    points.push([lon, lat]);
  }
  for (let i = 0; i < samplesPerEdge; i++) {
    const e = eMax - (eMax - eMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(e, nMax, zone, hemisphere);
    points.push([lon, lat]);
  }
  for (let i = 0; i < samplesPerEdge; i++) {
    const n = nMax - (nMax - nMin) * (i / samplesPerEdge);
    const [lon, lat] = utmToLatLon(eMin, n, zone, hemisphere);
    points.push([lon, lat]);
  }

  points.push([...points[0]]);
  return points;
}

function coordsToJSTSPolygon(coords: number[][]): JSTSGeometry {
  const jtsCoords = coords.map(c => new Coordinate(c[0], c[1]));
  const ring = geometryFactory.createLinearRing(jtsCoords);
  return geometryFactory.createPolygon(ring);
}

function jstsToGeoJSONCoords(geom: JSTSGeometry): number[][][][] {
  const results: number[][][][] = [];

  const type = geom.getGeometryType();
  if (type === 'Polygon') {
    const exterior = (geom as any).getExteriorRing();
    const coords = exterior.getCoordinates().map((c: any) => [c.x, c.y]);
    // GeoJSON exterior rings must be CCW. JTS produces CW. Reverse them.
    coords.reverse();
    results.push([coords]);
  } else if (type === 'MultiPolygon') {
    const n = geom.getNumGeometries();
    for (let i = 0; i < n; i++) {
      const poly = geom.getGeometryN(i);
      const exterior = (poly as any).getExteriorRing();
      const coords = exterior.getCoordinates().map((c: any) => [c.x, c.y]);
      // GeoJSON exterior rings must be CCW.
      coords.reverse();
      results.push([coords]);
    }
  }

  return results;
}

/**
 * Generate all 10km grid cell features for a single 100km square.
 */
export function generate10kmGridForSquare(
  zone: number,
  hemisphere: 'N' | 'S',
  squarePolygonCoords: number[][][],
  parentId: string
): MGRSSquareFeature[] {
  const features: MGRSSquareFeature[] = [];
  const gzd = parentId.replace(/[A-Z]{2}$/, ''); // e.g. "18SUJ" → "18S"

  // Build JSTS geometry for the 100km square boundary
  let squareGeom: JSTSGeometry;
  try {
    squareGeom = coordsToJSTSPolygon(squarePolygonCoords[0]);
  } catch (e) {
    console.warn(`[generate10km] Failed to create square geometry for ${parentId}:`, e);
    return features;
  }

  // Project polygon corners to UTM to find easting/northing range
  let minE = Infinity, maxE = -Infinity;
  let minN = Infinity, maxN = -Infinity;

  for (const coord of squarePolygonCoords[0]) {
    try {
      const [e, n] = latLonToUTM(coord[0], coord[1], zone, hemisphere);
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    } catch {
      // Skip points that fail to project
    }
  }

  if (!isFinite(minE) || !isFinite(maxE)) {
    return features;
  }

  // Snap to 10km grid
  const gridSize = 10000;
  minE = Math.floor(minE / gridSize) * gridSize;
  maxE = Math.ceil(maxE / gridSize) * gridSize;
  minN = Math.floor(minN / gridSize) * gridSize;
  maxN = Math.ceil(maxN / gridSize) * gridSize;

  // Track failures for diagnostics
  let cellsAttempted = 0;
  let intersectionFailures = 0;

  for (let e = minE; e < maxE; e += gridSize) {
    for (let n = minN; n < maxN; n += gridSize) {
      cellsAttempted++;
      try {
        const wgs84Ring = utmRectToWGS84Polygon(e, n, gridSize, zone, hemisphere, 10);

        let cellGeom: JSTSGeometry;
        try {
          cellGeom = coordsToJSTSPolygon(wgs84Ring);
        } catch {
          continue;
        }

        let intersection: JSTSGeometry;
        try {
          intersection = OverlayOp.intersection(squareGeom, cellGeom);
        } catch {
          // Retry with BufferOp to repair topology issues
          try {
            const repairedSquare = BufferOp.bufferOp(squareGeom, 0);
            const repairedCell = BufferOp.bufferOp(cellGeom, 0);
            intersection = OverlayOp.intersection(repairedSquare, repairedCell);
          } catch {
            intersectionFailures++;
            continue;
          }
        }

        if (intersection.isEmpty() || intersection.getArea() < 1e-8) {
          // Fallback: If intersection is empty, it might be due to precision issues at the edge.
          // Check if the cell center is actually inside the square using a simple point test.
          // If so, use the cellGeom directly (clipped to squareGeom roughly via intersection, but if that failed, we take the cell).
          // Actually, if intersection failed, we can try to just use the cell geometry if it's mostly inside.
          
          // Alternative fallback: Try intersecting with a slightly larger square
          try {
             const largerSquare = BufferOp.bufferOp(squareGeom, 0.0001);
             intersection = OverlayOp.intersection(largerSquare, cellGeom);
          } catch {
             // giving up
          }

          if (intersection.isEmpty() || intersection.getArea() < 1e-8) {
             continue;
          }
        }

        // Get center of the UTM cell for MGRS labeling
        const centerE = e + gridSize / 2;
        const centerN = n + gridSize / 2;
        const [centerLon, centerLat] = utmToLatLon(centerE, centerN, zone, hemisphere);

        // Use mgrs.forward() at accuracy=1 for 10km precision
        let mgrsString: string;
        try {
          mgrsString = mgrsForward([centerLon, centerLat], 1);
          // Normalize to zero-padded zone (e.g. "5Q..." -> "05Q...")
          const match = mgrsString.match(/^(\d{1,2})([A-Z])/);
          if (match && match[1].length === 1) {
            mgrsString = `0${mgrsString}`;
          }
        } catch {
          continue;
        }

        // Extract the numeric grid digits (e.g. "18SUJ15" → "15")
        // Note: regex now expects 2 digits for zone
        const squareDigits = mgrsString.replace(/^(\d{2})([A-Z])([A-Z]{2})/, '');
        const fullId = mgrsString;
        
        // DEBUG: Verbose logging for 05QKB
        if (fullId.startsWith('05QKB') || fullId.startsWith('5QKB')) {
           // console.log(`[generate10km] Generated feature ${fullId} at UTM ${centerE},${centerN}`);
        }

        const polyCoords = jstsToGeoJSONCoords(intersection);

        for (const coords of polyCoords) {
          features.push({
            type: 'Feature',
            properties: {
              id: fullId,
              squareId: squareDigits,
              gzd,
            },
            geometry: {
              type: 'Polygon',
              coordinates: coords,
            },
          });
        }
      } catch (err) {
        console.warn(`[generate10km] Error processing cell at ${e},${n} in ${parentId}:`, err);
      }
    }
  }

  if (features.length === 0 && cellsAttempted > 0) {
    console.warn(
      `[generate10km] Zero features for ${parentId}: ${cellsAttempted} cells attempted, ` +
      `${intersectionFailures} intersection failures, ` +
      `UTM range E[${minE}-${maxE}] N[${minN}-${maxN}], ` +
      `squareGeom type=${squareGeom.getGeometryType()} area=${squareGeom.getArea()}`
    );
  }

  return features;
}
