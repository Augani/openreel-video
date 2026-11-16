import { describe, expect, it, vi } from "vitest";
import { ByteBudgetCache } from "./byte-budget-cache";

interface Frame {
  readonly id: string;
  readonly bytes: number;
  close(): void;
}

const frame = (id: string, bytes: number): Frame => ({ id, bytes, close: vi.fn() });
const make = (budget: number, pinned: Set<string> = new Set()) =>
  new ByteBudgetCache<string, Frame>(budget, {
    sizeOf: (f) => f.bytes,
    dispose: (f) => f.close(),
    isPinned: (key) => pinned.has(key),
  });

describe("ByteBudgetCache", () => {
  it("accounts bytes, not entries: one big frame evicts many small ones", () => {
    const cache = make(1000);
    const small = Array.from({ length: 5 }, (_, i) => frame(`s${i}`, 100));
    small.forEach((f) => cache.set(f.id, f));
    expect(cache.byteLength).toBe(500);
    const big = frame("big", 700);
    cache.set("big", big);
    expect(cache.byteLength).toBeLessThanOrEqual(1000);
    // 500 + 700 = 1200 -> the two least recently used small frames go, the rest stay.
    expect(small[0].close).toHaveBeenCalledTimes(1);
    expect(small[1].close).toHaveBeenCalledTimes(1);
    expect(small[2].close).not.toHaveBeenCalled();
    expect(cache.size).toBe(4);
    expect(cache.byteLength).toBe(1000);
  });

  it("evicts least recently used first and get() refreshes recency", () => {
    const cache = make(300);
    const a = frame("a", 100), b = frame("b", 100), c = frame("c", 100), d = frame("d", 100);
    cache.set("a", a);
    cache.set("b", b);
    cache.set("c", c);
    cache.get("a");
    cache.set("d", d);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect([...cache.keys()]).toEqual(["c", "a", "d"]);
  });

  it("peek() does not refresh recency", () => {
    const cache = make(200);
    const a = frame("a", 100), b = frame("b", 100), c = frame("c", 100);
    cache.set("a", a);
    cache.set("b", b);
    expect(cache.peek("a")).toBe(a);
    cache.set("c", c);
    expect(a.close).toHaveBeenCalledTimes(1);
  });

  it("closes an oversized value immediately and never stores it", () => {
    const cache = make(100);
    const huge = frame("huge", 101);
    expect(cache.set("huge", huge)).toBe(false);
    expect(huge.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });

  it("an oversized replacement leaves the existing entry alone", () => {
    const cache = make(100);
    const a = frame("a", 50);
    cache.set("a", a);
    const huge = frame("a", 200);
    expect(cache.set("a", huge)).toBe(false);
    expect(huge.close).toHaveBeenCalledTimes(1);
    expect(a.close).not.toHaveBeenCalled();
    expect(cache.peek("a")).toBe(a);
  });

  it("closes the replaced value and keeps the byte total exact", () => {
    const cache = make(1000);
    const a = frame("a", 400), a2 = frame("a", 100);
    cache.set("a", a);
    cache.set("a", a2);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(cache.byteLength).toBe(100);
    // Re-setting the same object is a recency refresh, not a close.
    cache.set("a", a2);
    expect(a2.close).not.toHaveBeenCalled();
    expect(cache.byteLength).toBe(100);
  });

  it("scales with frame size: the same budget holds 4x fewer 4K frames than 1080p frames", () => {
    const frameBytes = (w: number, h: number) => w * h * 4;
    const budget = 256 * 1024 * 1024;
    const hd = make(budget);
    const uhd = make(budget);
    for (let i = 0; i < 100; i++) hd.set(`h${i}`, frame(`h${i}`, frameBytes(1920, 1080)));
    for (let i = 0; i < 100; i++) uhd.set(`u${i}`, frame(`u${i}`, frameBytes(3840, 2160)));
    expect(hd.byteLength).toBeLessThanOrEqual(budget);
    expect(uhd.byteLength).toBeLessThanOrEqual(budget);
    expect(hd.size).toBe(Math.floor(budget / frameBytes(1920, 1080)));
    expect(uhd.size).toBe(Math.floor(budget / frameBytes(3840, 2160)));
    expect(hd.size).toBe(uhd.size * 4);
  });

  it("never evicts pinned entries, and stays over budget rather than dropping them", () => {
    const pinned = new Set(["a"]);
    const cache = make(200, pinned);
    const a = frame("a", 150), b = frame("b", 100), c = frame("c", 100);
    cache.set("a", a);
    cache.set("b", b);
    expect(b.close).not.toHaveBeenCalled(); // 250 > 200 but only b is evictable and it is the newest
    cache.set("c", c);
    expect(a.close).not.toHaveBeenCalled();
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(cache.peek("a")).toBe(a);
    // Unpinning lets the next trim reclaim it.
    pinned.delete("a");
    cache.setBudget(100);
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(cache.byteLength).toBe(100);
  });

  it("setBudget evicts immediately when the budget shrinks and not when it grows", () => {
    const cache = make(400);
    const frames = ["a", "b", "c", "d"].map((id) => frame(id, 100));
    frames.forEach((f) => cache.set(f.id, f));
    cache.setBudget(800);
    expect(cache.size).toBe(4);
    cache.setBudget(250);
    expect(cache.size).toBe(2);
    expect(frames[0].close).toHaveBeenCalledTimes(1);
    expect(frames[1].close).toHaveBeenCalledTimes(1);
    expect(frames[3].close).not.toHaveBeenCalled();
    expect(cache.maxBytes).toBe(250);
  });

  it("delete and clear close every value exactly once", () => {
    const cache = make(1000);
    const a = frame("a", 10), b = frame("b", 10), c = frame("c", 10);
    cache.set("a", a);
    cache.set("b", b);
    cache.set("c", c);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("a")).toBe(false);
    cache.clear();
    for (const f of [a, b, c]) expect(f.close).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });

  it("reports why an entry left through dispose", () => {
    const reasons: string[] = [];
    const cache = new ByteBudgetCache<string, Frame>(100, {
      sizeOf: (f) => f.bytes,
      dispose: (_f, _k, reason) => reasons.push(reason),
    });
    cache.set("a", frame("a", 60));
    cache.set("b", frame("b", 60)); // evicts a
    cache.set("b", frame("b", 10)); // replaces b
    cache.set("big", frame("big", 500)); // rejected
    cache.delete("b");
    cache.set("c", frame("c", 10));
    cache.clear();
    expect(reasons).toEqual(["evicted", "replaced", "rejected", "deleted", "cleared"]);
  });

  it("admits an oversized entry when it is pinned, and trims it once unpinned", () => {
    const pinned = new Set<string>(["big"]);
    const dispose = vi.fn();
    const cache = new ByteBudgetCache<string, { n: number }>(100, {
      sizeOf: (v) => v.n,
      dispose,
      isPinned: (k) => pinned.has(k),
    });
    expect(cache.set("big", { n: 250 })).toBe(true);
    expect(cache.get("big")).toBeDefined();
    expect(cache.set("small", { n: 10 })).toBe(true);
    expect(cache.has("big")).toBe(true);
    pinned.clear();
    cache.setBudget(100);
    expect(cache.has("big")).toBe(false);
    expect(dispose).toHaveBeenCalledWith({ n: 250 }, "big", "evicted");
  });
});
