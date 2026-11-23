import { describe, expect, it } from "vitest";
import { createTransitionPreset, defaultFromPreset, resolveDefaultPreset, type TransitionPreset } from "./transition-presets";
import {
  MAX_TRANSITION_PRESETS,
  MAX_TRANSITION_PRESET_FILE_BYTES,
  parseTransitionPresetFile,
  serializeTransitionPresets,
  uniquePresetName,
} from "./transition-preset-file";

const make = (name: string, type = "irisBox", params: Record<string, unknown> = {}): TransitionPreset => {
  const created = createTransitionPreset({ id: `p-${name}`, name, type, duration: 1, params, createdAt: 1 });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};
let n = 0;
const nextId = () => `new-${(n += 1)}`;

describe("transition preset file", () => {
  it("round trips name, type, duration and params, and carries no ids", () => {
    const text = serializeTransitionPresets([make("A", "randomBlocks", { seed: 9 }), make("B")]);
    const parsed = parseTransitionPresetFile(text, nextId);
    expect(parsed.error).toBeUndefined();
    expect(parsed.presets.map((p) => [p.name, p.type, p.duration])).toEqual([["A", "randomBlocks", 1], ["B", "irisBox", 1]]);
    expect(parsed.presets[0]!.params).toEqual({ seed: 9 });
    expect(text).not.toContain("p-A");
    expect(parsed.presets.map((p) => p.id)).toEqual(["new-" + (n - 1), "new-" + n]);
  });

  it("numbers names that are taken, in the file and in the library", () => {
    expect(uniquePresetName("X", new Set())).toBe("X");
    expect(uniquePresetName("X", new Set(["x", "x (2)"]))).toBe("X (3)");
    const text = serializeTransitionPresets([make("Same"), make("same")]);
    const parsed = parseTransitionPresetFile(text, nextId, ["Same"]);
    expect(parsed.presets.map((p) => p.name)).toEqual(["Same (2)", "same (3)"]);
  });

  it("refuses what is not a preset file and skips entries it cannot use", () => {
    expect(parseTransitionPresetFile("", nextId).error).toBeDefined();
    expect(parseTransitionPresetFile("[]", nextId).error).toBeDefined();
    expect(parseTransitionPresetFile("x".repeat(MAX_TRANSITION_PRESET_FILE_BYTES + 1), nextId).error).toMatch(/too large/);
    const file = (presets: unknown[]) => JSON.stringify({ format: "openreel-transition-presets", version: 1, presets });
    const parsed = parseTransitionPresetFile(file([{ name: "ok", type: "split", duration: 1, params: {} }, { name: "bad", type: "zzz", duration: 1 }, 5, null, { name: "huge", type: "split", duration: 1, params: { blob: "x".repeat(80_000) } }]), nextId);
    expect(parsed.presets.map((p) => p.name)).toEqual(["ok"]);
    expect(parsed.skipped.map((s) => s.name)).toEqual(["bad", "Preset 3", "Preset 4", "huge"]);
    const many = parseTransitionPresetFile(file(Array.from({ length: MAX_TRANSITION_PRESETS + 5 }, (_, i) => ({ name: `p${i}`, type: "split", duration: 1, params: {} }))), nextId);
    expect(many.presets).toHaveLength(MAX_TRANSITION_PRESETS);
    expect(many.skipped.at(-1)!.reason).toMatch(/first 500/);
  });
});

describe("default transition from a preset", () => {
  it("keeps its stored values when the preset it came from is missing", () => {
    const preset = make("Lib", "cubeSpin", { direction: "up" });
    const global = defaultFromPreset(preset, "global");
    expect(global).toMatchObject({ scope: "global", presetId: "p-Lib", type: "cubeSpin", params: { direction: "up" } });
    expect(resolveDefaultPreset(global, [], [preset])).toEqual({ preset, missing: false });
    expect(resolveDefaultPreset(global, [preset], [])).toEqual({ preset: null, missing: true });
    expect(global.params).toEqual({ direction: "up" });
    expect(resolveDefaultPreset(defaultFromPreset(preset), [preset], [])).toEqual({ preset, missing: false });
    expect(resolveDefaultPreset({ type: "crossfade", duration: 1, params: {} }, [], [])).toEqual({ preset: null, missing: false });
  });
});
