/** Round 23 independent verification: descending glide with fast vibrato, wand on a tone burst in noise (parameters differ from the R22 file). */
import { describe, expect, it } from "vitest";
import { SR, harmonicTone, maskEnergyShare, sum, trackErrorsCents, whiteNoise } from "./spectral-fixtures";
import { trackHarmonics } from "./spectral-harmonic";
import { decodeWandBits } from "./spectral-mask";
import { sanitizeSpectralRegions } from "./spectral-regions";
import { computeMagicWand } from "./spectral-wand";

const base = { id: "r23", enabled: true, gainDb: -120 } as const;

describe("R23 harmonic tracking on a falling glide", () => {
  // 420 -> 210 Hz over 2.5 s (-0.4 oct/s... exactly one octave in 2.5 s), +-40 cent vibrato at 6.3 Hz, 7 partials, white noise floor.
  const f0 = (t: number) => 420 * Math.pow(2, -t / 2.5) * Math.pow(2, (40 * Math.sin(2 * Math.PI * 6.3 * t)) / 1200);
  const harm = harmonicTone(2.5, f0, 7, 0.1, { rolloff: 0.8 });
  const white = whiteNoise(Math.round(2.5 * SR), 0.03, 77);
  const mix = sum(harm, white);
  it("tracks the voice from a seed 25 cents flat and selects it", () => {
    const r = trackHarmonics(mix, SR, { t: 1.1, hz: f0(1.1) * 0.9855 }, { harmonics: 7 });
    if (!r.ok) throw new Error(r.reason);
    const e = trackErrorsCents(r.points, f0);
    const [region] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "harmonic", points: r.points, harmonic: { harmonics: 7, maxHz: 20000, bandCents: 60 } }]);
    const inHarm = maskEnergyShare(harm, region);
    const inWhite = maskEnergyShare(white, region);
    console.log(`[R23 harmonic] span ${r.points[0].t.toFixed(2)}-${r.points[r.points.length - 1].t.toFixed(2)} s median err ${e[e.length >> 1].toFixed(1)} c, p95 ${e[Math.floor(e.length * 0.95)].toFixed(1)} c; harmonic in mask ${(inHarm * 100).toFixed(1)} %, white ${(inWhite * 100).toFixed(2)} %`);
    expect(e[e.length >> 1]).toBeLessThan(10);
    expect(inHarm).toBeGreaterThan(0.85);
    expect(inWhite).toBeLessThan(0.1);
  });
  it("the track is deterministic", () => {
    const a = trackHarmonics(mix, SR, { t: 0.8, hz: f0(0.8) }, { harmonics: 7 });
    const b = trackHarmonics(mix, SR, { t: 0.8, hz: f0(0.8) }, { harmonics: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("R23 wand on a 3 kHz tone burst in noise", () => {
  const len = Math.round(2 * SR);
  const noise = whiteNoise(len, 0.01, 4);
  const burst = new Float32Array(len);
  for (let i = Math.round(0.9 * SR); i < Math.round(1.1 * SR); i++) burst[i] = 0.3 * Math.sin((2 * Math.PI * 3000 * i) / SR);
  const mix = sum(noise, burst);
  it("selects the burst's cells, mostly the burst's energy, and a larger tolerance never selects fewer cells", () => {
    const sizes: number[] = [];
    for (const tol of [3, 6, 12]) {
      const r = computeMagicWand(mix, SR, { t: 1.0, hz: 3000 }, { toleranceDb: tol });
      if (!r.ok) throw new Error(`${tol}: ${r.reason}`);
      sizes.push(r.cells);
      const bits = decodeWandBits(r.wand);
      expect(bits.bits.reduce((s, v) => s + v, 0)).toBe(r.cells);
      const [region] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "wand", wand: r.wand } as never]);
      if (region) {
        const inBurst = maskEnergyShare(burst, region);
        const inNoise = maskEnergyShare(noise, region);
        console.log(`[R23 wand tol ${tol}] cells ${r.cells}, burst in mask ${(inBurst * 100).toFixed(1)} %, noise in mask ${(inNoise * 100).toFixed(2)} %`);
        if (tol === 6) {
          expect(inBurst).toBeGreaterThan(0.8);
          expect(inNoise).toBeLessThan(0.05);
        }
      }
    }
    expect(sizes[1]).toBeGreaterThanOrEqual(sizes[0]);
    expect(sizes[2]).toBeGreaterThanOrEqual(sizes[1]);
  });
  it("a seed in silence-ish noise far from the burst does not select the burst", () => {
    const r = computeMagicWand(mix, SR, { t: 1.8, hz: 800 }, { toleranceDb: 4 });
    if (r.ok) {
      const [region] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "wand", wand: r.wand } as never]);
      if (region) expect(maskEnergyShare(burst, region)).toBeLessThan(0.1);
    } else expect(["empty", "too-large", "fragmented", "out-of-range"]).toContain(r.reason);
  });
});
