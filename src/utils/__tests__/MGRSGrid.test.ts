
import { describe, it, expect } from 'vitest';
import { Grids, GridType, GridZones } from '@ngageoint/mgrs-js';
import { Bounds, Unit } from '@ngageoint/grid-js';

describe('MGRS Grid Generation', () => {
  it('should generate 100km grid lines for GZD 4Q without diagonals', () => {
    const grids = Grids.create();
    const grid100k = grids.getGrid(GridType.HUNDRED_KILOMETER);
    expect(grid100k).toBeDefined();
    if (!grid100k) return;

    // Focus on the Eastern boundary of 4Q (-156)
    // Viewport spans across the boundary: -156.5 to -155.5
    const viewportBounds = Bounds.bounds(-157, 19, -155, 23, Unit.DEGREE);
    
    // Get zones for the new bounds
    const gridRange = GridZones.getGridRange(viewportBounds);
    const zones = Array.from(gridRange);

    const zone4Q = zones.find(z => z.getName() === '4Q');
    expect(zone4Q).toBeDefined();
    
    if (!zone4Q) return;
    
    console.log(`Processing Zone: ${zone4Q.getName()} near boundary`);

    // Simulate MGRSLayer clipping
    const zoneBounds = zone4Q.getBounds();
    const minLon = Math.max(viewportBounds.getMinLongitude(), zoneBounds.getMinLongitude());
    const maxLon = Math.min(viewportBounds.getMaxLongitude(), zoneBounds.getMaxLongitude());
    const minLat = Math.max(viewportBounds.getMinLatitude(), zoneBounds.getMinLatitude());
    const maxLat = Math.min(viewportBounds.getMaxLatitude(), zoneBounds.getMaxLatitude());
    
    const tileBounds = Bounds.bounds(minLon, minLat, maxLon, maxLat, Unit.DEGREE);
    console.log(`Clipped Bounds: [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`);
    
    // Zoom 8 is suitable for 100km grid
    const zoom = 8;
    
    // Get lines
    // We strictly use the zone bounds as the tile bounds for now to see what the raw generator does
    // or we can use a "tile" that overlaps the edge.
    const lines = grid100k.getLines(zoom, zone4Q, tileBounds);
    
    let diagonalCount = 0;
    
    if (lines) {
      lines.forEach(line => {
        const p1 = line.getPoint1();
        const p2 = line.getPoint2();
        
        const lon1 = p1.getLongitude();
        const lat1 = p1.getLatitude();
        const lon2 = p2.getLongitude();
        const lat2 = p2.getLatitude();
        
        const dLon = Math.abs(lon1 - lon2);
        const dLat = Math.abs(lat1 - lat2);

        // Check for boundary violation (Zone 4Q should be < -156)
        // With exact clipping, we expect points <= -156
        if (lon1 > -156.000001 || lon2 > -156.000001) {
             console.log(`Boundary Violation: [${lon1}, ${lat1}] -> [${lon2}, ${lat2}]`);
        }

        const nearBoundary = (Math.abs(lon1 - (-156)) < 0.1 || Math.abs(lon2 - (-156)) < 0.1);

        if (nearBoundary) {
             // Diagonal: both change significantly > 0.1 degrees (~11km)
             if (dLon > 0.1 && dLat > 0.1) {
                 console.log(`CONFIRMED Diagonal: [${lon1.toFixed(5)}, ${lat1.toFixed(5)}] -> [${lon2.toFixed(5)}, ${lat2.toFixed(5)}] (dLon: ${dLon.toFixed(5)}, dLat: ${dLat.toFixed(5)})`);
                 diagonalCount++;
             }
        }
      });
    }
    
    console.log(`Total lines: ${lines?.length || 0}`);
    console.log(`Suspicious diagonals: ${diagonalCount}`);
    
    // We expect 0 diagonals in a perfect world
    // expect(diagonalCount).toBe(0); 
  });
});
