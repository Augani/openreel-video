import { ActionExecutor, planEditPointTrim, type Clip } from "@openreel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { endNudgeBurst } from "./timeline-tool-nudge";
import { selectEditPoint, toggleSelectedEditPointKind } from "./edit-point-commands";
import { advanceDynamicTrim, cancelDynamicTrim, commitDynamicTrim, dynamicTrimFrameStep, dynamicTrimShuttle } from "./dynamic-trim";

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
  cancelDynamicTrim();
  endNudgeBurst();
  vi.useRealTimers();
});

const stopTimerForTest = () => vi.clearAllTimers();
const session = () => useEditPointStore.getState().dynamicTrim;
const snapOn = () => useUIStore.getState().snapSettings.enabled;
const ORIGINAL = [["a", 0, 4], ["b", 4, 8], ["c", 10, 14]];

describe("dynamic JKL trimming", () => {
  it("L runs the edge forward with the playhead and K commits it as one undo step", async () => {
    setup();
    selectEditPoint("b", "right");
    expect(dynamicTrimShuttle(1).success).toBe(true);
    advanceDynamicTrim(0.5);
    expect(clips()).toEqual(ORIGINAL);
    const frames = session()!.appliedFrames;
    expect(frames).toBeGreaterThan(10);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(8 + frames / 30, 3);
    expect(commitDynamicTrim()?.success).toBe(true);
    expect(session()).toBeNull();
    expect(clips()[1][2]).toBeCloseTo(8 + frames / 30, 3);
    expect(clips()[2][1]).toBeCloseTo(10 + frames / 30, 3);
    await useProjectStore.getState().undo();
    expect(clips()).toEqual(ORIGINAL);
  });

  it("J trims earlier by the same frames a frame-delta trim (agent trim_edit_point) applies", () => {
    setup();
    selectEditPoint("b", "right");
    dynamicTrimShuttle(-1);
    advanceDynamicTrim(0.2);
    const frames = session()!.appliedFrames;
    expect(frames).toBeLessThan(0);
    commitDynamicTrim();
    const live = clips();
    setup();
    const plan = planEditPointTrim(useProjectStore.getState().getFullProject(), {
      clipId: "b", edge: "right", frames, kind: "ripple",
    });
    expect(Math.round(plan.delta * 30)).toBe(frames);
    expect(live[1][2]).toBeCloseTo(8 + frames / 30, 3);
  });

  it("repeated presses double the shuttle speed and the opposite key resets it", () => {
    setup();
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    expect(session()?.speed).toBe(1);
    dynamicTrimShuttle(1);
    dynamicTrimShuttle(1);
    expect(session()?.speed).toBe(4);
    dynamicTrimShuttle(-1);
    expect(session()).toMatchObject({ speed: 1, direction: -1 });
  });

  it("Esc cancels: project untouched, playhead and snapping restored", () => {
    setup();
    useTimelineStore.setState({ playheadPosition: 2 });
    useUIStore.getState().setSnapEnabled(true);
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    advanceDynamicTrim(1);
    expect(snapOn()).toBe(false);
    expect(cancelDynamicTrim()).toBe(true);
    expect(clips()).toEqual(ORIGINAL);
    expect(useTimelineStore.getState().playheadPosition).toBe(2);
    expect(snapOn()).toBe(true);
    expect(cancelDynamicTrim()).toBe(false);
  });

  it("snapping is restored after a commit", () => {
    setup();
    useUIStore.getState().setSnapEnabled(true);
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    expect(snapOn()).toBe(false);
    commitDynamicTrim();
    expect(snapOn()).toBe(true);
  });

  it("clamps at the source handle, stops, and reports the limit", () => {
    setup();
    selectEditPoint("b", "right"); // source is 60s, b uses 20..24
    dynamicTrimShuttle(1);
    for (let i = 0; i < 40; i++) advanceDynamicTrim(1);
    expect(session()).toMatchObject({ limited: true, direction: 0 });
    const frames = session()!.appliedFrames;
    expect(frames).toBeLessThanOrEqual(36 * 30);
    expect(frames).toBeGreaterThan(30 * 30);
    commitDynamicTrim();
    const b = useProjectStore.getState().project.timeline.tracks[0].clips.find((c) => c.id === "b")!;
    expect(b.outPoint).toBeLessThanOrEqual(60 + 1e-6);
    expect(clips()[1][2]).toBeCloseTo(8 + frames / 30, 2);
  });

  it("roll keeps the total length while ripple shifts later clips", () => {
    setup();
    selectEditPoint("a", "right"); // the a|b cut is a roll
    dynamicTrimShuttle(1);
    advanceDynamicTrim(0.3);
    commitDynamicTrim();
    expect(clips()[0][2]).toBeGreaterThan(4);
    expect(clips()[1][2]).toBe(8);
    expect(clips()[2][1]).toBe(10);
  });

  it("a locked track blocks the trim before it starts", () => {
    setup([], { locked: true });
    selectEditPoint("b", "right");
    expect(dynamicTrimShuttle(1).success).toBe(false);
    expect(session()).toBeNull();
  });

  it("does nothing without an edit point selected", () => {
    setup();
    expect(dynamicTrimShuttle(1).success).toBe(false);
    expect(session()).toBeNull();
  });

  it("K held with J/L trims a single frame", () => {
    setup();
    selectEditPoint("b", "right");
    expect(dynamicTrimFrameStep(1).success).toBe(true);
    expect(clips()[1][2]).toBeCloseTo(8 + 1 / 30, 3);
    expect(dynamicTrimFrameStep(-1).success).toBe(true);
    expect(clips()[1][2]).toBeCloseTo(8, 3);
  });

  it("committing a fully blocked trim leaves the project and playhead alone", () => {
    setup();
    useTimelineStore.setState({ playheadPosition: 3 });
    // Clip c starts at source 0, so its left edge has no handle to extend into.
    const project = useProjectStore.getState().project;
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: project.timeline.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === "c" ? { ...c, inPoint: 0, outPoint: 4 } : c)),
          })),
        },
      },
    });
    selectEditPoint("c", "left");
    dynamicTrimShuttle(-1);
    expect(session()).toMatchObject({ limited: true, appliedFrames: 0 });
    commitDynamicTrim();
    expect(clips()).toEqual(ORIGINAL);
    expect(useTimelineStore.getState().playheadPosition).toBe(3);
  });

  it("runs on the real interval loop and Space-style commit is one undo step", async () => {
    setup();
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    vi.advanceTimersByTime(600);
    const frames = session()!.appliedFrames;
    expect(frames).toBeGreaterThan(10);
    commitDynamicTrim();
    expect(clips()[1][2]).toBeCloseTo(8 + frames / 30, 3);
    vi.advanceTimersByTime(1000);
    expect(clips()[1][2]).toBeCloseTo(8 + frames / 30, 3);
    await useProjectStore.getState().undo();
    expect(clips()).toEqual(ORIGINAL);
  });

  it("live result has exactly the geometry of a frames-delta trim_edit_point plan", () => {
    setup();
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    advanceDynamicTrim(0.4);
    const frames = session()!.appliedFrames;
    commitDynamicTrim();
    const live = clips();
    setup();
    const plan = planEditPointTrim(useProjectStore.getState().getFullProject(), {
      clipId: "b", edge: "right", frames, kind: "ripple",
    });
    expect(useProjectStore.getState().commitTimelineToolEdit(plan).success).toBe(true);
    expect(live).toEqual(clips());
  });

  it("ripples later clips on linked audio and keeps the pair together", async () => {
    const audio = track("aud", [makeClip("a2", 0, 10, 4, "aud"), makeClip("b2", 4, 20, 4, "aud"), makeClip("c2", 10, 30, 4, "aud")], { type: "audio" });
    setup([audio]);
    useEditorWorkspaceStore.setState({ linkedSelection: true });
    selectEditPoint("b", "right");
    dynamicTrimShuttle(1);
    advanceDynamicTrim(0.3);
    const frames = session()!.appliedFrames;
    expect(frames).toBeGreaterThan(5);
    commitDynamicTrim();
    expect(clips("main")[1][2]).toBeCloseTo(8 + frames / 30, 3);
    expect(clips("aud")[1][2]).toBeCloseTo(8 + frames / 30, 3);
    expect(clips("aud")[2][1]).toBeCloseTo(10 + frames / 30, 3);
    expect(clips("main")[2][1]).toBeCloseTo(10 + frames / 30, 3);
    await useProjectStore.getState().undo();
    expect(clips("main")).toEqual(ORIGINAL);
    expect(clips("aud").map(([, st, en]) => [st, en])).toEqual(ORIGINAL.map(([, st, en]) => [st, en]));
  });

  describe("a session is tied to the edit point it started on", () => {
    it("selecting another edit point cancels instead of trimming it", () => {
      setup();
      useTimelineStore.setState({ playheadPosition: 2 });
      useUIStore.getState().setSnapEnabled(true);
      selectEditPoint("b", "right");
      dynamicTrimShuttle(1);
      advanceDynamicTrim(0.3);
      selectEditPoint("a", "right");
      advanceDynamicTrim(0.1);
      expect(session()).toBeNull();
      expect(commitDynamicTrim()).toBeNull();
      expect(clips()).toEqual(ORIGINAL);
      expect(useTimelineStore.getState().playheadPosition).toBe(2);
      expect(snapOn()).toBe(true);
    });

    it("toggling Ripple/Roll mid-session makes the commit fail without editing", () => {
      setup();
      selectEditPoint("a", "right"); // a|b cut: Roll by default
      dynamicTrimShuttle(1);
      stopTimerForTest();
      advanceDynamicTrim(0.3);
      toggleSelectedEditPointKind();
      expect(useEditPointStore.getState().selection).toMatchObject({ kind: "ripple" });
      expect(commitDynamicTrim()?.success).toBe(false);
      expect(session()).toBeNull();
      expect(clips()).toEqual(ORIGINAL);
    });

    it("clearing the selection cancels rather than reporting a limit", () => {
      setup();
      selectEditPoint("b", "right");
      dynamicTrimShuttle(1);
      useEditPointStore.getState().clear();
      advanceDynamicTrim(0.3);
      expect(session()).toBeNull();
      expect(clips()).toEqual(ORIGINAL);
    });

    it("an undo during the session cancels it and does not re-trim", async () => {
      setup();
      selectEditPoint("b", "right");
      expect(dynamicTrimFrameStep(1).success).toBe(true);
      const afterStep = clips();
      dynamicTrimShuttle(1);
      advanceDynamicTrim(0.3);
      await useProjectStore.getState().undo();
      expect(commitDynamicTrim()?.success).toBe(false);
      expect(session()).toBeNull();
      expect(clips()).toEqual(ORIGINAL);
      expect(clips()).not.toEqual(afterStep);
    });
  });
});
