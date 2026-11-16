import { describe, expect, it } from "vitest";
import { shouldPreservePitch, stretchedLength, timeStretchChannels } from "./time-stretch";

const SR = 44100;

const sine = (freq: number, seconds: number): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
};

const goertzel = (data: Float32Array, freq: number): number => {
  const w = (2 * Math.PI * freq) / SR;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    const s = data[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
};

const peakFrequency = (data: Float32Array): number => {
  let best = 0;
  let bestPower = -1;
  for (let f = 200; f <= 1200; f += 2) {
    const power = goertzel(data, f);
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
};

// Mirrors the non-stretch path: AudioBufferSourceNode.playbackRate resampling.
const resample = (data: Float32Array, speed: number): Float32Array => {
  const out = new Float32Array(Math.round(data.length / speed));
  for (let i = 0; i < out.length; i++) {
    const pos = i * speed;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    out[i] = data[i0] * (1 - frac) + (data[i0 + 1] ?? data[i0]) * frac;
  }
  return out;
};

const body = (data: Float32Array): Float32Array =>
  data.subarray(Math.round(0.1 * SR), data.length - Math.round(0.1 * SR));

describe("timeStretchChannels", () => {
  it("2x with pitch correction halves duration and keeps 440 Hz", () => {
    const [out] = timeStretchChannels([sine(440, 2)], SR, 2);
    expect(out.length).toBe(SR);
    expect(Math.abs(peakFrequency(body(out)) - 440)).toBeLessThanOrEqual(4);
  });

  it("2x without pitch correction (resample) halves duration and goes to 880 Hz", () => {
    const out = resample(sine(440, 2), 2);
    expect(out.length).toBe(SR);
    expect(Math.abs(peakFrequency(body(out)) - 880)).toBeLessThanOrEqual(4);
  });

  it("0.5x doubles duration and keeps 440 Hz", () => {
    const [out] = timeStretchChannels([sine(440, 1)], SR, 0.5);
    expect(out.length).toBe(2 * SR);
    expect(Math.abs(peakFrequency(body(out)) - 440)).toBeLessThanOrEqual(4);
  });

  it("keeps amplitude steady and applies the same stretch to every channel", () => {
    const [l, r] = timeStretchChannels([sine(440, 1), sine(440, 1).map((v) => v * 0.5)], SR, 1.5);
    const rms = (d: Float32Array) => Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
    expect(l.length).toBe(r.length);
    expect(rms(body(l))).toBeGreaterThan(0.6);
    expect(rms(body(l))).toBeLessThan(0.8);
    expect(rms(body(r)) / rms(body(l))).toBeCloseTo(0.5, 1);
  });

  it("handles empty input", () => {
    expect(timeStretchChannels([new Float32Array(0)], SR, 2)[0].length).toBe(0);
    expect(stretchedLength(1000, 2)).toBe(500);
  });
});

describe("shouldPreservePitch", () => {
  it("defaults on, off only when explicitly false, and never at 1x", () => {
    expect(shouldPreservePitch(2, undefined)).toBe(true);
    expect(shouldPreservePitch(2, true)).toBe(true);
    expect(shouldPreservePitch(2, false)).toBe(false);
    expect(shouldPreservePitch(1, true)).toBe(false);
    expect(shouldPreservePitch(undefined, true)).toBe(false);
  });
});
