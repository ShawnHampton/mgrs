/**
 * MGRS Layer - Deck.gl Composite Layer
 *
 * Orchestrates MGRS grid rendering at multiple resolutions:
 * - GZD boundaries at zoom < 7
 * - 100km squares at zoom 5-12
 * - 10km grid at zoom >= 8
 */

import { CompositeLayer } from '@deck.gl/core';
import type { MGRSLayerProps } from '../types/mgrs';
import type { GZDGeoJSON } from '../utils/generateGZD';
import { GZDGridLayer } from './GZDGridLayer';
import { Grid100kmLayer } from './Grid100kmLayer';
import { Grid10kmLayer } from './Grid10kmLayer';
import { DEFAULT_PROPS } from './layerConfig';

export class MGRSLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'MGRSLayer';
  static defaultProps = DEFAULT_PROPS;

  private gzdData: GZDGeoJSON | null = null;
  private gzdLoadError: boolean = false;

  initializeState() {
    this.loadGZDData();
    this.setState({ visible100kmSquares: [] });
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

  shouldUpdateState({ changeFlags }: any) {
    return changeFlags.viewportChanged || changeFlags.propsChanged || changeFlags.stateChanged;
  }

  renderLayers() {
    if (!this.props.visible || !this.gzdData) return [];

    const zoom = this.context.viewport?.zoom || 0;
    const layers = [];

    // GZD layer - visible at zoom < 7
    if (zoom < 7) {
      layers.push(
        new GZDGridLayer({
          ...this.props,
          id: `${this.props.id}-gzd-layer`,
        })
      );
    }

    // 100km layer - visible at zoom 5-12
    // Also renders at zoom >= 8 to provide data for 10km layer
    if (zoom >= 5) {
      layers.push(
        new Grid100kmLayer({
          ...this.props,
          id: `${this.props.id}-100km-layer`,
          gzdData: this.gzdData,
          visible: zoom < 13, // Only visible rendering below zoom 13
        })
      );
    }

    // 10km layer - visible at zoom >= 8
    if (zoom >= 8) {
      layers.push(
        new Grid10kmLayer({
          ...this.props,
          id: `${this.props.id}-10km-layer`,
          gzdData: this.gzdData, // Pass gzdData so it can get 100km squares
        })
      );
    }

    return layers;
  }
}

export default MGRSLayer;
