# MGRS Layer Architecture

## Overview
The MGRS layer system uses a hierarchical architecture where a main orchestrator layer delegates to specialized sub-layers based on zoom level.

## Layer Hierarchy

```
MGRSLayer (Orchestrator)
├── Loads GZD data
├── Determines zoom level
└── Delegates to sub-layers
    ├── GZDGridLayer (zoom < 7)
    │   ├── Loads /gzds.json
    │   └── Renders GZD boundaries
    │
    ├── Grid100kmLayer (zoom 5-12)
    │   ├── Filters visible GZDs
    │   ├── Requests 100km generation from WorkerPool
    │   ├── Caches 100km squares
    │   ├── Renders squares as GeoJsonLayer
    │   └── Optionally renders labels as TextLayer
    │
    └── Grid10kmLayer (zoom >= 8)
        ├── Gets 100km squares
        ├── Requests 10km generation from WorkerPool
        ├── Caches 10km grids
        ├── Renders grids as GeoJsonLayer
        └── Optionally renders labels as TextLayer
```

## Data Flow

### Initialization
```
App.tsx
  └─> MGRSLayer.initializeState()
       └─> loadGZDData()
            └─> fetch('/gzds.json')
                 └─> this.gzdData = response
```

### Rendering Pipeline (zoom < 7)
```
MGRSLayer.renderLayers()
  └─> new GZDGridLayer()
       └─> GeoJsonLayer
            └─> Renders GZD boundaries
```

### Rendering Pipeline (zoom 5-12)
```
MGRSLayer.renderLayers()
  └─> new Grid100kmLayer({ gzdData })
       ├─> getVisible100kmSquares()
       │    ├─> Filter GZDs in viewport
       │    ├─> Check cache
       │    └─> WorkerPool.requestGenerate100km()
       │         └─> mgrs.worker.ts
       │              └─> generate100kmSquaresForGZD()
       │                   └─> callback with features
       │                        └─> squares100kmCache.set()
       │                             └─> setNeedsUpdate()
       │
       └─> renderLayers()
            ├─> GeoJsonLayer (squares)
            └─> TextLayer (labels, optional)
```

### Rendering Pipeline (zoom >= 8)
```
MGRSLayer.renderLayers()
  ├─> new Grid100kmLayer() (invisible, data only)
  │    └─> Provides 100km squares
  │
  └─> new Grid10kmLayer({ gzdData })
       ├─> getVisible100kmSquares()
       │    └─> Same as Grid100kmLayer
       │
       ├─> getVisible10kmGrids()
       │    ├─> For each 100km square
       │    ├─> Check cache
       │    └─> WorkerPool.requestGenerate10km()
       │         └─> mgrs.worker.ts
       │              └─> generate10kmGridForSquare()
       │                   └─> callback with features
       │                        └─> grid10kmCache.set()
       │                             └─> setNeedsUpdate()
       │
       └─> renderLayers()
            ├─> GeoJsonLayer (10km grids)
            └─> TextLayer (labels, optional)
```

## Component Responsibilities

### MGRSLayer (Orchestrator)
- **Purpose**: Coordinate sub-layers based on zoom
- **Data**: Loads and owns GZD data
- **Logic**: Minimal - just delegation
- **Zoom**: All levels
- **Size**: 95 lines

### GZDGridLayer
- **Purpose**: Render large-scale grid zone boundaries
- **Data**: Uses GZD data from parent
- **Logic**: Simple rendering only
- **Zoom**: < 7
- **Size**: 58 lines

### Grid100kmLayer
- **Purpose**: Generate and render 100km MGRS squares
- **Data**: Caches 100km squares per GZD
- **Logic**: Viewport filtering, worker requests, caching
- **Zoom**: 5-12 (visible), 8+ (data only)
- **Size**: 157 lines

### Grid10kmLayer
- **Purpose**: Generate and render 10km MGRS grid cells
- **Data**: Caches 10km grids per 100km square
- **Logic**: Gets 100km squares, viewport filtering, worker requests, caching
- **Zoom**: >= 8
- **Size**: 199 lines

## Utility Services

### WorkerPool
- **Purpose**: Manage web worker threads for parallel computation
- **Workers**: 4 workers by default
- **Distribution**: Round-robin
- **Callbacks**: Maps request IDs to result callbacks
- **Singleton**: Shared across all layers

### viewportUtils
- **bboxIntersects()**: Test if polygon intersects viewport
- **getBottomLeftPosition()**: Calculate label anchor point
- **getViewportBounds()**: Extract bounds from deck.gl viewport

### layerConfig
- **DEFAULT_PROPS**: Centralized default styling
- **Line widths**: Per grid level
- **Line colors**: Per grid level
- **Label styling**: Font, size, colors

## Caching Strategy

### Two-Level Cache
```
GZD → 100km Squares → 10km Grids
 │         │              │
 │         ├─ Cache key: GZD name (e.g., "18S")
 │         └─ Viewport filtered before render
 │
 └─ Cache key: Square ID (e.g., "18SUJ")
    └─ All grids cached for entire square
```

### Cache Lifecycle
1. **Check**: Is data in cache?
2. **Request**: If not, request from WorkerPool
3. **Track**: Mark as pending to avoid duplicate requests
4. **Receive**: Worker callback stores in cache
5. **Update**: Trigger layer re-render
6. **Filter**: Apply viewport filtering on cached data

## Worker Communication

### Message Types
```typescript
// 100km generation
{ type: 'generate-100km', payload: Generate100kmRequest }
{ type: 'generate-100km-result', payload: Generate100kmResponse }

// 10km generation
{ type: 'generate-10km', payload: Generate10kmRequest }
{ type: 'generate-10km-result', payload: Generate10kmResponse }
{ type: 'generate-10km-error', payload: { squareId, error } }
```

### Request Flow
```
Layer
  └─> WorkerPool.requestGenerate*()
       ├─> Store callback in Map
       ├─> Get next worker (round-robin)
       └─> worker.postMessage()
            └─> Worker processes
                 └─> worker.postMessage(result)
                      └─> WorkerPool.onmessage
                           ├─> Find callback in Map
                           ├─> Execute callback
                           └─> Delete callback from Map
                                └─> Layer receives result
                                     └─> Cache and render
```

## Performance Characteristics

### GZD Layer
- **Data**: Static, loaded once (~1200 features)
- **Processing**: None
- **Rendering**: Direct GeoJSON rendering
- **Performance**: Excellent

### 100km Layer
- **Data**: Generated per visible GZD
- **Processing**: Worker-based, cached
- **Rendering**: ~10-50 squares typically visible
- **Performance**: Good

### 10km Layer
- **Data**: Generated per visible 100km square
- **Processing**: Worker-based, cached
- **Rendering**: ~100-1000 cells typically visible
- **Performance**: Moderate (depends on zoom and viewport)

## Future Extensions

### Easy Additions
1. **1km Grid Layer**: Follow Grid10kmLayer pattern
2. **100m Grid Layer**: Follow Grid10kmLayer pattern
3. **Custom Grid Layer**: Extend base pattern
4. **Label Customization**: Per-layer label controls
5. **Style Overrides**: Per-layer style props

### Architecture Supports
- Independent layer visibility toggles
- Per-layer performance profiling
- Gradual rendering strategies
- Dynamic level-of-detail
- Custom caching strategies per layer
