/**
 * MGRS Layer Type Definitions
 */

// GeoJSON types for the GZD/100km static layer
export interface MGRSFeature {
  type: 'Feature';
  properties: {
    tile: string;      // e.g., "18SUJ" - zone + 100km square ID
    epsg: number;      // e.g., 32618 for UTM zone 18N
    utm_wkt: string;   // WKT polygon in UTM coordinates
    utm_bounds: string; // UTM bounding box
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface MGRSGeoJSON {
  type: 'FeatureCollection';
  features: MGRSFeature[];
}

// Worker message types
export interface TileRequest {
  x: number;
  y: number;
  z: number;
  zoom: number;
}

export interface GridLine {
  start: [number, number]; // [lon, lat]
  end: [number, number];   // [lon, lat]
  level: 'gzd' | '100km' | '10km' | '1km' | '100m';
}

export interface GridLabel {
  position: [number, number]; // [lon, lat] - bottom-left corner
  text: string;               // e.g., "18S", "UJ", "12 34"
  level: 'gzd' | '100km' | '10km' | '1km' | '100m';
}

export interface TileResponse {
  lines: GridLine[];
  labels: GridLabel[];
  // Optional: binary data for performance
  linePositions?: Float32Array;
  lineColors?: Uint8Array;
}

// 100km square feature generated per GZD
export interface MGRSSquareFeature {
  type: 'Feature';
  properties: {
    id: string;        // e.g., "18SUJ" - full MGRS grid zone + square ID
    squareId: string;  // e.g., "UJ" - 2-letter 100km square ID
    gzd: string;       // e.g., "18S" - parent GZD
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

// Worker request to generate 100km squares for a GZD
export interface Generate100kmRequest {
  gzd: string;
  zone: number;
  band: string;
  hemisphere: 'N' | 'S';
  bounds: number[][][]; // GZD polygon coordinates
}

// Worker response with generated 100km square features
export interface Generate100kmResponse {
  gzd: string;
  features: MGRSSquareFeature[];
}

// Worker message wrapper
export type WorkerMessage =
  | { type: 'request'; payload: TileRequest }
  | { type: 'response'; payload: TileResponse }
  | { type: 'generate-100km'; payload: Generate100kmRequest }
  | { type: 'generate-100km-result'; payload: Generate100kmResponse }
  | { type: 'error'; payload: string };

// Layer props
export interface MGRSLayerProps {
  id?: string;
  visible?: boolean;
  opacity?: number;
  // Style overrides
  gzdLineWidth?: number;
  grid100kmLineWidth?: number;
  grid10kmLineWidth?: number;
  grid1kmLineWidth?: number;
  gzdLineColor?: [number, number, number, number];
  grid100kmLineColor?: [number, number, number, number];
  grid10kmLineColor?: [number, number, number, number];
  grid1kmLineColor?: [number, number, number, number];
  // Label styling
  labelFontFamily?: string;
  labelFontSize?: number;
  labelColor?: [number, number, number, number];
  labelBackgroundColor?: [number, number, number, number];
  // Label visibility
  showLabels?: boolean;
}

// Bounds type for tile calculations
export interface LatLonBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// UTM Zone info
export interface UTMZone {
  zone: number;        // 1-60
  hemisphere: 'N' | 'S';
  epsg: number;        // e.g., 32618 for 18N, 32718 for 18S
}
