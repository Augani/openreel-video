import { create } from "zustand";

/**
 * State of the Program monitor mask pen tool. The tool is armed for one clip;
 * `maskId` null means "draw a new mask", otherwise the vertices of that mask
 * are edited. Nothing here is project data: it is purely the tool's UI state.
 */
interface MaskPenState {
  active: boolean;
  clipId: string | null;
  maskId: string | null;
  vertex: number | null;
  arm: (clipId: string, maskId?: string | null) => void;
  disarm: () => void;
  setMask: (maskId: string | null) => void;
  setVertex: (vertex: number | null) => void;
}

export const useMaskPenStore = create<MaskPenState>((set) => ({
  active: false,
  clipId: null,
  maskId: null,
  vertex: null,
  arm: (clipId, maskId = null) => set({ active: true, clipId, maskId, vertex: null }),
  disarm: () => set({ active: false, clipId: null, maskId: null, vertex: null }),
  setMask: (maskId) => set({ maskId, vertex: null }),
  setVertex: (vertex) => set({ vertex }),
}));
