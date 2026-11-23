import { create } from "zustand";
import { clampVrView, DEFAULT_VR_VIEW, type VrViewParams } from "@openreel/core/video/vr-view-params";

/**
 * Program monitor VR view state (Premiere's VR Video toggle): a rectilinear window onto the equirectangular
 * program frame. View only: nothing here reaches the project, the render cache or an export.
 */
interface VrViewState {
  enabled: boolean;
  view: Pick<VrViewParams, "fov" | "pan" | "tilt" | "roll">;
  setEnabled: (enabled: boolean) => void;
  /** Drags pan / tilt by degrees. */
  nudge: (dPan: number, dTilt: number) => void;
  setFov: (fov: number) => void;
  reset: () => void;
}

const HOME = { fov: DEFAULT_VR_VIEW.fov, pan: 0, tilt: 0, roll: 0 };

/** One independent view state; the Program and Source monitors each have their own. */
const createVrViewStore = () =>
  create<VrViewState>((set) => ({
  enabled: false,
  view: HOME,
  setEnabled: (enabled) => set({ enabled }),
  nudge: (dPan, dTilt) =>
    set((state) => {
      const next = clampVrView({ ...DEFAULT_VR_VIEW, ...state.view, pan: state.view.pan + dPan, tilt: state.view.tilt + dTilt });
      return { view: { fov: next.fov, pan: next.pan, tilt: next.tilt, roll: next.roll } };
    }),
  setFov: (fov) =>
    set((state) => {
      const next = clampVrView({ ...DEFAULT_VR_VIEW, ...state.view, fov });
      return { view: { fov: next.fov, pan: next.pan, tilt: next.tilt, roll: next.roll } };
    }),
  reset: () => set({ view: HOME }),
}));

export const useVrViewStore = createVrViewStore();
/** The Source monitor's VR video view (view only like the Program monitor's; independent of it). */
export const useSourceVrViewStore = createVrViewStore();
export type VrViewStore = typeof useVrViewStore;
