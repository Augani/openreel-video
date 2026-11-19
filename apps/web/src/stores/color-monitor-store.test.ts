import { beforeEach, describe, expect, it } from "vitest";
import { useColorMonitorStore } from "./color-monitor-store";

const reset = () =>
  useColorMonitorStore.setState({
    comparison: { mode: "off", reference: "bypass", split: 0.5, stillId: null, refTime: null },
    stills: [],
    secondary: { clipId: null, effectId: null, matteView: 0, eyedropper: null },
    captureBusy: false,
    referenceRevision: 0,
    whiteBalancePick: null,
    whiteBalanceSize: 5,
    keyPicker: null,
  });

describe("color monitor store", () => {
  beforeEach(reset);

  it("toggles the comparison view and keeps the wipe inside the frame", () => {
    const store = useColorMonitorStore.getState();
    store.toggleComparison();
    expect(useColorMonitorStore.getState().comparison.mode).toBe("split-v");
    store.setComparison({ split: 4 });
    expect(useColorMonitorStore.getState().comparison.split).toBe(0.98);
    store.setComparison({ split: -1 });
    expect(useColorMonitorStore.getState().comparison.split).toBe(0.02);
    store.toggleComparison();
    expect(useColorMonitorStore.getState().comparison.mode).toBe("off");
  });

  it("a grabbed still becomes the reference and is dropped cleanly", () => {
    const store = useColorMonitorStore.getState();
    store.addStill({ id: "a", label: "Still 1", time: 1, width: 4, height: 2, thumb: "" });
    expect(useColorMonitorStore.getState().comparison).toMatchObject({ reference: "still", stillId: "a" });
    store.removeStill("a");
    expect(useColorMonitorStore.getState().stills).toEqual([]);
    expect(useColorMonitorStore.getState().comparison.stillId).toBeNull();
  });

  it("keeps only the newest twelve stills", () => {
    const store = useColorMonitorStore.getState();
    for (let i = 0; i < 15; i++) store.addStill({ id: `s${i}`, label: `S${i}`, time: i, width: 1, height: 1, thumb: "" });
    const stills = useColorMonitorStore.getState().stills;
    expect(stills).toHaveLength(12);
    expect(stills[0].id).toBe("s3");
  });

  it("arming the white balance eyedropper disarms the secondary one and vice versa", () => {
    const store = useColorMonitorStore.getState();
    store.setSecondaryView({ clipId: "c", effectId: "e", eyedropper: "set" });
    store.setWhiteBalancePick({ clipId: "c" });
    expect(useColorMonitorStore.getState().secondary.eyedropper).toBeNull();
    expect(useColorMonitorStore.getState().whiteBalancePick).toEqual({ clipId: "c" });
    store.setSecondaryView({ eyedropper: "add" });
    expect(useColorMonitorStore.getState().whiteBalancePick).toBeNull();
    store.setWhiteBalancePick({ clipId: "c" });
    store.setSecondaryView({ matteView: 2 });
    expect(useColorMonitorStore.getState().whiteBalancePick).toEqual({ clipId: "c" });
    store.setWhiteBalanceSize(1);
    expect(useColorMonitorStore.getState().whiteBalanceSize).toBe(1);
  });

  it("arming any one of the Ultra Key picker, White Balance and Secondary eyedroppers disarms the others", () => {
    const get = () => useColorMonitorStore.getState();
    const key = { clipId: "c", effectId: "e" };
    get().setKeyPicker(key);
    get().setWhiteBalancePick({ clipId: "c" });
    expect(get().keyPicker).toBeNull();
    expect(get().whiteBalancePick).toEqual({ clipId: "c" });

    get().setSecondaryView({ clipId: "c", effectId: "s", eyedropper: "add" });
    expect(get().whiteBalancePick).toBeNull();
    expect(get().keyPicker).toBeNull();

    get().setKeyPicker(key);
    expect(get().keyPicker).toEqual(key);
    expect(get().secondary.eyedropper).toBeNull();
    expect(get().whiteBalancePick).toBeNull();

    get().setKeyPicker(null);
    get().setWhiteBalancePick({ clipId: "c" });
    get().setWhiteBalancePick(null);
    expect(get().keyPicker).toBeNull();
  });
});
