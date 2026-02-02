/**
 * Viewport and Geometry Utilities for MGRS Layers
 */

/**
 * Simple bounding box intersection test for GZD features against viewport.
 */
export function bboxIntersects(
  coords: number[][][],
  viewWest: number,
  viewSouth: number,
  viewEast: number,
  viewNorth: number
): boolean {
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (const ring of coords) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  return !(maxLon < viewWest || minLon > viewEast || maxLat < viewSouth || minLat > viewNorth);
}

/**
 * Compute label position: bottom-left corner of a polygon's bounding box,
 * nudged slightly inward.
 */
export function getBottomLeftPosition(coords: number[][][]): [number, number] {
  let minLon = Infinity, minLat = Infinity;
  let maxLon = -Infinity, maxLat = -Infinity;

  for (const ring of coords) {
    for (const [lon, lat] of ring) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  const lonNudge = (maxLon - minLon) * 0.03;
  const latNudge = (maxLat - minLat) * 0.03;
  return [minLon + lonNudge, minLat + latNudge];
}

/**
 * Get viewport bounds from a deck.gl viewport object.
 */
export function getViewportBounds(viewport: any): {
  viewWest: number;
  viewSouth: number;
  viewEast: number;
  viewNorth: number;
} | null {
  try {
    const bounds = viewport.getBounds();
    if (Array.isArray(bounds[0])) {
      return {
        viewWest: bounds[0][0],
        viewSouth: bounds[0][1],
        viewEast: bounds[1][0],
        viewNorth: bounds[1][1],
      };
    } else {
      return {
        viewWest: bounds[0],
        viewSouth: bounds[1],
        viewEast: bounds[2],
        viewNorth: bounds[3],
      };
    }
  } catch (e) {
    console.error('[viewportUtils] Error getting viewport bounds:', e);
    return null;
  }
}
