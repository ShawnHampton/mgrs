import React from 'react';
import { Grids, GridType, GridZones } from '@ngageoint/mgrs-js';
import { Bounds, Unit } from '@ngageoint/grid-js';
import { getZoneData } from '../utils/mgrs-helpers';

// Helper to download a JSON file
const downloadFile = (data: object, filename: string) => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

interface ExportControlProps {
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
  };
  viewport: {
    width: number;
    height: number;
    unproject: (xy: [number, number]) => [number, number] | null;
  } | undefined;
}

export const ExportControl: React.FC<ExportControlProps> = ({ viewState, viewport }) => {

  const handleExport = () => {
    if (!viewport) return;

    try {
      // 1. Get current viewport bounds
      const nw = viewport.unproject([0, 0]);
      const se = viewport.unproject([viewport.width, viewport.height]);
      
      if (!nw || !se) return;

      const minLon = Math.max(-180, Math.min(nw[0], se[0]));
      const maxLon = Math.min(180, Math.max(nw[0], se[0]));
      const minLat = Math.max(-80, Math.min(nw[1], se[1]));
      const maxLat = Math.min(84, Math.max(nw[1], se[1]));

      const bounds = Bounds.bounds(minLon, minLat, maxLon, maxLat, Unit.DEGREE);
      const zoom = Math.floor(viewState.zoom);
      
      // 2. Setup MGRS grid generation
      const grids = Grids.create();
      const grid100k = grids.getGrid(GridType.HUNDRED_KILOMETER);
      
      if (!grid100k) return;

      const gridRange = GridZones.getGridRange(bounds);
      const zones = Array.from(gridRange);
      
      const features: any[] = [];

      // 3. Collect lines from zones using shared utility
      zones.forEach(zone => {
        const zoneData = getZoneData(grid100k, zone, bounds, zoom, GridType.HUNDRED_KILOMETER, false);
        
        zoneData.lines.forEach(line => {
          const path = line.path;
          if (path.length >= 2) {
             features.push({
                type: 'Feature',
                properties: {
                  zone: zone.getName(),
                  gridType: '100km'
                },
                geometry: {
                  type: 'LineString',
                  coordinates: path
                }
              });
          }
        });
      });

      // 4. Create GeoJSON
      const geojson = {
        type: 'FeatureCollection',
        features
      };

      downloadFile(geojson, `mgrs-100km-grid-z${zoom}.json`);
      console.log(`Exported ${features.length} grid lines.`);

    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed. Check console.');
    }
  };

  return (
    <div style={{ marginTop: '10px' }}>
      <button 
        onClick={handleExport}
        style={{
          padding: '8px 12px',
          background: '#444',
          color: 'white',
          border: '1px solid #666',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px'
        }}
      >
        Export 100km Grid (Cleaned)
      </button>
    </div>
  );
};
