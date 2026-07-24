import { describe, it, expect, vi, beforeEach } from "vitest";
import { DetectorPool } from "./DetectorPool";

const fakeFaceLandmarker = { detectForVideo: vi.fn(() => ({ faceLandmarks: [[{ x: 0.5, y: 0.5 }]] })), close: vi.fn() };
const fakeSegmenter = { segmentForVideo: vi.fn(() => ({ confidenceMasks: [{ width: 320, height: 240 }] })), close: vi.fn() };

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({ url: "wasm" })) },
  FaceLandmarker: { createFromOptions: vi.fn(async () => fakeFaceLandmarker) },
  ImageSegmenter: { createFromOptions: vi.fn(async () => fakeSegmenter) },
}));

describe("DetectorPool", () => {
  beforeEach(() => {
    fakeFaceLandmarker.close.mockClear();
    fakeSegmenter.close.mockClear();
  });

  it("loads FaceLandmarker only when ensure('FaceLandmarker') is called", async () => {
    const pool = new DetectorPool();
    expect(pool.has("FaceLandmarker")).toBe(false);
    await pool.ensure(["FaceLandmarker"]);
    expect(pool.has("FaceLandmarker")).toBe(true);
    expect(pool.has("ImageSegmenter")).toBe(false);
  });

  it("ensure is idempotent for already-loaded detectors", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker"]);
    const first = pool.get("FaceLandmarker");
    await pool.ensure(["FaceLandmarker"]);
    const second = pool.get("FaceLandmarker");
    expect(first).toBe(second);
  });

  it("releaseUnused tears down detectors no longer needed", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker", "ImageSegmenter"]);
    pool.releaseUnused(["FaceLandmarker"]);
    expect(pool.has("ImageSegmenter")).toBe(false);
    expect(fakeSegmenter.close).toHaveBeenCalled();
  });

  it("disposeAll closes every detector", async () => {
    const pool = new DetectorPool();
    await pool.ensure(["FaceLandmarker", "ImageSegmenter"]);
    pool.disposeAll();
    expect(fakeFaceLandmarker.close).toHaveBeenCalled();
    expect(fakeSegmenter.close).toHaveBeenCalled();
  });
});
