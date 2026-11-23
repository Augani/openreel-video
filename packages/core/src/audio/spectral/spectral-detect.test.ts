import { describe, expect, it } from "vitest";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { clickRegion, findSpectralClicks, findSpectralTones, toneRegion } from "./spectral-detect";
import { SR, speechLike, sum } from "./spectral-fixtures";

const tone = (length: number, hz: number, from: number, to: number, amplitude: number): Float32Array => {
  const out = new Float32Array(length);
  for (let i = Math.floor(from * SR); i < Math.min(length, Math.floor(to * SR)); i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
};

const bandEnergy = (x: Float32Array, hz: number, from: number, to: number): number => {
  let re = 0;
  let im = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i += 1) {
    re += x[i] * Math.cos((2 * Math.PI * hz * i) / SR);
    im -= x[i] * Math.sin((2 * Math.PI * hz * i) / SR);
  }
  return (2 * Math.hypot(re, im)) / ((to - from) * SR);
};

describe("finding and removing a stationary tone", () => {
  it("finds a steady 3.1 kHz carrier under speech and heals it away", () => {
    const clean = speechLike(2);
    const carrier = tone(clean.length, 3100, 0.4, 1.6, 0.05);
    const noisy = sum(clean, carrier);
    const found = findSpectralTones(noisy, SR);
    expect(found.length).toBeGreaterThanOrEqual(1);
    const top = found[0];
    expect(top.hz).toBeGreaterThan(3085);
    expect(top.hz).toBeLessThan(3115);
    expect(top.startTime).toBeGreaterThan(0.3);
    expect(top.startTime).toBeLessThan(0.55);
    expect(top.endTime).toBeGreaterThan(1.45);
    expect(top.endTime).toBeLessThan(1.75);
    expect(top.prominenceDb).toBeGreaterThan(15);
    const before = bandEnergy(noisy, 3100, 0.7, 1.3);
    const out = applySpectralRegionsToChannel(noisy, SR, [toneRegion(top, "t", SR)]);
    const after = bandEnergy(out, 3100, 0.7, 1.3);
    expect(20 * Math.log10(after / before)).toBeLessThan(-20);
    // The speech around it is untouched where it is far from the tone.
    expect(bandEnergy(out, 1000, 0.7, 1.3) / bandEnergy(noisy, 1000, 0.7, 1.3)).toBeGreaterThan(0.9);
  });

  it("reports nothing for speech alone", () => {
    expect(findSpectralTones(speechLike(2), SR, { minProminenceDb: 25 })).toEqual([]);
  });
});

describe("finding and removing clicks", () => {
  it("finds a loud click and its region heals it", () => {
    const clean = speechLike(1.5);
    const click = new Float32Array(clean.length);
    const at = Math.round(0.8 * SR);
    click[at] = 2.5;
    click[at + 1] = -1.8;
    const noisy = sum(clean, click);
    const clicks = findSpectralClicks(noisy, SR);
    expect(clicks.length).toBe(1);
    expect(Math.abs(clicks[0].time - 0.8)).toBeLessThan(0.01);
    const out = applySpectralRegionsToChannel(noisy, SR, [clickRegion(clicks[0], "c", SR, 1.5)]);
    const err = (x: Float32Array) => {
      let e = 0;
      for (let i = Math.floor(0.75 * SR); i < Math.floor(0.85 * SR); i += 1) e += (x[i] - clean[i]) ** 2;
      return e;
    };
    expect(10 * Math.log10(err(noisy) / err(out))).toBeGreaterThan(6);
  });

  it("finds no click in clean speech", () => {
    expect(findSpectralClicks(speechLike(1.5), SR)).toEqual([]);
  });
});
