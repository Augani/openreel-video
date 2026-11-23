import { describe, expect, it } from "vitest";
import { applySpectralRegions, applySpectralRegionsToChannel } from "./spectral-dsp";
import { SR, energy, harmonicTone, maskEnergyShare, ratioDb, speechLike, sum, trackErrorsCents, whiteNoise } from "./spectral-fixtures";
import { findBoxSeed, trackHarmonics } from "./spectral-harmonic";
import { rasterizeRegionMask, maskWeight } from "./spectral-mask";
import { createSpectralRepairEffect, regionsNeedVersion2, sanitizeSpectralRegions, spectralRegionsKey, spectralRegionsVersion, type SpectralRegion } from "./spectral-regions";
import { computeMagicWand } from "./spectral-wand";

const base = { id: "a", enabled: true, gainDb: -120 } as const;
const track = (signal: Float32Array, seed: { t: number; hz: number }, harmonics = 8, extra = {}) => {
  const r = trackHarmonics(signal, SR, seed, { harmonics, ...extra });
  if (!r.ok) throw new Error(`track failed: ${r.reason}`);
  return r;
};
const harmonicRegion = (points: { t: number; hz: number }[], over: Record<string, unknown> = {}): SpectralRegion =>
  sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "harmonic", points, harmonic: { harmonics: 8, maxHz: 20000, bandCents: 50 }, ...over }])[0];
const wandRegion = (signal: Float32Array, seed: { t: number; hz: number }, options = {}, over: Record<string, unknown> = {}): SpectralRegion => {
  const r = computeMagicWand(signal, SR, seed, options);
  if (!r.ok) throw new Error(`wand failed: ${r.reason}`);
  return sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "wand", wand: r.wand, ...over }])[0];
};

describe("harmonic tracking against analytic signals", () => {
  const noise = whiteNoise(3 * SR, 0.02);
  it("follows a 5.5 Hz vibrato of +-50 cents to a few cents", () => {
    const vib = (t: number) => 220 * Math.pow(2, (50 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
    const r = track(sum(harmonicTone(3, vib, 8, 0.1), noise), { t: 1, hz: 225 });
    const e = trackErrorsCents(r.points, vib);
    console.log(`vibrato: ${r.points.length} points, f0 error median ${e[e.length >> 1].toFixed(2)} c, p95 ${e[Math.floor(e.length * 0.95)].toFixed(2)} c, max ${e[e.length - 1].toFixed(2)} c`);
    expect(e[e.length >> 1]).toBeLessThan(3);
    expect(e[Math.floor(e.length * 0.95)]).toBeLessThan(12);
    expect(e[e.length - 1]).toBeLessThan(45);
    expect(r.points[0].t).toBeLessThan(0.1);
    expect(r.points[r.points.length - 1].t).toBeGreaterThan(2.9);
  });
  it("follows an exponential glide of 0.8 octave per second", () => {
    const glide = (t: number) => 150 * Math.pow(2, 0.8 * t);
    const r = track(sum(harmonicTone(3, glide, 8, 0.1), noise), { t: 1.5, hz: glide(1.5) * 1.01 });
    const e = trackErrorsCents(r.points, glide);
    console.log(`glide: ${r.points.length} points, f0 error median ${e[e.length >> 1].toFixed(2)} c, p95 ${e[Math.floor(e.length * 0.95)].toFixed(2)} c, max ${e[e.length - 1].toFixed(2)} c`);
    expect(e[e.length >> 1]).toBeLessThan(3);
    expect(e[Math.floor(e.length * 0.95)]).toBeLessThan(15);
  });
  it("follows a glide with vibrato on top (fast turning points)", () => {
    const f = (t: number) => 180 * Math.pow(2, 0.4 * t) * Math.pow(2, (35 * Math.sin(2 * Math.PI * 6 * t)) / 1200);
    const r = track(sum(harmonicTone(3, f, 8, 0.1), noise), { t: 1.2, hz: f(1.2) });
    const e = trackErrorsCents(r.points, f);
    console.log(`glide+vibrato: median ${e[e.length >> 1].toFixed(2)} c, p95 ${e[Math.floor(e.length * 0.95)].toFixed(2)} c`);
    expect(e[e.length >> 1]).toBeLessThan(4);
    expect(e[Math.floor(e.length * 0.95)]).toBeLessThan(20);
  });
  it("stops where the sound stops", () => {
    const f = (t: number) => 200 * Math.pow(2, 0.3 * t);
    const r = track(sum(harmonicTone(3, f, 8, 0.1, { start: 0.8, end: 2.1 }), noise), { t: 1.5, hz: f(1.5) });
    console.log(`bounded tone 0.8-2.1 s tracked ${r.points[0].t.toFixed(3)}-${r.points[r.points.length - 1].t.toFixed(3)} s`);
    expect(Math.abs(r.points[0].t - 0.8)).toBeLessThan(0.08);
    expect(Math.abs(r.points[r.points.length - 1].t - 2.1)).toBeLessThan(0.08);
  });
  it("finds the seed of a box and tracks only inside the box's time span", () => {
    const f = (t: number) => 300 * Math.pow(2, 0.2 * t);
    const sig = sum(harmonicTone(3, f, 6, 0.1), noise);
    const seed = findBoxSeed(sig, SR, { startTime: 1, endTime: 2, lowHz: 250, highHz: 450 });
    expect(seed).not.toBeNull();
    expect(Math.abs(1200 * Math.log2((seed?.hz ?? 1) / f(seed?.t ?? 0)))).toBeLessThan(40);
    const r = track(sig, seed ?? { t: 1.5, hz: 330 }, 6, { startTime: 1, endTime: 2 });
    expect(r.points[0].t).toBeGreaterThanOrEqual(0.97);
    expect(r.points[r.points.length - 1].t).toBeLessThanOrEqual(2.03);
  });
  it("is deterministic and keeps the stored track within the point limit", () => {
    const f = (t: number) => 200 * Math.pow(2, (80 * Math.sin(2 * Math.PI * 7 * t)) / 1200);
    const sig = sum(harmonicTone(20, f, 6, 0.1), whiteNoise(20 * SR, 0.02));
    const a = track(sig, { t: 3, hz: 200 }, 6);
    const b = track(sig, { t: 3, hz: 200 }, 6);
    expect(a.points).toEqual(b.points);
    expect(a.points.length).toBeLessThanOrEqual(512);
    expect(sanitizeSpectralRegions([{ id: "x", mode: "remove", shape: "harmonic", points: a.points, harmonic: { harmonics: 6, maxHz: 20000, bandCents: 50 } }])).toHaveLength(1);
  });
});

describe("harmonic region: energy captured and removal against a plain band", () => {
  it("captures the harmonic energy of a vibrato voice and little of the noise", () => {
    const vib = (t: number) => 220 * Math.pow(2, (50 * Math.sin(2 * Math.PI * 5.5 * t)) / 1200);
    const harm = harmonicTone(3, vib, 8, 0.1);
    const noise = whiteNoise(3 * SR, 0.03);
    const r = track(sum(harm, noise), { t: 1, hz: 225 });
    const region = harmonicRegion(r.points);
    const captured = maskEnergyShare(harm, region);
    const noiseIn = maskEnergyShare(noise, region);
    const band = sanitizeSpectralRegions([{ ...base, mode: "attenuate", startTime: 0, endTime: 3, lowHz: 200, highHz: 8 * 260 }])[0];
    console.log(`harmonic region: ${(captured * 100).toFixed(1)} % of harmonic energy, ${(noiseIn * 100).toFixed(2)} % of the noise; one band 200 Hz-2.08 kHz: ${(maskEnergyShare(harm, band) * 100).toFixed(1)} % of the harmonic energy, ${(maskEnergyShare(noise, band) * 100).toFixed(2)} % of the noise`);
    expect(captured).toBeGreaterThan(0.93);
    expect(noiseIn).toBeLessThan(0.05);
    // Per unit of noise swallowed, the harmonic region holds far more of the voice than the band does.
    expect(captured / noiseIn).toBeGreaterThan(1.5 * (maskEnergyShare(harm, band) / maskEnergyShare(noise, band)));
  });
  it("takes a gliding whistle with harmonics out of speech-like noise deeper than a band, with less collateral", () => {
    const clean = speechLike(1.6);
    const f0 = (t: number) => 400 * Math.pow(700 / 400, Math.min(1, Math.max(0, (t - 0.3) / 1)));
    const whistle = harmonicTone(1.6, f0, 5, 0.05, { rolloff: 1, start: 0.3, end: 1.3 });
    const noisy = sum(clean, whistle);
    const r = track(noisy, { t: 0.8, hz: f0(0.8) * 1.01 }, 5);
    // The operation is linear (attenuate), so the whistle left is the operation applied to the whistle alone and the damage is its effect on the speech alone.
    const result = (region: SpectralRegion) => {
      const op = (x: Float32Array) => applySpectralRegionsToChannel(x, SR, [region]);
      return { depthDb: ratioDb(energy(whistle), energy(op(whistle))), speechSnrDb: ratioDb(energy(clean), energy(op(clean).map((v, i) => v - clean[i]))) };
    };
    const harmonic = result(harmonicRegion(r.points, { harmonic: { harmonics: 5, maxHz: 20000, bandCents: 50 } }));
    const fundamentalBand = result(sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, startTime: 0.3, endTime: 1.3, lowHz: 380, highHz: 740 }])[0]);
    const allBand = result(sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, startTime: 0.3, endTime: 1.3, lowHz: 380, highHz: 3774 }])[0]);
    console.log(`whistle depth / speech kept (SNR of speech against the damage): harmonic ${harmonic.depthDb.toFixed(1)} dB / ${harmonic.speechSnrDb.toFixed(1)} dB; band over the fundamental ${fundamentalBand.depthDb.toFixed(1)} / ${fundamentalBand.speechSnrDb.toFixed(1)}; one band over all 5 partials ${allBand.depthDb.toFixed(1)} / ${allBand.speechSnrDb.toFixed(1)}`);
    expect(harmonic.depthDb).toBeGreaterThan(15);
    expect(harmonic.depthDb).toBeGreaterThan(fundamentalBand.depthDb + 10);
    expect(harmonic.speechSnrDb).toBeGreaterThan(allBand.speechSnrDb + 6);
    // And the removal modes: Remove leaves the speech cleaner than any band that gets the whistle out.
    const [removeRegion] = sanitizeSpectralRegions([{ ...harmonicRegion(r.points), mode: "remove" }]);
    const removed = applySpectralRegionsToChannel(noisy, SR, [removeRegion]);
    expect(ratioDb(energy(clean), energy(removed.map((v, i) => v - clean[i])))).toBeGreaterThan(ratioDb(energy(clean), energy(noisy.map((v, i) => v - clean[i]))) + 2);
  });
});

describe("magic wand on analytic signals", () => {
  const n = 3 * SR;
  it("selects one click of a click train and not its neighbours, and removing it takes the click out", () => {
    const clicks = new Float32Array(n);
    const times: number[] = [];
    for (let c = 0; c < 20; c += 1) {
      times.push(0.2 + c * 0.13);
      clicks[Math.floor(times[c] * SR)] = 0.8;
    }
    const noise = whiteNoise(n, 0.01);
    const signal = sum(clicks, noise);
    const result = computeMagicWand(signal, SR, { t: times[5], hz: 3000 }, { toleranceDb: 6 });
    if (!result.ok) throw new Error(result.reason);
    const region = sanitizeSpectralRegions([{ ...base, mode: "remove", shape: "wand", wand: result.wand }])[0];
    expect(region.feather).toBeUndefined();
    console.log(`click wand: ${result.cells} cells, ${result.wand.frames} frames x ${result.wand.bins} bins, ${result.wand.runs.length} runs; spans ${region.startTime.toFixed(3)}-${region.endTime.toFixed(3)} s`);
    expect(region.startTime).toBeLessThan(times[5]);
    expect(region.endTime).toBeGreaterThan(times[5]);
    expect(region.endTime - region.startTime).toBeLessThan(0.13);
    const one = new Float32Array(n);
    one[Math.floor(times[5] * SR)] = 0.8;
    const others = clicks.map((v, i) => (i === Math.floor(times[5] * SR) ? 0 : v));
    expect(maskEnergyShare(one, region)).toBeGreaterThan(0.85);
    expect(wandRegion(signal, { t: times[5], hz: 3000 }, { toleranceDb: 20 }).endTime - wandRegion(signal, { t: times[5], hz: 3000 }, { toleranceDb: 20 }).startTime).toBeGreaterThan(1);
    expect(maskEnergyShare(others, region)).toBeLessThan(0.001);
    const out = applySpectralRegionsToChannel(signal, SR, [region]);
    const around = (x: Float32Array) => energy(x.subarray(Math.floor((times[5] - 0.02) * SR), Math.floor((times[5] + 0.02) * SR)));
    const reduction = ratioDb(around(signal), around(out));
    console.log(`click removal inside +-20 ms of the click: ${reduction.toFixed(1)} dB`);
    expect(reduction).toBeGreaterThan(14);
    // Every other click stays bit-identical far from the selection.
    for (const c of [1, 10, 15]) {
      const a = Math.floor((times[c] - 0.03) * SR);
      const b = Math.floor((times[c] + 0.03) * SR);
      expect(Array.from(out.subarray(a, b))).toEqual(Array.from(signal.subarray(a, b)));
    }
  });
  it("selects a hum as one thin band for the whole clip, in level and in contrast mode", () => {
    const hum = new Float32Array(n);
    for (let i = 0; i < n; i += 1) hum[i] = 0.05 * Math.sin((2 * Math.PI * 60 * i) / SR) + 0.02 * Math.sin((2 * Math.PI * 120 * i) / SR);
    const noise = whiteNoise(n, 0.01);
    const signal = sum(hum, noise);
    for (const localContrast of [false, true]) {
      const region = wandRegion(signal, { t: 1.5, hz: 62 }, { toleranceDb: 6, localContrast });
      const fundamental = harmonicTone(3, () => 60, 1, 0.05, { rolloff: 0 });
      const captured = maskEnergyShare(fundamental, region);
      const noiseIn = maskEnergyShare(noise, region);
      console.log(`hum wand (${localContrast ? "contrast" : "level"}): spans ${region.startTime.toFixed(2)}-${region.endTime.toFixed(2)} s, ${region.lowHz.toFixed(0)}-${region.highHz.toFixed(0)} Hz; ${(captured * 100).toFixed(1)} % of the 60 Hz energy, ${(noiseIn * 100).toFixed(3)} % of the noise`);
      expect(region.startTime).toBeLessThan(0.1);
      expect(region.endTime).toBeGreaterThan(2.9);
      expect(region.lowHz).toBeLessThan(60);
      expect(region.highHz).toBeGreaterThan(60);
      expect(region.highHz).toBeLessThan(160);
      expect(captured).toBeGreaterThan(0.85);
      expect(noiseIn).toBeLessThan(0.005);
      // Attenuate is linear: the 60 Hz left is the operation applied to the 60 Hz alone.
      const depth = ratioDb(energy(fundamental), energy(applySpectralRegionsToChannel(fundamental, SR, [region])));
      console.log(`hum depth ${depth.toFixed(1)} dB`);
      expect(depth).toBeGreaterThan(20);
    }
  });
  it("a higher tolerance selects at least as many cells, and a silent seed selects a bounded patch", () => {
    const signal = sum(harmonicTone(3, () => 440, 3, 0.1), whiteNoise(n, 0.01));
    const cells = (toleranceDb: number) => {
      const r = computeMagicWand(signal, SR, { t: 1.5, hz: 440 }, { toleranceDb });
      return r.ok ? r.cells : 0;
    };
    expect(cells(3)).toBeGreaterThan(0);
    expect(cells(12)).toBeGreaterThanOrEqual(cells(3));
    expect(computeMagicWand(signal, SR, { t: 99, hz: 440 }).ok).toBe(false);
  });
  it("stores the cells: a region renders identically after a reload, whatever the algorithm would now do", () => {
    const signal = sum(harmonicTone(3, () => 440, 3, 0.1), whiteNoise(n, 0.01));
    const region = wandRegion(signal, { t: 1.5, hz: 442 }, { toleranceDb: 8 });
    const reloaded = sanitizeSpectralRegions(JSON.parse(JSON.stringify([region])))[0];
    expect(reloaded).toEqual(region);
    expect(spectralRegionsKey([reloaded])).toBe(spectralRegionsKey([region]));
    const grid = { sampleRate: SR, size: 2048, hop: 512, firstFrame: -3, lastFrame: 400 };
    expect(Array.from(rasterizeRegionMask(reloaded, grid)?.weights ?? [])).toEqual(Array.from(rasterizeRegionMask(region, grid)?.weights ?? []));
    // A hand-written mask: the rendering depends on the stored cells alone (a 3-frame x 2-bin patch: frame 100, bins 40-41 and frame 102, bin 40).
    const handmade = sanitizeSpectralRegions([
      { id: "w", mode: "attenuate", gainDb: -20, feather: 0, shape: "wand", wand: { version: 1, seed: { t: 1, hz: 940 }, toleranceDb: 3, localContrast: false, sampleRate: SR, fftSize: 2048, hop: 512, m0: 100, k0: 40, frames: 3, bins: 2, runs: [0, 2, 2, 1, 1] } },
    ])[0];
    const mask = rasterizeRegionMask(handmade, grid);
    expect(maskWeight(mask!, 100, 40)).toBe(1);
    expect(maskWeight(mask!, 100, 41)).toBe(1);
    expect(maskWeight(mask!, 101, 40)).toBe(0);
    expect(maskWeight(mask!, 102, 40)).toBe(1);
    expect(maskWeight(mask!, 102, 41)).toBe(0);
  });
  it("rejects malformed stored masks instead of guessing", () => {
    const wand = { version: 1, seed: { t: 1, hz: 100 }, toleranceDb: 6, localContrast: false, sampleRate: SR, fftSize: 2048, hop: 512, m0: 0, k0: 0, frames: 2, bins: 2 };
    const make = (over: Record<string, unknown>) => sanitizeSpectralRegions([{ id: "w", mode: "remove", shape: "wand", wand: { ...wand, ...over } }]);
    expect(make({ runs: [0, 4] })).toHaveLength(1);
    expect(make({ runs: [0, 3] })).toHaveLength(0);
    expect(make({ runs: [4] })).toHaveLength(0);
    expect(make({ runs: [-1, 5] })).toHaveLength(0);
    expect(make({ runs: [0, 4], frames: 0 })).toHaveLength(0);
    expect(make({ runs: [0, 4], sampleRate: "x" })).toHaveLength(0);
    expect(sanitizeSpectralRegions([{ id: "w", mode: "remove", shape: "wand" }])).toHaveLength(0);
  });
});

describe("region format versions and per-channel editing", () => {
  const rect = { id: "r", mode: "remove", startTime: 0.1, endTime: 0.4, lowHz: 500, highHz: 900, gainDb: -120, enabled: true } as const;
  it("keeps rectangle-only lists bit-identical: same key, same params, no version, no new fields", () => {
    const regions = sanitizeSpectralRegions([rect, { ...rect, id: "q", mode: "attenuate", gainDb: -9 }]);
    expect(Object.keys(regions[0]).sort()).toEqual(["enabled", "endTime", "gainDb", "highHz", "id", "lowHz", "mode", "startTime"]);
    expect(spectralRegionsKey(regions)).toBe("r0.10000,0.40000,500.00,900.00,-120.000;a0.10000,0.40000,500.00,900.00,-9.000");
    expect(spectralRegionsVersion(regions)).toBeUndefined();
    expect(createSpectralRepairEffect("e", regions).params).toEqual({ regions });
  });
  it("writes version 2 for lasso / heal as before and version 3 only for wand, harmonic or a channel", () => {
    const lasso = sanitizeSpectralRegions([{ id: "l", mode: "heal", shape: "lasso", points: [{ t: 0.1, hz: 500 }, { t: 0.3, hz: 500 }, { t: 0.2, hz: 900 }] }]);
    expect(spectralRegionsVersion(lasso)).toBe(2);
    const harmonic = harmonicRegion([{ t: 0.1, hz: 200 }, { t: 0.5, hz: 220 }]);
    expect(spectralRegionsVersion([harmonic])).toBe(3);
    expect(createSpectralRepairEffect("e", [harmonic]).params.version).toBe(3);
    const left = sanitizeSpectralRegions([{ ...rect, channel: "left" }]);
    expect(left[0].channel).toBe("left");
    expect(spectralRegionsVersion(left)).toBe(3);
    expect(regionsNeedVersion2(left)).toBe(false);
    expect(sanitizeSpectralRegions([{ ...rect, channel: "both" }])[0].channel).toBeUndefined();
    expect(spectralRegionsKey(left)).not.toBe(spectralRegionsKey(sanitizeSpectralRegions([rect])));
    expect(spectralRegionsKey(sanitizeSpectralRegions([{ ...rect, channel: "right" }]))).not.toBe(spectralRegionsKey(left));
  });
  it("sanitises harmonic regions: sorted track, clamped settings, derived bounds", () => {
    const [region] = sanitizeSpectralRegions([{ id: "h", mode: "remove", shape: "harmonic", points: [{ t: 1, hz: 300 }, { t: 0.5, hz: 200 }, { t: 0.5, hz: 210 }], harmonic: { harmonics: 500, maxHz: 1e9, bandCents: 1 } }]);
    expect(region.points?.map((p) => p.t)).toEqual([0.5, 1]);
    expect(region.points?.[0].hz).toBe(210);
    expect(region.harmonic).toEqual({ harmonics: 64, maxHz: 192000, bandCents: 5 });
    expect(region.startTime).toBe(0.5);
    expect(region.endTime).toBe(1);
    expect(region.lowHz).toBeLessThan(210);
    expect(sanitizeSpectralRegions([{ id: "h", mode: "remove", shape: "harmonic", points: [{ t: 1, hz: 300 }] }])).toHaveLength(0);
  });
  it("edits only the chosen channel and leaves the other bit-identical; both equals the unspecified default", () => {
    const left = sum(harmonicTone(1, () => 500, 1, 0.2, { rolloff: 0 }), whiteNoise(SR, 0.01, 3));
    const right = sum(harmonicTone(1, () => 500, 1, 0.2, { rolloff: 0 }), whiteNoise(SR, 0.01, 4));
    const box = { ...rect, startTime: 0.1, endTime: 0.9, lowHz: 400, highHz: 600, mode: "remove" } as const;
    const run = (channel?: string) => applySpectralRegions([left, right], SR, sanitizeSpectralRegions([channel ? { ...box, channel } : box]));
    const onlyLeft = run("left");
    expect(onlyLeft[1]).toEqual(right);
    expect(energy(onlyLeft[0].map((v, i) => v - left[i]))).toBeGreaterThan(energy(left) * 0.05);
    const onlyRight = run("right");
    expect(onlyRight[0]).toEqual(left);
    expect(onlyRight[1]).not.toEqual(right);
    const both = run("both");
    const unspecified = run();
    expect(Array.from(both[0])).toEqual(Array.from(unspecified[0]));
    expect(Array.from(both[1])).toEqual(Array.from(unspecified[1]));
    // The left edit of the left channel equals the plain edit of that channel; likewise the right.
    expect(Array.from(onlyLeft[0])).toEqual(Array.from(unspecified[0]));
    expect(Array.from(onlyRight[1])).toEqual(Array.from(unspecified[1]));
    // A mono source is its "left": a right-only region does nothing to it.
    expect(applySpectralRegions([left], SR, sanitizeSpectralRegions([{ ...box, channel: "right" }]))[0]).toEqual(left);
  });
  it("applies a harmonic or wand region per channel too", () => {
    const f = (t: number) => 300 * Math.pow(2, 0.3 * t);
    const tone = harmonicTone(2, f, 6, 0.1);
    const stereo = [sum(tone, whiteNoise(2 * SR, 0.01, 8)), sum(tone, whiteNoise(2 * SR, 0.01, 9))];
    const r = track(stereo[0], { t: 1, hz: f(1) }, 6);
    const region = harmonicRegion(r.points, { harmonic: { harmonics: 6, maxHz: 20000, bandCents: 50 }, channel: "right" });
    const out = applySpectralRegions(stereo, SR, [region]);
    expect(out[0]).toEqual(stereo[0]);
    expect(ratioDb(energy(stereo[1]), energy(out[1]))).toBeGreaterThan(10);
  });
});
