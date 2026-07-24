import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MotionFrameCache,
  resolvePreviewFrame,
  drawAndMaybeCache,
  shouldInvalidateFrameCache,
  type FrameBitmapLike,
} from "./frame-cache";
import {
  getFrameCacheState,
  setFrameCacheState,
  subscribeFrameCacheState,
  resetFrameCacheState,
} from "./frame-cache-state";

interface MockBitmap extends FrameBitmapLike {
  readonly width: number;
  readonly height: number;
  closeCount: number;
  close(): void;
}

function makeBitmap(width = 4, height = 4): MockBitmap {
  const bitmap: MockBitmap = {
    width,
    height,
    closeCount: 0,
    close() {
      bitmap.closeCount += 1;
    },
  };
  return bitmap;
}

describe("resolvePreviewFrame", () => {
  it("quantizes time to the nearest lower frame index at the given fps", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(resolvePreviewFrame(cache, 0, 30).index).toBe(0);
    expect(resolvePreviewFrame(cache, 0.033, 30).index).toBe(0);
    expect(resolvePreviewFrame(cache, 0.034, 30).index).toBe(1);
    expect(resolvePreviewFrame(cache, 1, 30).index).toBe(30);
  });

  it("reports cached=true when the resolved frame is present", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    cache.setFrame(15, makeBitmap());
    expect(resolvePreviewFrame(cache, 0.5, 30)).toEqual({ index: 15, cached: true });
    expect(resolvePreviewFrame(cache, 0.6, 30).cached).toBe(false);
  });

  it("clamps negative time to frame 0", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(resolvePreviewFrame(cache, -5, 30).index).toBe(0);
  });

  it("throws when fps is not a positive finite number", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(() => resolvePreviewFrame(cache, 1, 0)).toThrow();
    expect(() => resolvePreviewFrame(cache, 1, Number.NaN)).toThrow();
    expect(() => resolvePreviewFrame(cache, 1, -30)).toThrow();
  });
});

describe("drawAndMaybeCache", () => {
  it("stores an uncached frame and does NOT close it (cache owns it)", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const bitmap = makeBitmap();
    const draw = vi.fn();
    drawAndMaybeCache(cache, 3, bitmap, draw);
    expect(draw).toHaveBeenCalledWith(bitmap);
    expect(cache.has(3)).toBe(true);
    expect(bitmap.closeCount).toBe(0);
  });

  it("closes a bitmap for an already-cached index and keeps the cached one intact", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const cached = makeBitmap();
    cache.setFrame(3, cached);
    const freshlyRendered = makeBitmap();
    const draw = vi.fn();
    drawAndMaybeCache(cache, 3, freshlyRendered, draw);
    expect(draw).toHaveBeenCalledWith(freshlyRendered);
    expect(freshlyRendered.closeCount).toBe(1);
    expect(cached.closeCount).toBe(0);
    expect(cache.getFrame(3)).toBe(cached);
  });
});

describe("shouldInvalidateFrameCache", () => {
  const base = { id: "c1", modifiedAt: 100, width: 640, height: 360, quality: "full" };

  it("returns false when nothing relevant changed", () => {
    expect(shouldInvalidateFrameCache(base, { ...base })).toBe(false);
  });

  it("returns true on id change", () => {
    expect(shouldInvalidateFrameCache(base, { ...base, id: "c2" })).toBe(true);
  });

  it("returns true on modifiedAt change", () => {
    expect(shouldInvalidateFrameCache(base, { ...base, modifiedAt: 101 })).toBe(true);
  });

  it("returns true on preview size change", () => {
    expect(shouldInvalidateFrameCache(base, { ...base, width: 320 })).toBe(true);
    expect(shouldInvalidateFrameCache(base, { ...base, height: 180 })).toBe(true);
  });

  it("returns true on quality change", () => {
    expect(shouldInvalidateFrameCache(base, { ...base, quality: "half" })).toBe(true);
  });
});

describe("frame-cache-state", () => {
  beforeEach(() => {
    resetFrameCacheState();
  });

  afterEach(() => {
    resetFrameCacheState();
  });

  it("has a default empty, non-filling, enabled state", () => {
    expect(getFrameCacheState()).toEqual({ ranges: [], filling: false, enabled: true });
  });

  it("publishes merged ranges and notifies subscribers", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeFrameCacheState(() => {
      seen.push(getFrameCacheState().ranges.length);
    });
    setFrameCacheState({ ranges: [{ start: 0, end: 5 }] });
    expect(getFrameCacheState().ranges).toEqual([{ start: 0, end: 5 }]);
    expect(getFrameCacheState().filling).toBe(false);
    setFrameCacheState({ filling: true });
    expect(getFrameCacheState().filling).toBe(true);
    expect(getFrameCacheState().ranges).toEqual([{ start: 0, end: 5 }]);
    expect(seen.length).toBe(2);
    unsubscribe();
    setFrameCacheState({ ranges: [] });
    expect(seen.length).toBe(2);
  });

  it("publishes ranges built from a MotionFrameCache", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    for (const index of [1, 2, 3, 7, 8]) {
      cache.setFrame(index, makeBitmap());
    }
    setFrameCacheState({ ranges: cache.cachedRanges() });
    expect(getFrameCacheState().ranges).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 8 },
    ]);
  });
});
