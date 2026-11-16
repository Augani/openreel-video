import { ActionExecutor, type Clip } from "@openreel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { endNudgeBurst, NUDGE_BURST_MS } from "./timeline-tool-nudge";
import {
  clearInOut,
  deleteSelectedGap,
  goToMark,
  markClip,
  parseTrimFrames,
  selectEditPoint,
  selectGapAt,
  toggleSelectedEditPointKind,
  trimSelectedEditPoint,
  trimStepFrames,
} from "./edit-point-commands";

const makeClip = (id: string, startTime: number, inPoint: number, duration: number, trackId = "main"): Clip => ({
  id,
  trackId,
  mediaId: "source",
  startTime,
  duration,
  inPoint,
  outPoint: inPoint + duration,
  speed: 1,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
});
const track = (id: string, clips: Clip[], extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type: "video" as const,
  locked: false,
  hidden: false,
  solo: false,
  muted: false,
  transitions: [],
  clips,
  ...extra,
});

/** main: a[0,4] b[4,8] gap c[10,14]. */
function setup(extraTracks: ReturnType<typeof track>[] = [], mainExtra: Record<string, unknown> = {}) {
  const project = createEmptyProject("Edit points");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    project: {
      ...project,
      settings: { ...project.settings, frameRate: 30 },
      mediaLibrary: {
        items: [
          {
            id: "source",
            name: "Source",
            type: "video" as const,
            fileHandle: null,
            blob: null,
            thumbnailUrl: null,
            waveformData: new Float32Array(10),
            metadata: { duration: 60, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
          },
        ],
      },
      timeline: {
        ...project.timeline,
        duration: 14,
        tracks: [
          track("main", [makeClip("a", 0, 10, 4), makeClip("b", 4, 20, 4), makeClip("c", 10, 30, 4)], mainExtra),
          ...extraTracks,
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
  useEditorWorkspaceStore.setState({ timelineTool: "select", linkedSelection: false, targetedTrackIds: [] });
  useUIStore.setState({ selectedItems: [] });
  useEditPointStore.getState().clear();
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0 });
  useTimelineStore.getState().clearLoopRange();
}
const clips = (id = "main") =>
  useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips
    .slice().sort((x, y) => x.startTime - y.startTime)
    .map((c) => [c.id, +c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4)]);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  endNudgeBurst();
  vi.useRealTimers();
});

describe("edit point selection", () => {
  it("selects a cut as a roll with its neighbour and a free edge as a ripple", () => {
    setup();
    selectEditPoint("a", "right");
    expect(useEditPointStore.getState().selection).toEqual({ type: "edit", clipId: "a", edge: "right", kind: "roll", neighborId: "b" });
    selectEditPoint("b", "right");
    expect(useEditPointStore.getState().selection).toMatchObject({ kind: "ripple", neighborId: null });
  });

  it("clears the clip selection when an edit point is selected, and the reverse", () => {
    setup();
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "a", trackId: "main" }] });
    selectEditPoint("a", "right");
    expect(useUIStore.getState().selectedItems).toEqual([]);
    expect(useEditPointStore.getState().selection).not.toBeNull();
    useUIStore.getState().select({ type: "clip", id: "c", trackId: "main" });
    expect(useEditPointStore.getState().selection).toBeNull();
  });

  it("Cmd/Ctrl-click toggles ripple and roll on the selected point", () => {
    setup();
    selectEditPoint("a", "right");
    selectEditPoint("a", "right", { toggleKind: true });
    expect(useEditPointStore.getState().selection).toMatchObject({ kind: "ripple" });
    selectEditPoint("a", "right", { toggleKind: true });
    expect(useEditPointStore.getState().selection).toMatchObject({ kind: "roll" });
    // A free edge has nothing to roll against.
    selectEditPoint("b", "right", { toggleKind: true });
    expect(useEditPointStore.getState().selection).toMatchObject({ kind: "ripple" });
    toggleSelectedEditPointKind();
    expect(useEditPointStore.getState().selection).toMatchObject({ kind: "ripple" });
  });

  it("selects a gap, and clicking where there is none clears the selection", () => {
    setup();
    expect(selectGapAt("main", 9)).toBe(true);
    expect(useEditPointStore.getState().selection).toEqual({ type: "gap", trackId: "main", start: 8, end: 10 });
    expect(selectGapAt("main", 5)).toBe(false);
    expect(useEditPointStore.getState().selection).toBeNull();
  });
});

describe("trimSelectedEditPoint", () => {
  it("rolls a selected cut by one or five frames and keeps the point selected", () => {
    setup();
    selectEditPoint("a", "right");
    expect(trimSelectedEditPoint(trimStepFrames(1, false)).success).toBe(true);
    expect(trimSelectedEditPoint(trimStepFrames(1, true)).success).toBe(true);
    const cut = +(4 + 6 / 30).toFixed(4);
    expect(clips()).toEqual([["a", 0, cut], ["b", cut, 8], ["c", 10, 14]]);
    expect(trimSelectedEditPoint(trimStepFrames(-1, false)).success).toBe(true);
    expect(clips()[0][2]).toBeCloseTo(4 + 5 / 30, 3);
    expect(useEditPointStore.getState().selection).toMatchObject({ clipId: "a", edge: "right" });
  });

  it("a burst of key nudges is one undo step", async () => {
    setup();
    selectEditPoint("a", "right");
    trimSelectedEditPoint(1);
    trimSelectedEditPoint(1);
    trimSelectedEditPoint(1);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    await useProjectStore.getState().undo();
    expect(clips()).toEqual([["a", 0, 4], ["b", 4, 8], ["c", 10, 14]]);
  });

  it("ripples a free edge, pulling later clips along", () => {
    setup();
    selectEditPoint("b", "right");
    expect(trimSelectedEditPoint(-3, false).success).toBe(true);
    expect(clips()).toEqual([["a", 0, 4], ["b", 4, 7.9], ["c", 9.9, 13.9]]);
  });

  it("an explicit ripple on a cut trims only that edge and ripples", () => {
    setup();
    selectEditPoint("a", "right", { toggleKind: true });
    expect(trimSelectedEditPoint(-3, false).success).toBe(true);
    expect(clips()).toEqual([["a", 0, 3.9], ["b", 3.9, 7.9], ["c", 9.9, 13.9]]);
  });

  it("reports a locked track instead of editing", () => {
    setup([], { locked: true });
    selectEditPoint("a", "right");
    const outcome = trimSelectedEditPoint(1, false);
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/Unlock/);
    expect(clips()[0]).toEqual(["a", 0, 4]);
  });

  it("needs a selected edit point, and drops one whose clip is gone", () => {
    setup();
    expect(trimSelectedEditPoint(1).success).toBe(false);
    selectEditPoint("a", "right");
    useProjectStore.setState((state) => ({
      project: { ...state.project, timeline: { ...state.project.timeline, tracks: [track("main", [makeClip("c", 10, 30, 4)])] } },
    }));
    expect(trimSelectedEditPoint(1).success).toBe(false);
    expect(useEditPointStore.getState().selection).toBeNull();
  });
});

describe("parseTrimFrames", () => {
  it("accepts signed whole frames only", () => {
    expect(parseTrimFrames("+5")).toBe(5);
    expect(parseTrimFrames(" -12 ")).toBe(-12);
    expect(parseTrimFrames("7")).toBe(7);
    expect(parseTrimFrames("−3")).toBe(-3);
    for (const bad of ["", "+", "1.5", "abc", "0", "+-2", "5f"]) expect(parseTrimFrames(bad), bad).toBeNull();
  });
});

describe("deleteSelectedGap", () => {
  it("ripple-deletes the selected gap as one undo step", async () => {
    setup();
    selectGapAt("main", 9);
    expect(deleteSelectedGap().success).toBe(true);
    expect(clips()).toEqual([["a", 0, 4], ["b", 4, 8], ["c", 8, 12]]);
    expect(useEditPointStore.getState().selection).toBeNull();
    await useProjectStore.getState().undo();
    expect(clips()[2]).toEqual(["c", 10, 14]);
  });

  it("honours sync lock: blocked by content on a sync-locked track, followed otherwise", () => {
    setup([track("other", [makeClip("o", 9, 5, 2, "other")])]);
    selectGapAt("main", 9);
    const blocked = deleteSelectedGap();
    expect(blocked.success).toBe(false);
    expect(clips()[2]).toEqual(["c", 10, 14]);
    setup([track("other", [makeClip("o", 12, 5, 2, "other")])]);
    selectGapAt("main", 9);
    expect(deleteSelectedGap().success).toBe(true);
    expect(clips("other")).toEqual([["o", 10, 12]]);
  });

  it("does nothing without a selected gap", () => {
    setup();
    expect(deleteSelectedGap().success).toBe(false);
  });
});

describe("Mark Clip and In/Out navigation", () => {
  it("marks the clip under the playhead, goes to In/Out and clears them", () => {
    setup();
    useTimelineStore.setState({ playheadPosition: 5 });
    expect(markClip().success).toBe(true);
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 4, loopEnd: 8 });
    useTimelineStore.setState({ playheadPosition: 12 });
    expect(goToMark("in").success).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(4);
    expect(goToMark("out").success).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBe(8);
    clearInOut();
    expect(goToMark("in").success).toBe(false);
  });

  it("uses targeted tracks and reports when nothing is under the playhead", () => {
    setup([track("v2", [makeClip("o", 20, 5, 3, "v2")])]);
    useEditorWorkspaceStore.setState({ targetedTrackIds: ["v2"] });
    useTimelineStore.setState({ playheadPosition: 5 });
    expect(markClip().success).toBe(false);
    useTimelineStore.setState({ playheadPosition: 21 });
    expect(markClip().success).toBe(true);
    expect(useTimelineStore.getState()).toMatchObject({ loopStart: 20, loopEnd: 23 });
  });
});
