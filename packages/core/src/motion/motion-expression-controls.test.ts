import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionLayerEffect,
  buildMotionCssFilter,
  buildMotionCanvasFilter,
  createMotionEffect,
  getMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptor,
  getMotionEffectParameterValue,
  getMotionEffectParameterValueAtTime,
  isMotionExpressionControlEffect,
  layerNeedsBufferedEffects,
  setMotionEffectParameterValue,
} from "./motion-effects";
import { createMotionExpression, evaluateMotionPropertyValueAtTime } from "./motion-expressions";

const makeLayer = (): MotionLayer => ({
  id: "layer-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 320,
  height: 180,
  style: {
    fill: { type: "solid", color: "#14b8a6", opacity: 1 },
    stroke: { color: "#0f766e", width: 0, opacity: 0 },
    cornerRadius: 12,
  },
});

const makeComposition = (layer: MotionLayer): MotionComposition => ({
  id: "comp-1",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers: [layer],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("motion expression controls", () => {
  it("creates slider, checkbox, and angle controls with default names and values", () => {
    const slider = createMotionEffect("slider-control", "slider-1");
    const checkbox = createMotionEffect("checkbox-control", "checkbox-1");
    const angle = createMotionEffect("angle-control", "angle-1");

    expect(slider).toMatchObject({ type: "slider-control", name: "Slider Control", value: 0 });
    expect(checkbox).toMatchObject({ type: "checkbox-control", name: "Checkbox Control", value: 0 });
    expect(angle).toMatchObject({ type: "angle-control", name: "Angle Control", value: 0 });
  });

  it("exposes a value descriptor and immutable get/set for each control", () => {
    const slider = createMotionEffect("slider-control", "slider-1");
    expect(getMotionEffectParameterDescriptor(slider, "value")).toBeDefined();

    const updated = setMotionEffectParameterValue(slider, "value", 42.5);
    expect(getMotionEffectParameterValue(updated, "value")).toBe(42.5);
    expect(getMotionEffectParameterValue(slider, "value")).toBe(0);
  });

  it("clamps checkbox control value to {0, 1}", () => {
    const checkbox = createMotionEffect("checkbox-control", "checkbox-1");
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(checkbox, "value", 1), "value")).toBe(1);
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(checkbox, "value", 0.4), "value")).toBe(0);
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(checkbox, "value", 0.6), "value")).toBe(1);
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(checkbox, "value", 5), "value")).toBe(1);
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(checkbox, "value", -3), "value")).toBe(0);
  });

  it("keeps slider control value unclamped and finite-guarded", () => {
    const slider = createMotionEffect("slider-control", "slider-1");
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(slider, "value", 1000), "value")).toBe(1000);
    expect(getMotionEffectParameterValue(setMotionEffectParameterValue(slider, "value", Number.NaN), "value")).toBe(0);
  });

  it("keyframes the control value and evaluates it at time", () => {
    const slider = { ...createMotionEffect("slider-control", "slider-1"), value: 0 };
    const keyframes: Keyframe[] = [
      {
        id: "k0",
        time: 0,
        property: getMotionEffectKeyframeProperty("slider-1", "value"),
        value: 0,
        easing: "linear",
      },
      {
        id: "k1",
        time: 1,
        property: getMotionEffectKeyframeProperty("slider-1", "value"),
        value: 100,
        easing: "linear",
      },
    ];
    expect(getMotionEffectParameterValueAtTime(slider, keyframes, "value", 0.5)).toBeCloseTo(50, 5);
  });

  it("flags controls via isMotionExpressionControlEffect and excludes non-controls", () => {
    expect(isMotionExpressionControlEffect(createMotionEffect("slider-control", "s"))).toBe(true);
    expect(isMotionExpressionControlEffect(createMotionEffect("checkbox-control", "c"))).toBe(true);
    expect(isMotionExpressionControlEffect(createMotionEffect("angle-control", "a"))).toBe(true);
    expect(isMotionExpressionControlEffect(createMotionEffect("blur", "b"))).toBe(false);
  });

  it("renders a controls-only layer as effect-less across render paths", () => {
    const layer = addMotionLayerEffect(makeLayer(), createMotionEffect("slider-control", "slider-1"));
    expect(layerNeedsBufferedEffects(layer)).toBe(false);
    expect(buildMotionCssFilter(layer.effects)).toBeUndefined();
    expect(buildMotionCanvasFilter(layer.effects)).toBe("none");
  });

  it("resolves the control value through effect(name)(\"value\")", () => {
    const slider = { ...createMotionEffect("slider-control", "slider-1"), value: 0.75 };
    const layer: MotionLayer = { ...makeLayer(), effects: [slider] };
    const composition = makeComposition(layer);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-slider"),
          code: 'effect("Slider Control")("value")',
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(0.75, 5);
  });

  it("coerces a mid-interpolation checkbox control read to 0 or 1", () => {
    const checkbox = createMotionEffect("checkbox-control", "checkbox-1");
    const property = getMotionEffectKeyframeProperty(checkbox.id, "value");
    const keyframes: Keyframe[] = [
      { id: "k0", time: 0, property, value: 0, easing: "linear" },
      { id: "k1", time: 2, property, value: 1, easing: "linear" },
    ];
    const layer: MotionLayer = { ...makeLayer(), effects: [checkbox], keyframes };
    const composition = makeComposition(layer);

    const readAt = (localTime: number): number =>
      evaluateMotionPropertyValueAtTime({
        keyframes: [],
        expressions: [
          {
            ...createMotionExpression("expression", "transform.opacity", "expr-cb"),
            code: 'effect("Checkbox Control")("value")',
          },
        ],
        property: "transform.opacity",
        localTime,
        fallback: 0,
        duration: 5,
        context: { composition, layer },
      });

    expect(readAt(0.8)).toBe(0);
    expect(readAt(1)).toBe(1);
    expect(readAt(1.4)).toBe(1);
    for (const t of [0.2, 0.6, 0.9, 1.1, 1.7]) {
      expect([0, 1]).toContain(readAt(t));
    }
  });
});
