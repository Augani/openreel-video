import { describe, expect, it } from "vitest";
import {
  analyzePlayback,
  budgetVerdict,
  cpuPctOfCore,
  latencyStats,
  median,
  percentile,
  sumCpuMs,
  summarizeImport,
} from "../scripts/perf-analysis.mjs";

describe("percentiles", () => {
  it("uses the harness convention", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(v, 0.95)).toBe(20);
    expect(percentile(v, 0.5)).toBe(11);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

describe("latencyStats", () => {
  it("reports p50, p95, max and keeps timeouts out of the percentiles", () => {
    const s = latencyStats([100, 200, 300, 400, 1000], 2);
    expect(s).toEqual({ n: 5, timeouts: 2, p50Ms: 300, p95Ms: 1000, maxMs: 1000 });
  });
  it("handles an all-timeout run", () => {
    expect(latencyStats([], 3)).toEqual({ n: 0, timeouts: 3, p50Ms: null, p95Ms: null, maxMs: null });
  });
});

describe("analyzePlayback", () => {
  it("counts the frames a perfect run would have shown but did not", () => {
    const r = analyzePlayback({ presentedFrames: 289, seconds: 10, sourceFps: 30, rafDeltas: [16, 30, 60, 16] });
    expect(r.expectedFrames).toBe(300);
    expect(r.droppedFrames).toBe(11);
    expect(r.droppedFramesPct).toBe(3.7);
    expect(r.effectiveFps).toBe(28.9);
    expect(r.rafOver25ms).toBe(2);
    expect(r.rafOver50ms).toBe(1);
  });
  it("never reports negative drops or an fps above the source rate", () => {
    const r = analyzePlayback({ presentedFrames: 320, seconds: 10, sourceFps: 30 });
    expect(r.droppedFrames).toBe(0);
    expect(r.droppedFramesPct).toBe(0);
    expect(r.effectiveFps).toBe(30);
  });
  it("is null-safe for an empty run", () => {
    const r = analyzePlayback({ presentedFrames: 0, seconds: 0, sourceFps: 30 });
    expect(r.droppedFramesPct).toBeNull();
    expect(r.effectiveFps).toBeNull();
  });
});

describe("cpu helpers", () => {
  it("sums process CPU seconds into ms and converts to a core percentage", () => {
    const total = sumCpuMs([{ cpu: { cumulativeCPUUsage: 1.5 } }, { cpu: { cumulativeCPUUsage: 0.5 } }, {}]);
    expect(total).toBe(2000);
    expect(cpuPctOfCore(1000, 1700, 10000)).toBe(7);
    expect(cpuPctOfCore(1000, 900, 10000)).toBe(0);
    expect(cpuPctOfCore(0, 100, 0)).toBeNull();
  });
});

describe("summarizeImport", () => {
  it("reports first/last thumbnail, per-clip and CPU per clip", () => {
    const s = summarizeImport({ readyAtMs: [400, 900, 1600, 2000], cpuMs: 4000 });
    expect(s).toEqual({ clips: 4, firstThumbnailMs: 400, allThumbnailsMs: 2000, perClipThumbnailMs: 500, cpuMs: 4000, cpuMsPerClip: 1000 });
  });
  it("copes with nothing imported", () => {
    expect(summarizeImport({ readyAtMs: [], cpuMs: 0 }).allThumbnailsMs).toBeNull();
  });
});

describe("budgetVerdict", () => {
  const base = { failed: 0, notJudged: 0, judged: 12, loadText: "load 1.4", maxLoad: 2.5, requireWall: false };
  it("says WALL-CLOCK NOT VERIFIED on the last line when wall budgets were skipped, and exits 0 without --require-wall", () => {
    const v = budgetVerdict({ ...base, notJudged: 9, loadText: "load 30.0" });
    expect(v.lines[v.lines.length - 1]).toMatch(/^WALL-CLOCK NOT VERIFIED/);
    expect(v.lines[v.lines.length - 1]).not.toMatch(/exit 3/);
    expect(v.exitCode).toBe(0);
  });
  it("exits 3 under --require-wall and mentions it", () => {
    const v = budgetVerdict({ ...base, notJudged: 9, requireWall: true });
    expect(v.lines[v.lines.length - 1]).toMatch(/WALL-CLOCK NOT VERIFIED.*exit 3/);
    expect(v.exitCode).toBe(3);
  });
  it("a failed budget wins (exit 1) but the not-verified line is still last", () => {
    const v = budgetVerdict({ ...base, failed: 2, notJudged: 3, requireWall: true });
    expect(v.exitCode).toBe(1);
    expect(v.lines[0]).toBe("2 budget(s) exceeded");
    expect(v.lines[v.lines.length - 1]).toMatch(/^WALL-CLOCK NOT VERIFIED/);
  });
  it("never ends with VERIFIED when a budget failed, even with nothing skipped", () => {
    const v = budgetVerdict({ ...base, failed: 2 });
    expect(v.exitCode).toBe(1);
    expect(v.lines[v.lines.length - 1]).toMatch(/^BUDGET CHECK FAILED: 2/);
    expect(v.lines[v.lines.length - 1]).not.toMatch(/VERIFIED/);
  });
  it("only claims full verification when every wall budget was judged", () => {
    const v = budgetVerdict(base);
    expect(v.lines[v.lines.length - 1]).toMatch(/^ALL BUDGETS VERIFIED, including wall-clock/);
    expect(v.lines.join("\n")).not.toMatch(/NOT VERIFIED/);
    expect(v.exitCode).toBe(0);
  });
});
