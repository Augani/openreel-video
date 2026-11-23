import { describe, expect, it } from "vitest";
import { applySpectralRegionsToChannel, applySpectralRegions } from "./spectral-dsp";
import { sanitizeSpectralRegions, type SpectralRegion } from "./spectral-regions";
import { rasterizeRegionMask } from "./spectral-mask";

const SR = 44100;
const base = { id: "a", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;
function noise(n: number, seed = 5, amp = 0.05): Float32Array {
  let s = seed;
  return Float32Array.from({ length: n }, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return amp * (s / 4294967296 - 0.5) * 2; });
}
const tone = (n: number, f: number, a: number) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));
const add = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]);
const finiteAll = (x: Float32Array) => x.every(Number.isFinite);

const mk = (r: Partial<SpectralRegion> & { mode: SpectralRegion["mode"] }): SpectralRegion[] => sanitizeSpectralRegions([{ ...base, ...r }]);

describe("spectral masks: edge cases (self-intersecting lasso, edge brushes, tiny and out-of-range regions, short and silent audio)", () => {
  const sig = add(noise(SR * 1, 3), tone(SR, 2000, 0.1));
  const cases: Record<string, SpectralRegion[]> = {
    bowtie: mk({ mode: "heal", shape: "lasso", points: [{ t: 0.2, hz: 1000 }, { t: 0.6, hz: 3000 }, { t: 0.6, hz: 1000 }, { t: 0.2, hz: 3000 }] }),
    brushStart: mk({ mode: "heal", shape: "brush", points: [{ t: 0, hz: 0 }, { t: 0.05, hz: 30 }], brushSeconds: 0.05, brushOctaves: 0.5 }),
    brushEnd: mk({ mode: "heal", shape: "brush", points: [{ t: 0.99, hz: 21000 }, { t: 1.2, hz: 22050 }], brushSeconds: 0.1, brushOctaves: 0.3 }),
    brushPastNyquist: mk({ mode: "heal", shape: "brush", points: [{ t: 0.4, hz: 60000 }], brushSeconds: 0.05, brushOctaves: 0.2 }),
    brushPastEnd: mk({ mode: "heal", shape: "brush", points: [{ t: 5, hz: 1000 }], brushSeconds: 0.05, brushOctaves: 0.2 }),
    tinyLasso: mk({ mode: "heal", shape: "lasso", points: [{ t: 0.5, hz: 1000 }, { t: 0.5005, hz: 1000 }, { t: 0.5005, hz: 1002 }] }),
    tinyBrush: mk({ mode: "heal", shape: "brush", points: [{ t: 0.5, hz: 1000 }], brushSeconds: 0.001, brushOctaves: 0.005 }),
    tinyRectHeal: mk({ mode: "heal", startTime: 0.5, endTime: 0.5002, lowHz: 1000, highHz: 1001 }),
    wholeSignal: mk({ mode: "heal", startTime: 0, endTime: 1, lowHz: 0, highHz: 22050 }),
    wholeLasso: mk({ mode: "heal", shape: "lasso", feather: 8, points: [{ t: 0, hz: 0 }, { t: 1, hz: 0 }, { t: 1, hz: 22050 }, { t: 0, hz: 22050 }] }),
    attLasso: mk({ mode: "attenuate", gainDb: -20, shape: "lasso", points: [{ t: 0.1, hz: 500 }, { t: 0.8, hz: 500 }, { t: 0.5, hz: 4000 }] }),
    removeBrush: mk({ mode: "remove", shape: "brush", points: [{ t: 0.1, hz: 500 }, { t: 0.8, hz: 4000 }] }),
    nanPoints: sanitizeSpectralRegions([{ ...base, mode: "heal", shape: "lasso", points: [{ t: NaN, hz: 1 }, { t: 0.1, hz: 100 }, { t: 0.3, hz: 100 }, { t: 0.2, hz: 900 }] }]),
    collinear: mk({ mode: "heal", shape: "lasso", points: [{ t: 0.1, hz: 500 }, { t: 0.2, hz: 1000 }, { t: 0.3, hz: 2000 }] }),
  };
  for (const [name, regs] of Object.entries(cases)) {
    it(`no NaN / same length / finite: ${name}`, () => {
      const out = applySpectralRegionsToChannel(sig, SR, regs);
      expect(out.length).toBe(sig.length);
      expect(finiteAll(out)).toBe(true);
      const again = applySpectralRegionsToChannel(sig, SR, regs);
      expect(Array.from(again)).toEqual(Array.from(out));
    });
  }
  it("short signals (< window) and silent signals", () => {
    for (const n of [1, 100, 1500, 2048, 2600]) {
      for (const shape of ["lasso", "brush"] as const) {
        const s = noise(n, 4);
        const regs = mk({ mode: "heal", shape, points: shape === "lasso" ? [{ t: 0, hz: 100 }, { t: 0.1, hz: 100 }, { t: 0.05, hz: 5000 }] : [{ t: 0.01, hz: 1000 }], brushSeconds: 0.02 });
        const out = applySpectralRegionsToChannel(s, SR, regs);
        expect(out.length).toBe(n);
        expect(finiteAll(out)).toBe(true);
      }
    }
    const zeros = new Float32Array(SR);
    const out = applySpectralRegionsToChannel(zeros, SR, mk({ mode: "heal", startTime: 0.2, endTime: 0.5, lowHz: 100, highHz: 5000 }));
    expect(finiteAll(out)).toBe(true);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(1e-6);
    expect(applySpectralRegionsToChannel(new Float32Array(0), SR, cases.bowtie).length).toBe(0);
  });
  it("outside time span bit-identical for edge brush", () => {
    const out = applySpectralRegionsToChannel(sig, SR, cases.brushEnd);
    for (let i = 0; i < 20000; i++) expect(out[i]).toBe(sig[i]);
  });
  it("mask raster: no-cover -> null, weights within [0,1]", () => {
    const grid = { sampleRate: SR, size: 2048, hop: 512, firstFrame: -3, lastFrame: 90 };
    expect(rasterizeRegionMask(cases.brushPastNyquist[0], grid)).toBeNull();
    expect(rasterizeRegionMask(cases.brushPastEnd[0], grid)).toBeNull();
    const m = rasterizeRegionMask(cases.bowtie[0], grid)!;
    expect(m).not.toBeNull();
    for (const v of m.weights) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it("stereo", () => {
    const [a, b] = applySpectralRegions([sig, tone(SR, 700, 0.2)], SR, cases.wholeSignal);
    expect(a.length).toBe(sig.length); expect(finiteAll(b)).toBe(true);
  });
});

