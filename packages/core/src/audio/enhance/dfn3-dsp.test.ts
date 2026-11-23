import { describe, expect, it } from "vitest";
import {
  DFN3_BINS,
  DFN3_DF_BINS,
  DFN3_DF_ORDER,
  DFN3_ERB_BANDS,
  DFN3_FFT_SIZE,
  DFN3_HOP,
  DFN3_LOOKAHEAD,
  EnhanceCancelledError,
  dfn3ErbWidths,
  dfn3Window,
  enhanceMono48k,
  type Dfn3Inference,
  type Dfn3Outputs,
} from "./dfn3-dsp";

/** A network stand-in: mask `maskFor(row)` everywhere, deep filter = pass the current frame (tap 2) straight through. */
const fakeNetwork = (maskFor: (row: number) => number = () => 1, calls: Array<{ frames: number; erbRows: Float32Array }> = []): Dfn3Inference => async (erb, spec, frames) => {
  calls.push({ frames, erbRows: erb });
  expect(erb).toHaveLength(frames * DFN3_ERB_BANDS);
  expect(spec).toHaveLength(2 * frames * DFN3_DF_BINS);
  const mask = new Float32Array(frames * DFN3_ERB_BANDS);
  const coefs = new Float32Array(frames * DFN3_DF_BINS * DFN3_DF_ORDER * 2);
  for (let r = 0; r < frames; r += 1) {
    mask.fill(maskFor(r), r * DFN3_ERB_BANDS, (r + 1) * DFN3_ERB_BANDS);
    for (let f = 0; f < DFN3_DF_BINS; f += 1) coefs[((r * DFN3_DF_BINS + f) * DFN3_DF_ORDER + DFN3_LOOKAHEAD) * 2] = 1;
  }
  return { mask, coefs } satisfies Dfn3Outputs;
};

const noise = (n: number, seed = 1) => {
  let s = seed;
  return Float32Array.from({ length: n }, () => (((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5) * 0.6);
};

describe("DeepFilterNet3 framing", () => {
  it("builds the reference ERB layout: 32 bands covering all 481 bins, each at least 2 wide, widening upwards", () => {
    const widths = dfn3ErbWidths();
    expect(widths).toHaveLength(DFN3_ERB_BANDS);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(DFN3_BINS);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(2);
    expect(widths.slice(0, 4)).toEqual([2, 2, 2, 2]);
    expect(widths[31]).toBeGreaterThan(widths[10]);
    // The 96 deep-filter bins (up to 4.8 kHz) end on a band boundary region, i.e. well inside the band list.
    let acc = 0;
    let bands = 0;
    for (const w of widths) {
      acc += w;
      bands += 1;
      if (acc >= DFN3_DF_BINS) break;
    }
    expect(bands).toBeGreaterThan(15);
    expect(bands).toBeLessThan(26);
  });

  it("uses a power-complementary window so overlap-add is exact", () => {
    const w = dfn3Window();
    for (let i = 0; i < DFN3_HOP; i += 1) expect(w[i] ** 2 + w[i + DFN3_HOP] ** 2).toBeCloseTo(1, 12);
  });

  for (const length of [1, 479, 480, 481, 4801, 24000 + 123]) {
    it(`passes a signal through unchanged with an identity network at length ${length} (framing, 10 ms latency and look-ahead aligned)`, async () => {
      const x = noise(length);
      const y = await enhanceMono48k(x, { infer: fakeNetwork() });
      expect(y).toHaveLength(length);
      let worst = 0;
      for (let i = 0; i < length; i += 1) worst = Math.max(worst, Math.abs(y[i] - x[i]));
      expect(worst).toBeLessThan(2e-5);
    });
  }

  it("returns an empty array for empty input without calling the network", async () => {
    let called = false;
    const y = await enhanceMono48k(new Float32Array(0), { infer: async (e, s, f) => { called = true; return fakeNetwork()(e, s, f); } });
    expect(y).toHaveLength(0);
    expect(called).toBe(false);
  });

  it("applies the network output at feature row j to frame j - 2 (look-ahead alignment)", async () => {
    // A 10 kHz tone sits above the deep-filter bins, so only the ERB mask shapes it. Pass exactly one feature row.
    const n = 48000;
    const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 10000 * i) / 48000) * Math.sin((Math.PI * i) / n) ** 2);
    const frame = 50;
    const y = await enhanceMono48k(x, { infer: fakeNetwork((row) => (row === frame + DFN3_LOOKAHEAD ? 1 : 0)) });
    // Frame t spans samples [(t-1)*480, (t+1)*480): only that stretch can be non-zero.
    const from = (frame - 1) * DFN3_HOP;
    const to = (frame + 1) * DFN3_HOP;
    let inside = 0;
    let outside = 0;
    for (let i = 0; i < n; i += 1) {
      if (i >= from && i < to) inside = Math.max(inside, Math.abs(y[i]));
      else outside = Math.max(outside, Math.abs(y[i]));
    }
    expect(inside).toBeGreaterThan(0.4); // the tone's envelope peaks mid-signal, where this frame sits
    expect(outside).toBeLessThan(1e-6);
  });

  it("feeds the network segments with look-ahead and warm-up rows, and the result does not depend on the segmentation", async () => {
    const x = noise(48000 * 2, 7);
    const calls: Array<{ frames: number; erbRows: Float32Array }> = [];
    const small = await enhanceMono48k(x, { infer: fakeNetwork(() => 1, calls), segmentFrames: 60, prerollFrames: 12 });
    const big = await enhanceMono48k(x, { infer: fakeNetwork(), segmentFrames: 1000, prerollFrames: 150 });
    expect(Array.from(small)).toEqual(Array.from(big));
    const totalFrames = Math.ceil(x.length / DFN3_HOP) + 1;
    expect(calls).toHaveLength(Math.ceil(totalFrames / 60));
    // First segment starts at row 0 (no warm-up before the start); later ones carry 12 warm-up rows + the 2 look-ahead rows.
    expect(calls[0].frames).toBe(60 + DFN3_LOOKAHEAD);
    expect(calls[1].frames).toBe(12 + 60);
  });

  it("is deterministic and reports monotonic progress ending at 1", async () => {
    const x = noise(48000);
    const progress: number[] = [];
    const a = await enhanceMono48k(x, { infer: fakeNetwork(), segmentFrames: 30, onProgress: (f) => progress.push(f) });
    const b = await enhanceMono48k(x, { infer: fakeNetwork(), segmentFrames: 30 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(progress.length).toBeGreaterThan(2);
    expect(progress).toEqual([...progress].sort((p, q) => p - q));
    expect(progress[progress.length - 1]).toBeCloseTo(1, 10);
  });

  it("stops with a cancellation error when aborted between segments", async () => {
    const x = noise(48000 * 3);
    const signal = { aborted: false };
    let calls = 0;
    const infer: Dfn3Inference = async (e, s, f) => {
      calls += 1;
      if (calls === 2) signal.aborted = true;
      return fakeNetwork()(e, s, f);
    };
    await expect(enhanceMono48k(x, { infer, signal, segmentFrames: 50 })).rejects.toBeInstanceOf(EnhanceCancelledError);
    expect(calls).toBe(2);
  });

  it("uses an FFT frame of 960 samples at hop 480", () => {
    expect(DFN3_FFT_SIZE).toBe(960);
    expect(DFN3_HOP).toBe(480);
    expect(DFN3_BINS).toBe(481);
  });
});
