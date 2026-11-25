import { ActionExecutor, type Clip } from "@openreel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { useEditPointStore } from "../stores/edit-point-store";
import { useTrimMonitorStore } from "../stores/trim-monitor-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { endNudgeBurst } from "./timeline-tool-nudge";
import { selectEditPoint } from "./edit-point-commands";
import { advanceDynamicTrim, cancelDynamicTrim, commitDynamicTrim, dynamicTrimShuttle, flushDynamicTrimMonitor } from "./dynamic-trim";
import {
  closeTrimMonitor,
  openTrimMonitor,
  parseTrimOffset,
  playAroundEdit,
  setTrimMonitorMode,
  setTrimMonitorSide,
  stopPlayAround,
  toggleTrimMonitor,
  trimMonitorKeyApplies,
  trimMonitorNavigate,
  trimMonitorOffset,
  trimMonitorTimes,
} from "./trim-monitor";

const FRAME = 1 / 30;
const makeClip = (id: string, startTime: number, inPoint: number, duration: number, trackId = "main"): Clip => ({
  id, trackId, mediaId: "source", startTime, duration, inPoint, outPoint: inPoint + duration, speed: 1, volume: 1,
  effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } },
});
const track = (id: string, clips: Clip[], extra: Record<string, unknown> = {}, type: "video" | "audio" = "video") => ({
  id, name: id, type, locked: false, hidden: false, solo: false, muted: false, transitions: [], clips, ...extra,
});

/** main: a[0,4] b[4,8] c[8,12] d[14,18] (a gap before d); a1 mirrors main when `audio` is given. */
function setup(options: { audio?: Record<string, unknown>; linked?: boolean } = {}) {
  const project = createEmptyProject("Trim monitor");
  const executor = new ActionExecutor();
  const tracks = [
    track("main", [makeClip("a", 0, 10, 4), makeClip("b", 4, 20, 4), makeClip("c", 8, 30, 4), makeClip("d", 14, 40, 4)]),
  ];
  if (options.audio)
    tracks.push(
      track(
        "a1",
        [makeClip("aa", 0, 10, 4, "a1"), makeClip("ab", 4, 20, 4, "a1"), makeClip("ac", 8, 30, 4, "a1"), makeClip("ad", 14, 40, 4, "a1")],
        options.audio,
        "audio",
      ),
    );
  useProjectStore.setState({
    project: {
      ...project,
      settings: { ...project.settings, frameRate: 30 },
      mediaLibrary: {
        items: [{
          id: "source", name: "Source", type: "video" as const, fileHandle: null, blob: null, thumbnailUrl: null,
          waveformData: new Float32Array(10),
          metadata: { duration: 60, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
        }],
      },
      timeline: { ...project.timeline, duration: 18, tracks },
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
  useEditorWorkspaceStore.setState({ timelineTool: "select", linkedSelection: options.linked ?? false, targetedTrackIds: [] });
  useUIStore.setState({ selectedItems: [] });
  useEditPointStore.getState().clear();
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0, playbackState: "stopped" });
  useTimelineStore.getState().clearLoopRange();
  useTrimMonitorStore.setState({ open: false, playingAround: false, lastOffset: null, notice: null, mode: "roll", side: "incoming" });
}

const layout = (id = "main") =>
  useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips
    .slice().sort((x, y) => x.startTime - y.startTime)
    .map((c): [string, number, number, number] => [c.id, +c.startTime.toFixed(4), +(c.startTime + c.duration).toFixed(4), +c.inPoint.toFixed(4)]);
const history = () => useProjectStore.getState().actionHistory.getHistory().length;
const ORIGINAL = layout;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  stopPlayAround();
  cancelDynamicTrim();
  closeTrimMonitor();
  endNudgeBurst();
  vi.useRealTimers();
});

describe("opening the Trim Monitor", () => {
  it("opens on the selected cut in Roll and parks the playhead on it", () => {
    setup();
    selectEditPoint("b", "left");
    expect(trimMonitorKeyApplies()).toBe(true);
    expect(openTrimMonitor().success).toBe(true);
    expect(useTrimMonitorStore.getState()).toMatchObject({ open: true, mode: "roll" });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(4, 4);
  });

  it("T is for titles until an edit point is selected", () => {
    setup();
    expect(trimMonitorKeyApplies()).toBe(false);
    selectEditPoint("a", "right");
    expect(trimMonitorKeyApplies()).toBe(true);
  });

  it("with no edit point selected it picks the one nearest the playhead", () => {
    setup();
    useTimelineStore.setState({ playheadPosition: 7.9 });
    expect(openTrimMonitor().success).toBe(true);
    const selection = useEditPointStore.getState().selection;
    expect(selection).toMatchObject({ type: "edit" });
    expect(trimMonitorTimes(useProjectStore.getState().project, { clipId: "c", edge: "left" }, 30)?.incoming).toBeCloseTo(8);
  });

  it("starts in ripple at a free edge and toggles closed", () => {
    setup();
    selectEditPoint("d", "right");
    openTrimMonitor();
    expect(useTrimMonitorStore.getState().mode).toBe("ripple-out");
    expect(toggleTrimMonitor().success).toBe(true);
    expect(useTrimMonitorStore.getState().open).toBe(false);
  });

  it("reports the outgoing last frame and incoming first frame times", () => {
    setup();
    const times = trimMonitorTimes(useProjectStore.getState().project, { clipId: "b", edge: "left" }, 30)!;
    expect(times.outgoing).toBeCloseTo(4 - FRAME, 5);
    expect(times.incoming).toBeCloseTo(4, 5);
    const free = trimMonitorTimes(useProjectStore.getState().project, { clipId: "d", edge: "left" }, 30)!;
    expect(free.outgoing).toBeNull();
  });
});

describe("trims from the monitor are one undo step each", () => {
  it("roll by -5 / +1 / numeric offsets moves the cut and undoes in one step", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    const before = layout();
    const h = history();
    expect(trimMonitorOffset(-5).success).toBe(true);
    expect(history()).toBe(h + 1);
    expect(layout()[0][2]).toBeCloseTo(4 - 5 * FRAME, 3);
    expect(layout()[1][1]).toBeCloseTo(4 - 5 * FRAME, 3);
    expect(layout()[2][1]).toBe(8);
    expect(useTrimMonitorStore.getState().lastOffset).toBe(-5);
    expect(trimMonitorOffset(parseTrimOffset("+12")!).success).toBe(true);
    expect(history()).toBe(h + 2);
    expect(layout()[0][2]).toBeCloseTo(4 + 7 * FRAME, 3);
    await useProjectStore.getState().undo();
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);
    await useProjectStore.getState().redo();
    expect(layout()[0][2]).toBeCloseTo(4 - 5 * FRAME, 3);
  });

  it("ripple out trims the outgoing tail and pulls later clips in", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    expect(setTrimMonitorMode("ripple-out").success).toBe(true);
    const before = layout();
    expect(trimMonitorOffset(-3).success).toBe(true);
    const after = layout();
    expect(after[0][2]).toBeCloseTo(4 - 3 * FRAME, 3);
    expect(after[1][1]).toBeCloseTo(4 - 3 * FRAME, 3);
    expect(after[2][1]).toBeCloseTo(8 - 3 * FRAME, 3);
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);
  });

  it("ripple in trims the incoming head: its source in point moves, its start does not", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    expect(setTrimMonitorMode("ripple-in").success).toBe(true);
    const before = layout();
    expect(trimMonitorOffset(4).success).toBe(true);
    const b = layout()[1];
    expect(b[1]).toBeCloseTo(4, 3);
    expect(b[3]).toBeCloseTo(20 + 4 * FRAME, 3);
    expect(b[2]).toBeCloseTo(8 - 4 * FRAME, 3);
    expect(layout()[0][2]).toBeCloseTo(4, 3);
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);
  });

  it("slip moves the source window only; slide moves the clip between its neighbours", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    const before = layout();
    expect(setTrimMonitorMode("slip").success).toBe(true);
    expect(trimMonitorOffset(6).success).toBe(true);
    const slipped = layout();
    expect(slipped[1][1]).toBeCloseTo(4, 3);
    expect(slipped[1][2]).toBeCloseTo(8, 3);
    expect(Math.abs(slipped[1][3] - 20)).toBeCloseTo(6 * FRAME, 3);
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);

    expect(setTrimMonitorMode("slide").success).toBe(true);
    expect(trimMonitorOffset(3).success).toBe(true);
    const slid = layout();
    expect(slid[1][1]).toBeCloseTo(4 + 3 * FRAME, 3);
    expect(slid[1][2] - slid[1][1]).toBeCloseTo(4, 3);
    expect(slid[0][2]).toBeCloseTo(4 + 3 * FRAME, 3);
    expect(slid[2][1]).toBeCloseTo(8 + 3 * FRAME, 3);
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);
  });

  it("rejects fractional or empty offsets without touching the project", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    const h = history();
    expect(parseTrimOffset("1.5")).toBeNull();
    expect(parseTrimOffset("abc")).toBeNull();
    expect(parseTrimOffset("0")).toBeNull();
    expect(parseTrimOffset("−2")).toBe(-2);
    expect(trimMonitorOffset(0).success).toBe(false);
    expect(trimMonitorOffset(1.5).success).toBe(false);
    expect(history()).toBe(h);
  });

  it("slip and slide act on the chosen side of the cut", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    setTrimMonitorMode("slip");
    expect(setTrimMonitorSide("outgoing").success).toBe(true);
    expect(trimMonitorOffset(3).success).toBe(true);
    expect(Math.abs(layout()[0][3] - 10)).toBeCloseTo(3 * FRAME, 3);
    expect(layout()[1][3]).toBeCloseTo(20, 3);
  });

  it("key trims (, . < >) follow the monitor's mode", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    setTrimMonitorMode("slip");
    const { trimSelectedEditPoint } = await import("./edit-point-commands");
    expect(trimSelectedEditPoint(2, false).success).toBe(true);
    expect(layout()[1][1]).toBeCloseTo(4, 3);
    expect(Math.abs(layout()[1][3] - 20)).toBeCloseTo(2 * FRAME, 3);
  });
});

describe("sync lock and locks", () => {
  it("a ripple that would cut unlinked content on a sync-locked track is refused and changes nothing", () => {
    setup({ audio: {} });
    selectEditPoint("b", "left");
    openTrimMonitor();
    setTrimMonitorMode("ripple-out");
    const before = layout();
    const h = history();
    const outcome = trimMonitorOffset(-3);
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/Sync Lock/);
    expect(layout()).toEqual(before);
    expect(history()).toBe(h);
    expect(useTrimMonitorStore.getState().notice).toMatch(/Sync Lock/);
  });

  it("with linked selection the partner clips trim in the same single undo step", async () => {
    setup({ audio: { syncLock: false }, linked: true });
    const state = useProjectStore.getState().project;
    // Link video and audio of the same time span.
    const linkedProject = {
      ...state,
      timeline: {
        ...state.timeline,
        tracks: state.timeline.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({ ...c, linkedClipId: t.id === "main" ? `a${c.id}` : c.id.slice(1) })),
        })),
      },
    };
    useProjectStore.setState({ project: linkedProject });
    selectEditPoint("b", "left");
    openTrimMonitor();
    const h = history();
    const before = layout("a1");
    expect(trimMonitorOffset(5).success).toBe(true);
    expect(history()).toBe(h + 1);
    expect(layout("a1")).not.toEqual(before);
    await useProjectStore.getState().undo();
    expect(layout("a1")).toEqual(before);
  });

  it("a locked track refuses the trim", () => {
    setup();
    useProjectStore.setState((s) => ({
      project: { ...s.project, timeline: { ...s.project.timeline, tracks: s.project.timeline.tracks.map((t) => ({ ...t, locked: true })) } },
    }));
    selectEditPoint("b", "left");
    openTrimMonitor();
    const before = layout();
    expect(trimMonitorOffset(2).success).toBe(false);
    expect(layout()).toEqual(before);
  });
});

describe("JKL dynamic trimming inside the monitor", () => {
  it("L rolls the cut with the playhead and K commits it as one undo step", async () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    const before = layout();
    const h = history();
    expect(dynamicTrimShuttle(1).success).toBe(true);
    advanceDynamicTrim(0.3);
    flushDynamicTrimMonitor();
    expect(layout()).toEqual(before);
    const frames = useEditPointStore.getState().dynamicTrim!.appliedFrames;
    expect(frames).toBeGreaterThan(5);
    expect(commitDynamicTrim()?.success).toBe(true);
    expect(history()).toBe(h + 1);
    expect(layout()[0][2]).toBeCloseTo(4 + frames * FRAME, 3);
    expect(layout()[1][1]).toBeCloseTo(4 + frames * FRAME, 3);
    await useProjectStore.getState().undo();
    expect(layout()).toEqual(before);
  });

  it("J slips the incoming clip when the monitor is in Slip mode", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    setTrimMonitorMode("slip");
    dynamicTrimShuttle(-1);
    advanceDynamicTrim(0.2);
    const frames = useEditPointStore.getState().dynamicTrim!.appliedFrames;
    expect(frames).toBeLessThan(0);
    commitDynamicTrim();
    expect(layout()[1][1]).toBeCloseTo(4, 3);
    expect(Math.abs(layout()[1][3] - 20)).toBeCloseTo(Math.abs(frames) * FRAME, 3);
  });

  it("changing the monitor's mode mid-trim cancels the running trim", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    dynamicTrimShuttle(1);
    advanceDynamicTrim(0.2);
    setTrimMonitorMode("ripple-in");
    expect(useEditPointStore.getState().dynamicTrim).toBeNull();
    expect(layout()[0][2]).toBeCloseTo(4, 3);
  });
});

describe("edit point navigation", () => {
  it("steps through the track's edit points and shows each one", () => {
    setup();
    selectEditPoint("a", "left");
    openTrimMonitor();
    expect(trimMonitorNavigate(1).success).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(4, 4);
    expect(useEditPointStore.getState().selection).toMatchObject({ type: "edit", kind: "roll" });
    expect(useTrimMonitorStore.getState().mode).toBe("roll");
    trimMonitorNavigate(1);
    trimMonitorNavigate(1);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(12, 4);
    // 12 is the end of c next to a gap, a free edge: ripple.
    expect(useTrimMonitorStore.getState().mode).toBe("ripple-out");
    expect(trimMonitorNavigate(-1).success).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(8, 4);
  });

  it("reports the ends of the track", () => {
    setup();
    selectEditPoint("a", "left");
    openTrimMonitor();
    expect(trimMonitorNavigate(-1).success).toBe(false);
    selectEditPoint("d", "right");
    expect(trimMonitorNavigate(1).success).toBe(false);
  });
});

describe("play around edit", () => {
  it("plays from pre-roll to post-roll, loops back at the end and stops on the edit", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    useTrimMonitorStore.getState().setRolls(1, 1);
    expect(playAroundEdit().success).toBe(true);
    const timeline = useTimelineStore.getState();
    expect(timeline.playbackState).toBe("playing");
    expect(timeline.playheadPosition).toBeCloseTo(3, 4);
    expect(useTrimMonitorStore.getState().playingAround).toBe(true);
    useTimelineStore.setState({ playheadPosition: 4.5 });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(4.5, 4);
    useTimelineStore.setState({ playheadPosition: 5.01 });
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(3, 4);
    expect(useTimelineStore.getState().playbackState).toBe("playing");
    stopPlayAround();
    expect(useTimelineStore.getState().playbackState).toBe("paused");
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(4, 4);
    expect(useTrimMonitorStore.getState().playingAround).toBe(false);
  });

  it("ends when something else pauses playback, and does not change the project", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    const before = layout();
    playAroundEdit();
    useTimelineStore.getState().pause();
    expect(useTrimMonitorStore.getState().playingAround).toBe(false);
    expect(layout()).toEqual(before);
    expect(ORIGINAL()).toEqual(before);
  });

  it("closing the monitor stops the loop", () => {
    setup();
    selectEditPoint("b", "left");
    openTrimMonitor();
    playAroundEdit();
    closeTrimMonitor();
    expect(useTrimMonitorStore.getState()).toMatchObject({ open: false, playingAround: false });
    expect(useTimelineStore.getState().playbackState).toBe("paused");
  });
});
