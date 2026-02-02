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
  private pending100kmSquares: Set<string> = new Set();
  private lastViewport: { zoom: number; bounds: any } | null = null;

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
   * Update 10km grids based on current viewport
   */
  update10kmGrids(viewport: Viewport) {
    const store = useMGRSStore.getState();
    const gzdData = store.gzdData;
    
    if (!gzdData) return;

    const bounds = getViewportBounds(viewport);
    if (!bounds) return;

    const { viewWest, viewSouth, viewEast, viewNorth } = bounds;

    // Get all visible 100km squares
    const visible100kmSquares: any[] = [];
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
      if (cachedSquares) {
        for (const square of cachedSquares) {
          if (bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth)) {
            visible100kmSquares.push(square);
          }
        }
      }
    }

    // Collect visible 10km grids
    const visible10kmGrids: any[] = [];

    // Request 10km grids for visible 100km squares
    for (const square of visible100kmSquares) {
      const squareId = square.properties.id;

      // Check if we already have this square's 10km grids
      const cachedGrids = store.getGrids10km(squareId);
      if (cachedGrids) {
        // Add all grids from this square (they're already filtered to the square bounds)
        visible10kmGrids.push(...cachedGrids);
        continue;
      }

      // Request generation if not already pending
      if (!this.pending100kmSquares.has(squareId)) {
        this.pending100kmSquares.add(squareId);

        const match = squareId.match(/^(\d{2})([A-Z])/);
        if (!match) {
          console.warn(`[ViewportManager] Invalid MGRS ID format: ${squareId}`);
          continue;
        }

        const zone = parseInt(match[1], 10);
        const band = match[2];
        const hemisphere: 'N' | 'S' = band >= 'N' ? 'N' : 'S';

        getWorkerPool().requestGenerate10km(
          {
            squareId,
            zone,
            hemisphere,
            bounds: square.geometry.coordinates,
          },
          (response) => {
            const store = useMGRSStore.getState();
            store.setGrids10km(response.squareId, response.features);
            this.pending100kmSquares.delete(response.squareId);
            // Trigger a re-computation of visible grids
            this.update10kmGrids(viewport);
          },
          (error) => {
            console.error(`[ViewportManager] Error generating 10km grids for ${squareId}:`, error);
            this.pending100kmSquares.delete(squareId);
          }
        );
      }
    }

    // Update the store with visible grids for rendering
    store.setVisible10kmGrids(visible10kmGrids);
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
    this.pending100kmSquares.clear();
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
