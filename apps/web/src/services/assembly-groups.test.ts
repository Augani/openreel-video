import { beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor, expandClipGroups, type Clip, type MediaItem, type Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { groupSelectedClips, makeSubsequenceCommand, ungroupSelectedClips } from "./sequence-commands";
import { automateToSequence, DEFAULT_ASSEMBLY_REQUEST, getAssemblySelection } from "./assembly-commands";

const state = () => useProjectStore.getState();
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 };
const clip = (id: string, trackId: string, startTime: number): Clip => ({
  id, trackId, mediaId: "m0", startTime, duration: 4, inPoint: 0, outPoint: 4, transform, volume: 1, effects: [], audioEffects: [], keyframes: [],
});
const media = (id: string, name: string, type: MediaItem["type"], duration: number): MediaItem => ({
  id, name, type, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "x", fileSize: 1, hasAudio: type === "video" },
});
const items = [media("m1", "one.mp4", "video", 4), media("m2", "two.mp4", "video", 6), media("m3", "three.png", "image", 0), media("m4", "four.mp4", "video", 3), media("m5", "five.mp4", "video", 2)];

function open() {
  const base = createEmptyProject("Assembly");
  const project: Project = {
    ...base,
    mediaLibrary: { ...base.mediaLibrary, items },
    timeline: {
      ...base.timeline,
      duration: 12,
      tracks: [
        { id: "v1", name: "V1", type: "video", clips: [clip("a", "v1", 0), clip("b", "v1", 4), clip("c", "v1", 8)], transitions: [], locked: false, hidden: false, muted: false, solo: false },
        { id: "a1", name: "A1", type: "audio", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false },
      ],
    },
  };
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project, actionExecutor: executor, actionHistory: executor.getHistory(), hasOpenProject: true,
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
}
const clips = () => state().project.timeline.tracks.flatMap((t) => t.clips);
const byId = (id: string) => clips().find((c) => c.id === id) as Clip;
const undoSteps = () => state().actionExecutor.getHistory().getUndoStackSize();
const selectIds = (...ids: string[]) => useUIStore.setState({ selectedItems: ids.map((id) => ({ type: "clip" as const, id })) });

beforeEach(() => {
  open();
  selectIds();
  useUIStore.setState({ effectApplicationClipId: null, exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useTimelineStore.setState({ playbackLockedReason: null, loopStart: 0, loopEnd: 0, playheadPosition: 0 });
});

describe("clip groups in the project store", () => {
  it("group -> move together -> trim one -> ungroup, each a single undo step that undoes cleanly", async () => {
    selectIds("a", "b");
    const before = undoSteps();
    expect((await groupSelectedClips()).ok).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    expect(byId("a").groupId).toBeDefined();
    expect(byId("a").groupId).toBe(byId("b").groupId);
    expect(byId("c").groupId).toBeUndefined();

    // Selecting one member selects the group.
    expect(expandClipGroups(state().project.timeline.tracks, ["a"]).sort()).toEqual(["a", "b"]);

    const moved = await state().executeAction({
      type: "clip/moveBatch", id: crypto.randomUUID(), timestamp: Date.now(),
      params: { moves: expandClipGroups(state().project.timeline.tracks, ["a"]).map((id) => ({ clipId: id, startTime: byId(id).startTime + 20 })) },
    });
    expect(moved.success).toBe(true);
    expect([byId("a").startTime, byId("b").startTime, byId("c").startTime]).toEqual([20, 24, 8]);
    expect(byId("a").groupId).toBe(byId("b").groupId);

    const trimmed = await state().executeAction({ type: "clip/trim", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: "a", outPoint: 2 } });
    expect(trimmed.success).toBe(true);
    expect(byId("a").duration).toBe(2);
    expect([byId("b").startTime, byId("b").duration]).toEqual([24, 4]);
    expect(byId("a").groupId).toBe(byId("b").groupId);

    selectIds("b");
    expect((await ungroupSelectedClips()).ok).toBe(true);
    expect(byId("a").groupId).toBeUndefined();
    expect(byId("b").groupId).toBeUndefined();

    // Undo ungroup, trim, move, group in reverse order.
    await state().undo();
    expect(byId("a").groupId).toBe(byId("b").groupId);
    await state().undo();
    await state().undo();
    expect([byId("a").startTime, byId("b").startTime]).toEqual([0, 4]);
    await state().undo();
    expect(byId("a").groupId).toBeUndefined();
    expect(undoSteps()).toBe(before);
    await state().redo();
    expect(byId("a").groupId).toBeDefined();
  });

  it("refuses a single clip and leaves the project alone", async () => {
    selectIds("a");
    const before = undoSteps();
    expect((await groupSelectedClips()).ok).toBe(false);
    expect(undoSteps()).toBe(before);
    expect(byId("a").groupId).toBeUndefined();
  });

  it("deleting a group removes every member in one step and undo brings them back grouped", async () => {
    selectIds("a", "b");
    await groupSelectedClips();
    const ids = expandClipGroups(state().project.timeline.tracks, ["a"]);
    const removed = await state().executeAction({ type: "clip/removeBatch", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipIds: ids } });
    expect(removed.success).toBe(true);
    expect(clips().map((c) => c.id)).toEqual(["c"]);
    await state().undo();
    expect(byId("a").groupId).toBe(byId("b").groupId);
  });
});

describe("Make Subsequence in the project store", () => {
  it("nests the In/Out range in place as one undo step", async () => {
    useTimelineStore.setState({ loopStart: 2, loopEnd: 10 });
    const before = undoSteps();
    const result = await makeSubsequenceCommand("Sub");
    expect(result.ok).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    const sorted = [...clips()].sort((x, y) => x.startTime - y.startTime);
    expect(sorted.map((c) => [c.startTime, c.duration])).toEqual([[0, 2], [2, 8], [10, 2]]);
    await state().undo();
    expect(clips().map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("without a range uses the selected clips' extent", async () => {
    selectIds("b", "c");
    const result = await makeSubsequenceCommand();
    expect(result.ok).toBe(true);
    expect(clips().map((c) => [c.startTime, c.duration]).sort((x, y) => x[0] - y[0])).toEqual([[0, 4], [4, 8]]);
  });
});

describe("Automate to Sequence in the project store", () => {
  const select5 = () => selectIds("m3", "m1", "m5", "m2", "m4");
  it("five selected assets land in selection order with default transitions, as one undo step", () => {
    select5();
    useTimelineStore.setState({ playheadPosition: 12 });
    expect(getAssemblySelection().map((m) => m.id)).toEqual(["m3", "m1", "m5", "m2", "m4"]);
    const before = undoSteps();
    const outcome = automateToSequence({ ...DEFAULT_ASSEMBLY_REQUEST, method: "overwrite", videoTransition: true, stillDuration: 2 });
    expect(outcome.success).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    const added = state().project.timeline.tracks.find((t) => t.id === "v1")!.clips.filter((c) => c.startTime >= 12).sort((x, y) => x.startTime - y.startTime);
    expect(added.map((c) => [c.mediaId, c.startTime, c.duration])).toEqual([["m3", 12, 2], ["m1", 14, 4], ["m5", 18, 2], ["m2", 20, 6], ["m4", 26, 3]]);
    expect(state().project.timeline.tracks.find((t) => t.id === "v1")!.transitions).toHaveLength(4);
    expect(state().project.timeline.tracks.find((t) => t.id === "a1")!.clips).toHaveLength(4);
    expect(useTimelineStore.getState().playheadPosition).toBe(29);
  });

  it("undo removes everything it placed, including the transitions", async () => {
    select5();
    const base = JSON.stringify(state().project.timeline.tracks);
    automateToSequence({ ...DEFAULT_ASSEMBLY_REQUEST, method: "overwrite", videoTransition: true });
    expect(clips().length).toBeGreaterThan(3);
    await state().undo();
    expect(JSON.stringify(state().project.timeline.tracks)).toBe(base);
  });

  it("reports why nothing was placed", () => {
    selectIds();
    const outcome = automateToSequence(DEFAULT_ASSEMBLY_REQUEST);
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/select media/i);
  });
});
