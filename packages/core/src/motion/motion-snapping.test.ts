import { describe, expect, it } from "vitest";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { snapMotionLayerPosition } from "./motion-snapping";

const makeLayer = (
  id: string,
  position: { readonly x: number; readonly y: number },
): MotionLayer => ({
  id,
  type: "shape",
  name: id,
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position,
  },
  keyframes: [],
  shapeType: "rectangle",
  width: 100,
  height: 80,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeComposition = (): MotionComposition => ({
  id: "comp-1",
  name: "Scene",
  width: 1000,
  height: 600,
  frameRate: 30,
  duration: 5,
  backgroundColor: "transparent",
  layers: [makeLayer("a", { x: 100, y: 100 }), makeLayer("b", { x: 300, y: 240 })],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
});

describe("motion snapping", () => {
  it("snaps a moving layer to composition center guides", () => {
    const result = snapMotionLayerPosition(
      makeComposition(),
      "a",
      { x: 496, y: 303 },
      { threshold: 8 },
    );

    expect(result.position).toEqual({ x: 500, y: 300 });
    expect(result.guides).toEqual([
      { axis: "x", position: 500, kind: "composition", sourceLayerId: undefined },
      { axis: "y", position: 300, kind: "composition", sourceLayerId: undefined },
    ]);
  });

  it("snaps layer edges and centers to other visible layers", () => {
    const result = snapMotionLayerPosition(
      makeComposition(),
      "a",
      { x: 202, y: 240 },
      { threshold: 8, snapToComposition: false },
    );

    expect(result.position.x).toBe(200);
    expect(result.position.y).toBe(240);
    expect(result.guides).toContainEqual({
      axis: "x",
      position: 250,
      kind: "layer",
      sourceLayerId: "b",
    });
  });

  it("can snap layer anchors to a grid", () => {
    const result = snapMotionLayerPosition(
      makeComposition(),
      "a",
      { x: 157, y: 83 },
      {
        threshold: 8,
        gridSize: 40,
        snapToComposition: false,
        snapToLayers: false,
        snapToGrid: true,
      },
    );

    expect(result.position).toEqual({ x: 160, y: 80 });
    expect(result.guides.map((guide) => guide.kind)).toEqual(["grid", "grid"]);
  });

  it("ignores the other members of a moving selection", () => {
    const result = snapMotionLayerPosition(
      makeComposition(),
      "a",
      { x: 202, y: 240 },
      {
        threshold: 8,
        snapToComposition: false,
        ignoredLayerIds: ["b"],
      },
    );

    expect(result.position).toEqual({ x: 202, y: 240 });
    expect(result.guides).toEqual([]);
  });

  it("snaps layer anchors to persistent composition guides", () => {
    const composition: MotionComposition = {
      ...makeComposition(),
      guides: [
        { id: "guide-v", orientation: "vertical", position: 180 },
        { id: "guide-h", orientation: "horizontal", position: 260 },
      ],
    };
    const result = snapMotionLayerPosition(
      composition,
      "a",
      { x: 184, y: 257 },
      { threshold: 8, snapToComposition: false, snapToLayers: false },
    );

    expect(result.position).toEqual({ x: 180, y: 260 });
    expect(result.guides).toEqual([
      {
        axis: "x",
        position: 180,
        kind: "guide",
        sourceGuideId: "guide-v",
      },
      {
        axis: "y",
        position: 260,
        kind: "guide",
        sourceGuideId: "guide-h",
      },
    ]);
  });

  it("returns the proposed position when no target is close enough", () => {
    const result = snapMotionLayerPosition(
      makeComposition(),
      "a",
      { x: 460, y: 271 },
      { threshold: 3, snapToGrid: false },
    );

    expect(result).toEqual({
      position: { x: 460, y: 271 },
      guides: [],
      snapped: false,
    });
  });
});
