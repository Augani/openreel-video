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
import { insertFromSource, overwriteFromSource } from "./source-monitor-commands";
import { setMediaChannelLayout } from "./audio-channels";

const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } };
const clip = (id: string, trackId: string, startTime: number, duration: number): Clip => ({
  id, trackId, mediaId: "other", startTime, duration, inPoint: 0, outPoint: duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform,
});
const track = (id: string, type: "video" | "audio", clips: Clip[], extra: object = {}) => ({
  id, name: id.toUpperCase(), type, locked: false, hidden: false, solo: false, muted: false, transitions: [], clips, ...extra,
});
const item = (id: string, name: string, type: "audio" | "video", metadata: object) => ({
  id, name, type, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: new Float32Array(10),
  metadata: { duration: 20, width: type === "video" ? 1920 : 0, height: type === "video" ? 1080 : 0, frameRate: type === "video" ? 30 : 0, codec: "x", sampleRate: 48000, fileSize: 1, hasAudio: true, ...metadata },
});

function fixture(): Project {
  const project = createEmptyProject("Multichannel");
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [
        item("poly", "poly8.wav", "audio", { channels: 8 }),
        item("mov", "two-stereo.mov", "video", { channels: 2, audioTrackCount: 2 }),
        item("stereo", "plain.wav", "audio", { channels: 2 }),
        item("other", "other.wav", "audio", { channels: 2 }),
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 10,
      tracks: [
        track("v1", "video", []),
        track("a1", "audio", [clip("a-old", "a1", 0, 10)]),
        track("a2", "audio", []),
        track("a3", "audio", []),
        track("a4", "audio", [], { locked: true }),
        track("a5", "audio", []),
        track("a6", "audio", []),
        track("follower", "audio", [clip("f-old", "follower", 4, 4)], { syncLock: true }),
        track("free", "audio", [clip("x-old", "free", 4, 4)], { syncLock: false }),
      ],
    },
  } as unknown as Project;
}

const tracksOf = () => useProjectStore.getState().project.timeline.tracks;
const clipsOn = (id: string) => tracksOf().find((t) => t.id === id)!.clips;
const undoSteps = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();

function open(project: Project) {
  const executor = new ActionExecutor();
  useEngineStore.setState({ titleEngine: null, graphicsEngine: null });
  useProjectStore.setState({
    project, hasOpenProject: true, actionExecutor: executor, actionHistory: executor.getHistory(),
    clipUndoStack: [], clipRedoStack: [], templateUndoStack: [], templateRedoStack: [], redoJournal: [],
  });
}

beforeEach(() => {
  open(fixture());
  useTimelineStore.setState({ playbackLockedReason: null, playbackState: "paused", playheadPosition: 2, loopStart: 0, loopEnd: 0 });
  useUIStore.setState({ selectedItems: [], exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  useEditorWorkspaceStore.setState({ targetedTrackIds: [], targetTracks: {}, channelPatches: {}, disabledChannels: [] });
  useSourceMonitorStore.setState({ projectId: "x", marks: {}, mediaId: null, tab: "source", focus: "source" });
});

const openSource = (mediaId: string, marks?: { in: number; out: number }) => {
  const project = useProjectStore.getState().project;
  useSourceMonitorStore.setState({ projectId: project.id, mediaId, marks: marks ? { [mediaId]: marks } : {} } as never);
};

describe("multichannel source patching in the Source monitor", () => {
  it("an 8-mono WAV inserts one mono clip per enabled channel on cascading tracks, skipping a locked track, in one undo step", async () => {
    openSource("poly", { in: 1, out: 4 });
    for (const ch of [4, 5, 6, 7]) useEditorWorkspaceStore.getState().setChannelEnabled(ch, false);
    const before = undoSteps();
    const outcome = insertFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    // Four enabled channels cascade a1, a2, a3, (a4 is locked) a5.
    const placed = tracksOf().flatMap((t) => t.clips.filter((c) => c.mediaId === "poly").map((c) => ({ track: t.id, ch: c.channelMap?.sources[0], start: c.startTime, dur: c.duration })));
    expect(placed.map((p) => [p.track, p.ch]).sort()).toEqual([["a1", 0], ["a2", 1], ["a3", 2], ["a5", 3]]);
    for (const p of placed) expect([p.start, p.dur]).toEqual([2, 3]);
    // Sync lock: the follower track rippled by 3; the Sync Lock-off track did not.
    expect(clipsOn("follower")[0].startTime).toBe(7);
    expect(clipsOn("free")[0].startTime).toBe(4);
    // Linked: one anchor, the rest point at it.
    const clips = tracksOf().flatMap((t) => t.clips).filter((c) => c.mediaId === "poly");
    const anchors = clips.filter((c) => c.metadata?.separatedFromClipId === undefined);
    expect(anchors).toHaveLength(1);
    expect(clips.filter((c) => c.metadata?.separatedFromClipId === anchors[0].id)).toHaveLength(3);
    await useProjectStore.getState().undo();
    expect(tracksOf().flatMap((t) => t.clips).some((c) => c.mediaId === "poly")).toBe(false);
    expect(clipsOn("follower")[0].startTime).toBe(4);
  });

  it("with more channels than free audio tracks the extra channels get new tracks, undone with the edit", async () => {
    openSource("poly", { in: 0, out: 2 });
    const original = fixture().timeline.tracks.length;
    expect(insertFromSource().success).toBe(true);
    const placed = tracksOf().flatMap((t) => t.clips.filter((c) => c.mediaId === "poly").map((c) => ({ track: t.id, ch: c.channelMap?.sources[0] })));
    expect(placed.map((p) => p.ch).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(placed.map((p) => p.track)).size).toBe(8);
    expect(placed.some((p) => p.track === "a4")).toBe(false);
    expect(tracksOf().length).toBe(original + 1);
    await useProjectStore.getState().undo();
    expect(tracksOf().length).toBe(original);
  });

  it("honours per-channel patches and switched-off channels", () => {
    openSource("poly", { in: 0, out: 2 });
    const ws = useEditorWorkspaceStore.getState();
    ws.setChannelPatch(0, "a6");
    ws.setChannelPatch(1, "a2");
    ws.setChannelPatch(2, "a3");
    for (const ch of [3, 4, 5, 6, 7]) ws.setChannelEnabled(ch, false);
    const outcome = overwriteFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    expect(clipsOn("a6").map((c) => c.channelMap?.sources[0])).toEqual([0]);
    expect(clipsOn("a2").map((c) => c.channelMap?.sources[0])).toEqual([1]);
    expect(clipsOn("a3").map((c) => c.channelMap?.sources[0])).toEqual([2]);
    expect(tracksOf().flatMap((t) => t.clips).filter((c) => c.mediaId === "poly")).toHaveLength(3);
  });

  it("a track serves one channel: patching it again moves the patch", () => {
    const ws = useEditorWorkspaceStore.getState();
    ws.setChannelPatch(1, "a2");
    ws.setChannelPatch(2, "a2");
    expect(useEditorWorkspaceStore.getState().channelPatches).toEqual({ 2: "a2" });
    ws.setChannelPatch(0, "a2");
    expect(useEditorWorkspaceStore.getState().channelPatches).toEqual({});
    expect(useEditorWorkspaceStore.getState().targetTracks.audio).toBe("a2");
  });

  it("refuses when every channel is switched off", () => {
    openSource("poly");
    for (let ch = 0; ch < 8; ch++) useEditorWorkspaceStore.getState().setChannelEnabled(ch, false);
    const outcome = insertFromSource();
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/switched off/);
  });

  it("a MOV with two stereo tracks inserts the picture plus one sound clip per stream, linked to the picture", () => {
    openSource("mov", { in: 0, out: 5 });
    const outcome = insertFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    const pic = clipsOn("v1")[0];
    expect(pic.volume).toBe(0);
    const sounds = tracksOf().flatMap((t) => t.clips).filter((c) => c.mediaId === "mov" && c.id !== pic.id);
    expect(sounds.map((c) => c.audioTrackIndex ?? 0).sort()).toEqual([0, 1]);
    for (const s of sounds) expect(s.metadata?.separatedFromClipId).toBe(pic.id);
  });

  it("a plain stereo source still places one clip (no multichannel path)", () => {
    openSource("stereo", { in: 0, out: 3 });
    const outcome = insertFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    const placed = tracksOf().flatMap((t) => t.clips).filter((c) => c.mediaId === "stereo");
    expect(placed).toHaveLength(1);
    expect(placed[0].channelMap).toBeUndefined();
  });

  it("Modify > Audio Channels presets reshape what Insert places, for many items in one undo step", async () => {
    const before = undoSteps();
    const result = await setMediaChannelLayout(["poly", "mov"], "mono");
    expect(result.success).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    openSource("poly", { in: 0, out: 1 });
    expect(insertFromSource().success).toBe(true);
    expect(tracksOf().flatMap((t) => t.clips).filter((c) => c.mediaId === "poly")).toHaveLength(8);
    const stereoPairs = await setMediaChannelLayout(["poly"], "stereo");
    expect(stereoPairs.success).toBe(true);
    const item = useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === "poly")!;
    expect(item.channelLayout).toHaveLength(4);
    await useProjectStore.getState().undo();
    // All-mono is the file's own grouping for an 8-channel file, so it was stored as "use file".
    expect(useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === "poly")!.channelLayout).toBeUndefined();
    expect(useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === "mov")!.channelLayout).toHaveLength(4);
    // "Use file" clears the stored layout for an item whose layout is the file's own.
    expect((await setMediaChannelLayout(["stereo"], "file")).success).toBe(true);
    expect(useProjectStore.getState().project.mediaLibrary.items.find((i) => i.id === "stereo")!.channelLayout).toBeUndefined();
  });
});
