/**
 * 10km Grid Layer - Renders 10km MGRS grid cells
 * Visible at zoom >= 8
 */

import { CompositeLayer, Layer } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { MGRSLayerProps, MGRSSquareFeature, Generate10kmRequest, Generate10kmResponse, Generate100kmRequest, Generate100kmResponse } from '../types/mgrs';
import type { GZDGeoJSON } from '../utils/generateGZD';
import { getWorkerPool } from '../utils/WorkerPool';
import { bboxIntersects, getBottomLeftPosition, getViewportBounds } from '../utils/viewportUtils';

interface Grid10kmLayerProps extends MGRSLayerProps {
  gzdData: GZDGeoJSON;
}

export class Grid10kmLayer extends CompositeLayer<Grid10kmLayerProps> {
  static layerName = 'Grid10kmLayer';

  private grid10kmCache: Map<string, MGRSSquareFeature[]> = new Map();
  private pending10kmSquares: Set<string> = new Set();
  private squares100kmCache: Map<string, MGRSSquareFeature[]> = new Map();
  private pendingGZDs: Set<string> = new Set();

  private getVisible100kmSquares(): MGRSSquareFeature[] {
    const { gzdData } = this.props;
    if (!gzdData) return [];

    const viewport = this.context.viewport;
    if (!viewport) return [];

    const bounds = getViewportBounds(viewport);
    if (!bounds) return [];

    const { viewWest, viewSouth, viewEast, viewNorth } = bounds;
    const allFeatures: MGRSSquareFeature[] = [];
    const processedGZDs = new Set<string>();

    for (const feature of gzdData.features) {
      const gzdName = feature.properties.gzd;
      
      if (processedGZDs.has(gzdName)) continue;
      processedGZDs.add(gzdName);

      const coords = feature.geometry.coordinates;
      if (!bboxIntersects(coords, viewWest, viewSouth, viewEast, viewNorth)) {
        continue;
      }

      if (this.squares100kmCache.has(gzdName)) {
        const cachedSquares = this.squares100kmCache.get(gzdName)!;
        for (const square of cachedSquares) {
          if (bboxIntersects(square.geometry.coordinates, viewWest, viewSouth, viewEast, viewNorth)) {
            allFeatures.push(square);
          }
        }
        continue;
      }

      if (!this.pendingGZDs.has(gzdName)) {
        this.pendingGZDs.add(gzdName);

        const request: Generate100kmRequest = {
          gzd: gzdName,
          zone: feature.properties.zone,
          band: feature.properties.band,
          hemisphere: feature.properties.band >= 'N' ? 'N' : 'S',
          bounds: coords,
        };

        getWorkerPool().requestGenerate100km(request, (response: Generate100kmResponse) => {
          this.squares100kmCache.set(response.gzd, response.features);
          this.pendingGZDs.delete(response.gzd);
          this.setNeedsUpdate();
        });
      }
    }

    return allFeatures;
  }

  private getVisible10kmGrids(): MGRSSquareFeature[] {
    const visible100kmSquares = this.getVisible100kmSquares();
    const allFeatures: MGRSSquareFeature[] = [];

    for (const square of visible100kmSquares) {
      const squareId = square.properties.id;

      if (this.grid10kmCache.has(squareId)) {
        allFeatures.push(...this.grid10kmCache.get(squareId)!);
        continue;
      }

      if (!this.pending10kmSquares.has(squareId)) {
        this.pending10kmSquares.add(squareId);

        const match = squareId.match(/^(\d{2})([A-Z])/);
        if (!match) {
          console.warn(`[Grid10kmLayer] Invalid MGRS ID format: ${squareId}`);
          continue;
        }

        const zone = parseInt(match[1], 10);
        const band = match[2];
        const hemisphere: 'N' | 'S' = band >= 'N' ? 'N' : 'S';

        const request: Generate10kmRequest = {
          squareId,
          zone,
          hemisphere,
          bounds: square.geometry.coordinates,
        };

        getWorkerPool().requestGenerate10km(
          request,
          (response: Generate10kmResponse) => {
            this.grid10kmCache.set(response.squareId, response.features);
            this.pending10kmSquares.delete(response.squareId);
            this.setNeedsUpdate();
          },
          (_error: string) => {
            this.pending10kmSquares.delete(squareId);
          }
        );
      }
    }

    return allFeatures;
  }

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

    const features10km = this.getVisible10kmGrids();
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
