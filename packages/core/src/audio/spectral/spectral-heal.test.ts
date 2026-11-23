import { describe, expect, it } from "vitest";
import { applySpectralRegions, applySpectralRegionsToChannel } from "./spectral-dsp";
import { SR, measure, speechLike, sum, tubePolygon, whistle, whistlePath, type Measure } from "./spectral-fixtures";
import type { SpectralRegion } from "./spectral-regions";
import { sanitizeSpectralRegions } from "./spectral-regions";

const base = { id: "a", enabled: true, gainDb: -120, startTime: 0, endTime: 0, lowHz: 0, highHz: 0 } as const;
const DURATION = 1.6;

interface Scenario {
  readonly clean: Float32Array;
  readonly whistleOnly: Float32Array;
  readonly noisy: Float32Array;
  readonly lasso: (mode: "remove" | "heal") => SpectralRegion;
  /** What the rectangle-only editor could do: a staircase of small rectangles along the whistle, each removed with the interpolated fill. */
  readonly stairs: SpectralRegion[];
}

function scenario(f0: number, f1: number, amplitude: number): Scenario {
  const clean = speechLike(DURATION);
  const whistleOnly = whistle(clean.length, 0.3, 1.3, f0, f1, amplitude);
  const path = whistlePath(0.3, 1.3, f0, f1, 40);
  const polygon = tubePolygon(path, 0.05);
  const lasso = (mode: "remove" | "heal"): SpectralRegion => sanitizeSpectralRegions([{ ...base, mode, shape: "lasso", points: polygon }])[0];
  const stairs: SpectralRegion[] = [];
  for (let i = 0; i < 20; i += 1) {
    const a = path[i * 2];
    const b = path[i * 2 + 2];
    stairs.push({ ...base, id: `s${i}`, mode: "remove", startTime: a.t, endTime: b.t, lowHz: Math.min(a.hz, b.hz) * 0.93, highHz: Math.max(a.hz, b.hz) * 1.07 });
  }
  return { clean, whistleOnly, noisy: sum(clean, whistleOnly), lasso, stairs };
}

function compare(s: Scenario): Record<"none" | "rectRemove" | "maskRemove" | "heal", Measure> {
  const probe = [s.lasso("heal")];
  const run = (regions: SpectralRegion[]) => measure(applySpectralRegionsToChannel(s.noisy, SR, regions), s.clean, s.whistleOnly, probe);
  return { none: measure(s.noisy, s.clean, s.whistleOnly, probe), rectRemove: run(s.stairs), maskRemove: run([s.lasso("remove")]), heal: run([s.lasso("heal")]) };
}

const table = (name: string, r: Record<string, Measure>): void => {
  const f = (x: number) => x.toFixed(1).padStart(6);
  const rows = Object.entries(r).map(([k, m]) => `${k.padEnd(11)} mask error ${f(m.maskErrorDb)} dB | whistle left ${f(m.whistleLeftDb)} dB | magnitude error ${f(m.magErrorDb)} dB | SNR outside ${f(m.snrOutsideDb)} dB | waveform SNR ${f(m.waveSnrDb)} dB`);
  console.info(`\n[spectral heal] ${name}\n${rows.join("\n")}`);
};

describe("heal vs the rectangle fill: a whistle sweeping through speech-like harmonics", () => {
  it("high whistle (1.5 -> 3.5 kHz across the upper harmonics)", () => {
    const r = compare(scenario(1500, 3500, 0.06));
    table("whistle 1.5 -> 3.5 kHz", r);
    // The whistle is gone from the mask in every method; the old rectangles pay for it with collateral damage around the path.
    expect(r.none.whistleLeftDb).toBeCloseTo(0, 3);
    expect(r.heal.whistleLeftDb).toBeLessThan(-12);
    expect(r.heal.maskErrorDb).toBeLessThan(r.rectRemove.maskErrorDb - 1.5);
    expect(r.heal.snrOutsideDb).toBeGreaterThan(r.rectRemove.snrOutsideDb + 20);
    expect(r.heal.waveSnrDb).toBeGreaterThan(r.rectRemove.waveSnrDb + 3);
    // Against the same mask filled by plain interpolation: a better magnitude fit, and the surroundings within 1 dB (the fill is not
    // quieter, so a little more of it leaks past the soft edge). Heal does not beat remove on complex error here, see spectral-heal-quality.test.ts.
    expect(r.heal.magErrorDb).toBeLessThan(r.maskRemove.magErrorDb - 0.3);
    expect(r.heal.snrOutsideDb).toBeGreaterThan(r.maskRemove.snrOutsideDb - 1);
  });

  it("low whistle (300 Hz -> 1.6 kHz through the strongest harmonics)", () => {
    const r = compare(scenario(300, 1600, 0.12));
    table("whistle 0.3 -> 1.6 kHz", r);
    expect(r.heal.whistleLeftDb).toBeLessThan(-9);
    expect(r.heal.maskErrorDb).toBeLessThan(r.rectRemove.maskErrorDb - 0.3);
    expect(r.heal.snrOutsideDb).toBeGreaterThan(r.rectRemove.snrOutsideDb + 10);
    expect(r.heal.magErrorDb).toBeLessThan(r.maskRemove.magErrorDb - 0.3);
    expect(r.heal.snrOutsideDb).toBeGreaterThan(r.maskRemove.snrOutsideDb - 1);
  });

  it("leaves every sample outside the mask's time span bit-identical and is deterministic", () => {
    const s = scenario(1500, 3500, 0.06);
    const out = applySpectralRegionsToChannel(s.noisy, SR, [s.lasso("heal")]);
    const again = applySpectralRegionsToChannel(s.noisy, SR, [s.lasso("heal")]);
    expect(Array.from(again)).toEqual(Array.from(out));
    // The mask lasts 0.3-1.3 s; its frames (window 2048 samples, plus the feather's margin) reach less than 5000 samples beyond it.
    const before = Math.floor(0.3 * SR) - 5000;
    const after = Math.ceil(1.3 * SR) + 5000;
    for (let i = 0; i < before; i += 1) expect(out[i]).toBe(s.noisy[i]);
    for (let i = after; i < out.length; i += 1) expect(out[i]).toBe(s.noisy[i]);
    // Inside, it actually changed.
    let changed = 0;
    for (let i = before; i < after; i += 1) if (out[i] !== s.noisy[i]) changed += 1;
    expect(changed).toBeGreaterThan(10000);
  });
});

/** Waveform SNR of `out` against `clean` over [from, to) seconds. */
const localSnr = (out: Float32Array, clean: Float32Array, from: number, to: number): number => {
  let e = 0;
  let c = 0;
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR); i += 1) {
    e += (out[i] - clean[i]) ** 2;
    c += clean[i] ** 2;
  }
  return 10 * Math.log10(c / Math.max(e, 1e-30));
};

describe("removing a click", () => {
  it("removes a loud click from speech-like audio; heal and the interpolated fill are comparable", () => {
    const clean = speechLike(1.2);
    const at = Math.round(0.6 * SR);
    const click = new Float32Array(clean.length);
    click[at] = 3;
    click[at + 1] = -2;
    click[at + 2] = 1;
    const noisy = sum(clean, click);
    // A click smears over the frames whose window holds it (about 2 x 21 ms), so the selection is a 50 ms box. Above 2.5 kHz the click
    // is far louder than the speech; below, the harmonics mask it.
    const rect = (mode: "remove" | "heal"): SpectralRegion => ({ ...base, mode, startTime: 0.575, endTime: 0.625, lowHz: 2500, highHz: SR / 2 });
    const healed = applySpectralRegionsToChannel(noisy, SR, [rect("heal")]);
    const removed = applySpectralRegionsToChannel(noisy, SR, [rect("remove")]);
    const row = (out: Float32Array) => ({ local: localSnr(out, clean, 0.55, 0.65), whole: localSnr(out, clean, 0, 1.2), outside: localSnr(out, clean, 0.0, 0.5) });
    const none = row(noisy);
    const rm = row(removed);
    const hl = row(healed);
    const f = (x: number) => x.toFixed(1);
    console.info(`\n[spectral heal] click (3 samples, peak 3.0), 50 ms box above 2.5 kHz\nnone        SNR within +-50 ms ${f(none.local)} dB | whole clip ${f(none.whole)} dB\nrectRemove  SNR within +-50 ms ${f(rm.local)} dB | whole clip ${f(rm.whole)} dB\nheal        SNR within +-50 ms ${f(hl.local)} dB | whole clip ${f(hl.whole)} dB`);
    expect(none.local).toBeLessThan(5);
    expect(hl.local).toBeGreaterThan(none.local + 6);
    // For a click the two fills are comparable (within 2 dB): a click leaves no long gap for heal's phase continuity to bridge.
    expect(Math.abs(hl.local - rm.local)).toBeLessThan(2);
    // Nothing leaks into the clip before the click.
    expect(hl.outside).toBeGreaterThan(60);
  });
});

describe("modes on masks", () => {
  it("attenuates a lasso region by the stored gain and leaves the outside alone", () => {
    const n = 2 * SR;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i += 1) x[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 4000 * i) / SR + 1);
    const region = sanitizeSpectralRegions([{ ...base, mode: "attenuate", gainDb: -12, shape: "lasso", points: [{ t: 0.5, hz: 600 }, { t: 1.5, hz: 600 }, { t: 1.5, hz: 1800 }, { t: 0.5, hz: 1800 }] }])[0];
    const out = applySpectralRegionsToChannel(x, SR, [region]);
    const amp = (sig: Float32Array, hz: number, a: number, b: number) => {
      let re = 0;
      let im = 0;
      for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i += 1) {
        re += sig[i] * Math.cos((2 * Math.PI * hz * i) / SR);
        im -= sig[i] * Math.sin((2 * Math.PI * hz * i) / SR);
      }
      return (2 * Math.hypot(re, im)) / ((b - a) * SR);
    };
    expect(20 * Math.log10(amp(out, 1000, 0.8, 1.2) / amp(x, 1000, 0.8, 1.2))).toBeCloseTo(-12, 0);
    expect(amp(out, 4000, 0.8, 1.2) / amp(x, 4000, 0.8, 1.2)).toBeCloseTo(1, 3);
    expect(amp(out, 1000, 0.0, 0.3) / amp(x, 1000, 0.0, 0.3)).toBeCloseTo(1, 3);
  });

  it("applies all channels through the same code (export / preview share applySpectralRegions)", () => {
    const s = scenario(1500, 3500, 0.06);
    const [l, r] = applySpectralRegions([s.noisy, s.noisy.slice()], SR, [s.lasso("heal")]);
    const direct = applySpectralRegionsToChannel(s.noisy, SR, [s.lasso("heal")], 0);
    expect(Array.from(l)).toEqual(Array.from(direct));
    expect(r.length).toBe(l.length);
  });
});
