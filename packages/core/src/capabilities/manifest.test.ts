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

describe("CAPABILITY_MANIFEST superseded legacy effects", () => {
  it("tells agents which legacy effects each pro effect replaces", () => {
    const supersedes = (type: string) =>
      CAPABILITY_MANIFEST.proEffects.find((effect) => effect.type === type)?.supersedes;
    expect(supersedes("gaussian-blur")).toEqual(["blur"]);
    expect(supersedes("mosaic")).toEqual(["shader:pixelate"]);
    expect(supersedes("mirror")).toEqual(["shader:mirror"]);
    expect(supersedes("lens-distortion")).toEqual(["shader:fisheye"]);
    expect(supersedes("posterize")).toEqual(["shader:posterize"]);
    expect(supersedes("vhs-glitch")).toEqual(["shader:vhs"]);
    expect(supersedes("vibrance")).toBeUndefined();
  });
});

describe("CAPABILITY_MANIFEST premiere parity", () => {
  it("lists all sixty-one pro effects with valid numeric ranges and neutral values", () => {
    expect(CAPABILITY_MANIFEST.proEffects).toHaveLength(61);
    for (const effect of CAPABILITY_MANIFEST.proEffects) {
      expect(effect.params.length).toBeGreaterThan(0);
      for (const param of effect.params) {
        expect(param).toHaveProperty("neutral");
        if (param.kind === "number") {
          expect(param.min).toBeLessThan(param.max as number);
          expect(param.default as number).toBeGreaterThanOrEqual(param.min as number);
          expect(param.default as number).toBeLessThanOrEqual(param.max as number);
        }
        if (param.kind === "select") expect(param.options?.length).toBeGreaterThan(0);
      }
    }
  });

  it("describes scene detection and scopes with valid ranges", () => {
    const { sceneDetection, scopes } = CAPABILITY_MANIFEST.premiere;
    expectValidRange(sceneDetection.sensitivity);
    expectValidRange(sceneDetection.minSceneLengthSeconds);
    expect(scopes.kinds).toEqual(["waveform", "parade", "vectorscope", "histogram"]);
    expect(scopes.blackClipLevel).toBeLessThan(scopes.whiteClipLevel);
  });
});
