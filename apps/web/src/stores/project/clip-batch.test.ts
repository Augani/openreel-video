import "../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import type { Clip, MediaItem, Track } from "@openreel/core";
import { createEmptyProject } from "./project-helpers";
import { useProjectStore } from "../project-store";

const base: Clip = { id: "c", mediaId: "m", trackId: "main", startTime: 0, duration: 1, inPoint: 0, outPoint: 1, volume: 1, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: .5, y: .5 }, rotation: 0, opacity: 1 } };
const media: MediaItem = { id: "m", name: "m.mp4", type: "video", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 1, width: 640, height: 360, frameRate: 30, codec: "h264", fileSize: 0, sampleRate: 0, channels: 0 } };
const clips = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `c${i}`, startTime: i * 2 }));

beforeEach(() => {
  const project = createEmptyProject("batch");
  const track: Track = { id: "main", name: "Main", type: "video", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false };
  useProjectStore.getState().loadProject({ ...project, timeline: { ...project.timeline, tracks: [track] }, mediaLibrary: { items: [media] } });
});

const startOf = (id: string) => useProjectStore.getState().getClip(id)?.startTime;
const steps = () => useProjectStore.getState().actionHistory.getDisplayHistory().length;

describe("batched clip actions", () => {
  it("moveClips moves every clip in one undo step", async () => {
    const result = await useProjectStore.getState().moveClips(clips.map((c) => ({ clipId: c.id, startTime: c.startTime + 10 })));
    expect(result.success).toBe(true);
    expect(startOf("c29")).toBe(58 + 10);
    expect(steps()).toBe(1);
    await useProjectStore.getState().undo();
    expect(startOf("c29")).toBe(58);
    expect(startOf("c0")).toBe(0);
  });

  it("consecutive moveClips of one gesture inside a group coalesce into one entry that undoes to the origin", async () => {
    const store = useProjectStore.getState();
    store.beginHistoryGroup("Move clips");
    for (const delta of [1, 2, 3]) await store.moveClips(clips.map((c) => ({ clipId: c.id, startTime: c.startTime + delta })), { coalesceKey: "drag" });
    store.endHistoryGroup();
    expect(startOf("c5")).toBe(10 + 3);
    expect(useProjectStore.getState().actionExecutor.getHistory().getHistoryEntries()).toHaveLength(1);
    await useProjectStore.getState().undo();
    expect(startOf("c5")).toBe(10);
  });

  it("removeClips removes many clips in one undo step and undo restores them in order", async () => {
    const ids = clips.slice(0, 20).map((c) => c.id);
    const result = await useProjectStore.getState().removeClips(ids);
    expect(result.success).toBe(true);
    expect(useProjectStore.getState().project.timeline.tracks[0].clips).toHaveLength(10);
    expect(steps()).toBe(1);
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.timeline.tracks[0].clips.map((c) => c.id)).toEqual(clips.map((c) => c.id));
  });
});
