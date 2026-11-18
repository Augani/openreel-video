import { describe, expect, it, vi } from "vitest";
import { ScrubFrameCache, blobIdentity, scrubCacheSize, scrubFrameKey } from "./scrub-frame-cache";

const frame = (width = 10, height = 10) => ({ width, height, close: vi.fn() });

describe("ScrubFrameCache", () => {
  it("returns stored frames and refreshes recency", () => {
    const cache = new ScrubFrameCache<ReturnType<typeof frame>>(1000);
    const a = frame();
    cache.set("a", a);
    expect(cache.get("a")).toBe(a);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts least-recently-used frames over the byte budget and closes them", () => {
    const cache = new ScrubFrameCache<ReturnType<typeof frame>>(800); // two 400-byte frames
    const a = frame(), b = frame(), c = frame();
    cache.set("a", a);
    cache.set("b", b);
    cache.get("a"); // b is now the oldest
    cache.set("c", c);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
    expect(cache.byteLength).toBe(800);
  });

  it("closes a replaced frame and rejects frames larger than the budget", () => {
    const cache = new ScrubFrameCache<ReturnType<typeof frame>>(500);
    const a = frame(), a2 = frame(), huge = frame(100, 100);
    cache.set("a", a);
    cache.set("a", a2);
    expect(a.close).toHaveBeenCalledTimes(1);
    cache.set("huge", huge);
    expect(huge.close).toHaveBeenCalledTimes(1);
    expect(cache.get("huge")).toBeUndefined();
    cache.clear();
    expect(a2.close).toHaveBeenCalledTimes(1);
    expect(cache.byteLength).toBe(0);
  });
});

describe("ScrubFrameCache budget changes", () => {
  it("closes frames immediately when the budget shrinks to fit the device", () => {
    const cache = new ScrubFrameCache<ReturnType<typeof frame>>(1200);
    const frames = [frame(), frame(), frame()];
    frames.forEach((f, i) => cache.set(`f${i}`, f));
    cache.setMaxBytes(400);
    expect(frames[0].close).toHaveBeenCalledTimes(1);
    expect(frames[1].close).toHaveBeenCalledTimes(1);
    expect(frames[2].close).not.toHaveBeenCalled();
    expect(cache.maxBytes).toBe(400);
    expect(cache.byteLength).toBe(400);
  });
});

describe("scrub frame keys", () => {
  it("quantises to source frames and separates blobs", () => {
    const blobA = {}, blobB = {};
    expect(blobIdentity(blobA)).toBe(blobIdentity(blobA));
    expect(blobIdentity(blobA)).not.toBe(blobIdentity(blobB));
    expect(scrubFrameKey(1, 2.0, 30)).toBe(scrubFrameKey(1, 2.0 + 0.001, 30));
    expect(scrubFrameKey(1, 2.0, 30)).not.toBe(scrubFrameKey(1, 2.04, 30));
    expect(scrubFrameKey(1, 2, 30)).not.toBe(scrubFrameKey(2, 2, 30));
  });
});

describe("scrubCacheSize", () => {
  it("downscales wide frames keeping aspect and never upscales small ones", () => {
    expect(scrubCacheSize(3840, 2160)).toEqual({ width: 960, height: 540 });
    expect(scrubCacheSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(scrubCacheSize(960, 540)).toEqual({ width: 960, height: 540 });
  });
});
