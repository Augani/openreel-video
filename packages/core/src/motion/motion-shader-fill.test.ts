import { describe, expect, it } from "vitest";
import {
  createDefaultMotionShaderFill,
  createSolidMotionFill,
} from "./motion-shape-style";
import { layerHasMotionShaderFill } from "./motion-effects";
import type { MotionLayer } from "./types";

function makeShapeLayer(fill: ReturnType<typeof createSolidMotionFill>): MotionLayer {
  return {
    id: "layer-1",
    type: "shape",
    name: "Shape",
    start: 0,
    duration: 1000,
    keyframes: [],
    width: 200,
    height: 200,
    style: { fill, stroke: { color: "#000000", width: 0, opacity: 0 } },
  } as unknown as MotionLayer;
}

describe("motion shader fill", () => {

  it("classifies a shape with a shader fill", () => {
    const shaderLayer = makeShapeLayer(createDefaultMotionShaderFill("liquid-metal"));
    expect(layerHasMotionShaderFill(shaderLayer)).toBe(true);
  });

});
