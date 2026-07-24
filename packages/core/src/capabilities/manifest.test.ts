import { describe, it, expect } from "vitest";
import { CAPABILITY_MANIFEST } from "./manifest";
import type { NumericRange } from "./manifest";
import type { MotionEffectType } from "../motion/types";

const ALL_MOTION_EFFECT_TYPES: Record<MotionEffectType, true> = {
  blur: true,
  "drop-shadow": true,
  glow: true,
  "color-adjust": true,
  invert: true,
  grayscale: true,
  sepia: true,
  levels: true,
  sharpen: true,
  posterize: true,
  "directional-blur": true,
  noise: true,
  "radial-blur": true,
  displace: true,
  threshold: true,
  mosaic: true,
  "chromatic-aberration": true,
  vignette: true,
  "backdrop-blur": true,
  shader: true,
  "slider-control": true,
  "checkbox-control": true,
  "angle-control": true,
};

function expectValidRange(range: NumericRange): void {
  expect(range.min).toBeLessThan(range.max);
  expect(range.step).toBeGreaterThan(0);
  expect(range.default).toBeGreaterThanOrEqual(range.min);
  expect(range.default).toBeLessThanOrEqual(range.max);
}

describe("CAPABILITY_MANIFEST", () => {
  it("exposes non-empty enum lists", () => {
    expect(CAPABILITY_MANIFEST.blendModes.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.videoFilterTypes.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.audioEffectTypes.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.transitionTypes.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.easings.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.shapeTypes.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.creation.assetKinds.length).toBeGreaterThan(0);
    expect(CAPABILITY_MANIFEST.creation.recipeNodeTypes).toContain("product-part");
    expect(CAPABILITY_MANIFEST.creation.operationTypes).toContain("camera/upsert");
    expect(CAPABILITY_MANIFEST.creation.operationTypes).toContain("scene-object/upsert");
  });

  it("has no duplicate enum members", () => {
    for (const key of [
      "blendModes",
      "videoFilterTypes",
      "transitionTypes",
      "easings",
      "shapeTypes",
    ] as const) {
      const list = CAPABILITY_MANIFEST[key];
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("exposes preset summaries with ids and names", () => {
    for (const preset of CAPABILITY_MANIFEST.filterPresets) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
    }
    expect(CAPABILITY_MANIFEST.speed.presets.length).toBeGreaterThan(0);
  });

  it("exposes a valid speed range", () => {
    expectValidRange(CAPABILITY_MANIFEST.speed.range);
  });

  it("exposes every shape modifier type including the new operators", () => {
    const types = new Set(CAPABILITY_MANIFEST.motion.shapeModifierTypes);
    for (const modifierType of [
      "trim-paths",
      "repeater",
      "zig-zag",
      "round-corners",
      "wiggle-paths",
      "offset-paths",
      "pucker-bloat",
      "twist",
    ] as const) {
      expect(types.has(modifierType)).toBe(true);
    }
  });

  it("exposes valid color-grading parameter ranges", () => {
    const ranges = Object.values(CAPABILITY_MANIFEST.colorGrading);
    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expectValidRange(range);
    }
  });

  it("exposes every MotionEffectType union member in motion effectTypes", () => {
    const expected = Object.keys(ALL_MOTION_EFFECT_TYPES) as MotionEffectType[];
    const manifestTypes = new Set<MotionEffectType>(
      CAPABILITY_MANIFEST.motion.effectTypes,
    );
    expect(manifestTypes.size).toBe(expected.length);
    for (const effectType of expected) {
      expect(manifestTypes.has(effectType)).toBe(true);
    }
  });

  it("exposes effect definitions with valid numeric param ranges", () => {
    expect(CAPABILITY_MANIFEST.effects.length).toBeGreaterThan(0);
    for (const effect of CAPABILITY_MANIFEST.effects) {
      for (const param of effect.params) {
        if (param.type === "number" && param.min !== undefined && param.max !== undefined) {
          expect(param.min).toBeLessThanOrEqual(param.max);
          if (param.step !== undefined) expect(param.step).toBeGreaterThan(0);
          if (typeof param.default === "number") {
            expect(param.default).toBeGreaterThanOrEqual(param.min);
            expect(param.default).toBeLessThanOrEqual(param.max);
          }
        }
      }
    }
  });
});
