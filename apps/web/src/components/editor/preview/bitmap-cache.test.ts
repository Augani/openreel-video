import { describe, expect, it, vi } from "vitest";
import { bitmapCacheBudget, createBitmapCache } from "./bitmap-cache";

const MB = 1024 * 1024;
const bitmap = (w: number, h: number) => ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap;

describe("preview bitmap cache", () => {
  it("never budgets below the 192 MB floor and follows the shared image budget above it", () => {
    expect(bitmapCacheBudget(0.2, 100 * MB)).toBe(192 * MB);
    expect(bitmapCacheBudget(0.5, 600 * MB)).toBe(300 * MB);
  });

  it("closes bitmaps that are evicted, replaced or cleared, so decoded stills do not pile up", () => {
    const cache = createBitmapCache(0.4);
    cache.setBudget(3840 * 2160 * 4 * 2 + 1);
    const [a, b, c] = [bitmap(3840, 2160), bitmap(3840, 2160), bitmap(3840, 2160)];
    cache.set("a", a);
    cache.set("b", b);
    cache.set("c", c);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(cache.has("a")).toBe(false);
    expect(cache.byteLength).toBe(3840 * 2160 * 4 * 2);
    cache.clear();
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(c.close).toHaveBeenCalledTimes(1);
    expect(cache.byteLength).toBe(0);
  });

  it("does not close a bitmap larger than the whole budget, its caller is about to draw it", () => {
    const cache = createBitmapCache(0.4);
    cache.setBudget(MB);
    const huge = bitmap(8192, 8192);
    expect(cache.set("huge", huge)).toBe(false);
    expect(huge.close).not.toHaveBeenCalled();
    expect(cache.has("huge")).toBe(false);
  });
});
