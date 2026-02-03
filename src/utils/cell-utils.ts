import { Point } from '@ngageoint/grid-js';
import { GridType, MGRS } from '@ngageoint/mgrs-js';
import { UTM } from '@ngageoint/mgrs-js/dist/lib/utm/UTM';
import type { CellEntry, CellPolygon } from '../types/types';

/**
 * Returns the finest visible grid type for the given zoom level,
 * matching the thresholds in MGRSLayer.
 */
export function getActiveGridType(zoom: number): GridType | null {
  if (zoom >= 11) return GridType.KILOMETER;
  if (zoom >= 8) return GridType.TEN_KILOMETER;
  if (zoom >= 4) return GridType.HUNDRED_KILOMETER;
  if (zoom >= 0) return GridType.GZD;
  return null;
}

/**
 * Identifies the MGRS cell at a given lon/lat for the specified grid type
 * and computes its polygon bounds.
 */
export function getCellAtPosition(
  lon: number,
  lat: number,
  gridType: GridType,
): CellEntry | null {
  // Outside MGRS coverage (80S to 84N)
  if (lat < -80 || lat > 84) return null;

  try {
    const point = Point.degrees(lon, lat);
    const mgrs = MGRS.from(point);
    const mgrsId = mgrs.coordinate(gridType);
    const polygon = getCellPolygon(mgrsId, gridType);
    return { mgrsId, gridType, polygon };
  } catch {
    return null;
  }
}

/**
 * Computes a closed 5-point polygon ring for an MGRS cell.
 *
 * - GZD cells: uses GridZone bounds directly (lat/lon rectangle)
 * - Sub-zone cells: parses MGRS -> UTM for SW corner, adds cell size
 *   in meters, converts all 4 corners back to lat/lon
 */
export function getCellPolygon(
  mgrsId: string,
  gridType: GridType,
): CellPolygon {
  const parsed = MGRS.parse(mgrsId);

  if (gridType === GridType.GZD) {
    const bounds = parsed.getGridZone().getBounds();
    const sw: [number, number] = [bounds.getMinLongitude(), bounds.getMinLatitude()];
    const se: [number, number] = [bounds.getMaxLongitude(), bounds.getMinLatitude()];
    const ne: [number, number] = [bounds.getMaxLongitude(), bounds.getMaxLatitude()];
    const nw: [number, number] = [bounds.getMinLongitude(), bounds.getMaxLatitude()];
    return { ring: [sw, se, ne, nw, sw] };
  }

  // For HUNDRED_KILOMETER, TEN_KILOMETER, KILOMETER: use UTM corners
  const utm = parsed.toUTM();
  const zone = utm.getZone();
  const hemisphere = utm.getHemisphere();
  const easting = utm.getEasting();
  const northing = utm.getNorthing();
  const size = gridType as number; // GridType value IS the cell size in meters

  const swPt = UTM.point(zone, hemisphere, easting, northing);
  const sePt = UTM.point(zone, hemisphere, easting + size, northing);
  const nePt = UTM.point(zone, hemisphere, easting + size, northing + size);
  const nwPt = UTM.point(zone, hemisphere, easting, northing + size);

  const sw: [number, number] = [swPt.getLongitude(), swPt.getLatitude()];
  const se: [number, number] = [sePt.getLongitude(), sePt.getLatitude()];
  const ne: [number, number] = [nePt.getLongitude(), nePt.getLatitude()];
  const nw: [number, number] = [nwPt.getLongitude(), nwPt.getLatitude()];

  return { ring: [sw, se, ne, nw, sw] };
}
