import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  submitClipJob: vi.fn(),
  isDesktopGpuAvailable: vi.fn(() => false),
  loadMediaBlob: vi.fn(),
  addPlaceholderMedia: vi.fn(),
  addJob: vi.fn(),
  getClip: vi.fn(),
  getMediaItem: vi.fn(),
  getSelectedClipIds: vi.fn(),
}));

vi.mock("../stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({
      project: { id: "p1" },
      getClip: h.getClip,
      getMediaItem: h.getMediaItem,
      addPlaceholderMedia: h.addPlaceholderMedia,
    }),
  },
}));
vi.mock("../stores/ui-store", () => ({
  useUIStore: { getState: () => ({ getSelectedClipIds: h.getSelectedClipIds }) },
}));
vi.mock("../stores/gpu-job-store", () => ({
  useGpuJobStore: { getState: () => ({ addJob: h.addJob }) },
}));
vi.mock("./gpu-jobs", () => ({
  submitClipJob: h.submitClipJob,
  isDesktopGpuAvailable: h.isDesktopGpuAvailable,
}));
vi.mock("./media-storage", () => ({ loadMediaBlob: h.loadMediaBlob }));
vi.mock("@openreel/core", async (importActual) => {
  const actual = await importActual<typeof import("@openreel/core")>();
  return {
    ...actual,
    materializeToTemp: vi.fn(),
    nativeMediaAvailable: () => false,
    getBridge: () => null,
  };
});

import { submitSelectedClipJob } from "./gpu-clip-submit";

beforeEach(() => {
  vi.clearAllMocks();
  h.isDesktopGpuAvailable.mockReturnValue(false);
  h.getSelectedClipIds.mockReturnValue(["clip1"]);
  h.getClip.mockReturnValue({ mediaId: "m1" });
  h.getMediaItem.mockReturnValue({
    type: "image",
    name: "photo.png",
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  });
  h.submitClipJob.mockResolvedValue({ jobID: "job1" });
});

describe("submitSelectedClipJob", () => {
  it("merges extra params with context and registers the job (web blob path)", async () => {
    const res = await submitSelectedClipJob({
      kind: "object_removal",
      params: { mode: "erase", maskMode: "bbox", bbox: [0, 0, 1, 1] },
      suggestedName: "Object erase result",
    });

    expect(res.jobID).toBe("job1");
    expect(h.submitClipJob).toHaveBeenCalledTimes(1);
    const call = h.submitClipJob.mock.calls[0][0];
    expect(call.kind).toBe("object_removal");
    expect(call.params).toMatchObject({
      context: { projectID: "p1", quality: "balanced" },
      mode: "erase",
      maskMode: "bbox",
      bbox: [0, 0, 1, 1],
    });
    expect(call.blob).toBeInstanceOf(Blob);
    expect(call.srcPath).toBeUndefined();
    expect(call.filename).toBe("photo.png");
    // object_removal is a "replace" kind → no new library tile; the job targets
    // the clip's own source media so the result replaces it in place.
    expect(h.addPlaceholderMedia).not.toHaveBeenCalled();
    expect(res.mediaId).toBe("m1");
    expect(h.addJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobID: "job1", kind: "object_removal", projectId: "p1", mediaId: "m1" }),
    );
  });

  it("adds a new library tile for a new-asset kind (audio separation)", async () => {
    await submitSelectedClipJob({ kind: "audio_separation" });
    expect(h.addPlaceholderMedia).toHaveBeenCalledTimes(1);
    const job = h.addJob.mock.calls[0][0];
    expect(job.mediaId).toMatch(/^gpu-audio_separation-/);
  });

  it("throws when no single clip is selected", async () => {
    h.getSelectedClipIds.mockReturnValue([]);
    await expect(submitSelectedClipJob({ kind: "upscale" })).rejects.toThrow("Select a clip first");
  });

  it("falls back to loadMediaBlob when the media item has no blob", async () => {
    h.getMediaItem.mockReturnValue({ type: "image", name: "x.png", blob: null });
    h.loadMediaBlob.mockResolvedValue(new Blob([new Uint8Array([9])], { type: "image/png" }));
    await submitSelectedClipJob({ kind: "upscale" });
    expect(h.loadMediaBlob).toHaveBeenCalledWith("m1");
    expect(h.submitClipJob).toHaveBeenCalledTimes(1);
  });
});
