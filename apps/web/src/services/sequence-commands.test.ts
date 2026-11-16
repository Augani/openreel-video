import { beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor, type Clip, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  commitSequenceEdit,
  duplicateSequenceCommand,
  newSequence,
  nestSelectedClips,
  openNestClip,
  openSequence,
  placeSequenceOnTimeline,
  renameSequenceCommand,
  closeSequenceTabCommand,
  deleteSequenceCommand,
  parkedPlayheadCount,
  prunePlayheads,
} from "./sequence-commands";

const state = () => useProjectStore.getState();
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number): Clip => ({
  id, trackId, mediaId: id, startTime, duration: 4, inPoint: 0, outPoint: 4, transform, volume: 1, effects: [], audioEffects: [], keyframes: [],
});

function open(): Project {
  const base = createEmptyProject("Sequences");
  const project: Project = {
    ...base,
    timeline: {
      ...base.timeline,
      duration: 8,
      tracks: [{ id: "v1", name: "V1", type: "video", clips: [clip("a", "v1", 0), clip("b", "v1", 4)], transitions: [], locked: false, hidden: false, muted: false, solo: false }],
    },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project, actionExecutor: executor, actionHistory: executor.getHistory(), hasOpenProject: true,
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
  return project;
}
const clipIds = () => state().project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id));
const history = () => state().actionExecutor.getHistory();
const select = (...ids: string[]) =>
  useUIStore.setState({ selectedItems: ids.map((id) => ({ type: "clip" as const, id })) });

beforeEach(() => {
  open();
  select();
  useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useTimelineStore.setState({ playbackLockedReason: null });
});

describe("sequence commands in the project store", () => {
  it("nest -> open -> trim inside -> back: the parent definition follows; every step is one undo step", async () => {
    select("a", "b");
    const nested = await nestSelectedClips("Nest 1");
    expect(nested.ok).toBe(true);
    const nestId = nested.ok ? (nested.sequenceId as string) : "";
    const nestClipId = nested.ok ? (nested.clipId as string) : "";
    expect(clipIds()).toEqual([nestClipId]);
    expect(history().getUndoStackSize()).toBe(1);

    expect((await openNestClip(nestClipId)).ok).toBe(true);
    expect(state().project.activeSequenceId).toBe(nestId);
    expect(clipIds()).toEqual(["a", "b"]);
    expect(history().getUndoStackSize()).toBe(2);

    const trim = await state().executeAction({ type: "clip/trim", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: "b", outPoint: 1 } });
    expect(trim.success).toBe(true);
    expect(history().getUndoStackSize()).toBe(3);

    expect((await openSequence("seq_main")).ok).toBe(true);
    const definition = state().project.compoundClips?.find((c) => c.id === nestId);
    expect(definition?.content.duration).toBe(5);
    expect(definition?.content.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(1);

    // Undo: back inside, undo the trim, undo the open, undo the nest.
    await state().undo();
    expect(state().project.activeSequenceId).toBe(nestId);
    expect(state().project.timeline.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(1);
    await state().undo();
    expect(state().project.timeline.tracks[0].clips.find((c) => c.id === "b")?.duration).toBe(4);
    await state().undo();
    expect(clipIds()).toEqual([nestClipId]);
    await state().undo();
    expect(clipIds()).toEqual(["a", "b"]);
    expect(state().project.compoundClips ?? []).toHaveLength(0);

    // Redo replays all of it to the same end state.
    for (let i = 0; i < 4; i += 1) await state().redo();
    expect(state().project.activeSequenceId).toBe("seq_main");
    expect(state().project.compoundClips?.find((c) => c.id === nestId)?.content.duration).toBe(5);
  });

  it("getFullProject always carries the live timeline in the stored active sequence (autosave/save path)", async () => {
    await newSequence({ name: "B" });
    await state().executeAction({ type: "track/add", id: crypto.randomUUID(), timestamp: Date.now(), params: { trackType: "video", position: 0 } });
    const full = state().getFullProject();
    const stored = full.sequences?.find((s) => s.id === full.activeSequenceId);
    expect(stored?.timeline.tracks.length).toBe(3);
    expect(stored?.timeline).toBe(full.timeline);
  });

  it("refuses a cycle with a clear message and leaves history untouched", async () => {
    select("a");
    const nested = await nestSelectedClips("Inner");
    const nestId = nested.ok ? (nested.sequenceId as string) : "";
    await openSequence(nestId);
    const before = history().getUndoStackSize();
    const result = await placeSequenceOnTimeline("seq_main", undefined, 0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/already contains|inside itself/);
    expect(history().getUndoStackSize()).toBe(before);
    const self = await placeSequenceOnTimeline(nestId, undefined, 0);
    expect(self.ok).toBe(false);
  });

  it("new/duplicate/rename/close/delete work through the store and each is one undo step", async () => {
    const created = await newSequence({ name: "Alt", settings: { width: 1080, height: 1920 } });
    expect(created.ok).toBe(true);
    expect(state().project.settings.width).toBe(1080);
    expect(history().getUndoStackSize()).toBe(1);
    const altId = created.ok ? (created.sequenceId as string) : "";
    expect((await renameSequenceCommand(altId, "Alt cut")).ok).toBe(true);
    expect(state().project.sequences?.find((s) => s.id === altId)?.name).toBe("Alt cut");
    const copy = await duplicateSequenceCommand("seq_main");
    expect(copy.ok && state().project.sequences?.map((s) => s.name)).toEqual(["Sequence 1", "Sequence 1 (Copy)", "Alt cut"]);
    expect((await closeSequenceTabCommand(altId)).ok).toBe(true);
    expect(state().project.activeSequenceId).toBe("seq_main");
    expect(state().project.openSequenceIds).toEqual(["seq_main"]);
    expect((await deleteSequenceCommand(altId)).ok).toBe(true);
    expect(state().project.sequences).toHaveLength(2);
    expect(history().getUndoStackSize()).toBe(5);
    await state().undo();
    expect(state().project.sequences).toHaveLength(3);
  });

  it("forgets the parked playhead of a deleted sequence", async () => {
    const created = await newSequence({ name: "Alt" });
    const altId = created.ok ? (created.sequenceId as string) : "";
    useTimelineStore.getState().seekTo(1.5);
    await openSequence("seq_main"); // parks the playhead of "Alt"
    const parked = parkedPlayheadCount();
    expect(parked).toBeGreaterThan(0);
    expect((await deleteSequenceCommand(altId)).ok).toBe(true);
    expect(parkedPlayheadCount()).toBe(parked - 1);
    prunePlayheads({ sequences: [] });
    expect(parkedPlayheadCount()).toBe(0);
  });

  it("is blocked while exporting", async () => {
    useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    const result = await commitSequenceEdit("x", (p) => ({ ok: true, project: p }));
    expect(result.ok).toBe(false);
    expect(history().getUndoStackSize()).toBe(0);
  });
});
