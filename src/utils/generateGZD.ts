/**
 * Generate GZD (Grid Zone Designator) boundaries
 * GZDs are 6° wide (longitude) × 8° tall (latitude) zones
 * Latitude bands: C-X (omitting I and O), from 80°S to 84°N
 * Longitude zones: 1-60, from 180°W to 180°E
 */

export interface GZDFeature {
  type: 'Feature';
  properties: {
    gzd: string;
    zone: string;
    band: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface GZDGeoJSON {
  type: 'FeatureCollection';
  features: GZDFeature[];
}

const LATITUDE_BANDS = 'CDEFGHJKLMNPQRSTUVWX';

export function generateGZDGeoJSON(): GZDGeoJSON {
  const features: GZDFeature[] = [];

  // UTM zones: 1-60, each 6° wide
  for (let zone = 1; zone <= 60; zone++) {
    const west = (zone - 1) * 6 - 180;
    const east = zone * 6 - 180;

    // Latitude bands (8° each, except X which is 12°)
    for (let i = 0; i < LATITUDE_BANDS.length; i++) {
      const band = LATITUDE_BANDS[i];
      const south = -80 + i * 8;
      let north = south + 8;

      // Band X extends to 84°N instead of 80°N
      if (band === 'X') {
        north = 84;
      }

      // Skip Antarctica (below 80°S) and Arctic (above 84°N)
      if (south < -80 || north > 84) continue;

      // MGRS EXCEPTIONS
      
      // 1. Norway Exception (Band V, 56°N-64°N):
      //    Zone 31V extends east to 9°E (covers western half of what would be 32V)
      //    Zone 32V doesn't exist
      if (band === 'V') {
        if (zone === 31) {
          // Zone 31V: 0°E to 9°E (extended 3° east)
          features.push({
            type: 'Feature',
            properties: { gzd: '31V', zone: 31, band: 'V' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, south], [9, south], [9, north], [0, north], [0, south]]]
            }
          });
          continue;
        } else if (zone === 32) {
          // Zone 32V doesn't exist - skip it
          continue;
        }
      }

      // 2. Svalbard Exception (Band X, 72°N-84°N):
      //    Zones are irregular widths, many zones don't exist
      if (band === 'X') {
        // Zones 31X, 32X don't exist
        if (zone === 31 || zone === 32) continue;
        
        // Zone 33X: 0°E to 12°E (covers what would be 31X and normal 33X)
        if (zone === 33) {
          features.push({
            type: 'Feature',
            properties: { gzd: '33X', zone: 33, band: 'X' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, south], [12, south], [12, north], [0, north], [0, south]]]
            }
          });
          continue;
        }
        
        // Zone 34X doesn't exist
        if (zone === 34) continue;
        
        // Zone 35X: 12°E to 24°E (covers what would be normal 33X and 35X)
        if (zone === 35) {
          features.push({
            type: 'Feature',
            properties: { gzd: '35X', zone: 35, band: 'X' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[12, south], [24, south], [24, north], [12, north], [12, south]]]
            }
          });
          continue;
        }
        
        // Zone 36X doesn't exist
        if (zone === 36) continue;
        
        // Zone 37X: 24°E to 36°E (covers what would be normal 35X and 37X)
        if (zone === 37) {
          features.push({
            type: 'Feature',
            properties: { gzd: '37X', zone: 37, band: 'X' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[24, south], [36, south], [36, north], [24, north], [24, south]]]
            }
          });
          continue;
        }
      }

      // Standard GZD (no exceptions)
      const gzd = `${zone}${band}`;

      features.push({
        type: 'Feature',
        properties: {
          gzd,
          zone,
          band
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south]
          ]]
        }
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features
  };
}
