/**
 * 100km Grid Layer - Renders 100km MGRS squares
 * Visible at zoom 5-12
 */

import { CompositeLayer, Layer } from '@deck.gl/core';
import { GeoJsonLayer, TextLayer } from '@deck.gl/layers';
import type { MGRSLayerProps, MGRSSquareFeature, Generate100kmRequest, Generate100kmResponse } from '../types/mgrs';
import type { GZDGeoJSON } from '../utils/generateGZD';
import { getWorkerPool } from '../utils/WorkerPool';
import { bboxIntersects, getBottomLeftPosition, getViewportBounds } from '../utils/viewportUtils';

interface Grid100kmLayerProps extends MGRSLayerProps {
  gzdData: GZDGeoJSON;
}

export class Grid100kmLayer extends CompositeLayer<Grid100kmLayerProps> {
  static layerName = 'Grid100kmLayer';

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

  shouldUpdateState({ changeFlags }: any) {
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

    const features100km = this.getVisible100kmSquares();
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
