import { describe, expect, it } from "vitest";
import { adviseHeal } from "./spectral-heal-advice";
import { SR, speechLike, sum } from "./spectral-fixtures";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { sanitizeSpectralRegions } from "./spectral-regions";

const tone = (length: number, hz: number, from: number, to: number, amplitude: number): Float32Array => {
  const out = new Float32Array(length);
  for (let i = Math.floor(from * SR); i < Math.min(length, Math.floor(to * SR)); i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};
const band = { lowHz: 3050, highHz: 3150 };
/** Level of one sinusoid in a window, dB (correlation with sin / cos at `hz`). */
const bandDb = (x: Float32Array, hz: number, t0: number, t1: number): number => {
  let c = 0;
  let s = 0;
  const from = Math.round(t0 * SR);
  const to = Math.round(t1 * SR);
  for (let i = from; i < to; i += 1) {
    c += x[i] * Math.cos((2 * Math.PI * hz * i) / SR);
    s += x[i] * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return 20 * Math.log10((2 * Math.hypot(c, s)) / (to - from) + 1e-9);
};

describe("adviseHeal", () => {
  it("flags a slice of a persistent whistle (steady on both sides)", () => {
    const clean = speechLike(3);
    const noisy = sum(clean, tone(clean.length, 3100, 0, 3, 0.05));
    const advice = adviseHeal(noisy, SR, { ...band, startTime: 1.2, endTime: 1.5 });
    expect(advice.continuesBothSides).toBe(true);
  });

  it("does not flag a region that covers the whole whistle", () => {
    const clean = speechLike(3);
    const noisy = sum(clean, tone(clean.length, 3100, 1, 2, 0.05));
    const advice = adviseHeal(noisy, SR, { ...band, startTime: 0.95, endTime: 2.05 });
    expect(advice.continuesBothSides).toBe(false);
  });

  it("does not flag a whistle that only continues on one side", () => {
    const clean = speechLike(3);
    const noisy = sum(clean, tone(clean.length, 3100, 1.2, 3, 0.05));
    const advice = adviseHeal(noisy, SR, { ...band, startTime: 1.2, endTime: 1.6 });
    expect(advice.before).toBe(false);
    expect(advice.continuesBothSides).toBe(false);
  });

  it("flags a slice of a persistent whistle selected with a wide box around it", () => {
    const clean = speechLike(3);
    const noisy = sum(clean, tone(clean.length, 3100, 0, 3, 0.05));
    expect(adviseHeal(noisy, SR, { lowHz: 2400, highHz: 4200, startTime: 1.2, endTime: 1.5 }).continuesBothSides).toBe(true);
  });

  it("does not flag a texture with no steady tone in it (noise, where heal is right)", () => {
    let seed = 11;
    const noise = new Float32Array(SR * 3);
    for (let i = 0; i < noise.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i] = 0.05 * (seed / 4294967296 - 0.5);
    }
    expect(adviseHeal(noise, SR, { lowHz: 1000, highHz: 5000, startTime: 1.2, endTime: 1.6 }).continuesBothSides).toBe(false);
    expect(adviseHeal(noise, SR, { lowHz: 3050, highHz: 3150, startTime: 1.2, endTime: 1.6 }).continuesBothSides).toBe(false);
  });

  describe("follows what heal really does at each slice length", () => {
    const clean = speechLike(4, 23);
    const noisy = sum(clean, tone(clean.length, 1730, 0, 4, 0.04));
    const narrow = { lowHz: 1680, highHz: 1780 };
    const wide = { lowHz: 1000, highHz: 3000 };
    const slice = (seconds: number) => ({ startTime: 2 - seconds / 2, endTime: 2 + seconds / 2 });

    it.each([0.08, 0.15, 0.2, 0.25])("flags a %s s slice (heal carries the tone through)", (seconds) => {
      expect(adviseHeal(noisy, SR, { ...narrow, ...slice(seconds) }).continuesBothSides).toBe(true);
      expect(adviseHeal(noisy, SR, { ...wide, ...slice(seconds) }).continuesBothSides).toBe(true);
    });

    it.each([0.45, 0.6, 0.9, 1.5])("does not flag a %s s slice (heal takes most of the tone out)", (seconds) => {
      const advice = adviseHeal(noisy, SR, { ...narrow, ...slice(seconds) });
      expect(advice.continuesBothSides).toBe(false);
      // Both sides are still steady: it is the slice length, not the surroundings, that decides.
      expect(advice.before && advice.after).toBe(true);
    });

    it("agrees with a real heal: kept tones are flagged, tones heal takes down by more than ~10 dB are not", () => {
      for (const seconds of [0.2, 0.3, 0.35, 0.4, 0.5, 0.6]) {
        const region = { ...narrow, ...slice(seconds) };
        const advice = adviseHeal(noisy, SR, region);
        const healed = applySpectralRegionsToChannel(noisy, SR, sanitizeSpectralRegions([{ id: "h", enabled: true, mode: "heal", gainDb: -120, ...region }]));
        const dropDb = bandDb(noisy, 1730, region.startTime + 0.06, region.endTime - 0.06) - bandDb(healed, 1730, region.startTime + 0.06, region.endTime - 0.06);
        // The advice threshold is a 10 dB drop; allow 2 dB of slack for the different level meters.
        if (dropDb < 8) expect(advice.continuesBothSides, `${seconds}s: heal dropped the tone ${dropDb.toFixed(1)} dB`).toBe(true);
        if (dropDb > 12) expect(advice.continuesBothSides, `${seconds}s: heal dropped the tone ${dropDb.toFixed(1)} dB`).toBe(false);
      }
    });

    it("reports the measured level change only where it had to run heal", () => {
      expect(adviseHeal(noisy, SR, { ...narrow, ...slice(0.1) }).retainedDb).toBeNull();
      expect(adviseHeal(noisy, SR, { ...narrow, ...slice(1.2) }).retainedDb).toBeNull();
      const mid = adviseHeal(noisy, SR, { ...narrow, ...slice(0.4) }).retainedDb;
      expect(mid).not.toBeNull();
      expect(mid as number).toBeLessThan(0);
    });
  });
});
