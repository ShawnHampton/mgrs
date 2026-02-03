/**
 * 10km Grid Layer - Renders 10km MGRS grid cells from store
 * Visible at zoom >= 8
 *
 * Reads directly from the store's append-only all10kmFeatures array.
 */

import { CompositeLayer, Layer } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { MGRSLayerProps, MGRSSquareFeature } from '../types/mgrs';
import { getBottomLeftPosition } from '../utils/viewportUtils';
import { useMGRSStore } from '../store/mgrsStore';
import { DEFAULT_PROPS } from './layerConfig';

export class Grid10kmLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'Grid10kmLayer';
  static defaultProps = DEFAULT_PROPS;

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

    // Read directly from the append-only flat array — filtered to 05QKB only for debugging
    const allFeatures = useMGRSStore.getState().all10kmFeatures;
    
    // DEBUG: Log first feature to see what we have
    if (allFeatures.length > 0) {
      console.log(`[Grid10kmLayer] First feature props:`, JSON.stringify(allFeatures[0].properties));
    }
    
    const features10km = allFeatures.filter(f => f.properties.gzd === '05Q' && f.properties.id.startsWith('05QKB'));
    console.log(`[Grid10kmLayer] all=${allFeatures.length}, 05QKB=${features10km.length}`);
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
