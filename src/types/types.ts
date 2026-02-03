import type { CompositeLayerProps, Color } from '@deck.gl/core';

/**
 * MGRS grid type styling configuration
 */
export interface GridStyleConfig {
  lineColor: Color;
  lineWidth: number;
  labelColor?: Color;
  labelSize?: number;
}

/**
 * Props for MGRSLayer
 */
export interface MGRSLayerProps extends CompositeLayerProps {
  /** Style for GZD grid (zoom 0-9) */
  gzdStyle?: Partial<GridStyleConfig>;
  /** Style for 100km grid (zoom 5-12) */
  hundredKmStyle?: Partial<GridStyleConfig>;
  /** Style for 10km grid (zoom 8-15) */
  tenKmStyle?: Partial<GridStyleConfig>;
  /** Style for 1km grid (zoom 11-17) */
  kilometerStyle?: Partial<GridStyleConfig>;
  /** Show labels */
  showLabels?: boolean;
}

/**
 * Default styles per grid type
 */
export const DEFAULT_STYLES: Record<string, GridStyleConfig> = {
  GZD: {
    lineColor: [239, 68, 68, 255],    // red-500
    lineWidth: 3,
    labelColor: [239, 68, 68, 255],
    labelSize: 14,
  },
  HUNDRED_KILOMETER: {
    lineColor: [59, 130, 246, 255],   // blue-500
    lineWidth: 2,
    labelColor: [59, 130, 246, 255],
    labelSize: 12,
  },
  TEN_KILOMETER: {
    lineColor: [34, 197, 94, 255],    // green-500
    lineWidth: 1.5,
    labelColor: [34, 197, 94, 255],
    labelSize: 10,
  },
  KILOMETER: {
    lineColor: [245, 158, 11, 180],   // amber-500
    lineWidth: 1,
    labelColor: [245, 158, 11, 255],
    labelSize: 8,
  },
};
