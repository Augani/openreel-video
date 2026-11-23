import { ActionExecutor, type Clip } from "@openreel/core";
import { resolveDefaultPreset } from "@openreel/core/video/transition-presets";
import { MAX_TRANSITION_PRESET_FILE_BYTES } from "@openreel/core/video/transition-preset-file";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { GlobalTransitionPresetLibrary, createIdbBackend } from "./global-transition-presets";
import { applyDefaultTransition, applyTransitionToSelectedCut, getDefaultTransition, setDefaultTransition } from "./transition-presets";

/** A new library over the same "disk": what a page reload gives. */
const reload = (factory: IDBFactory) => new GlobalTransitionPresetLibrary(createIdbBackend(factory));

describe("app-wide transition preset library", () => {
  let factory: IDBFactory;
  let library: GlobalTransitionPresetLibrary;
  beforeEach(() => {
    factory = new IDBFactory();
    library = reload(factory);
  });

  it("saves presets with their full parameters and finds them again after a reload", async () => {
    const saved = await library.save("  Green cube  ", { type: "cubeSpin", duration: 1.2, params: { direction: "up", borderWidth: 6, borderColor: "#00ff00" } });
    expect(saved.ok).toBe(true);
    await library.save("Seeded blocks", { type: "randomBlocks", duration: 0.7, params: { seed: 42, tiles: 20, reverse: true } });
    const afterReload = await reload(factory).list();
    expect(afterReload.map((preset) => preset.name)).toEqual(["Green cube", "Seeded blocks"]);
    expect(afterReload[0]).toMatchObject({ type: "cubeSpin", duration: 1.2, params: { direction: "up", borderWidth: 6, borderColor: "#00ff00" } });
    expect(afterReload[1]).toMatchObject({ type: "randomBlocks", duration: 0.7, params: { seed: 42, tiles: 20, reverse: true, feather: 0 } });
    expect(afterReload[0]!.id).toMatch(/^gtpreset-/);
  });

  it("keeps names unique, rejects bad input, renames and deletes, all persisted", async () => {
    await library.save("One", { type: "irisBox", duration: 1, params: {} });
    expect((await library.save("one", { type: "irisBox", duration: 1, params: {} })).ok).toBe(false);
    expect((await library.save("", { type: "irisBox", duration: 1, params: {} })).ok).toBe(false);
    expect((await library.save("Bad", { type: "irisBox", duration: 0, params: {} })).ok).toBe(false);
    expect((await library.save("Bad", { type: "nope" as never, duration: 1, params: {} })).ok).toBe(false);
    const [first] = await library.list();
    expect((await library.rename(first!.id, "Two")).ok).toBe(true);
    expect((await reload(factory).list()).map((preset) => preset.name)).toEqual(["Two"]);
    expect((await library.remove(first!.id)).ok).toBe(true);
    expect(await reload(factory).list()).toEqual([]);
    expect((await library.remove(first!.id)).ok).toBe(false);
    expect((await library.rename(first!.id, "x")).ok).toBe(false);
  });

  it("notifies subscribers, for the panel", async () => {
    let calls = 0;
    const stop = library.subscribe(() => (calls += 1));
    await library.load();
    const before = library.getSnapshot();
    await library.save("Live", { type: "split", duration: 1, params: {} });
    expect(calls).toBeGreaterThan(0);
    expect(library.getSnapshot()).not.toBe(before);
    expect(library.getSnapshot()).toHaveLength(1);
    stop();
  });

  it("exports a small JSON file and imports it into another library, numbering clashing names", async () => {
    await library.save("Peel", { type: "pagePeel", duration: 1, params: { corner: "topLeft" } });
    await library.save("Wipe", { type: "checkerWipe", duration: 0.5, params: { direction: "up", tiles: 10 } });
    const text = await library.exportJson();
    const file = JSON.parse(text) as { format: string; version: number; presets: Array<Record<string, unknown>> };
    expect(file).toMatchObject({ format: "openreel-transition-presets", version: 1 });
    expect(Object.keys(file.presets[0]!).sort()).toEqual(["duration", "name", "params", "type"]);
    expect(text.length).toBeLessThan(MAX_TRANSITION_PRESET_FILE_BYTES / 100);

    const other = new GlobalTransitionPresetLibrary(createIdbBackend(new IDBFactory()));
    const imported = await other.importJson(text);
    expect(imported.ok && imported.value.added.map((preset) => preset.name)).toEqual(["Peel", "Wipe"]);
    expect((await other.list())[0]).toMatchObject({ type: "pagePeel", params: { corner: "topLeft", shadow: 0.55 } });
    expect((await other.list())[0]!.id).not.toBe((await library.list())[0]!.id);
    const again = await other.importJson(text);
    expect(again.ok && again.value.added.map((preset) => preset.name)).toEqual(["Peel (2)", "Wipe (2)"]);
  });

  it("imports what it understands and reports the rest; refuses files that are not preset files", async () => {
    const mixed = JSON.stringify({
      format: "openreel-transition-presets",
      version: 1,
      presets: [
        { name: "Fine", type: "inset", duration: 1, params: { corner: "bottomRight" } },
        { name: "From the future", type: "hologramWipe", duration: 1, params: {} },
        { name: "No duration", type: "inset", params: {} },
        { name: "Too long", type: "inset", duration: 99, params: {} },
        "garbage",
      ],
    });
    const result = await library.importJson(mixed);
    expect(result.ok && result.value.added.map((preset) => preset.name)).toEqual(["Fine"]);
    expect(result.ok && result.value.skipped).toHaveLength(4);
    expect((await library.importJson("{")).ok).toBe(false);
    expect((await library.importJson(JSON.stringify({ format: "other", version: 1, presets: [] }))).ok).toBe(false);
    const newer = await library.importJson(JSON.stringify({ format: "openreel-transition-presets", version: 2, presets: [] }));
    expect(!newer.ok && newer.error).toMatch(/newer version/);
    expect((await library.importJson("")).ok).toBe(false);
    expect((await library.list()).map((preset) => preset.name)).toEqual(["Fine"]);
  });

  it("without IndexedDB nothing breaks: the library is empty and says it is not persistent", async () => {
    const memoryOnly = new GlobalTransitionPresetLibrary(createIdbBackend(null));
    expect(memoryOnly.persistent).toBe(false);
    expect(await memoryOnly.list()).toEqual([]);
    const saved = await memoryOnly.save("Lost", { type: "irisBox", duration: 1, params: {} });
    expect(saved.ok).toBe(false);
  });
});

// ── A library preset on a project ─────────────────────────────────────────────────────────────────────────────────

const makeClip = (id: string, startTime: number, duration: number): Clip => ({
  id,
  trackId: "main",
  mediaId: "source",
  startTime,
  duration,
  inPoint: 0,
  outPoint: duration,
  speed: 1,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
});

function openProject() {
  const project = createEmptyProject("Elsewhere");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: {
      ...project,
      settings: { ...project.settings, frameRate: 30 },
      timeline: {
        ...project.timeline,
        duration: 8,
        tracks: [{ id: "main", name: "main", type: "video" as const, locked: false, hidden: false, solo: false, muted: false, transitions: [], clips: [makeClip("a", 0, 4), makeClip("b", 4, 4)] }],
      },
    },
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    clipUndoStack: [],
    clipRedoStack: [],
    templateUndoStack: [],
    templateRedoStack: [],
    redoJournal: [],
  });
  useUIStore.setState({ selectedItems: [{ id: "a", type: "clip" as const }, { id: "b", type: "clip" as const }] });
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0 });
}
const transitions = () => useProjectStore.getState().project.timeline.tracks[0]!.transitions;

describe("applying a library preset", () => {
  beforeEach(openProject);

  it("copies the preset onto the cut as one undo step, and redo restores it", async () => {
    const library = new GlobalTransitionPresetLibrary(createIdbBackend(new IDBFactory()));
    const saved = await library.save("Flip", { type: "flipOver", duration: 1.5, params: { direction: "down", borderWidth: 3 } });
    if (!saved.ok) throw new Error(saved.error);
    const applied = await applyTransitionToSelectedCut(saved.value);
    expect(applied.ok).toBe(true);
    expect(transitions()[0]).toMatchObject({ type: "flipOver", duration: 1.5, clipAId: "a", clipBId: "b", params: { direction: "down", borderWidth: 3 } });
    await useProjectStore.getState().undo();
    expect(transitions()).toHaveLength(0);
    await useProjectStore.getState().redo();
    expect(transitions()[0]).toMatchObject({ type: "flipOver", params: { direction: "down" } });
  });

  it("a project whose default came from a library preset that is missing keeps working with the stored parameters", async () => {
    const library = new GlobalTransitionPresetLibrary(createIdbBackend(new IDBFactory()));
    const saved = await library.save("Spin up", { type: "cubeSpin", duration: 0.9, params: { direction: "up", borderWidth: 5, borderColor: "#ff00ff" } });
    if (!saved.ok) throw new Error(saved.error);
    expect((await setDefaultTransition(saved.value, "global")).ok).toBe(true);
    const stored = getDefaultTransition();
    expect(stored).toMatchObject({ presetId: saved.value.id, scope: "global", label: "Spin up" });

    // Open the same project on a machine whose library is empty.
    const elsewhere = new GlobalTransitionPresetLibrary(createIdbBackend(new IDBFactory()));
    const project = JSON.parse(JSON.stringify(useProjectStore.getState().project)) as ReturnType<typeof useProjectStore.getState>["project"];
    useProjectStore.setState({ project });
    expect(resolveDefaultPreset(getDefaultTransition(), project.transitionPresets ?? [], await elsewhere.list())).toEqual({ preset: null, missing: true });
    expect(resolveDefaultPreset(getDefaultTransition(), [], await library.list())).toMatchObject({ missing: false, preset: { name: "Spin up" } });

    expect(getDefaultTransition()).toMatchObject({ type: "cubeSpin", duration: 0.9, params: { direction: "up", borderWidth: 5, borderColor: "#ff00ff" } });
    expect((await applyDefaultTransition()).ok).toBe(true);
    expect(transitions()[0]).toMatchObject({ type: "cubeSpin", duration: 0.9, params: { direction: "up", borderWidth: 5, borderColor: "#ff00ff" } });
  });
});
