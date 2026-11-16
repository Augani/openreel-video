import { afterEach, describe, expect, it, vi } from "vitest";
import { ffmpegRotationFilters, normalizeRotation, rotatedSize, sampleToUprightBitmap } from "./rotation";

describe("rotation metadata helpers", () => {
  it("normalises any angle to a quarter turn", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(179.6)).toBe(180);
    expect(normalizeRotation(Number.NaN)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
  });

  it("swaps width and height for quarter turns only", () => {
    expect(rotatedSize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
    expect(rotatedSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
  });

  it("asks ffmpeg for the same turn the WebCodecs path applies", () => {
    expect(ffmpegRotationFilters(0)).toEqual([]);
    expect(ffmpegRotationFilters(90)).toEqual(["transpose=1"]);
    expect(ffmpegRotationFilters(180)).toEqual(["hflip", "vflip"]);
    expect(ffmpegRotationFilters(270)).toEqual(["transpose=2"]);
  });
});

describe("sampleToUprightBitmap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws through VideoSample.draw on a display-sized canvas so rotation is applied", async () => {
    const ctx = {};
    const created: Array<{ width: number; height: number }> = [];
    class FakeCanvas {
      constructor(
        public width: number,
        public height: number,
      ) {
        created.push({ width, height });
      }
      getContext() {
        return ctx;
      }
    }
    const bitmap = { close() {} };
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const draw = vi.fn();
    // A portrait iPhone clip: stored 1920x1080, displayed 1080x1920.
    const result = await sampleToUprightBitmap({ displayWidth: 1080, displayHeight: 1920, draw });
    expect(created).toEqual([{ width: 1080, height: 1920 }]);
    expect(draw).toHaveBeenCalledWith(ctx, 0, 0);
    expect(result).toBe(bitmap);
  });

  it("returns null when no 2D context is available", async () => {
    vi.stubGlobal("OffscreenCanvas", class { getContext() { return null; } });
    expect(await sampleToUprightBitmap({ displayWidth: 2, displayHeight: 2, draw: vi.fn() })).toBeNull();
  });
});

describe("sampleToUprightBitmap fast path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the VideoFrame directly for unrotated samples and closes it", async () => {
    const bitmap = { close() {} };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", create);
    const frame = { close: vi.fn() };
    const draw = vi.fn();
    const result = await sampleToUprightBitmap({ displayWidth: 2, displayHeight: 2, rotation: 0, toVideoFrame: () => frame as unknown as VideoFrame, draw });
    expect(result).toBe(bitmap);
    expect(create).toHaveBeenCalledWith(frame);
    expect(frame.close).toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
  });

  it("draws rotated samples so the rotation is applied", async () => {
    class FakeCanvas {
      constructor(public width: number, public height: number) {}
      getContext() { return {}; }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close() {} })));
    const toVideoFrame = vi.fn();
    const draw = vi.fn();
    await sampleToUprightBitmap({ displayWidth: 1080, displayHeight: 1920, rotation: 90, toVideoFrame: toVideoFrame as unknown as () => VideoFrame, draw });
    expect(toVideoFrame).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalled();
  });
});
