import { describe, expect, it, vi } from "vitest";
import {
  createDefaultMotionShaderFill,
  createSolidMotionFill,
  isShaderFill,
} from "./motion-shape-style";
import { layerHasMotionShaderFill } from "./motion-effects";
import { positionMotionShaderPattern } from "./motion-renderer";
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
  it("builds a shader fill with default params", () => {
    const fill = createDefaultMotionShaderFill("liquid-metal");
    expect(fill.type).toBe("shader");
    expect(isShaderFill(fill)).toBe(true);
    expect(fill.shader?.shaderId).toBe("liquid-metal");
    expect(fill.shader?.params.scale).toBe(6);
  });

  it("classifies a shape with a shader fill", () => {
    const shaderLayer = makeShapeLayer(createDefaultMotionShaderFill("liquid-metal"));
    expect(layerHasMotionShaderFill(shaderLayer)).toBe(true);
  });

  it("does not classify a solid-fill shape", () => {
    const solidLayer = makeShapeLayer(createSolidMotionFill("#ff0000"));
    expect(layerHasMotionShaderFill(solidLayer)).toBe(false);
  });

  it("positions a generated shader texture over centered layer bounds", () => {
    const setTransform = vi.fn();
    const pattern = { setTransform } as unknown as CanvasPattern;

    expect(positionMotionShaderPattern(pattern, -100, -50)).toBe(pattern);
    expect(setTransform).toHaveBeenCalledWith({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: -100,
      f: -50,
    });
  });
});
