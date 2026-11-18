import { describe, it, expect } from "vitest";
import {
  getRecommendedWorkerCount,
  computeCacheBudget,
} from "./device-capabilities";

const GB = 1024 ** 3;

describe("getRecommendedWorkerCount", () => {
  it("caps web at 4 workers", () => {
    expect(getRecommendedWorkerCount("decode", 16, false)).toBe(4);
  });
  it("scales desktop with cores between 4 and 8", () => {
    expect(getRecommendedWorkerCount("decode", 12, true)).toBe(6);
    expect(getRecommendedWorkerCount("decode", 64, true)).toBe(8);
  });
});

describe("computeCacheBudget", () => {
  it("keeps web at 500 MB / 100 frames", () => {
    expect(computeCacheBudget(32 * GB, false)).toEqual({
      maxSizeBytes: 500 * 1024 * 1024,
      maxFrames: 100,
    });
  });
  it("caps desktop at 2 GB and never exceeds 15% of RAM on tiny machines", () => {
    expect(computeCacheBudget(128 * GB, true).maxSizeBytes).toBe(2 * GB);
    // Tiny machines never exceed 15% of RAM, even below the 500 MB floor.
    expect(computeCacheBudget(2 * GB, true).maxSizeBytes).toBeLessThanOrEqual(0.15 * 2 * GB);
  });
  it("subtracts used heap but never below the floor", () => {
    const b = computeCacheBudget(16 * GB, true, 1 * GB);
    expect(b.maxSizeBytes).toBeLessThan(computeCacheBudget(16 * GB, true).maxSizeBytes);
    expect(computeCacheBudget(8 * GB, true, 8 * GB).maxSizeBytes).toBe(500 * 1024 * 1024);
  });
});
