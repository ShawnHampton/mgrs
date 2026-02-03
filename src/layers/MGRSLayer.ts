import { CompositeLayer, type UpdateParameters, type Viewport } from '@deck.gl/core';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import { Grids, GridZones, GridType, type GridZone, type Grid } from '@ngageoint/mgrs-js';
import { Bounds } from '@ngageoint/grid-js';
import { DEFAULT_STYLES, type MGRSLayerProps, type GridStyleConfig } from '../types/types';

// Map GridType enum to style keys
const GRID_TYPE_TO_STYLE: Record<GridType, string> = {
  [GridType.GZD]: 'GZD',
  [GridType.HUNDRED_KILOMETER]: 'HUNDRED_KILOMETER',
  [GridType.TEN_KILOMETER]: 'TEN_KILOMETER',
  [GridType.KILOMETER]: 'KILOMETER',
  [GridType.HUNDRED_METER]: 'HUNDRED_METER',
  [GridType.TEN_METER]: 'TEN_METER',
  [GridType.METER]: 'METER',
};

interface LineData {
  path: [number, number][];
  gridType: GridType;
}

interface LabelData {
  position: [number, number];
  text: string;
  gridType: GridType;
}

const defaultProps: Partial<MGRSLayerProps> = {
  showLabels: true,
};

/**
 * MGRSLayer - Renders MGRS grid lines and labels using mgrs-js
 * 
 * Phase 1: GZD (Grid Zone Designator) boundaries
 */
export class MGRSLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'MGRSLayer';
  static defaultProps = defaultProps;

  private grids: Grids | null = null;

  initializeState(): void {
    // Use createGZD() factory - it's pre-configured for GZD only
    // Don't call any configuration methods as they cause TreeMap iterator errors
    this.grids = Grids.createGZD();
    console.log('MGRSLayer: Initialized with createGZD()');
  }

  shouldUpdateState({ changeFlags }: UpdateParameters<this>): boolean {
    return Boolean(changeFlags.viewportChanged || changeFlags.propsChanged);
  }

  renderLayers() {
    const { viewport } = this.context;
    if (!viewport || !this.grids) return [];

    const zoom = Math.floor(viewport.zoom);
    const lines: LineData[] = [];
    const labels: LabelData[] = [];

    // Get viewport bounds
    const bounds = this.getViewportBounds(viewport);
    if (!bounds) {
      console.warn('MGRSLayer: No bounds available');
      return [];
    }

    // Get grids active at this zoom level
    const zoomGrids = this.grids.getGrids(zoom);
    if (!zoomGrids || !zoomGrids.hasGrids()) {
      console.warn(`MGRSLayer: No grids active at zoom ${zoom}`);
      return [];
    }

    // Get grid zones that intersect the viewport
    const gridRange = GridZones.getGridRange(bounds);
    const zones = Array.from(gridRange);

    // Get the specific GZD grid directly (more reliable than iterating TreeSet)
    const gzdGrid = this.grids.getGrid(GridType.GZD);
    if (!gzdGrid) {
      console.warn('MGRSLayer: GZD grid not found');
      return [];
    }

    // Check if GZD is active at this zoom
    if (!gzdGrid.isWithin(zoom)) {
      console.log(`MGRSLayer: GZD not active at zoom ${zoom}`);
      return [];
    }

    console.log(`MGRSLayer: zoom=${zoom}, zones=${zones.length}, processing GZD grid`);

    // Process all GZD zones
    for (const zone of zones) {
      this.processZone(gzdGrid, zone, bounds, zoom, GridType.GZD, lines, labels);
    }

    console.log(`MGRSLayer: Generated ${lines.length} lines, ${labels.length} labels`);
    return this.createSubLayers(lines, labels);
  }

  private processZone(
    grid: Grid,
    zone: GridZone,
    bounds: Bounds,
    zoom: number,
    gridType: GridType,
    lines: LineData[],
    labels: LabelData[]
  ): void {
    try {
      // Get lines for this zone and bounds
      const gridLines = grid.getLinesFromBounds(bounds, zone);
      console.log(`Zone ${zone.getName()}: gridLines=${gridLines ? gridLines.length : 'null'}`);
      if (gridLines) {
        for (const line of gridLines) {
          const point1 = line.getPoint1();
          const point2 = line.getPoint2();
          if (point1 && point2) {
            lines.push({
              path: [
                [point1.getLongitude(), point1.getLatitude()],
                [point2.getLongitude(), point2.getLatitude()],
              ],
              gridType,
            });
          }
        }
      }

      // Get labels for this zone
      if (this.props.showLabels) {
        const gridLabels = grid.getLabels(zoom, zone, bounds);
        if (gridLabels) {
          for (const label of gridLabels) {
            const center = label.getCenter();
            if (center) {
              labels.push({
                position: [center.getLongitude(), center.getLatitude()],
                text: label.getName() || '',
                gridType,
              });
            }
          }
        }
      }
    } catch (e) {
      // Skip zones that cause errors (e.g., polar regions)
      console.warn(`Error processing zone ${zone.getName()}:`, e);
    }
  }

  private createSubLayers(lines: LineData[], labels: LabelData[]) {
    const layers = [];

    // Path layer for grid lines
    if (lines.length > 0) {
      layers.push(
        new PathLayer({
          id: `${this.props.id}-lines`,
          data: lines,
          getPath: (d: LineData) => d.path,
          getColor: (d: LineData) => this.getLineColor(d.gridType),
          getWidth: (d: LineData) => this.getLineWidth(d.gridType),
          widthUnits: 'pixels',
          pickable: false,
        })
      );
    }

    // Text layer for labels
    if (labels.length > 0 && this.props.showLabels) {
      layers.push(
        new TextLayer({
          id: `${this.props.id}-labels`,
          data: labels,
          getPosition: (d: LabelData) => d.position,
          getText: (d: LabelData) => d.text,
          getColor: (d: LabelData) => this.getLabelColor(d.gridType),
          getSize: (d: LabelData) => this.getLabelSize(d.gridType),
          fontFamily: 'Monaco, monospace',
          fontWeight: 'bold',
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          pickable: false,
        })
      );
    }

    return layers;
  }

  private getViewportBounds(viewport: Viewport): Bounds | null {
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

      return Bounds.bounds(minLon, minLat, maxLon, maxLat);
    } catch {
      return null;
    }
  }

  private getStyle(gridType: GridType): GridStyleConfig {
    const styleKey = GRID_TYPE_TO_STYLE[gridType] || 'GZD';
    return DEFAULT_STYLES[styleKey] || DEFAULT_STYLES.GZD;
  }

  private getLineColor(gridType: GridType): [number, number, number, number] {
    const style = this.getStyle(gridType);
    return style.lineColor as [number, number, number, number];
  }

  private getLineWidth(gridType: GridType): number {
    return this.getStyle(gridType).lineWidth;
  }

  private getLabelColor(gridType: GridType): [number, number, number, number] {
    const style = this.getStyle(gridType);
    return (style.labelColor || style.lineColor) as [number, number, number, number];
  }

  private getLabelSize(gridType: GridType): number {
    return this.getStyle(gridType).labelSize || 12;
  }
}
