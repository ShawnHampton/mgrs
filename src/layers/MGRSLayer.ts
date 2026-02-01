/**
 * MGRS Layer - Deck.gl Composite Layer
 *
 * Renders MGRS grid at multiple resolutions:
 * - Static GeoJSON layer for GZD boundaries at low zoom
 * - Dynamic GZD-based 100km squares generated on demand (zoom 7-9)
 * - Dynamic tile-based grid for 10km/1km/100m (zoom >= 10)
 */

import { CompositeLayer, type DefaultProps } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import type {
  MGRSLayerProps,
  MGRSSquareFeature,
  GridLine,
  GridLabel,
  TileRequest,
  TileResponse,
  Generate100kmRequest,
  Generate100kmResponse,
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
  grid10kmLineColor: [34, 197, 94, 160],   // Green-500
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
  private queue: Array<{
    request: TileRequest;
    resolve: (response: TileResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  private busy: Set<Worker> = new Set();
  private generate100kmCallbacks: Map<string, (response: Generate100kmResponse) => void> = new Map();

  constructor(size: number = 4) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(
        new URL('../workers/mgrs.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (event) => {
        const { type, payload } = event.data;

        if (type === 'generate-100km-result') {
          // Handle 100km generation response
          const result = payload as Generate100kmResponse;
          const callback = this.generate100kmCallbacks.get(result.gzd);
          if (callback) {
            callback(result);
            this.generate100kmCallbacks.delete(result.gzd);
          }
          this.busy.delete(worker);
          this.processQueue();
          return;
        }

        this.busy.delete(worker);

        // Process next in queue
        this.processQueue();

        // Handle current response
        const pending = this.queue.shift();
        if (pending) {
          if (type === 'error') {
            pending.reject(new Error(payload));
          } else {
            pending.resolve(payload);
          }
        }
      };

      this.workers.push(worker);
    }
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    const availableWorker = this.workers.find(w => !this.busy.has(w));
    if (!availableWorker) return;

    const task = this.queue[0];
    this.busy.add(availableWorker);
    availableWorker.postMessage({ type: 'request', payload: task.request });
  }

  async getTileData(request: TileRequest): Promise<TileResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      this.processQueue();
    });
  }

  requestGenerate100km(request: Generate100kmRequest, callback: (response: Generate100kmResponse) => void) {
    this.generate100kmCallbacks.set(request.gzd, callback);
    // Find an available worker or use round-robin
    const availableWorker = this.workers.find(w => !this.busy.has(w)) || this.workers[0];
    if (availableWorker) {
      this.busy.add(availableWorker);
      availableWorker.postMessage({ type: 'generate-100km', payload: request });
    }
  }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.queue = [];
    this.generate100kmCallbacks.clear();
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
      viewWest = bounds[0];
      viewSouth = bounds[1];
      viewEast = bounds[2];
      viewNorth = bounds[3];
    } catch {
      return [];
    }

    const allFeatures: MGRSSquareFeature[] = [];

    for (const feature of this.gzdData.features) {
      const gzdName = feature.properties.gzd || `${feature.properties.zone}${feature.properties.band}`;
      const coords = feature.geometry.coordinates;

      // Simple bbox test
      if (!bboxIntersects(coords, viewWest, viewSouth, viewEast, viewNorth)) {
        continue;
      }

      // If cached, use cached features
      if (this.squares100kmCache.has(gzdName)) {
        allFeatures.push(...this.squares100kmCache.get(gzdName)!);
        continue;
      }

      // If not pending, send generation request
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
          this.squares100kmCache.set(response.gzd, response.features);
          this.pendingGZDs.delete(response.gzd);
          this.setNeedsUpdate();
        });
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
      grid1kmLineColor,
      grid1kmLineWidth,
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

    // Dynamic 100km squares - visible at zoom 5-9
    if (this.gzdData && zoom >= 5 && zoom < 10) {
      const features100km = this.getVisible100kmSquares();

      if (features100km.length > 0) {
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
              // Trigger re-render when features change
              data: features100km.length,
            }
          })
        );

        // Labels for 100km squares
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
    }

    // Dynamic grid tile layer - visible at zoom >= 10 (10km, 1km, 100m only)
    if (zoom >= 10) {
      layers.push(
        new TileLayer({
          id: `${this.props.id}-grid-tiles`,
          visible: true,
          opacity,
          minZoom: 10,
          maxZoom: 19,
          tileSize: 256,

          getTileData: async (tile: { x: number; y: number; z: number }) => {
            const request: TileRequest = {
              x: tile.x,
              y: tile.y,
              z: tile.z,
              zoom: tile.z
            };

            try {
              return await getWorkerPool().getTileData(request);
            } catch {
              return { lines: [], labels: [] };
            }
          },

          renderSubLayers: (props: {
            id: string;
            data: TileResponse;
            tile: { zoom: number }
          }) => {
            const { data, tile } = props;
            if (!data || !data.lines) return null;

            const tileZoom = tile.zoom;

            const getLineColor = (line: GridLine) => {
              switch (line.level) {
                case '10km': return grid10kmLineColor;
                case '1km': return grid1kmLineColor;
                case '100m': return grid1kmLineColor;
                default: return grid10kmLineColor;
              }
            };

            const getLineWidth = (line: GridLine) => {
              switch (line.level) {
                case '10km': return grid10kmLineWidth;
                case '1km': return grid1kmLineWidth;
                case '100m': return grid1kmLineWidth! * 0.6;
                default: return grid10kmLineWidth;
              }
            };

            return [
              // Grid lines
              new PathLayer({
                id: `${props.id}-lines`,
                data: data.lines,
                getPath: (d: GridLine) => [d.start, d.end],
                getColor: getLineColor,
                getWidth: getLineWidth,
                widthUnits: 'pixels',
                pickable: false,
                updateTriggers: {
                  getColor: [grid10kmLineColor, grid1kmLineColor],
                  getWidth: [grid10kmLineWidth, grid1kmLineWidth]
                }
              }),

              // Labels
              showLabels && tileZoom >= 10 && new TextLayer({
                id: `${props.id}-labels`,
                data: data.labels.filter((l: GridLabel) => {
                  if (tileZoom >= 10 && tileZoom < 13 && l.level !== '10km') return false;
                  return true;
                }),
                getPosition: (d: GridLabel) => d.position,
                getText: (d: GridLabel) => d.text,
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
                  getBackgroundColor: labelBackgroundColor
                }
              })
            ].filter(Boolean);
          }
        })
      );
    }

    return layers;
  }
}

export default MGRSLayer;
