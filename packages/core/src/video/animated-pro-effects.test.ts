import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import {
  getAnimatedVideoEffects,
  hasAnimatedVideoEffects,
  isRenderableVideoEffect,
} from "./animated-video-effects";
import { PRO_EFFECT_DEFAULTS } from "./pro-effects";

type Keyframes = NonNullable<Parameters<typeof getAnimatedVideoEffects>[0]["keyframes"]>;

const kf = (property: string, time: number, value: number): Keyframes[number] => ({
  id: `${property}-${time}`,
  property,
  time,
  value,
  easing: "linear",
});

const effect = (type: string, params: Record<string, unknown>): Effect => ({
  id: `fx-${type}`,
  type,
  enabled: true,
  params,
});

describe("pro effect keyframes", () => {
  it("interpolates several parameters of one stored effect independently", () => {
    const stored = effect("lens-distortion", { ...PRO_EFFECT_DEFAULTS["lens-distortion"] });
    const clip = {
      id: "clip",
      effects: [stored],
      keyframes: [
        kf("effect.lens-distortion.amount", 0, 0),
        kf("effect.lens-distortion.amount", 4, 80),
        kf("effect.lens-distortion.zoom", 0, 100),
        kf("effect.lens-distortion.zoom", 4, 200),
      ],
    };
    const [sampled] = getAnimatedVideoEffects(clip, 2);
    expect(sampled.params.amount).toBe(40);
    expect(sampled.params.zoom).toBe(150);
    expect(sampled.params.compensate).toBe(true);
    expect(stored.params.amount).toBe(40);
  });

  it("synthesises a missing effect from the effect defaults with the animated param overriding", () => {
    const clip = {
      id: "clip",
      effects: [],
      keyframes: [kf("effect.mosaic.size", 0, 1), kf("effect.mosaic.size", 2, 21)],
    };
    const at0 = getAnimatedVideoEffects(clip, 0);
    const at1 = getAnimatedVideoEffects(clip, 1);
    expect(at0).toHaveLength(1);
    expect(at0[0].type).toBe("mosaic");
    expect(at0[0].params).toEqual({ ...PRO_EFFECT_DEFAULTS.mosaic, size: 1 });
    expect(isRenderableVideoEffect(at0[0])).toBe(false);
    expect(at1[0].params.size).toBe(11);
    expect(isRenderableVideoEffect(at1[0])).toBe(true);
  });

  it("flags clips with pro keyframes as animated", () => {
    expect(
      hasAnimatedVideoEffects({ keyframes: [kf("effect.exposure.exposure", 0, 0)] }),
    ).toBe(true);
    expect(hasAnimatedVideoEffects({ keyframes: [kf("effect.unknown.value", 0, 0)] })).toBe(false);
  });

  it("returns the stored array untouched when nothing is time-driven or keyframed", () => {
    const effects = [effect("posterize", { levels: 4 })];
    expect(getAnimatedVideoEffects({ id: "clip", effects }, 3)).toBe(effects);
  });
});

describe("vhs-glitch clip-local time", () => {
  const vhs = effect("vhs-glitch", { ...PRO_EFFECT_DEFAULTS["vhs-glitch"], time: 0.5 });

  it("adds clip-local time without keyframes, so preview and export agree per frame", () => {
    const clip = { id: "clip", effects: [vhs] };
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    const a = getAnimatedVideoEffects(clip, 2);
    const b = getAnimatedVideoEffects(clip, 2);
    expect(a[0].params.time).toBe(2.5);
    expect(a[0].params).toEqual(b[0].params);
    expect(getAnimatedVideoEffects(clip, 3)[0].params.time).toBe(3.5);
    expect(vhs.params.time).toBe(0.5);
  });

  it("also adds time when other keyframes force the keyframe path", () => {
    const clip = {
      id: "clip",
      effects: [vhs],
      keyframes: [kf("effect.vhs-glitch.jitter", 0, 0), kf("effect.vhs-glitch.jitter", 2, 100)],
    };
    const [sampled] = getAnimatedVideoEffects(clip, 1);
    expect(sampled.params.jitter).toBe(50);
    expect(sampled.params.time).toBe(1.5);
  });

  it("ignores disabled vhs effects for the animated flag", () => {
    expect(hasAnimatedVideoEffects({ effects: [{ ...vhs, enabled: false }] })).toBe(false);
  });
});

describe("review regressions", () => {
  it("withProEffectDefaults seeds defaults, lets explicit params win, and ignores other types", async () => {
    const { withProEffectDefaults, isProEffectNeutral } = await import("./pro-effects");
    expect(isProEffectNeutral("mosaic", withProEffectDefaults("mosaic") ?? {})).toBe(false);
    expect(isProEffectNeutral("mosaic", {})).toBe(true);
    expect(withProEffectDefaults("mosaic", { size: 30 })).toEqual({ size: 30 });
    expect(withProEffectDefaults("brightness", undefined)).toBeUndefined();
    expect(withProEffectDefaults("brightness", { value: 1 })).toEqual({ value: 1 });
  });

  it("does not force the animated path for a neutral vhs-glitch", async () => {
    const { hasAnimatedVideoEffects } = await import("./animated-video-effects");
    const neutral = [{ id: "e", type: "vhs-glitch", enabled: true, params: {} }];
    const active = [{ id: "e", type: "vhs-glitch", enabled: true, params: { noise: 10 } }];
    expect(hasAnimatedVideoEffects({ keyframes: [], effects: neutral })).toBe(false);
    expect(hasAnimatedVideoEffects({ keyframes: [], effects: active })).toBe(true);
  });

  it("clip-local time is added once, never mutating the stored effect or compounding on repeat calls", async () => {
    const { getAnimatedVideoEffects: sample } = await import("./animated-video-effects");
    const stored = { id: "e", type: "vhs-glitch", enabled: true, params: { noise: 10, time: 2 } };
    const clip = { id: "c", effects: [stored], keyframes: [] };
    const a = sample(clip, 1.5);
    const b = sample(clip, 1.5);
    expect(a[0].params.time).toBe(3.5);
    expect(b[0].params.time).toBe(3.5);
    expect(stored.params.time).toBe(2);
  });
});
