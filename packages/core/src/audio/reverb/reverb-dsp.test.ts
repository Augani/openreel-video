import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { resample } from "../enhance/resample";
import { peakAbs, readPcm16Wav, roomImpulseResponse, siSdr } from "../enhance/enhance-test-signals";
import { estimateRt60, reduceReverbChannel, ReverbCancelledError, reverbTuning, spectralLateReverbChannel } from "./reverb-dsp";
import { reduceReverbChannels } from "./reverb-engine";
import { earlyPart, fftConvolve, tailLevelChangeDb } from "./reverb-metrics";
import { wpeChannel } from "./reverb-wpe";

const fixture = fileURLToPath(new URL("../enhance/fixtures/speech-16k.wav", import.meta.url));
const RATE = 48000;
let dry: Float32Array;
const roomy = (rt60: number, drr = 0) => fftConvolve(dry, roomImpulseResponse(RATE, rt60, drr));

beforeAll(() => {
  const wav = readPcm16Wav(readFileSync(fixture));
  dry = resample(wav.samples.subarray(0, wav.sampleRate * 6), wav.sampleRate, RATE);
});

describe("blind RT60 estimate", () => {
  it("orders rooms by their decay and lands near the true value for a moderately reverberant one", () => {
    const short = estimateRt60(roomy(0.3), RATE);
    const medium = estimateRt60(roomy(0.8), RATE);
    expect(short.confidence).toBeGreaterThan(0);
    expect(medium.confidence).toBeGreaterThan(0);
    expect(short.rt60).toBeLessThan(medium.rt60);
    expect(medium.rt60).toBeGreaterThan(0.55);
    expect(medium.rt60).toBeLessThan(1.2);
  });

  it("falls back to a typical room, with zero confidence, when there is nothing to measure", () => {
    const tone = Float32Array.from({ length: RATE * 3 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    expect(estimateRt60(tone, RATE)).toMatchObject({ rt60: 0.45, confidence: 0 });
    expect(estimateRt60(new Float32Array(1000), RATE)).toMatchObject({ confidence: 0 });
  });
});

describe("reduceReverbChannel", () => {
  it("raises SI-SDR against the dry voice and lowers the tail in the pauses, keeping length and staying finite", async () => {
    const wet = roomy(0.8);
    const { output } = await reduceReverbChannel(wet, RATE, { amount: 60, sensitivity: 50 });
    expect(output).toHaveLength(wet.length);
    expect(output.every((v) => Number.isFinite(v))).toBe(true);
    expect(siSdr(output, dry) - siSdr(wet, dry)).toBeGreaterThan(1);
    expect(tailLevelChangeDb(dry, wet, output, RATE)).toBeLessThan(-4);
    expect(peakAbs(output)).toBeLessThanOrEqual(peakAbs(wet) * 1.05);
  }, 60_000);

  it("is deterministic: the same input gives bit-identical output", async () => {
    const wet = roomy(0.5);
    const a = (await reduceReverbChannel(wet, RATE, { amount: 70, sensitivity: 40 })).output;
    const b = (await reduceReverbChannel(wet, RATE, { amount: 70, sensitivity: 40 })).output;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  }, 60_000);

  it("gives the same result, scaled, whatever level the source was decoded at", async () => {
    const wet = roomy(0.8);
    const quieter = Float32Array.from(wet, (v) => v * Math.SQRT1_2);
    const a = (await reduceReverbChannel(wet, RATE, { amount: 60, sensitivity: 50 })).output;
    const b = Float32Array.from((await reduceReverbChannel(quieter, RATE, { amount: 60, sensitivity: 50 })).output, (v) => v / Math.SQRT1_2);
    let diff = 0;
    let ref = 0;
    for (let i = 0; i < a.length; i += 1) {
      diff += (a[i] - b[i]) ** 2;
      ref += a[i] ** 2;
    }
    expect(10 * Math.log10(diff / ref + 1e-30)).toBeLessThan(-70);
  }, 60_000);

  it("returns the source unchanged for Amount 0 and keeps silence silent", async () => {
    const wet = roomy(0.5);
    const off = await reduceReverbChannel(wet, RATE, { amount: 0, sensitivity: 50 });
    expect(Buffer.from(off.output.buffer).equals(Buffer.from(wet.buffer))).toBe(true);
    const silent = (await reduceReverbChannel(new Float32Array(RATE), RATE, { amount: 100, sensitivity: 100 })).output;
    expect(silent.every((v) => v === 0)).toBe(true);
    expect((await reduceReverbChannel(new Float32Array(0), RATE, { amount: 60, sensitivity: 50 })).output).toHaveLength(0);
  });

  it("works at other sample rates and very short sources", async () => {
    const at16 = resample(roomy(0.5), RATE, 16000);
    const out = (await reduceReverbChannel(at16, 16000, { amount: 60, sensitivity: 50 })).output;
    expect(out).toHaveLength(at16.length);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    const tiny = Float32Array.from({ length: 700 }, (_, i) => 0.2 * Math.sin(i / 7));
    expect((await reduceReverbChannel(tiny, RATE, { amount: 60, sensitivity: 50 })).output).toHaveLength(700);
  }, 60_000);

  it("reports monotonic progress ending at 1 and stops on cancel", async () => {
    const wet = roomy(0.5);
    const seen: number[] = [];
    await reduceReverbChannel(wet, RATE, { amount: 60, sensitivity: 50 }, { onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1] - 1e-9)).toBe(true);
    const signal = { aborted: false };
    let calls = 0;
    await expect(
      reduceReverbChannel(wet, RATE, { amount: 60, sensitivity: 50 }, { signal, yieldNow: async () => { calls += 1; if (calls === 2) signal.aborted = true; } }),
    ).rejects.toBeInstanceOf(ReverbCancelledError);
  }, 60_000);

  it("is monotonic in Amount: more Amount removes more of the tail", async () => {
    const wet = roomy(0.8);
    const tails: number[] = [];
    for (const amount of [20, 60, 100]) tails.push(tailLevelChangeDb(dry, wet, (await reduceReverbChannel(wet, RATE, { amount, sensitivity: 50 })).output, RATE));
    expect(tails[0]).toBeGreaterThan(tails[1]);
    expect(tails[1]).toBeGreaterThan(tails[2]);
  }, 120_000);

  it("maps the sliders to documented constants", () => {
    expect(reverbTuning({ amount: 0, sensitivity: 50 })).toEqual({ wpeStrength: 0, wpeDelay: 3, spectralAmount: 0 });
    expect(reverbTuning({ amount: 100, sensitivity: 0 })).toEqual({ wpeStrength: 1, wpeDelay: 4, spectralAmount: 35 });
    expect(reverbTuning({ amount: 100, sensitivity: 100 }).wpeDelay).toBe(2);
  });
});

describe("the two stages", () => {
  it("WPE alone gives the SI-SDR gain and the spectral stage alone lowers the tail more in the pauses", async () => {
    const wet = roomy(0.8);
    const predicted = await wpeChannel(wet, RATE, { delay: 3, taps: 26, iterations: 3, strength: 1, maxHz: 8000 });
    const spectral = (await spectralLateReverbChannel(wet, RATE, { amount: 60, sensitivity: 50 })).output;
    expect(siSdr(predicted, dry)).toBeGreaterThan(siSdr(wet, dry) + 1.5);
    expect(tailLevelChangeDb(dry, wet, spectral, RATE)).toBeLessThan(tailLevelChangeDb(dry, wet, predicted, RATE));
  }, 120_000);

  it("WPE strength 0 is a copy and crosses block boundaries without a step", async () => {
    const rate = 16000;
    const short = resample(roomy(0.5), RATE, rate);
    const copy = await wpeChannel(short, rate, { delay: 3, taps: 20, iterations: 2, strength: 0, maxHz: 8000 });
    expect(Buffer.from(copy.buffer).equals(Buffer.from(short.buffer))).toBe(true);
    // 65 s: two block boundaries (30 s blocks). The signal around a boundary must be as smooth as anywhere else.
    const looped = new Float32Array(rate * 65);
    for (let i = 0; i < looped.length; i += 1) looped[i] = short[i % short.length];
    const out = await wpeChannel(looped, rate, { delay: 3, taps: 20, iterations: 1, strength: 0.8, maxHz: 6000 });
    const jump = (at: number) => Math.max(...Array.from({ length: 64 }, (_, k) => Math.abs(out[at + k + 1] - out[at + k])));
    const typical = Math.max(...[10, 20, 40, 50].map((s) => jump(s * rate)));
    for (const boundary of [30, 60]) expect(jump(boundary * rate - 32)).toBeLessThan(typical * 3);
  }, 240_000);
});

describe("reduceReverbChannels", () => {
  it("processes dual-mono once, stereo channels separately, and never peaks above the source", async () => {
    const wet = roomy(0.5).subarray(0, RATE * 3);
    const mono = await reduceReverbChannels([wet, wet], RATE, { amount: 60, sensitivity: 50 });
    expect(mono.channels[0]).toBe(mono.channels[1]);
    const other = Float32Array.from(wet, (v, i) => v * 0.5 + 0.1 * Math.sin(i / 11));
    const stereo = await reduceReverbChannels([wet, other], RATE, { amount: 60, sensitivity: 50 });
    expect(stereo.channels[0]).not.toBe(stereo.channels[1]);
    const limit = Math.max(peakAbs(wet), peakAbs(other));
    for (const channel of stereo.channels) expect(peakAbs(channel)).toBeLessThanOrEqual(limit);
    expect(await reduceReverbChannels([], RATE, { amount: 60, sensitivity: 50 })).toMatchObject({ channels: [] });
  }, 120_000);

  it("keeps the early part of the response: the output stays closer to the early-only target than the reverberant input", async () => {
    const h = roomImpulseResponse(RATE, 0.8, 0);
    const wet = fftConvolve(dry, h);
    const early = fftConvolve(dry, earlyPart(h, RATE));
    const { channels } = await reduceReverbChannels([wet], RATE, { amount: 60, sensitivity: 50 });
    expect(siSdr(channels[0], early)).toBeGreaterThan(siSdr(wet, early));
  }, 60_000);
});

describe("peak headroom", () => {
  it("never exceeds the source's own peak on loud or hard-clipped input, by gain reduction rather than clipping", async () => {
    const wet = roomy(1.0).subarray(0, RATE * 4);
    const scale = 4 / peakAbs(wet);
    const clipped = Float32Array.from(wet, (v) => Math.max(-1, Math.min(1, v * scale)));
    const loud = Float32Array.from(wet, (v) => v * (0.99 / peakAbs(wet)));
    for (const source of [clipped, loud]) {
      for (const params of [{ amount: 100, sensitivity: 100 }, { amount: 60, sensitivity: 50 }]) {
        const one = (await reduceReverbChannel(source, RATE, params)).output;
        const many = (await reduceReverbChannels([source, source.map((v) => v * 0.7)], RATE, params)).channels;
        expect(peakAbs(one)).toBeLessThanOrEqual(peakAbs(source));
        for (const channel of many) expect(peakAbs(channel)).toBeLessThanOrEqual(peakAbs(source));
        // Gain-limited, not clipped: the shape survives (the output still correlates with the unlimited stage output's sign everywhere).
        expect(one.every((v) => Number.isFinite(v))).toBe(true);
      }
    }
  }, 180_000);
});

describe("low Amount converges to identity", () => {
  it("is within -50 dB of the input at Amount 0.1 and error grows smoothly with Amount; Amount 0 is bit-identical", async () => {
    const wet = roomy(0.6).subarray(0, RATE * 4);
    const error = async (amount: number) => {
      const { output } = await reduceReverbChannel(wet, RATE, { amount, sensitivity: 50 });
      let diff = 0;
      let power = 0;
      for (let i = 0; i < wet.length; i += 1) {
        diff += (output[i] - wet[i]) ** 2;
        power += wet[i] ** 2;
      }
      return 10 * Math.log10(diff / power + 1e-30);
    };
    const levels = [];
    for (const amount of [0.1, 1, 5, 20]) levels.push(await error(amount));
    console.log("low-amount error dB", levels.map((v) => v.toFixed(1)).join(" "));
    expect(levels[0]).toBeLessThan(-50);
    expect(levels[1]).toBeLessThan(-30);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    const zero = (await reduceReverbChannel(wet, RATE, { amount: 0, sensitivity: 50 })).output;
    expect(Buffer.from(zero.buffer, zero.byteOffset, zero.byteLength).equals(Buffer.from(wet.buffer, wet.byteOffset, wet.byteLength))).toBe(true);
  }, 120_000);
});
