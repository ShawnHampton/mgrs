/**
 * MGRS Layer Configuration and Default Props
 */

import type { DefaultProps } from '@deck.gl/core';
import type { MGRSLayerProps } from '../types/mgrs';

export const DEFAULT_PROPS: DefaultProps<MGRSLayerProps> = {
  id: 'mgrs-layer',
  visible: true,
  opacity: 1,
  gzdLineWidth: 2,
  grid100kmLineWidth: 1.5,
  grid10kmLineWidth: 1,
  grid1kmLineWidth: 0.75,
  gzdLineColor: [239, 68, 68, 255],
  grid100kmLineColor: [59, 130, 246, 255],
  grid10kmLineColor: [255, 0, 255, 255],
  grid1kmLineColor: [251, 191, 36, 255],
  labelFontFamily: 'Monaco, monospace',
  labelFontSize: 11,
  labelColor: [255, 255, 255, 255],
  labelBackgroundColor: [15, 23, 42, 200],
  showLabels: false
};
