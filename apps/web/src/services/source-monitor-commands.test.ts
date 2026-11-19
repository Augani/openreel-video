import { beforeEach, describe, expect, it } from "vitest";
import type { MediaItem, Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useSourceMonitorStore } from "../stores/source-monitor-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { dropSourceRange, setSourceMarks } from "./source-monitor-commands";
import { handleSourceMonitorAction } from "./source-monitor-controller";

const media = (id: string, type: MediaItem["type"]): MediaItem =>
  ({
    id,
    name: `${id}.bin`,
    type,
    fileHandle: null,
    blob: null,
    thumbnailUrl: null,
    waveformData: null,
    metadata: { duration: 10, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "x", fileSize: 1 },
  }) as unknown as MediaItem;

const track = (id: string, type: Track["type"], locked = false): Track => ({
  id,
  name: id,
  type,
  mode: "standard",
  role: "general",
  clips: [],
  transitions: [],
  locked,
  hidden: false,
  muted: false,
  solo: false,
});

function seed() {
  const base = createEmptyProject("t");
  useProjectStore.setState({
    hasOpenProject: true,
    project: {
      ...base,
      mediaLibrary: { items: [media("vid", "video"), media("pic", "image")] },
      timeline: {
        ...base.timeline,
        tracks: [track("v", "video"), track("txt", "text"), track("a", "audio"), track("lk", "video", true)],
      },
    },
  });
  useSourceMonitorStore.setState({ projectId: null, marks: {}, mediaId: null, tab: "program", focus: "program" });
}

const clipsOn = (id: string) =>
  useProjectStore.getState().project.timeline.tracks.find((t) => t.id === id)!.clips;

describe("source monitor commands", () => {
  beforeEach(seed);

  it("dropping onto a video track overwrites once; text, audio and locked lanes are refused untouched", () => {
    expect(dropSourceRange("vid", "v", 1, "both").success).toBe(true);
    expect(clipsOn("v")).toHaveLength(1);
    for (const lane of ["txt", "a", "lk"]) {
      const result = dropSourceRange("vid", lane, 1, "both");
      expect(result.success, lane).toBe(false);
      expect(clipsOn(lane), lane).toHaveLength(0);
    }
  });

  it("audio-only needs an audio track and never lands on a video lane", () => {
    expect(dropSourceRange("vid", "v", 0, "audio").success).toBe(false);
    expect(clipsOn("v")).toHaveLength(0);
    expect(dropSourceRange("vid", "a", 0, "audio").success).toBe(true);
    expect(clipsOn("a")[0].transform.opacity).toBe(0);
  });

  it("rejects inverted In/Out pairs without changing the marks", () => {
    expect(setSourceMarks("vid", { in: 2, out: 4 }).success).toBe(true);
    expect(setSourceMarks("vid", { in: 6, out: 5 }).success).toBe(false);
    expect(useSourceMonitorStore.getState().getMarks("vid")).toEqual({ in: 2, out: 4 });
  });

  it("play and shuttle do nothing for a still; frame stepping still works", () => {
    useSourceMonitorStore.getState().open("pic", useProjectStore.getState().project.id);
    expect(handleSourceMonitorAction("playback.playPause")).toBe(true);
    expect(handleSourceMonitorAction("playback.shuttleForward")).toBe(true);
    expect(useSourceMonitorStore.getState().rate).toBe(0);
    handleSourceMonitorAction("playback.frameForward");
    expect(useSourceMonitorStore.getState().position).toBeCloseTo(1 / 30, 5);
  });

  it("shuttle runs for video", () => {
    useSourceMonitorStore.getState().open("vid", useProjectStore.getState().project.id);
    handleSourceMonitorAction("playback.shuttleForward");
    expect(useSourceMonitorStore.getState().rate).toBe(1);
  });
});

describe("Replace and Fit to Fill commands", () => {
  const seedTimeline = () => {
    const base = createEmptyProject("t");
    const old = { id: "old", name: "old.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2, codec: "x", fileSize: 1, hasAudio: false } } as unknown as MediaItem;
    const clip = {
      id: "target", mediaId: "old", trackId: "v", startTime: 2, duration: 4, inPoint: 0, outPoint: 4,
      effects: [{ id: "fx", type: "blur", params: {}, enabled: true }], audioEffects: [],
      transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
      volume: 1, keyframes: [],
    };
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...base,
        mediaLibrary: { items: [old, media("vid", "video")] },
        timeline: { ...base.timeline, tracks: [{ ...track("v", "video"), clips: [clip] } as unknown as Track] },
      },
    });
    useSourceMonitorStore.setState({ projectId: null, marks: {}, mediaId: null, position: 0, replaceKeepsAttributes: true });
    useSourceMonitorStore.getState().open("vid", useProjectStore.getState().project.id);
  };

  beforeEach(seedTimeline);

  it("Replace keeps the clip and its effects, and one undo restores the old footage", async () => {
    const { useTimelineStore } = await import("../stores/timeline-store");
    const { replaceFromSource } = await import("./source-monitor-commands");
    useTimelineStore.getState().seekTo(3);
    useSourceMonitorStore.getState().setPosition(5);
    const outcome = replaceFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    const clip = () => useProjectStore.getState().project.timeline.tracks[0].clips[0];
    expect(clip()).toMatchObject({ id: "target", mediaId: "vid", startTime: 2, duration: 4, inPoint: 4, outPoint: 8 });
    expect(clip().effects).toHaveLength(1);
    await useProjectStore.getState().undo();
    expect(clip()).toMatchObject({ mediaId: "old", inPoint: 0, outPoint: 4 });
  });

  it("Replace without Keep resets effects; a too-short source changes nothing", async () => {
    const { useTimelineStore } = await import("../stores/timeline-store");
    const { replaceFromSource } = await import("./source-monitor-commands");
    useTimelineStore.getState().seekTo(2);
    expect(replaceFromSource({ keepAttributes: false }).success).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips[0].effects).toHaveLength(0);
    seedTimeline();
    useTimelineStore.getState().seekTo(2);
    useSourceMonitorStore.getState().setPosition(8);
    const refused = replaceFromSource();
    expect(refused.success).toBe(false);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips[0].mediaId).toBe("old");
  });

  it("Fit to Fill needs timeline marks, then retimes into them", async () => {
    const { useTimelineStore } = await import("../stores/timeline-store");
    const { fitToFillFromSource } = await import("./source-monitor-commands");
    useTimelineStore.getState().clearLoopRange();
    expect(fitToFillFromSource().success).toBe(false);
    setSourceMarks("vid", { in: 0, out: 8 });
    useTimelineStore.getState().setLoopRange(10, 14);
    const outcome = fitToFillFromSource();
    expect(outcome.success, outcome.message).toBe(true);
    const placed = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === outcome.clipId)!;
    expect(placed).toMatchObject({ startTime: 10, duration: 4, speed: 2, inPoint: 0, outPoint: 8 });
  });
});
