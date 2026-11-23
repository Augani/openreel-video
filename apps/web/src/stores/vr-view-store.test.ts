import { beforeEach, describe, expect, it } from "vitest";
import { useSourceVrViewStore, useVrViewStore } from "./vr-view-store";

describe("VR view store", () => {
  beforeEach(() => {
    useVrViewStore.setState({ enabled: false, view: { fov: 90, pan: 0, tilt: 0, roll: 0 } });
  });

  it("starts off and straight ahead", () => {
    const s = useVrViewStore.getState();
    expect(s.enabled).toBe(false);
    expect(s.view).toEqual({ fov: 90, pan: 0, tilt: 0, roll: 0 });
  });

  it("drags pan around the seam and stops tilt before the poles", () => {
    const { nudge } = useVrViewStore.getState();
    nudge(200, 0);
    expect(useVrViewStore.getState().view.pan).toBeCloseTo(-160, 6);
    nudge(0, 500);
    expect(useVrViewStore.getState().view.tilt).toBe(89);
    nudge(0, -1000);
    expect(useVrViewStore.getState().view.tilt).toBe(-89);
  });

  it("limits the field of view and resets", () => {
    const { setFov, reset, nudge } = useVrViewStore.getState();
    setFov(500);
    expect(useVrViewStore.getState().view.fov).toBe(140);
    setFov(1);
    expect(useVrViewStore.getState().view.fov).toBe(20);
    nudge(30, 10);
    reset();
    expect(useVrViewStore.getState().view).toEqual({ fov: 90, pan: 0, tilt: 0, roll: 0 });
  });

  it("the Source monitor view is independent of the Program monitor view", () => {
    useSourceVrViewStore.setState({ enabled: false, view: { fov: 90, pan: 0, tilt: 0, roll: 0 } });
    useSourceVrViewStore.getState().setEnabled(true);
    useSourceVrViewStore.getState().nudge(30, 10);
    expect(useVrViewStore.getState().enabled).toBe(false);
    expect(useVrViewStore.getState().view.pan).toBe(0);
    expect(useSourceVrViewStore.getState().view.pan).toBeCloseTo(30, 6);
    useSourceVrViewStore.getState().reset();
    expect(useSourceVrViewStore.getState().view).toEqual({ fov: 90, pan: 0, tilt: 0, roll: 0 });
  });
});
