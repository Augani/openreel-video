import { ActionExecutor, type Clip } from "@openreel/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { keyboardShortcuts } from "./keyboard-shortcuts";
import {
  applyDefaultTransition,
  applyTransitionToSelectedCut,
  deleteTransitionPreset,
  findTransitionCut,
  getDefaultTransition,
  getTransitionPresets,
  renameTransitionPreset,
  saveTransitionPreset,
  setDefaultTransition,
} from "./transition-presets";

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

function setup() {
  const project = createEmptyProject("Transitions");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: {
      ...project,
      settings: { ...project.settings, frameRate: 30 },
      timeline: {
        ...project.timeline,
        duration: 12,
        tracks: [
          {
            id: "main",
            name: "main",
            type: "video" as const,
            locked: false,
            hidden: false,
            solo: false,
            muted: false,
            transitions: [],
            clips: [makeClip("a", 0, 4), makeClip("b", 4, 4), makeClip("c", 10, 2)],
          },
        ],
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
  useUIStore.setState({ selectedItems: [] });
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0 });
}
const transitions = () => useProjectStore.getState().project.timeline.tracks[0]!.transitions;
const select = (...ids: string[]) => useUIStore.setState({ selectedItems: ids.map((id) => ({ id, type: "clip" as const })) });

beforeEach(setup);

describe("transition preset library", () => {
  it("saves, renames, deletes and undoes presets; names are unique", async () => {
    const saved = await saveTransitionPreset(" Red iris ", { type: "irisBox", duration: 0.8, params: { borderWidth: 6, borderColor: "#ff0000", feather: 0.2 } });
    expect(saved.ok).toBe(true);
    const [preset] = getTransitionPresets();
    expect(preset).toMatchObject({ name: "Red iris", type: "irisBox", duration: 0.8 });
    expect(preset!.params).toMatchObject({ borderColor: "#ff0000", borderWidth: 6, center: { x: 0.5, y: 0.5 } });
    expect((await saveTransitionPreset("red IRIS", { type: "irisBox", duration: 1, params: {} })).ok).toBe(false);
    expect((await renameTransitionPreset(preset!.id, "Crimson")).ok).toBe(true);
    expect(getTransitionPresets()[0]!.name).toBe("Crimson");
    expect((await deleteTransitionPreset(preset!.id)).ok).toBe(true);
    expect(getTransitionPresets()).toHaveLength(0);
    await useProjectStore.getState().undo();
    expect(getTransitionPresets()).toHaveLength(1);
    expect(getTransitionPresets()[0]!.name).toBe("Crimson");
  });

  it("a preset survives the project's own save and reload", async () => {
    await saveTransitionPreset("Kept", { type: "clockWipe", duration: 1, params: { feather: 0.5 } });
    await setDefaultTransition(getTransitionPresets()[0]!);
    const copy = JSON.parse(JSON.stringify(useProjectStore.getState().project)) as ReturnType<typeof useProjectStore.getState>["project"];
    useProjectStore.setState({ project: { ...copy, transitionPresets: undefined, defaultTransition: undefined } });
    expect(getTransitionPresets()).toHaveLength(0);
    useProjectStore.setState({ project: copy });
    expect(getTransitionPresets()[0]).toMatchObject({ name: "Kept", type: "clockWipe" });
    expect(getDefaultTransition()).toMatchObject({ type: "clockWipe", label: "Kept" });
  });
});

describe("default transition and applying at a cut", () => {
  it("falls back to Cross dissolve, then uses the set default and undoes", async () => {
    expect(getDefaultTransition().type).toBe("crossfade");
    select("a", "b");
    const first = await applyDefaultTransition();
    expect(first.ok).toBe(true);
    expect(transitions()).toHaveLength(1);
    expect(transitions()[0]).toMatchObject({ type: "crossfade", clipAId: "a", clipBId: "b" });

    expect((await setDefaultTransition({ type: "barnDoor", duration: 0.6, params: { feather: 0.3 }, label: "Barn" })).ok).toBe(true);
    expect(getDefaultTransition()).toMatchObject({ type: "barnDoor", duration: 0.6 });
    const second = await applyDefaultTransition();
    expect(second.ok).toBe(true);
    expect(transitions()).toHaveLength(1); // replaces the one at the same cut
    expect(transitions()[0]).toMatchObject({ type: "barnDoor", duration: 0.6 });
    expect(transitions()[0]!.params).toMatchObject({ feather: 0.3, orientation: "horizontal" });
    await useProjectStore.getState().undo();
    expect(transitions()[0]).toMatchObject({ type: "crossfade" });
    await useProjectStore.getState().undo();
    expect(getDefaultTransition().type).toBe("crossfade");
  });

  it("clamps a long preset duration to the clips and applies the preset's parameters", async () => {
    await saveTransitionPreset("Long", { type: "irisRound", duration: 30, params: { borderWidth: 4 } });
    const preset = getTransitionPresets()[0]!;
    select("b"); // its next neighbour is across a gap, so the cut with a is used
    expect((await applyTransitionToSelectedCut(preset)).ok).toBe(true);
    expect(transitions()).toHaveLength(1);
    expect(transitions()[0]).toMatchObject({ clipAId: "a", clipBId: "b" });
    expect(transitions()[0]!.duration).toBeLessThanOrEqual(8);
    expect(transitions()[0]!.params.borderWidth).toBe(4);
  });

  it("finds the cut from one selected clip, two selected clips or the playhead, and says why not", async () => {
    const project = useProjectStore.getState().project;
    expect(findTransitionCut(project, new Set(["a"]), 0)).toMatchObject({ clipA: { id: "a" }, clipB: { id: "b" } });
    expect(findTransitionCut(project, new Set(["b"]), 0)).toMatchObject({ clipA: { id: "a" }, clipB: { id: "b" } });
    expect(findTransitionCut(project, new Set(["c"]), 0)?.clipB).toBeUndefined(); // alone: an outro
    expect(findTransitionCut(project, new Set(["b", "c"]), 0)).toBeNull();
    expect(findTransitionCut(project, new Set(["a", "b"]), 0)).toMatchObject({ clipA: { id: "a" }, clipB: { id: "b" } });
    expect(findTransitionCut(project, new Set(), 4)).toMatchObject({ clipA: { id: "a" }, clipB: { id: "b" } });
    expect(findTransitionCut(project, new Set(), 2)).toBeNull();
    const none = await applyDefaultTransition();
    expect(none.ok).toBe(false);
  });
});

describe("Apply Default Transition shortcut", () => {
  it("is bound to Cmd+Shift+D by default and takes Cmd+D in the Premiere set, moving Duplicate", () => {
    expect(keyboardShortcuts.getShortcut("editing.applyDefaultTransition")?.defaultKey).toBe("cmd+shift+d");
    expect(keyboardShortcuts.getShortcut("editing.duplicate")?.defaultKey).toBe("cmd+d");
    const diff = keyboardShortcuts.presetDiff("premiere")!;
    expect(diff.changes.find((change) => change.id === "editing.applyDefaultTransition")?.to).toBe("cmd+d");
    expect(diff.changes.find((change) => change.id === "editing.duplicate")).toMatchObject({ displaced: true });
  });
});
