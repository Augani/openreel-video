import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ScrubAudioState {
  /** Play short audio grains at the playhead while it is dragged. On by default. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

export const useScrubAudioStore = create<ScrubAudioState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set((state) => ({ enabled: !state.enabled })),
    }),
    { name: "openreel-scrub-audio", partialize: (state) => ({ enabled: state.enabled }) },
  ),
);
