import { describe, expect, it } from "vitest";
import { compressorLookaheadSamples } from "../effect-latency";
import { LinkedCompressorProcessor, createRepairProcessor, isDspProcessorType, isRepairEffectType, linkedCompressorLookaheadSamples, processChannels } from "./repair-dsp";

const SR = 48000;
const tone = (freq: number, amp: number, frames: number) => Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const rms = (x: Float32Array, from = 0) => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / (x.length - from));
};
const db = (v: number) => 20 * Math.log10(v);
const SETTLE = SR / 2;
const hard = { threshold: -20, ratio: 4, knee: 0, attack: 0.001, release: 0.05 };

describe("linked N-channel compressor", () => {
  it("is a worklet processor kind but not a user-facing repair effect", () => {
    expect(isDspProcessorType("linkedCompressor")).toBe(true);
    expect(isRepairEffectType("linkedCompressor")).toBe(false);
    expect(createRepairProcessor("linkedCompressor", SR, {})).toBeInstanceOf(LinkedCompressorProcessor);
  });

  it("has the 6 ms lookahead of Web Audio's compressor, so plugin delay compensation is unchanged", () => {
    expect(linkedCompressorLookaheadSamples(SR)).toBe(compressorLookaheadSamples(SR));
    expect(new LinkedCompressorProcessor(SR, hard).latency).toBe(288);
  });

  it("leaves signals below the threshold alone (unity gain, only the lookahead delay)", () => {
    const quiet = Array.from({ length: 6 }, () => tone(440, 0.01, SR));
    const out = processChannels("linkedCompressor", quiet, SR, hard);
    expect(out).toHaveLength(6);
    out.forEach((channel, c) => expect(Math.max(...channel.map((v, i) => Math.abs(v - quiet[c][i]))), `channel ${c}`).toBeLessThan(1e-6));
  });

  it("applies the static curve: 12 dB over a -20 dB threshold at 4:1 comes down 9 dB", () => {
    // -8 dBFS peak tone on every channel: 12 dB over the threshold, 12 * (1 - 1/4) = 9 dB of reduction.
    const amp = Math.pow(10, -8 / 20);
    const input = Array.from({ length: 6 }, () => tone(300, amp, SR));
    const out = processChannels("linkedCompressor", input, SR, hard);
    const reduction = db(rms(input[0], SETTLE)) - db(rms(out[0], SETTLE));
    // a peak detector with a 50 ms release lets the gain recover a little between the sine's peaks
    expect(reduction).toBeGreaterThan(8);
    expect(reduction).toBeLessThan(9.3);
  });

  it("links the channels: a loud centre pulls every other channel down by the same amount", () => {
    const quiet = 0.02; // far below the threshold on its own
    const input = [tone(200, quiet, SR), tone(250, quiet, SR), tone(300, 0.8, SR), tone(60, quiet, SR), tone(400, quiet, SR), tone(500, quiet, SR)];
    const out = processChannels("linkedCompressor", input, SR, hard);
    const gains = out.map((channel, c) => db(rms(channel, SETTLE)) - db(rms(input[c], SETTLE)));
    // The centre is compressed...
    expect(gains[2]).toBeLessThan(-8);
    // ...and every other channel gets the identical gain reduction even though it never crossed the threshold.
    gains.forEach((g) => expect(g).toBeCloseTo(gains[2], 1));
  });

  it("is independent of which channel is the loud one (no channel-order bias)", () => {
    const gainsFor = (loud: number) => {
      const input = Array.from({ length: 6 }, (_, c) => tone(300 + c * 70, c === loud ? 0.8 : 0.02, SR));
      const out = processChannels("linkedCompressor", input, SR, hard);
      return db(rms(out[(loud + 1) % 6], SETTLE)) - db(rms(input[(loud + 1) % 6], SETTLE));
    };
    const reference = gainsFor(0);
    for (let loud = 1; loud < 6; loud++) expect(gainsFor(loud)).toBeCloseTo(reference, 1);
  });

  it("is the same whatever the block size and channel count it is asked for", () => {
    const input = Array.from({ length: 6 }, (_, c) => tone(200 + c * 90, 0.5, 20000));
    const a = processChannels("linkedCompressor", input, SR, hard, 128);
    const b = processChannels("linkedCompressor", input, SR, hard, 441);
    a.forEach((channel, c) => expect(Math.max(...channel.map((v, i) => Math.abs(v - b[c][i])))).toBeLessThan(1e-6));
    const stereo = processChannels("linkedCompressor", input.slice(0, 2), SR, hard);
    expect(stereo).toHaveLength(2);
  });

  it("reports the gain reduction for the meter and honours makeup gain", () => {
    const proc = new LinkedCompressorProcessor(SR, hard);
    const amp = Math.pow(10, -8 / 20);
    const input = [tone(300, amp, 4800)];
    const output = [new Float32Array(4800)];
    for (let i = 0; i < 4800; i += 128) {
      const n = Math.min(128, 4800 - i);
      proc.process([input[0].subarray(i, i + n)], [output[0].subarray(i, i + n)], n);
    }
    expect(proc.meter).toBeGreaterThan(5);
    const unity = processChannels("linkedCompressor", [tone(300, 0.01, SR)], SR, { ...hard, makeupGain: 6 });
    expect(db(rms(unity[0], SETTLE) / rms(tone(300, 0.01, SR), SETTLE))).toBeCloseTo(6, 1);
  });

  it("updates live: raising the threshold stops the compression", () => {
    const proc = new LinkedCompressorProcessor(SR, hard);
    const frames = SR / 2;
    const input = tone(300, 0.5, frames);
    const out = new Float32Array(frames);
    proc.setParams({ ...hard, threshold: 0 });
    for (let i = 0; i < frames; i += 128) proc.process([input.subarray(i, i + 128)], [out.subarray(i, i + 128)], Math.min(128, frames - i));
    expect(proc.meter).toBe(0);
  });
});
