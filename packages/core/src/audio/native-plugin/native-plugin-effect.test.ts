import { describe, expect, it } from "vitest";
import type { Clip, Effect, Keyframe } from "../../types/timeline";
import {
  MAX_NATIVE_PLUGINS_PER_CLIP,
  bakeNativePluginAutomation,
  createNativePluginEffect,
  findMissingNativePlugins,
  getActiveNativePluginEffects,
  laneFromKeyframes,
  nativePluginKeyframeProperty,
  nativePluginSteps,
  parseNativePluginKeyframeProperty,
  planAddNativePluginAction,
  planRemoveNativePluginAction,
  planUpdateNativePluginAction,
  readNativePluginParams,
  withoutNativePlugins,
} from "./native-plugin-effect";
import { resolveClipAudioEffects } from "../clip-audio-effects";
import { keyframeEngine } from "../../video/keyframe-engine";

const plugin = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple", latencySamples: 0 };
const key = (id: string, property: string, time: number, value: number, easing: Keyframe["easing"] = "linear"): Keyframe => ({ id, time, property, value, easing });
const clip = (over: Partial<Clip> = {}): Clip => ({ id: "c", mediaId: "m", trackId: "t", startTime: 0, duration: 4, inPoint: 2, outPoint: 6, effects: [], audioEffects: [], volume: 1, keyframes: [], ...over }) as unknown as Clip;

describe("nativePlugin effect", () => {
  it("round-trips the state chunk and values through the effect", () => {
    const effect = createNativePluginEffect("e1", plugin, { state: "QUJD", values: { "0": 25, bad: Number.NaN } });
    expect(effect).toMatchObject({ id: "e1", type: "nativePlugin", enabled: true });
    expect(readNativePluginParams(effect)).toMatchObject({ pluginId: plugin.id, name: "AUDelay", state: "QUJD", values: { "0": 25 } });
    expect(JSON.parse(JSON.stringify(effect))).toEqual(effect);
  });

  it("lists only enabled instances as render steps and strips them from the live chain", () => {
    const a = createNativePluginEffect("a", plugin);
    const b = { ...createNativePluginEffect("b", plugin), enabled: false };
    const gain: Effect = { id: "g", type: "gain", enabled: true, params: {} };
    expect(getActiveNativePluginEffects([a, b, gain]).map((e) => e.id)).toEqual(["a"]);
    expect(nativePluginSteps([a, b, gain])).toEqual([{ effectId: "a", pluginId: plugin.id, values: {}, automation: {} }]);
    expect(withoutNativePlugins([a, b, gain])).toEqual([gain]);
  });

  it("reports plugins the host cannot run instead of dropping them", () => {
    const a = createNativePluginEffect("a", plugin);
    const b = createNativePluginEffect("b", { ...plugin, id: "au:aufx:gone:none" });
    expect(findMissingNativePlugins([a, b], new Set([plugin.id])).map((e) => e.id)).toEqual(["b"]);
    expect(findMissingNativePlugins([a, b], new Set([plugin.id, "au:aufx:gone:none"]))).toEqual([]);
  });
});

describe("parameter automation through existing keyframes", () => {
  it("parses and builds keyframe properties", () => {
    const property = nativePluginKeyframeProperty("effect-1.x", "4294967296");
    expect(parseNativePluginKeyframeProperty(property)).toEqual({ effectId: "effect-1.x", key: "4294967296" });
    expect(parseNativePluginKeyframeProperty("effect.blur")).toBeNull();
    expect(parseNativePluginKeyframeProperty("effect.nativeplugin:abc")).toBeNull();
  });

  it("maps clip-local keyframes to source time (in point plus time times speed)", () => {
    const lane = laneFromKeyframes([key("1", "p", 0, 10), key("2", "p", 2, 50)], { inPoint: 2, outPoint: 10, speed: 2, reversed: false });
    expect(lane).toEqual([[2, 10], [6, 50]]);
  });

  it("mirrors the lane for a reversed clip", () => {
    const lane = laneFromKeyframes([key("1", "p", 0, 10), key("2", "p", 2, 50)], { inPoint: 2, outPoint: 6, speed: 1, reversed: true });
    expect(lane).toEqual([[4, 50], [6, 10]]);
  });

  it("samples eased segments every 10 ms and keeps linear ones as two points", () => {
    const eased = laneFromKeyframes([key("1", "p", 0, 0, "ease-in"), key("2", "p", 1, 100)], { inPoint: 0, outPoint: 1, speed: 1 });
    expect(eased.length).toBeGreaterThanOrEqual(100);
    expect(eased[0]).toEqual([0, 0]);
    expect(eased[eased.length - 1]).toEqual([1, 100]);
    const midValue = eased.find(([t]) => Math.abs(t - 0.5) < 0.006)![1];
    expect(midValue).toBeLessThan(50);
  });

  it("samples eased segments exactly as the keyframe engine evaluates them (one easing definition for graph, preview and export)", () => {
    for (const easing of ["ease-in", "ease-out", "ease-in-out", "hold", "smoothstep", "easeInQuad"] as const) {
      const keys = [key("1", "p", 0, 10, easing), key("2", "p", 1, 90, "linear")];
      const lane = laneFromKeyframes(keys, { inPoint: 0, outPoint: 1, speed: 1 });
      expect(lane.length, easing).toBeGreaterThan(2);
      for (const [t, v] of lane) expect(v, `${easing} at ${t}`).toBeCloseTo(Number(keyframeEngine.getValueAtTime(keys as never, t).value), 9);
    }
  });

  it("bakes lanes into the effect params, leaving unrelated clips and effects untouched", () => {
    const effect = createNativePluginEffect("e1", plugin);
    const other = createNativePluginEffect("e2", plugin);
    const keyframes = [key("1", nativePluginKeyframeProperty("e1", "0"), 0, 0), key("2", nativePluginKeyframeProperty("e1", "0"), 1, 100), key("3", "volume", 0, 1)];
    const baked = bakeNativePluginAutomation([effect, other], clip({ keyframes }));
    expect(readNativePluginParams(baked[0]).automation).toEqual({ "0": [[2, 0], [3, 100]] });
    expect(baked[1]).toBe(other);
    const plain: Effect[] = [{ id: "g", type: "gain", enabled: true, params: {} }];
    expect(bakeNativePluginAutomation(plain, clip({ keyframes }))).toBe(plain);
  });

  it("is what preview and export both read through resolveClipAudioEffects", () => {
    const effect = createNativePluginEffect("e1", plugin);
    const keyframes = [key("1", nativePluginKeyframeProperty("e1", "0"), 0, 5), key("2", nativePluginKeyframeProperty("e1", "0"), 1, 9)];
    const resolved = resolveClipAudioEffects(clip({ audioEffects: [effect], keyframes }), { tracks: [] });
    expect(nativePluginSteps(resolved)[0].automation).toEqual({ "0": [[2, 5], [3, 9]] });
    expect(effect.params).not.toHaveProperty("automation");
  });
});

describe("undoable action plans", () => {
  it("adds, updates and removes through the audio effect actions (the undo system)", () => {
    const c = clip();
    const add = planAddNativePluginAction(c, plugin, { actionId: "a1", effectId: "e1" }, 1)!;
    expect(add).toMatchObject({ type: "audio/addEffect", params: { clipId: "c", effect: { id: "e1", type: "nativePlugin" } } });
    const withEffect = clip({ audioEffects: [(add.params as { effect: Effect }).effect] });
    const update = planUpdateNativePluginAction(withEffect, "e1", { state: "AAAA", values: { "1": 3 } }, { actionId: "a2" }, 2)!;
    expect(update).toMatchObject({ type: "audio/replaceEffect", params: { effectId: "e1" } });
    const updated = (update.params as { effect: Effect }).effect;
    expect(readNativePluginParams(updated)).toMatchObject({ state: "AAAA", values: { "1": 3 } });
    expect(planUpdateNativePluginAction(clip({ audioEffects: [updated] }), "e1", { state: "AAAA", values: { "1": 3 } }, { actionId: "a3" })).toBeNull();
    expect(planUpdateNativePluginAction(withEffect, "e1", { enabled: false }, { actionId: "a4" })).toMatchObject({ params: { effect: { enabled: false } } });
    expect(planRemoveNativePluginAction(withEffect, "e1", { actionId: "a5" })).toMatchObject({ type: "audio/removeEffect" });
    expect(planRemoveNativePluginAction(withEffect, "nope", { actionId: "a6" })).toBeNull();
  });

  it("never stores baked automation and caps the chain", () => {
    const baked = { ...createNativePluginEffect("e1", plugin), params: { ...createNativePluginEffect("e1", plugin).params, automation: { "0": [[0, 1]] } } };
    const update = planUpdateNativePluginAction(clip({ audioEffects: [baked] }), "e1", { values: { "0": 2 } }, { actionId: "a" })!;
    expect((update.params as { effect: Effect }).effect.params).not.toHaveProperty("automation");
    const full = clip({ audioEffects: Array.from({ length: MAX_NATIVE_PLUGINS_PER_CLIP }, (_, i) => createNativePluginEffect(`e${i}`, plugin)) });
    expect(planAddNativePluginAction(full, plugin, { actionId: "x", effectId: "y" })).toBeNull();
  });
});
