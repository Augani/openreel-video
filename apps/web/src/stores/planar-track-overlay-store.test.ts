import { describe, expect, it } from "vitest";
import { defaultPlanarCorners, dragPlanarCorner, dragPlanarQuad, usePlanarTrackOverlayStore } from "./planar-track-overlay-store";

describe("planar track overlay store", () => {
  const quad = [100, 100, 300, 100, 300, 200, 100, 200];

  it("drags one corner and keeps it inside the media", () => {
    expect(dragPlanarCorner(quad, 2, 20, -10, 640, 360).slice(4, 6)).toEqual([320, 190]);
    expect(dragPlanarCorner(quad, 0, -500, -500, 640, 360).slice(0, 2)).toEqual([0, 0]);
  });

  it("moves the whole quad but never past an edge", () => {
    expect(dragPlanarQuad(quad, 10, 5, 640, 360)).toEqual([110, 105, 310, 105, 310, 205, 110, 205]);
    expect(dragPlanarQuad(quad, 9999, 0, 640, 360).filter((_, i) => i % 2 === 0)).toEqual([440, 640, 640, 440]);
  });

  it("proposes a centred default quad", () => {
    expect(defaultPlanarCorners(640, 360)).toEqual([192, 108, 448, 108, 448, 252, 192, 252]);
  });

  it("mirrors Inspector writes without bumping the edit revision, and counts overlay edits", () => {
    const s = usePlanarTrackOverlayStore;
    s.getState().open({ clipId: "a", corners: quad, mediaWidth: 640, mediaHeight: 360 });
    s.getState().mirror("a", [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.getState().editRevision).toBe(0);
    s.getState().edit(quad);
    expect(s.getState().editRevision).toBe(1);
    s.getState().mirror("other", [0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.getState().corners).toEqual(quad);
    s.getState().close("a");
    expect(s.getState().corners).toBeNull();
  });
});
