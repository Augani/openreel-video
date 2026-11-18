import { create } from "zustand";
import { persist } from "zustand/middleware";
import { droppedFrameLevel } from "@openreel/core";

/** Per-viewer preference: Premiere's "Show Dropped Frame Indicator". On by default, like Premiere. */
interface DroppedFrameIndicatorPrefs {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useDroppedFrameIndicatorPrefs = create<DroppedFrameIndicatorPrefs>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: "openreel-dropped-frame-indicator",
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);

export type IndicatorTone = "green" | "yellow" | "off";

export interface IndicatorView {
  tone: IndicatorTone;
  /** Text next to the dot ("" while off). */
  text: string;
  /** Accessible name and tooltip. */
  label: string;
}

/** Green while no frame was dropped in this playback run, yellow from the first drop, nothing while off. */
export function indicatorView(count: number, enabled: boolean): IndicatorView {
  if (!enabled) {
    return { tone: "off", text: "", label: "Dropped frame indicator is off" };
  }
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (droppedFrameLevel(safe) === "ok") {
    return { tone: "green", text: "0", label: "No dropped frames during this playback" };
  }
  return {
    tone: "yellow",
    text: String(safe),
    label: `${safe} dropped frame${safe === 1 ? "" : "s"} during this playback`,
  };
}
