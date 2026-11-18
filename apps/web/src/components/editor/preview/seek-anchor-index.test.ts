import { describe, expect, it, vi } from "vitest";
import { SeekAnchorIndex, type AnchorFrame } from "./seek-anchor-index";

const frame = (w = 10, h = 10): AnchorFrame & { close: ReturnType<typeof vi.fn> } => ({
  width: w,
  height: h,
  close: vi.fn(),
});

describe("SeekAnchorIndex", () => {
  it("returns the nearest anchor, preferring the earlier one on ties", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(1_000_000);
    index.add(1, 0, frame());
    index.add(1, 2, frame());
    index.add(1, 4, frame());
    expect(index.nearest(1, 2.9)?.time).toBe(2);
    expect(index.nearest(1, 3)?.time).toBe(2);
    expect(index.nearest(1, 3.1)?.time).toBe(4);
    expect(index.nearest(1, 99)?.time).toBe(4);
    expect(index.nearest(1, -5)?.time).toBe(0);
  });

  it("respects the maximum distance and unknown blobs", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(1_000_000);
    index.add(1, 0, frame());
    expect(index.nearest(1, 5, 2)).toBeNull();
    expect(index.nearest(2, 0)).toBeNull();
  });

  it("keeps anchors sorted regardless of insertion order and replaces duplicates", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(1_000_000);
    const first = frame();
    index.add(1, 4, frame());
    index.add(1, 0, first);
    index.add(1, 0, frame());
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(index.count(1)).toBe(2);
    expect(index.nearest(1, 1)?.time).toBe(0);
    expect(index.byteLength).toBe(2 * 400);
  });

  it("evicts the least recently used blob whole and closes its frames", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(1200);
    const a = frame();
    const b = frame();
    index.add(1, 0, a);
    index.add(1, 1, frame());
    index.add(2, 0, b);
    index.nearest(1, 0); // blob 1 is now the most recent
    index.add(3, 0, frame());
    expect(index.blobCount).toBe(2);
    expect(index.count(2)).toBe(0);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(index.byteLength).toBeLessThanOrEqual(1200);
  });

  it("trims the far end of a single blob that alone exceeds the budget", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(800);
    const frames = [frame(), frame(), frame()];
    frames.forEach((f, i) => index.add(1, i, f));
    expect(index.byteLength).toBeLessThanOrEqual(800);
    expect(index.count(1)).toBe(2);
    expect(frames[2].close).toHaveBeenCalledTimes(1);
  });

  it("closes everything on clear and rejects frames larger than the budget", () => {
    const index = new SeekAnchorIndex<AnchorFrame>(500);
    const big = frame(100, 100);
    index.add(1, 0, big);
    expect(big.close).toHaveBeenCalledTimes(1);
    const small = frame();
    index.add(1, 0, small);
    index.clear();
    expect(small.close).toHaveBeenCalledTimes(1);
    expect(index.byteLength).toBe(0);
    expect(index.blobCount).toBe(0);
  });
});
