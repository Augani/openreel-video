import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import { getAnimatedVideoEffects, hasAnimatedVideoEffects } from "./animated-video-effects";

describe("shared animated video effects", () => {
  it("keeps an overlay aperture centered on its animated position without changing base scale/opacity", () => {
    const transform = { position: { x: 0.25, y: 0.75 }, scale: { x: 2, y: 0.5 }, rotation: 0, opacity: 0.7, anchor: { x: 0.5, y: 0.5 } };
    const clip = { id: "overlay", transform, keyframes: [
      { id: "iris0", property: "effect.iris-circle", time: 0, value: 0, easing: "linear" as const },
      { id: "iris1", property: "effect.iris-circle", time: 1, value: 1, easing: "linear" as const },
      { id: "position0", property: "position.x", time: 0, value: 0.25, easing: "linear" as const },
      { id: "position1", property: "position.x", time: 1, value: 0.75, easing: "linear" as const },
    ] };
    expect(getAnimatedVideoEffects(clip, 0.5)[0].params).toEqual({ irisShape: "circle", progress: 0.5, centerX: 0.5, centerY: 0.75 });
    expect(transform.scale).toEqual({ x: 2, y: 0.5 }); expect(transform.opacity).toBe(0.7);
  });
  it.each(["circle", "rectangle", "diamond", "star"] as const)("samples a real %s iris mask and retains the completed stack identity", irisShape => {
    const effects: Effect[] = [{ id: "base", type: "brightness", enabled: true, params: { value: 0.1 } }];
    const clip = { id: "iris", mediaId: "video", effects, keyframes: [
      { id: "start", property: `effect.iris-${irisShape}`, time: 0, value: 0, easing: "linear" as const },
      { id: "end", property: `effect.iris-${irisShape}`, time: 1, value: 1, easing: "linear" as const },
    ] };
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    const sampled = getAnimatedVideoEffects(clip, 0.25);
    expect(sampled[0]).toBe(effects[0]);
    expect(sampled[1]).toMatchObject({ type: "mask", enabled: true, params: { irisShape, progress: 0.25, centerX: 0.5, centerY: 0.5 } });
    expect(getAnimatedVideoEffects(clip, 1)).toBe(effects);
    expect(effects).toHaveLength(1);
  });
  it("preserves an unchanged stack by identity for clips without supported effect animation", () => {
    const effects: Effect[] = [{ id: "blur", type: "blur", enabled: true, params: { radius: 5 } }];
    const clip = { id: "clip", effects, keyframes: [{ id: "x", property: "position.x", time: 0, value: 1, easing: "linear" as const }] };
    expect(hasAnimatedVideoEffects(clip)).toBe(false);
    expect(getAnimatedVideoEffects(clip, 3)).toBe(effects);
  });

  it("samples without mutating disabled effects, metadata, order or unrelated parameters", () => {
    const effects: Effect[] = [
      { id: "grain", type: "grain", enabled: true, params: { amount: 0.2 } },
      { id: "temp", type: "temperature", enabled: false, params: { value: 50, custom: 7 }, metadata: { label: "keep" } },
    ];
    const clip = { id: "clip", effects, keyframes: [
      { id: "a", property: "effect.temperature", time: 0, value: -10, easing: "linear" as const },
      { id: "b", property: "effect.temperature", time: 4, value: 10, easing: "linear" as const },
    ] };
    expect(hasAnimatedVideoEffects(clip)).toBe(true);
    const sampled = getAnimatedVideoEffects(clip, 3);
    expect(sampled[0]).toBe(effects[0]);
    expect(sampled[1]).toEqual({ ...effects[1], params: { value: 5, custom: 7 } });
    expect(effects[1].params.value).toBe(50);
  });
  it("renders saved legacy clip blur keyframes and gives effect.blur precedence", () => {
    const keyframes = [
      { id: "kf-entry-blur-0", property: "blur", time: 0, value: 20, easing: "linear" as const },
      { id: "kf-entry-blur-1", property: "blur", time: 1, value: 0, easing: "linear" as const },
    ];
    expect(hasAnimatedVideoEffects({ keyframes })).toBe(true);
    expect(getAnimatedVideoEffects({ id: "clip", keyframes }, 0.25)[0]).toMatchObject({ type: "blur", params: { radius: 15 } });
    const both = [...keyframes, { id: "custom-blur", property: "effect.blur", time: 0, value: 7, easing: "linear" as const }];
    expect(getAnimatedVideoEffects({ id: "clip", keyframes: both }, 0.25)[0].params.radius).toBe(7);
  });
});
