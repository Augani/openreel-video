/**
 * Independent verification (second pair of eyes, own signals and parameters) of the magic wand, harmonic selection and per-channel edits, with signals and parameters that
 * differ from the builder's own tests. Everything here is measured against analytic ground truth.
 */
import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import type { Project } from "../../types";
import { applySpectralRegions, applySpectralRegionsToChannel } from "./spectral-dsp";
import { clipSpectralRegions, planSpectralRegionsAction } from "./spectral-edit";
import { SR, energy, harmonicTone, maskEnergyShare, speechLike, sum, trackErrorsCents, whiteNoise } from "./spectral-fixtures";
import { trackHarmonics } from "./spectral-harmonic";
import { decodeWandBits } from "./spectral-mask";
import { sanitizeSpectralRegions, spectralRegionsKey, type SpectralRegion } from "./spectral-regions";
import { analyseFrame, getStftPlan, stftFrameRange } from "./spectral-stft";
import { computeMagicWand } from "./spectral-wand";

const base = { id: "a", enabled: true, gainDb: -120 } as const;
const scale = (x: Float32Array, g: number) => x.map((v) => v * g);

describe("harmonic selection follows the overtones (own signals)", () => {
  // f0 glides 140 -> ~396 Hz over 3 s (0.5 oct/s) with +-70 cent vibrato at 4.7 Hz; 10 partials; speech-like noise + white noise.
  const f0 = (t: number) => 140 * Math.pow(2, 0.5 * t) * Math.pow(2, (70 * Math.sin(2 * Math.PI * 4.7 * t)) / 1200);
  const harm = harmonicTone(3, f0, 10, 0.08, { rolloff: 0.9 });
  const speech = scale(speechLike(3, 29), 0.5);
  const white = whiteNoise(3 * SR, 0.02, 9);
  const mix = sum(sum(harm, speech), white);
  for (const [label, seedT, seedOff] of [["mid seed +35c", 1.4, 1.02], ["early seed -30c", 0.6, 0.983]] as const) {
    it(`tracks and selects: ${label}`, () => {
      const r = trackHarmonics(mix, SR, { t: seedT, hz: f0(seedT) * seedOff }, { harmonics: 10 });
      if (!r.ok) throw new Error(r.reason);
      const e = trackErrorsCents(r.points, f0);
      const [region] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "harmonic", points: r.points, harmonic: { harmonics: 10, maxHz: 20000, bandCents: 60 } }]);
      const inHarm = maskEnergyShare(harm, region);
      const inSpeech = maskEnergyShare(speech, region);
      const inWhite = maskEnergyShare(white, region);
      console.log(`[R22 harmonic ${label}] points ${r.points.length}, span ${r.points[0].t.toFixed(2)}-${r.points[r.points.length - 1].t.toFixed(2)} s, f0 err median ${e[e.length >> 1].toFixed(1)} p95 ${e[Math.floor(e.length * 0.95)].toFixed(1)} max ${e[e.length - 1].toFixed(1)} cents; harmonic energy in mask ${(inHarm * 100).toFixed(1)} %, speech-like in mask ${(inSpeech * 100).toFixed(2)} %, white in mask ${(inWhite * 100).toFixed(2)} %`);
      expect(e[e.length >> 1]).toBeLessThan(8);
      expect(inHarm).toBeGreaterThan(0.9);
      expect(inWhite).toBeLessThan(0.08);
      expect(inSpeech).toBeLessThan(0.4);
    });
  }
  it("a second voice at 1.31 x the pitch is mostly left alone", () => {
    const other = harmonicTone(3, (t) => 1.31 * f0(t), 10, 0.08, { rolloff: 0.9 });
    const r = trackHarmonics(sum(harm, other), SR, { t: 1.4, hz: f0(1.4) }, { harmonics: 10 });
    if (!r.ok) throw new Error(r.reason);
    const [region] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -60, shape: "harmonic", points: r.points, harmonic: { harmonics: 10, maxHz: 20000, bandCents: 40 } }]);
    const own = maskEnergyShare(harm, region);
    const foreign = maskEnergyShare(other, region);
    console.log(`[R22 two voices] own voice in mask ${(own * 100).toFixed(1)} %, 1.31x voice in mask ${(foreign * 100).toFixed(1)} %`);
    expect(own).toBeGreaterThan(0.85);
    expect(foreign).toBeLessThan(0.35);
  });
  it("a rectangle covering the same range is much less selective (sanity of the metric)", () => {
    const [band] = sanitizeSpectralRegions([{ ...base, mode: "attenuate", startTime: 0, endTime: 3, lowHz: 120, highHz: 4200 }]);
    console.log(`[R22 band] harmonic ${(maskEnergyShare(harm, band) * 100).toFixed(1)} %, white ${(maskEnergyShare(white, band) * 100).toFixed(1)} %`);
    expect(maskEnergyShare(white, band)).toBeGreaterThan(0.15);
  });
});

/** Independent re-implementation of the wand's level field (3x3 mean power in dB) to check tolerance and connectivity. */
function levelField(signal: Float32Array, m0: number, m1: number) {
  const plan = getStftPlan();
  const rows = m1 - m0 + 1;
  const cols = plan.size / 2 + 1;
  const p = new Float32Array(rows * cols);
  const scratch = new Float32Array(plan.size);
  for (let r = 0; r < rows; r += 1) {
    const { real, imag } = analyseFrame(plan, signal, (m0 + r) * plan.hop, scratch);
    for (let k = 0; k < cols; k += 1) p[r * cols + k] = real[k] ** 2 + imag[k] ** 2;
  }
  const L = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r += 1)
    for (let k = 0; k < cols; k += 1) {
      let s = 0;
      let n = 0;
      for (let dr = -1; dr <= 1; dr += 1) for (let dk = -1; dk <= 1; dk += 1) {
        const rr = r + dr;
        const kk = k + dk;
        if (rr < 0 || rr >= rows || kk < 0 || kk >= cols) continue;
        s += p[rr * cols + kk];
        n += 1;
      }
      L[r * cols + k] = 10 * Math.log10(s / n + 1e-20);
    }
  return { L, rows, cols };
}

function checkWand(signal: Float32Array, seed: { t: number; hz: number }, tol: number) {
  const res = computeMagicWand(signal, SR, seed, { toleranceDb: tol });
  if (!res.ok) throw new Error(res.reason);
  const plan = getStftPlan();
  const range = stftFrameRange(signal.length, plan);
  const { wand } = res;
  const decoded = decodeWandBits(wand);
  const field = levelField(signal, 0, range.last);
  const at = (m: number, k: number) => m >= wand.m0 && m < wand.m0 + wand.frames && k >= wand.k0 && k < wand.k0 + wand.bins && decoded.bits[(m - wand.m0) * wand.bins + (k - wand.k0)] === 1;
  const seedL = field.L[res.seedCell.m * field.cols + res.seedCell.k];
  let violations = 0;
  let leaks = 0;
  const seen = new Set<number>();
  const cells: Array<[number, number]> = [];
  for (let m = wand.m0; m < wand.m0 + wand.frames; m += 1)
    for (let k = wand.k0; k < wand.k0 + wand.bins; k += 1) if (at(m, k)) {
      cells.push([m, k]);
      if (Math.abs(field.L[m * field.cols + k] - seedL) > tol + 1e-3) violations += 1;
      for (let dm = -1; dm <= 1; dm += 1) for (let dk = -1; dk <= 1; dk += 1) {
        const mm = m + dm;
        const kk = k + dk;
        if (mm < 0 || mm >= field.rows || kk < 0 || kk >= field.cols || at(mm, kk)) continue;
        // an unselected 8-neighbour of a selected cell must be outside the tolerance
        if (Math.abs(field.L[mm * field.cols + kk] - seedL) <= tol - 1e-3) leaks += 1;
      }
    }
  // connectivity: flood from the seed cell over selected cells
  const stack: Array<[number, number]> = [[res.seedCell.m, res.seedCell.k]];
  seen.add(res.seedCell.m * field.cols + res.seedCell.k);
  while (stack.length) {
    const [m, k] = stack.pop()!;
    for (let dm = -1; dm <= 1; dm += 1) for (let dk = -1; dk <= 1; dk += 1) {
      const mm = m + dm;
      const kk = k + dk;
      const key = mm * field.cols + kk;
      if (seen.has(key) || !at(mm, kk)) continue;
      seen.add(key);
      stack.push([mm, kk]);
    }
  }
  return { res, cells: cells.length, connected: seen.size, violations, leaks, field, at };
}

describe("magic wand on own signals", () => {
  it("click train (0.17 s spacing): one connected region, stops at the tolerance, neighbours untouched", () => {
    const n = Math.round(3.5 * SR);
    const clicks = new Float32Array(n);
    const times: number[] = [];
    for (let c = 0; c < 18; c += 1) {
      times.push(0.3 + c * 0.17);
      clicks[Math.floor(times[c] * SR)] = 0.9;
    }
    const noise = whiteNoise(n, 0.006, 3);
    const signal = sum(clicks, noise);
    for (const tol of [3, 8]) {
      const c = checkWand(signal, { t: times[7], hz: 5000 }, tol);
      console.log(`[R22 wand click tol ${tol}] cells ${c.cells}, connected ${c.connected}, tolerance violations ${c.violations}, boundary leaks ${c.leaks}, span ${c.res.wand.frames} frames x ${c.res.wand.bins} bins`);
      expect(c.connected).toBe(c.cells);
      expect(c.violations).toBe(0);
      expect(c.leaks).toBe(0);
      const [region] = sanitizeSpectralRegions([{ ...base, mode: "remove", shape: "wand", wand: c.res.wand }]);
      const one = new Float32Array(n);
      one[Math.floor(times[7] * SR)] = 0.9;
      const others = clicks.map((v, i) => (i === Math.floor(times[7] * SR) ? 0 : v));
      const inOne = maskEnergyShare(one, region);
      const inOthers = maskEnergyShare(others, region);
      console.log(`[R22 wand click tol ${tol}] click energy in mask ${(inOne * 100).toFixed(1)} %, neighbouring clicks' energy in mask ${(inOthers * 100).toFixed(3)} %`);
      expect(inOne).toBeGreaterThan(0.7);
      expect(inOthers).toBeLessThan(0.01);
    }
  });

  it("stops at the tolerance: a wide tolerance floods, a narrow one stays small and monotone", () => {
    const n = Math.round(3 * SR);
    const clicks = new Float32Array(n);
    for (let c = 0; c < 15; c += 1) clicks[Math.floor((0.3 + c * 0.17) * SR)] = 0.9;
    const signal = sum(clicks, whiteNoise(n, 0.006, 3));
    const sizes = [2, 5, 10, 20, 35].map((tol) => {
      const r = computeMagicWand(signal, SR, { t: 0.3 + 6 * 0.17, hz: 5000 }, { toleranceDb: tol });
      return r.ok ? r.cells : -1;
    });
    console.log(`[R22 wand cells by tolerance 2,5,10,20,35 dB] ${sizes.join(", ")}`);
    for (let i = 1; i < sizes.length; i += 1) if (sizes[i] !== -1) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    expect(sizes[0]).toBeLessThan(sizes[3]);
  });

  it("cough over a chord: selects the cough, not the chord lines", () => {
    const n = 3 * SR;
    const chord = new Float32Array(n);
    for (const f of [220, 277.18, 329.63]) for (let h = 1; h <= 4; h += 1) for (let i = 0; i < n; i += 1) chord[i] += (0.04 / h) * Math.sin((2 * Math.PI * f * h * i) / SR);
    const cough = new Float32Array(n);
    const noise = whiteNoise(n, 1, 77);
    for (let i = Math.floor(1.0 * SR); i < Math.floor(1.35 * SR); i += 1) {
      const u = (i - 1.0 * SR) / (0.35 * SR);
      cough[i] = 0.25 * noise[i] * Math.sin(Math.PI * u) ** 2;
    }
    const signal = sum(sum(chord, cough), whiteNoise(n, 0.002, 4));
    const win = (x: Float32Array) => x.subarray(Math.floor(1.0 * SR), Math.floor(1.35 * SR));
    const rows: string[] = [];
    let best = { tol: 0, inCough: 0, inChord: 1 };
    for (const [tol, contrast] of [[6, false], [4, false], [3, false], [2, false], [6, true], [4, true]] as const) {
      const res = computeMagicWand(signal, SR, { t: 1.17, hz: 3500 }, { toleranceDb: tol, localContrast: contrast });
      if (!res.ok) { rows.push(`tol ${tol}${contrast ? " contrast" : ""}: ${res.reason}`); continue; }
      const [region] = sanitizeSpectralRegions([{ ...base, mode: "remove", shape: "wand", wand: res.wand }]);
      const inCough = maskEnergyShare(cough, region);
      const inChord = maskEnergyShare(chord, region);
      const removed = applySpectralRegionsToChannel(signal, SR, [region]);
      rows.push(`tol ${tol}${contrast ? " contrast" : ""}: ${res.cells} cells, span ${region.startTime.toFixed(2)}-${region.endTime.toFixed(2)} s ${region.lowHz.toFixed(0)}-${region.highHz.toFixed(0)} Hz, cough in mask ${(inCough * 100).toFixed(1)} %, chord in mask ${(inChord * 100).toFixed(2)} %, cough window energy ${(energy(removed.subarray(Math.floor(1.0 * SR), Math.floor(1.35 * SR))) / energy(win(signal)) * 100).toFixed(0)} % left`);
      if (!contrast && tol === 3) best = { tol, inCough, inChord };
    }
    console.log(`[R22 wand cough]\n  ${rows.join("\n  ")}`);
    // Level-connected semantics: a tight tolerance leaves the chord alone but takes only the loudest part of the cough, a wide one takes the cough and floods along the chord lines.
    expect(best.inChord).toBeLessThan(0.01);
    const c3 = checkWand(signal, { t: 1.17, hz: 3500 }, 3);
    expect(c3.connected).toBe(c3.cells);
    expect(c3.violations).toBe(0);
    expect(c3.leaks).toBe(0);
  });
});

describe("per-channel edits", () => {
  it("a left region leaves the right channel bit-identical; a right region on a mono source does nothing", () => {
    const n = 2 * SR;
    const tone = (f: number) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / SR));
    const L = sum(tone(1000), tone(3200));
    const R = Float32Array.from(L);
    const mk = (channel: string) => sanitizeSpectralRegions([{ ...base, mode: "remove", startTime: 0, endTime: 2, lowHz: 3000, highHz: 3400, channel }]);
    const [oL, oR] = applySpectralRegions([L, R], SR, mk("left"));
    expect(Array.from(oR)).toEqual(Array.from(R));
    expect(energy(oL)).toBeLessThan(energy(L) * 0.8);
    const [pL, pR] = applySpectralRegions([L, R], SR, mk("right"));
    expect(Array.from(pL)).toEqual(Array.from(L));
    expect(energy(pR)).toBeLessThan(energy(R) * 0.8);
    const mono = applySpectralRegions([L], SR, mk("right"));
    expect(Array.from(mono[0])).toEqual(Array.from(L));
    const monoL = applySpectralRegions([L], SR, mk("left"));
    expect(energy(monoL[0])).toBeLessThan(energy(L) * 0.8);
    expect(spectralRegionsKey(mk("left"))).not.toBe(spectralRegionsKey(mk("right")));
    expect(spectralRegionsKey(mk("left"))).not.toBe(spectralRegionsKey(sanitizeSpectralRegions([{ ...base, mode: "remove", startTime: 0, endTime: 2, lowHz: 3000, highHz: 3400 }])));
  });
});

const makeProject = () =>
  ({
    id: "p", name: "p", createdAt: 0, modifiedAt: 0,
    settings: { width: 640, height: 360, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: { duration: 4, subtitles: [], markers: [], tracks: [{ id: "t", name: "A", type: "audio", hidden: false, muted: false, solo: false, locked: false, transitions: [],
      clips: [{ id: "clip", mediaId: "m", trackId: "t", startTime: 0, duration: 4, inPoint: 0, outPoint: 4, volume: 1, effects: [], audioEffects: [], keyframes: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, rotation: 0, opacity: 1 } }] }] },
  }) as unknown as Project;

describe("wand and harmonic regions are undoable and saved", () => {
  it("add wand, add harmonic, set channel: undo/redo restore exact lists; JSON round trip renders identical samples", async () => {
    const n = 3 * SR;
    const f0 = (t: number) => 250 * Math.pow(2, 0.2 * t);
    const sig = sum(harmonicTone(3, f0, 5, 0.1), whiteNoise(n, 0.01));
    const w = computeMagicWand(sig, SR, { t: 1, hz: 250 * Math.pow(2, 0.2) }, { toleranceDb: 6, localContrast: true });
    const h = trackHarmonics(sig, SR, { t: 1, hz: f0(1) }, { harmonics: 5 });
    if (!w.ok || !h.ok) throw new Error("analysis");
    const project = makeProject();
    const ex = new ActionExecutor();
    const clip = () => project.timeline.tracks[0].clips[0];
    let id = 0;
    const commit = async (regions: SpectralRegion[]) => {
      const action = planSpectralRegionsAction(clip(), regions, { actionId: `a${++id}`, effectId: "fx" });
      expect(action).not.toBeNull();
      expect((await ex.execute(action!, project)).success).toBe(true);
    };
    const r1 = sanitizeSpectralRegions([{ ...base, id: "w", mode: "remove", shape: "wand", wand: w.wand }]);
    await commit(r1);
    const r2 = sanitizeSpectralRegions([...r1, { ...base, id: "h", mode: "attenuate", gainDb: -30, shape: "harmonic", points: h.points, harmonic: { harmonics: 5, maxHz: 20000, bandCents: 50 } }]);
    await commit(r2);
    const r3 = r2.map((r) => (r.id === "h" ? { ...r, channel: "right" as const } : r));
    await commit(r3);
    expect(clipSpectralRegions(clip())).toEqual(r3);
    expect((clip().audioEffects[0].params as { version?: number }).version).toBe(3);
    // saved: survive a JSON round trip of the whole project
    const reloaded = JSON.parse(JSON.stringify(project)) as Project;
    const back = clipSpectralRegions(reloaded.timeline.tracks[0].clips[0]);
    expect(back).toEqual(r3);
    expect(spectralRegionsKey(back)).toBe(spectralRegionsKey(r3));
    const a = applySpectralRegions([sig, sig], SR, r3);
    const b = applySpectralRegions([sig, sig], SR, back);
    expect(Array.from(b[0])).toEqual(Array.from(a[0]));
    expect(Array.from(b[1])).toEqual(Array.from(a[1]));
    expect((await ex.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(r2);
    expect((await ex.undo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(r1);
    expect((await ex.undo(project)).success).toBe(true);
    expect(clip().audioEffects).toHaveLength(0);
    expect((await ex.redo(project)).success).toBe(true);
    expect((await ex.redo(project)).success).toBe(true);
    expect((await ex.redo(project)).success).toBe(true);
    expect(clipSpectralRegions(clip())).toEqual(r3);
  });
});

describe("degenerate input never throws", () => {
  const cases: Array<[string, Float32Array]> = [
    ["empty", new Float32Array(0)],
    ["100 samples", whiteNoise(100, 0.1)],
    ["one frame", whiteNoise(2048, 0.1)],
    ["silence 1 s", new Float32Array(SR)],
    ["dc", new Float32Array(SR).fill(0.5)],
    ["full-scale square", Float32Array.from({ length: SR }, (_, i) => (Math.floor(i / 50) % 2 ? 1 : -1))],
  ];
  for (const [name, sig] of cases) {
    it(name, () => {
      for (const seed of [{ t: 0, hz: 0 }, { t: 0.5, hz: 1000 }, { t: 5, hz: 1000 }, { t: 0.2, hz: 24000 }, { t: -1, hz: 100 }, { t: 0.1, hz: 30 }]) {
        const w = computeMagicWand(sig, SR, seed, { toleranceDb: 6 });
        if (w.ok) sanitizeSpectralRegions([{ ...base, mode: "remove", shape: "wand", wand: w.wand }]);
        const h = trackHarmonics(sig, SR, seed, { harmonics: 6 });
        if (h.ok) sanitizeSpectralRegions([{ ...base, mode: "remove", shape: "harmonic", points: h.points, harmonic: { harmonics: 6, maxHz: 20000, bandCents: 50 } }]);
      }
    });
  }
});
