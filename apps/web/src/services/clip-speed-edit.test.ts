import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSpeedEngine, type Clip, type Track } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { EditingSession } from "./agent/editing-session";
import { editClipSpeed } from "./clip-speed-edit";

const state = () => useProjectStore.getState();
const clips = () => state().project.timeline.tracks.flatMap(track => track.clips);
const makeClip = (id: string, trackId: string): Clip => ({
  id, trackId, mediaId: "source", startTime: 2, duration: 8, inPoint: 1, outPoint: 9,
  speed: 1, volume: .8, effects: [], audioEffects: [], keyframes: [],
  transform: { position: { x: .2, y: .3 }, scale: { x: .8, y: 1.1 }, rotation: 17, opacity: .6, anchor: { x: .5, y: .5 } },
  ...(id !== "video" ? { metadata: { separatedFromClipId: "video", sourceAudioTrackIndex: id === "audio" ? 0 : 1 } } : {}),
});
beforeEach(() => {
  state().createNewProject("Atomic speed");
  const project = state().project;
  const tracks: Track[] = ["video", "audio", "audio2"].map(id => ({ id, name: id, type: id === "video" ? "video" : "audio",
    clips: [makeClip(id, id)], transitions: [], locked: false, hidden: false, muted: false, solo: false }));
  useProjectStore.setState({ project: { ...project, timeline: { ...project.timeline, tracks, duration: 10 },
    mediaLibrary: { items: [{ id: "source", type: "video", name: "Source.mp4", blob: null, fileHandle: null,
      waveformData: null, thumbnailUrl: null, metadata: { duration: 20, width: 640, height: 360, frameRate: 30,
        codec: "h264", sampleRate: 48000, channels: 2, fileSize: 1 } }] } } });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: false } });
  state().actionHistory.clear();
  state().actionHistory.setAutoGroupWindow(0);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("atomic speed edits", () => {
  it("updates every separated stream and restores complete clip data with one Undo and Redo", async () => {
    const before = structuredClone(clips());
    expect(await editClipSpeed(state().project.id, "video", { speed: 2 }, true)).toBe(true);
    for (const current of clips()) {
      expect(current.speed).toBe(2); expect(current.duration).toBe(4);
      expect(getSpeedEngine().getClipSpeed(current.id)).toBe(2);
      expect({ ...current, speed: 1, duration: 8 }).toEqual(before.find(clip => clip.id === current.id));
    }
    await state().undo();
    expect(clips()).toEqual(before);
    expect(state().canUndo()).toBe(false);
    for (const clip of clips()) expect(getSpeedEngine().getClipSpeed(clip.id)).toBe(1);
    await state().redo();
    expect(clips().every(clip => clip.speed === 2 && clip.duration === 4)).toBe(true);
  });

  it("can leave the other streams unchanged and reverse all streams atomically", async () => {
    const before = structuredClone(clips());
    await editClipSpeed(state().project.id, "video", { speed: .5 }, false);
    expect(state().getClip("video")?.duration).toBe(16);
    expect(clips().slice(1)).toEqual(before.slice(1));
    await state().undo();
    await editClipSpeed(state().project.id, "video", { reversed: true }, true);
    expect(clips().every(clip => clip.reversed)).toBe(true);
    await state().undo();
    expect(clips()).toEqual(before);
  });

  it("keeps smoothing/quality on the selected clip and makes each undoable", async () => {
    const before = structuredClone(clips());
    await editClipSpeed(state().project.id, "video", { timeInterpolation: "opticalFlow" }, true);
    await editClipSpeed(state().project.id, "video", { interpolationQuality: "high" }, true);
    expect(state().getClip("video")).toMatchObject({ timeInterpolation: "opticalFlow", interpolationQuality: "high" });
    expect(clips().slice(1)).toEqual(before.slice(1));
    await state().undo();
    expect(state().getClip("video")?.interpolationQuality).toBeUndefined();
    await state().undo();
    expect(clips()).toEqual(before);
  });

  it.each([NaN, 0, 21])("rejects unsupported speed %s without data/history changes", async speed => {
    const before = structuredClone(state().project);
    expect(await editClipSpeed(before.id, "video", { speed }, true)).toBe(false);
    expect(state().project).toEqual(before); expect(state().canUndo()).toBe(false);
  });

  it.each(["video", "audio2"])("rejects the complete edit when %s is locked", async id => {
    await state().lockTrack(id, true); state().actionHistory.clear();
    const before = structuredClone(state().project);
    expect(await editClipSpeed(before.id, "video", { speed: 2 }, true)).toBe(false);
    expect(state().project).toEqual(before); expect(state().canUndo()).toBe(false);
  });

  it.each(["export", "owner"])("rejects edits during %s", async reason => {
    const before = structuredClone(state().project);
    if (reason === "export") useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
    if (reason === "processing") useTimelineStore.setState({ playbackLockedReason: "processing" });
    expect(await editClipSpeed(reason === "owner" ? "old-project" : before.id, "video", { speed: 2 }, true)).toBe(false);
    expect(state().project).toEqual(before); expect(state().canUndo()).toBe(false);
  });

  it("does not publish a prepared draft when an export begins", async () => {
    const before = structuredClone(state().project);
    const apply = EditingSession.prototype.applyAction;
    vi.spyOn(EditingSession.prototype, "applyAction").mockImplementationOnce(async function (this: EditingSession, action) {
      const result = await apply.call(this, action);
      useUIStore.setState({ exportState: { ...useUIStore.getState().exportState, isExporting: true } });
      return result;
    });
    expect(await editClipSpeed(before.id, "video", { speed: 2 }, true)).toBe(false);
    expect(state().project).toEqual(before); expect(state().canUndo()).toBe(false);
  });

  it("does not overwrite a replacement project while preparing linked streams", async () => {
    const projectId = state().project.id;
    const apply = EditingSession.prototype.applyAction;
    vi.spyOn(EditingSession.prototype, "applyAction").mockImplementationOnce(async function (this: EditingSession, action) {
      const result = await apply.call(this, action);
      state().createNewProject("Replacement");
      return result;
    });
    expect(await editClipSpeed(projectId, "video", { speed: 2 }, true)).toBe(false);
    expect(state().project.name).toBe("Replacement");
    expect(state().project.id).not.toBe(projectId);
    expect(state().canUndo()).toBe(false);
  });
});
