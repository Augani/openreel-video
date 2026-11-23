import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import type { TransitionLibraryBridge } from "./host";
import { executeTool } from "./executor";
import { makeProjectWithClip } from "./test-fixtures";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { ActionExecutor } from "@openreel/core/actions/action-executor";
import type { Clip } from "@openreel/core/types/timeline";
import { getMorphCutRegistry } from "@openreel/core/video/morph-cut/registry";
import { createTransitionPreset, type TransitionPreset } from "@openreel/core/video/transition-presets";
import { parseTransitionPresetFile, serializeTransitionPresets } from "@openreel/core/video/transition-preset-file";

const histories = new WeakMap<HeadlessHost, ActionHistory>();
function newHost(): HeadlessHost {
  const project = makeProjectWithClip();
  const first = project.timeline.tracks[0]!.clips[0]!;
  const second: Clip = { ...structuredClone(first), id: "c2", startTime: 5 };
  (project.timeline.tracks[0]!.clips as Clip[]).push(second);
  const history = new ActionHistory();
  const host = new HeadlessHost(project, { history });
  histories.set(host, history);
  return host;
}
async function undo(host: HeadlessHost): Promise<void> {
  expect((await new ActionExecutor(histories.get(host)).undo(host.getProject())).success).toBe(true);
}
const transitions = (host: HeadlessHost) => host.getProject().timeline.tracks.flatMap((t) => t.transitions);

describe("transition tools", () => {
  it("lists every type with defaults, the presets and the default", async () => {
    const host = newHost();
    const res = await executeTool("list_transitions", {}, host);
    expect(res.ok).toBe(true);
    const data = res.data as { types: Array<{ type: string; maskTransition: boolean; defaults: Record<string, unknown> }>; presets: unknown[]; defaultTransition: { type: string } };
    const types = data.types.map((t) => t.type);
    expect(types).toEqual(expect.arrayContaining(["irisRound", "irisBox", "irisCross", "irisDiamond", "bandWipe", "barnDoor", "clockWipe", "gradientWipe", "filmDissolve", "additiveDissolve", "cubeSpin", "crossfade"]));
    expect(data.types.find((t) => t.type === "irisBox")).toMatchObject({ maskTransition: true, defaults: { feather: 0, reverse: false } });
    expect(data.presets).toEqual([]);
    expect(data.defaultTransition.type).toBe("crossfade");
  });

  it("add_transition carries params and update_transition merges and validates them", async () => {
    const host = newHost();
    const added = await executeTool("add_transition", { clipAId: "c1", clipBId: "c2", transitionType: "irisBox", duration: 1, params: { feather: 0.3, alignment: "end" } }, host);
    expect(added.ok).toBe(true);
    const id = transitions(host)[0]!.id;
    expect(transitions(host)[0]!.params).toMatchObject({ feather: 0.3, alignment: "end" });
    expect((await executeTool("update_transition", { transitionId: id, params: { reverse: true, borderWidth: 8, startPct: 10, endPct: 80 } }, host)).ok).toBe(true);
    expect(transitions(host)[0]!.params).toMatchObject({ feather: 0.3, reverse: true, borderWidth: 8, startPct: 10, endPct: 80 });
    for (const bad of [{ feather: 2 }, { startPct: -5 }, { alignment: "middle" }, { reverse: "yes" }, { startPct: 90, endPct: 10 }]) {
      const res = await executeTool("update_transition", { transitionId: id, params: bad }, host);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(transitions(host)[0]!.params.feather).toBe(0.3);
    await undo(host);
    expect(transitions(host)[0]!.params).toMatchObject({ feather: 0.3, alignment: "end" });
    expect(transitions(host)[0]!.params.reverse).toBeUndefined();
  });

  it("saves a preset from a transition, applies it at a cut, sets and applies the default", async () => {
    const host = newHost();
    await executeTool("add_transition", { clipAId: "c1", clipBId: "c2", transitionType: "clockWipe", duration: 0.8, params: { feather: 0.4, borderWidth: 5, borderColor: "#00ff00" } }, host);
    const source = transitions(host)[0]!;
    const saved = await executeTool("save_transition_preset", { name: "Green clock", transitionId: source.id }, host);
    expect(saved.ok).toBe(true);
    const presetId = (saved.data as { presetId: string }).presetId;
    expect(host.getProject().transitionPresets).toHaveLength(1);
    expect((await executeTool("save_transition_preset", { name: "green CLOCK", transitionId: source.id }, host)).ok).toBe(false);
    expect((await executeTool("save_transition_preset", { name: "", type: "irisBox", duration: 1 }, host)).ok).toBe(false);

    await executeTool("remove_transition", { transitionId: source.id }, host);
    expect(transitions(host)).toHaveLength(0);
    const applied = await executeTool("apply_transition_preset", { presetId, clipAId: "c1", clipBId: "c2" }, host);
    expect(applied.ok).toBe(true);
    expect(transitions(host)[0]).toMatchObject({ type: "clockWipe", duration: 0.8, clipAId: "c1", clipBId: "c2" });
    expect(transitions(host)[0]!.params).toMatchObject({ feather: 0.4, borderWidth: 5, borderColor: "#00ff00" });

    expect((await executeTool("set_default_transition", { presetId }, host)).ok).toBe(true);
    await executeTool("remove_transition", { transitionId: transitions(host)[0]!.id }, host);
    expect((await executeTool("apply_default_transition", { clipAId: "c1", clipBId: "c2", duration: 0.5 }, host)).ok).toBe(true);
    expect(transitions(host)[0]).toMatchObject({ type: "clockWipe", duration: 0.5 });

    expect((await executeTool("set_default_transition", { type: "cubeSpin", duration: 1, params: { direction: "up" } }, host)).ok).toBe(true);
    expect(host.getProject().defaultTransition).toMatchObject({ type: "cubeSpin", params: { direction: "up" } });
    expect((await executeTool("set_default_transition", { reset: true }, host)).ok).toBe(true);
    expect(host.getProject().defaultTransition).toBeUndefined();

    expect((await executeTool("delete_transition_preset", { presetId }, host)).ok).toBe(true);
    expect(host.getProject().transitionPresets).toHaveLength(0);
    expect((await executeTool("apply_transition_preset", { presetId, clipAId: "c1", clipBId: "c2" }, host)).ok).toBe(false);
    await undo(host);
    expect(host.getProject().transitionPresets).toHaveLength(1);
  });

  it("refuses non-adjacent clips and unknown clips", async () => {
    const host = newHost();
    (host.getProject().timeline.tracks[0]!.clips[1] as { startTime: number }).startTime = 9;
    expect((await executeTool("apply_default_transition", { clipAId: "c1", clipBId: "c2" }, host)).error?.code).toBe("TRANSITION_NOT_ADJACENT");
    expect((await executeTool("apply_default_transition", { clipAId: "nope" }, host)).error?.code).toBe("INVALID_PARAMS");
  });

  it("knows the new transition types, with parameters and defaults", async () => {
    const host = newHost();
    const res = await executeTool("list_transitions", {}, host);
    const data = res.data as { types: Array<{ type: string; maskTransition: boolean; defaults: Record<string, unknown> }>; typeParams: Record<string, string> };
    for (const type of ["crossZoom", "pagePeel", "checkerboard", "checkerWipe", "inset", "split", "wedgeWipe", "randomBlocks", "randomWipe", "flipOver"]) {
      expect(data.types.map((t) => t.type), type).toContain(type);
    }
    expect(data.types.find((t) => t.type === "randomBlocks")).toMatchObject({ maskTransition: true, defaults: { seed: 1, tiles: 12 } });
    expect(data.types.find((t) => t.type === "split")).toMatchObject({ maskTransition: false, defaults: { orientation: "horizontal" } });
    expect(Object.keys(data.typeParams)).toEqual(expect.arrayContaining(["direction", "orientation", "corner", "seed"]));
    const added = await executeTool("add_transition", { clipAId: "c1", clipBId: "c2", transitionType: "randomBlocks", duration: 1, params: { seed: 42, tiles: 20 } }, host);
    expect(added.ok).toBe(true);
    expect(transitions(host)[0]!.params).toMatchObject({ seed: 42, tiles: 20 });
    const id = transitions(host)[0]!.id;
    expect((await executeTool("update_transition", { transitionId: id, type: "pagePeel", params: { corner: "topLeft" } }, host)).ok).toBe(true);
    expect(transitions(host)[0]).toMatchObject({ type: "pagePeel", params: { corner: "topLeft" } });
    for (const bad of [{ corner: "middle" }, { tiles: 500 }, { seed: -1 }]) {
      expect((await executeTool("update_transition", { transitionId: id, params: bad }, host)).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("Morph Cut tools", () => {
  it("is a listed type with its guidance and default quality", async () => {
    const host = newHost();
    const data = (await executeTool("list_transitions", {}, host)).data as { types: Array<{ type: string; defaults: Record<string, unknown> }>; morphCut: string; typeParams: Record<string, string> };
    expect(data.types.find((t) => t.type === "morphCut")).toMatchObject({ defaults: { quality: "medium" } });
    expect(data.morphCut).toMatch(/jump cut/);
    expect(data.morphCut).toMatch(/cross dissolve/);
    expect(data.typeParams.quality).toMatch(/morphCut/);
  });

  it("add_transition applies it at a cut, update_transition configures the analysis detail, undo restores", async () => {
    const host = newHost();
    expect((await executeTool("add_transition", { clipAId: "c1", clipBId: "c2", transitionType: "morphCut", duration: 0.5, params: { quality: "high" } }, host)).ok).toBe(true);
    const id = transitions(host)[0]!.id;
    expect(transitions(host)[0]).toMatchObject({ type: "morphCut", duration: 0.5, params: { quality: "high" } });
    expect((await executeTool("update_transition", { transitionId: id, params: { quality: "low" } }, host)).ok).toBe(true);
    expect(transitions(host)[0]!.params.quality).toBe("low");
    expect((await executeTool("update_transition", { transitionId: id, params: { quality: "ultra" } }, host)).ok).toBe(false);
    await undo(host);
    expect(transitions(host)[0]!.params.quality).toBe("high");
  });

  it("get_morph_cut_status reports the analysis state of each Morph Cut and what it renders as", async () => {
    const host = newHost();
    expect((await executeTool("get_morph_cut_status", {}, host)).summary).toMatch(/No Morph Cut/);
    await executeTool("add_transition", { clipAId: "c1", clipBId: "c2", transitionType: "morphCut", duration: 0.5 }, host);
    const id = transitions(host)[0]!.id;
    const rows = (res: { data?: unknown }) => (res.data as { transitions: Array<{ transitionId: string; status: string; rendersAs: string; message?: string }> }).transitions;
    expect(rows(await executeTool("get_morph_cut_status", {}, host))[0]).toMatchObject({ transitionId: id, status: "idle", rendersAs: "cross dissolve" });
    getMorphCutRegistry().setState(id, { status: "failed", progress: 1, message: "Morph Cut could not align these shots" });
    expect(rows(await executeTool("get_morph_cut_status", {}, host))[0]).toMatchObject({ status: "failed", rendersAs: "cross dissolve", message: "Morph Cut could not align these shots" });
    getMorphCutRegistry().setState(id, { status: "ready", progress: 1, message: "", confidence: 0.9 });
    expect(rows(await executeTool("get_morph_cut_status", {}, host))[0]).toMatchObject({ status: "ready", rendersAs: "morph" });
    getMorphCutRegistry().clear();
  });

  it("refuses a Morph Cut preset on a clip's own outro: it needs a cut between two clips", async () => {
    const host = newHost();
    const saved = await executeTool("save_transition_preset", { name: "Morph", type: "morphCut", duration: 0.5, params: {} }, host);
    expect(saved.ok).toBe(true);
    const presetId = (saved.data as { id?: string; presetId?: string }).id ?? (saved.data as { presetId?: string }).presetId;
    const res = await executeTool("apply_transition_preset", { presetId, clipAId: "c1" }, host);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/two clips/);
  });
});

describe("app-wide transition presets", () => {
  function libraryHost(): { host: HeadlessHost; stored: Map<string, TransitionPreset> } {
    const host = newHost();
    const stored = new Map<string, TransitionPreset>();
    let next = 0;
    (host as { transitionLibrary?: TransitionLibraryBridge }).transitionLibrary = {
      list: async () => [...stored.values()],
      save: async (name, source) => {
        const created = createTransitionPreset({ id: `g${(next += 1)}`, name, ...source });
        if (!created.ok) return { ok: false, error: created.error };
        stored.set(created.value.id, created.value);
        return { ok: true, id: created.value.id };
      },
      remove: async (id) => (stored.delete(id) ? { ok: true } : { ok: false, error: "gone" }),
      exportJson: async () => serializeTransitionPresets([...stored.values()]),
      importJson: async (text) => {
        const parsed = parseTransitionPresetFile(text, () => `g${(next += 1)}`, [...stored.values()].map((p) => p.name));
        if (parsed.error) return { ok: false, error: parsed.error };
        parsed.presets.forEach((p) => stored.set(p.id, p));
        return { ok: true, added: parsed.presets.length, skipped: parsed.skipped.length };
      },
    };
    return { host, stored };
  }

  it("saves to the library, lists it, applies it at a cut and sets it as the default (undoable)", async () => {
    const { host, stored } = libraryHost();
    const saved = await executeTool("save_transition_preset", { name: "Spin", type: "cubeSpin", duration: 0.9, params: { direction: "up", borderWidth: 4 }, scope: "library" }, host);
    expect(saved.ok).toBe(true);
    const presetId = (saved.data as { presetId: string }).presetId;
    expect(stored.size).toBe(1);
    expect(host.getProject().transitionPresets ?? []).toHaveLength(0);
    const listed = (await executeTool("list_transitions", {}, host)).data as { libraryPresets: Array<{ id: string; type: string }> };
    expect(listed.libraryPresets).toMatchObject([{ id: presetId, type: "cubeSpin" }]);
    expect((await executeTool("apply_transition_preset", { presetId, clipAId: "c1", clipBId: "c2" }, host)).ok).toBe(true);
    expect(transitions(host)[0]).toMatchObject({ type: "cubeSpin", duration: 0.9, params: { direction: "up", borderWidth: 4 } });
    await undo(host);
    expect(transitions(host)).toHaveLength(0);
    expect((await executeTool("set_default_transition", { presetId }, host)).ok).toBe(true);
    expect(host.getProject().defaultTransition).toMatchObject({ type: "cubeSpin", presetId, scope: "global", params: { direction: "up" } });
    // The library going away does not break the default: it keeps its stored parameters.
    stored.clear();
    expect((await executeTool("apply_default_transition", { clipAId: "c1", clipBId: "c2" }, host)).ok).toBe(true);
    expect(transitions(host)[0]).toMatchObject({ type: "cubeSpin", params: { direction: "up", borderWidth: 4 } });
    expect((await executeTool("apply_transition_preset", { presetId, clipAId: "c1", clipBId: "c2" }, host)).ok).toBe(false);
  });

  it("deletes a library preset by id, exports the library and imports it back", async () => {
    const { host, stored } = libraryHost();
    const first = await executeTool("save_transition_preset", { name: "Peel", type: "pagePeel", duration: 1, params: { corner: "topRight" }, scope: "library" }, host);
    await executeTool("save_transition_preset", { name: "Seeded", type: "randomBlocks", duration: 1, params: { seed: 7 }, scope: "library" }, host);
    const exported = (await executeTool("export_transition_presets", {}, host)).data as { json: string };
    expect(JSON.parse(exported.json)).toMatchObject({ format: "openreel-transition-presets", version: 1 });
    expect((await executeTool("delete_transition_preset", { presetId: (first.data as { presetId: string }).presetId }, host)).ok).toBe(true);
    expect(stored.size).toBe(1);
    const imported = await executeTool("import_transition_presets", { json: exported.json }, host);
    expect(imported.ok).toBe(true);
    expect(imported.data).toEqual({ added: 2, skipped: 0 });
    expect([...stored.values()].map((p) => p.name).sort()).toEqual(["Peel", "Seeded", "Seeded (2)"]);
    expect((await executeTool("import_transition_presets", { json: "not json" }, host)).ok).toBe(false);
    expect((await executeTool("import_transition_presets", {}, host)).error?.code).toBe("INVALID_PARAMS");
  });

  it("says so when the host has no library", async () => {
    const host = newHost();
    expect((await executeTool("save_transition_preset", { name: "x", type: "irisBox", duration: 1, scope: "library" }, host)).error?.code).toBe("UNSUPPORTED");
    expect((await executeTool("export_transition_presets", {}, host)).ok).toBe(false);
    expect((await executeTool("list_transitions", {}, host)).ok).toBe(true);
  });
});
