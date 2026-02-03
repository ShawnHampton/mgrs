import { useState, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView, WebMercatorViewport } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { MGRSLayer } from './layers/MGRSLayer';
import { SelectionOverlayLayer } from './layers/SelectionOverlayLayer';
import { ExportControl } from './components/ExportControl';
import { useSelectionStore } from './store/selectionStore';
import { getActiveGridType, getCellAtPosition } from './utils/cell-utils';
import './App.css';

// Initial viewport - centered on Hilo, Hawaii
const INITIAL_VIEW_STATE = {
  longitude: -155.0868,
  latitude: 19.7241,
  zoom: 7,
  pitch: 0,
  bearing: 0
};

// OpenStreetMap tile layer for base map
const basemapLayer = new TileLayer({
  id: 'basemap',
  data: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  renderSubLayers: (props: any) => {
    const { tile, data } = props;
    const { bbox } = tile as { bbox: { west: number; south: number; east: number; north: number } };

    return new BitmapLayer({
      ...props,
      data: undefined,
      image: data,
      bounds: [bbox.west, bbox.south, bbox.east, bbox.north]
    });
  }
});

function App() {
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [cursorPosition, setCursorPosition] = useState<{ lon: number; lat: number } | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  const selectionEnabled = useSelectionStore((s) => s.selectionEnabled);
  const hoveredCell = useSelectionStore((s) => s.hoveredCell);
  const selectedCells = useSelectionStore((s) => s.selectedCells);
  const setSelectionEnabled = useSelectionStore((s) => s.setSelectionEnabled);
  const setHoveredCell = useSelectionStore((s) => s.setHoveredCell);
  const toggleSelectedCell = useSelectionStore((s) => s.toggleSelectedCell);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  const onViewStateChange = useCallback(({ viewState }: any) => {
    setViewState(viewState);
  }, []);

  const onResize = useCallback((dimensions: { width: number; height: number }) => {
     setViewport({
         width: dimensions.width,
         height: dimensions.height
     });
  }, []);

  const onHover = useCallback((info: any) => {
    if (info.coordinate) {
      const coord = info.coordinate as [number, number];
      let lon = coord[0];
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;
      setCursorPosition({ lon, lat: coord[1] });

      if (selectionEnabled) {
        const gridType = getActiveGridType(Math.floor(viewState.zoom));
        if (gridType != null) {
          const cell = getCellAtPosition(lon, coord[1], gridType);
          setHoveredCell(cell);
        } else {
          setHoveredCell(null);
        }
      }
    }
  }, [selectionEnabled, viewState.zoom, setHoveredCell]);

  const onClick = useCallback((info: any) => {
    if (!selectionEnabled || !info.coordinate) return;
    const current = useSelectionStore.getState().hoveredCell;
    if (current) {
      toggleSelectedCell(current);
    }
  }, [selectionEnabled, toggleSelectedCell]);

  const mapView = useMemo(() => new MapView({ id: 'map', controller: true, repeat: true }), []);

  const layers = useMemo(() => [
    basemapLayer,
    new MGRSLayer({ id: 'mgrs-grid' }),
    new SelectionOverlayLayer({
      id: 'selection-overlay',
      hoveredCell,
      selectedCells,
    }),
  ], [hoveredCell, selectedCells]);

  const getCursor = useCallback(
    () => (selectionEnabled ? 'crosshair' : 'grab'),
    [selectionEnabled],
  );

  // Compute viewport for export
  const exportViewport = useMemo(() => {
    if (!viewport) return undefined;

    // Create a temporary WebMercatorViewport for projection
    // @ts-ignore - WebMercatorViewport constructor type mismatch in some deck.gl versions
    const startViewport = new WebMercatorViewport({
      width: viewport.width,
      height: viewport.height,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing
    });

    return {
        width: viewport.width,
        height: viewport.height,
        unproject: (xy: [number, number]) => startViewport.unproject(xy) as [number, number]
    };
  }, [viewport, viewState]);

  return (
    <div className="app">
      <DeckGL
        views={mapView}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={layers}
        onHover={onHover}
        onClick={onClick}
        getCursor={getCursor}
        width="100%"
        height="100%"
        onResize={onResize}
      >
      </DeckGL>

      <div className="info-panel">
        <h3>Map Viewer</h3>
        <div className="info-row">
          <span>Zoom:</span>
          <span>{viewState.zoom.toFixed(1)}</span>
        </div>
        {cursorPosition && (
          <div className="info-row">
            <span>Position:</span>
            <span>
              {cursorPosition.lat.toFixed(4)}°, {cursorPosition.lon.toFixed(4)}°
            </span>
          </div>
        )}

        <div className="selection-section">
          <button
            className={`selection-toggle ${selectionEnabled ? 'active' : ''}`}
            onClick={() => setSelectionEnabled(!selectionEnabled)}
          >
            {selectionEnabled ? 'Selection ON' : 'Selection OFF'}
          </button>

          {selectionEnabled && hoveredCell && (
            <div className="info-row">
              <span>Cell:</span>
              <span>{hoveredCell.mgrsId}</span>
            </div>
          )}

          {selectedCells.size > 0 && (
            <div className="selection-info">
              <div className="info-row">
                <span>Selected:</span>
                <span>{selectedCells.size}</span>
              </div>
              <button className="clear-btn" onClick={clearSelection}>
                Clear
              </button>
            </div>
          )}
        </div>

        <ExportControl
            viewState={viewState}
            viewport={exportViewport}
        />
      </div>
    </div>
  );
}

export default App;
