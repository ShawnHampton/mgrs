import { CompositeLayer, type UpdateParameters } from '@deck.gl/core';
import { PathLayer, TextLayer } from '@deck.gl/layers';
import { Grids, GridType, GridZones } from '@ngageoint/mgrs-js';
import { DEFAULT_STYLES, type GridStyleConfig, type MGRSLayerProps } from '../types/types';
import { getZoneData, type LabelData, type LineData } from '../utils/mgrs-helpers';
import { getViewportBounds } from '../utils/viewport-utils';

// ... (GRID_TYPE_TO_STYLE map) ...

// ... (Interfaces LineData and LabelData are now imported, so remove them locally) ...
// Actually, I should remove the local interface definitions if I import them.

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
    // Create Grids with all types - we control which render based on zoom
    this.grids = Grids.create();
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
    const bounds = getViewportBounds(viewport);
    if (!bounds) return [];

    // Get grid zones that intersect the viewport
    const gridRange = GridZones.getGridRange(bounds);
    const zones = Array.from(gridRange);

    // Define which grid types to show at which zoom levels
    const gridConfigs: { type: GridType; minZoom: number; maxZoom: number }[] = [
      { type: GridType.GZD, minZoom: 0, maxZoom: 20 },
      { type: GridType.HUNDRED_KILOMETER, minZoom: 4, maxZoom: 20 },
      { type: GridType.TEN_KILOMETER, minZoom: 8, maxZoom: 20 },
      { type: GridType.KILOMETER, minZoom: 11, maxZoom: 20 },
    ];

    // Process each grid type active at this zoom
    for (const config of gridConfigs) {
      if (zoom < config.minZoom || zoom > config.maxZoom) continue;

      const grid = this.grids.getGrid(config.type);
      if (!grid) continue;

      for (const zone of zones) {
        const zoneData = getZoneData(grid, zone, bounds, zoom, config.type, !!this.props.showLabels);
        lines.push(...zoneData.lines);
        labels.push(...zoneData.labels);
      }
    }

    return this.createSubLayers(lines, labels);
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
  
  // getViewportBounds moved to utility

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


