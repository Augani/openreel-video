import { beforeEach, describe, expect, it } from "vitest";
import { clampTrackingRegion, dragTrackingRegion, MIN_TRACKING_REGION, useMotionTrackingOverlayStore } from "./motion-tracking-overlay-store";

const region = { x: 100, y: 80, width: 40, height: 30 };

describe("dragTrackingRegion", () => {
  it("moves the box and keeps it inside the media", () => {
    expect(dragTrackingRegion(region, "move", 10, -5, 640, 360)).toEqual({ x: 110, y: 75, width: 40, height: 30 });
    expect(dragTrackingRegion(region, "move", -500, -500, 640, 360)).toEqual({ x: 0, y: 0, width: 40, height: 30 });
    expect(dragTrackingRegion(region, "move", 900, 900, 640, 360)).toEqual({ x: 600, y: 330, width: 40, height: 30 });
  });

  it("resizes from each edge and corner without flipping or collapsing", () => {
    expect(dragTrackingRegion(region, "e", 20, 0, 640, 360)).toEqual({ x: 100, y: 80, width: 60, height: 30 });
    expect(dragTrackingRegion(region, "w", -20, 0, 640, 360)).toEqual({ x: 80, y: 80, width: 60, height: 30 });
    expect(dragTrackingRegion(region, "n", 0, -10, 640, 360)).toEqual({ x: 100, y: 70, width: 40, height: 40 });
    expect(dragTrackingRegion(region, "se", 5, 5, 640, 360)).toEqual({ x: 100, y: 80, width: 45, height: 35 });
    expect(dragTrackingRegion(region, "nw", 5, 5, 640, 360)).toEqual({ x: 105, y: 85, width: 35, height: 25 });
    // Dragging past the opposite edge stops at the minimum size.
    expect(dragTrackingRegion(region, "e", -500, 0, 640, 360).width).toBe(MIN_TRACKING_REGION);
    expect(dragTrackingRegion(region, "w", 500, 0, 640, 360).width).toBe(MIN_TRACKING_REGION);
    expect(dragTrackingRegion(region, "s", 0, -500, 640, 360).height).toBe(MIN_TRACKING_REGION);
  });

  it("clamps to whole source pixels inside the frame", () => {
    expect(clampTrackingRegion({ x: -3.4, y: 1.6, width: 9000, height: 2 }, 640, 360)).toEqual({ x: 0, y: 2, width: 640, height: MIN_TRACKING_REGION });
  });
});

describe("motion tracking overlay store", () => {
  beforeEach(() => useMotionTrackingOverlayStore.setState({ clipId: null, region: null, point: null, editRevision: 0 }));

  it("only mirrors and accepts edits for the clip it was opened for, and counts overlay edits", () => {
    const store = useMotionTrackingOverlayStore.getState();
    store.open({ clipId: "a", region, mediaWidth: 640, mediaHeight: 360, searchMargin: 21 });
    store.mirror("b", { ...region, x: 1 });
    expect(useMotionTrackingOverlayStore.getState().region).toEqual(region);
    store.mirror("a", { ...region, x: 5 });
    expect(useMotionTrackingOverlayStore.getState().region?.x).toBe(5);
    expect(useMotionTrackingOverlayStore.getState().editRevision).toBe(0);
    store.edit({ ...region, x: 7 });
    expect(useMotionTrackingOverlayStore.getState().editRevision).toBe(1);
    store.edit({ ...region, x: 7 });
    expect(useMotionTrackingOverlayStore.getState().editRevision).toBe(1);
    store.close("b");
    expect(useMotionTrackingOverlayStore.getState().clipId).toBe("a");
    store.close("a");
    expect(useMotionTrackingOverlayStore.getState().clipId).toBeNull();
  });
});
