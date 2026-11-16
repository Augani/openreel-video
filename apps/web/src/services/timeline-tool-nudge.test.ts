import { ActionExecutor, type Clip } from "@openreel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { endNudgeBurst, nudgeSelectedToolEdit, NUDGE_BURST_MS } from "./timeline-tool-nudge";

const makeClip = (id: string, startTime: number, inPoint: number, outPoint: number): Clip => ({
  id,
  trackId: "main",
  mediaId: "source",
  startTime,
  duration: outPoint - inPoint,
  inPoint,
  outPoint,
  speed: 1,
  volume: 1,
  effects: [],
  audioEffects: [],
  keyframes: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
  },
});
function setup(tool: string) {
  const project = createEmptyProject("Nudge");
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
            metadata: { duration: 40, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
          },
        ],
      },
      timeline: {
        ...project.timeline,
        duration: 12,
        tracks: [
          {
            id: "main",
            name: "Main",
            type: "video" as const,
            locked: false,
            hidden: false,
            solo: false,
            muted: false,
            transitions: [],
            clips: [makeClip("a", 0, 5, 9), makeClip("b", 4, 10, 14), makeClip("c", 8, 20, 24)],
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
  useEditorWorkspaceStore.setState({
    timelineTool: tool as never,
    linkedSelection: false,
  });
  useUIStore.setState({ selectedItems: [{ type: "clip", id: "b", trackId: "main" }] });
  useTimelineStore.setState({ playbackLockedReason: null, playheadPosition: 0 });
}
const clipB = () => useProjectStore.getState().project.timeline.tracks[0].clips.find((c) => c.id === "b")!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  endNudgeBurst();
  vi.useRealTimers();
});

describe("nudgeSelectedToolEdit", () => {
  it("moves the slide by one frame, or five with the large step", () => {
    setup("slide");
    expect(nudgeSelectedToolEdit(1, false).success).toBe(true);
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30, 6);
    expect(nudgeSelectedToolEdit(-1, true).success).toBe(true);
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30 - 5 / 30, 6);
  });

  it("keeps a burst of nudges in one history group and undoes it in one step", async () => {
    setup("slide");
    nudgeSelectedToolEdit(1, false);
    nudgeSelectedToolEdit(1, false);
    nudgeSelectedToolEdit(1, true);
    const history = useProjectStore.getState().actionExecutor.getHistory();
    expect(history.getUndoStackSize()).toBe(3);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    expect(history.getCurrentGroupId()).toBeNull();
    await useProjectStore.getState().undo();
    expect(clipB().startTime).toBe(4);
    expect(history.getUndoStackSize()).toBe(0);
  });

  it("starts a new undo step after the burst ends", async () => {
    setup("slide");
    nudgeSelectedToolEdit(1, false);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    nudgeSelectedToolEdit(1, false);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    await useProjectStore.getState().undo();
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30, 6);
  });

  it("explains itself when the tool or selection cannot nudge", () => {
    setup("select");
    expect(nudgeSelectedToolEdit(1, false)).toMatchObject({ success: false, message: expect.stringMatching(/Choose the/) });
    setup("roll");
    useUIStore.setState({ selectedItems: [] });
    expect(nudgeSelectedToolEdit(1, false)).toMatchObject({ success: false, message: expect.stringMatching(/Select a clip/) });
  });

  it("rolls the edit nearest the playhead", () => {
    setup("roll");
    useTimelineStore.setState({ playheadPosition: 4.1 });
    nudgeSelectedToolEdit(1, false);
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30, 6);
    expect(clipB().duration).toBeCloseTo(4 - 1 / 30, 6);
  });
});

describe("nudge burst vs undo/redo (review)", () => {
  it("undo during an open burst reverts every nudge and a later nudge is its own step", async () => {
    setup("slide");
    nudgeSelectedToolEdit(1, false);
    nudgeSelectedToolEdit(1, false);
    await useProjectStore.getState().undo();
    expect(clipB().startTime).toBe(4);
    nudgeSelectedToolEdit(1, false);
    vi.advanceTimersByTime(NUDGE_BURST_MS + 1);
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30, 6);
    await useProjectStore.getState().undo();
    expect(clipB().startTime).toBe(4);
    await useProjectStore.getState().redo();
    expect(clipB().startTime).toBeCloseTo(4 + 1 / 30, 6);
  });

  it("does not nudge a locked track", () => {
    setup("slide");
    const p = useProjectStore.getState().project;
    useProjectStore.setState({
      project: { ...p, timeline: { ...p.timeline, tracks: [{ ...p.timeline.tracks[0], locked: true }] } },
    });
    expect(nudgeSelectedToolEdit(1, false).success).toBe(false);
    expect(clipB().startTime).toBe(4);
  });
});
