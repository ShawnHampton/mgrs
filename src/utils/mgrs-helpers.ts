import { Grid, GridType, GridZone } from '@ngageoint/mgrs-js';
import { Bounds } from '@ngageoint/grid-js';

export interface LineData {
  path: [number, number][];
  gridType: GridType;
}

export interface LabelData {
  position: [number, number];
  text: string;
  gridType: GridType;
}

/**
 * Generates grid lines and labels for a specific MGRS Zone within the viewport.
 * Handles boundary clipping and precision issues.
 */
export function getZoneData(
  grid: Grid,
  zone: GridZone,
  viewportBounds: Bounds,
  zoom: number,
  gridType: GridType,
  showLabels: boolean
): { lines: LineData[]; labels: LabelData[] } {
  const result = {
    lines: [] as LineData[],
    labels: [] as LabelData[],
  };

  try {
    const gridLines = grid.getLines(zoom, zone, viewportBounds);
    console.log('gridLines', zone,gridLines);
    if (gridLines) {
      for (const line of gridLines) {
        const point1 = line.getPoint1();
        const point2 = line.getPoint2();
        if (point1 && point2) {
          result.lines.push({
            path: [
              [point1.getLongitude(), point1.getLatitude()],
              [point2.getLongitude(), point2.getLatitude()]
            ],
            gridType,
          });
        }
      }
    }

    // Get labels for this zone
    if (showLabels) {
      const gridLabels = grid.getLabels(zoom, zone, viewportBounds);
      if (gridLabels) {
        for (const label of gridLabels) {
          const center = label.getCenter();
          if (center) {
            result.labels.push({
              position: [center.getLongitude(), center.getLatitude()],
              text: label.getName() || '',
              gridType,
            });
          }
        }
      }
    }
  } catch (e) {
    // Skip zones that cause errors (e.g., polar regions)
    console.warn(`Error processing zone ${zone.getName()}:`, e);
  }

  return result;
}
