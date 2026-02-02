# Zustand Store Integration

## Overview

Integrated Zustand state management to centralize shared state across all MGRS layers. This eliminates prop drilling and ensures consistent data access across the layer hierarchy.

## Store Structure

### Location
`src/store/mgrsStore.ts`

### State Management

**GZD Data**
- `gzdData`: Loaded once and shared across all layers
- `gzdLoadError`: Error state for GZD loading
- Loaded by `MGRSLayer` on initialization

**100km Squares Cache**
- `squares100km`: Map<string, MGRSSquareFeature[]>
- Keyed by GZD name (e.g., "18T", "19T")
- Populated by `Grid100kmLayer` via worker responses
- Accessed by both `Grid100kmLayer` and `Grid10kmLayer`

**10km Grids Cache**
- `grids10km`: Map<string, MGRSSquareFeature[]>
- Keyed by 100km square ID (e.g., "18TXQ", "19TCG")
- Populated by `Grid10kmLayer` via worker responses
- Accessed by `Grid10kmLayer` for rendering

**Viewport Bounds** (reserved for future optimization)
- `viewportBounds`: Current viewport bounds
- Can be used for viewport-based caching strategies

## Layer Updates

### MGRSLayer
- Loads GZD data into store on initialization
- Passes minimal props to sub-layers (no gzdData prop)
- Checks store for gzdData before rendering

### GZDGridLayer
- Reads `gzdData` directly from store
- No local state needed
- Simplified to pure rendering logic

### Grid100kmLayer
- Removed `gzdData` prop requirement
- Removed local `squares100kmCache`
- Reads GZD data from store
- Writes 100km squares to store cache
- Uses store for all data access

### Grid10kmLayer
- Removed `gzdData` prop requirement
- Removed local `squares100kmCache` and `grid10kmCache`
- Reads GZD data from store
- Reads 100km squares from store (shared with Grid100kmLayer)
- Writes 10km grids to store cache
- Fully decoupled from other layers

## Benefits

1. **Single Source of Truth**: All layers access the same cached data
2. **No Prop Drilling**: Layers don't need to pass data through props
3. **Better Performance**: Shared caches prevent duplicate worker requests
4. **Simpler Code**: Layers focus on rendering, not data management
5. **Easier Debugging**: Centralized state is easier to inspect
6. **Future Extensibility**: Easy to add viewport-based optimizations

## Usage Pattern

```typescript
// In any layer
const store = useMGRSStore.getState();

// Read data
const gzdData = store.gzdData;
const squares = store.getSquares100km('18T');
const grids = store.getGrids10km('18TXQ');

// Write data
store.setSquares100km('18T', features);
store.setGrids10km('18TXQ', grids);

// Clear caches
store.clearSquares100km();
store.clearGrids10km();
store.clearAll();
```

## Architecture: Viewport Manager Pattern

### ViewportManager (`src/utils/viewportManager.ts`)

The ViewportManager is a singleton that monitors viewport changes and proactively populates the store with data. This separates data fetching from rendering:

**Responsibilities:**
- Monitors viewport changes (zoom, pan)
- Determines which GZDs are visible
- Requests 100km squares for visible GZDs (zoom >= 5)
- Requests 10km grids for visible 100km squares (zoom >= 8)
- Manages pending requests to avoid duplicates
- Populates store with worker responses

**Benefits:**
- Layers become pure rendering components
- Single point of control for data fetching
- Easier to optimize (debouncing, caching strategies)
- Cleaner separation of concerns

## Data Flow

```
MGRSLayer (loads GZD) → Store
                          ↓
                     [gzdData]
                          ↓
                   ViewportManager
                   (monitors viewport)
                          ↓
        ┌─────────────────┴─────────────────┐
        ↓                                    ↓
  update100kmSquares()              update10kmGrids()
  (zoom >= 5)                       (zoom >= 8)
        ↓                                    ↓
  Worker requests                    Worker requests
        ↓                                    ↓
  Store.setSquares100km              Store.setGrids10km
        ↓                                    ↓
  [squares100km cache]               [grids10km cache]
        ↓                                    ↓
  Grid100kmLayer                     Grid10kmLayer
  (renders from store)               (renders from store)
```

## Migration Notes

- Removed all `gzdData` props from layer interfaces
- Removed all local cache Maps from layers
- All data access now goes through store
- TypeScript compilation passes
- No breaking changes to public API
