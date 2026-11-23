import { describe, expect, it } from "vitest";
import { applySpectralRegionsToChannel } from "./spectral-dsp";
import { SR, measure } from "./spectral-fixtures";
import { sanitizeSpectralRegions } from "./spectral-regions";
import { amplificationDb, benchCases, perturb, scoreFill, type BenchCase, type FillScore } from "./spectral-heal-bench";

interface Row {
  readonly c: BenchCase;
  readonly remove: FillScore;
  readonly heal: FillScore;
  readonly none: FillScore;
  readonly ampRemove: number;
  readonly ampHeal: number;
  readonly leftRemove: number;
  readonly leftHeal: number;
}

const rows: Row[] = benchCases().map((c) => {
  const rm = c.region("remove");
  const hl = c.region("heal");
  const outRm = applySpectralRegionsToChannel(c.noisy, SR, [rm]);
  const outHl = applySpectralRegionsToChannel(c.noisy, SR, [hl]);
  const interferer = c.noisy.map((v, i) => v - c.clean[i]);
  return {
    c,
    none: scoreFill(c.noisy, c.clean, hl),
    remove: scoreFill(outRm, c.clean, rm),
    heal: scoreFill(outHl, c.clean, hl),
    ampRemove: amplificationDb(c.noisy, rm),
    ampHeal: amplificationDb(c.noisy, hl),
    leftRemove: measure(outRm, c.clean, interferer, [rm]).whistleLeftDb,
    leftHeal: measure(outHl, c.clean, interferer, [hl]).whistleLeftDb,
  };
});
const byName = (prefix: string): Row => {
  const row = rows.find((r) => r.c.name.startsWith(prefix));
  if (!row) throw new Error(prefix);
  return row;
};

describe("heal vs remove, measured against the clean signal under the interferer", () => {
  it("prints the table", () => {
    const f = (x: number) => x.toFixed(1).padStart(6);
    const line = (name: string, mode: string, s: FillScore, amp: number, left: number) =>
      `${name.padEnd(38)} ${mode.padEnd(6)} err ${f(s.errDb)} dB | level ${f(s.levelDb)} dB | holes ${(s.holes * 100).toFixed(0).padStart(3)}% | texture ${f(s.textureDb)} dB | corr ${s.corr.toFixed(2)} | left ${f(left)} dB | amp ${f(amp)} dB`;
    const out = rows.flatMap((r) => [line(r.c.name, "remove", r.remove, r.ampRemove, r.leftRemove), line(r.c.name, "heal", r.heal, r.ampHeal, r.leftHeal)]);
    console.info(`\n[spectral heal quality] error vs clean inside the mask (dB re clean energy), level of the fill vs clean, share of holes, std-dev of log magnitude vs clean, correlation, interferer left, 3e-8 amplification\n${out.join("\n")}`);
    expect(rows.length).toBe(10);
  });

  it("is numerically stable: a tiny input perturbation changes the output no more than remove does, +6 dB", () => {
    for (const r of rows) {
      expect(r.ampHeal, `${r.c.name}: heal ${r.ampHeal.toFixed(1)} dB, remove ${r.ampRemove.toFixed(1)} dB`).toBeLessThan(Math.max(r.ampRemove, 0) + 6);
    }
  });

  it("two decodes of the same sound that differ by one 16-bit LSB give previews and exports that match to better than -55 dB", () => {
    for (const name of ["a1", "b1", "c3", "d2"]) {
      const r = byName(name);
      const other = perturb(r.c.noisy, 1 / 32768, 9);
      const a = applySpectralRegionsToChannel(r.c.noisy, SR, [r.c.region("heal")]);
      const b = applySpectralRegionsToChannel(other, SR, [r.c.region("heal")]);
      let diff = 0;
      let energy = 0;
      for (let i = 0; i < a.length; i += 1) {
        diff += (a[i] - b[i]) ** 2;
        energy += a[i] ** 2;
      }
      const mismatch = 10 * Math.log10(diff / energy);
      expect(mismatch, name).toBeLessThan(-55);
    }
  });

  it("keeps the background: the filled level matches the surroundings in noise, remove leaves a quieter hole", () => {
    for (const name of ["a1", "a2", "d1", "d2"]) {
      const r = byName(name);
      expect(r.heal.levelDb, `${name} heal level`).toBeGreaterThan(-2);
      expect(r.heal.levelDb, `${name} heal level`).toBeLessThan(2.5);
      expect(r.remove.levelDb, `${name} remove level`).toBeLessThan(-3);
      expect(r.heal.holes, `${name} holes`).toBeLessThan(0.15);
      expect(r.heal.holes, `${name} holes`).toBeLessThan(r.remove.holes - 0.15);
      expect(Math.abs(r.heal.textureDb), `${name} texture`).toBeLessThan(1.5);
    }
  });

  it("predicts steady partials through a gap: a cough over a chord is filled closer to the clean chord than remove does", () => {
    for (const name of ["c1", "c3"]) {
      const r = byName(name);
      expect(r.heal.errDb, `${name}: heal ${r.heal.errDb.toFixed(1)} dB, remove ${r.remove.errDb.toFixed(1)} dB`).toBeLessThan(r.remove.errDb - 2.5);
      expect(r.heal.errDb).toBeLessThan(0);
      expect(r.heal.corr).toBeGreaterThan(0.5);
    }
  });

  it("removes a tone selected over a long span instead of continuing it", () => {
    const n = Math.round(1.6 * SR);
    const clean = Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR));
    const region = sanitizeSpectralRegions([{ id: "a", enabled: true, gainDb: -120, mode: "heal", startTime: 0.3, endTime: 1.3, lowHz: 800, highHz: 1200 }])[0];
    const out = applySpectralRegionsToChannel(clean, SR, [region]);
    const rms = (a: Float32Array, t0: number, t1: number) => Math.sqrt(a.slice(Math.floor(t0 * SR), Math.floor(t1 * SR)).reduce((s, v) => s + v * v, 0) / ((t1 - t0) * SR));
    expect(rms(out, 0.45, 1.15)).toBeLessThan(rms(clean, 0.45, 1.15) * 0.05);
    expect(rms(out, 0, 0.2)).toBeCloseTo(rms(clean, 0, 0.2), 5);
  });

  it("is honest where it does not win: unpredictable cells get level-matched noise, which scores worse than a quiet hole on raw error", () => {
    // Noise cannot be predicted: any fill at the right level is uncorrelated with what was there, so its complex error is about +3 dB
    // (equal energy, no correlation) while a fill 6 dB too quiet scores about +1 dB. Heal is chosen for the missing hole, not for this number.
    for (const name of ["a1", "d1"]) {
      const r = byName(name);
      expect(r.heal.errDb).toBeGreaterThan(r.remove.errDb);
      expect(Math.abs(r.heal.corr)).toBeLessThan(0.15);
    }
    // Gliding or vibrato partials, and dense beating partials, are not continued: heal stays level-correct but is no better than remove on error.
    for (const name of ["b1", "b2", "c4"]) {
      const r = byName(name);
      expect(r.heal.errDb).toBeGreaterThan(r.remove.errDb - 0.5);
      expect(r.heal.levelDb).toBeGreaterThan(r.remove.levelDb + 3);
    }
  });
});
