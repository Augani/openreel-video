import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Project } from "../types/project";

describe("add-action history cost", () => {
  it("adds a track and clip without serializing source waveforms and retains exact Undo/Redo", async () => {
    const waveform = new Float32Array(100000).fill(0.25);
    const serialized = vi.fn(() => []);
    Object.defineProperty(waveform, "toJSON", { value: serialized });
    const blob = new Blob(["source"]);
    const project: Project = { id: "add-history", name: "Source preserved", createdAt: 1, modifiedAt: 1,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [{ id: "audio", name: "source.wav", type: "audio", blob, fileHandle: null, thumbnailUrl: null, waveformData: waveform,
        metadata: { duration: 2, width: 0, height: 0, frameRate: 0, codec: "pcm", sampleRate: 48000, channels: 2, fileSize: blob.size } }] },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 } };
    const executor = new ActionExecutor();
    expect((await executor.execute({ id: "track-action", type: "track/add", timestamp: 1, params: { trackId: "track", trackType: "audio" } }, project)).success).toBe(true);
    expect((await executor.execute({ id: "clip-action", type: "clip/add", timestamp: 2, params: { clipId: "clip", trackId: "track", mediaId: "audio", startTime: 1 } }, project)).success).toBe(true);
    const original = structuredClone(project.timeline);
    expect(serialized).not.toHaveBeenCalled();
    expect(project.mediaLibrary.items[0].waveformData).toBe(waveform);
    expect(project.mediaLibrary.items[0].blob).toBe(blob);
    await executor.undo(project); await executor.undo(project);
    expect(project.timeline.tracks).toEqual([]);
    await executor.redo(project); await executor.redo(project);
    expect(project.timeline).toEqual(original);
    expect(project.mediaLibrary.items[0].waveformData).toBe(waveform);
  });
});
