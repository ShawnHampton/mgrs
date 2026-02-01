# Role
You are a Senior Geospatial Engineer specializing in WebGL, Deck.gl, and Coordinate Reference Systems. I have a clean **Vite + React + TypeScript** application set up.

# Goal
Create an accurate, performant, and storage-friendly MGRS (Military Grid Reference System) layer for Deck.gl.

# Architectural Strategy: Hybrid Rendering
We will not pre-generate everything, nor will we calculate everything live. We will use a hybrid approach to balance accuracy and speed.

**1. Level 0 (Grid Zone Designators - GZDs):**
*   **Strategy:** Static Asset.
*   **Reasoning:** GZDs are irregular polygons (especially near Norway/Svalbard). Calculating them live is error-prone.
*   **Implementation:** Assume we load a local `gzds.json` (GeoJSON) file for the base 6x8 degree polygons. Use a standard `GeoJsonLayer`.

**2. Levels 1+ (100km, 10km, 1km, 100m):**
*   **Strategy:** Dynamic Tiling (Live Generation).
*   **Implementation:** Create a custom composite layer extending `TileLayer`.
*   **The Math:** We must generate grid lines mathematically based on the requested Tile (XYZ) bounds.

# Technical Requirements

### 1. Accuracy & Projections
*   **The "Trap":** MGRS is based on UTM. UTM zones are separate projections. A straight line in UTM is **curved** in Web Mercator.
*   **The Fix:** You must generate lines in UTM coordinates and project points to Lat/Lon.
*   **Clipping:** If a tile overlaps a UTM Zone boundary, the generated lines **must be clipped** to that zone. A grid line from Zone 18 must not visually "bleed" into Zone 19.
*   **Libraries:** Use `mgrs` (for valid strings), `proj4` (for raw UTM projection), and `turf` (only for bounding box intersections if strictly necessary).

### 2. Performance (The "Performant" part)
*   **Web Workers:** The generation logic (calculating grid lines for a tile) is CPU intensive. Please write the generation logic so it can be offloaded to a **Web Worker**.
*   **Data Structure:** The worker should return `Binary` data (Float32Arrays) if possible, or simple flat arrays, to minimize serialization overhead.

### 3. Visuals & NATO Labeling
*   **Lines:** Distinct colors/widths for 100km (Thick), 10km (Medium), 1km (Thin).
*   **Labels:** Use a `TextLayer`.
*   **Placement:** NATO standard requires labels in the **bottom-left** corner of the grid square.
*   **Dynamic Resolution:**
    *   **Zoom < 6:** Show GZD (e.g., `18S`) - handled by static layer.
    *   **Zoom 6-9:** Show 100km Square ID (e.g., `UJ`).
    *   **Zoom 10-12:** Show 10km (e.g., `12`).
    *   **Zoom 13+:** Show 1km/100m (e.g., `12 34`).

# Task
Please provide the code for the following files:

1.  `src/workers/mgrs.worker.ts`: The Web Worker that takes a Tile XYZ + Zoom level and returns the line segments (start/end coordinates) and label data.
2.  `src/layers/MGRSLayer.ts`: The custom Deck.gl layer that utilizes the worker and manages the `TileLayer` + `TextLayer` sub-layers.
3.  `src/App.tsx`: A functional component utilizing `react-map-gl` and the new `MGRSLayer`.
