import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import {
  getAnimatedVideoEffects,
  hasAnimatedVideoEffects,
  isRenderableVideoEffect,
} from "./animated-video-effects";
import { PRO_EFFECT_DEFAULTS, PRO_EFFECT_KEYFRAME_PROPERTIES } from "./pro-effects";

/**
 * An effect list saved before HSL Secondary existed (legacy vignette, a pro
 * effect, plain JSON round trip) must load and render exactly as before.
 */
const OLD_FORMAT_EFFECTS = JSON.parse(
  JSON.stringify([
    { id: "e1", type: "vignette", enabled: true, params: { amount: 50, midpoint: 0.5, roundness: 0.5, feather: 0.3 } },
    { id: "e2", type: "vibrance", enabled: true, params: { vibrance: 40, saturation: 0 } },
  ]),
) as Effect[];

const secondary = (id: string, params: Record<string, unknown>): Effect => ({
  id,
  type: "hsl-secondary" as Effect["type"],
  enabled: true,
  params: { ...PRO_EFFECT_DEFAULTS["hsl-secondary"], saturation: 0, ...params },
});

describe("HSL secondary and old projects", () => {
  it("old effect lists are untouched by the new effect type", () => {
    const clip = { id: "c", effects: OLD_FORMAT_EFFECTS };
    expect(hasAnimatedVideoEffects(clip)).toBe(false);
    expect(getAnimatedVideoEffects(clip, 0.5)).toEqual(OLD_FORMAT_EFFECTS);
    expect(OLD_FORMAT_EFFECTS.every(isRenderableVideoEffect)).toBe(true);
  });

  it("secondaries survive a JSON round trip and a neutral one does not render", () => {
    const stack = [secondary("s1", { hueMin: 100, hueMax: 140, saturation: -60 }), secondary("s2", {})];
    const restored = JSON.parse(JSON.stringify(stack)) as Effect[];
    expect(restored).toEqual(stack);
    expect(isRenderableVideoEffect(restored[0])).toBe(true);
    expect(isRenderableVideoEffect(restored[1])).toBe(false);
  });

  it("a secondary stored with {} is neutral until the matte view is requested", () => {
    const bare: Effect = { id: "s", type: "hsl-secondary" as Effect["type"], enabled: true, params: {} };
    expect(isRenderableVideoEffect(bare)).toBe(false);
    expect(isRenderableVideoEffect({ ...bare, params: { matteView: 3 } })).toBe(true);
  });

  it("keyframes on a secondary parameter animate the first secondary only", () => {
    const effects = [secondary("s1", {}), secondary("s2", {})];
    const keyframes = [
      { id: "k1", time: 0, property: "effect.hsl-secondary.saturation", value: 0, easing: "linear" },
      { id: "k2", time: 2, property: "effect.hsl-secondary.saturation", value: -100, easing: "linear" },
    ] as never;
    expect(PRO_EFFECT_KEYFRAME_PROPERTIES.some((p) => p.id === "effect.hsl-secondary.saturation")).toBe(true);
    const clip = { id: "c", effects, keyframes };
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    const sampled = getAnimatedVideoEffects(clip, 1);
    expect(sampled[0].params.saturation).toBeCloseTo(-50, 5);
    expect(sampled[1].params.saturation).toBe(0);
  });
});
