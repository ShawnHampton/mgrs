# 10km Grid Implementation Status

## What Was Done

### Completed: 10km grid following the 100km pattern
The TileLayer pipeline for 10km rendering was replaced with the same approach used for
100km squares: generate polygon features per 100km square, cache them, render as GeoJsonLayer.

**Files created:**
- `src/utils/generate10kmGrid.ts` — `generate10kmGridForSquare()` generates 10km cell
  polygons for a single 100km square using JSTS intersection to clip cells to the parent
  boundary, `mgrs.forward([lon,lat], 1)` for labeling.

**Files modified:**
- `src/types/mgrs.ts` — Added `Generate10kmRequest`, `Generate10kmResponse`, added
  `generate-10km` / `generate-10km-result` to `WorkerMessage` union.
- `src/workers/mgrs.worker.ts` — Added `generate-10km` message handler, imported
  `generate10kmGridForSquare`.
- `src/layers/MGRSLayer.ts` — Removed TileLayer + PathLayer + unused imports. Added
  `requestGenerate10km()` to WorkerPool with `generate10kmCallbacks` map. Added
  `grid10kmCache`, `pending10kmSquares`, `getVisible10kmGrids()` to MGRSLayer. Extended
  100km generation to all `zoom >= 5` (was `zoom >= 5 && zoom < 10`). 100km rendering:
  `zoom >= 5 && zoom < 13`. 10km rendering: `zoom >= 8`. Removed dead `getTileData()`
  and request-ID plumbing from WorkerPool (no longer needed without TileLayer).
- `src/utils/generate100kmSquares.ts` — Added `BufferOp` import and `BufferOp.bufferOp(geom, 0)`
  for geometry repair (parent GZD polygon + intersection retry).
- `CLAUDE.md` — Added rule: use package.json scripts (`pnpm build`) not direct tool invocation.

### Current state: 10km grid works EXCEPT over certain areas (Hawaii/Hilo)

The green 10km grid renders correctly in most locations but is **missing over specific
100km squares near Hilo, Hawaii** (UTM zone 5, band Q). Adjacent squares render fine.

## The Bug: Missing 10km grid over Hilo

### Symptoms
- Blue 100km grid renders correctly everywhere including Hawaii (no errors).
- Green 10km grid renders around Hawaii but has gaps directly over Hilo.
- No errors in console (after the BufferOp fixes).

### Root cause investigation so far

The `generate10kmGridForSquare()` function returns an empty array for specific 100km
squares. We don't yet know WHY because the function silently produces zero features.

**Hypotheses tested:**
1. **JSTS TopologyException from self-intersecting parent polygon** — Added
   `BufferOp.bufferOp(geom, 0)` to repair the parent 100km square geometry. First tried
   `geom.isValid()` (not a function in JSTS v2), then `geom.buffer(0)` (also not a method
   on JSTS geometry objects). Finally used `BufferOp.bufferOp(geom, 0)` which is the correct
   JSTS v2 API. This fixed an error in 100km generation but did NOT fix the 10km gap.

2. **BufferOp itself causing the problem** — Moved BufferOp off the critical path: the
   parent polygon is now created WITHOUT BufferOp, and BufferOp is only used as a retry
   when `OverlayOp.intersection()` throws. This restored blue grid but green still missing.

**Hypotheses NOT YET tested:**
3. **All intersections are empty** — The parent polygon might be valid but the 10km cell
   polygons projected from UTM might not actually overlap it (coordinate system mismatch,
   wrong UTM zone, projection artifact).
4. **`mgrs.forward()` throws for all cells** — Every cell center in the square might fail
   the `mgrs.forward([lon,lat], 1)` call, causing all cells to be skipped.
5. **Duplicate 100km square IDs** — If `generate100kmSquaresForGZD` produces multiple
   features with the same `id` (from MultiPolygon splitting), only the first gets a 10km
   request. The others are skipped because `pending10kmSquares` already contains the ID.
   But the first feature's geometry might be a sliver, not the main polygon.
6. **Worker error not handled** — If `generate10kmGridForSquare` throws, the worker sends
   `{ type: 'error' }` but `WorkerPool.onmessage` has no handler for error messages on
   10km requests. The square stays in `pending10kmSquares` forever, never retries.

### Diagnostic logging added
The latest version of `generate10kmGrid.ts` includes a diagnostic `console.warn` that fires
when zero features are produced for a square. It logs:
- `parentId` (e.g. "5QKB")
- `cellsAttempted` count
- `intersectionFailures` count
- UTM range `E[min-max] N[min-max]`
- `squareGeom` type and area

**Next step:** Check browser console output from this diagnostic log when zoomed to Hilo
at zoom 8+. The log will reveal which hypothesis is correct.

### Likely fix paths based on diagnosis

| Diagnostic result | Fix |
|---|---|
| `intersectionFailures == cellsAttempted` | Parent polygon is invalid; try `BufferOp.bufferOp` on parent ONLY when all normal intersections fail, then re-run the loop |
| `intersectionFailures == 0` but `features == 0` | All intersections return empty; likely a coordinate mismatch — check if the UTM range and cell projections align with the parent polygon |
| `squareGeom area == 0` | Parent polygon is degenerate; check if this is a duplicate/sliver feature from 100km generation |
| Log never fires | `generate10kmGridForSquare` is throwing before reaching the loop; check worker error handling |
| `cellsAttempted == 0` | UTM range computation is wrong (minE > maxE after snapping) |

## Build status
`pnpm build` fails on pre-existing TypeScript errors in `App.tsx` and `main.tsx` only.
No errors in any of the MGRS grid files. Vite dev server works fine.

## Key JSTS v2 API notes (for future reference)
- `geom.buffer(0)` does NOT exist — use `BufferOp.bufferOp(geom, 0)`
- `geom.isValid()` does NOT exist — would need `IsValidOp` import (not yet tried)
- `import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp'`
- `OverlayOp.intersection(a, b)` works as a static method
- Type declarations are incomplete; use `any` type alias for geometry objects
