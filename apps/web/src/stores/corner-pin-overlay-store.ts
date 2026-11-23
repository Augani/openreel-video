import { create } from "zustand";

/** Which Corner Pin effect instance the Program monitor is currently editing (null = none). */
export interface CornerPinOverlayState {
  clipId: string | null;
  effectId: string | null;
  open: (clipId: string, effectId: string) => void;
  close: () => void;
}

export const useCornerPinOverlayStore = create<CornerPinOverlayState>((set) => ({
  clipId: null,
  effectId: null,
  open: (clipId, effectId) => set({ clipId, effectId }),
  close: () => set({ clipId: null, effectId: null }),
}));
