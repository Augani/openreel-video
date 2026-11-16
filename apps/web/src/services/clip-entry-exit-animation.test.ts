import { describe, expect, it } from "vitest";
import { generateKeyframes, detectCurrentTransitions, type ClipLike, type TransitionConfig, type TransitionPreset } from "./clip-entry-exit-animation";

const canvas = { width: 1920, height: 1080 };
const target: ClipLike = { id: "clip", duration: 4, transform: {
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 17,
  opacity: 0.7, anchor: { x: 0.5, y: 0.5 },
} };
const config = (preset: TransitionPreset, duration = 0.5): TransitionConfig => ({ preset, duration, easing: "ease-out" });

describe("clip entry/exit animation generation", () => {
  it.each(["circle"] as const)("reveals %s without resizing or fading the clip", shape => {
    const preset = `iris-${shape}` as TransitionPreset;
    const keys = generateKeyframes(target, config(preset), config(preset), "regular", canvas);
    expect(keys.map(key => [key.time, key.property, key.value])).toEqual([
      [0, `effect.iris-${shape}`, 0], [0.5, `effect.iris-${shape}`, 1],
      [3.5, `effect.iris-${shape}`, 1], [4, `effect.iris-${shape}`, 0],
    ]);
    expect(target.transform.scale).toEqual({ x: 1, y: 1 });
    expect(target.transform.opacity).toBe(0.7);
  });
  it("moves a pixel-positioned media clip beyond the canvas rather than a fraction of a pixel", () => {
    const keys = generateKeyframes(target, config("slide-left"), config("slide-down"), "regular", canvas);
    expect(Number(keys.find((key) => key.property === "position.x" && key.time === 0)?.value)).toBeLessThan(-canvas.width);
    expect(Number(keys.find((key) => key.property === "position.y" && key.time === 4)?.value)).toBeGreaterThan(canvas.height);
    expect(keys.find((key) => key.property === "position.x" && key.time === 0.5)?.value).toBe(0);
  });

  it.each(["text", "graphic"] as const)("keeps normalized %s movement independent of output resolution", (clipType) => {
    const text = { ...target, transform: { ...target.transform, position: { x: 0.5, y: 0.5 } } };
    const keys = generateKeyframes(text, config("slide-left"), config("slide-right"), clipType, canvas);
    const larger = generateKeyframes(text, config("slide-left"), config("slide-right"), clipType, { width: 3840, height: 2160 });
    expect(keys).toEqual(larger);
    expect(Number(keys[0].value)).toBeLessThan(0);
    expect(Number(keys[keys.length - 1].value)).toBeGreaterThan(1);
  });

  it("keeps entry and exit inside a short clip without overlapping beyond its midpoint", () => {
    const keys = generateKeyframes({ ...target, duration: 0.08 }, config("fade"), config("fade"), "regular", canvas);
    expect(keys.every((key) => Number.isFinite(key.time) && key.time >= 0 && key.time <= 0.08)).toBe(true);
    expect(keys.filter((key) => key.id.startsWith("kf-entry-")).at(-1)?.time).toBeCloseTo(0.04);
    expect(keys.filter((key) => key.id.startsWith("kf-exit-"))[0].time).toBeCloseTo(0.04);
  });

  it("has no generated animation for an empty clip and bounds invalid duration drafts", () => {
    expect(generateKeyframes({ ...target, duration: 0 }, config("fade"), config("fade"), "regular", canvas)).toEqual([]);
    const keys = generateKeyframes(target, config("fade", NaN), config("fade", Infinity), "regular", canvas);
    expect(keys.every((key) => Number.isFinite(key.time) && key.time >= 0 && key.time <= target.duration)).toBe(true);
  });

  it("zooms each axis relative to the current nonuniform base scale", () => {
    const scaled = { ...target, transform: { ...target.transform, scale: { x: 2, y: 0.5 } } };
    const keys = generateKeyframes(scaled, config("zoom-in"), config("zoom-out"), "regular", canvas);
    expect(keys.find((key) => key.property === "scale.x" && key.time === 0)?.value).toBeCloseTo(0.6);
    expect(keys.find((key) => key.property === "scale.y" && key.time === 0)?.value).toBeCloseTo(0.15);
    expect(keys.find((key) => key.property === "scale.x" && key.time === 4)?.value).toBeCloseTo(0.6);
    expect(keys.find((key) => key.property === "scale.y" && key.time === 4)?.value).toBeCloseTo(0.15);
  });

  it.each([
    "fade", "slide-left", "zoom-in", "iris-star",
  ] as const)("recovers the selected %s intent and independent durations after saving", (preset) => {
    const entry = config(preset, 0.4);
    const exit = { ...config(preset, 0.7), easing: "ease-in" as const };
    const keyframes = generateKeyframes(target, entry, exit, "regular", canvas);
    const detected = detectCurrentTransitions({ ...target, keyframes });
    expect(detected.entry.preset).toBe(preset);
    expect(detected.exit.preset).toBe(preset);
    expect(detected.entry.duration).toBeCloseTo(0.4);
    expect(detected.exit.duration).toBeCloseTo(0.7);
    expect(detected.entry.easing).toBe("ease-out");
    expect(detected.exit.easing).toBe("ease-in");
    expect(target.transform.opacity).toBe(0.7);
  });

  describe("blur on a clip that already has blur effect instances", () => {
    const withBlurs = {
      ...target,
      effects: [
        { id: "blur-a", type: "blur" as const },
        { id: "blur-b", type: "blur" as const },
      ],
      keyframes: [
        { id: "own-1", time: 0, property: "fx:blur-a:radius", value: 9, easing: "linear" as const },
        { id: "own-2", time: 4, property: "fx:blur-a:radius", value: 9, easing: "linear" as const },
      ],
    };

    it("keys the instances, not the type, so existing instance keyframes cannot silently win", () => {
      const keys = generateKeyframes(withBlurs, config("blur"), config("blur"), "regular", canvas);
      const blur = keys.filter((key) => key.property.startsWith("fx:"));
      expect(new Set(blur.map((key) => key.property))).toEqual(new Set(["fx:blur-a:radius", "fx:blur-b:radius"]));
      expect(keys.some((key) => key.property === "effect.blur")).toBe(false);
      expect(new Set(keys.map((key) => key.id)).size).toBe(keys.length);
      expect(blur.filter((key) => key.property === "fx:blur-a:radius").map((key) => [key.time, key.value])).toEqual([
        [0, 30], [0.5, 0], [3.5, 0], [4, 30],
      ]);
    });

    it("samples the generated blur on the instance even with an existing animation on it", async () => {
      const { getAnimatedVideoEffects } = await import("@openreel/core/video/animated-video-effects");
      const generated = generateKeyframes(withBlurs, config("blur"), config("blur"), "regular", canvas);
      const manual = withBlurs.keyframes.filter((key) => key.time !== 0 && key.time !== 4);
      const clip = {
        id: "clip",
        effects: withBlurs.effects.map((effect) => ({ ...effect, enabled: true, params: { radius: 0 } })),
        keyframes: [...manual, ...generated],
      };
      expect(getAnimatedVideoEffects(clip, 0)[0]!.params.radius).toBe(30);
      expect(getAnimatedVideoEffects(clip, 2)[0]!.params.radius).toBe(0);
    });

    it("keeps the type-keyed id when no blur instance exists", () => {
      const keys = generateKeyframes({ ...target, effects: [] }, config("blur"), config("none"), "regular", canvas);
      expect(keys.filter((key) => key.id.includes("blur-0") || key.id.includes("blur-1")).every((key) => key.property === "effect.blur")).toBe(true);
    });

    it("detects the saved blur preset from instance-keyed keyframes", () => {
      const generated = generateKeyframes(withBlurs, config("blur"), config("blur"), "regular", canvas);
      const detected = detectCurrentTransitions({ ...withBlurs, keyframes: generated });
      expect(detected.entry.preset).toBe("blur");
      expect(detected.exit.preset).toBe("blur");
    });
  });
});
