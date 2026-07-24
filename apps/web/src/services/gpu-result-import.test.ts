import { describe, it, expect, vi, beforeEach } from "vitest";
import { importGpuResult, importGpuStems } from "./gpu-result-import";
import { useProjectStore } from "../stores/project-store";
import { saveMediaBlob } from "./media-storage";
import type { PendingGpuJob } from "../stores/gpu-job-store";
import type { MediaItem } from "@openreel/core";

vi.mock("./media-storage", () => ({
  saveMediaBlob: vi.fn(async () => undefined),
}));

vi.mock("../stores/engine-store", () => ({
  useEngineStore: { getState: () => ({ videoEngine: null }) },
}));

const replaceMediaAsset = vi.fn<
  [mediaId: string, file: File, sourceFolder?: string],
  Promise<{ success: boolean; actionId?: string; error?: { message: string } }>
>(async () => ({ success: true, actionId: "act-1" }));

const addPlaceholderMedia = vi.fn();

const getMediaItem = vi.fn<[mediaId: string], MediaItem | undefined>(
  (mediaId) =>
    ({
      id: mediaId,
      type: "video",
      isPlaceholder: true,
      metadata: { duration: 5 },
    }) as unknown as MediaItem,
);

vi.spyOn(useProjectStore, "getState").mockReturnValue({
  replaceMediaAsset,
  getMediaItem,
  addPlaceholderMedia,
  project: { id: "project-1" },
} as unknown as ReturnType<typeof useProjectStore.getState>);

function makeJob(overrides: Partial<PendingGpuJob> = {}): PendingGpuJob {
  return {
    jobID: "job-1",
    mediaId: "media-1",
    projectId: "project-1",
    kind: "upscale",
    suggestedName: "Upscaled.png",
    createdAt: Date.now(),
    retries: 0,
    failed: false,
    ...overrides,
  };
}

describe("importGpuResult", () => {
  beforeEach(() => {
    replaceMediaAsset.mockClear();
    getMediaItem.mockClear();
    addPlaceholderMedia.mockClear();
    vi.mocked(saveMediaBlob).mockClear();
    replaceMediaAsset.mockResolvedValue({ success: true, actionId: "act-1" });
    getMediaItem.mockImplementation(
      (mediaId) =>
        ({ id: mediaId, type: "video", isPlaceholder: true, metadata: { duration: 5 } }) as unknown as MediaItem,
    );
  });

  it("routes an image artifact through replaceMediaAsset with the mime type preserved", async () => {
    const job = makeJob({ suggestedName: "Result.png" });
    await importGpuResult({
      job,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      mime: "image/png",
      relativePath: "out.png",
    });

    expect(replaceMediaAsset).toHaveBeenCalledTimes(1);
    const [mediaId, file] = replaceMediaAsset.mock.calls[0];
    expect(mediaId).toBe("media-1");
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("Result.png");
  });

  it("routes a video artifact through replaceMediaAsset with the video mime preserved", async () => {
    const job = makeJob({ suggestedName: "Result.mp4" });
    await importGpuResult({
      job,
      bytes: new Uint8Array([4, 5, 6]).buffer,
      mime: "video/mp4",
      relativePath: "out.mp4",
    });

    expect(replaceMediaAsset).toHaveBeenCalledTimes(1);
    const [mediaId, file] = replaceMediaAsset.mock.calls[0];
    expect(mediaId).toBe("media-1");
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("video/mp4");
    expect(file.name).toBe("Result.mp4");
  });

  it("persists the resolved blob to IndexedDB after a successful replace", async () => {
    const job = makeJob({ suggestedName: "Result.mp4" });
    await importGpuResult({
      job,
      bytes: new Uint8Array([4, 5, 6]).buffer,
      mime: "video/mp4",
      relativePath: "out.mp4",
    });

    expect(saveMediaBlob).toHaveBeenCalledTimes(1);
    const [projectId, mediaId, blob] = vi.mocked(saveMediaBlob).mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(mediaId).toBe("media-1");
    expect(blob).toBeInstanceOf(File);
  });

  it("falls back to the relativePath basename when suggestedName is empty", async () => {
    const job = makeJob({ suggestedName: "" });
    await importGpuResult({
      job,
      bytes: new Uint8Array([7]).buffer,
      mime: "image/png",
      relativePath: "nested/dir/frame.png",
    });

    const [, file] = replaceMediaAsset.mock.calls[0];
    expect(file.name).toBe("frame.png");
  });

  it("imports as a new asset when the result type would break the target clip", async () => {
    getMediaItem.mockImplementation(
      (id) =>
        ({ id, type: "video", isPlaceholder: false, metadata: { duration: 5 } }) as unknown as MediaItem,
    );
    const job = makeJob({ mediaId: "source-video", kind: "voice_enhance", suggestedName: "Enhanced" });
    await importGpuResult({
      job,
      bytes: new Uint8Array([1]).buffer,
      mime: "audio/wav",
      relativePath: "voice.wav",
    });
    expect(addPlaceholderMedia).toHaveBeenCalledTimes(1);
    const [mediaId] = replaceMediaAsset.mock.calls[0];
    expect(mediaId).not.toBe("source-video");
    expect(mediaId).toMatch(/^gpu-result-voice_enhance-/);
  });

  it("throws when replaceMediaAsset fails so the poller can flag the placeholder", async () => {
    replaceMediaAsset.mockResolvedValueOnce({
      success: false,
      error: { message: "decode failed" },
    });
    const job = makeJob({ suggestedName: "Result.mp4" });

    await expect(
      importGpuResult({
        job,
        bytes: new Uint8Array([4, 5, 6]).buffer,
        mime: "video/mp4",
        relativePath: "out.mp4",
      }),
    ).rejects.toThrow("decode failed");

    expect(saveMediaBlob).not.toHaveBeenCalled();
  });
});

describe("importGpuStems", () => {
  const demucsStems = [
    { bytes: new Uint8Array([1]).buffer, mime: "audio/wav", relativePath: "stems/bass.wav" },
    { bytes: new Uint8Array([2]).buffer, mime: "audio/wav", relativePath: "stems/drums.wav" },
    { bytes: new Uint8Array([3]).buffer, mime: "audio/wav", relativePath: "stems/other.wav" },
    { bytes: new Uint8Array([4]).buffer, mime: "audio/wav", relativePath: "stems/vocals.wav" },
  ];

  beforeEach(() => {
    replaceMediaAsset.mockClear();
    getMediaItem.mockClear();
    addPlaceholderMedia.mockClear();
    vi.mocked(saveMediaBlob).mockClear();
    replaceMediaAsset.mockResolvedValue({ success: true, actionId: "act-1" });
    getMediaItem.mockImplementation(
      (mediaId) =>
        ({ id: mediaId, type: "audio", isPlaceholder: true, metadata: { duration: 5 } }) as unknown as MediaItem,
    );
  });

  it("imports every stem as its own labeled audio item (not just the silent bass)", async () => {
    const job = makeJob({ kind: "audio_separation", suggestedName: "Clip result" });
    await importGpuStems({ job, stems: demucsStems });

    expect(replaceMediaAsset).toHaveBeenCalledTimes(4);
    const names = replaceMediaAsset.mock.calls.map(([, file]) => file.name);
    expect(names).toEqual([
      "Clip — Bass.wav",
      "Clip — Drums.wav",
      "Clip — Other.wav",
      "Clip — Vocals.wav",
    ]);
  });

  it("reuses the job placeholder for the first stem and fresh ids for the rest", async () => {
    const job = makeJob({ mediaId: "stem-media", kind: "audio_separation", suggestedName: "Clip" });
    await importGpuStems({ job, stems: demucsStems });

    const ids = replaceMediaAsset.mock.calls.map(([mediaId]) => mediaId);
    expect(ids[0]).toBe("stem-media");
    expect(ids.slice(1)).toEqual(["stem-media-drums", "stem-media-other", "stem-media-vocals"]);
    expect(addPlaceholderMedia).toHaveBeenCalledTimes(3);
    expect(saveMediaBlob).toHaveBeenCalledTimes(4);
  });

  it("throws if a stem fails to import", async () => {
    replaceMediaAsset.mockResolvedValueOnce({ success: false, error: { message: "bad wav" } });
    const job = makeJob({ kind: "audio_separation" });
    await expect(importGpuStems({ job, stems: demucsStems })).rejects.toThrow("bad wav");
  });
});
