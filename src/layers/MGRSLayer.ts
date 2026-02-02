/**
 * MGRS Layer - Deck.gl Composite Layer
 *
 * Orchestrates MGRS grid rendering at multiple resolutions:
 * - GZD boundaries at zoom < 7
 * - 100km squares at zoom 5-12
 * - 10km grid at zoom >= 8
 */

import { CompositeLayer } from '@deck.gl/core';
import { useMGRSStore } from '../store/mgrsStore';
import type { MGRSLayerProps } from '../types/mgrs';
import { GZDGridLayer } from './GZDGridLayer';
import { Grid100kmLayer } from './Grid100kmLayer';
import { Grid10kmLayer } from './Grid10kmLayer';
import { DEFAULT_PROPS } from './layerConfig';

export class MGRSLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'MGRSLayer';
  static defaultProps = DEFAULT_PROPS;

  initializeState() {
    this.loadGZDData();
  }

  private async loadGZDData() {
    const store = useMGRSStore.getState();

    // Only load if not already loaded or loading
    if (store.gzdData || store.gzdLoadError) return;

    try {
      console.log('[MGRSLayer] Loading GZD data from /gzds.json');
      const response = await fetch('/gzds.json');
      if (!response.ok) throw new Error(`Failed to load GZD data: ${response.status}`);
      const data = await response.json();
      console.log('[MGRSLayer] GZD data loaded:', data.features?.length, 'features');
      store.setGzdData(data);
      this.setNeedsUpdate();
    } catch (error) {
      console.error('[MGRSLayer] Error loading GZD data:', error);
      store.setGzdLoadError(true);
    }
  }

  shouldUpdateState({ changeFlags }: any) {
    return changeFlags.viewportChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  renderLayers() {
    const store = useMGRSStore.getState();

    if (!this.props.visible || !store.gzdData) return [];

    const zoom = this.context.viewport?.zoom || 0;
    const layers = [];

    // 10km layer - visible at zoom >= 8
    if (zoom >= 8) {
      layers.push(
        new Grid10kmLayer({
          ...this.props,
          id: `${this.props.id}-10km-layer`,
        })
      );
    }

    // 100km layer - visible at zoom 5-12
    if (zoom >= 5) {
      layers.push(
        new Grid100kmLayer({
          ...this.props,
          id: `${this.props.id}-100km-layer`,
          visible: zoom < 13, // Only visible rendering below zoom 13
        })
      );
    }

    // GZD layer - visible at zoom < 7
    if (zoom < 7) {
      layers.push(
        new GZDGridLayer({
          ...this.props,
          id: `${this.props.id}-gzd-layer`,
        })
      );
    }

    return layers;
  }
}

export default MGRSLayer;
