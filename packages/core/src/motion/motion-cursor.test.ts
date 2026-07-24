import { describe, expect, it } from "vitest";
import { createCursorClick } from "./motion-cursor";
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

function makeButton(id: string, x: number, y: number): MotionShapeLayer {
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
    height: 80,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 1 },
      stroke: { color: "#14b8a6", width: 0, opacity: 0 },
      cornerRadius: 0,
    },
  };
}

describe("createCursorClick", () => {
  it("adds a cursor image layer that lands on the target + makes it react", () => {
    const button = makeButton("button", 800, 500);
    const composition = { ...baseComposition, layers: [button] };

    const result = createCursorClick(composition, button.id, { time: 0.5, travel: 0.8 });
    expect(result).not.toBeNull();
    const next = result!.composition;

    const cursor = next.layers.find((layer) => layer.id === result!.cursorLayerId);
    expect(cursor?.type).toBe("image");
    expect(next.assets.some((asset) => asset.type === "image")).toBe(true);

    const landX = cursor!.keyframes
      .filter((kf) => kf.property === "transform.position.x")
      .sort((p, q) => q.time - p.time)[0];
    expect(landX.value).toBe(800);

    const pressed = next.layers.find((layer) => layer.id === button.id);
    expect(pressed?.keyframes.some((kf) => kf.property === "transform.scale.x")).toBe(true);
  });

  it("returns null for a missing target", () => {
    expect(createCursorClick(baseComposition, "missing")).toBeNull();
  });
});
