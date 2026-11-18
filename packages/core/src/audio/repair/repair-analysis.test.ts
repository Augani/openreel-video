import { describe, expect, it } from "vitest";
import { analyzeAudioIssues, computeSpectrogram, suggestRepairs } from "./repair-analysis";

const SR = 48000;
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

/** Voiced "syllables" (harmonic series on 140 Hz with a slow envelope) and a little noise floor. */
function dialogue(seconds: number, seed = 1): Float32Array {
  const n = Math.floor(seconds * SR);
  const rnd = mulberry(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const env = Math.max(0, Math.sin(2 * Math.PI * 2.5 * t)) ** 1.5;
    let v = 0;
    for (let h = 1; h <= 12; h += 1) v += Math.sin(2 * Math.PI * 140 * h * t + h) / h;
    out[i] = 0.25 * env * v + (rnd() - 0.5) * 0.002;
  }
  return out;
}

describe("analyzeAudioIssues", () => {
  it("finds nothing in clean dialogue", () => {
    const r = analyzeAudioIssues([dialogue(4)], SR);
    expect(r.hum.present).toBe(false);
    expect(r.clipping.present).toBe(false);
    expect(r.clicks.present).toBe(false);
    expect(r.sibilance.present).toBe(false);
    expect(suggestRepairs(r)).toEqual([]);
  });

  it("detects 50 Hz and 60 Hz hum and tells them apart", () => {
    for (const f of [50, 60]) {
      const x = dialogue(4);
      for (let i = 0; i < x.length; i += 1) {
        const w = (2 * Math.PI * f * i) / SR;
        x[i] += 0.03 * Math.sin(w) + 0.02 * Math.sin(2 * w) + 0.01 * Math.sin(3 * w);
      }
      const r = analyzeAudioIssues([x], SR);
      expect(r.hum.present).toBe(true);
      expect(r.hum.frequency).toBe(f);
    }
  });

  it("detects clipping and suggests a DeClip threshold just under the plateau", () => {
    const x = dialogue(4);
    for (let i = 0; i < x.length; i += 1) x[i] = Math.max(-0.6, Math.min(0.6, x[i] * 3));
    const r = analyzeAudioIssues([x], SR);
    expect(r.clipping.present).toBe(true);
    const s = suggestRepairs(r).find((e) => e.type === "deClip");
    expect(s).toBeTruthy();
    expect(s!.params.threshold).toBeLessThan(-4);
    expect(s!.params.threshold).toBeGreaterThan(-6);
  });

  it("detects injected clicks", () => {
    const x = dialogue(4);
    for (const c of [20000, 50000, 90000, 140000]) x[c] += 0.7;
    const r = analyzeAudioIssues([x], SR);
    expect(r.clicks.present).toBe(true);
    expect(r.clicks.count).toBeGreaterThanOrEqual(4);
  });

  it("detects harsh sibilance and suggests a threshold", () => {
    const x = dialogue(4);
    const rnd = mulberry(5);
    for (let s = 0; s < 6; s += 1) {
      const a = Math.floor((0.3 + s * 0.6) * SR);
      for (let i = 0; i < 0.12 * SR; i += 1) {
        x[a + i] += 0.25 * Math.sin((Math.PI * i) / (0.12 * SR)) * (rnd() - 0.5) * 2 * Math.sin((2 * Math.PI * 7000 * i) / SR + rnd() * 6);
      }
    }
    const r = analyzeAudioIssues([x], SR);
    expect(r.sibilance.present).toBe(true);
    expect(r.sibilance.centerHz).toBeGreaterThan(5500);
    expect(r.sibilance.centerHz).toBeLessThan(8500);
  });
});

describe("computeSpectrogram", () => {
  it("shows a tone at the right bin", () => {
    const x = new Float32Array(SR * 2);
    for (let i = 0; i < x.length; i += 1) x[i] = 0.2 * Math.sin((2 * Math.PI * 1000 * i) / SR);
    const sp = computeSpectrogram(x, SR, { fftSize: 2048, maxFrames: 60 });
    const bin = Math.round(1000 / (SR / 2048));
    let peak = 0;
    let peakBin = 0;
    for (let k = 0; k < sp.bins; k += 1) {
      const v = sp.data[10 * sp.bins + k];
      if (v > peak) {
        peak = v;
        peakBin = k;
      }
    }
    expect(Math.abs(peakBin - bin)).toBeLessThanOrEqual(1);
    expect(peak).toBe(255);
    expect(sp.frames).toBeLessThanOrEqual(60);
  });

  it("does not count the joins of stitched excerpts as clicks when segment lengths are given", () => {
    const n = SR;
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      a[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SR);
      b[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SR + Math.PI / 2);
    }
    const joined = new Float32Array(2 * n);
    joined.set(a);
    joined.set(b, n);
    expect(analyzeAudioIssues([joined], SR).clicks.count).toBeGreaterThan(0);
    expect(analyzeAudioIssues([joined], SR, [n, n]).clicks.count).toBe(0);
  });
});
