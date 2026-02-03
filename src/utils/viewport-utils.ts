
import { Viewport } from '@deck.gl/core';
import { Bounds, Unit } from '@ngageoint/grid-js';

/**
 * Calculates geographic bounds (Bounds) for a given deck.gl Viewport.
 */
export function getViewportBounds(viewport: Viewport): Bounds | null {
  try {
    // Get viewport corner coordinates
    const nw = viewport.unproject([0, 0]);
    const se = viewport.unproject([viewport.width, viewport.height]);
    
    if (!nw || !se) return null;

    // Clamp to valid MGRS lat/lon ranges
    const minLon = Math.max(-180, Math.min(nw[0], se[0]));
    const maxLon = Math.min(180, Math.max(nw[0], se[0]));
    const minLat = Math.max(-80, Math.min(nw[1], se[1]));
    const maxLat = Math.min(84, Math.max(nw[1], se[1]));

    return Bounds.bounds(minLon, minLat, maxLon, maxLat, Unit.DEGREE);
  } catch {
    return null;
  }
}
