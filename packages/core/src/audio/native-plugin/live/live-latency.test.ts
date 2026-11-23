import { describe, expect, it } from "vitest";
import { MAX_PREFILL_BLOCKS, chainPluginLatencyFrames, compensationSeconds, isLiveBlockSize, liveInsertLatencyFrames, liveLatencyReport, percentile, prefillBlocksForRoundTrip } from "./live-latency";

describe("live latency maths", () => {
  it("adds plugin latencies of a chain and ignores garbage", () => {
    expect(chainPluginLatencyFrames([64, 128.4, -5, Number.NaN, Number.POSITIVE_INFINITY])).toBe(192);
    expect(chainPluginLatencyFrames([])).toBe(0);
  });

  it("D = J * B + L", () => {
    expect(liveInsertLatencyFrames(256, 3, 100)).toBe(868);
    expect(liveInsertLatencyFrames(128, 2, 0)).toBe(256);
    expect(liveInsertLatencyFrames(128, -1, -9)).toBe(0);
  });

  it("sizes the jitter buffer from a measured round trip, never below the minimum transport time", () => {
    // 256 frames at 48 kHz = 5.33 ms. A 1 ms round trip needs ceil(0.19) + 1 + 1 headroom = 3 blocks, but 20 ms needs 4.
    expect(prefillBlocksForRoundTrip(1, 256, 48000)).toBe(4);
    // 128 frames = 2.67 ms: 20 ms is 8 blocks; 512 frames = 10.67 ms: 2 blocks
    expect(prefillBlocksForRoundTrip(0.2, 128, 48000)).toBe(8);
    expect(prefillBlocksForRoundTrip(0.2, 512, 48000)).toBe(3); // the measured rule (ceil + 1 + 1 headroom) is above the floor here
    // a slow pipe beats the floor: 40 ms at 256 frames = ceil(7.5) + 1 + 1 = 10
    expect(prefillBlocksForRoundTrip(40, 256, 48000)).toBe(10);
    // without the floor the old rule shows through
    expect(prefillBlocksForRoundTrip(1, 256, 48000, 1, 0)).toBe(3);
    expect(prefillBlocksForRoundTrip(0, 512, 48000, 0, 0)).toBe(2);
    expect(prefillBlocksForRoundTrip(10_000, 128, 48000)).toBe(MAX_PREFILL_BLOCKS);
  });

  it("reports the whole insert in frames and milliseconds", () => {
    const report = liveLatencyReport(256, 3, 480, 48000);
    expect(report).toMatchObject({ transportFrames: 768, totalFrames: 1248 });
    expect(report.totalMilliseconds).toBeCloseTo(26, 6);
  });

  it("computes the delay every shorter path needs", () => {
    expect(compensationSeconds(0.01, 0.026)).toBeCloseTo(0.016, 9);
    expect(compensationSeconds(0.03, 0.026)).toBe(0);
  });

  it("percentile uses nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("accepts only the supported block sizes", () => {
    expect([128, 256, 512].every(isLiveBlockSize)).toBe(true);
    expect(isLiveBlockSize(64)).toBe(false);
  });
});
