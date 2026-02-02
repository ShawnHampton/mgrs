# Fix MGRS Grid Rendering at Lower Levels

## Problems

### P1: Grid levels disappear when finer levels appear (CRITICAL)
`getResolutionForZoom()` returns only ONE resolution per zoom. At zoom 13 the 10km grid
vanishes and only 1km shows. Users lose all spatial context from coarser grids.

### P2: WorkerPool matches responses to wrong requests (CRITICAL)
In `onmessage`, `processQueue()` is called BEFORE `this.queue.shift()`. Under load with
multiple in-flight requests, responses get matched to the wrong tiles.

### P3: Zone boundary floating-point clipping (HIGH)
Exact equality in zone clipping (`lon >= zoneBounds.west && lon <= zoneBounds.east`)
drops points at boundaries due to floating-point imprecision from proj4.

### P4: 100m lines use same color as 1km (MEDIUM)
`getLineColor` maps `'100m'` to `grid1kmLineColor`. No distinct 100m styling exists.

---

## Phases

### Phase 1 — Worker: multi-resolution + zone clipping (`src/workers/mgrs.worker.ts`)

- Replace `getResolutionForZoom()` with `getResolutionsForZoom()` returning an array:
  - zoom < 10  -> []
  - zoom 10-12 -> [10000]
  - zoom 13-15 -> [10000, 1000]
  - zoom 16+   -> [10000, 1000, 100]
- Update `processTileRequest` to loop over all resolutions and merge results.
- Add epsilon buffer (0.0001 deg) to zone boundary clipping checks (lines 174, 199).
- Add `requestId` echo-through: worker receives `requestId` in message, echoes it back.

### Phase 2 — WorkerPool rewrite (`src/layers/MGRSLayer.ts`, `src/types/mgrs.ts`)

- Add `requestId` field to `TileRequest`, `TileResponse`, and `WorkerMessage` types.
- Replace queue-based WorkerPool with request-ID callback map:
  - Auto-incrementing `requestId` counter.
  - `getTileData()`: assign ID, store `{resolve, reject}` in `Map<number, callbacks>`.
  - `onmessage`: look up callback by `requestId`, resolve, delete entry.
  - No queue/shift logic needed.

### Phase 3 — Extend coarser layer visibility (`src/layers/MGRSLayer.ts`)

- GZD GeoJsonLayer: `zoom < 7` -> `zoom < 10` (visible alongside 100km).
- 100km GeoJsonLayer: `zoom >= 5 && zoom < 10` -> `zoom >= 5 && zoom < 13`
  (stays visible through 10km range).

### Phase 4 — Add 100m styling + legend (`src/layers/MGRSLayer.ts`, `src/types/mgrs.ts`, `src/App.tsx`, `src/App.css`)

- Add `grid100mLineWidth` (default 0.5) and `grid100mLineColor` (default purple-400
  `[192, 132, 252, 120]`) to `MGRSLayerProps` and `DEFAULT_PROPS`.
- Update `getLineColor`/`getLineWidth` in `renderSubLayers` to use new props.
- Add 100m entry to legend in `App.tsx` and `App.css`.

---

## Files to Modify

| File | Phases |
|------|--------|
| `src/workers/mgrs.worker.ts` | 1 |
| `src/types/mgrs.ts` | 2, 4 |
| `src/layers/MGRSLayer.ts` | 2, 3, 4 |
| `src/App.tsx` | 4 |
| `src/App.css` | 4 |

---

## Verification

1. `pnpm build` — no TypeScript errors
2. Zoom 4-6: GZD boundaries visible (red)
3. Zoom 7-9: GZD (red) + 100km squares (blue)
4. Zoom 10-12: GZD (red) + 100km (blue) + 10km (green)
5. Zoom 13-15: 100km (blue) + 10km (green) + 1km (amber)
6. Zoom 16+: 10km (green) + 1km (amber) + 100m (purple)
7. Pan across UTM zone boundary — no gaps
8. Pan rapidly at zoom 12 — tiles load with correct data
