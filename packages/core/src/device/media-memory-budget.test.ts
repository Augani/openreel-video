import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeMediaMemoryBudget,
  getMediaMemoryBudget,
  setMediaMemoryBudgetFromSystemMemory,
  subscribeMediaMemoryBudget,
} from "./media-memory-budget";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe("computeMediaMemoryBudget", () => {
  it("scales with system memory and never exceeds the total", () => {
    const small = computeMediaMemoryBudget(4 * GB);
    const big = computeMediaMemoryBudget(16 * GB);
    expect(big.totalBytes).toBeGreaterThan(small.totalBytes);
    for (const b of [small, big]) {
      expect(b.audioBufferBytes + b.videoFrameBytes + b.scrubFrameBytes + b.imageBitmapBytes + b.seekAnchorBytes).toBeLessThanOrEqual(b.totalBytes);
    }
  });

  it("clamps: a 1 GB device still gets a usable cache, a 256 GB workstation does not hoard", () => {
    expect(computeMediaMemoryBudget(1 * GB).totalBytes).toBe(384 * MB);
    expect(computeMediaMemoryBudget(256 * GB).totalBytes).toBe(2 * GB);
  });

  it("falls back to a 4 GB assumption when memory is unknown", () => {
    expect(computeMediaMemoryBudget(null)).toEqual(computeMediaMemoryBudget(4 * GB));
    expect(computeMediaMemoryBudget(0)).toEqual(computeMediaMemoryBudget(4 * GB));
  });

  it("keeps the 16 GB total well under 3 GB with room for the editor itself", () => {
    expect(computeMediaMemoryBudget(16 * GB).totalBytes).toBeLessThan(2 * GB);
  });
});

describe("seek anchor budget", () => {
  it("scales with the total but never exceeds the 48 MB anchors were sized for", () => {
    expect(computeMediaMemoryBudget(1 * GB).seekAnchorBytes).toBeLessThan(computeMediaMemoryBudget(8 * GB).seekAnchorBytes);
    expect(computeMediaMemoryBudget(256 * GB).seekAnchorBytes).toBe(48 * MB);
  });
});

describe("media memory budget store", () => {
  afterEach(() => {
    setMediaMemoryBudgetFromSystemMemory(null);
  });

  it("notifies subscribers when the budget is refined and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribeMediaMemoryBudget(listener);
    const next = setMediaMemoryBudgetFromSystemMemory(32 * GB);
    expect(listener).toHaveBeenCalledWith(next);
    expect(getMediaMemoryBudget()).toEqual(next);
    off();
    setMediaMemoryBudgetFromSystemMemory(8 * GB);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
