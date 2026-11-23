/** Independent parameters (1730 Hz tone, 4 s) for the heal advice and for remove versus heal on a slice of a persistent tone. */
import { describe, expect, it } from "vitest";
import { adviseHeal } from "./spectral-heal-advice";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { sanitizeSpectralRegions } from "./spectral-regions";
import { SR, speechLike } from "./spectral-fixtures";

const SRATE = SR;
const N = (s: number): number => Math.round(s * SRATE);
const toneSig = (seconds: number, hz: number, amp: number, t0: number, t1: number): Float32Array => {
  const out = new Float32Array(N(seconds));
  for (let i = N(t0); i < Math.min(out.length, N(t1)); i += 1) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SRATE);
  return out;
};
const mix = (a: Float32Array, b: Float32Array): Float32Array => a.map((v, i) => v + b[i]);
const bandDb = (x: Float32Array, hz: number, t0: number, t1: number): number => {
  // Goertzel-free: correlate with sin/cos at hz.
  let c = 0;
  let s = 0;
  for (let i = N(t0); i < N(t1); i += 1) {
    c += x[i] * Math.cos((2 * Math.PI * hz * i) / SRATE);
    s += x[i] * Math.sin((2 * Math.PI * hz * i) / SRATE);
  }
  const n = N(t1) - N(t0);
  return 20 * Math.log10((2 * Math.hypot(c, s)) / n + 1e-9);
};
const base = { id: "v", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;

describe("verify r21: heal advice and slice removal", () => {
  const clean = speechLike(4, 23);
  const noisy = mix(clean, toneSig(4, 1730, 0.04, 0, 4));
  const region = { startTime: 1.9, endTime: 2.15, lowHz: 1680, highHz: 1780 };

  it("flags a slice of a persistent 1730 Hz tone, not at the clip edge or a noise band", () => {
    expect(adviseHeal(noisy, SRATE, region).continuesBothSides).toBe(true);
    // a long slice: heal no longer carries the tone, so there is nothing to warn about
    expect(adviseHeal(noisy, SRATE, { ...region, endTime: 2.5 }).continuesBothSides).toBe(false);
    // slice abutting the clip start: nothing before it
    expect(adviseHeal(noisy, SRATE, { ...region, startTime: 0.01, endTime: 0.5 }).continuesBothSides).toBe(false);
    // a band at a frequency with no tone
    expect(adviseHeal(noisy, SRATE, { ...region, lowHz: 5200, highHz: 5400 }).continuesBothSides).toBe(false);
    // tone only before and during, region covers the end: nothing after
    const half = mix(clean, toneSig(4, 1730, 0.04, 0, 2.15));
    expect(adviseHeal(half, SRATE, region).continuesBothSides).toBe(false);
  });

  it("remove takes the slice of the tone out, heal leaves it in", () => {
    const short = { ...region, startTime: 2.0, endTime: 2.2 };
    const mk = (mode: "remove" | "heal") => sanitizeSpectralRegions([{ ...base, mode, ...short }]);
    const removed = applySpectralRegionsToChannel(noisy, SRATE, mk("remove"));
    const healed = applySpectralRegionsToChannel(noisy, SRATE, mk("heal"));
    const before = bandDb(noisy, 1730, 2.03, 2.17);
    const afterRemove = bandDb(removed, 1730, 2.03, 2.17);
    const afterHeal = bandDb(healed, 1730, 2.03, 2.17);
    expect(afterRemove).toBeLessThan(before - 20);
    expect(afterHeal).toBeGreaterThan(before - 6);
  });
});
