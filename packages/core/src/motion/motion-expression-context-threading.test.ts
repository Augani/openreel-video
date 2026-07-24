import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import type { MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { createMotionExpression } from "./motion-expressions";
import { evaluateMotionShapeLayerStyleAtTime } from "./motion-shape-style";
import { evaluateMotionShapeModifiersAtTime } from "./motion-shape-modifiers";
import {
  createMotionEffect,
  getMotionEffectParameterValueAtTime,
  setMotionEffectParameterValue,
} from "./motion-effects";
import { evaluateMotionLayerMasksAtTime } from "./motion-masks";
import { createMotionMask } from "./motion-masks";
import { getMotionEffectKeyframeProperty } from "./motion-effects";
import { getMotionTransformAtTime } from "./motion-renderer";

const makeShapeLayer = (
  overrides: Partial<Extract<MotionLayer, { type: "shape" }>> = {},
): Extract<MotionLayer, { type: "shape" }> => ({
  id: "shape-1",
  type: "shape",
  name: "Panel",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: DEFAULT_MOTION_TRANSFORM,
  keyframes: [],
  shapeType: "rectangle",
  width: 200,
  height: 120,
  style: {
    fill: { type: "solid", color: "#ffffff", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
  ...overrides,
});

const makeSourceLayer = (): MotionLayer => ({
  id: "source-1",
  type: "shape",
  name: "Source",
  startTime: 0,
  duration: 5,
  visible: true,
  locked: false,
  transform: {
    ...DEFAULT_MOTION_TRANSFORM,
    position: { ...DEFAULT_MOTION_TRANSFORM.position, x: 321 },
  },
  keyframes: [
    {
      id: "src-x",
      time: 0,
      property: "transform.position.x",
      value: 321,
      easing: "linear",
    } satisfies Keyframe,
  ],
  shapeType: "rectangle",
  width: 100,
  height: 100,
  style: {
    fill: { type: "solid", color: "#ffffff", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

const makeComposition = (layers: readonly MotionLayer[]): MotionComposition => ({
  id: "comp-1",
  name: "Comp",
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 5,
  backgroundColor: "#000000",
  layers: [...layers],
  assets: [],
  variables: [],
  markers: [],
  createdAt: 0,
  modifiedAt: 0,
});

describe("C1 — stage preview transform context threading", () => {
  it("resolves a thisComp transform.position.x expression through getMotionTransformAtTime with context", () => {
    const source = makeSourceLayer();
    const target = makeShapeLayer({
      id: "target-1",
      name: "Target",
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "e-tx"),
          code: 'thisComp.layer("Source").value("transform.position.x") + 9',
        },
      ],
    });
    const composition = makeComposition([source, target]);

    const withContext = getMotionTransformAtTime(
      target.transform,
      target.keyframes,
      0,
      target.expressions,
      target.duration,
      target.autoOrient,
      { composition, layer: target },
    );
    expect(withContext.position.x).toBeCloseTo(330, 5);

    const withoutContext = getMotionTransformAtTime(
      target.transform,
      target.keyframes,
      0,
      target.expressions,
      target.duration,
    );
    expect(withoutContext.position.x).toBe(target.transform.position.x);
  });
});

describe("C2 — shape style context threading", () => {
  it("resolves a thisComp expression on shape.fill.opacity WITH composition", () => {
    const source = makeSourceLayer();
    const shape = makeShapeLayer({
      id: "shape-styled",
      name: "Styled",
      expressions: [
        {
          ...createMotionExpression("expression", "shape.fill.opacity", "e1"),
          code: 'thisComp.layer("Source").value("transform.position.x") / 1000',
        },
      ],
    });
    const composition = makeComposition([source, shape]);

    const evaluated = evaluateMotionShapeLayerStyleAtTime(shape, 0, composition);
    expect(evaluated.style.fill.opacity).toBeCloseTo(0.321, 5);
  });

  it("falls back to the base opacity without composition (context-less caller)", () => {
    const shape = makeShapeLayer({
      id: "shape-styled",
      name: "Styled",
      expressions: [
        {
          ...createMotionExpression("expression", "shape.fill.opacity", "e1"),
          code: 'thisComp.layer("Source").value("transform.position.x") / 1000',
        },
      ],
    });

    const evaluated = evaluateMotionShapeLayerStyleAtTime(shape, 0);
    expect(evaluated.style.fill.opacity).toBe(1);
  });
});

describe("C2 — shape modifier context threading", () => {
  it("resolves a thisComp expression on a modifier property WITH composition", () => {
    const source = makeSourceLayer();
    const shape = makeShapeLayer({
      id: "shape-mod",
      name: "Modded",
      modifiers: [
        {
          id: "mod-1",
          type: "trim-paths",
          name: "Trim Paths",
          enabled: true,
          start: 0,
          end: 1,
          offset: 0,
        },
      ],
      expressions: [
        {
          ...createMotionExpression("expression", "modifier.mod-1.end", "e-mod"),
          code: 'thisComp.layer("Source").value("transform.position.x") / 1000',
        },
      ],
    });
    const composition = makeComposition([source, shape]);

    const evaluated = evaluateMotionShapeModifiersAtTime(shape, 0, composition);
    const trim = evaluated.modifiers?.find((entry) => entry.id === "mod-1");
    expect(trim?.type).toBe("trim-paths");
    if (trim?.type === "trim-paths") {
      expect(trim.end).toBeCloseTo(0.321, 5);
    }
  });
});

describe("C3 — effect param context threading", () => {
  it("resolves an effect param expression referencing thisComp WITH composition", () => {
    const source = makeSourceLayer();
    const blur = createMotionEffect("blur", "fx-blur");
    const layer = makeShapeLayer({
      id: "shape-fx",
      name: "FX",
      effects: [blur],
      expressions: [
        {
          ...createMotionExpression(
            "expression",
            getMotionEffectKeyframeProperty(blur.id, "radius"),
            "e-fx",
          ),
          code: 'thisComp.layer("Source").value("transform.position.x") / 10',
        },
      ],
    });
    const composition = makeComposition([source, layer]);

    const value = getMotionEffectParameterValueAtTime(
      blur,
      layer.keyframes,
      "radius",
      0,
      layer.expressions,
      layer.duration,
      composition,
      layer,
    );
    expect(value).toBeCloseTo(32.1, 5);
  });

  it("falls back to the base radius without composition", () => {
    const blur = setMotionEffectParameterValue(
      createMotionEffect("blur", "fx-blur"),
      "radius",
      8,
    );
    const layer = makeShapeLayer({
      id: "shape-fx",
      name: "FX",
      effects: [blur],
      expressions: [
        {
          ...createMotionExpression(
            "expression",
            getMotionEffectKeyframeProperty(blur.id, "radius"),
            "e-fx",
          ),
          code: 'thisComp.layer("Source").value("transform.position.x") / 10',
        },
      ],
    });

    const value = getMotionEffectParameterValueAtTime(
      blur,
      layer.keyframes,
      "radius",
      0,
      layer.expressions,
      layer.duration,
    );
    expect(value).toBe(8);
  });
});

describe("I1 — mask property context threading", () => {
  it("resolves a mask feather expression referencing thisComp WITH composition", () => {
    const source = makeSourceLayer();
    const mask = createMotionMask("rectangle", "mask-1");
    const layer = makeShapeLayer({
      id: "shape-mask",
      name: "Masked",
      masks: [mask],
      expressions: [
        {
          ...createMotionExpression("expression", `mask.${mask.id}.feather`, "e-mask"),
          code: 'thisComp.layer("Source").value("transform.position.x") / 10',
        },
      ],
    });
    const composition = makeComposition([source, layer]);

    const evaluated = evaluateMotionLayerMasksAtTime(layer, 0, composition);
    const evaluatedMask = evaluated.masks?.find((entry) => entry.id === mask.id);
    expect(evaluatedMask?.feather).toBeCloseTo(32.1, 5);
  });
});
