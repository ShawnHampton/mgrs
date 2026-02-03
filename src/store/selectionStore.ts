import { create } from 'zustand';
import type { CellEntry } from '../types/types';

interface SelectionState {
  selectionEnabled: boolean;
  hoveredCell: CellEntry | null;
  selectedCells: Map<string, CellEntry>;

  setSelectionEnabled: (enabled: boolean) => void;
  setHoveredCell: (cell: CellEntry | null) => void;
  toggleSelectedCell: (cell: CellEntry) => void;
  clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectionEnabled: false,
  hoveredCell: null,
  selectedCells: new Map(),

  setSelectionEnabled: (enabled) =>
    set({
      selectionEnabled: enabled,
      hoveredCell: enabled ? get().hoveredCell : null,
    }),

  setHoveredCell: (cell) => {
    const current = get().hoveredCell;
    if (cell?.mgrsId === current?.mgrsId) return;
    set({ hoveredCell: cell });
  },

  toggleSelectedCell: (cell) => {
    const prev = get().selectedCells;
    const next = new Map(prev);
    if (next.has(cell.mgrsId)) {
      next.delete(cell.mgrsId);
    } else {
      next.set(cell.mgrsId, cell);
    }
    set({ selectedCells: next });
  },

  clearSelection: () => set({ selectedCells: new Map() }),
}));
