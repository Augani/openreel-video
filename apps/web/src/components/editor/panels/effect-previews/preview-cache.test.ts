import { describe, expect, it, vi } from "vitest";
import { CostLruCache } from "./preview-cache";

describe("CostLruCache", () => {
  it("evicts the least recently used entries once the cost budget is exceeded", () => {
    const evicted: string[] = [];
    const cache = new CostLruCache<string, string>(100, (_, key) => evicted.push(key));
    cache.set("a", "A", 40);
    cache.set("b", "B", 40);
    cache.get("a"); // a is now newer than b
    cache.set("c", "C", 40); // 120 > 100: evict b
    expect(evicted).toEqual(["b"]);
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.cost).toBe(80);
  });

  it("peek does not refresh recency", () => {
    const cache = new CostLruCache<string, string>(80);
    cache.set("a", "A", 40);
    cache.set("b", "B", 40);
    cache.peek("a");
    cache.set("c", "C", 40);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
  });

  it("keeps bounded memory under a long stream of inserts", () => {
    const onEvict = vi.fn();
    const cache = new CostLruCache<number, number>(1_000, onEvict);
    for (let i = 0; i < 500; i++) cache.set(i, i, 100);
    expect(cache.cost).toBeLessThanOrEqual(1_000);
    expect(cache.size).toBe(10);
    expect(onEvict).toHaveBeenCalledTimes(490);
  });

  it("replacing a key releases the old value and clear releases everything", () => {
    const onEvict = vi.fn();
    const cache = new CostLruCache<string, string>(100, onEvict);
    cache.set("a", "one", 10);
    cache.set("a", "two", 20);
    expect(onEvict).toHaveBeenCalledWith("one", "a");
    expect(cache.cost).toBe(20);
    cache.clear();
    expect(onEvict).toHaveBeenCalledWith("two", "a");
    expect(cache.size).toBe(0);
    expect(cache.cost).toBe(0);
  });

  it("never evicts the only entry even when it alone is over budget", () => {
    const cache = new CostLruCache<string, string>(10);
    cache.set("big", "x", 50);
    expect(cache.has("big")).toBe(true);
  });
});
