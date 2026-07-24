import { describe, expect, it } from "vitest";
import { disintegrateMotionLayer } from "./motion-disintegrate";
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
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#14b8a6", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
  };
}

describe("disintegrateMotionLayer", () => {
  it("fades the layer out and adds a matching particle burst", () => {
    const shape = makeShape("shape", 400, 300);
    const composition = { ...baseComposition, layers: [shape] };

    const result = disintegrateMotionLayer(composition, shape.id, { time: 1 });
    expect(result).not.toBeNull();
    const next = result!.composition;

    const faded = next.layers.find((layer) => layer.id === shape.id);
    expect(faded?.keyframes.some((kf) => kf.property === "transform.opacity")).toBe(true);

    const burst = next.layers.find((layer) => layer.id === result!.particleLayerId);
    expect(burst?.type).toBe("particle");
    expect(burst?.transform.position.x).toBe(400);
    expect(burst?.startTime).toBe(1);
  });

  it("returns null for an unknown layer", () => {
    expect(disintegrateMotionLayer(baseComposition, "missing")).toBeNull();
  });
});
