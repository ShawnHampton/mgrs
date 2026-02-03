/**
 * Generate 10km MGRS grid cells for a given 100km square.
 *
 * For each 100km square, we:
 * 1. Project the square's center to UTM and snap to 100km boundaries to get exact extent
 * 2. Build UTM rectangles for each 10km cell within that extent
 * 3. Project them to WGS84 with dense edge sampling (captures curvature)
 * 4. Label each cell using mgrs.forward() for authoritative MGRS IDs
 *
 * Note: No culling/clipping to the parent 100km square boundary is performed
 * in this phase — all cells within the UTM extent are emitted.
 */

import proj4 from 'proj4';
import type { MGRSSquareFeature } from '../types/mgrs';

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
 * Project a UTM rectangle to WGS84, sampling points along each edge
 * to capture the curvature of UTM → WGS84 projection.
 *
 * 10km cells are much smaller than 100km cells, so 8 samples per edge
 * is sufficient to represent the curvature accurately.
 */
function utmRectToWGS84Polygon(
  eMin: number,
  nMin: number,
  size: number,
  zone: number,
  hemisphere: 'N' | 'S',
  samplesPerEdge: number = 8
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
 * Generate all 10km MGRS grid cell features for a single 100km square.
 *
 * @param zone       UTM zone number (1–60)
 * @param hemisphere 'N' or 'S'
 * @param bounds     100km square polygon coordinates [[[lon, lat], ...]]
 * @param squareId   Full MGRS 100km square ID, e.g. "18SUJ"
 * @param utmBounds  Optional exact UTM bounds [minE, minN, maxE, maxN]
 */
export function generate10kmGridForSquare(
  zone: number | string,
  hemisphere: 'N' | 'S',
  bounds: number[][][],
  squareId: string,
  utmBounds?: [number, number, number, number]
): MGRSSquareFeature[] {
  const features: MGRSSquareFeature[] = [];
  const zoneNum = typeof zone === 'string' ? parseInt(zone, 10) : zone;

  // DEBUG: Only process 05QKB for now
  if (squareId.toUpperCase() !== '05QKB') {
    return features;
  }

  // Extract GZD from squareId (e.g., "18SUJ" → "18S")
  const gzdMatch = squareId.match(/^(\d{2}[A-Z])/);
  const gzd = gzdMatch ? gzdMatch[1] : squareId.substring(0, 3);

  // Validate bounds
  if (!bounds || !bounds[0] || bounds[0].length < 3) {
    console.warn(`[generate10km] Invalid bounds for ${squareId}: missing or degenerate polygon`);
    return features;
  }

  // Use exact UTM bounds if provided, otherwise derive from polygon
  let minE: number, minN: number, maxE: number, maxN: number;

  if (utmBounds) {
    // Use the exact UTM bounds from the 100km squares data
    [minE, minN, maxE, maxN] = utmBounds;
    console.log(`[generate10km] Using provided UTM bounds for ${squareId}: E[${minE}–${maxE}] N[${minN}–${maxN}]`);
  } else {
    // Fallback: Derive from polygon center and snap to 100km boundaries
    let sumLon = 0, sumLat = 0, count = 0;
    for (const coord of bounds[0]) {
      if (coord.length >= 2) {
        sumLon += coord[0];
        sumLat += coord[1];
        count++;
      }
    }

    if (count === 0) {
      console.warn(`[generate10km] No valid coordinates for ${squareId}`);
      return features;
    }

    const centerLon = sumLon / count;
    const centerLat = sumLat / count;

    // Project center to UTM
    let centerE: number, centerN: number;
    try {
      [centerE, centerN] = latLonToUTM(centerLon, centerLat, zoneNum, hemisphere);
    } catch (err) {
      console.warn(`[generate10km] Failed to project center for ${squareId}:`, err);
      return features;
    }

    if (!isFinite(centerE) || !isFinite(centerN)) {
      console.warn(`[generate10km] Invalid UTM center for ${squareId}`);
      return features;
    }

    // Snap center to 100km grid boundaries
    const squareSize = 100_000;
    minE = Math.floor(centerE / squareSize) * squareSize;
    maxE = minE + squareSize;
    minN = Math.floor(centerN / squareSize) * squareSize;
    maxN = minN + squareSize;
    console.log(`[generate10km] Derived UTM bounds for ${squareId}: E[${minE}–${maxE}] N[${minN}–${maxN}]`);
  }

  // Iterate over each 10km cell
  const gridSize = 10_000;
  for (let e = minE; e < maxE; e += gridSize) {
    for (let n = minN; n < maxN; n += gridSize) {
      try {
        // Build UTM rectangle projected to WGS84
        const wgs84Ring = utmRectToWGS84Polygon(e, n, gridSize, zoneNum, hemisphere);

        // Compute 10km cell ID from UTM coordinates
        // The 10km digit is which 10km cell within the 100km square (0-9 for each axis)
        // We use the cell's starting easting/northing, not the center
        const eDigit = Math.floor((e - minE) / gridSize);
        const nDigit = Math.floor((n - minN) / gridSize);
        const cellId = `${eDigit}${nDigit}`;
        const mgrsString = `${squareId}${cellId}`;

        const feature = {
          type: 'Feature',
          properties: {
            id: mgrsString,
            squareId: cellId,
            gzd,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [wgs84Ring],
          },
        };

        // DEBUG: Log first feature
        if (features.length === 0) {
          console.log(`[generate10km] First feature for ${squareId}:`, JSON.stringify(feature.properties));
        }

        features.push(feature);
      } catch (err) {
        console.warn(`[generate10km] Error processing cell at ${e},${n} in ${squareId}:`, err);
      }
    }
  }

  if (features.length === 0) {
    console.warn(
      `[generate10km] Zero features for ${squareId}. ` +
      `UTM extent: E[${minE}–${maxE}] N[${minN}–${maxN}], ` +
      `vertices: ${bounds[0].length}, zone: ${zoneNum}${hemisphere}`
    );
  }

  return features;
}
