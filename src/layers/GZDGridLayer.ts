/**
 * GZD Grid Layer - Renders MGRS Grid Zone Designator boundaries
 * Visible at zoom < 7
 */

import { CompositeLayer } from '@deck.gl/core';
import { GeoJsonLayer } from '@deck.gl/layers';
import type { GZDGeoJSON } from '../utils/generateGZD';
import type { MGRSLayerProps } from '../types/mgrs';

export class GZDGridLayer extends CompositeLayer<MGRSLayerProps> {
  static layerName = 'GZDGridLayer';

  private gzdData: GZDGeoJSON | null = null;
  private gzdLoadError: boolean = false;

  initializeState() {
    this.loadGZDData();
  }

  private async loadGZDData() {
    if (this.gzdData || this.gzdLoadError) return;

    try {
      console.log('[GZDGridLayer] Loading GZD data from /gzds.json');
      const response = await fetch('/gzds.json');
      if (!response.ok) throw new Error(`Failed to load GZD data: ${response.status}`);
      this.gzdData = await response.json();
      console.log('[GZDGridLayer] GZD data loaded:', this.gzdData!.features?.length, 'features');
      this.setNeedsUpdate();
    } catch (error) {
      console.error('[GZDGridLayer] Error loading GZD data:', error);
      this.gzdLoadError = true;
    }
  }

  renderLayers() {
    const { visible, opacity, gzdLineColor, gzdLineWidth } = this.props;

    if (!visible || !this.gzdData) return [];

    return [
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
    ];
  }
}
