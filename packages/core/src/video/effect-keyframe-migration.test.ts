import { describe, expect, it } from "vitest";
import type { Effect, Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import {
  describeEffectInstanceKeyframeProperty,
  EFFECT_KEYFRAME_INPUT_PATTERN,
  legacyEffectKeyframeBinding,
  normalizeProjectEffectKeyframes,
  rekeyKeyframesToEffectInstance,
  legacyEffectKeyframeType,
  toInstanceKeyframeProperty,
} from "./effect-instance-keyframes";
import { getAnimatedVideoEffects } from "./animated-video-effects";
import { normalizeProjectStoredFields } from "../storage/project-serializer";

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

function legacyClip() {
  const effects = [
    fx("br", "brightness", { value: 0 }),
    fx("sat", "saturation", { value: 1 }),
    fx("b1", "blur", { radius: 1 }),
    fx("b2", "blur", { radius: 2 }),
    fx("vib", "vibrance", { vibrance: 0 }),
    fx("s1", "hsl-secondary", {}),
    fx("s2", "hsl-secondary", {}),
  ];
  const keyframes = [
    kf("k1", 0, "effect.brightness", -0.2),
    kf("k2", 4, "effect.brightness", 0.6),
    kf("k3", 0, "effect.saturation", 1),
    kf("k4", 4, "effect.saturation", 2),
    kf("k5", 0, "effect.blur", 0),
    kf("k6", 4, "effect.blur", 12),
    kf("k7", 0, "effect.vibrance.vibrance", 0),
    kf("k8", 4, "effect.vibrance.vibrance", 80),
    kf("k9", 0, "effect.hsl-secondary.saturation", 0),
    kf("k10", 4, "effect.hsl-secondary.saturation", -80),
  ];
  return { id: "clip", effects, keyframes };
}

const projectOf = (clip: ReturnType<typeof legacyClip>): Project =>
  ({ timeline: { tracks: [{ id: "t", clips: [{ ...clip }] }], subtitles: [], markers: [], duration: 4 } }) as unknown as Project;

describe("legacy effect keyframe migration renders identically", () => {
  const times = [0, 0.5, 1, 2.25, 3.9, 4, 6];

  it("samples the same effect params before and after migrating a legacy project", () => {
    const before = legacyClip();
    const migrated = normalizeProjectEffectKeyframes(projectOf(before)).timeline.tracks[0].clips[0];
    expect(migrated.keyframes.every((k) => k.property.startsWith("fx:"))).toBe(true);
    for (const time of times) {
      expect(getAnimatedVideoEffects(migrated, time)).toEqual(getAnimatedVideoEffects(before, time));
    }
  });

  it("is idempotent", () => {
    const once = normalizeProjectEffectKeyframes(projectOf(legacyClip()));
    expect(normalizeProjectEffectKeyframes(once)).toBe(once);
  });

  it("runs on project load", () => {
    const clip = normalizeProjectStoredFields(projectOf(legacyClip())).timeline.tracks[0].clips[0];
    expect(clip.keyframes.some((k) => k.property.startsWith("effect."))).toBe(false);
    for (const time of times) {
      expect(getAnimatedVideoEffects(clip, time)).toEqual(getAnimatedVideoEffects(legacyClip(), time));
    }
  });

  it("keeps a legacy keyframe type-keyed when the clip has no such effect (sampler still synthesises it)", () => {
    const clip = {
      id: "c",
      effects: [fx("br", "brightness", { value: 0 })],
      keyframes: [kf("k", 0, "effect.vibrance.vibrance", 5)],
    };
    const project = projectOf(clip);
    expect(normalizeProjectEffectKeyframes(project)).toBe(project);
  });
});

describe("legacy id mapping helpers", () => {
  const effects = [fx("b1", "blur", {}), fx("b2", "blur", {}), fx("v", "vibrance", {}), fx("s", "hsl-secondary", {})];

  it("maps a legacy type-keyed id onto the first instance of that type", () => {
    expect(toInstanceKeyframeProperty(effects, "effect.blur")).toBe("fx:b1:radius");
    expect(toInstanceKeyframeProperty(effects, "effect.vibrance.vibrance")).toBe("fx:v:vibrance");
    expect(toInstanceKeyframeProperty(effects, "effect.hsl-secondary.saturation")).toBe("fx:s:saturation");
  });

  it("leaves unrelated ids and legacy ids without an instance untouched", () => {
    expect(toInstanceKeyframeProperty(effects, "opacity")).toBe("opacity");
    expect(toInstanceKeyframeProperty(effects, "effect.brightness")).toBe("effect.brightness");
    expect(toInstanceKeyframeProperty(effects, "fx:b2:radius")).toBe("fx:b2:radius");
    expect(legacyEffectKeyframeBinding(effects, "effect.brightness")).toBeNull();
  });

  it("describes instance properties for timeline lanes", () => {
    expect(describeEffectInstanceKeyframeProperty(effects, "fx:b2:radius")).toBe("Blur 2: Radius");
    expect(describeEffectInstanceKeyframeProperty(effects, "fx:v:vibrance")).toBe("Vibrance: Vibrance");
    expect(describeEffectInstanceKeyframeProperty(effects, "fx:gone:radius")).toBeNull();
    expect(describeEffectInstanceKeyframeProperty(effects, "opacity")).toBeNull();
  });

  it("input pattern accepts instance and legacy ids, rejects junk", () => {
    const pattern = new RegExp(EFFECT_KEYFRAME_INPUT_PATTERN);
    for (const ok of ["fx:abc-1:radius", "effect.brightness", "effect.vibrance.vibrance", "effect.hsl-secondary.saturation"]) {
      expect(pattern.test(ok)).toBe(true);
    }
    for (const bad of ["fx:onlyid", "effectXbrightness", "effect.nonsense.thing", "fx::radius"]) {
      expect(pattern.test(bad)).toBe(false);
    }
  });

  it("rekeys template keyframes onto the added instance so existing instance keyframes cannot override them", () => {
    const existing = fx("own", "blur", { radius: 0 });
    const added = fx("template-effect-1", "blur", { radius: 0 });
    const templateKeys = rekeyKeyframesToEffectInstance(added, [
      kf("t1", 0, "effect.blur", 30),
      kf("t2", 2, "effect.blur", 0),
      kf("t3", 0, "effect.brightness", 1),
    ]);
    expect(templateKeys.map((key) => key.property)).toEqual([
      "fx:template-effect-1:radius",
      "fx:template-effect-1:radius",
      "effect.brightness",
    ]);
    const clip = {
      id: "c",
      effects: [existing, added],
      keyframes: [kf("u1", 0, "fx:own:radius", 5), kf("u2", 2, "fx:own:radius", 5), ...templateKeys],
    };
    const [own, template] = getAnimatedVideoEffects(clip, 1);
    expect(own!.params.radius).toBe(5);
    expect(template!.params.radius).toBe(15);
  });

  it("legacyEffectKeyframeType names the effect type of legacy ids only", () => {
    expect(legacyEffectKeyframeType("effect.blur")).toBe("blur");
    expect(legacyEffectKeyframeType("effect.vibrance.vibrance")).toBe("vibrance");
    expect(legacyEffectKeyframeType("opacity")).toBeNull();
    expect(legacyEffectKeyframeType("fx:a:radius")).toBeNull();
  });
});
