import "../test/install-local-storage-mock";
import { ActionExecutor, type Clip, type Project } from "@openreel/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useSourceMonitorStore, pushSourceHistory } from "../stores/source-monitor-store";
import { useEngineStore } from "../stores/engine-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import {
  addEditToAllTracks,
  extractRange,
  insertSelectedMedia,
  liftRange,
  matchFrame,
  overwriteSelectedMedia,
  reverseMatchFrame,
} from "./premiere-edit-commands";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchor: { x: 0.5, y: 0.5 },
};
const clip = (id: string, trackId: string, startTime: number, duration: number, inPoint = 0): Clip => ({
  id, trackId, mediaId: "source", startTime, duration, inPoint, outPoint: inPoint + duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform,
});

function fixture(): Project {
  const project = createEmptyProject("Premiere edits");
  const track = (id: string, type: "video" | "audio", clips: Clip[]) => ({
    id, name: id, type, locked: false, hidden: false, solo: false, muted: false,
    transitions: [], clips,
  });
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [{
        id: "source", name: "Source.mp4", type: "video" as const, fileHandle: null, blob: null,
        thumbnailUrl: null, waveformData: new Float32Array(10),
        metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 },
      }],
    },
    timeline: {
      ...project.timeline,
      duration: 8,
      tracks: [
        {
          ...track("v1", "video", [clip("a", "v1", 0, 4), clip("b", "v1", 4, 4, 10)]),
          transitions: [{ id: "t", clipAId: "a", clipBId: "b", type: "crossfade", duration: 0.5, params: {} }],
        },
      ],
    },
  } as Project;
}
const spans = () =>
  [...useProjectStore.getState().project.timeline.tracks[0].clips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [c.startTime, c.startTime + c.duration]);
const history = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();

beforeEach(() => {
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project: fixture(), hasOpenProject: true, actionExecutor: executor,
    actionHistory: executor.getHistory(), clipUndoStack: [], clipRedoStack: [],
    templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused", playheadPosition: 0, loopStart: 0, loopEnd: 0 });
  useUIStore.setState({ selectedItems: [], exportState: { ...useUIStore.getState().exportState, isExporting: false } });
});

describe("premiere edit commands", () => {
  it("lift and extract use the existing timeline range, remove selection and undo in one step", async () => {
    useTimelineStore.getState().setLoopRange(2, 6);
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "a", trackId: "v1" }] });
    expect(liftRange().success).toBe(true);
    expect(history()).toBe(1);
    expect(spans()).toEqual([[0, 2], [6, 8]]);
    expect(useProjectStore.getState().project.timeline.tracks[0].transitions).toHaveLength(0);
    // "a" survives as the left fragment, so it stays selected.
    await useProjectStore.getState().undo();
    expect(history()).toBe(0);
    expect(spans()).toEqual([[0, 4], [4, 8]]);
    expect(useProjectStore.getState().project.timeline.tracks[0].transitions).toHaveLength(1);
    expect(extractRange().success).toBe(true);
    expect(spans()).toEqual([[0, 2], [2, 4]]);
    expect(useTimelineStore.getState().loopEnd).toBe(0);
  });

  it("deselects clips an extract removed", () => {
    useTimelineStore.getState().setLoopRange(4, 8);
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "b", trackId: "v1" }] });
    expect(extractRange().success).toBe(true);
    expect(useUIStore.getState().selectedItems).toEqual([]);
  });

  it("refuses lift without a marked range", () => {
    const outcome = liftRange();
    expect(outcome.success).toBe(false);
    expect(history()).toBe(0);
  });

  it("insert and overwrite place the selected library media at the playhead", async () => {
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "source" }] });
    useTimelineStore.setState({ playheadPosition: 4 });
    expect(insertSelectedMedia().success).toBe(true);
    expect(history()).toBe(1);
    expect(spans()[1][0]).toBe(4);
    expect(spans()[1][1]).toBe(24);
    expect(useTimelineStore.getState().playheadPosition).toBe(24);
    await useProjectStore.getState().undo();
    expect(spans()).toEqual([[0, 4], [4, 8]]);
    useTimelineStore.setState({ playheadPosition: 2 });
    expect(overwriteSelectedMedia().success).toBe(true);
    expect(history()).toBe(1);
    expect(spans()[0]).toEqual([0, 2]);
  });

  it("insert without a library selection fails without editing", () => {
    expect(insertSelectedMedia().success).toBe(false);
    expect(history()).toBe(0);
  });

  it("add edit to all tracks is one undo step", async () => {
    useTimelineStore.setState({ playheadPosition: 2 });
    expect(addEditToAllTracks().success).toBe(true);
    expect(history()).toBe(1);
    expect(spans()).toEqual([[0, 2], [2, 4], [4, 8]]);
    await useProjectStore.getState().undo();
    expect(spans()).toEqual([[0, 4], [4, 8]]);
    useTimelineStore.setState({ playheadPosition: 4 });
    expect(addEditToAllTracks().success).toBe(false);
  });

  it("match frame selects the source media and reports source timecode", () => {
    useTimelineStore.setState({ playheadPosition: 5 });
    const outcome = matchFrame();
    expect(outcome.success).toBe(true);
    expect(outcome.message).toContain("Source.mp4");
    expect(outcome.message).toContain("00:00:11:00");
    expect(useUIStore.getState().selectedItems.map((i) => i.id)).toEqual(["source"]);
  });

  it("reverse match frame moves the playhead to the topmost instance, or reports not found", () => {
    const project = useProjectStore.getState().project;
    const sm = useSourceMonitorStore.getState();
    useSourceMonitorStore.setState({ mediaId: null, history: [] });
    expect(reverseMatchFrame().success).toBe(false);
    sm.open("source", project.id, 12);
    const found = reverseMatchFrame();
    expect(found.success).toBe(true);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(6, 2);
    sm.open("source", project.id, 18);
    const missing = reverseMatchFrame();
    expect(missing.success).toBe(false);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(6, 2);
  });

  it("reverse match frame cycles through every instance on repeated presses", () => {
    const project = useProjectStore.getState().project;
    const extra = { id: "v2", name: "v2", type: "video" as const, locked: false, hidden: false, solo: false, muted: false, transitions: [], clips: [clip("c", "v2", 20, 4)] };
    useProjectStore.setState({
      project: { ...project, timeline: { ...project.timeline, tracks: [extra, ...project.timeline.tracks] } } as Project,
    });
    useSourceMonitorStore.getState().open("source", project.id, 2);
    const order: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const outcome = reverseMatchFrame();
      expect(outcome.success).toBe(true);
      if (i === 0) expect(outcome.message).toContain("instance 1 of 2");
      order.push(useUIStore.getState().selectedItems[0].id);
    }
    // Topmost track first (c at 22s), then a (2s), then it wraps.
    expect(order).toEqual(["c", "a", "c"]);
    expect(useTimelineStore.getState().playheadPosition).toBeCloseTo(22, 2);
  });

  it("source history is most-recent-first, de-duplicated and capped", () => {
    expect(pushSourceHistory(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushSourceHistory(Array.from({ length: 10 }, (_, i) => `m${i}`), "n")).toHaveLength(10);
    const project = useProjectStore.getState().project;
    useSourceMonitorStore.setState({ history: [], projectId: project.id });
    useSourceMonitorStore.getState().open("x", project.id);
    useSourceMonitorStore.getState().open("source", project.id);
    expect(useSourceMonitorStore.getState().history).toEqual(["source", "x"]);
  });

  it("match frame on a specific clip uses that clip, not the topmost one", () => {
    const project = useProjectStore.getState().project;
    const first = project.timeline.tracks.flatMap((t) => t.clips)[0];
    useTimelineStore.setState({ playheadPosition: first.startTime + 1 });
    const outcome = matchFrame(first.id);
    expect(outcome.success).toBe(true);
    expect(outcome.message).toContain("Source.mp4");
    expect(matchFrame("missing").success).toBe(false);
  });

  describe("track targeting, range undo and sequence data", () => {
    const emptyTrack = (id: string, type: "video" | "audio", name: string, locked = false) => ({
      id, name, type, locked, hidden: false, solo: false, muted: false, transitions: [], clips: [] as Clip[],
    });
    const useLayout = (tracks: ReturnType<typeof emptyTrack>[]) => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: { ...project, timeline: { ...project.timeline, tracks } } as Project,
      });
      useUIStore.setState({ selectedItems: [{ type: "clip", id: "source" }] });
      useEditorWorkspaceStore.setState({ targetTracks: {} });
    };
    const placedOn = () =>
      useProjectStore.getState().project.timeline.tracks.filter((t) => t.clips.length).map((t) => t.id);

    it("insert goes to the main track, not the first track in the list", () => {
      useLayout([emptyTrack("broll", "video", "B-roll"), emptyTrack("main", "video", "Main"), emptyTrack("dlg", "audio", "Dialogue")]);
      expect(insertSelectedMedia().success).toBe(true);
      expect(placedOn()).toEqual(["main"]);
    });

    it("insert uses the selected track when it matches, and the patched target over it", () => {
      useLayout([emptyTrack("broll", "video", "B-roll"), emptyTrack("main", "video", "Main")]);
      useUIStore.setState({ selectedItems: [{ type: "track", id: "broll" }] });
      // The media library item is also selected last, but the track stays primary.
      expect(insertSelectedMedia().success).toBe(false);
      useUIStore.setState({ selectedItems: [{ type: "track", id: "broll" }, { type: "clip", id: "source" }] });
      expect(insertSelectedMedia().success).toBe(true);
      expect(placedOn()).toEqual(["broll"]);
    });

    it("an explicit target wins, and a locked target falls back to main", async () => {
      useLayout([emptyTrack("broll", "video", "B-roll"), emptyTrack("main", "video", "Main")]);
      useEditorWorkspaceStore.getState().setTargetTrack("video", "broll");
      expect(overwriteSelectedMedia().success).toBe(true);
      expect(placedOn()).toEqual(["broll"]);
      await useProjectStore.getState().undo();
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: { ...project, timeline: { ...project.timeline, tracks: project.timeline.tracks.map((t) => t.id === "broll" ? { ...t, locked: true } : t) } },
      });
      expect(overwriteSelectedMedia().success).toBe(true);
      expect(placedOn()).toEqual(["main"]);
    });

    it("creates a track when none is suitable, as one undo step", async () => {
      useLayout([emptyTrack("dlg", "audio", "Dialogue")]);
      expect(insertSelectedMedia().success).toBe(true);
      const tracks = useProjectStore.getState().project.timeline.tracks;
      expect(tracks).toHaveLength(2);
      expect(tracks[0].type).toBe("video");
      expect(tracks[0].clips).toHaveLength(1);
      expect(history()).toBe(1);
      await useProjectStore.getState().undo();
      expect(useProjectStore.getState().project.timeline.tracks.map((t) => t.id)).toEqual(["dlg"]);
      await useProjectStore.getState().redo();
      expect(useProjectStore.getState().project.timeline.tracks).toHaveLength(2);
    });

    it("places a video with audio as a single clip, matching normal import", () => {
      useLayout([emptyTrack("main", "video", "Main"), emptyTrack("dlg", "audio", "Dialogue")]);
      expect(insertSelectedMedia().success).toBe(true);
      const tracks = useProjectStore.getState().project.timeline.tracks;
      expect(tracks.flatMap((t) => t.clips)).toHaveLength(1);
      expect(tracks[1].clips).toHaveLength(0);
    });

    it("extract undo restores the In/Out range, and redo clears it again", async () => {
      useTimelineStore.getState().setLoopRange(2, 6);
      useTimelineStore.setState({ loopEnabled: true });
      expect(extractRange().success).toBe(true);
      expect(useTimelineStore.getState().loopEnd).toBe(0);
      await useProjectStore.getState().undo();
      const restored = useTimelineStore.getState();
      expect([restored.loopStart, restored.loopEnd, restored.loopEnabled]).toEqual([2, 6, true]);
      await useProjectStore.getState().redo();
      expect(useTimelineStore.getState().loopEnd).toBe(0);
      expect(spans()).toEqual([[0, 2], [2, 4]]);
    });

    it("extract range still restores after more than 200 later history entries", async () => {
      const store = useProjectStore.getState();
      store.actionExecutor.getHistory().setAutoGroupWindow(0);
      useTimelineStore.getState().setLoopRange(2, 6);
      useTimelineStore.setState({ loopEnabled: true });
      expect(extractRange().success).toBe(true);
      const afterExtract = history();
      const LATER = 230;
      for (let i = 0; i < LATER; i++) {
        const result = await useProjectStore.getState().executeAction({
          type: "clip/setVolume", id: `vol-${i}`, timestamp: Date.now(), params: { clipId: "a", volume: 0.1 + (i % 7) / 10 },
        } as never);
        expect(result.success).toBe(true);
      }
      expect(history()).toBe(afterExtract + LATER);
      for (let i = 0; i < LATER; i++) await useProjectStore.getState().undo();
      expect(history()).toBe(afterExtract);
      // The range now rides inside the action itself, not a capped side map.
      await useProjectStore.getState().undo();
      const restored = useTimelineStore.getState();
      expect([restored.loopStart, restored.loopEnd, restored.loopEnabled]).toEqual([2, 6, true]);
      await useProjectStore.getState().redo();
      expect(useTimelineStore.getState().loopEnd).toBe(0);
    });

    it("extract shifts markers and captions with the ripple in the same undo step", async () => {
      const project = useProjectStore.getState().project;
      useProjectStore.setState({
        project: {
          ...project,
          timeline: {
            ...project.timeline,
            markers: [{ id: "m", time: 7, label: "", color: "red" }],
            subtitles: [{ id: "s", text: "hi", startTime: 6, endTime: 7 }],
          },
        } as Project,
      });
      useTimelineStore.getState().setLoopRange(2, 4);
      expect(extractRange().success).toBe(true);
      let timeline = useProjectStore.getState().project.timeline;
      expect(timeline.markers[0].time).toBe(5);
      expect([timeline.subtitles[0].startTime, timeline.subtitles[0].endTime]).toEqual([4, 5]);
      expect(history()).toBe(1);
      await useProjectStore.getState().undo();
      timeline = useProjectStore.getState().project.timeline;
      expect(timeline.markers[0].time).toBe(7);
      expect([timeline.subtitles[0].startTime, timeline.subtitles[0].endTime]).toEqual([6, 7]);
    });
  });
});
