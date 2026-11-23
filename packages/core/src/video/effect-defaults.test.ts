import { describe, expect, it } from "vitest";
import {
  LEGACY_EFFECT_DEFAULTS,
  SUPERSEDED_LEGACY_EFFECTS,
  getDefaultEffectParams,
  legacyEffectsSupersededBy,
  withEffectDefaults,
} from "./effect-defaults";
import {
  PRO_EFFECT_DEFAULTS,
  PRO_EFFECT_TYPES,
  isProEffectNeutral,
  proEffectActingParams,
} from "./pro-effects";
import { VR_PRO_EFFECT_TYPES } from "./vr-effects";
import { VR_IMAGE_EFFECT_TYPES } from "./vr-image-effects";

/** The value each legacy param takes when it is missing: the engine reads
 * these (video-effects-engine readEffectNumber fallbacks) and every one of
 * them is a no-op, which is what a bare `{}` effect used to render. */
const ENGINE_NEUTRAL: Record<string, Record<string, number>> = {
  brightness: { value: 0 },
  contrast: { value: 1 },
  saturation: { value: 1 },
  hue: { rotation: 0 },
  blur: { radius: 0 },
  sharpen: { amount: 0 },
  vignette: { amount: 0 },
  grain: { amount: 0 },
  temperature: { value: 0 },
  tint: { value: 0 },
  tonal: { shadows: 0, midtones: 0, highlights: 0 },
  shadow: { offsetX: 0, offsetY: 0, blur: 0 },
  glow: { radius: 0 },
  "motion-blur": { distance: 0 },
  "radial-blur": { amount: 0 },
  "chromatic-aberration": { amount: 0 },
};

describe("legacy effect defaults", () => {
  it("covers every legacy type whose missing params resolve to a no-op", () => {
    expect(Object.keys(LEGACY_EFFECT_DEFAULTS).sort()).toEqual(
      Object.keys(ENGINE_NEUTRAL).sort(),
    );
  });

  it.each(Object.keys(ENGINE_NEUTRAL))(
    "%s: the seeded default leaves neutral behind",
    (type) => {
      const defaults = LEGACY_EFFECT_DEFAULTS[type]!;
      const neutral = ENGINE_NEUTRAL[type]!;
      const moved = Object.entries(neutral).some(
        ([key, value]) => defaults[key] !== value,
      );
      expect(moved, `${type} default equals the engine neutral value`).toBe(true);
    },
  );

  it("seeds defaults when params are missing or empty and keeps explicit params", () => {
    expect(withEffectDefaults("blur")).toEqual({ radius: 8, type: "gaussian" });
    expect(withEffectDefaults("blur", {})).toEqual({ radius: 8, type: "gaussian" });
    // Explicit legacy params are an authored payload: kept exactly, not merged.
    expect(withEffectDefaults("blur", { radius: 3 })).toEqual({ radius: 3 });
    expect(withEffectDefaults("blur", { radius: 0 })?.radius).toBe(0);
    // Pro effects keep merging their defaults under explicit params.
    expect(withEffectDefaults("gaussian-blur", { blurX: 30 })).toEqual({ blurX: 30, blurY: 10 });
  });

  it("returns fresh objects so callers cannot mutate the shared defaults", () => {
    const a = getDefaultEffectParams("vignette")!;
    a.amount = 0;
    expect(getDefaultEffectParams("vignette")!.amount).toBe(50);
  });

  it("routes pro effects to their authored defaults", () => {
    for (const type of PRO_EFFECT_TYPES) {
      expect(getDefaultEffectParams(type)).toEqual({ ...PRO_EFFECT_DEFAULTS[type] });
      // A default set is not neutral, except for the effects authored to be added neutral (the VR ones).
      expect(isProEffectNeutral(type, withEffectDefaults(type)!)).toBe(VR_PRO_EFFECT_TYPES.includes(type as never) || VR_IMAGE_EFFECT_TYPES.includes(type as never));
      expect(isProEffectNeutral(type, proEffectActingParams(type))).toBe(false);
    }
  });

  it("leaves effects without authored defaults untouched", () => {
    const shader = { shaderId: "pixelate", size: 8 };
    expect(withEffectDefaults("shader", shader)).toBe(shader);
    expect(withEffectDefaults("grayscale")).toBeUndefined();
    expect(withEffectDefaults("not-an-effect", { a: 1 })).toEqual({ a: 1 });
  });
});

describe("superseded legacy effects", () => {
  it("maps each legacy concept to an existing pro effect", () => {
    for (const replacement of Object.values(SUPERSEDED_LEGACY_EFFECTS)) {
      expect(PRO_EFFECT_TYPES).toContain(replacement);
    }
    expect(legacyEffectsSupersededBy("gaussian-blur")).toEqual(["blur"]);
    expect(legacyEffectsSupersededBy("mosaic")).toEqual(["shader:pixelate"]);
    expect(legacyEffectsSupersededBy("vibrance")).toEqual([]);
  });
});
