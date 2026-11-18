import { create } from "zustand";
import type { MulticamCut } from "@openreel/core";

export type MulticamGrid = "auto" | "2x2" | "3x3";

/**
 * Multicam monitor state. Nothing here is a timeline edit: it is the view
 * (grid size, which source is shown) and the in-flight recording pass. The
 * pass is committed as one undo step when playback stops (see
 * services/multicam-controller.ts).
 */
interface MulticamMonitorState {
  grid: MulticamGrid;
  /** Source shown when no multicam clip is under the playhead. */
  sourceId: string | null;
  recording: boolean;
  /** Timeline time the pass started. */
  passStart: number | null;
  /** Cuts of the pass in progress (timeline time, angle). */
  pending: MulticamCut[];
  /** True while the finished pass is being committed. */
  committing: boolean;
  setGrid: (grid: MulticamGrid) => void;
  setSourceId: (sourceId: string | null) => void;
  begin: (passStart: number) => void;
  addCut: (cut: MulticamCut) => void;
  finish: () => MulticamCut[];
  setCommitting: (committing: boolean) => void;
}

export const useMulticamStore = create<MulticamMonitorState>((set, get) => ({
  grid: "auto",
  sourceId: null,
  recording: false,
  passStart: null,
  pending: [],
  committing: false,
  setGrid: (grid) => set({ grid }),
  setSourceId: (sourceId) => set({ sourceId }),
  begin: (passStart) => set({ recording: true, passStart, pending: [] }),
  addCut: (cut) => set((state) => ({ pending: [...state.pending, cut] })),
  finish: () => {
    const cuts = get().pending;
    set({ recording: false, passStart: null, pending: [] });
    return cuts;
  },
  setCommitting: (committing) => set({ committing }),
}));

/** Grid columns for `count` angles: 2x2 up to four angles, 3x3 beyond. */
export function gridColumns(grid: MulticamGrid, count: number): number {
  if (grid === "2x2") return 2;
  if (grid === "3x3") return 3;
  return count <= 4 ? 2 : 3;
}
