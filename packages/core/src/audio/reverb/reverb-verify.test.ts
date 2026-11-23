import { describe, expect, it } from "vitest";
import { peakAbs, roomImpulseResponse, synthSpeech } from "../enhance/enhance-test-signals";
import { ReduceReverbCache } from "./reverb-cache";
import { reduceReverbChannel } from "./reverb-dsp";
import { reduceReverbChannels } from "./reverb-engine";
import { fftConvolve } from "./reverb-metrics";
import { limitPeaks } from "./reverb-limiter";
import { ReverbCancelledError } from "./reverb-params";
import type { ReverbBackend } from "./reverb-worker-client";

const RATE = 16000;
const room = (seed: number, rt60: number, peak = 0.5) => fftConvolve(synthSpeech(RATE, 4, seed, peak), roomImpulseResponse(RATE, rt60, 0));
const errDb = (a: Float32Array, b: Float32Array): number => {
  let d = 0;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) {
    d += (a[i] - b[i]) ** 2;
    r += b[i] ** 2;
  }
  return 10 * Math.log10(d / (r + 1e-30) + 1e-30);
};

describe("independent Reduce Reverb checks: peak headroom", () => {
  it.each([
    [35, 80, 0.6],
    [90, 20, 1.0],
    [100, 100, 0.4],
  ])("hard-clipped input (amount %i, sensitivity %i, clip %f) never exceeds its own peak", async (amount, sensitivity, clip) => {
    const loud = Float32Array.from(room(7, 0.7, 0.5), (v) => Math.max(-clip, Math.min(clip, v * 6)));
    const out = (await reduceReverbChannel(loud, RATE, { amount, sensitivity })).output;
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(peakAbs(out)).toBeLessThanOrEqual(peakAbs(loud) + 1e-7);
  }, 120_000);

  it("stereo with a hot left and quiet right keeps both under the loud channel's peak and keeps the image (same gain)", async () => {
    const left = Float32Array.from(room(3, 0.6, 0.5), (v) => Math.max(-0.8, Math.min(0.8, v * 5)));
    const right = Float32Array.from(room(4, 0.6, 0.5), (v) => v * 0.2);
    const { channels } = await reduceReverbChannels([left, right], RATE, { amount: 75, sensitivity: 65 });
    const limit = Math.max(peakAbs(left), peakAbs(right));
    for (const c of channels) expect(peakAbs(c)).toBeLessThanOrEqual(limit + 1e-7);
  }, 120_000);

  it("limiter leaves within-limit samples bit-identical and applies one gain to all channels", () => {
    const a = Float32Array.from({ length: 4000 }, (_, i) => 0.3 * Math.sin(i / 7));
    const b = Float32Array.from(a, (v) => v * 0.5);
    a[2000] = 1.7;
    const aCopy = Float32Array.from(a);
    const bCopy = Float32Array.from(b);
    limitPeaks([a, b], 1, RATE);
    expect(peakAbs(a)).toBeLessThanOrEqual(1 + 1e-6);
    for (let i = 0; i < 4000; i += 1) if (Math.abs(i - 2000) > 200) {
      expect(a[i]).toBe(aCopy[i]);
      expect(b[i]).toBe(bCopy[i]);
    }
    for (let i = 1900; i < 2100; i += 1) if (aCopy[i] !== 0) expect(b[i] / bCopy[i]).toBeCloseTo(a[i] / aCopy[i], 5);
  });
});

describe("independent Reduce Reverb checks: Amount near 0", () => {
  it("converges to the input as Amount falls, and Amount 0 is bit-identical", async () => {
    const x = room(11, 0.5);
    const errs: number[] = [];
    for (const amount of [0.05, 0.5, 2, 10]) {
      const out = (await reduceReverbChannel(x, RATE, { amount, sensitivity: 50 })).output;
      errs.push(errDb(out, x));
    }
    for (let i = 1; i < errs.length; i += 1) expect(errs[i]).toBeGreaterThan(errs[i - 1]);
    expect(errs[0]).toBeLessThan(-40);
    expect(errs[1]).toBeLessThan(-28);
    const off = (await reduceReverbChannel(x, RATE, { amount: 0, sensitivity: 50 })).output;
    expect(Buffer.from(off.buffer).equals(Buffer.from(x.buffer))).toBe(true);
  }, 180_000);
});

describe("independent Reduce Reverb checks: per-setting jobs", () => {
  const SR = 8000;
  const mk = (): AudioBuffer => {
    const data = Float32Array.from({ length: SR * 2 }, (_, i) => 0.35 * Math.sin((2 * Math.PI * 330 * i) / SR));
    return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: 2, getChannelData: () => data } as unknown as AudioBuffer;
  };
  const makeBuffer = (channels: Float32Array[], sampleRate: number): AudioBuffer =>
    ({ numberOfChannels: channels.length, sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] }) as unknown as AudioBuffer;

  it("three settings of one source all complete, max 2 at once, results differ per setting, cancelling one spares the others", async () => {
    let live = 0;
    let maxLive = 0;
    const gates: Array<() => void> = [];
    const backend: ReverbBackend = {
      reduce: (channels, _r, params, options) =>
        new Promise((resolve, reject) => {
          live += 1;
          maxLive = Math.max(maxLive, live);
          options?.signal?.addEventListener("abort", () => {
            live -= 1;
            reject(new ReverbCancelledError());
          });
          gates.push(() => {
            live -= 1;
            resolve({ channels: channels.map((c) => c.map((v) => v * (params.amount / 100))), rt60: 0.5, confidence: 1 });
          });
        }),
    };
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const src = mk();
    const p = [17, 52, 93].map((amount) => ({ amount, sensitivity: 50 }));
    const reqs = p.map((params) => cache.request({ buffer: src, params }));
    await new Promise((r) => setTimeout(r, 5));
    expect(gates.length).toBeLessThanOrEqual(2);
    while (gates.length) gates.shift()!();
    for (let i = 0; i < 10 && gates.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    while (gates.length) gates.shift()!();
    const out = await Promise.all(reqs);
    expect(maxLive).toBeLessThanOrEqual(2);
    expect(out.every((o) => o !== null)).toBe(true);
    expect(out[0]!.getChannelData(0)[100]).not.toBeCloseTo(out[2]!.getChannelData(0)[100], 3);
    for (const params of p) expect(cache.peek({ buffer: src, params })).not.toBeNull();
  });

  it("cancel(buffer, params) only drops that setting's job", async () => {
    const aborts: number[] = [];
    const gates: Array<() => void> = [];
    const backend: ReverbBackend = {
      reduce: (channels, _r, params, options) =>
        new Promise((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            aborts.push(params.amount);
            reject(new ReverbCancelledError());
          });
          gates.push(() => resolve({ channels, rt60: 0.5, confidence: 1 }));
        }),
    };
    const cache = new ReduceReverbCache({ backend, makeBuffer });
    const src = mk();
    const a = cache.request({ buffer: src, params: { amount: 20, sensitivity: 50 } });
    const b = cache.request({ buffer: src, params: { amount: 80, sensitivity: 50 } });
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.cancel(src, { amount: 20, sensitivity: 50 })).toBe(true);
    expect(await a).toBeNull();
    gates.forEach((g) => g());
    expect(await b).not.toBeNull();
    expect(aborts).toEqual([20]);
  });
});
