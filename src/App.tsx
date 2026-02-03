import { useState, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { MapView } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';
import { MGRSLayer } from './layers/MGRSLayer';
import './App.css';

// Initial viewport - centered on Hilo, Hawaii
const INITIAL_VIEW_STATE = {
  longitude: -155.0868,
  latitude: 19.7241,
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

  const onViewStateChange = useCallback(({ viewState }: { viewState: typeof INITIAL_VIEW_STATE }) => {
    setViewState(viewState);
  }, []);

  const onHover = useCallback((info: { coordinate?: [number, number] }) => {
    if (info.coordinate) {
      let lon = info.coordinate[0];
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;
      setCursorPosition({ lon, lat: info.coordinate[1] });
    }
  }, []);

  const mapView = useMemo(() => new MapView({ id: 'map', controller: true, repeat: true }), []);

  const layers = useMemo(() => [
    basemapLayer,
    new MGRSLayer({ id: 'mgrs-grid' }),
  ], []);

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
      </div>
    </div>
  );
}

export default App;
