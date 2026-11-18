import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Effect, Keyframe } from "../types/timeline";
import type { Project } from "../types/project";
import { effectInstanceKeyframeProperty } from "./effect-instance-keyframes";
import {
  applyEffectPreset,
  createEffectPreset,
  mergeImportedPresets,
  parseEffectPresets,
  serializeEffectPresets,
} from "./effect-presets";

const fx = (id: string, type: string, params: Record<string, unknown>): Effect => ({ id, type, params, enabled: true });
const kf = (id: string, time: number, property: string, value: number): Keyframe => ({
  id,
  time,
  property,
  value,
  easing: "ease-in",
});

const source = {
  duration: 10,
  effects: [fx("b1", "blur", { radius: 5 }), fx("c1", "contrast", { value: 1.2 })],
  keyframes: [
    kf("k1", 0, effectInstanceKeyframeProperty("b1", "radius"), 0),
    kf("k2", 5, effectInstanceKeyframeProperty("b1", "radius"), 30),
    kf("k3", 2, "opacity", 0.5),
    kf("k4", 10, "effect.contrast", 2),
  ],
};

let n = 0;
const makeId = (prefix = "id") => `${prefix}-${(n += 1)}`;

describe("createEffectPreset", () => {
  it("captures selected effects with their instance keyframes only", () => {
    const result = createEffectPreset(source, { id: "p", name: " Soft ", timing: "absolute", effectIds: ["b1"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Soft");
    expect(result.value.effects).toHaveLength(1);
    expect(result.value.keyframes.map((k) => [k.effectKey, k.param, k.time, k.value])).toEqual([
      ["fx1", "radius", 0, 0],
      ["fx1", "radius", 5, 30],
    ]);
  });

  it("stores relative timing as a fraction of the clip duration", () => {
    const result = createEffectPreset(source, { id: "p", name: "Rel", timing: "relative", effectIds: ["b1"] });
    expect(result.ok && result.value.keyframes.map((k) => k.time)).toEqual([0, 0.5]);
  });

  it("captures legacy type-keyed keyframes by binding them to the instance", () => {
    const result = createEffectPreset(source, { id: "p", name: "All", timing: "absolute" });
    expect(result.ok && result.value.keyframes.some((k) => k.effectKey === "fx2" && k.param === "value")).toBe(true);
  });

  it("rejects empty names, empty selections and unknown effects", () => {
    expect(createEffectPreset(source, { id: "p", name: "  ", timing: "absolute" }).ok).toBe(false);
    expect(createEffectPreset({ ...source, effects: [] }, { id: "p", name: "x", timing: "absolute" }).ok).toBe(false);
    expect(createEffectPreset(source, { id: "p", name: "x", timing: "absolute", effectIds: ["nope"] }).ok).toBe(false);
  });
});

describe("applyEffectPreset", () => {
  const preset = (timing: "relative" | "absolute") => {
    const result = createEffectPreset(source, { id: "p", name: "P", timing, effectIds: ["b1"] });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const target = { duration: 20, effects: [fx("old", "contrast", { value: 1 })], keyframes: [kf("o", 1, "opacity", 1)] };

  it("appends fresh instances and scales relative keyframes to the target duration", () => {
    const applied = applyEffectPreset(target, preset("relative"), { mode: "append", makeId });
    expect(applied.effects).toHaveLength(2);
    const added = applied.effects[1]!;
    expect(added.id).toBe(applied.addedEffectIds[0]);
    expect(added.id).not.toBe("b1");
    const times = applied.keyframes
      .filter((k) => k.property === effectInstanceKeyframeProperty(added.id, "radius"))
      .map((k) => k.time);
    expect(times).toEqual([0, 10]);
    expect(applied.keyframes.some((k) => k.id === "o")).toBe(true);
  });

  it("keeps absolute times, clamped to the target clip", () => {
    const short = { ...target, duration: 3 };
    const applied = applyEffectPreset(short, preset("absolute"), { mode: "append", makeId });
    const times = applied.keyframes.filter((k) => k.property.endsWith(":radius")).map((k) => k.time);
    expect(times).toEqual([0, 3]);
  });

  it("replace mode drops the old stack and its keyframes but keeps unrelated ones", () => {
    const stacked = {
      ...target,
      keyframes: [...target.keyframes, kf("x", 0, effectInstanceKeyframeProperty("old", "value"), 2)],
    };
    const applied = applyEffectPreset(stacked, preset("absolute"), { mode: "replace", makeId });
    expect(applied.effects).toHaveLength(1);
    expect(applied.keyframes.some((k) => k.id === "x")).toBe(false);
    expect(applied.keyframes.some((k) => k.id === "o")).toBe(true);
  });

  it("applying twice yields independent instances", () => {
    const once = applyEffectPreset(target, preset("absolute"), { mode: "append", makeId });
    const twice = applyEffectPreset({ ...target, ...once }, preset("absolute"), { mode: "append", makeId });
    expect(new Set(twice.effects.map((e) => e.id)).size).toBe(twice.effects.length);
    expect(new Set(twice.keyframes.map((k) => k.id)).size).toBe(twice.keyframes.length);
  });
});

describe("preset JSON exchange", () => {
  const created = createEffectPreset(source, { id: "p1", name: "One", timing: "relative", effectIds: ["b1"] });
  const preset = created.ok ? created.value : (() => { throw new Error("preset"); })();

  it("round-trips through JSON", () => {
    const parsed = parseEffectPresets(serializeEffectPresets([preset]), () => "gen");
    expect(parsed).toEqual({ ok: true, value: [preset] });
  });

  it("accepts a bare preset object and fills a missing id", () => {
    const { id: _id, ...bare } = preset;
    const parsed = parseEffectPresets(JSON.stringify(bare), () => "gen");
    expect(parsed.ok && parsed.value[0]!.id).toBe("gen");
  });

  it("rejects malformed files with a clear error", () => {
    expect(parseEffectPresets("not json", () => "g")).toEqual({ ok: false, error: "Preset file is not valid JSON" });
    expect(parseEffectPresets("{}", () => "g").ok).toBe(false);
    const bad = JSON.stringify({ format: "openreel-effect-presets", version: 1, presets: [{ name: "x", timing: "relative",
      effects: [{ key: "a", type: "blur", params: {} }], keyframes: [{ effectKey: "zzz", param: "r", time: 0, value: 1 }] }] });
    expect(parseEffectPresets(bad, () => "g").ok).toBe(false);
    const late = JSON.stringify({ format: "openreel-effect-presets", version: 1, presets: [{ name: "x", timing: "relative",
      effects: [{ key: "a", type: "blur", params: {} }], keyframes: [{ effectKey: "a", param: "r", time: 4, value: 1 }] }] });
    expect(parseEffectPresets(late, () => "g").ok).toBe(false);
    const future = JSON.stringify({ format: "openreel-effect-presets", version: 99, presets: [] });
    expect(parseEffectPresets(future, () => "g").ok).toBe(false);
  });

  it("re-identifies imported presets that collide with the library", () => {
    const merged = mergeImportedPresets([preset], [preset], () => "fresh");
    expect(merged.map((p) => p.id)).toEqual(["p1", "fresh"]);
  });
});

function project(): Project {
  return {
    id: "p",
    name: "t",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 10,
      markers: [],
      subtitles: [],
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          transitions: [],
          clips: [
            { id: "c1", mediaId: "m", trackId: "t1", startTime: 0, duration: 10, inPoint: 0, outPoint: 10, effects: source.effects, audioEffects: [], keyframes: source.keyframes, volume: 1,
              transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 } },
          ],
        },
      ],
    },
    mediaLibrary: { items: [] },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action => ({ type, id: `a-${type}-${Math.random()}`, timestamp: Date.now(), params });

describe("preset actions", () => {
  it("effect/setStackState changes stack and keyframes in one undo step", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const result = createEffectPreset(source, { id: "p", name: "P", timing: "absolute", effectIds: ["b1"] });
    if (!result.ok) throw new Error(result.error);
    const clip = p.timeline.tracks[0]!.clips[0]!;
    const applied = applyEffectPreset(clip, result.value, { mode: "append", makeId });
    const exec = await executor.execute(act("effect/setStackState", { clipId: "c1", effects: applied.effects, keyframes: applied.keyframes }), p);
    expect(exec.success).toBe(true);
    expect(p.timeline.tracks[0]!.clips[0]!.effects).toHaveLength(3);
    expect(p.timeline.tracks[0]!.clips[0]!.keyframes).toHaveLength(applied.keyframes.length);
    const undo = await executor.undo(p);
    expect(undo.success).toBe(true);
    expect(p.timeline.tracks[0]!.clips[0]!.effects).toHaveLength(2);
    expect(p.timeline.tracks[0]!.clips[0]!.keyframes).toHaveLength(4);
  });

  it("effect/setStackState rejects duplicate effect ids", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const res = await executor.execute(
      act("effect/setStackState", { clipId: "c1", effects: [fx("d", "blur", {}), fx("d", "blur", {})], keyframes: [] }),
      p,
    );
    expect(res.success).toBe(false);
  });

  it("effectPreset/setAll stores the library on the project and undoes", async () => {
    const executor = new ActionExecutor();
    const p = project();
    const result = createEffectPreset(source, { id: "p1", name: "P", timing: "absolute" });
    if (!result.ok) throw new Error(result.error);
    const res = await executor.execute(act("effectPreset/setAll", { presets: [result.value] }), p);
    expect(res.success).toBe(true);
    expect(p.effectPresets).toHaveLength(1);
    await executor.undo(p);
    expect(p.effectPresets ?? []).toHaveLength(0);
  });
});
