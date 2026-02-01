import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { MGRSLayer } from './layers/MGRSLayer';
import './App.css';

// Initial viewport - centered on continental US
const INITIAL_VIEW_STATE = {
  longitude: -98.5,
  latitude: 39.8,
  zoom: 4,
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
  renderSubLayers: (props: { id: string; data: ImageBitmap; tile: { bbox: { west: number; south: number; east: number; north: number } } }) => {
    const { tile, data } = props;
    const { bbox } = tile;

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
  const [showLabels, setShowLabels] = useState(false);

  const onViewStateChange = useCallback(({ viewState }: { viewState: typeof INITIAL_VIEW_STATE }) => {
    setViewState(viewState);
  }, []);

  const onHover = useCallback((info: { coordinate?: [number, number] }) => {
    if (info.coordinate) {
      setCursorPosition({ lon: info.coordinate[0], lat: info.coordinate[1] });
    }
  }, []);

  // Memoize MapView to prevent recreation
  const mapView = useMemo(() => new MapView({ id: 'map', controller: true, repeat: true }), []);

  // Memoize layers to prevent unnecessary recreation
  // Don't include viewState.zoom in deps - layer should persist and re-render automatically
  const layers = useMemo(() => [
    basemapLayer,
    new MGRSLayer({
      id: 'mgrs-grid',
      visible: true,
      opacity: 0.9,
      showLabels
    })
  ], [showLabels]);

  return (
    <div className="app">
      <DeckGL
        views={mapView}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
        layers={layers}
        onHover={onHover}
      />
      
      {/* Info overlay */}
      <div className="info-panel">
        <h3>MGRS Grid Viewer</h3>
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
        <div className="legend">
          <div className="legend-item toggle-row">
            <label className="toggle-label">
              <span>Show Labels</span>
              <button
                className={`toggle-switch${showLabels ? ' active' : ''}`}
                role="switch"
                aria-checked={showLabels}
                onClick={() => setShowLabels(v => !v)}
              >
                <span className="toggle-knob" />
              </button>
            </label>
          </div>
          <div className="legend-item">
            <span className="legend-line gzd"></span>
            <span>GZD Boundaries</span>
          </div>
          <div className="legend-item">
            <span className="legend-line grid-100km"></span>
            <span>100km Grid</span>
          </div>
          <div className="legend-item">
            <span className="legend-line grid-10km"></span>
            <span>10km Grid</span>
          </div>
          <div className="legend-item">
            <span className="legend-line grid-1km"></span>
            <span>1km Grid</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
