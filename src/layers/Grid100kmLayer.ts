/**
 * 100km Grid Layer - Renders 100km MGRS squares from store
 * Visible at zoom 5-12
 * 
 * This layer only renders what's in the store - ViewportManager handles data population
 */

import { CompositeLayer, Layer } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { MGRSLayerProps, MGRSSquareFeature } from '../types/mgrs';
import { getBottomLeftPosition } from '../utils/viewportUtils';
import { useMGRSStore } from '../store/mgrsStore';
import { getViewportManager } from '../utils/viewportManager';

export class Grid100kmLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'Grid100kmLayer';

  shouldUpdateState({ changeFlags }: any) {
    // Trigger viewport manager on viewport changes
    if (changeFlags.viewportChanged && this.context.viewport) {
      getViewportManager().onViewportChange(this.context.viewport);
    }
    return changeFlags.viewportChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  renderLayers() {
    const {
      visible,
      opacity,
      grid100kmLineColor,
      grid100kmLineWidth,
      labelFontFamily,
      labelFontSize,
      labelColor,
      labelBackgroundColor,
      showLabels
    } = this.props;

    if (!visible) return [];

    // Get visible squares directly from store (computed by ViewportManager)
    const features100km = useMGRSStore.getState().visible100kmSquares;
    if (features100km.length === 0) return [];

    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: features100km,
    };

    const layers: Layer[] = [
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
    ];

    if (showLabels) {
      layers.push(
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

    return layers;
  }
}
