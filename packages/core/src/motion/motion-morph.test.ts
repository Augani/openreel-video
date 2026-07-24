import { describe, expect, it } from "vitest";
import { morphMotionLayers } from "./motion-morph";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { MotionComposition, MotionShapeLayer } from "./types";

const baseComposition: MotionComposition = {
  id: "comp-1",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers: [],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 1,
  modifiedAt: 1,
};

function makeShape(id: string, x: number, y: number): MotionShapeLayer {
  return {
    id,
    type: "shape",
    name: id,
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position: { x, y, z: 0 } },
    keyframes: [],
    shapeType: "rectangle",
    width: 100,
    height: 100,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#14b8a6", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
  };
}

function opacityKeyframes(layer: { keyframes: { property: string }[] }): number {
  return layer.keyframes.filter((kf) => kf.property === "transform.opacity").length;
}

describe("morphMotionLayers", () => {
  it("crossfades A out, B in, and tweens B from A's transform", () => {
    const a = makeShape("a", 200, 200);
    const b = makeShape("b", 900, 600);
    const composition = { ...baseComposition, layers: [a, b] };

    const next = morphMotionLayers(composition, a.id, b.id, { time: 1 });
    expect(next).not.toBeNull();
    const fromNext = next!.layers.find((layer) => layer.id === a.id)!;
    const toNext = next!.layers.find((layer) => layer.id === b.id)!;

    expect(opacityKeyframes(fromNext)).toBe(2);
    expect(opacityKeyframes(toNext)).toBe(2);
    const bx = toNext.keyframes
      .filter((kf) => kf.property === "transform.position.x")
      .sort((p, q) => p.time - q.time);
    expect(bx.length).toBe(2);
    expect(bx[0].value).toBe(200);
    expect(bx[1].value).toBe(900);
  });

  it("returns null for the same or missing layer", () => {
    const a = makeShape("a", 0, 0);
    const composition = { ...baseComposition, layers: [a] };
    expect(morphMotionLayers(composition, a.id, a.id)).toBeNull();
    expect(morphMotionLayers(composition, a.id, "missing")).toBeNull();
  });

  it("returns null when a layer is not on-screen during the morph window", () => {
    const a = makeShape("a", 0, 0);
    const b = { ...makeShape("b", 0, 0), startTime: 4, duration: 1 };
    const composition = { ...baseComposition, layers: [a, b] };
    expect(morphMotionLayers(composition, a.id, b.id, { time: 0.5 })).toBeNull();
  });
});
