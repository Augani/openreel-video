import { describe, expect, it } from "vitest";
import { MotionFrameCache, type FrameBitmapLike } from "./frame-cache";

class MockBitmap implements FrameBitmapLike {
  closeCount = 0;
  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {}
  close(): void {
    this.closeCount += 1;
  }
}

function makeBitmap(width = 4, height = 4): MockBitmap {
  return new MockBitmap(width, height);
}

describe("MotionFrameCache", () => {
  it("stores and retrieves frames (hit/miss)", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const frame = makeBitmap();
    expect(cache.getFrame(0)).toBeUndefined();
    expect(cache.has(0)).toBe(false);
    cache.setFrame(0, frame);
    expect(cache.has(0)).toBe(true);
    expect(cache.getFrame(0)).toBe(frame);
    expect(cache.frameCount).toBe(1);
    expect(cache.byteEstimate).toBe(4 * 4 * 4);
  });

  it("closes the replaced bitmap exactly once on set-replace", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const first = makeBitmap();
    const second = makeBitmap();
    cache.setFrame(3, first);
    cache.setFrame(3, second);
    expect(first.closeCount).toBe(1);
    expect(second.closeCount).toBe(0);
    expect(cache.getFrame(3)).toBe(second);
    expect(cache.frameCount).toBe(1);
  });

  it("does not close a bitmap re-set to the same reference", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const frame = makeBitmap();
    cache.setFrame(1, frame);
    cache.setFrame(1, frame);
    expect(frame.closeCount).toBe(0);
    expect(cache.getFrame(1)).toBe(frame);
  });

  it("evicts frames farthest from the last access, keeping near frames and never the just-set frame", () => {
    const perFrameBytes = 10 * 10 * 4;
    const cache = new MotionFrameCache<MockBitmap>({ maxBytes: perFrameBytes * 3 });
    const frames = new Map<number, MockBitmap>();
    for (const index of [10, 11, 12]) {
      const bmp = makeBitmap(10, 10);
      frames.set(index, bmp);
      cache.setFrame(index, bmp);
    }
    cache.getFrame(12);
    const near = makeBitmap(10, 10);
    frames.set(13, near);
    cache.setFrame(13, near);

    expect(cache.has(13)).toBe(true);
    expect(cache.has(10)).toBe(false);
    expect(frames.get(10)?.closeCount).toBe(1);
    expect(frames.get(11)?.closeCount).toBe(0);
    expect(frames.get(12)?.closeCount).toBe(0);
    expect(near.closeCount).toBe(0);
    expect(cache.frameCount).toBe(3);
  });

  it("never evicts the just-set frame even when it alone exceeds budget", () => {
    const cache = new MotionFrameCache<MockBitmap>({ maxBytes: 1 });
    const frame = makeBitmap(10, 10);
    cache.setFrame(5, frame);
    expect(cache.has(5)).toBe(true);
    expect(frame.closeCount).toBe(0);
    expect(cache.frameCount).toBe(1);
  });

  it("merges cachedRanges into sorted inclusive runs", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    for (const index of [3, 1, 2, 8, 7]) {
      cache.setFrame(index, makeBitmap());
    }
    expect(cache.cachedRanges()).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 8 },
    ]);
  });

  it("returns empty cachedRanges when empty", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(cache.cachedRanges()).toEqual([]);
  });

  it("closes every bitmap exactly once on invalidateAll and resets state", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const a = makeBitmap();
    const b = makeBitmap();
    cache.setFrame(0, a);
    cache.setFrame(1, b);
    cache.invalidateAll();
    expect(a.closeCount).toBe(1);
    expect(b.closeCount).toBe(1);
    expect(cache.frameCount).toBe(0);
    expect(cache.byteEstimate).toBe(0);
    expect(cache.cachedRanges()).toEqual([]);
    expect(cache.has(0)).toBe(false);
  });

  it("closes every bitmap exactly once on dispose and is double-dispose safe", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const a = makeBitmap();
    cache.setFrame(0, a);
    cache.dispose();
    cache.dispose();
    expect(a.closeCount).toBe(1);
    expect(cache.frameCount).toBe(0);
  });

  it("does not double-close between invalidateAll and dispose", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    const a = makeBitmap();
    cache.setFrame(0, a);
    cache.invalidateAll();
    cache.dispose();
    expect(a.closeCount).toBe(1);
  });

  it("throws on fractional index", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(() => cache.setFrame(1.5, makeBitmap())).toThrow();
    expect(() => cache.getFrame(1.5)).toThrow();
    expect(() => cache.has(1.5)).toThrow();
  });

  it("throws on negative index", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(() => cache.setFrame(-1, makeBitmap())).toThrow();
    expect(() => cache.getFrame(-1)).toThrow();
    expect(() => cache.has(-1)).toThrow();
  });

  it("throws on non-finite index", () => {
    const cache = new MotionFrameCache<MockBitmap>();
    expect(() => cache.setFrame(Number.NaN, makeBitmap())).toThrow();
    expect(() => cache.getFrame(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("rejects a non-positive maxBytes", () => {
    expect(() => new MotionFrameCache<MockBitmap>({ maxBytes: 0 })).toThrow();
    expect(() => new MotionFrameCache<MockBitmap>({ maxBytes: -5 })).toThrow();
  });
});
