/**
 * 10km Grid Layer - Renders 10km MGRS grid cells from store
 * Visible at zoom >= 8
 * 
 * This layer only renders what's in the store - ViewportManager handles data population
 */

import { CompositeLayer, Layer } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { MGRSLayerProps, MGRSSquareFeature } from '../types/mgrs';
import { getBottomLeftPosition } from '../utils/viewportUtils';
import { useMGRSStore } from '../store/mgrsStore';

export class Grid10kmLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'Grid10kmLayer';

  shouldUpdateState({ changeFlags }: any) {
    return changeFlags.viewportChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  renderLayers() {
    const {
      visible,
      opacity,
      grid10kmLineColor,
      grid10kmLineWidth,
      labelFontFamily,
      labelFontSize,
      labelColor,
      labelBackgroundColor,
      showLabels
    } = this.props;

    if (!visible) return [];

    // Get visible grids directly from store (computed by ViewportManager)
    const features10km = useMGRSStore.getState().visible10kmGrids;
    if (features10km.length === 0) return [];

    const featureCollection10km = {
      type: 'FeatureCollection' as const,
      features: features10km,
    };

    const layers: Layer[] = [
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
    ];

    if (showLabels) {
      layers.push(
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

    return layers;
  }
}
