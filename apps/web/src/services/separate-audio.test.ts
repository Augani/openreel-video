import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";
import { extractAudioTracks } from "./separate-audio";

const { extract, probe, nativeProbe, nativeAvailable, bridge } = vi.hoisted(() => ({
  extract: vi.fn(), probe: vi.fn(), nativeProbe: vi.fn(), nativeAvailable: vi.fn(),
  bridge: { isInitialized: () => true, importFile: vi.fn() },
}));
vi.mock("@openreel/core/media", () => ({
  extractAudioWav: extract,
  getFFmpegFallback: () => ({ probeAudioStreams: probe }),
  nativeMediaAvailable: nativeAvailable,
  probeAudioStreamCountViaNative: nativeProbe,
}));
vi.mock("../bridges/media-bridge", () => ({
  getMediaBridge: () => bridge, initializeMediaBridge: vi.fn(),
}));

const video = (count?: number): MediaItem => ({
  id: "video", name: "Recording.mp4", type: "video",
  blob: new Blob(["video"]), fileHandle: null,
  thumbnailUrl: "blob:video-thumbnail", waveformData: new Float32Array([1]),
  metadata: { duration: 10, width: 1920, height: 1080, frameRate: 30,
    codec: "h264", sampleRate: 48_000, channels: 2, fileSize: 5, audioTrackCount: count },
});

beforeEach(() => {
  vi.resetAllMocks();
  nativeAvailable.mockReturnValue(false);
  probe.mockResolvedValue({ audioStreamCount: 2 });
  extract.mockImplementation(async (_blob, index) => new Blob([`stream-${index}`], { type: "audio/wav" }));
  bridge.importFile.mockImplementation(async (file: File) => ({
    success: true,
    media: {
      metadata: { hasAudio: true, hasVideo: false, duration: 10, codec: "pcm_f32le", sampleRate: 48_000, channels: 2 },
      waveformData: { peaks: new Float32Array([file.name.includes("Audio 1") ? 0.1 : 0.9]) },
    },
  }));
});

describe("recorded audio stream extraction", () => {
  it("extracts every stream into distinct audio-only media with independent waveforms", async () => {
    const source = video(2);
    const tracks = await extractAudioTracks(source);
    expect(extract.mock.calls).toEqual([[source.blob, 0], [source.blob, 1]]);
    expect(tracks.map((track) => track.name)).toEqual(["Recording - Audio 1.wav", "Recording - Audio 2.wav"]);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(2);
    expect(tracks.map((track) => track.waveformData?.[0])).toEqual([expect.closeTo(0.1), expect.closeTo(0.9)]);
    for (const track of tracks) {
      expect(track).toMatchObject({ type: "audio", thumbnailUrl: null,
        metadata: { hasVideo: false, hasAudio: true, audioTrackCount: 1, width: 0 } });
      expect(track.blob?.type).toBe("audio/wav");
      expect(track.blob).not.toBe(source.blob);
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes older imports whose stream count was discarded", async () => {
    const source = video();
    expect(await extractAudioTracks(source)).toHaveLength(2);
    expect(probe).toHaveBeenCalledWith(source.blob);
  });

  it("uses the native probe in desktop builds", async () => {
    nativeAvailable.mockReturnValue(true);
    nativeProbe.mockResolvedValue(3);
    expect(await extractAudioTracks(video())).toHaveLength(3);
    expect(probe).not.toHaveBeenCalled();
  });

  it("fails when a specific stream cannot be extracted instead of copying the first stream", async () => {
    extract.mockResolvedValueOnce(new Blob(["mic"])).mockRejectedValueOnce(new Error("Stream 1 failed"));
    await expect(extractAudioTracks(video(2))).rejects.toThrow("Stream 1 failed");
    expect(bridge.importFile).toHaveBeenCalledOnce();
  });

  it("rejects missing media and silent files", async () => {
    await expect(extractAudioTracks({ ...video(), blob: null })).rejects.toThrow("Relink");
    probe.mockResolvedValue({ audioStreamCount: 0 });
    await expect(extractAudioTracks(video())).rejects.toThrow("no recorded audio");
    expect(extract).not.toHaveBeenCalled();
  });

  it("does not invent mic/game streams for a recording containing a single mix", async () => {
    probe.mockResolvedValue({ audioStreamCount: 1 });
    expect(await extractAudioTracks(video(1))).toHaveLength(1);
    expect(extract).toHaveBeenCalledOnce();
  });
});
