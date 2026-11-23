/** Independent verification: own signals, seeds and mask shapes (not the builder's bench cases). */
import { describe, expect, it } from "vitest";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { SR } from "./spectral-fixtures";
import { sanitizeSpectralRegions, type SpectralRegion } from "./spectral-regions";
import { amplificationDb, pinkNoise, scoreFill, whiteNoise } from "./spectral-heal-bench";

const base = { id: "v", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;
const N = (s: number): number => Math.round(s * SR);
const add = (...xs: Float32Array[]): Float32Array => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));
const sine = (len: number, hz: number, amp: number, t0 = 0, t1 = len / SR, vib = 0, vibHz = 5.5): Float32Array => {
  const out = new Float32Array(len);
  let ph = 0;
  for (let i = N(t0); i < Math.min(len, N(t1)); i += 1) {
    const t = i / SR;
    ph += (2 * Math.PI * hz * (1 + vib * Math.sin(2 * Math.PI * vibHz * t))) / SR;
    out[i] = amp * Math.sin(ph);
  }
  return out;
};
const floor = (len: number, seed: number): Float32Array => whiteNoise(len / SR, 0.004, seed);
const vibratoVoice = (len: number): Float32Array => {
  const parts: Float32Array[] = [];
  for (let h = 1; h <= 12; h += 1) parts.push(sine(len, 210 * h, 0.05 / Math.pow(h, 0.8), 0, len / SR, 0.012, 5.2));
  return add(...parts, floor(len, 31));
};
const chord = (len: number, vib = 0): Float32Array => add(floor(len, 32), sine(len, 220, 0.06, 0, 9, vib), sine(len, 277.18, 0.05, 0, 9, vib), sine(len, 329.63, 0.05, 0, 9, vib), sine(len, 880, 0.02, 0, 9, vib));
const click = (len: number, t0: number, ms: number, amp: number): Float32Array => {
  const out = new Float32Array(len);
  let s = 77;
  for (let i = N(t0); i < N(t0 + ms / 1000); i += 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = amp * (s / 4294967296 - 0.5) * 2;
  }
  return out;
};
const rect = (a: number, b: number, lo: number, hi: number) => (mode: "remove" | "heal" | "attenuate"): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, mode, gainDb: mode === "attenuate" ? -20 : -120, startTime: a, endTime: b, lowHz: lo, highHz: hi }])[0];
const lasso = (pts: Array<[number, number]>) => (mode: "remove" | "heal"): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, mode, shape: "lasso", points: pts.map(([t, hz]) => ({ t, hz })) }])[0];
const brush = (pts: Array<[number, number]>, s: number, o: number) => (mode: "remove" | "heal"): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, mode, shape: "brush", brushSeconds: s, brushOctaves: o, points: pts.map(([t, hz]) => ({ t, hz })) }])[0];

interface Case { name: string; clean: Float32Array; noisy: Float32Array; region: (m: "remove" | "heal") => SpectralRegion }
const L = N(2);
const cases: Case[] = [];
{ const c = pinkNoise(2, 0.04, 101); cases.push({ name: "440 Hz tone, pink, rect 0.7-1.3s", clean: c, noisy: add(c, sine(L, 440, 0.08, 0.5, 1.5)), region: rect(0.67, 1.33, 380, 500) }); }
{ const c = whiteNoise(2, 0.03, 102); cases.push({ name: "2.2k tone, white, brush", clean: c, noisy: add(c, sine(L, 2200, 0.08, 0.5, 1.5)), region: brush([[0.6, 2200], [1.4, 2200]], 0.03, 0.08) }); }
{ const c = vibratoVoice(L); cases.push({ name: "vibrato harmonic voice, click 40ms 1-6k", clean: c, noisy: add(c, click(L, 1.0, 40, 0.3)), region: rect(0.98, 1.07, 1000, 6000) }); }
{ const c = vibratoVoice(L); cases.push({ name: "vibrato voice, whistle glide lasso", clean: c, noisy: add(c, sine(L, 2500, 0.06, 0.5, 1.5, 0.1, 1.5)), region: lasso([[0.5, 1900], [1.5, 1900], [1.5, 3600], [0.5, 3600]]) }); }
{ const c = chord(L); cases.push({ name: "steady chord, 80ms click 3-8k", clean: c, noisy: add(c, click(L, 1.0, 80, 0.2)), region: rect(0.98, 1.1, 3000, 8000) }); }
{ const c = chord(L); cases.push({ name: "steady chord, cough burst low 150-1500, 0.3s", clean: c, noisy: add(c, click(L, 0.9, 300, 0.1)), region: rect(0.88, 1.22, 150, 1500) }); }
{ const c = chord(L, 0.004); cases.push({ name: "vibrato chord, cough lasso diag", clean: c, noisy: add(c, click(L, 0.9, 300, 0.1)), region: lasso([[0.88, 100], [1.22, 400], [1.22, 1500], [0.88, 1200]]) }); }
{ const c = pinkNoise(2, 0.05, 103); cases.push({ name: "pink noise, burst, rect (nothing predictable)", clean: c, noisy: add(c, click(L, 1.0, 100, 0.3)), region: rect(0.97, 1.13, 200, 8000) }); }
{ const c = whiteNoise(2, 0.05, 104); cases.push({ name: "white noise, long 0.8s tone selection", clean: c, noisy: add(c, sine(L, 600, 0.05, 0, 2)), region: rect(0.5, 1.3, 500, 700) }); }

const f = (x: number): string => x.toFixed(1).padStart(6);
const rows = cases.map((c) => {
  const rm = c.region("remove"); const hl = c.region("heal");
  const oR = applySpectralRegionsToChannel(c.noisy, SR, [rm]);
  const oH = applySpectralRegionsToChannel(c.noisy, SR, [hl]);
  return { c, none: scoreFill(c.noisy, c.clean, hl), rm: scoreFill(oR, c.clean, rm), hl: scoreFill(oH, c.clean, hl), amp: [3e-8, 1e-7, 1 / 32768, 1e-3].map((a) => ({ a, r: amplificationDb(c.noisy, rm, a), h: amplificationDb(c.noisy, hl, a) })), oH };
});

describe("independent heal verification", () => {
  it("prints table", () => {
    const out = rows.map((r) => `${r.c.name.padEnd(46)} none ${f(r.none.errDb)} | rm err ${f(r.rm.errDb)} lvl ${f(r.rm.levelDb)} | heal err ${f(r.hl.errDb)} lvl ${f(r.hl.levelDb)} corr ${r.hl.corr.toFixed(2)} hole ${(r.hl.holes * 100).toFixed(0)}% | amp(rm/heal) ${r.amp.map((x) => `${x.r.toFixed(1)}/${x.h.toFixed(1)}`).join("  ")}`);
    console.info("\nVERIFY TABLE (errDb vs clean; lvl dB; amp at 3e-8, 1e-7, 1LSB, 1e-3)\n" + out.join("\n"));
    expect(rows.length).toBe(cases.length);
  });
  it("heal is deterministic and finite", () => {
    for (const r of rows) {
      const again = applySpectralRegionsToChannel(r.c.noisy, SR, [r.c.region("heal")]);
      expect(again).toEqual(r.oH);
      for (const v of r.oH) if (!Number.isFinite(v)) throw new Error("nonfinite");
    }
  });
  it("amplification of heal stays within remove + 6 dB at every perturbation size", () => {
    for (const r of rows) for (const x of r.amp) expect(x.h, `${r.c.name} @${x.a}`).toBeLessThan(Math.max(x.r, 0) + 6);
  });
  it("samples outside the mask time range (far) are untouched by heal", () => {
    for (const r of rows) {
      const region = r.c.region("heal");
      const pad = N(0.4);
      const a = Math.max(0, N(region.startTime) - pad);
      const b = Math.min(L, N(region.endTime) + pad);
      for (let i = 0; i < a; i += 1) expect(Math.abs(r.oH[i] - r.c.noisy[i])).toBeLessThan(1e-4);
      for (let i = b; i < L; i += 1) expect(Math.abs(r.oH[i] - r.c.noisy[i])).toBeLessThan(1e-4);
    }
  });
});
