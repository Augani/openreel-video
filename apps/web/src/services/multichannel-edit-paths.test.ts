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
import { dropSourceRange, fitToFillFromSource, replaceFromSource } from "./source-monitor-commands";
import { insertSelectedMedia, overwriteSelectedMedia } from "./premiere-edit-commands";

/**
 * Every edit path honours multichannel source patching, not only Insert / Overwrite from the Source monitor: a drag from the
 * Source monitor, Fit to Fill, Replace, Insert / Overwrite from the Project panel and Add to timeline (placeMediaClip, which the
 * Project panel drops and Add to timeline use).
 */
const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: 0.5, y: 0.5 } };
const clip = (id: string, trackId: string, startTime: number, duration: number, mediaId = "other", extra: Partial<Clip> = {}): Clip => ({
  id, trackId, mediaId, startTime, duration, inPoint: 0, outPoint: duration,
  volume: 1, effects: [], audioEffects: [], keyframes: [], transform, ...extra,
});
const track = (id: string, type: "video" | "audio", clips: Clip[], extra: object = {}) => ({
  id, name: id.toUpperCase(), type, locked: false, hidden: false, solo: false, muted: false, transitions: [], clips, ...extra,
});
const item = (id: string, name: string, type: "audio" | "video", metadata: object) => ({
  id, name, type, fileHandle: null, blob: null, thumbnailUrl: null, waveformData: new Float32Array(10),
  metadata: { duration: 20, width: type === "video" ? 1920 : 0, height: type === "video" ? 1080 : 0, frameRate: type === "video" ? 30 : 0, codec: "x", sampleRate: 48000, fileSize: 1, hasAudio: true, ...metadata },
});

function fixture(): Project {
  const project = createEmptyProject("Multichannel paths");
  return {
    ...project,
    settings: { ...project.settings, frameRate: 30 },
    mediaLibrary: {
      items: [
        item("quad", "quad.wav", "audio", { channels: 4 }),
        item("mov", "two-stereo.mov", "video", { channels: 2, audioTrackCount: 2 }),
        // One mono dialogue stream beside a stereo mix: streams of different widths.
        item("mixed", "mono-plus-stereo.mov", "video", { channels: 2, audioTrackCount: 2, audioStreamChannels: [1, 2] }),
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
        track("a4", "audio", []),
        track("a5", "audio", []),
      ],
    },
  } as unknown as Project;
}

const tracksOf = () => useProjectStore.getState().project.timeline.tracks;
const clipsOn = (id: string) => tracksOf().find((t) => t.id === id)!.clips;
const placedOf = (mediaId: string) => tracksOf().flatMap((t) => t.clips.filter((c) => c.mediaId === mediaId).map((c) => ({ ...c, trackId: t.id })));
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
const select = (id: string) => useUIStore.setState({ selectedItems: [{ type: "media", id }] } as never);

describe("drag from the Source monitor", () => {
  it("drops the picture on the track it lands on and one audio clip per enabled group on the patched tracks", () => {
    openSource("mov", { in: 0, out: 4 });
    const before = undoSteps();
    const outcome = dropSourceRange("mov", "v1", 3, "both");
    expect(outcome.success, outcome.message).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    const placed = placedOf("mov");
    const picture = placed.find((c) => c.trackId === "v1")!;
    expect([picture.startTime, picture.duration, picture.volume]).toEqual([3, 4, 0]);
    const sounds = placed.filter((c) => c.trackId !== "v1");
    expect(sounds.map((c) => c.audioTrackIndex ?? 0).sort()).toEqual([0, 1]);
    for (const sound of sounds) expect([sound.startTime, sound.duration, sound.metadata?.separatedFromClipId]).toEqual([3, 4, picture.id]);
  });

  it("a sound-only drop on an audio track puts the first group there and cascades the rest, honouring switched-off channels", () => {
    openSource("quad", { in: 0, out: 2 });
    useEditorWorkspaceStore.getState().setChannelEnabled(2, false);
    const outcome = dropSourceRange("quad", "a3", 1, "audio");
    expect(outcome.success, outcome.message).toBe(true);
    const placed = placedOf("quad");
    expect(placed.map((c) => [c.trackId, c.channelMap?.sources[0]]).sort()).toEqual([["a3", 0], ["a4", 1], ["a5", 3]].sort());
    expect(placed.every((c) => c.startTime === 1 && c.duration === 2)).toBe(true);
  });

  it("refuses when every channel is switched off and nothing is placed", () => {
    openSource("quad");
    for (let ch = 0; ch < 4; ch++) useEditorWorkspaceStore.getState().setChannelEnabled(ch, false);
    const outcome = dropSourceRange("quad", "a2", 0, "audio");
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/switched off/);
    expect(placedOf("quad")).toHaveLength(0);
  });
});

describe("Fit to Fill", () => {
  it("retimes the picture and every enabled audio group alike, in one undo step", () => {
    openSource("mov", { in: 0, out: 8 });
    useTimelineStore.setState({ loopStart: 2, loopEnd: 6 });
    const before = undoSteps();
    const outcome = fitToFillFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    const placed = placedOf("mov");
    expect(placed).toHaveLength(3);
    for (const c of placed) expect([c.startTime, c.duration, c.speed]).toEqual([2, 4, 2]);
    expect(placed.filter((c) => c.trackId !== "v1").map((c) => c.audioTrackIndex ?? 0).sort()).toEqual([0, 1]);
  });
});

describe("Replace", () => {
  it("a sound clip keeps its slot in the new source's layout and drops the old clip's stream and channel map", () => {
    // A2 of a 4-channel file sat on a2 with a channel map of the OLD footage; it is replaced with a 4-channel file.
    const base = fixture();
    const sound = clip("snd", "a2", 1, 3, "quad", { channelMap: { format: "mono", sources: [1] }, metadata: { sourceChannelGroup: 1 } });
    open({ ...base, timeline: { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "a2" ? { ...t, clips: [sound] } : t)) } } as Project);
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "snd" }] } as never);
    useEditorWorkspaceStore.setState({ targetedTrackIds: [] });
    // Source: two-stereo.mov has 2 streams (2 groups): slot 1 is its second stream.
    openSource("mov", { in: 0, out: 3 });
    const outcome = replaceFromSource({ alignment: "in" });
    expect(outcome.success, outcome.message).toBe(true);
    const replaced = clipsOn("a2")[0];
    expect(replaced.mediaId).toBe("mov");
    expect(replaced.audioTrackIndex).toBe(1);
    expect(replaced.channelMap).toBeUndefined();
    expect(replaced.metadata?.sourceChannelGroup).toBe(1);
  });

  it("replacing with a plain stereo file clears the stale channel map and slot", () => {
    const base = fixture();
    const sound = clip("snd", "a2", 1, 3, "quad", { channelMap: { format: "mono", sources: [2] }, metadata: { sourceChannelGroup: 2 } });
    open({ ...base, timeline: { ...base.timeline, tracks: base.timeline.tracks.map((t) => (t.id === "a2" ? { ...t, clips: [sound] } : t)) } } as Project);
    useUIStore.setState({ selectedItems: [{ type: "clip", id: "snd" }] } as never);
    openSource("other", { in: 0, out: 3 });
    expect(replaceFromSource({ alignment: "in" }).success).toBe(true);
    const replaced = clipsOn("a2")[0];
    expect(replaced.mediaId).toBe("other");
    expect(replaced.channelMap).toBeUndefined();
    expect(replaced.metadata?.sourceChannelGroup).toBeUndefined();
  });
});

describe("Insert / Overwrite from the Project panel", () => {
  it("Insert places the picture and one audio clip per group at the playhead, one undo step", () => {
    select("mov");
    const before = undoSteps();
    const outcome = insertSelectedMedia();
    expect(outcome.success, outcome.message).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    const placed = placedOf("mov");
    expect(placed).toHaveLength(3);
    expect(placed.every((c) => c.startTime === 2 && c.duration === 20)).toBe(true);
  });

  it("Overwrite of a 4-channel file honours the per-channel patch", () => {
    select("quad");
    const ws = useEditorWorkspaceStore.getState();
    ws.setChannelPatch(1, "a5");
    ws.setChannelEnabled(3, false);
    expect(overwriteSelectedMedia().success).toBe(true);
    expect(clipsOn("a5").map((c) => c.channelMap?.sources[0])).toEqual([1]);
    expect(placedOf("quad").map((c) => c.channelMap?.sources[0]).sort()).toEqual([0, 1, 2]);
  });
});

describe("Add to timeline (placeMediaClip)", () => {
  it("places every group on free tracks and never overwrites what is under it", async () => {
    const before = undoSteps();
    const result = await useProjectStore.getState().placeMediaClip("quad", "a1", 2);
    expect(result.success, result.error?.message).toBe(true);
    expect(undoSteps()).toBe(before + 1);
    // a1 holds a clip across the interval: that clip is untouched and the groups went to a2..a5.
    expect(clipsOn("a1")).toHaveLength(1);
    expect(clipsOn("a1")[0].duration).toBe(10);
    expect(placedOf("quad").map((c) => [c.trackId, c.channelMap?.sources[0]]).sort()).toEqual([["a2", 0], ["a3", 1], ["a4", 2], ["a5", 3]]);
    await useProjectStore.getState().undo();
    expect(placedOf("quad")).toHaveLength(0);
  });

  it("a video file with two streams adds a picture and two sound clips, creating a track when none is free", async () => {
    const result = await useProjectStore.getState().placeMediaClip("mov", "v1", 0);
    expect(result.success, result.error?.message).toBe(true);
    const placed = placedOf("mov");
    expect(placed).toHaveLength(3);
    expect(placed.find((c) => c.trackId === "v1")?.volume).toBe(0);
  });

  it("single-stream media still takes the plain path (one clip)", async () => {
    const result = await useProjectStore.getState().placeMediaClip("other", "a2", 0);
    expect(result.success, result.error?.message).toBe(true);
    expect(placedOf("other").filter((c) => c.id !== "a-old")).toHaveLength(1);
  });
});

describe("files whose audio streams have different widths", () => {
  it("groups per stream: the mono stream is one mono clip, the stereo stream one stereo clip, both played untouched", async () => {
    const result = await useProjectStore.getState().placeMediaClip("mixed", "v1", 0);
    expect(result.success, result.error?.message).toBe(true);
    const sounds = placedOf("mixed").filter((c) => c.trackId !== "v1");
    expect(sounds.map((c) => c.audioTrackIndex ?? 0).sort()).toEqual([0, 1]);
    // Each stream plays as it is: no channel map is needed for a stereo stream of a mono + stereo file.
    expect(sounds.every((c) => c.channelMap === undefined)).toBe(true);
  });
});
