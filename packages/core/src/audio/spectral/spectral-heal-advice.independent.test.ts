import { describe, expect, it } from "vitest";
import { adviseHeal } from "./spectral-heal-advice";
import { SR, speechLike, sum } from "./spectral-fixtures";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { sanitizeSpectralRegions } from "./spectral-regions";

const tone = (length: number, hz: number, amplitude: number): Float32Array => {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};
const levelDb = (x: Float32Array, hz: number, t0: number, t1: number): number => {
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

describe("adviseHeal verified independently (other tone, seed, level, position)", () => {
  const HZ = 2213;
  const clean = speechLike(5, 5);
  const noisy = sum(clean, tone(clean.length, HZ, 0.08));
  const band = { lowHz: 2150, highHz: 2280 };
  const center = 2.7;
  const rows: string[] = [];
  it.each([0.1, 0.25, 0.4, 0.8])("slice %s s: advice matches what heal leaves", (seconds) => {
    const region = { ...band, startTime: center - seconds / 2, endTime: center + seconds / 2 };
    const advice = adviseHeal(noisy, SR, region);
    const healed = applySpectralRegionsToChannel(noisy, SR, sanitizeSpectralRegions([{ id: "h", enabled: true, mode: "heal", gainDb: -120, ...region }]));
    const a = region.startTime + Math.min(0.06, seconds * 0.15);
    const b = region.endTime - Math.min(0.06, seconds * 0.15);
    const left = levelDb(healed, HZ, a, b) - levelDb(noisy, HZ, a, b);
    rows.push(`${seconds}s advice=${advice.continuesBothSides} retainedDb=${advice.retainedDb} measuredLeft=${left.toFixed(1)}dB`);
    console.log(rows[rows.length - 1]);
    if (left > -8) expect(advice.continuesBothSides, `heal left ${left.toFixed(1)} dB`).toBe(true);
    if (left < -12) expect(advice.continuesBothSides, `heal left ${left.toFixed(1)} dB`).toBe(false);
  });
  it("is deterministic and does not mutate input", () => {
    const copy = noisy.slice();
    const r = { ...band, startTime: 2.55, endTime: 2.9 };
    expect(adviseHeal(noisy, SR, r)).toEqual(adviseHeal(noisy, SR, r));
    expect(noisy).toEqual(copy);
  });
  it("edge cases: region at file start/end and zero-length do not throw", () => {
    expect(() => adviseHeal(noisy, SR, { ...band, startTime: 0, endTime: 0.3 })).not.toThrow();
    expect(() => adviseHeal(noisy, SR, { ...band, startTime: 4.7, endTime: 5 })).not.toThrow();
    expect(() => adviseHeal(noisy, SR, { ...band, startTime: 2, endTime: 2 })).not.toThrow();
    expect(() => adviseHeal(noisy, SR, { ...band, startTime: 4.9, endTime: 9 })).not.toThrow();
  });
});
