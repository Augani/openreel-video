import { describe, expect, it } from "vitest";
import type { Clip, Effect, Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import {
  adjacentEffectParamKeyframe,
  applyEffectInstanceKeyframes,
  clearEffectParamKeyframes,
  cloneEffectInstanceKeyframes,
  effectInstanceKeyframeProperty,
  findEffectParamKeyframeAt,
  getAnimatableEffectParams,
  isEffectParamAnimated,
  migrateClipEffectKeyframes,
  normalizeProjectEffectKeyframes,
  parseEffectInstanceKeyframeProperty,
  removeEffectParamKeyframe,
  upsertEffectParamKeyframe,
} from "./effect-instance-keyframes";
import { getAnimatedVideoEffects, hasAnimatedVideoEffects } from "./animated-video-effects";

const fx = (id: string, type: string, params: Record<string, unknown>): Effect => ({
  id,
  type,
  params,
  enabled: true,
});

const kf = (id: string, time: number, property: string, value: number): Keyframe => ({
  id,
  time,
  property,
  value,
  easing: "linear",
});

let counter = 0;
const makeId = () => `new-${(counter += 1)}`;

describe("instance keyframe properties", () => {
  it("round-trips effect ids that contain separators", () => {
    const property = effectInstanceKeyframeProperty("effect-a:b", "radius");
    expect(property).toBe("fx:effect-a:b:radius");
    expect(parseEffectInstanceKeyframeProperty(property)).toEqual({ effectId: "effect-a:b", param: "radius" });
    expect(parseEffectInstanceKeyframeProperty("effect.blur")).toBeNull();
    expect(parseEffectInstanceKeyframeProperty("fx:onlyid")).toBeNull();
  });
});

describe("instance keyframe sampling", () => {
  it("animates two copies of the same effect independently", () => {
    const effects = [fx("b1", "blur", { radius: 0 }), fx("b2", "blur", { radius: 0 })];
    const keyframes = [
      kf("1", 0, effectInstanceKeyframeProperty("b1", "radius"), 0),
      kf("2", 2, effectInstanceKeyframeProperty("b1", "radius"), 20),
      kf("3", 0, effectInstanceKeyframeProperty("b2", "radius"), 50),
      kf("4", 2, effectInstanceKeyframeProperty("b2", "radius"), 100),
    ];
    const sampled = getAnimatedVideoEffects({ id: "c", effects, keyframes }, 1);
    expect(sampled.find((e) => e.id === "b1")?.params.radius).toBe(10);
    expect(sampled.find((e) => e.id === "b2")?.params.radius).toBe(75);
  });

  it("leaves effects without keyframes untouched and ignores orphan keyframes", () => {
    const effects = [fx("b1", "blur", { radius: 7 })];
    const keyframes = [kf("1", 0, effectInstanceKeyframeProperty("gone", "radius"), 5)];
    const sampled = applyEffectInstanceKeyframes(effects, keyframes, 0);
    expect(sampled[0]).toBe(effects[0]);
  });

  it("animates a classic effect param other than its primary one", () => {
    const effects = [fx("v", "vignette", { amount: 50, midpoint: 0.5 })];
    const keyframes = [
      kf("1", 0, effectInstanceKeyframeProperty("v", "midpoint"), 0),
      kf("2", 4, effectInstanceKeyframeProperty("v", "midpoint"), 1),
    ];
    const sampled = getAnimatedVideoEffects({ id: "c", effects, keyframes }, 2);
    expect(sampled[0]!.params).toMatchObject({ amount: 50, midpoint: 0.5 });
    const quarter = getAnimatedVideoEffects({ id: "c", effects, keyframes }, 1);
    expect(quarter[0]!.params.midpoint).toBeCloseTo(0.25);
  });

  it("flags clips with instance keyframes as animated", () => {
    expect(
      hasAnimatedVideoEffects({ keyframes: [kf("1", 0, effectInstanceKeyframeProperty("v", "amount"), 1)] }),
    ).toBe(true);
  });

  it("instance keyframes override type-keyed ones per parameter", () => {
    const effects = [fx("b1", "brightness", { value: 0 })];
    const keyframes = [
      kf("1", 0, "effect.brightness", 80),
      kf("2", 0, effectInstanceKeyframeProperty("b1", "value"), 10),
    ];
    const sampled = getAnimatedVideoEffects({ id: "c", effects, keyframes }, 0);
    expect(sampled[0]!.params.value).toBe(10);
  });
});

describe("animatable params", () => {
  it("lists every numeric spec param of a pro effect", () => {
    const params = getAnimatableEffectParams({ type: "gaussian-blur", params: {} });
    expect(params.map((p) => p.key)).toContain("blurX");
  });

  it("lists numeric params of classic effects and skips colours and shaders", () => {
    const shadow = getAnimatableEffectParams({ type: "shadow", params: { offsetX: 4, color: "#000" } });
    expect(shadow.map((p) => p.key).sort()).toEqual(["blur", "offsetX", "offsetY", "opacity"]);
    expect(getAnimatableEffectParams({ type: "shader", params: { shaderId: "x", speed: 1 } })).toEqual([]);
    expect(getAnimatableEffectParams({ type: "mask", params: { progress: 1 } })).toEqual([]);
  });

  it("every classic default effect exposes at least one animatable param", () => {
    for (const type of ["brightness", "contrast", "saturation", "hue", "blur", "sharpen", "vignette", "grain",
      "temperature", "tint", "tonal", "shadow", "glow", "motion-blur", "radial-blur", "chromatic-aberration"]) {
      expect(getAnimatableEffectParams({ type, params: {} }).length, type).toBeGreaterThan(0);
    }
  });
});

describe("keyframe helpers", () => {
  it("toggles, upserts, removes and navigates keyframes of one instance param", () => {
    let keys: Keyframe[] = [];
    keys = upsertEffectParamKeyframe(keys, "e", "radius", { time: 1, value: 5 }, makeId);
    keys = upsertEffectParamKeyframe(keys, "e", "radius", { time: 3, value: 9 }, makeId);
    keys = upsertEffectParamKeyframe(keys, "e", "radius", { time: 1, value: 6 }, makeId);
    expect(keys).toHaveLength(2);
    expect(findEffectParamKeyframeAt(keys, "e", "radius", 1)?.value).toBe(6);
    expect(isEffectParamAnimated(keys, "e", "radius")).toBe(true);
    expect(isEffectParamAnimated(keys, "e", "other")).toBe(false);
    expect(adjacentEffectParamKeyframe(keys, "e", "radius", 2, "prev")?.time).toBe(1);
    expect(adjacentEffectParamKeyframe(keys, "e", "radius", 2, "next")?.time).toBe(3);
    expect(adjacentEffectParamKeyframe(keys, "e", "radius", 3, "next")).toBeUndefined();
    keys = removeEffectParamKeyframe(keys, "e", "radius", 1);
    expect(keys).toHaveLength(1);
    expect(clearEffectParamKeyframes(keys, "e", "radius")).toHaveLength(0);
  });

  it("clones keyframes onto a duplicated effect with fresh ids", () => {
    const keys = [kf("a", 0, effectInstanceKeyframeProperty("e", "radius"), 1), kf("z", 0, "opacity", 1)];
    const copies = cloneEffectInstanceKeyframes(keys, "e", "e2", makeId);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.property).toBe("fx:e2:radius");
    expect(copies[0]!.id).not.toBe("a");
  });
});

describe("migrateClipEffectKeyframes", () => {
  it("binds type-keyed keyframes to every instance of the type", () => {
    const clip = {
      effects: [fx("b1", "blur", { radius: 1 }), fx("b2", "blur", { radius: 1 })],
      keyframes: [kf("k1", 0, "effect.blur", 2), kf("k2", 1, "effect.blur", 4), kf("o", 0, "opacity", 1)],
    };
    const migrated = migrateClipEffectKeyframes(clip);
    const props = migrated.keyframes.map((k) => k.property).sort();
    expect(props).toEqual(["fx:b1:radius", "fx:b1:radius", "fx:b2:radius", "fx:b2:radius", "opacity"]);
    expect(new Set(migrated.keyframes.map((k) => k.id)).size).toBe(migrated.keyframes.length);
    // Sampling before and after migration is identical.
    const before = getAnimatedVideoEffects({ id: "c", ...clip }, 0.5);
    const after = getAnimatedVideoEffects({ id: "c", ...migrated }, 0.5);
    expect(after.map((e) => e.params.radius)).toEqual(before.map((e) => e.params.radius));
  });

  it("keeps keyframes for types the clip does not have so they can still synthesise", () => {
    const clip = { effects: [], keyframes: [kf("k", 0, "effect.brightness", 5)] };
    expect(migrateClipEffectKeyframes(clip)).toBe(clip);
    const withOther = { effects: [fx("c", "contrast", { value: 1 })], keyframes: clip.keyframes };
    expect(migrateClipEffectKeyframes(withOther)).toBe(withOther);
  });

  it("prefers effect.blur over the bare blur property and is idempotent", () => {
    const clip = {
      effects: [fx("b", "blur", { radius: 1 })],
      keyframes: [kf("old", 0, "blur", 9), kf("new", 0, "effect.blur", 3)],
    };
    const once = migrateClipEffectKeyframes(clip);
    expect(once.keyframes).toHaveLength(1);
    expect(once.keyframes[0]).toMatchObject({ property: "fx:b:radius", value: 3 });
    expect(migrateClipEffectKeyframes(once)).toBe(once);
  });

  it("maps pro effect keyframes onto the instance", () => {
    const clip = {
      effects: [fx("v", "vibrance", { vibrance: 0 })],
      keyframes: [kf("k", 0, "effect.vibrance.vibrance", 40)],
    };
    expect(migrateClipEffectKeyframes(clip).keyframes[0]!.property).toBe("fx:v:vibrance");
  });

  it("migrates every clip of a project and returns the same project when nothing changes", () => {
    const clip = {
      id: "c1",
      effects: [fx("b", "blur", { radius: 1 })],
      keyframes: [kf("k", 0, "effect.blur", 3)],
    } as unknown as Clip;
    const project = {
      timeline: { tracks: [{ id: "t", clips: [clip] }] },
    } as unknown as Project;
    const migrated = normalizeProjectEffectKeyframes(project);
    expect(migrated.timeline.tracks[0]!.clips[0]!.keyframes[0]!.property).toBe("fx:b:radius");
    expect(normalizeProjectEffectKeyframes(migrated)).toBe(migrated);
  });
});
