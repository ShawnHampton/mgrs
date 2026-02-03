import { CompositeLayer, type CompositeLayerProps } from '@deck.gl/core';
import { PolygonLayer } from '@deck.gl/layers';
import type { CellEntry } from '../types/types';

interface OverlayDatum {
  polygon: [number, number][];
  type: 'hovered' | 'selected';
}

export interface SelectionOverlayLayerProps extends CompositeLayerProps {
  hoveredCell: CellEntry | null;
  selectedCells: Map<string, CellEntry>;
}

export class SelectionOverlayLayer extends CompositeLayer<SelectionOverlayLayerProps> {
  static layerName = 'SelectionOverlayLayer';

  renderLayers() {
    const { hoveredCell, selectedCells } = this.props;
    const data: OverlayDatum[] = [];

    for (const cell of selectedCells.values()) {
      data.push({ polygon: cell.polygon.ring, type: 'selected' });
    }

    if (hoveredCell && !selectedCells.has(hoveredCell.mgrsId)) {
      data.push({ polygon: hoveredCell.polygon.ring, type: 'hovered' });
    }

    if (data.length === 0) return [];

    return [
      new PolygonLayer<OverlayDatum>({
        id: `${this.props.id}-polygons`,
        data,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) =>
          d.type === 'hovered'
            ? [255, 255, 255, 60]
            : [59, 130, 246, 80],
        getLineColor: (d) =>
          d.type === 'hovered'
            ? [255, 255, 255, 120]
            : [59, 130, 246, 160],
        stroked: true,
        filled: true,
        lineWidthMinPixels: 1,
        pickable: false,
      }),
    ];
  }
}
