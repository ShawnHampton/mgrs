/**
 * MGRS Layer - Deck.gl Composite Layer
 *
 * Renders MGRS grid at multiple resolutions:
 * - Static GeoJSON layer for GZD boundaries at low zoom
 * - Dynamic GZD-based 100km squares generated on demand (zoom 7-9)
 * - Dynamic tile-based grid for 10km/1km/100m (zoom >= 10)
 */

import { CompositeLayer, type DefaultProps } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type {
  MGRSLayerProps,
  MGRSSquareFeature,
  Generate100kmRequest,
  Generate100kmResponse,
  Generate10kmRequest,
  Generate10kmResponse,
} from '../types/mgrs';
import type { GZDGeoJSON } from '../utils/generateGZD';

// Default layer styling - modern, clear hierarchy
const DEFAULT_PROPS: DefaultProps<MGRSLayerProps> = {
  id: 'mgrs-layer',
  visible: true,
  opacity: 1,
  // Line widths (in pixels)
  gzdLineWidth: 2,
  grid100kmLineWidth: 1.5,
  grid10kmLineWidth: 1,
  grid1kmLineWidth: 0.75,
  // Line colors [R, G, B, A] 0-255 - using distinct, professional colors
  gzdLineColor: [239, 68, 68, 200],      // Red-500
  grid100kmLineColor: [59, 130, 246, 180], // Blue-500
  grid10kmLineColor: [255, 0, 255, 255],   // Magenta-500 (Bright Pink)
  grid1kmLineColor: [251, 191, 36, 140],   // Amber-500
  // Label styling
  labelFontFamily: 'Monaco, monospace',
  labelFontSize: 11,
  labelColor: [255, 255, 255, 255],
  labelBackgroundColor: [15, 23, 42, 200],
  showLabels: false
};

// Worker pool for tile generation
class WorkerPool {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private generate100kmCallbacks: Map<string, (response: Generate100kmResponse) => void> = new Map();
  private generate10kmCallbacks: Map<string, (response: Generate10kmResponse) => void> = new Map();
  private generate10kmErrorCallbacks: Map<string, (error: string) => void> = new Map();

  constructor(size: number = 4) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL('../workers/mgrs.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event) => {
        const { type, payload } = event.data;

        if (type === 'generate-100km-result') {
          const result = payload as Generate100kmResponse;
          const callback = this.generate100kmCallbacks.get(result.gzd);
          if (callback) {
            callback(result);
            this.generate100kmCallbacks.delete(result.gzd);
          }
          return;
        }

        if (type === 'generate-10km-result') {
          const result = payload as Generate10kmResponse;
          const callback = this.generate10kmCallbacks.get(result.squareId);
          if (callback) {
            callback(result);
            this.generate10kmCallbacks.delete(result.squareId);
          }
          return;
        }

        if (type === 'generate-10km-error') {
          const { squareId, error } = payload as { squareId: string; error: string };
          console.warn(`[WorkerPool] 10km generation failed for ${squareId}:`, error);
          const errorCallback = this.generate10kmErrorCallbacks.get(squareId);
          if (errorCallback) {
            errorCallback(error);
          }
          this.generate10kmCallbacks.delete(squareId);
          this.generate10kmErrorCallbacks.delete(squareId);
          return;
        }
      };

      this.workers.push(worker);
    }
  }

  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  requestGenerate100km(request: Generate100kmRequest, callback: (response: Generate100kmResponse) => void) {
    this.generate100kmCallbacks.set(request.gzd, callback);
    const worker = this.getNextWorker();
    worker.postMessage({ type: 'generate-100km', payload: request });
  }

  requestGenerate10km(
    request: Generate10kmRequest,
    callback: (response: Generate10kmResponse) => void,
    onError?: (error: string) => void
  ) {
    this.generate10kmCallbacks.set(request.squareId, callback);
    if (onError) {
      this.generate10kmErrorCallbacks.set(request.squareId, onError);
    }
    const worker = this.getNextWorker();
    worker.postMessage({ type: 'generate-10km', payload: request });
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.generate100kmCallbacks.clear();
    this.generate10kmCallbacks.clear();
    this.generate10kmErrorCallbacks.clear();
  }
}

// Singleton worker pool
let workerPool: WorkerPool | null = null;

function getWorkerPool(): WorkerPool {
  if (!workerPool) {
    workerPool = new WorkerPool(4);
  }
  return workerPool;
}

/**
 * Simple bounding box intersection test for GZD features against viewport.
 */
function bboxIntersects(
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
function getBottomLeftPosition(coords: number[][][]): [number, number] {
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

  // Nudge slightly inward from bottom-left
  const lonNudge = (maxLon - minLon) * 0.03;
  const latNudge = (maxLat - minLat) * 0.03;
  return [minLon + lonNudge, minLat + latNudge];
}

export class MGRSLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'MGRSLayer';
  static defaultProps = DEFAULT_PROPS;

  private gzdData: GZDGeoJSON | null = null;
  private gzdLoadError: boolean = false;

  // Dynamic 100km square cache and pending tracking
  private squares100kmCache: Map<string, MGRSSquareFeature[]> = new Map();
  private pendingGZDs: Set<string> = new Set();

  // Dynamic 10km grid cache and pending tracking
  private grid10kmCache: Map<string, MGRSSquareFeature[]> = new Map();
  private pending10kmSquares: Set<string> = new Set();

  initializeState() {
    this.loadGZDData();
  }

  private async loadGZDData() {
    if (this.gzdData || this.gzdLoadError) return;

    try {
      console.log('[MGRSLayer] Loading GZD data from /gzds.json');
      const response = await fetch('/gzds.json');
      if (!response.ok) throw new Error(`Failed to load GZD data: ${response.status}`);
      this.gzdData = await response.json();
      console.log('[MGRSLayer] GZD data loaded:', this.gzdData!.features?.length, 'features');
      this.setNeedsUpdate();
    } catch (error) {
      console.error('[MGRSLayer] Error loading GZD data:', error);
      this.gzdLoadError = true;
    }
  }

  /**
   * Get visible 100km square features from the cache, and request generation
   * for any visible GZDs not yet in the cache.
   */
  private getVisible100kmSquares(): MGRSSquareFeature[] {
    if (!this.gzdData) return [];

    const viewport = this.context.viewport;
    if (!viewport) return [];

    // Get viewport bounds
    // deck.gl viewport has getBounds() returning [[west, south], [east, north]]
    let viewWest: number, viewSouth: number, viewEast: number, viewNorth: number;
    try {
      const bounds = (viewport as any).getBounds();
      // Handle both [minX, minY, maxX, maxY] and [[minX, minY], [maxX, maxY]] formats
      if (Array.isArray(bounds[0])) {
        viewWest = bounds[0][0];
        viewSouth = bounds[0][1];
        viewEast = bounds[1][0];
        viewNorth = bounds[1][1];
      } else {
        viewWest = bounds[0];
        viewSouth = bounds[1];
        viewEast = bounds[2];
        viewNorth = bounds[3];
      }
      
      console.log(`[DEBUG] Viewport bounds: [${viewWest}, ${viewSouth}, ${viewEast}, ${viewNorth}]`);
    } catch (e) {
      console.error('[MGRSLayer] Error getting viewport bounds:', e);
      return [];
    }

    const allFeatures: MGRSSquareFeature[] = [];
    console.log(`[DEBUG] getVisible100kmSquares: Checking ${this.gzdData.features.length} GZDs against view`, {viewWest, viewSouth, viewEast, viewNorth});


    const processedGZDs = new Set<string>();

    for (const feature of this.gzdData.features) {
      const gzdName = feature.properties.gzd;
      
      if (processedGZDs.has(gzdName)) continue;
      processedGZDs.add(gzdName);

      const coords = feature.geometry.coordinates;

      // Simple bbox test
      if (!bboxIntersects(coords, viewWest, viewSouth, viewEast, viewNorth)) {
        continue;
      }

      // If cached, use cached features
      if (this.squares100kmCache.has(gzdName)) {
        const cachedSquares = this.squares100kmCache.get(gzdName)!;
        // Filter squares to only those visible in viewport
        for (const square of cachedSquares) {
          const isVisible = bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth);
          
          if (square.properties.id === '05QKB') {
             console.log(`[DEBUG] 100km Filter: 05QKB visible? ${isVisible}. Bounds:`, 
               JSON.stringify(square.geometry.coordinates), 
               'View:', {viewWest, viewSouth, viewEast, viewNorth}
             );
          }

          if (isVisible) {
            allFeatures.push(square);
          }
        }
        continue;
      }

      // If not pending, send generation request
      if (!this.pendingGZDs.has(gzdName)) {
        console.log(`[DEBUG] Requesting 100km squares for GZD ${gzdName}`);
        this.pendingGZDs.add(gzdName);

        const request: Generate100kmRequest = {
          gzd: gzdName,
          zone: feature.properties.zone,
          band: feature.properties.band,
          hemisphere: feature.properties.band >= 'N' ? 'N' : 'S',
          bounds: coords,
        };

        getWorkerPool().requestGenerate100km(request, (response: Generate100kmResponse) => {
          this.squares100kmCache.set(response.gzd, response.features);
          this.pendingGZDs.delete(response.gzd);
          this.setNeedsUpdate();
        });
      }
    }

    return allFeatures;
  }

  /**
   * Get visible 10km grid features from the cache, and request generation
   * for any visible 100km squares not yet in the cache.
   */
  private getVisible10kmGrids(visible100kmSquares: MGRSSquareFeature[]): MGRSSquareFeature[] {
    const allFeatures: MGRSSquareFeature[] = [];
    const viewport = this.context.viewport;
    if (!viewport) return [];

    let viewWest: number, viewSouth: number, viewEast: number, viewNorth: number;
    try {
      const bounds = (viewport as any).getBounds();
      // Handle both [minX, minY, maxX, maxY] and [[minX, minY], [maxX, maxY]] formats
      if (Array.isArray(bounds[0])) {
        viewWest = bounds[0][0];
        viewSouth = bounds[0][1];
        viewEast = bounds[1][0];
        viewNorth = bounds[1][1];
      } else {
        viewWest = bounds[0];
        viewSouth = bounds[1];
        viewEast = bounds[2];
        viewNorth = bounds[3];
      }
    } catch (e) {
      console.error('[MGRSLayer] Error getting viewport bounds in getVisible10kmGrids:', e);
      return [];
    }

    for (const square of visible100kmSquares) {
      // Check if square is actually visible in current viewport
      // visible100kmSquares contains all squares for visible GZDs, so some might be off-screen
      /* 
      if (!bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth)) {
         continue;
      }
      */

      const squareId = square.properties.id; // e.g. "18SUJ"

      if (this.grid10kmCache.has(squareId)) {
        allFeatures.push(...this.grid10kmCache.get(squareId)!);
        continue;
      }

      if (!this.pending10kmSquares.has(squareId)) {
        console.log(`[DEBUG] Requesting 10km grid for ${squareId}`);
        this.pending10kmSquares.add(squareId);

        // Determine zone and hemisphere from the MGRS ID, NOT the GZD property.
        // This is crucial because squares near zone boundaries might be generated by the neighbor GZD's logic
        // (e.g. 04N generator finding an 05QKB square), but they MUST be generated using their own zone's projection.
        const match = squareId.match(/^(\d{2})([A-Z])/);
        if (!match) {
          console.warn(`[MGRSLayer] Invalid MGRS ID format: ${squareId}`);
          continue;
        }

        const zone = parseInt(match[1], 10);
        // Band alone doesn't tell us hemisphere, we fallback to GZD for that if needed, 
        // but wait: band letters N-X are North, C-M are South.
        const band = match[2];
        const hemisphere: 'N' | 'S' = band >= 'N' ? 'N' : 'S';

        const request: Generate10kmRequest = {
          squareId,
          zone,
          hemisphere,
          bounds: square.geometry.coordinates,
        };

        getWorkerPool().requestGenerate10km(
          request,
          (response: Generate10kmResponse) => {
            if (response.squareId.startsWith('05QK')) {
              console.log(`[MGRSLayer] Received 10km response for ${response.squareId}: ${response.features.length} features`);
              if (response.features.length > 0) {
                 console.log(`[MGRSLayer] First feature coords for ${response.squareId}:`, JSON.stringify(response.features[0].geometry.coordinates));
              }
            }
            this.grid10kmCache.set(response.squareId, response.features);
            this.pending10kmSquares.delete(response.squareId);
            this.setNeedsUpdate();
          },
          (_error: string) => {
            // Clean up pending state so the square can be retried on next render
            this.pending10kmSquares.delete(squareId);
          }
        );
      }
    }

    return allFeatures;
  }

  shouldUpdateState({ changeFlags }: any) {
    return changeFlags.viewportChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  renderLayers() {
    const {
      visible,
      opacity,
      gzdLineColor,
      gzdLineWidth,
      grid100kmLineColor,
      grid100kmLineWidth,
      grid10kmLineColor,
      grid10kmLineWidth,
      labelFontFamily,
      labelFontSize,
      labelColor,
      labelBackgroundColor,
      showLabels
    } = this.props;

    if (!visible) return [];

    const layers = [];

    // Get current zoom from context
    const zoom = this.context.viewport?.zoom || 0;
    console.log(`[DEBUG] renderLayers: zoom=${zoom}, gzdData=${!!this.gzdData}`);

    // GZD layer - visible at low zoom levels (< 7)
    if (this.gzdData && zoom < 7) {
      layers.push(
        new GeoJsonLayer({
          id: `${this.props.id}-gzd`,
          data: this.gzdData,
          visible: true,
          opacity,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: gzdLineWidth,
          getLineColor: gzdLineColor,
          pickable: true,
          updateTriggers: {
            getLineWidth: gzdLineWidth,
            getLineColor: gzdLineColor
          }
        })
      );
    }

    // Generate 100km squares whenever zoom >= 5 (needed by 10km grid too)
    let features100km: MGRSSquareFeature[] = [];
    if (this.gzdData && zoom >= 5) {
      features100km = this.getVisible100kmSquares();
      console.log(`[DEBUG] Got ${features100km.length} 100km features. IDs:`, features100km.map(f => f.properties.id).join(', '));
    }

    // Render 100km squares at zoom 5-12
    if (features100km.length > 0 && zoom >= 5 && zoom < 13) {
      const featureCollection = {
        type: 'FeatureCollection' as const,
        features: features100km,
      };

      layers.push(
        new GeoJsonLayer({
          id: `${this.props.id}-100km-squares`,
          data: featureCollection,
          visible: true,
          opacity,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: grid100kmLineWidth,
          getLineColor: grid100kmLineColor,
          pickable: true,
          updateTriggers: {
            getLineWidth: grid100kmLineWidth,
            getLineColor: grid100kmLineColor,
            data: features100km.length,
          }
        })
      );

      if (showLabels) layers.push(
        new TextLayer({
          id: `${this.props.id}-100km-labels`,
          data: features100km,
          getPosition: (d: MGRSSquareFeature) => getBottomLeftPosition(d.geometry.coordinates),
          getText: (d: MGRSSquareFeature) => d.properties.id,
          getSize: labelFontSize,
          getColor: labelColor,
          getBackgroundColor: labelBackgroundColor,
          background: true,
          backgroundPadding: [3, 2],
          fontFamily: labelFontFamily,
          getTextAnchor: 'start' as const,
          getAlignmentBaseline: 'bottom' as const,
          pickable: false,
          updateTriggers: {
            getSize: labelFontSize,
            getColor: labelColor,
            getBackgroundColor: labelBackgroundColor,
            data: features100km.length,
          }
        })
      );
    }

    // 10km grid - visible at zoom >= 8
    if (zoom >= 8 && features100km.length > 0) {
      let features10km = this.getVisible10kmGrids(features100km);
      console.log(`[DEBUG] renderLayers: Passing ${features10km.length} 10km features to Deck.gl`);
      
      if (features10km.length > 0) {
        const featureCollection10km = {
          type: 'FeatureCollection' as const,
          features: features10km,
        };

        layers.push(
          new GeoJsonLayer({
            id: `${this.props.id}-10km-grid`,
            data: featureCollection10km,
            visible: true,
            opacity,
            stroked: true,
            filled: false,
            lineWidthUnits: 'pixels',
            getLineWidth: grid10kmLineWidth,
            getLineColor: grid10kmLineColor,
            pickable: true,
            updateTriggers: {
              getLineWidth: grid10kmLineWidth,
              getLineColor: grid10kmLineColor,
              data: features10km.length,
            }
          })
        );

        if (showLabels) layers.push(
          new TextLayer({
            id: `${this.props.id}-10km-labels`,
            data: features10km,
            getPosition: (d: MGRSSquareFeature) => getBottomLeftPosition(d.geometry.coordinates),
            getText: (d: MGRSSquareFeature) => d.properties.id,
            getSize: labelFontSize,
            getColor: labelColor,
            getBackgroundColor: labelBackgroundColor,
            background: true,
            backgroundPadding: [3, 2],
            fontFamily: labelFontFamily,
            getTextAnchor: 'start' as const,
            getAlignmentBaseline: 'bottom' as const,
            pickable: false,
            updateTriggers: {
              getSize: labelFontSize,
              getColor: labelColor,
              getBackgroundColor: labelBackgroundColor,
              data: features10km.length,
            }
          })
        );
      }
    }

    return layers;
  }
}

export default MGRSLayer;
