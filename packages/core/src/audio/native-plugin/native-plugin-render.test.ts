import { describe, expect, it } from "vitest";
import {
  NATIVE_PLUGIN_BLOCK_FRAMES,
  NATIVE_PLUGIN_MAX_LATENCY_SECONDS,
  blockParameterValues,
  changedParameterValues,
  compensateLatency,
  evaluateLane,
  packBlock,
  planNativeRender,
  sanitizeLatencySamples,
  unpackBlock,
} from "./native-plugin-render";

describe("latency compensation math", () => {
  it("feeds input plus latency flush and drops exactly the latency from the head", () => {
    expect(planNativeRender(1000, 0)).toEqual({ totalFrames: 1000, trimFrames: 0, keepFrames: 1000, blocks: 2 });
    expect(planNativeRender(1000, 256)).toEqual({ totalFrames: 1256, trimFrames: 256, keepFrames: 1000, blocks: 3 });
    expect(planNativeRender(0, 256)).toMatchObject({ totalFrames: 256, keepFrames: 0 });
    expect(planNativeRender(10, 0, 4).blocks).toBe(3);
  });

  it("aligns the output of a plugin that delays by L samples, for L inside, at and beyond a block", () => {
    for (const latency of [0, 1, 37, 511, 512, 513, 1500]) {
      const input = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.05) + (i === 700 ? 3 : 0));
      const plan = planNativeRender(input.length, latency);
      // A plugin whose output is the input delayed by `latency` frames (what lookahead limiters do), run block by block.
      const raw = new Float32Array(plan.totalFrames);
      for (let start = 0; start < plan.totalFrames; start += NATIVE_PLUGIN_BLOCK_FRAMES) {
        const frames = Math.min(NATIVE_PLUGIN_BLOCK_FRAMES, plan.totalFrames - start);
        const block = packBlock([input], start, frames);
        for (let i = 0; i < frames; i += 1) raw[start + i] = start + i - latency >= 0 ? (start + i - latency < input.length ? input[start + i - latency] : 0) : 0;
        expect(block.length).toBe(frames);
      }
      const aligned = compensateLatency(raw, plan);
      expect(aligned.length).toBe(input.length);
      expect(Array.from(aligned)).toEqual(Array.from(input));
      expect(aligned[700]).toBe(input[700]);
    }
  });

  it("pads the last block with silence and unpacks planar blocks back into channels", () => {
    const left = Float32Array.from([1, 2, 3]);
    const right = Float32Array.from([4, 5, 6]);
    const block = packBlock([left, right], 1, 4);
    expect(Array.from(block)).toEqual([2, 3, 0, 0, 5, 6, 0, 0]);
    const out = [new Float32Array(3), new Float32Array(3)];
    unpackBlock(Float32Array.from([9, 8, 7, 6]), 2, 2, out, 1);
    expect(Array.from(out[0])).toEqual([0, 9, 8]);
    expect(Array.from(out[1])).toEqual([0, 7, 6]);
  });

  it("sanitizes absurd latency reports", () => {
    expect(sanitizeLatencySamples(256.4, 48000)).toBe(256);
    expect(sanitizeLatencySamples(-5, 48000)).toBe(0);
    expect(sanitizeLatencySamples(Number.NaN, 48000)).toBe(0);
    expect(sanitizeLatencySamples(1e9, 48000)).toBe(NATIVE_PLUGIN_MAX_LATENCY_SECONDS * 48000);
  });
});

describe("parameter lanes", () => {
  const lane = [[1, 0], [3, 10]] as const;

  it("is linear between breakpoints and held outside them", () => {
    expect(evaluateLane(lane, 0)).toBe(0);
    expect(evaluateLane(lane, 1)).toBe(0);
    expect(evaluateLane(lane, 2)).toBe(5);
    expect(evaluateLane(lane, 3)).toBe(10);
    expect(evaluateLane(lane, 99)).toBe(10);
    expect(evaluateLane([], 1)).toBeUndefined();
  });

  it("jumps at coincident breakpoints and binary-searches long lanes", () => {
    expect(evaluateLane([[1, 0], [1, 4], [2, 4]], 1.0000001)).toBeCloseTo(4, 5);
    const long = Array.from({ length: 1000 }, (_, i): [number, number] => [i, i * 2]);
    expect(evaluateLane(long, 500.5)).toBeCloseTo(1001, 9);
  });

  it("overrides base values only for the lanes and reads them at the block start time", () => {
    const base = { a: 1, b: 2 };
    expect(blockParameterValues(base, { a: lane }, 48000, 48000)).toEqual({ a: 0, b: 2 });
    expect(blockParameterValues(base, { a: lane }, 96000, 48000)).toEqual({ a: 5, b: 2 });
    expect(blockParameterValues(base, {}, 0, 48000)).toEqual(base);
  });

  it("reports only the changed parameters", () => {
    const held: Record<string, number> = {};
    expect(changedParameterValues({ a: 1, b: 2 }, held)).toEqual({ a: 1, b: 2 });
    expect(changedParameterValues({ a: 1, b: 3 }, held)).toEqual({ b: 3 });
    expect(changedParameterValues({ a: 1, b: 3 }, held)).toEqual({});
  });
});
