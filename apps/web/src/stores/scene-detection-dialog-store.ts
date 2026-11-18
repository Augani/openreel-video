import { create } from "zustand";

interface SceneDetectionDialogState {
  clipId: string | null;
  open: (clipId: string) => void;
  close: () => void;
}

export const useSceneDetectionDialogStore = create<SceneDetectionDialogState>(
  (set) => ({
    clipId: null,
    open: (clipId) => set({ clipId }),
    close: () => set({ clipId: null }),
  }),
);
