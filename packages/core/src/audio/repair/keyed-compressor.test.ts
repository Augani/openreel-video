import { describe, expect, it } from "vitest";
import { LinkedCompressorProcessor } from "./repair-dsp";

const SR = 48000;
const tone = (freq: number, amp: number, frames: number) => Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const rms = (x: Float32Array, from: number, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
const db = (v: number) => 20 * Math.log10(v);
const dbfs = (d: number) => Math.pow(10, d / 20);

const SETTLE = SR / 2;
const base = { threshold: -20, ratio: 4, knee: 0, attack: 0.001, release: 0.05 };

/** Streams `main` (and an optional key) through the compressor in 128-frame blocks, like the worklet. */
function run(params: Record<string, number>, main: Float32Array, key?: Float32Array, block = 128) {
  const proc = new LinkedCompressorProcessor(SR, params);
  const out = new Float32Array(main.length);
  for (let at = 0; at < main.length; at += block) {
    const n = Math.min(block, main.length - at);
    proc.process([main.subarray(at, at + n)], [out.subarray(at, at + n)], n, key ? [key.subarray(at, at + n)] : undefined);
  }
  return { out, latency: proc.latency };
}

/** Level change (dB) of the output against the (latency-aligned) main signal over the settled second half. */
const changeDb = (main: Float32Array, out: Float32Array, latency: number) => db(rms(out, SETTLE + latency)) - db(rms(main, SETTLE, main.length - latency));

describe("sidechain key on the linked compressor", () => {
  // The programme sits at -30 dBFS: far below the -20 dB threshold, so on its own it is never compressed.
  const main = tone(220, dbfs(-30), SR);

  it("a key over the threshold pulls the programme down by the compressor's static curve", () => {
    // key peak -8 dBFS is 12 dB over the threshold; 4:1 turns that into 12 * (1 - 1/4) = 9 dB of reduction
    const key = tone(1000, dbfs(-8), SR);
    const { out, latency } = run({ ...base, keyed: 1 }, main, key);
    const change = changeDb(main, out, latency);
    expect(change).toBeLessThan(-8);
    expect(change).toBeGreaterThan(-9.3);
  });

  it("without a key (not connected, or silent) nothing is attenuated, however loud the programme is", () => {
    const loud = tone(220, dbfs(-8), SR);
    const none = run({ ...base, keyed: 1 }, loud);
    expect(Math.abs(changeDb(loud, none.out, none.latency))).toBeLessThan(0.01);
    const silentKey = run({ ...base, keyed: 1 }, loud, new Float32Array(SR));
    expect(Math.abs(changeDb(loud, silentKey.out, silentKey.latency))).toBeLessThan(0.01);
  });

  it("a key below the threshold does nothing", () => {
    const { out, latency } = run({ ...base, keyed: 1 }, main, tone(1000, dbfs(-40), SR));
    expect(Math.abs(changeDb(main, out, latency))).toBeLessThan(0.01);
  });

  it("when not keyed the key input is ignored and the programme compresses itself", () => {
    const loud = tone(220, dbfs(-8), SR);
    const { out, latency } = run({ ...base, keyed: 0 }, loud, new Float32Array(SR));
    expect(changeDb(loud, out, latency)).toBeLessThan(-8);
  });

  it("the key high-pass keeps low-frequency rumble from triggering the compressor", () => {
    const rumble = tone(50, dbfs(-8), SR);
    const open = run({ ...base, keyed: 1 }, main, rumble);
    const filtered = run({ ...base, keyed: 1, keyHpf: 1000 }, main, rumble);
    expect(changeDb(main, open.out, open.latency)).toBeLessThan(-6);
    expect(Math.abs(changeDb(main, filtered.out, filtered.latency))).toBeLessThan(0.5);
    // while a key above the cutoff still triggers it
    const high = run({ ...base, keyed: 1, keyHpf: 1000 }, main, tone(4000, dbfs(-8), SR));
    expect(changeDb(main, high.out, high.latency)).toBeLessThan(-8);
  });

  it("the programme is only delayed by the lookahead, never filtered or coloured, while the key is quiet", () => {
    const { out, latency } = run({ ...base, keyed: 1 }, main, new Float32Array(SR));
    for (let i = latency; i < main.length; i++) expect(Math.abs(out[i] - main[i - latency])).toBeLessThan(1e-7);
  });

  it("block size does not change the result", () => {
    const key = tone(1000, dbfs(-8), 9000);
    const m = tone(220, dbfs(-30), 9000);
    const a = run({ ...base, keyed: 1, keyHpf: 300 }, m, key, 128).out;
    const b = run({ ...base, keyed: 1, keyHpf: 300 }, m, key, 33).out;
    expect(a.every((v, i) => v === b[i])).toBe(true);
  });
});
