/**
 * GZD Grid Layer - Renders MGRS Grid Zone Designator boundaries
 * Visible at zoom < 7
 */

import { CompositeLayer } from '@deck.gl/core';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { MGRSLayerProps } from '../types/mgrs';
import { useMGRSStore } from '../store/mgrsStore';
import { DEFAULT_PROPS } from './layerConfig';

export class GZDGridLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'GZDGridLayer';
  static defaultProps = DEFAULT_PROPS;

  renderLayers() {
    const { visible, opacity, gzdLineColor, gzdLineWidth } = this.props;
    const gzdData = useMGRSStore.getState().gzdData;

    if (!visible || !gzdData) return [];

    return [
      new GeoJsonLayer({
        id: `${this.props.id}-gzd`,
        data: gzdData,
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
    ];
  }
}
