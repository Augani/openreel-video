import { describe, expect, it } from "vitest";
import { processChannels } from "./repair-dsp";

const SR = 48000;

/** Amplitude of the `freq` component over [from, to) via a single-bin DFT. */
function toneAmp(x: Float32Array, freq: number, from = 0, to = x.length): number {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i += 1) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
}
const db = (a: number, b: number) => 20 * Math.log10(a / b);
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i += 1) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const make = (n: number, f: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => f(i));

describe("DeHum", () => {
  const n = SR * 2;
  const clean = make(n, (i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 330 * i) / SR));
  const hum = make(n, (i) => clean[i] + 0.2 * Math.sin((2 * Math.PI * 60 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 120 * i) / SR) + 0.05 * Math.sin((2 * Math.PI * 180 * i) / SR));

  it("reduces the 60 Hz fundamental by >= 30 dB and leaves 1 kHz within 1 dB", () => {
    const [out] = processChannels("deHum", [hum], SR, { frequency: 60, harmonics: 4, q: 30 });
    const from = SR; // skip the filter's settling second
    const before = toneAmp(hum, 60, from);
    const after = toneAmp(out, 60, from);
    expect(db(before, after)).toBeGreaterThanOrEqual(30);
    expect(Math.abs(db(toneAmp(out, 1000, from), toneAmp(hum, 1000, from)))).toBeLessThan(1);
    expect(db(toneAmp(hum, 120, from), toneAmp(out, 120, from))).toBeGreaterThanOrEqual(30);
  });

  it("is independent of the processing block size", () => {
    const a = processChannels("deHum", [hum.subarray(0, 9600)], SR, { frequency: 60 }, 128)[0];
    const b = processChannels("deHum", [hum.subarray(0, 9600)], SR, { frequency: 60 }, 480)[0];
    for (let i = 0; i < a.length; i += 1) expect(a[i]).toBeCloseTo(b[i], 6);
  });
});

describe("DeClick", () => {
  const n = SR;
  const rnd = mulberry(7);
  const clean = make(n, (i) => 0.4 * Math.sin((2 * Math.PI * 300 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 1700 * i) / SR));
  const noisy = Float32Array.from(clean, (v) => v + (rnd() - 0.5) * 0.01);
  const clicks = [5000, 12000, 20111, 31000, 40000];
  const dirty = Float32Array.from(noisy);
  for (const c of clicks) {
    dirty[c] += 0.8;
    if (c % 2 === 0) dirty[c + 1] -= 0.6; // a two-sample click
  }

  it("removes the clicks (peak error) and keeps everything else untouched", () => {
    const [out] = processChannels("deClick", [dirty], SR, { sensitivity: 0.6 });
    let worstBefore = 0;
    let worstAfter = 0;
    for (const c of clicks) {
      for (let k = -2; k <= 3; k += 1) {
        worstBefore = Math.max(worstBefore, Math.abs(dirty[c + k] - noisy[c + k]));
        worstAfter = Math.max(worstAfter, Math.abs(out[c + k] - noisy[c + k]));
      }
    }
    expect(worstBefore).toBeGreaterThan(0.5);
    expect(worstAfter).toBeLessThan(worstBefore * 0.1);
    // Samples far from any click are bit-identical to the input.
    let touched = 0;
    for (let i = 100; i < n - 100; i += 1) {
      if (clicks.some((c) => Math.abs(i - c) < 10)) continue;
      if (out[i] !== dirty[i]) touched += 1;
    }
    expect(touched).toBeLessThanOrEqual(3);
  });

  it("leaves a clean signal alone", () => {
    const [out] = processChannels("deClick", [noisy], SR, { sensitivity: 0.5 });
    let changed = 0;
    for (let i = 0; i < n; i += 1) if (out[i] !== noisy[i]) changed += 1;
    expect(changed).toBeLessThan(5);
  });
});

describe("DeClip", () => {
  const n = SR / 2;
  const f = 440;
  const original = make(n, (i) => 1.5 * Math.sin((2 * Math.PI * f * i) / SR));
  const clipped = Float32Array.from(original, (v) => Math.max(-1, Math.min(1, v)));

  it("reconstructs a clipped sine closer to the original (RMS error at least halves)", () => {
    const [out] = processChannels("deClip", [clipped], SR, { threshold: -0.1, maxRun: 64 });
    const err = (a: Float32Array) => {
      let s = 0;
      for (let i = 300; i < n - 300; i += 1) s += (a[i] - original[i]) ** 2;
      return Math.sqrt(s / (n - 600));
    };
    expect(err(clipped)).toBeGreaterThan(0.05);
    expect(err(out)).toBeLessThan(err(clipped) / 2);
    expect(Math.max(...out)).toBeGreaterThan(1.1);
  });

  it("does not touch audio that never reaches the threshold", () => {
    const quiet = Float32Array.from(original, (v) => v * 0.3);
    const [out] = processChannels("deClip", [quiet], SR, { threshold: -0.5 });
    for (let i = 0; i < n; i += 1) expect(out[i]).toBe(quiet[i]);
  });
});

describe("DeEss", () => {
  const n = SR;
  const body = (i: number) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / SR);
  const ess = (amp: number) => make(n, (i) => body(i) + amp * Math.sin((2 * Math.PI * 7000 * i) / SR));
  const params = { frequency: 7000, bandwidthQ: 1.5, threshold: -20, ratio: 8 };

  it("reduces the sibilance band when it is above the threshold, leaving the body alone", () => {
    const loud = ess(0.5);
    const [out] = processChannels("deEss", [loud], SR, params);
    const from = SR / 2;
    expect(db(toneAmp(loud, 7000, from), toneAmp(out, 7000, from))).toBeGreaterThan(8);
    expect(Math.abs(db(toneAmp(out, 300, from), toneAmp(loud, 300, from)))).toBeLessThan(0.5);
  });

  it("does nothing when the band stays below the threshold", () => {
    const quiet = ess(0.02);
    const [out] = processChannels("deEss", [quiet], SR, params);
    const from = SR / 2;
    expect(Math.abs(db(toneAmp(out, 7000, from), toneAmp(quiet, 7000, from)))).toBeLessThan(0.1);
  });

  it("listen mode outputs only the detected band", () => {
    const loud = ess(0.5);
    const [out] = processChannels("deEss", [loud], SR, { ...params, listen: 1 });
    const from = SR / 2;
    expect(toneAmp(out, 7000, from)).toBeGreaterThan(0.4);
    expect(toneAmp(out, 300, from)).toBeLessThan(0.02);
  });
});

describe("Gate", () => {
  it("attenuates audio below the threshold and passes audio above it", () => {
    const n = SR;
    const x = make(n, (i) => (i < n / 2 ? 0.5 : 0.002) * Math.sin((2 * Math.PI * 500 * i) / SR));
    const [out] = processChannels("gate", [x], SR, { threshold: -40, range: -30, hold: 0.01, release: 0.02 });
    expect(rms(out, 2000, n / 2 - 2000)).toBeCloseTo(rms(x, 2000, n / 2 - 2000), 2);
    expect(rms(out, n / 2 + 12000, n)).toBeLessThan(rms(x, n / 2 + 12000, n) * 0.1);
  });
});

describe("DeReverb", () => {
  it("reduces the reverberant tail while keeping the direct sound", () => {
    // 16 kHz keeps the direct convolution below cheap; the processor is rate-agnostic.
    const sr = 16000;
    const rnd = mulberry(99);
    const n = sr * 4;
    const dry = new Float32Array(n);
    for (const start of [0.2, 1.4, 2.6]) {
      const a = Math.floor(start * sr);
      for (let i = 0; i < 0.25 * sr; i += 1) {
        const env = Math.sin((Math.PI * i) / (0.25 * sr));
        dry[a + i] = env * 0.4 * (rnd() - 0.5) * 2 * Math.sin((2 * Math.PI * 400 * i) / sr + rnd());
      }
    }
    const ir = new Float32Array(Math.floor(0.7 * sr));
    for (let i = 0; i < ir.length; i += 1) ir[i] = (rnd() * 2 - 1) * Math.exp((-6.9 * i) / (0.5 * sr)) * 0.5;
    ir[0] = 1;
    const wet = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      if (dry[i] === 0) continue;
      for (let k = 0; k < ir.length && i + k < n; k += 1) wet[i + k] += dry[i] * ir[k];
    }
    const [out] = processChannels("deReverb", [wet], sr, { amount: 0.8, rt60: 0.5, floor: -24 });
    // Tail window: 0.17 s .. 0.65 s after the first burst ends (0.45 s).
    const tailFrom = Math.floor(0.62 * sr);
    const tailTo = Math.floor(1.1 * sr);
    const tailBefore = rms(wet, tailFrom, tailTo);
    const tailAfter = rms(out, tailFrom, tailTo);
    expect(20 * Math.log10(tailBefore / tailAfter)).toBeGreaterThan(6);
    const burstFrom = Math.floor(0.25 * sr);
    const burstTo = Math.floor(0.4 * sr);
    expect(Math.abs(20 * Math.log10(rms(out, burstFrom, burstTo) / rms(wet, burstFrom, burstTo)))).toBeLessThan(3);
  });
});
