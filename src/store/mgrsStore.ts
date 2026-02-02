/**
 * MGRS Layer Store - Zustand store for managing shared state across MGRS layers
 */

import { create } from 'zustand';
import type { MGRSSquareFeature } from '../types/mgrs';
import type { GZDGeoJSON } from '../utils/generateGZD';

interface MGRSStore {
  // GZD data - loaded once and shared across all layers
  gzdData: GZDGeoJSON | null;
  gzdLoadError: boolean;
  setGzdData: (data: GZDGeoJSON | null) => void;
  setGzdLoadError: (error: boolean) => void;

  // 100km squares cache - keyed by GZD name
  squares100km: Map<string, MGRSSquareFeature[]>;
  setSquares100km: (gzd: string, squares: MGRSSquareFeature[]) => void;
  getSquares100km: (gzd: string) => MGRSSquareFeature[] | undefined;
  clearSquares100km: () => void;

  // 10km grids cache - keyed by 100km square ID
  grids10km: Map<string, MGRSSquareFeature[]>;
  setGrids10km: (squareId: string, grids: MGRSSquareFeature[]) => void;
  getGrids10km: (squareId: string) => MGRSSquareFeature[] | undefined;
  clearGrids10km: () => void;

  // Visible features for current viewport - computed by ViewportManager
  visible100kmSquares: MGRSSquareFeature[];
  setVisible100kmSquares: (squares: MGRSSquareFeature[]) => void;

  visible10kmGrids: MGRSSquareFeature[];
  setVisible10kmGrids: (grids: MGRSSquareFeature[]) => void;

  // Current viewport bounds - for optimization
  viewportBounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
  setViewportBounds: (bounds: { west: number; south: number; east: number; north: number } | null) => void;

  // Clear all cached data
  clearAll: () => void;
}

export const useMGRSStore = create<MGRSStore>((set, get) => ({
  // GZD data
  gzdData: null,
  gzdLoadError: false,
  setGzdData: (data) => set({ gzdData: data }),
  setGzdLoadError: (error) => set({ gzdLoadError: error }),

  // 100km squares
  squares100km: new Map(),
  setSquares100km: (gzd, squares) => {
    const current = get().squares100km;
    const updated = new Map(current);
    updated.set(gzd, squares);
    set({ squares100km: updated });
  },
  getSquares100km: (gzd) => {
    return get().squares100km.get(gzd);
  },
  clearSquares100km: () => set({ squares100km: new Map() }),

  // 10km grids
  grids10km: new Map(),
  setGrids10km: (squareId, grids) => {
    const current = get().grids10km;
    const updated = new Map(current);
    updated.set(squareId, grids);
    set({ grids10km: updated });
  },
  getGrids10km: (squareId) => {
    return get().grids10km.get(squareId);
  },
  clearGrids10km: () => set({ grids10km: new Map() }),

  // Visible features (computed by ViewportManager)
  visible100kmSquares: [],
  setVisible100kmSquares: (squares) => set({ visible100kmSquares: squares }),

  visible10kmGrids: [],
  setVisible10kmGrids: (grids) => set({ visible10kmGrids: grids }),

  // Viewport bounds
  viewportBounds: null,
  setViewportBounds: (bounds) => set({ viewportBounds: bounds }),

  // Clear all
  clearAll: () => set({
    squares100km: new Map(),
    grids10km: new Map(),
    visible100kmSquares: [],
    visible10kmGrids: [],
    viewportBounds: null,
  }),
}));
