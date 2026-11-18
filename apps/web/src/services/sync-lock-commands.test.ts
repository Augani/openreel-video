import "../test/install-local-storage-mock";
import { ActionExecutor, type Clip, type Project } from "@openreel/core";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useEngineStore } from "../stores/engine-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { useEditorWorkspaceStore } from "../stores/editor-workspace-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { extractRange, addEditToTargetedTracks } from "./premiere-edit-commands";
import { insertFromSource } from "./source-monitor-commands";
import { toggleSyncLockOnSelectedTrack, toggleTargetOnSelectedTrack } from "./track-targeting-commands";

const transform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  opacity: 1,
  anchor: { x: 0.5, y: 0.5 },
};
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, trackId, mediaId: "source", startTime, duration, inPoint: 0, outPoint: duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform,
});
const track = (id: string, type: "video" | "audio", clips: Clip[]) => ({
  id, name: id.toUpperCase(), type, locked: false, hidden: false, solo: false, muted: false,
  transitions: [], clips,
});

function fixture(musicStart = 6): Project {
  const project = createEmptyProject("Sync lock");
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [{
        id: "source", name: "Source.mp4", type: "video" as const, fileHandle: null, blob: null,
        thumbnailUrl: null, waveformData: new Float32Array(10),
        metadata: { duration: 20, width: 1920, height: 1080, frameRate: 30, codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1, hasAudio: true },
      }],
    },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        track("v2", "video", []),
        track("v1", "video", [clip("v-a", "v1", 0, 5), clip("v-b", "v1", 5, 5)]),
        track("a1", "audio", [clip("a-a", "a1", 0, 5), clip("a-b", "a1", 5, 5)]),
        track("a2", "audio", [clip("m-1", "a2", musicStart, 10 - musicStart)]),
      ],
    },
  } as Project;
}
const spansOf = (id: string) =>
  [...useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips]
    .sort((a, b) => a.startTime - b.startTime)
    .map((c) => [c.startTime, c.startTime + c.duration]);
const history = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();

function open(project: Project) {
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project, hasOpenProject: true, actionExecutor: executor,
    actionHistory: executor.getHistory(), clipUndoStack: [], clipRedoStack: [],
    templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
}

beforeEach(() => {
  open(fixture());
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused", playheadPosition: 0, loopStart: 0, loopEnd: 0 });
  useUIStore.setState({ selectedItems: [], exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useEditorWorkspaceStore.setState({ targetedTrackIds: [], targetTracks: {} });
  useSourceMonitorStore.setState({ projectId: null, marks: {}, mediaId: null, tab: "program", focus: "program" });
});

describe("sync lock in the editor", () => {
  it("ripple delete of a linked A/V pair is one undo step and shifts the music track", async () => {
    const result = await useProjectStore.getState().rippleDeleteClips(["v-a", "a-a"]);
    expect(result.success).toBe(true);
    expect(history()).toBe(1);
    expect(spansOf("v1")).toEqual([[0, 5]]);
    expect(spansOf("a1")).toEqual([[0, 5]]);
    expect(spansOf("a2")).toEqual([[1, 5]]);
    await useProjectStore.getState().undo();
    expect(history()).toBe(0);
    expect(spansOf("a2")).toEqual([[6, 10]]);
    expect(spansOf("v1")).toEqual([[0, 5], [5, 10]]);
  });

  it("is blocked with a message naming the track, and Sync Lock off on that track lets it through", async () => {
    open(fixture(2));
    const blocked = await useProjectStore.getState().rippleDeleteClips(["v-a", "a-a"]);
    expect(blocked.success).toBe(false);
    expect(blocked.error?.message).toContain('"A2"');
    expect(history()).toBe(0);
    expect((await useProjectStore.getState().setTrackSyncLock("a2", false)).success).toBe(true);
    expect(history()).toBe(1);
    expect((await useProjectStore.getState().rippleDeleteClips(["v-a", "a-a"])).success).toBe(true);
    expect(history()).toBe(2);
    expect(spansOf("a2")).toEqual([[2, 10]]);
    await useProjectStore.getState().undo();
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.timeline.tracks.find((t) => t.id === "a2")!.syncLock).not.toBe(false);
  });

  it("extract on the targeted tracks ripples the other sync-locked tracks, or is blocked", () => {
    useEditorWorkspaceStore.getState().setTrackTargeted("v1", true);
    useEditorWorkspaceStore.getState().setTrackTargeted("a1", true);
    useTimelineStore.getState().setLoopRange(1, 3);
    const outcome = extractRange();
    expect(outcome.success, outcome.message).toBe(true);
    expect(spansOf("a2")).toEqual([[4, 8]]);
    expect(spansOf("a1")).toEqual([[0, 1], [1, 3], [3, 8]]);
  });

  it("extract reports the blocking track in its message", () => {
    open(fixture(2));
    useEditorWorkspaceStore.getState().setTrackTargeted("v1", true);
    useEditorWorkspaceStore.getState().setTrackTargeted("a1", true);
    useTimelineStore.getState().setLoopRange(1, 3);
    const outcome = extractRange();
    expect(outcome.success).toBe(false);
    expect(outcome.message).toContain('"A2"');
    expect(history()).toBe(0);
  });

  it("add edit cuts only the targeted tracks", () => {
    useEditorWorkspaceStore.getState().setTrackTargeted("a1", true);
    useTimelineStore.setState({ playheadPosition: 2 });
    expect(addEditToTargetedTracks().success).toBe(true);
    expect(spansOf("a1")).toEqual([[0, 2], [2, 5], [5, 10]]);
    expect(spansOf("v1")).toEqual([[0, 5], [5, 10]]);
  });

  it("source patch sends video to V2 and audio to A2 as two linked clips in one undo step", () => {
    const workspace = useEditorWorkspaceStore.getState();
    workspace.setSourcePatch("video", "v2");
    workspace.setSourcePatch("audio", "a2");
    useSourceMonitorStore.getState().open("source", useProjectStore.getState().project.id);
    useSourceMonitorStore.getState().setMark("source", "in", 1);
    useSourceMonitorStore.getState().setMark("source", "out", 4);
    useTimelineStore.setState({ playheadPosition: 2 });
    const outcome = insertFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    expect(outcome.trackId).toBe("v2");
    expect(outcome.audioTrackId).toBe("a2");
    expect(history()).toBe(1);
    expect(spansOf("v2")).toEqual([[2, 5]]);
    expect(spansOf("a2").some(([s, e]) => s === 2 && e === 5)).toBe(true);
    // V1/A1 split at the insert point and rippled by 3s.
    expect(spansOf("v1")).toEqual([[0, 2], [5, 8], [8, 13]]);
    const sound = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === "a2")!.clips.find((c) => c.startTime === 2)!;
    expect(sound.metadata?.separatedFromClipId).toBe(outcome.clipId);
  });

  it("keyboard commands toggle the target and Sync Lock of the selected track", async () => {
    expect(toggleTargetOnSelectedTrack().success).toBe(false);
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "m-1", trackId: "a2" }] });
    expect(toggleTargetOnSelectedTrack().success).toBe(true);
    expect(useEditorWorkspaceStore.getState().targetedTrackIds).toEqual(["a2"]);
    expect(toggleTargetOnSelectedTrack().success).toBe(true);
    expect(useEditorWorkspaceStore.getState().targetedTrackIds).toEqual([]);
    expect((await toggleSyncLockOnSelectedTrack()).success).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks.find((t) => t.id === "a2")!.syncLock).toBe(false);
    expect(history()).toBe(1);
  });
});
