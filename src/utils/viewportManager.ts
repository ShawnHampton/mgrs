/**
 * Viewport Manager - Manages MGRS data generation based on viewport changes
 *
 * This utility monitors viewport changes and ensures the store is populated
 * with the appropriate MGRS squares for the current view.
 */

import type { Viewport } from '@deck.gl/core';
import { useMGRSStore } from '../store/mgrsStore';
import { getWorkerPool } from './WorkerPool';
import { bboxIntersects, getViewportBounds } from './viewportUtils';
import type { Generate100kmRequest, Generate100kmResponse } from '../types/mgrs';

class ViewportManager {
  private pendingGZDs: Set<string> = new Set();

  // Plain object to track which 100km squares have already been requested for 10km generation.
  // Once requested, never re-requested. No deletion, no clearing.
  private requested10km: Record<string, boolean> = {};

  /**
   * Update 100km squares based on current viewport
   */
  update100kmSquares(viewport: Viewport) {
    const store = useMGRSStore.getState();
    const gzdData = store.gzdData;

    if (!gzdData) return;

    const bounds = getViewportBounds(viewport);
    if (!bounds) return;

    const { viewWest, viewSouth, viewEast, viewNorth } = bounds;
    const processedGZDs = new Set<string>();
    const visibleSquares: any[] = [];

    // Check which GZDs are visible and collect their squares
    for (const feature of gzdData.features) {
      const gzdName = feature.properties.gzd;

      if (processedGZDs.has(gzdName)) continue;
      processedGZDs.add(gzdName);

      const coords = feature.geometry.coordinates;

      // Skip if GZD doesn't intersect viewport
      if (!bboxIntersects(coords, viewWest, viewSouth, viewEast, viewNorth)) {
        continue;
      }

      // Check if we already have this GZD's squares
      const cachedSquares = store.getSquares100km(gzdName);
      if (cachedSquares) {
        // Add visible squares from this GZD
        for (const square of cachedSquares) {
          if (bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth)) {
            visibleSquares.push(square);
          }
        }
        continue;
      }

      // Request generation if not already pending
      if (!this.pendingGZDs.has(gzdName)) {
        this.pendingGZDs.add(gzdName);

        const request: Generate100kmRequest = {
          gzd: gzdName,
          zone: feature.properties.zone,
          band: feature.properties.band,
          hemisphere: feature.properties.band >= 'N' ? 'N' : 'S',
          bounds: coords,
        };

        getWorkerPool().requestGenerate100km(request, (response: Generate100kmResponse) => {
          const store = useMGRSStore.getState();
          store.setSquares100km(response.gzd, response.features);
          this.pendingGZDs.delete(response.gzd);
          // Trigger a re-computation of visible squares
          this.update100kmSquares(viewport);
        });
      }
    }

    // Update the store with visible squares for rendering
    store.setVisible100kmSquares(visibleSquares);
  }

  /**
   * Request 10km grid generation for visible 100km squares.
   *
   * No caching, no visibility filtering of results.
   * The callback appends directly to the store's flat array.
   */
  update10kmGrids(viewport: Viewport) {
    const store = useMGRSStore.getState();
    const gzdData = store.gzdData;

    if (!gzdData) return;

    const bounds = getViewportBounds(viewport);
    if (!bounds) return;

    const { viewWest, viewSouth, viewEast, viewNorth } = bounds;

    // Get all visible 100km squares
    const processedGZDs = new Set<string>();

    for (const feature of gzdData.features) {
      const gzdName = feature.properties.gzd;

      if (processedGZDs.has(gzdName)) continue;
      processedGZDs.add(gzdName);

      const coords = feature.geometry.coordinates;
      if (!bboxIntersects(coords, viewWest, viewSouth, viewEast, viewNorth)) {
        continue;
      }

      const cachedSquares = store.getSquares100km(gzdName);
      if (!cachedSquares) continue;

      for (const square of cachedSquares) {
        if (!bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth)) {
          continue;
        }

        const squareId = square.properties.id;

        // Already requested? Skip. (simple object lookup, no Set)
        if (this.requested10km[squareId]) continue;
        this.requested10km[squareId] = true;

        const match = squareId.match(/^(\d{2})([A-Z])/);
        if (!match) {
          console.warn(`[ViewportManager] Invalid MGRS ID format: ${squareId}`);
          continue;
        }

        const zone = parseInt(match[1], 10);
        const band = match[2];
        const hemisphere: 'N' | 'S' = band >= 'N' ? 'N' : 'S';

        // Get UTM bounds from properties (added by generate100kmSquares)
        const utmBounds = square.properties?.utmBounds;
        
        if (squareId === '05QKB') {
          console.log(`[ViewportManager] UTM bounds for ${squareId}:`, utmBounds);
        }

        getWorkerPool().requestGenerate10km(
          {
            squareId,
            zone,
            hemisphere,
            bounds: square.geometry.coordinates,
            utmBounds,
          },
          (response) => {
            console.log(`[ViewportManager] 10km callback for ${response.squareId}: ${response.features.length} features received`);
            // Directly append to the flat array — no Maps, no recomputation
            useMGRSStore.getState().append10kmFeatures(response.features);
          },
          (error) => {
            console.error(`[ViewportManager] Error generating 10km grids for ${squareId}:`, error);
            // Allow retry
            this.requested10km[squareId] = false;
          }
        );
      }
    }
  }

  /**
   * Handle viewport change - updates appropriate data based on zoom level
   */
  onViewportChange(viewport: Viewport) {
    const zoom = viewport.zoom || 0;

    // Update 100km squares if zoom >= 5
    if (zoom >= 5) {
      this.update100kmSquares(viewport);
    }

    // Update 10km grids if zoom >= 8
    if (zoom >= 8) {
      this.update10kmGrids(viewport);
    }

    // Store viewport bounds for reference
    const bounds = getViewportBounds(viewport);
    if (bounds) {
      useMGRSStore.getState().setViewportBounds({
        west: bounds.viewWest,
        south: bounds.viewSouth,
        east: bounds.viewEast,
        north: bounds.viewNorth,
      });
    }
  }

  /**
   * Clear all pending requests
   */
  clearPending() {
    this.pendingGZDs.clear();
    this.requested10km = {};
  }
}

// Singleton instance
let viewportManagerInstance: ViewportManager | null = null;

export function getViewportManager(): ViewportManager {
  if (!viewportManagerInstance) {
    viewportManagerInstance = new ViewportManager();
  }
  return viewportManagerInstance;
}
