import { describe, expect, it } from "vitest";
import type { MotionShapeLayer, MotionTextLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { createDefaultMotionShaderFill } from "./motion-shape-style";
import {
  getMotionLayerPropertyValueAtTime,
  getMotionLayerPropertyValue,
  getMotionLayerShaderFillPropertyDescriptors,
  isMotionAnimatableProperty,
  parseMotionShaderFillKeyframeProperty,
  setMotionLayerPropertyValue,
  upsertMotionLayerKeyframe,
} from "./motion-keyframes";
import { getMotionShaderDef } from "./shaders";
import { resolveMotionShaderFillParams } from "./motion-renderer";

const numeric = (value: number | string | undefined): number => {
  if (typeof value !== "number") {
    throw new Error(`expected numeric param, got ${String(value)}`);
  }
  return value;
};

const makeShapeLayer = (): MotionShapeLayer => {
  const fill = createDefaultMotionShaderFill("liquid-metal");
  return {
    id: "shape-1",
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 5,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 120,
    height: 80,
    style: {
      fill: {
        ...fill,
        shader: fill.shader
          ? { ...fill.shader, params: { ...fill.shader.params, scale: 6 } }
          : undefined,
      },
      stroke: { color: "#ffffff", width: 4, opacity: 1, dashOffset: 0 },
      cornerRadius: 8,
    },
  };
};

const makeTextLayer = (): MotionTextLayer => ({
  id: "text-1",
  type: "text",
  name: "Title",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  text: "Hello",
  style: {
    fontFamily: "Inter",
    fontSize: 72,
    color: "#ffffff",
    fillShader: { shaderId: "liquid-metal", params: { contrast: 1.8 } },
  },
});

describe("shader fill keyframe properties", () => {
  it("recognizes shader fill keyframe properties", () => {
    expect(isMotionAnimatableProperty("shape.fill.shader.scale")).toBe(true);
    expect(isMotionAnimatableProperty("text.fillShader.contrast")).toBe(true);
    expect(isMotionAnimatableProperty("shape.fill.shader.")).toBe(false);
    expect(isMotionAnimatableProperty("text.fillShader.")).toBe(false);
  });

  it("parses shader fill keyframe properties", () => {
    expect(parseMotionShaderFillKeyframeProperty("shape.fill.shader.scale")).toEqual({
      surface: "shape",
      param: "scale",
    });
    expect(
      parseMotionShaderFillKeyframeProperty("text.fillShader.contrast"),
    ).toEqual({ surface: "text", param: "contrast" });
    expect(parseMotionShaderFillKeyframeProperty("shape.width")).toBeUndefined();
  });

  it("resolves shader fill base values from the layer", () => {
    const shape = makeShapeLayer();
    expect(
      getMotionLayerPropertyValueAtTime(shape, "shape.fill.shader.scale", 0),
    ).toBe(6);

    const text = makeTextLayer();
    expect(
      getMotionLayerPropertyValueAtTime(text, "text.fillShader.contrast", 0),
    ).toBe(1.8);
  });

  it("falls back to the shader def default when a param is unset", () => {
    const text = makeTextLayer();
    expect(
      getMotionLayerPropertyValueAtTime(text, "text.fillShader.scale", 0),
    ).toBe(6);
  });

  it("returns descriptors for the active shader fill params", () => {
    const descriptors = getMotionLayerShaderFillPropertyDescriptors(makeShapeLayer());
    expect(descriptors.map((descriptor) => descriptor.property)).toContain(
      "shape.fill.shader.scale",
    );
    const scaleDescriptor = descriptors.find(
      (descriptor) => descriptor.property === "shape.fill.shader.scale",
    );
    expect(scaleDescriptor?.defaultValue).toBe(6);
    expect(scaleDescriptor?.min).toBe(1);
    expect(scaleDescriptor?.max).toBe(20);

    const textDescriptors = getMotionLayerShaderFillPropertyDescriptors(
      makeTextLayer(),
    );
    expect(textDescriptors.map((descriptor) => descriptor.property)).toContain(
      "text.fillShader.contrast",
    );
  });

  it("samples keyframed shader fill params per frame", () => {
    const def = getMotionShaderDef("liquid-metal");
    if (!def) throw new Error("liquid-metal shader def missing");

    let shape = makeShapeLayer();
    shape = upsertMotionLayerKeyframe(shape, "shape.fill.shader.scale", 0, {
      value: 2,
    });
    shape = upsertMotionLayerKeyframe(shape, "shape.fill.shader.scale", 1, {
      value: 18,
    });

    const fill = shape.style.fill;
    if (fill.type !== "shader" || !fill.shader) {
      throw new Error("expected shader fill");
    }
    const base = fill.shader.params;

    const atStart = resolveMotionShaderFillParams(
      shape,
      base,
      "shape.fill.shader",
      def,
      0,
    );
    const atEnd = resolveMotionShaderFillParams(
      shape,
      base,
      "shape.fill.shader",
      def,
      1,
    );

    expect(numeric(atStart.scale)).toBeCloseTo(2);
    expect(numeric(atEnd.scale)).toBeCloseTo(18);
    expect(numeric(atStart.scale)).not.toBeCloseTo(numeric(atEnd.scale));
  });

  it("returns base params unchanged when no fill-shader keyframes exist", () => {
    const def = getMotionShaderDef("liquid-metal");
    if (!def) throw new Error("liquid-metal shader def missing");
    const shape = makeShapeLayer();
    const fill = shape.style.fill;
    if (fill.type !== "shader" || !fill.shader) {
      throw new Error("expected shader fill");
    }
    const base = fill.shader.params;
    expect(
      resolveMotionShaderFillParams(shape, base, "shape.fill.shader", def, 0.5),
    ).toBe(base);
  });

  it("writes a shape shader fill param via the property setter", () => {
    const shape = makeShapeLayer();
    const next = setMotionLayerPropertyValue(shape, "shape.fill.shader.scale", 12);
    const fill = next.style.fill;
    if (fill.type !== "shader" || !fill.shader) {
      throw new Error("expected shader fill");
    }
    expect(fill.shader.params.scale).toBe(12);
    expect(getMotionLayerPropertyValue(next, "shape.fill.shader.scale")).toBe(12);
  });

  it("clamps shape shader fill param writes to the shader def range", () => {
    const shape = makeShapeLayer();
    const next = setMotionLayerPropertyValue(shape, "shape.fill.shader.scale", 999);
    const fill = next.style.fill;
    if (fill.type !== "shader" || !fill.shader) {
      throw new Error("expected shader fill");
    }
    expect(fill.shader.params.scale).toBe(20);
  });

  it("writes a text shader fill param via the property setter", () => {
    const text = makeTextLayer();
    const next = setMotionLayerPropertyValue(text, "text.fillShader.contrast", 2.5);
    expect(next.style.fillShader?.params.contrast).toBe(2.5);
    expect(text.style.fillShader?.params.contrast).toBe(1.8);
  });
});
