import { describe, expect, it } from "vitest";
import { LiveInsertDsp } from "./live-insert-dsp";

const SR = 48000;
const QUANTUM = 128;

/** A stand-in for the plugin host: scales the block by `gain` and delays the stream by `latency` frames, answering `answerQuanta` quanta later. */
function harness(options: { blockFrames?: number; prefill?: number; latency?: number; gain?: number; answerQuanta?: (seq: number) => number | null; fade?: number }) {
  const B = options.blockFrames ?? 256;
  const J = options.prefill ?? 3;
  const L = options.latency ?? 0;
  const gain = options.gain ?? 0.5;
  const pending: Array<{ due: number; epoch: number; seq: number; data: Float32Array }> = [];
  let quantum = 0;
  const dsp: LiveInsertDsp = new LiveInsertDsp({
    channels: 2,
    blockFrames: B,
    prefillBlocks: J,
    pluginLatencyFrames: L,
    fadeFrames: options.fade,
    onBlock: (epoch, seq, planar) => {
      const out = planar.map((v) => v * gain);
      const delay = options.answerQuanta ? options.answerQuanta(seq) : 1;
      if (delay === null) return;
      pending.push({ due: quantum + delay, epoch, seq, data: L === 0 ? out : delayed(out, seq, L, B, streamState) });
    },
  });
  const streamState: Record<number, Float32Array> = {};
  function run(input: (n: number, c: number) => number, frames: number): { out: Float32Array[] } {
    const out = [new Float32Array(frames), new Float32Array(frames)];
    for (let start = 0; start < frames; start += QUANTUM) {
      const q = Math.min(QUANTUM, frames - start);
      const inBuf = [0, 1].map((c) => Float32Array.from({ length: q }, (_, i) => input(start + i, c)));
      const outBuf = [new Float32Array(q), new Float32Array(q)];
      for (let k = pending.length - 1; k >= 0; k -= 1) {
        if (pending[k].due <= quantum) {
          const item = pending.splice(k, 1)[0];
          dsp.pushWet(item.epoch, item.seq, item.data);
        }
      }
      dsp.process(inBuf, outBuf, q);
      for (let c = 0; c < 2; c += 1) out[c].set(outBuf[c], start);
      quantum += 1;
    }
    return { out };
  }
  return { dsp, run };
}

/** Delays a block stream by L frames (what a latent plugin does). */
function delayed(block: Float32Array, seq: number, L: number, B: number, state: Record<number, Float32Array>): Float32Array {
  const out = new Float32Array(block.length);
  for (let c = 0; c < 2; c += 1) {
    const prev = state[c] ?? new Float32Array(L);
    const joined = new Float32Array(L + B);
    joined.set(prev, 0);
    joined.set(block.subarray(c * B, (c + 1) * B), L);
    out.set(joined.subarray(0, B), c * B);
    state[c] = joined.slice(B, B + L);
  }
  void seq;
  return out;
}

const tone = (n: number, c: number) => 0.5 * Math.sin((2 * Math.PI * (c === 0 ? 440 : 660) * n) / SR);
const maxStep = (a: Float32Array, from: number, to: number) => {
  let worst = 0;
  for (let i = from + 1; i < to; i += 1) worst = Math.max(worst, Math.abs(a[i] - a[i - 1]));
  return worst;
};

describe("LiveInsertDsp", () => {
  it("plays the wet signal J blocks behind the input, aligned with the reported latency", () => {
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3, gain: 0.5 });
    const { out } = run(tone, 256 * 40);
    const D = dsp.latencyFrames;
    expect(D).toBe(768);
    // once the stream is flowing the output is 0.5 * input delayed by D
    for (let n = 256 * 8; n < 256 * 40; n += 37) expect(out[0][n]).toBeCloseTo(0.5 * tone(n - D, 0), 5);
    expect(dsp.stats().underruns).toBe(0);
    expect(dsp.stats().wetBlocks).toBeGreaterThan(30);
  });

  it("a plugin's own latency is inside the wet stream and D covers it", () => {
    const { dsp, run } = harness({ blockFrames: 128, prefill: 2, latency: 100, gain: 0.5 });
    const { out } = run(tone, 128 * 60);
    expect(dsp.latencyFrames).toBe(128 * 2 + 100);
    for (let n = 128 * 10; n < 128 * 60; n += 41) expect(out[1][n]).toBeCloseTo(0.5 * tone(n - dsp.latencyFrames, 1), 5);
  });

  it("falls back to the time-aligned dry signal when a block misses its deadline, and counts it", () => {
    const missing = new Set([20]);
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3, answerQuanta: (seq) => (missing.has(seq) ? null : 1) });
    const { out } = run(tone, 256 * 40);
    const D = dsp.latencyFrames;
    const stats = dsp.stats();
    expect(stats.underruns).toBe(1);
    expect(stats.dryBlocks).toBeGreaterThanOrEqual(1);
    // the middle of the missing block is the dry signal, exactly aligned (no jump in time)
    const slot = 20 + 3;
    const mid = slot * 256 + 128;
    expect(out[0][mid]).toBeCloseTo(tone(mid - D, 0), 5);
    // ... and the way in and out is a ramp, never a step
    expect(maxStep(out[0], slot * 256 - 300, slot * 256 + 600)).toBeLessThan(0.06);
  });

  it("a block that arrives after its slot was given up is late, not played", () => {
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3, answerQuanta: (seq) => (seq === 15 ? 40 : 1) });
    run(tone, 256 * 40);
    expect(dsp.stats()).toMatchObject({ underruns: 1, lateBlocks: 1 });
  });

  it("recovers: after the gap the wet signal is back at full level", () => {
    const missing = new Set([10, 11, 12]);
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3, answerQuanta: (seq) => (missing.has(seq) ? null : 1) });
    const { out } = run(tone, 256 * 40);
    expect(dsp.stats().underruns).toBe(3);
    const n = 256 * 30;
    expect(out[0][n]).toBeCloseTo(0.5 * tone(n - dsp.latencyFrames, 0), 5);
  });

  it("bypass (a crashed helper) crossfades to the aligned dry signal and stops counting underruns", () => {
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3 });
    const first = run(tone, 256 * 20);
    dsp.setBypassed(true);
    const second = run((n, c) => tone(n + 256 * 20, c), 256 * 20);
    const D = dsp.latencyFrames;
    const n = 256 * 15;
    expect(second.out[0][n]).toBeCloseTo(tone(n + 256 * 20 - D, 0), 5);
    expect(maxStep(second.out[0], 0, 600)).toBeLessThan(0.06);
    expect(first.out[0].length).toBe(256 * 20);
    expect(dsp.stats().underruns).toBe(0);
  });

  it("startup: the first J blocks are silent dry (no wet is due yet), not underruns", () => {
    const { dsp, run } = harness({ blockFrames: 128, prefill: 2 });
    const { out } = run(tone, 128 * 6);
    expect(out[0].slice(0, 256).every((v) => v === 0)).toBe(true);
    expect(dsp.stats().underruns).toBe(0);
  });

  it("a stopped stream sends nothing and a new epoch restarts block numbering", () => {
    const sent: Array<[number, number]> = [];
    const dsp = new LiveInsertDsp({ channels: 2, blockFrames: 128, prefillBlocks: 2, pluginLatencyFrames: 0, onBlock: (e, s) => sent.push([e, s]) });
    const quantum = [new Float32Array(128), new Float32Array(128)];
    const out = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i < 3; i += 1) dsp.process(quantum, out, 128);
    expect(sent).toEqual([[0, 0], [0, 1], [0, 2]]);
    dsp.setStreaming(false);
    for (let i = 0; i < 3; i += 1) dsp.process(quantum, out, 128);
    expect(sent).toHaveLength(3);
    dsp.setStreaming(true);
    dsp.process(quantum, out, 128);
    expect(sent[3]).toEqual([1, 0]);
    // a wet block of the old epoch is ignored
    dsp.pushWet(0, 0, new Float32Array(256));
    expect(dsp.stats().lateBlocks).toBe(0);
  });

  it("while stopped the insert is a plain pass-through: not muted, not delayed, nothing sent", () => {
    const sent: number[] = [];
    const dsp = new LiveInsertDsp({ channels: 2, blockFrames: 128, prefillBlocks: 2, pluginLatencyFrames: 50, onBlock: (_e, s) => sent.push(s) });
    dsp.setStreaming(false);
    const input = [Float32Array.from({ length: 128 }, (_, i) => i / 128), Float32Array.from({ length: 128 }, (_, i) => -i / 128)];
    const out = [new Float32Array(128), new Float32Array(128)];
    dsp.process(input, out, 128);
    expect(Array.from(out[0])).toEqual(Array.from(input[0]));
    expect(Array.from(out[1])).toEqual(Array.from(input[1]));
    expect(sent).toEqual([]);
    expect(dsp.stats().underruns).toBe(0);
    // and a mono source feeding a stereo insert while stopped is passed to both channels
    dsp.process([input[0]], out, 128);
    expect(Array.from(out[1])).toEqual(Array.from(input[0]));
  });

  it("handles quanta that are not a divisor of the block", () => {
    const sent: number[] = [];
    const dsp = new LiveInsertDsp({ channels: 2, blockFrames: 128, prefillBlocks: 2, pluginLatencyFrames: 0, onBlock: (_e, s) => sent.push(s) });
    const out = [new Float32Array(100), new Float32Array(100)];
    for (let i = 0; i < 10; i += 1) dsp.process([new Float32Array(100), new Float32Array(100)], out, 100);
    expect(sent).toHaveLength(7); // 1000 frames / 128
  });

  it("changing the reported plugin latency changes D and keeps the output finite", () => {
    const { dsp, run } = harness({ blockFrames: 256, prefill: 3 });
    run(tone, 256 * 10);
    dsp.setPluginLatency(480);
    expect(dsp.latencyFrames).toBe(768 + 480);
    const { out } = run(tone, 256 * 10);
    expect(out[0].every(Number.isFinite)).toBe(true);
  });
});
