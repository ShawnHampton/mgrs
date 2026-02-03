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
    if (gridLines) {
      const zoneBounds = zone.getBounds();
      const minLon = zoneBounds.getMinLongitude();
      const maxLon = zoneBounds.getMaxLongitude();
      const epsilon = 0.000001;

      for (const line of gridLines) {
        const point1 = line.getPoint1();
        const point2 = line.getPoint2();
        if (point1 && point2) {
          let lon1 = point1.getLongitude();
          let lat1 = point1.getLatitude();
          let lon2 = point2.getLongitude();
          let lat2 = point2.getLatitude();

          // Check if line is completely outside
          if ((lon1 < minLon - epsilon && lon2 < minLon - epsilon) ||
              (lon1 > maxLon + epsilon && lon2 > maxLon + epsilon)) {
            continue;
          }

          // Clip Point 1
          if (lon1 < minLon) {
             lat1 = lat1 + (lat2 - lat1) * (minLon - lon1) / (lon2 - lon1);
             lon1 = minLon;
          } else if (lon1 > maxLon) {
             lat1 = lat1 + (lat2 - lat1) * (maxLon - lon1) / (lon2 - lon1);
             lon1 = maxLon;
          }

          // Clip Point 2
          if (lon2 < minLon) {
             lat2 = lat2 + (lat1 - lat2) * (minLon - lon2) / (lon1 - lon2);
             lon2 = minLon;
          } else if (lon2 > maxLon) {
             lat2 = lat2 + (lat1 - lat2) * (maxLon - lon2) / (lon1 - lon2);
             lon2 = maxLon;
          }

          result.lines.push({
            path: [
              [lon1, lat1],
              [lon2, lat2]
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
