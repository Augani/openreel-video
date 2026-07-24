import { describe, expect, it } from "vitest";
import {
  getMotionEffectParameterValue,
  setMotionEffectParameterValue,
  getMotionEffectKeyframeProperty,
  parseMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptors,
  getMotionShaderParameterDescriptors,
  layerHasMotionShaderEffects,
  layerNeedsBufferedEffects,
} from "./motion-effects";
import {
  getMotionLayerEffectPropertyDescriptors,
  getMotionPropertyDescriptor,
} from "./motion-keyframes";
import type { MotionLayer, MotionShaderEffect } from "./types";

const eff: MotionShaderEffect = { id: "e1", type: "shader", name: "Dither", enabled: true, shaderId: "dither", params: { levels: 4, scale: 1 } };

const halftone: MotionShaderEffect = {
  id: "halftone-1",
  type: "shader",
  name: "Halftone",
  enabled: true,
  shaderId: "halftone",
  params: { dotSize: 8, angle: 15 },
};

function makeLayer(effects: MotionShaderEffect[]): MotionLayer {
  return {
    id: "layer-1",
    type: "shape",
    name: "Shape",
    start: 0,
    duration: 1000,
    keyframes: [],
    effects,
  } as unknown as MotionLayer;
}

describe("shader effect params", () => {
  it("reads/writes generic params and round-trips the keyframe property", () => {
    expect(getMotionEffectParameterValue(eff, "levels" as never)).toBe(4);
    const next = setMotionEffectParameterValue(eff, "levels" as never, 8);
    expect(next.params.levels).toBe(8);
    const prop = getMotionEffectKeyframeProperty("e1", "levels" as never);
    expect(parseMotionEffectKeyframeProperty(prop)).toEqual({ effectId: "e1", param: "levels" });
  });
  it("no longer drops the previously-unwhitelisted levels param (10/23 bug)", () => {
    expect(parseMotionEffectKeyframeProperty("effect.x.gamma")).toEqual({ effectId: "x", param: "gamma" });
  });
});

describe("shader effect layer classification", () => {
  it("flags a layer whose only effect is a shader effect as needing the buffered pass", () => {
    const layer = makeLayer([eff]);
    expect(layerHasMotionShaderEffects(layer)).toBe(true);
    expect(layerNeedsBufferedEffects(layer)).toBe(true);
  });

  it("does not flag a layer with no effects", () => {
    const layer = makeLayer([]);
    expect(layerHasMotionShaderEffects(layer)).toBe(false);
    expect(layerNeedsBufferedEffects(layer)).toBe(false);
  });

  it("ignores a disabled shader effect", () => {
    const layer = makeLayer([{ ...eff, enabled: false }]);
    expect(layerHasMotionShaderEffects(layer)).toBe(false);
    expect(layerNeedsBufferedEffects(layer)).toBe(false);
  });
});

describe("shader effect animatable descriptors", () => {
  it("synthesizes a parameter descriptor per shader param with real ranges and labels", () => {
    const descriptors = getMotionEffectParameterDescriptors(halftone);
    const dotSize = descriptors.find((descriptor) => descriptor.param === "dotSize");
    expect(dotSize).toEqual({ param: "dotSize", label: "Dot Size", min: 2, max: 32, step: 1 });
    const angle = descriptors.find((descriptor) => descriptor.param === "angle");
    expect(angle).toEqual({ param: "angle", label: "Angle", min: 0, max: 90, step: 1 });
  });

  it("exposes shader params via getMotionShaderParameterDescriptors by shaderId", () => {
    const dither = getMotionShaderParameterDescriptors("dither");
    expect(dither.map((descriptor) => descriptor.param)).toEqual(["levels", "scale"]);
  });

  it("returns no descriptors for an unknown shaderId", () => {
    expect(getMotionShaderParameterDescriptors("does-not-exist")).toEqual([]);
    const ghost: MotionShaderEffect = { ...halftone, shaderId: "does-not-exist", params: {} };
    expect(getMotionEffectParameterDescriptors(ghost)).toEqual([]);
  });

  it("lists each shader param as an animatable layer property with the real range and label", () => {
    const layer = makeLayer([halftone]);
    const descriptors = getMotionLayerEffectPropertyDescriptors(layer);
    const dotSize = descriptors.find(
      (descriptor) => descriptor.property === "effect.halftone-1.dotSize",
    );
    expect(dotSize).toBeDefined();
    expect(dotSize?.min).toBe(2);
    expect(dotSize?.max).toBe(32);
    expect(dotSize?.step).toBe(1);
    expect(dotSize?.label).toBe("Halftone Dot Size");
    expect(dotSize?.group).toBe("Effects");
  });

  it("resolves the keyframed shader property to the real range, not 0..1", () => {
    const layer = makeLayer([halftone]);
    const layerDescriptor = getMotionLayerEffectPropertyDescriptors(layer).find(
      (descriptor) => descriptor.property === "effect.halftone-1.dotSize",
    );
    expect(layerDescriptor?.min).toBe(2);
    expect(layerDescriptor?.max).toBe(32);
    expect(layerDescriptor?.label).toBe("Halftone Dot Size");

    const generic = getMotionPropertyDescriptor("effect.halftone-1.dotSize");
    expect(generic?.property).toBe("effect.halftone-1.dotSize");
    expect(generic?.label).toBe("Effect Dot Size");
  });
});
