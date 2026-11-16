import { describe, expect, it, vi } from "vitest";
import { DroppedFrameCounter, PresentCadenceTracker, droppedFrameLevel, sharedDroppedFrames } from "./dropped-frame-counter";

describe("DroppedFrameCounter", () => {
  it("counts, notifies subscribers and unsubscribes", () => {
    const counter = new DroppedFrameCounter();
    const seen: number[] = [];
    const off = counter.subscribe((n) => seen.push(n));
    counter.increment();
    counter.increment(2);
    expect(counter.count).toBe(3);
    expect(seen).toEqual([1, 3]);
    off();
    counter.increment();
    expect(seen).toEqual([1, 3]);
  });

  it("ignores non-positive increments and silent resets", () => {
    const counter = new DroppedFrameCounter();
    const listener = vi.fn();
    counter.subscribe(listener);
    counter.increment(0);
    counter.increment(-1);
    counter.reset();
    expect(listener).not.toHaveBeenCalled();
    counter.increment();
    counter.reset();
    expect(counter.count).toBe(0);
    expect(listener).toHaveBeenLastCalledWith(0);
  });

  it("isolates a throwing listener", () => {
    const counter = new DroppedFrameCounter();
    const good = vi.fn();
    counter.subscribe(() => {
      throw new Error("boom");
    });
    counter.subscribe(good);
    expect(() => counter.increment()).not.toThrow();
    expect(good).toHaveBeenCalledWith(1);
  });

  it("maps count to indicator level", () => {
    expect(droppedFrameLevel(0)).toBe("ok");
    expect(droppedFrameLevel(1)).toBe("dropped");
  });
});

describe("PresentCadenceTracker", () => {
  const FRAME = 1000 / 30;
  it("counts nothing for on-time frames and never for the first frame of a run", () => {
    const counter = new DroppedFrameCounter();
    const t = new PresentCadenceTracker(counter, FRAME);
    expect(t.presented(1000)).toBe(0);
    for (let i = 1; i <= 30; i++) t.presented(1000 + i * FRAME + (i % 2 ? 4 : -4));
    expect(counter.count).toBe(0);
  });
  it("counts the frames missing between two late presents", () => {
    const counter = new DroppedFrameCounter();
    const t = new PresentCadenceTracker(counter, FRAME);
    t.presented(0);
    t.presented(FRAME);
    expect(t.presented(FRAME + 3 * FRAME)).toBe(2); // 3 frame durations apart: 2 never shown
    expect(counter.count).toBe(2);
  });
  it("scales the expected interval by the playback rate", () => {
    const counter = new DroppedFrameCounter();
    const t = new PresentCadenceTracker(counter, FRAME);
    t.presented(0, 2);
    t.presented(FRAME / 2, 2);
    expect(counter.count).toBe(0);
    t.presented(FRAME / 2 + FRAME, 2); // 2 expected intervals at 2x: one dropped
    expect(counter.count).toBe(1);
  });
  it("ignores long gaps (seek, pause) and restarts after begin()", () => {
    const counter = new DroppedFrameCounter();
    const t = new PresentCadenceTracker(counter, FRAME);
    t.presented(0);
    t.presented(5000);
    expect(counter.count).toBe(0);
    t.begin();
    t.presented(5100);
    t.presented(5100 + 4 * FRAME);
    expect(counter.count).toBe(3);
  });
  it("shares one counter between presenters", () => {
    sharedDroppedFrames.reset();
    const seen: number[] = [];
    const off = sharedDroppedFrames.subscribe((n) => seen.push(n));
    new PresentCadenceTracker(sharedDroppedFrames, FRAME).presented(0);
    sharedDroppedFrames.increment();
    off();
    expect(seen).toEqual([1]);
    sharedDroppedFrames.reset();
  });
});
