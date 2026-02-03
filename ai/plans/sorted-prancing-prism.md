# Plan: MGRS Grid Cell Selection & Highlighting

## Summary

Add a selection mode where users can hover-highlight and click-select MGRS grid cells. Selection operates on the finest grid visible at the current zoom. A Zustand store holds all selection state. A separate deck.gl overlay layer renders highlighted/selected cell polygons on top of MGRSLayer.

## Requirements (Confirmed)

- **Hover = highlight**, **Click = select**
- **Multi-select**: click toggles cells in/out of selection
- **Zustand store only**: no callback props, consumers subscribe
- **Toggle mode**: selection must be explicitly enabled
- **Separate overlay layer**: does NOT modify MGRSLayer

---

## New Files

### 1. `src/types/types.ts` (modify) - Add shared types

Add `CellPolygon` and `CellEntry` interfaces:

```typescript
export interface CellPolygon {
  ring: [number, number][]; // closed ring of [lon, lat] coords
}

export interface CellEntry {
  mgrsId: string;          // e.g. "05QLL3456" for 1km precision
  gridType: GridType;
  polygon: CellPolygon;
}
```

### 2. `src/store/selectionStore.ts` - Zustand store

**State shape:**

| Field | Type | Description |
|-------|------|-------------|
| `selectionEnabled` | `boolean` | Whether selection mode is active |
| `hoveredCell` | `CellEntry \| null` | Currently hovered cell |
| `selectedCells` | `Map<string, CellEntry>` | Selected cells keyed by mgrsId |

**Actions:**

| Action | Behavior |
|--------|----------|
| `setSelectionEnabled(enabled)` | Toggle mode. Clears `hoveredCell` when disabling. |
| `setHoveredCell(cell)` | No-op if same `mgrsId` as current (perf optimization). |
| `toggleSelectedCell(cell)` | Add if absent, remove if present. Immutable Map swap. |
| `clearSelection()` | Empty `selectedCells`. |

### 3. `src/utils/cell-utils.ts` - Cell identification & polygon computation

**Functions:**

#### `getActiveGridType(zoom: number): GridType | null`
Returns finest visible grid type for the zoom level using same thresholds as MGRSLayer:
- zoom >= 11 -> `KILOMETER`
- zoom >= 8 -> `TEN_KILOMETER`
- zoom >= 4 -> `HUNDRED_KILOMETER`
- zoom >= 0 -> `GZD`

#### `getCellAtPosition(lon: number, lat: number, gridType: GridType): CellEntry | null`
1. `Point.degrees(lon, lat)` -> `MGRS.from(point)` -> `mgrs.coordinate(gridType)` for the cell ID
2. Compute polygon via `getCellPolygon()`
3. Return `{ mgrsId, gridType, polygon }` or `null` if outside MGRS range (80S-84N)

#### `getCellPolygon(mgrsId: string, gridType: GridType): CellPolygon`
- **For GZD**: Use `MGRS.parse(mgrsId).getGridZone().getBounds()` to get lat/lon rectangle directly
- **For other types**: Parse MGRS -> `toUTM()` for SW corner -> add `gridType` value (which IS the cell size in meters: 100000, 10000, 1000) to easting/northing -> convert all 4 UTM corners back to lat/lon via `UTM.create(zone, hemisphere, e, n).toPoint()`
- Return closed 5-point ring: `[SW, SE, NE, NW, SW]`

### 4. `src/layers/SelectionOverlayLayer.ts` - Overlay layer

A `CompositeLayer` that receives `hoveredCell` and `selectedCells` as **props** (passed from App.tsx which subscribes to the store). This follows deck.gl's reactive prop-change model.

`renderLayers()`:
- Build polygon data array from hovered + selected cells
- Return a single `PolygonLayer` with:
  - **Hovered cell**: semi-transparent white fill (`[255, 255, 255, 60]`)
  - **Selected cells**: semi-transparent blue fill (`[59, 130, 246, 80]`)
  - `stroked: true`, `filled: true`, `pickable: false`

---

## Modified Files

### 5. `src/App.tsx` - Integration

**Store subscription:**
```typescript
const { selectionEnabled, hoveredCell, selectedCells, setSelectionEnabled } = useSelectionStore(...);
```

**Modify `onHover`:** When `selectionEnabled`, compute cell at cursor position via `getActiveGridType()` + `getCellAtPosition()`, call `setHoveredCell()`. Skip update if same cell (perf).

**Add `onClick`:** When `selectionEnabled` and `hoveredCell` exists, call `toggleSelectedCell(hoveredCell)`.

**Layers array:** Append `SelectionOverlayLayer` after `MGRSLayer`, passing `hoveredCell` and `selectedCells` as props.

**UI additions in info panel:**
- Selection mode toggle button (blue when active, gray when off)
- Hovered cell MGRS ID display
- Selected cell count + "Clear" button
- `getCursor` prop: `'crosshair'` when selection enabled, `'grab'` otherwise

---

## Edge Cases

| Case | Handling |
|------|----------|
| Zone boundaries | `MGRS.from()` correctly assigns cells to their UTM zone; polygons stay within zone |
| Zoom out with existing selections | Selected cells remain in store and render (may appear tiny at coarser zoom) |
| Mixed-precision selections | Store holds cells at any precision; different zoom levels add different-sized cells |
| Polar regions (>84N, <80S) | `getCellAtPosition` returns null; no highlight |
| Hover performance | `setHoveredCell` no-ops when `mgrsId` unchanged; state only updates on cell boundary crossings |

---

## Implementation Order

1. Add `CellEntry`/`CellPolygon` types to `src/types/types.ts`
2. Create `src/store/selectionStore.ts`
3. Create `src/utils/cell-utils.ts`
4. Create `src/layers/SelectionOverlayLayer.ts`
5. Wire everything in `src/App.tsx`

## Verification

1. `pnpm build` - ensure no type errors
2. `pnpm test` - run existing tests pass, add new tests for cell-utils and store
3. Manual testing:
   - Toggle selection mode on/off, verify cursor changes
   - Hover cells at zoom 12 (1km), verify highlight follows cell boundaries
   - Click to select/deselect, verify multi-select works
   - Zoom out, verify selections persist and hover adapts to coarser grid
   - Clear selection button works
