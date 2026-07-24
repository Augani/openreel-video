import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import type { MotionComposition, MotionEffect, MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionLayerExpression,
  clearMotionExpressionError,
  createMotionExpression,
  evaluateMotionPropertyValueAtTime,
  getMotionExpressionError,
  getMotionLayerExpression,
  MOTION_EXPRESSION_SCOPE_KEYS,
  removeMotionLayerExpression,
  toggleMotionLayerExpression,
  updateMotionLayerExpression,
} from "./motion-expressions";
import "./motion-keyframes";

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
  width: 100,
  height: 100,
  style: {
    fill: { type: "solid", color: "#ffffff", opacity: 1 },
    stroke: { color: "#ffffff", width: 0, opacity: 0 },
    cornerRadius: 0,
  },
});

describe("motion expressions", () => {
  it("adds, updates, toggles, and removes expressions immutably", () => {
    const layer = makeLayer();
    const expression = createMotionExpression(
      "sine",
      "transform.position.x",
      "expr-1",
    );
    const withExpression = addMotionLayerExpression(layer, expression);
    const updated = updateMotionLayerExpression(
      withExpression,
      "expr-1",
      (current) => ({ ...current, amplitude: 42 }),
    );
    const disabled = toggleMotionLayerExpression(updated, "expr-1", false);
    const removed = removeMotionLayerExpression(disabled, "expr-1");

    expect(layer.expressions).toBeUndefined();
    expect(getMotionLayerExpression(updated, "transform.position.x")).toMatchObject({
      amplitude: 42,
      type: "sine",
    });
    expect(disabled.expressions?.[0]?.enabled).toBe(false);
    expect(removed.expressions).toEqual([]);
  });

  it("evaluates sine expressions around the keyed or base value", () => {
    const expression = {
      ...createMotionExpression("sine", "transform.position.x", "expr-1"),
      amplitude: 10,
      frequency: 1,
      phase: 0,
    };

    expect(
      evaluateMotionPropertyValueAtTime({
        keyframes: [],
        expressions: [expression],
        property: "transform.position.x",
        localTime: 0.25,
        fallback: 100,
        duration: 5,
      }),
    ).toBeCloseTo(110, 5);
  });

  it("keeps wiggle deterministic for a seed and time", () => {
    const expression = {
      ...createMotionExpression("wiggle", "transform.rotation", "expr-1"),
      amplitude: 15,
      frequency: 3,
      seed: 22,
    };
    const valueA = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [expression],
      property: "transform.rotation",
      localTime: 1.25,
      fallback: 0,
      duration: 5,
    });
    const valueB = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [expression],
      property: "transform.rotation",
      localTime: 1.25,
      fallback: 0,
      duration: 5,
    });

    expect(valueA).toBe(valueB);
    expect(valueA).toBeGreaterThanOrEqual(-15);
    expect(valueA).toBeLessThanOrEqual(15);
  });

  it("loops property keyframes after the last keyframe", () => {
    const expression = createMotionExpression(
      "loop",
      "transform.position.x",
      "expr-1",
    );
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [
        {
          id: "a",
          time: 0,
          property: "transform.position.x",
          value: 0,
          easing: "linear",
        },
        {
          id: "b",
          time: 1,
          property: "transform.position.x",
          value: 100,
          easing: "linear",
        },
      ],
      expressions: [expression],
      property: "transform.position.x",
      localTime: 1.5,
      fallback: 0,
      duration: 5,
    });

    expect(value).toBeCloseTo(50, 5);
  });

  it("ping-pongs property keyframes after the last keyframe", () => {
    const expression = createMotionExpression(
      "ping-pong",
      "transform.position.x",
      "expr-1",
    );
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [
        {
          id: "a",
          time: 0,
          property: "transform.position.x",
          value: 0,
          easing: "linear",
        },
        {
          id: "b",
          time: 1,
          property: "transform.position.x",
          value: 100,
          easing: "linear",
        },
      ],
      expressions: [expression],
      property: "transform.position.x",
      localTime: 1.25,
      fallback: 0,
      duration: 5,
    });

    expect(value).toBeCloseTo(75, 5);
  });

  it("adds seeded stepped random jitter around the base value", () => {
    const expression = {
      ...createMotionExpression("random", "transform.rotation", "expr-1"),
      amplitude: 12,
      frequency: 4,
      seed: 99,
    };
    const first = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [expression],
      property: "transform.rotation",
      localTime: 0.3,
      fallback: 45,
      duration: 5,
    });
    const second = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [expression],
      property: "transform.rotation",
      localTime: 0.31,
      fallback: 45,
      duration: 5,
    });

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(33);
    expect(first).toBeLessThanOrEqual(57);
  });

  it("posterizes keyframed values to a lower sample rate", () => {
    const expression = {
      ...createMotionExpression("posterize", "transform.position.x", "expr-1"),
      frequency: 2,
    };
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [
        {
          id: "a",
          time: 0,
          property: "transform.position.x",
          value: 0,
          easing: "linear",
        },
        {
          id: "b",
          time: 1,
          property: "transform.position.x",
          value: 100,
          easing: "linear",
        },
      ],
      expressions: [expression],
      property: "transform.position.x",
      localTime: 0.75,
      fallback: 0,
      duration: 5,
    });

    expect(value).toBeCloseTo(50, 5);
  });

  it("evaluates custom code expressions with value and time", () => {
    const expression = {
      ...createMotionExpression("expression", "transform.position.x", "expr-1"),
      code: "value + time * 10",
    };

    expect(
      evaluateMotionPropertyValueAtTime({
        keyframes: [],
        expressions: [expression],
        property: "transform.position.x",
        localTime: 0.5,
        fallback: 100,
        duration: 5,
      }),
    ).toBeCloseTo(105, 5);
  });

  it("exposes clamp/linear helpers and falls back on invalid expression code", () => {
    const clamped = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-2"),
          code: "clamp(value, 0, 50)",
        },
      ],
      property: "transform.opacity",
      localTime: 1,
      fallback: 100,
      duration: 5,
    });
    expect(clamped).toBeCloseTo(50, 5);

    const broken = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-3"),
          code: "value +",
        },
      ],
      property: "transform.opacity",
      localTime: 1,
      fallback: 42,
      duration: 5,
    });
    expect(broken).toBeCloseTo(42, 5);
  });

  it("evaluates multi-line body-form expressions with an explicit return", () => {
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-multi"),
          code: "const a = value * 2;\nreturn a + 1;",
        },
      ],
      property: "transform.position.x",
      localTime: 0,
      fallback: 3,
      duration: 5,
    });

    expect(value).toBeCloseTo(7, 5);
  });

  it("still evaluates the single-expression return form", () => {
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-single"),
          code: "value + 1",
        },
      ],
      property: "transform.position.x",
      localTime: 0,
      fallback: 41,
      duration: 5,
    });

    expect(value).toBeCloseTo(42, 5);
  });

  it("records throwing expressions in the registry and clears on success", () => {
    const throwing = {
      ...createMotionExpression("expression", "transform.opacity", "expr-throw"),
      code: "undefinedFn()",
    };
    const brokenValue = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [throwing],
      property: "transform.opacity",
      localTime: 0,
      fallback: 55,
      duration: 5,
    });
    expect(brokenValue).toBeCloseTo(55, 5);
    expect(getMotionExpressionError("expr-throw")).toContain("undefinedFn");

    const healedValue = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...throwing,
          code: "value + 1",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 10,
      duration: 5,
    });
    expect(healedValue).toBeCloseTo(11, 5);
    expect(getMotionExpressionError("expr-throw")).toBeNull();
  });

  it("never returns a non-finite value from an Infinity-producing expression", () => {
    const infinite = {
      ...createMotionExpression("expression", "transform.opacity", "expr-inf"),
      code: "value / 0",
    };
    const result = evaluateMotionPropertyValueAtTime({
      keyframes: [
        {
          id: "kf",
          time: 0,
          property: "transform.opacity",
          value: 5,
          easing: "linear",
        },
      ],
      expressions: [infinite],
      property: "transform.opacity",
      localTime: 0,
      fallback: 0.4,
      duration: 5,
    });
    expect(Number.isFinite(result)).toBe(true);
  });

  it("clears the recorded error when an expression is disabled or removed", () => {
    const throwing = {
      ...createMotionExpression("expression", "transform.opacity", "expr-clear"),
      code: "undefinedFn()",
    };
    const layer = addMotionLayerExpression(makeLayer(), throwing);
    evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: layer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
    });
    expect(getMotionExpressionError("expr-clear")).toContain("undefinedFn");

    toggleMotionLayerExpression(layer, "expr-clear", false);
    expect(getMotionExpressionError("expr-clear")).toBeNull();

    clearMotionExpressionError("expr-clear");
    const relayer = addMotionLayerExpression(makeLayer(), throwing);
    evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: relayer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
    });
    expect(getMotionExpressionError("expr-clear")).toContain("undefinedFn");

    removeMotionLayerExpression(relayer, "expr-clear");
    expect(getMotionExpressionError("expr-clear")).toBeNull();
  });

  const positionKeyframes: readonly Keyframe[] = [
    {
      id: "a",
      time: 0,
      property: "transform.position.x",
      value: 10,
      easing: "linear",
    },
    {
      id: "b",
      time: 1,
      property: "transform.position.x",
      value: 110,
      easing: "linear",
    },
  ];

  const makeComposition = (layer: MotionLayer): MotionComposition => ({
    id: "comp-1",
    name: "Comp",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 5,
    backgroundColor: "#000000",
    layers: [
      { ...makeLayer(), id: "layer-0", name: "Background" },
      layer,
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 0,
    modifiedAt: 0,
  });

  it("evaluates valueAtTime against the pre-expression keyframe value", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-self",
      name: "Self",
      keyframes: [...positionKeyframes],
    };
    const composition = makeComposition(layer);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-vat"),
          code: "valueAtTime(0) + 5",
        },
      ],
      property: "transform.position.x",
      localTime: 1,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(15, 5);
  });

  it("exposes thisLayer index, name, and pre-expression property values", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-self",
      name: "Hero",
      keyframes: [...positionKeyframes],
    };
    const composition = makeComposition(layer);

    const index = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-idx"),
          code: "thisLayer.index",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });
    expect(index).toBeCloseTo(2, 5);

    const nameLength = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-name"),
          code: "thisLayer.name.length",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });
    expect(nameLength).toBeCloseTo(4, 5);

    const propAtTime = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-prop"),
          code: 'thisLayer.valueAtTime("transform.position.x", 1)',
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });
    expect(propAtTime).toBeCloseTo(110, 5);
  });

  it("introspects keyframes via key, numKeys, and nearestKey", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-self",
      name: "Self",
      keyframes: [...positionKeyframes],
    };
    const composition = makeComposition(layer);

    const evaluate = (code: string, id: string): number =>
      evaluateMotionPropertyValueAtTime({
        keyframes: layer.keyframes,
        expressions: [
          {
            ...createMotionExpression("expression", "transform.position.x", id),
            code,
          },
        ],
        property: "transform.position.x",
        localTime: 0,
        fallback: 0,
        duration: 5,
        context: { composition, layer },
      });

    expect(evaluate("key(1).value", "expr-key1")).toBeCloseTo(10, 5);
    expect(evaluate("key(2).time", "expr-key2")).toBeCloseTo(1, 5);
    expect(evaluate("numKeys", "expr-numkeys")).toBeCloseTo(2, 5);
    expect(evaluate("nearestKey(0.9).value", "expr-nearest")).toBeCloseTo(110, 5);
  });

  it("records a descriptive registry error for out-of-range key", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-self",
      name: "Self",
      keyframes: [...positionKeyframes],
    };
    const composition = makeComposition(layer);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-oor"),
          code: "key(99).value",
        },
      ],
      property: "transform.position.x",
      localTime: 0,
      fallback: 7,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(10, 5);
    expect(getMotionExpressionError("expr-oor")).toContain("2 keyframes");
  });

  it("records requires-composition-context when context is absent", () => {
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-noctx"),
          code: "thisComp.numLayers",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 33,
      duration: 5,
    });

    expect(value).toBeCloseTo(33, 5);
    expect(getMotionExpressionError("expr-noctx")).toContain(
      "requires composition context",
    );
  });

  const makeCompositionWithLayers = (
    layers: readonly MotionLayer[],
  ): MotionComposition => ({
    id: "comp-cross",
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

  it("tracks another layer including that layer's own expression", () => {
    const layerA: MotionLayer = {
      ...makeLayer(),
      id: "layer-a",
      name: "A",
      keyframes: [
        {
          id: "ax",
          time: 0,
          property: "transform.position.x",
          value: 50,
          easing: "linear",
        },
      ],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-a"),
          code: "value + 10",
        },
      ],
    };
    const layerB: MotionLayer = {
      ...makeLayer(),
      id: "layer-b",
      name: "B",
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-b"),
          code: 'thisComp.layer("A").value("transform.position.x") + 100',
        },
      ],
    };
    const composition = makeCompositionWithLayers([layerA, layerB]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layerB.keyframes,
      expressions: layerB.expressions,
      property: "transform.position.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer: layerB },
    });

    expect(value).toBeCloseTo(160, 5);
  });

  it("breaks a hard A<->B mutual cycle without hanging", () => {
    const layerA: MotionLayer = {
      ...makeLayer(),
      id: "layer-a",
      name: "A",
      keyframes: [
        {
          id: "ax",
          time: 0,
          property: "transform.position.x",
          value: 7,
          easing: "linear",
        },
      ],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-a"),
          code: 'thisComp.layer("B").value("transform.position.x")',
        },
      ],
    };
    const layerB: MotionLayer = {
      ...makeLayer(),
      id: "layer-b",
      name: "B",
      keyframes: [
        {
          id: "bx",
          time: 0,
          property: "transform.position.x",
          value: 3,
          easing: "linear",
        },
      ],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-b"),
          code: 'thisComp.layer("A").value("transform.position.x")',
        },
      ],
    };
    const composition = makeCompositionWithLayers([layerA, layerB]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layerA.keyframes,
      expressions: layerA.expressions,
      property: "transform.position.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer: layerA },
    });

    expect(Number.isFinite(value)).toBe(true);
    expect(getMotionExpressionError("expr-a")).toContain("cycle");
  });

  it("caps a 10-deep reference chain at depth 8 without hanging", () => {
    const chainLength = 10;
    const layers: MotionLayer[] = [];
    for (let index = 0; index < chainLength; index += 1) {
      const isLast = index === chainLength - 1;
      layers.push({
        ...makeLayer(),
        id: `chain-${index}`,
        name: `L${index}`,
        keyframes: [
          {
            id: `k${index}`,
            time: 0,
            property: "transform.position.x",
            value: index,
            easing: "linear",
          },
        ],
        expressions: isLast
          ? undefined
          : [
              {
                ...createMotionExpression(
                  "expression",
                  "transform.position.x",
                  `expr-chain-${index}`,
                ),
                code: `thisComp.layer("L${index + 1}").value("transform.position.x")`,
              },
            ],
      });
    }
    const composition = makeCompositionWithLayers(layers);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layers[0].keyframes,
      expressions: layers[0].expressions,
      property: "transform.position.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer: layers[0] },
    });

    expect(Number.isFinite(value)).toBe(true);
  });

  it("reads a keyframed effect param via effect(name)(param)", () => {
    const wobble: MotionEffect = {
      id: "fx-wobble",
      type: "blur",
      name: "Wobble",
      enabled: true,
      radius: 4,
    };
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-fx",
      name: "FX",
      effects: [wobble],
      keyframes: [
        {
          id: "r0",
          time: 0,
          property: "effect.fx-wobble.radius",
          value: 4,
          easing: "linear",
        },
        {
          id: "r1",
          time: 1,
          property: "effect.fx-wobble.radius",
          value: 24,
          easing: "linear",
        },
      ],
    };
    const composition = makeCompositionWithLayers([layer]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-fx"),
          code: 'effect("Wobble")("radius")',
        },
      ],
      property: "transform.opacity",
      localTime: 0.5,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(14, 5);
  });

  it("records a descriptive error for an unknown effect name", () => {
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-fx",
      name: "FX",
      effects: [],
    };
    const composition = makeCompositionWithLayers([layer]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-fx-missing"),
          code: 'effect("Nope")("radius")',
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 88,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(88, 5);
    expect(getMotionExpressionError("expr-fx-missing")).toContain("Nope");
  });

  it("resolves thisComp.layer by 1-based index", () => {
    const layerA: MotionLayer = {
      ...makeLayer(),
      id: "layer-a",
      name: "A",
      keyframes: [
        {
          id: "ax",
          time: 0,
          property: "transform.position.x",
          value: 42,
          easing: "linear",
        },
      ],
    };
    const layerB: MotionLayer = {
      ...makeLayer(),
      id: "layer-b",
      name: "B",
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-idx-b"),
          code: 'thisComp.layer(1).value("transform.position.x")',
        },
      ],
    };
    const composition = makeCompositionWithLayers([layerA, layerB]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layerB.keyframes,
      expressions: layerB.expressions,
      property: "transform.position.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer: layerB },
    });

    expect(value).toBeCloseTo(42, 5);
  });

  it("drives Function params and call args from the canonical scope key list", () => {
    expect(MOTION_EXPRESSION_SCOPE_KEYS).toContain("clamp");
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-clamp"),
          code: "clamp(value, 0, 5)",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 100,
      duration: 5,
    });
    expect(value).toBeCloseTo(5, 5);
  });

  it("resolves a cross-layer property at distinct times within one expression", () => {
    const layerA: MotionLayer = {
      ...makeLayer(),
      id: "layer-a",
      name: "A",
      keyframes: [
        {
          id: "ax0",
          time: 0,
          property: "transform.position.x",
          value: 0,
          easing: "linear",
        },
        {
          id: "ax1",
          time: 1,
          property: "transform.position.x",
          value: 100,
          easing: "linear",
        },
      ],
    };
    const layerB: MotionLayer = {
      ...makeLayer(),
      id: "layer-b",
      name: "B",
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-sum"),
          code:
            'thisComp.layer("A").valueAtTime("transform.position.x", 0) + ' +
            'thisComp.layer("A").valueAtTime("transform.position.x", 1)',
        },
      ],
    };
    const composition = makeCompositionWithLayers([layerA, layerB]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layerB.keyframes,
      expressions: layerB.expressions,
      property: "transform.position.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer: layerB },
    });

    expect(value).toBeCloseTo(100, 5);
  });

  it("records a compile error and falls back when code fails to compile", () => {
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-compile"),
          code: "return a +",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 64,
      duration: 5,
    });

    expect(value).toBeCloseTo(64, 5);
    expect(getMotionExpressionError("expr-compile")).toContain("compile");

    const healed = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-compile"),
          code: "value + 1",
        },
      ],
      property: "transform.opacity",
      localTime: 0,
      fallback: 10,
      duration: 5,
    });
    expect(healed).toBeCloseTo(11, 5);
    expect(getMotionExpressionError("expr-compile")).toBeNull();
  });

  it("guards an effect param whose expression cycles back through effect()", () => {
    const wobble: MotionEffect = {
      id: "fx-cycle",
      type: "slider-control",
      name: "Cycle",
      enabled: true,
      value: 5,
    };
    const layer: MotionLayer = {
      ...makeLayer(),
      id: "layer-cycle",
      name: "Cycle",
      effects: [wobble],
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression(
            "expression",
            "effect.fx-cycle.value",
            "expr-fx-cycle",
          ),
          code: 'effect("Cycle")("value") + 1',
        },
        {
          ...createMotionExpression("expression", "transform.opacity", "expr-op-cycle"),
          code: 'effect("Cycle")("value")',
        },
      ],
    };
    const composition = makeCompositionWithLayers([layer]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property: "transform.opacity",
      localTime: 0,
      fallback: 3,
      duration: 5,
      context: { composition, layer },
    });

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeCloseTo(6, 5);
    expect(getMotionExpressionError("expr-fx-cycle")).toContain("cycle");
  });
});

describe("motion expression static base values and current-time reads", () => {
  const makeStaticLayer = (overrides: Partial<MotionLayer> = {}): MotionLayer =>
    ({
      id: "static-layer",
      type: "shape",
      name: "Panel",
      startTime: 0,
      duration: 5,
      visible: true,
      locked: false,
      transform: DEFAULT_MOTION_TRANSFORM,
      keyframes: [],
      shapeType: "rectangle",
      width: 100,
      height: 100,
      style: {
        fill: { type: "solid", color: "#ffffff", opacity: 1 },
        stroke: { color: "#ffffff", width: 0, opacity: 0 },
        cornerRadius: 0,
      },
      ...overrides,
    }) as MotionLayer;

  const makeComp = (layers: readonly MotionLayer[]): MotionComposition => ({
    id: "comp-static",
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

  it("resolves a cross-layer read of an un-keyframed static property", () => {
    const headline = makeStaticLayer({
      id: "headline",
      name: "Headline",
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { ...DEFAULT_MOTION_TRANSFORM.position, x: 960 },
      },
      keyframes: [],
    });
    const follower = makeStaticLayer({
      id: "follower",
      name: "Follower",
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-follow"),
          code: 'thisComp.layer("Headline").value("transform.position.x") + 250',
        },
      ],
    });

    const evaluate = (composition: MotionComposition, target: MotionLayer): number =>
      evaluateMotionPropertyValueAtTime({
        keyframes: target.keyframes,
        expressions: target.expressions,
        property: "transform.position.x",
        localTime: 0,
        fallback: 0,
        duration: 5,
        context: { composition, layer: target },
      });

    expect(evaluate(makeComp([headline, follower]), follower)).toBeCloseTo(1210, 5);

    const movedHeadline = makeStaticLayer({
      id: "headline",
      name: "Headline",
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { ...DEFAULT_MOTION_TRANSFORM.position, x: 600 },
      },
      keyframes: [],
    });
    expect(evaluate(makeComp([movedHeadline, follower]), follower)).toBeCloseTo(
      850,
      5,
    );
  });

  it("reads thisLayer.value of an un-keyframed static property", () => {
    const layer = makeStaticLayer({
      id: "self",
      name: "Self",
      transform: { ...DEFAULT_MOTION_TRANSFORM, opacity: 0.5 },
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.scale.x", "expr-self"),
          code: 'thisLayer.value("transform.opacity")',
        },
      ],
    });
    const composition = makeComp([layer]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property: "transform.scale.x",
      localTime: 0,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(0.5, 5);
  });

  it("evaluates cross-layer value() at the current evaluation time", () => {
    const keyed = makeStaticLayer({
      id: "keyed",
      name: "Keyed",
      keyframes: [
        {
          id: "kx0",
          time: 0,
          property: "transform.position.x",
          value: 0,
          easing: "linear",
        },
        {
          id: "kx1",
          time: 1,
          property: "transform.position.x",
          value: 100,
          easing: "linear",
        },
      ],
    });
    const reader = makeStaticLayer({
      id: "reader",
      name: "Reader",
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-now"),
          code: 'thisComp.layer("Keyed").value("transform.position.x")',
        },
      ],
    });
    const composition = makeComp([keyed, reader]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: reader.keyframes,
      expressions: reader.expressions,
      property: "transform.position.x",
      localTime: 0.5,
      fallback: 0,
      duration: 5,
      context: { composition, layer: reader },
    });

    expect(value).toBeCloseTo(50, 5);
  });

  it("evaluates thisLayer.value at the current evaluation time", () => {
    const layer = makeStaticLayer({
      id: "self-now",
      name: "SelfNow",
      keyframes: [
        {
          id: "sx0",
          time: 0,
          property: "transform.position.y",
          value: 0,
          easing: "linear",
        },
        {
          id: "sx1",
          time: 1,
          property: "transform.position.y",
          value: 200,
          easing: "linear",
        },
      ],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.position.x", "expr-self-now"),
          code: 'thisLayer.value("transform.position.y")',
        },
      ],
    });
    const composition = makeComp([layer]);

    const value = evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property: "transform.position.x",
      localTime: 0.25,
      fallback: 0,
      duration: 5,
      context: { composition, layer },
    });

    expect(value).toBeCloseTo(50, 5);
  });
});
