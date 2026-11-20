import { describe, expect, it } from "vitest";
import {
  applySpectralRegions,
  applySpectralRegionsToChannel,
  computeSpectralView,
  getStftPlan,
  stftForward,
  stftInverse,
} from "./spectral-dsp";
import { sanitizeSpectralRegions, spectralRegionsKey, type SpectralRegion } from "./spectral-regions";

const SR = 48000;

const region = (patch: Partial<SpectralRegion> & Pick<SpectralRegion, "mode">): SpectralRegion => ({
  id: "r",
  startTime: 0,
  endTime: 10,
  lowHz: 0,
  highHz: SR / 2,
  gainDb: -12,
  enabled: true,
  ...patch,
});

function tones(seconds: number, parts: Array<[number, number]>, extra?: (i: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 1) {
    let v = extra ? extra(i) : 0;
    for (const [f, a] of parts) v += a * Math.sin((2 * Math.PI * f * i) / SR + f);
    out[i] = v;
  }
  return out;
}

/** Amplitude of the sinusoid at `freq` over [from, to) seconds (single-bin DFT). */
function amp(x: Float32Array, freq: number, from: number, to: number): number {
  const a = Math.floor(from * SR);
  const b = Math.floor(to * SR);
  let re = 0;
  let im = 0;
  for (let i = a; i < b; i += 1) {
    const w = (2 * Math.PI * freq * i) / SR;
    re += x[i] * Math.cos(w);
    im -= x[i] * Math.sin(w);
  }
  return (2 * Math.hypot(re, im)) / (b - a);
}
const db = (a: number, b: number) => 20 * Math.log10(a / b);

describe("STFT / ISTFT", () => {
  it("reconstructs a signal perfectly when no frame is modified", () => {
    let seed = 7;
    for (const length of [1, 100, 2047, 2048, 5000, 12345]) {
      const x = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        x[i] = (seed / 4294967296 - 0.5) * 1.6;
      }
      const y = stftInverse(stftForward(x), length);
      let worst = 0;
      for (let i = 0; i < length; i += 1) worst = Math.max(worst, Math.abs(y[i] - x[i]));
      expect(worst, `length ${length}`).toBeLessThan(2e-5);
    }
  });

  it("reconstructs a long tonal signal, edges included, to better than -100 dB", () => {
    const x = tones(1.5, [[440, 0.4], [2500, 0.2]]);
    const y = stftInverse(stftForward(x), x.length);
    let err = 0;
    let energy = 0;
    for (let i = 0; i < x.length; i += 1) {
      err += (y[i] - x[i]) ** 2;
      energy += x[i] ** 2;
    }
    expect(10 * Math.log10(err / energy)).toBeLessThan(-100);
  });

  it("uses a squared-window overlap sum of 1.5 (the constant the exact reconstruction relies on)", () => {
    expect(getStftPlan().norm).toBeCloseTo(1.5, 6);
  });
});

describe("applySpectralRegions", () => {
  it("returns the input untouched without active regions, and an unchanged copy for 0 dB", () => {
    const x = tones(1, [[1000, 0.3]]);
    expect(applySpectralRegionsToChannel(x, SR, [])).toBe(x);
    expect(applySpectralRegionsToChannel(x, SR, [region({ mode: "remove", enabled: false })])).toBe(x);
    const same = applySpectralRegionsToChannel(x, SR, [region({ mode: "attenuate", gainDb: 0, lowHz: 500, highHz: 2000 })]);
    expect(same).not.toBe(x);
    let worst = 0;
    for (let i = 0; i < x.length; i += 1) worst = Math.max(worst, Math.abs(same[i] - x[i]));
    expect(worst).toBeLessThan(1e-6);
  });

  it("removes a tone with a region covering it and leaves the other tones within tolerance", () => {
    const x = tones(3, [[440, 0.3], [1000, 0.3], [3000, 0.3]]);
    const y = applySpectralRegionsToChannel(x, SR, [region({ mode: "remove", startTime: 0, endTime: 3, lowHz: 900, highHz: 1100 })]);
    expect(db(amp(x, 1000, 0.5, 2.5), amp(y, 1000, 0.5, 2.5)), "1 kHz tone removed").toBeGreaterThan(30);
    expect(Math.abs(db(amp(y, 440, 0.5, 2.5), amp(x, 440, 0.5, 2.5))), "440 Hz").toBeLessThan(0.05);
    expect(Math.abs(db(amp(y, 3000, 0.5, 2.5), amp(x, 3000, 0.5, 2.5))), "3 kHz").toBeLessThan(0.05);
  });

  it("removes a tone only inside the region's time span", () => {
    const x = tones(3, [[1000, 0.3], [440, 0.2]]);
    const y = applySpectralRegionsToChannel(x, SR, [region({ mode: "remove", startTime: 1, endTime: 2, lowHz: 900, highHz: 1100 })]);
    expect(db(amp(x, 1000, 1.15, 1.85), amp(y, 1000, 1.15, 1.85)), "inside").toBeGreaterThan(25);
    for (const [from, to] of [[0.1, 0.8], [2.2, 2.9]] as const) {
      expect(Math.abs(db(amp(y, 1000, from, to), amp(x, 1000, from, to))), `outside ${from}-${to}`).toBeLessThan(0.1);
    }
    expect(Math.abs(db(amp(y, 440, 1.15, 1.85), amp(x, 440, 1.15, 1.85)))).toBeLessThan(0.05);
  });

  it("interpolates a click from the surrounding frames", () => {
    const x = tones(2, [[500, 0.2]], (i) => (i === SR ? 0.8 : 0));
    const before = Math.max(...Array.from(x.subarray(SR - 480, SR + 480), Math.abs));
    expect(before).toBeGreaterThan(0.65);
    const y = applySpectralRegionsToChannel(x, SR, [region({ mode: "remove", startTime: 0.99, endTime: 1.01, lowHz: 0, highHz: SR / 2 })]);
    const after = Math.max(...Array.from(y.subarray(SR - 480, SR + 480), Math.abs));
    expect(after).toBeLessThan(0.3);
    expect(Math.abs(db(amp(y, 500, 0.2, 0.9), amp(x, 500, 0.2, 0.9)))).toBeLessThan(0.05);
  });

  it("attenuates a tone by exactly N dB", () => {
    const x = tones(3, [[1000, 0.5], [5000, 0.25]]);
    for (const n of [3, 6, 12, 24, 40]) {
      const y = applySpectralRegionsToChannel(x, SR, [region({ mode: "attenuate", startTime: 0.5, endTime: 2.5, lowHz: 800, highHz: 1200, gainDb: -n })]);
      const measured = db(amp(x, 1000, 1, 2), amp(y, 1000, 1, 2));
      expect(measured, `-${n} dB`).toBeGreaterThan(n - 0.1);
      expect(measured, `-${n} dB`).toBeLessThan(n + 0.1);
      expect(Math.abs(db(amp(y, 5000, 1, 2), amp(x, 5000, 1, 2))), "5 kHz untouched").toBeLessThan(0.01);
      expect(Math.abs(db(amp(y, 1000, 0.05, 0.3), amp(x, 1000, 0.05, 0.3))), "before the region").toBeLessThan(0.02);
    }
  });

  it("a frequency-band marquee over the whole source attenuates from the first to the last sample", () => {
    const x = tones(2, [[2000, 0.4], [300, 0.4]]);
    const y = applySpectralRegionsToChannel(x, SR, [region({ mode: "attenuate", startTime: 0, endTime: 2, lowHz: 1500, highHz: 2500, gainDb: -20 })]);
    for (const [from, to] of [[0.01, 0.15], [1.85, 1.99]] as const) {
      expect(db(amp(x, 2000, from, to), amp(y, 2000, from, to)), `${from}-${to}`).toBeGreaterThan(17);
      expect(Math.abs(db(amp(y, 300, from, to), amp(x, 300, from, to)))).toBeLessThan(0.1);
    }
  });

  it("is deterministic and processes every channel", () => {
    const left = tones(1, [[800, 0.3], [2000, 0.2]]);
    const right = tones(1, [[800, 0.1], [2000, 0.3]]);
    const regions = [region({ mode: "remove", startTime: 0.2, endTime: 0.8, lowHz: 700, highHz: 900 })];
    const a = applySpectralRegions([left, right], SR, regions);
    const b = applySpectralRegions([left, right], SR, regions);
    expect(Array.from(a[0])).toEqual(Array.from(b[0]));
    expect(Array.from(a[1])).toEqual(Array.from(b[1]));
    expect(db(amp(left, 800, 0.35, 0.65), amp(a[0], 800, 0.35, 0.65))).toBeGreaterThan(25);
    expect(db(amp(right, 800, 0.35, 0.65), amp(a[1], 800, 0.35, 0.65))).toBeGreaterThan(25);
    expect(Math.abs(db(amp(a[1], 2000, 0.35, 0.65), amp(right, 2000, 0.35, 0.65)))).toBeLessThan(0.05);
  });

  it("applies overlapping regions in order", () => {
    const x = tones(2, [[1000, 0.4]]);
    const y = applySpectralRegionsToChannel(x, SR, [
      region({ mode: "attenuate", startTime: 0, endTime: 2, lowHz: 800, highHz: 1200, gainDb: -6, id: "a" }),
      region({ mode: "attenuate", startTime: 0, endTime: 2, lowHz: 800, highHz: 1200, gainDb: -6, id: "b" }),
    ]);
    expect(db(amp(x, 1000, 0.5, 1.5), amp(y, 1000, 0.5, 1.5))).toBeGreaterThan(11.8);
  });
});

describe("spectral regions model", () => {
  it("sanitises untrusted input", () => {
    const out = sanitizeSpectralRegions([
      { mode: "attenuate", startTime: 2, endTime: 1, lowHz: 5000, highHz: 100, gainDb: 5, id: "a" },
      { mode: "remove", startTime: 0, endTime: 1, lowHz: 100, highHz: 200 },
      { mode: "bogus", startTime: 0, endTime: 1, lowHz: 100, highHz: 200 },
      { mode: "remove", startTime: 0, endTime: 0, lowHz: 100, highHz: 200 },
      { mode: "remove", startTime: 0, endTime: 1, lowHz: NaN, highHz: 200 },
      null,
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "a", startTime: 1, endTime: 2, lowHz: 100, highHz: 5000, gainDb: 0, enabled: true });
    expect(sanitizeSpectralRegions("nope")).toEqual([]);
  });

  it("keys only what changes the audio", () => {
    const a = region({ mode: "remove", id: "x" });
    expect(spectralRegionsKey([a])).toBe(spectralRegionsKey([{ ...a, id: "y" }]));
    expect(spectralRegionsKey([{ ...a, enabled: false }])).toBe("");
    expect(spectralRegionsKey([a])).not.toBe(spectralRegionsKey([{ ...a, highHz: 1000 }]));
  });
});

describe("computeSpectralView", () => {
  it("puts a full-scale tone at its frequency on an absolute dBFS scale", () => {
    const x = tones(1, [[3000, 1]]);
    const view = computeSpectralView([x], SR, { maxFrames: 100 });
    const column = Math.floor(view.frames / 2);
    let best = 0;
    for (let k = 0; k < view.bins; k += 1) if (view.data[column * view.bins + k] > view.data[column * view.bins + best]) best = k;
    expect(Math.abs((best * SR) / view.fftSize - 3000)).toBeLessThan(SR / view.fftSize);
    expect(view.data[column * view.bins + best]).toBeGreaterThan(245);
    const half = computeSpectralView([tones(1, [[3000, 0.5]])], SR, { maxFrames: 100 });
    // 6 dB lower over a 100 dB range is about 15 levels.
    expect(view.data[column * view.bins + best] - half.data[column * half.bins + best]).toBeGreaterThan(12);
    expect(view.data[column * view.bins + best] - half.data[column * half.bins + best]).toBeLessThan(18);
  });

  it("zooms into a time window", () => {
    const x = tones(2, [[1000, 0.5]]);
    const view = computeSpectralView([x], SR, { startTime: 0.5, endTime: 0.75, maxFrames: 50 });
    expect(view.startTime).toBeCloseTo(0.5, 4);
    expect(view.endTime).toBeCloseTo(0.75, 4);
    expect(view.frames).toBeLessThanOrEqual(50);
  });
});
