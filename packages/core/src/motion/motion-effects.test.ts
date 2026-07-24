import { describe, expect, it } from "vitest";
import type { MotionLayer } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import {
  addMotionLayerEffect,
  buildMotionCanvasFilter,
  buildMotionCssDropShadow,
  buildMotionCssFilter,
  createMotionEffect,
  duplicateMotionLayerEffect,
  clearMotionEffectStack,
  evaluateMotionEffectsAtTime,
  getMotionEffectKeyframeProperty,
  reorderMotionLayerEffect,
  toggleMotionLayerEffect,
  transferMotionEffectStack,
  updateMotionLayerEffect,
} from "./motion-effects";

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

describe("motion effects", () => {
  it("creates typed effect presets and adds them to a layer immutably", () => {
    const layer = makeLayer();
    const blur = createMotionEffect("blur", "blur-1");
    const withBlur = addMotionLayerEffect(layer, blur);

    expect(layer.effects).toBeUndefined();
    expect(withBlur.effects).toEqual([
      {
        id: "blur-1",
        type: "blur",
        name: "Gaussian Blur",
        enabled: true,
        radius: 8,
      },
    ]);
  });

  it("creates the expanded production effect presets with editable defaults", () => {
    expect(createMotionEffect("threshold", "threshold-1")).toMatchObject({
      type: "threshold", level: 128,
    });
    expect(createMotionEffect("mosaic", "mosaic-1")).toMatchObject({
      type: "mosaic", blockSize: 16,
    });
    expect(createMotionEffect("chromatic-aberration", "rgb-1")).toMatchObject({
      type: "chromatic-aberration", amount: 6, angle: 0,
    });
    expect(createMotionEffect("vignette", "vignette-1")).toMatchObject({
      type: "vignette", amount: 0.65, softness: 0.55,
    });
  });

  it("duplicates one effect beside its source with animated parameters", () => {
    const blur = createMotionEffect("blur", "blur-source");
    const glow = createMotionEffect("glow", "glow-source");
    const layer = {
      ...makeLayer(),
      effects: [blur, glow],
      keyframes: [
        {
          id: "blur-key",
          time: 1,
          property: getMotionEffectKeyframeProperty("blur-source", "radius"),
          value: 24,
          easing: "linear" as const,
        },
      ],
    };

    const result = duplicateMotionLayerEffect(layer, "blur-source", (kind) =>
      `${kind}-copy`,
    );

    expect(result.pastedEffectIds).toEqual(["effect-copy"]);
    expect(result.layer.effects?.map((effect) => effect.id)).toEqual([
      "blur-source",
      "effect-copy",
      "glow-source",
    ]);
    expect(result.layer.keyframes).toContainEqual(
      expect.objectContaining({
        id: "keyframe-copy",
        property: getMotionEffectKeyframeProperty("effect-copy", "radius"),
        value: 24,
      }),
    );
  });

  it("suffixes duplicated expression-control names", () => {
    const control = createMotionEffect("slider-control", "control-source");
    const result = duplicateMotionLayerEffect(
      { ...makeLayer(), effects: [control] },
      control.id,
      (kind) => `${kind}-copy`,
    );

    expect(result.layer.effects?.map((effect) => effect.name)).toEqual([
      "Slider Control",
      "Slider Control 2",
    ]);
  });

  it("updates, toggles, and reorders effect stack entries", () => {
    const layer = addMotionLayerEffect(
      addMotionLayerEffect(makeLayer(), createMotionEffect("blur", "blur-1")),
      createMotionEffect("glow", "glow-1"),
    );
    const updated = updateMotionLayerEffect(layer, "blur-1", (effect) =>
      effect.type === "blur" ? { ...effect, radius: 18 } : effect,
    );
    const disabled = toggleMotionLayerEffect(updated, "glow-1", false);
    const reordered = reorderMotionLayerEffect(disabled, "glow-1", -1);

    expect(reordered.effects?.map((effect) => effect.id)).toEqual([
      "glow-1",
      "blur-1",
    ]);
    expect(reordered.effects?.[0]?.enabled).toBe(false);
    expect(reordered.effects?.[1]).toMatchObject({ type: "blur", radius: 18 });
  });

  it("copies animated effect stacks with independent remapped identities", () => {
    const source = {
      ...addMotionLayerEffect(makeLayer(), createMotionEffect("blur", "blur-source")),
      keyframes: [{
        id: "blur-key",
        time: 2,
        property: getMotionEffectKeyframeProperty("blur-source", "radius"),
        value: 24,
        easing: "linear" as const,
      }],
      expressions: [{
        id: "blur-expression",
        property: getMotionEffectKeyframeProperty("blur-source", "radius"),
        type: "expression" as const,
        name: "Pulse",
        enabled: true,
        amplitude: 0,
        frequency: 0,
        phase: 0,
        seed: 1,
        decay: 0,
        code: "value + 2",
      }],
    };
    const target = addMotionLayerEffect(makeLayer(), createMotionEffect("glow", "old-glow"));
    const ids = (kind: string, sourceId: string) => `${kind}-${sourceId}-copy`;
    const result = transferMotionEffectStack(source, target, "replace", ids);

    expect(result.layer.effects).toMatchObject([{ id: "effect-blur-source-copy", type: "blur" }]);
    expect(result.layer.keyframes).toMatchObject([{
      id: "keyframe-blur-key-copy",
      property: "effect.effect-blur-source-copy.radius",
      value: 24,
    }]);
    expect(result.layer.expressions).toMatchObject([{
      id: "expression-blur-expression-copy",
      property: "effect.effect-blur-source-copy.radius",
    }]);
    expect(result.pastedEffectIds).toEqual(["effect-blur-source-copy"]);
  });

  it("clears a stack and its animation without deleting unrelated animation", () => {
    const layer = {
      ...addMotionLayerEffect(makeLayer(), createMotionEffect("blur", "blur-1")),
      keyframes: [
        { id: "effect-key", time: 1, property: "effect.blur-1.radius", value: 12, easing: "linear" as const },
        { id: "position-key", time: 1, property: "transform.position.x", value: 10, easing: "linear" as const },
      ],
    };
    const cleared = clearMotionEffectStack(layer);
    expect(cleared.effects).toEqual([]);
    expect(cleared.keyframes.map((keyframe) => keyframe.id)).toEqual(["position-key"]);
  });

  it("builds matching CSS and canvas filters for preview/export parity", () => {
    const effects = [
      { ...createMotionEffect("blur", "blur-1"), radius: 12 },
      {
        ...createMotionEffect("color-adjust", "color-1"),
        brightness: 1.1,
        contrast: 1.2,
        saturation: 0.8,
        hue: 15,
      },
    ];

    expect(buildMotionCssFilter(effects)).toBe(
      "blur(12px) brightness(1.1) contrast(1.2) saturate(0.8) hue-rotate(15deg)",
    );
    expect(buildMotionCanvasFilter(effects)).toBe(
      "blur(12px) brightness(1.1) contrast(1.2) saturate(0.8) hue-rotate(15deg)",
    );
  });

  it("builds preview shadows for glow and drop shadow effects", () => {
    const effects = [
      {
        ...createMotionEffect("drop-shadow", "shadow-1"),
        color: "#000000",
        opacity: 0.5,
        offsetX: 3,
        offsetY: 6,
        blur: 18,
      },
      {
        ...createMotionEffect("glow", "glow-1"),
        color: "#14b8a6",
        intensity: 0.4,
        radius: 22,
      },
    ];

    expect(buildMotionCssDropShadow(effects)).toBe(
      "3px 6px 18px rgba(0, 0, 0, 0.5), 0 0 22px rgba(20, 184, 166, 0.4)",
    );
  });

  it("evaluates keyframed effect parameters for preview/export filters", () => {
    const effects = [
      { ...createMotionEffect("blur", "blur-1"), radius: 0 },
      { ...createMotionEffect("glow", "glow-1"), intensity: 0, radius: 12 },
    ];
    const keyframes = [
      {
        id: "blur-start",
        time: 0,
        property: getMotionEffectKeyframeProperty("blur-1", "radius"),
        value: 0,
        easing: "linear" as const,
      },
      {
        id: "blur-end",
        time: 1,
        property: getMotionEffectKeyframeProperty("blur-1", "radius"),
        value: 20,
        easing: "linear" as const,
      },
      {
        id: "glow-start",
        time: 0,
        property: getMotionEffectKeyframeProperty("glow-1", "intensity"),
        value: 0,
        easing: "linear" as const,
      },
      {
        id: "glow-end",
        time: 1,
        property: getMotionEffectKeyframeProperty("glow-1", "intensity"),
        value: 0.8,
        easing: "linear" as const,
      },
    ];

    const evaluated = evaluateMotionEffectsAtTime(effects, keyframes, 0.5);

    expect(buildMotionCanvasFilter(evaluated)).toBe(
      "blur(10px) drop-shadow(0 0 12px rgba(20, 184, 166, 0.4))",
    );
    expect(buildMotionCssDropShadow(evaluated)).toBe(
      "0 0 12px rgba(20, 184, 166, 0.4)",
    );
  });

  it("emits stylize filters for invert, grayscale, and sepia effects", () => {
    let layer = makeLayer();
    layer = addMotionLayerEffect(layer, createMotionEffect("invert", "invert-1"));
    layer = addMotionLayerEffect(
      layer,
      createMotionEffect("grayscale", "grayscale-1"),
    );
    layer = addMotionLayerEffect(layer, createMotionEffect("sepia", "sepia-1"));

    const filter = buildMotionCanvasFilter(layer.effects ?? []);
    expect(filter).toContain("invert(1)");
    expect(filter).toContain("grayscale(1)");
    expect(filter).toContain("sepia(1)");
  });
});
