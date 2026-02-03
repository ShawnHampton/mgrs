import { Bounds, Unit } from '@ngageoint/grid-js';
import { Grids, GridType, GridZones } from '@ngageoint/mgrs-js';
import { describe, expect, it } from 'vitest';
import { getZoneData } from '../mgrs-helpers';
import * as fs from 'fs';
import * as path from 'path';

describe('mgrs-helpers', () => {
    describe('getZoneData', () => {
        it('should clamp specific points for Zone 5Q to avoid diagonal artifacts', () => {
            const grids = Grids.create();
            const grid100k = grids.getGrid(GridType.HUNDRED_KILOMETER);
            
            // Setup viewport crossing zone 4Q/5Q boundary (-156)
            const viewportBounds = Bounds.bounds(-157, 19, -155, 23, Unit.DEGREE);
            const gridRange = GridZones.getGridRange(viewportBounds);
            const zones = Array.from(gridRange);
            const zone5Q = zones.find(z => z.getName() === '5Q');
            
            expect(zone5Q).toBeDefined();
            if (!zone5Q || !grid100k) return;

            const zoom = 8;
            const result = getZoneData(grid100k, zone5Q, viewportBounds, zoom, GridType.HUNDRED_KILOMETER, false);
            
            expect(result.lines.length).toBeGreaterThan(0);
            
            // Check for boundary violations
            let boundaryViolations = 0;
            let diagonals = 0;
            
            result.lines.forEach(line => {
                const path = line.path;
                const p1 = path[0];
                const p2 = path[1];
                
                const lon1 = p1[0];
                const lat1 = p1[1];
                const lon2 = p2[0];
                const lat2 = p2[1];
                
                // Zone 5Q starts at -156. 
                // With our epsilon clamping, NO point should be < -156 - slightly
                // We check if it goes significantly past -156 to the left.
                if (lon1 < -156.0001 || lon2 < -156.0001) {
                    console.log(`Violation: [${lon1}, ${lat1}] -> [${lon2}, ${lat2}]`);
                    boundaryViolations++;
                }
                
                // Check for diagonals near boundary
                const nearBoundary = (Math.abs(lon1 - (-156)) < 0.1 || Math.abs(lon2 - (-156)) < 0.1);
                if (nearBoundary) {
                    const dLon = Math.abs(lon1 - lon2);
                    const dLat = Math.abs(lat1 - lat2);
                    if (dLon > 0.1 && dLat > 0.1) {
                        console.log(`Diagonal: [${lon1}, ${lat1}] -> [${lon2}, ${lat2}]`);
                        diagonals++;
                    }
                }

                
            });

            const geojson = {
                type: 'FeatureCollection',
                features: result.lines.map(line => ({
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: line.path
                    }
                }))
            };
            fs.writeFileSync(path.join(process.cwd(), 'debug_output.geojson'), JSON.stringify(geojson, null, 2));
            
            expect(boundaryViolations).toBe(0);
            expect(diagonals).toBe(0);
        });

        it('should return empty if viewport does not intersect zone', () => {
            const grids = Grids.create();
            const grid100k = grids.getGrid(GridType.HUNDRED_KILOMETER);
            
            // Zone 4Q is roughly -162 to -156.
            // Viewport far away:
            const viewportBounds = Bounds.bounds(0, 0, 1, 1, Unit.DEGREE);
            
            // We need a zone object to pass, even if it doesn't intersect.
            // We can just use any zone.
            const zone = Array.from(GridZones.getGridRange(Bounds.bounds(-160, 20, -158, 22, Unit.DEGREE)))[0];
            
            if (!zone || !grid100k) return;
            
            const result = getZoneData(grid100k, zone, viewportBounds, 8, GridType.HUNDRED_KILOMETER, false);
            expect(result.lines.length).toBe(0);
        });

        it('should not contain lines that are essentially diagonal', () => {
            const grids = Grids.create();
            const grid100k = grids.getGrid(GridType.HUNDRED_KILOMETER);
            
            // Setup viewport crossing zone 4Q boundary (-156)
            const viewportBounds = Bounds.bounds(-157, 19, -155, 23, Unit.DEGREE);
            const gridRange = GridZones.getGridRange(viewportBounds);
            const zones = Array.from(gridRange);
            const zone4Q = zones.find(z => z.getName() === '4Q');
            
            expect(zone4Q).toBeDefined();
            if (!zone4Q || !grid100k) return;

            const zoom = 8;
            const result = getZoneData(grid100k, zone4Q, viewportBounds, zoom, GridType.HUNDRED_KILOMETER, false);
            
            expect(result.lines.length).toBeGreaterThan(0);
            
            let diagonals = 0;
            const threshold = 0.1; // 0.1 degrees is roughly 11km, valid grid lines shouldn't be valid in both dimensions > this
            
            result.lines.forEach(line => {
                const path = line.path;
                const p1 = path[0];
                const p2 = path[1];
                
                const lon1 = p1[0];
                const lat1 = p1[1];
                const lon2 = p2[0];
                const lat2 = p2[1];
                
                const dLon = Math.abs(lon1 - lon2);
                const dLat = Math.abs(lat1 - lat2);
                
                if (dLon > threshold && dLat > threshold) {
                    console.log(`Diagonal Line Found: [${lon1}, ${lat1}] -> [${lon2}, ${lat2}]`);
                    diagonals++;
                }
            });
            
            expect(diagonals).toBe(0);
        });
    });
});
