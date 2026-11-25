import { describe, expect, it } from "vitest";
import {
  STATS_H,
  STATS_W,
  applyDeflicker,
  clipHasDeflicker,
  cutThreshold,
  deflickerGains,
  findActiveDeflicker,
  isDeflickerNeutral,
  planDeflickerWindow,
  resolveDeflicker,
  shotRange,
  statsFromRgba,
  structuralDifference,
  type FrameStats,
} from "./deflicker";
import { clipHasTemporalEffects } from "./temporal-effects";

/** Deterministic pseudo random in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Scene = (x: number, y: number) => [number, number, number];
const sceneA: Scene = (x, y) => {
  const v = 0.25 + 0.3 * (x / (STATS_W - 1)) + 0.05 * Math.sin(y / 3);
  return [v, v * 0.95, v * 0.9];
};
const sceneB: Scene = (x, y) => {
  const v = (Math.floor(x / 8) + Math.floor(y / 6)) % 2 === 0 ? 0.8 : 0.45;
  return [v * 0.9, v, v * 0.85];
};

function frame(scene: Scene, gain: [number, number, number] | number): Uint8ClampedArray {
  const g = typeof gain === "number" ? [gain, gain, gain] : gain;
  const d = new Uint8ClampedArray(STATS_W * STATS_H * 4);
  for (let y = 0; y < STATS_H; y++) {
    for (let x = 0; x < STATS_W; x++) {
      const c = scene(x, y);
      const o = (y * STATS_W + x) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = Math.round(Math.min(1, c[k] * g[k]) * 255);
      d[o + 3] = 255;
    }
  }
  return d;
}

const stats = (d: Uint8ClampedArray): FrameStats => statsFromRgba(d, STATS_W, STATS_H);
const variance = (v: number[]): number => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
};

/** Corrects every frame of a sequence the way the render path does (window of `window` frames) and returns the corrected luma. */
function correct(frames: Uint8ClampedArray[], params: Record<string, unknown>): { before: number[]; after: number[] } {
  const p = resolveDeflicker(params);
  const half = Math.floor(p.window / 2);
  const all = frames.map(stats);
  const before = all.map((s) => s.y);
  const after = frames.map((d, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(frames.length - 1, i + half);
    const win = all.slice(lo, hi + 1);
    const offsets = win.map((_, k) => lo + k - i);
    const g = deflickerGains(win, offsets, params);
    const out = new Uint8ClampedArray(d);
    applyDeflicker(out, [g.r, g.g, g.b]);
    return stats(out).y;
  });
  return { before, after };
}

describe("deflicker params", () => {
  it("is neutral until luma or colour correction is on", () => {
    expect(isDeflickerNeutral({})).toBe(true);
    expect(isDeflickerNeutral({ luma: 0, color: 0, window: 31 })).toBe(true);
    expect(isDeflickerNeutral({ luma: 1 })).toBe(false);
    expect(isDeflickerNeutral({ color: 20 })).toBe(false);
  });

  it("makes the window odd and keeps it within 3..31", () => {
    expect(resolveDeflicker({ window: 8 }).window).toBe(9);
    expect(resolveDeflicker({ window: 1 }).window).toBe(3);
    expect(resolveDeflicker({ window: 99 }).window).toBe(31);
    expect(resolveDeflicker({ window: Number.NaN }).window).toBe(15);
  });
});

describe("deflicker window plan", () => {
  it("snaps to the frame grid and covers +-half frames", () => {
    const plan = planDeflickerWindow(1.0166, 10, 30, 5);
    expect(plan.map((f) => f.offset)).toEqual([-2, -1, 0, 1, 2]);
    expect(plan.map((f) => Math.round(f.localTime * 30))).toEqual([28, 29, 30, 31, 32]);
  });

  it("drops frames before the first and after the last frame of the clip", () => {
    expect(planDeflickerWindow(0, 10, 30, 7).map((f) => f.offset)).toEqual([0, 1, 2, 3]);
    // 10 s at 30 fps: last frame is index 299
    expect(planDeflickerWindow(299 / 30, 10, 30, 7).map((f) => f.offset)).toEqual([-3, -2, -1, 0]);
  });

  it("is a pure function of the time (render order does not matter)", () => {
    const a = planDeflickerWindow(3.3333, 8, 24, 9);
    planDeflickerWindow(7.5, 8, 24, 9);
    expect(planDeflickerWindow(3.3333, 8, 24, 9)).toEqual(a);
  });
});

describe("scene cut detection", () => {
  it("ignores a global brightness change but flags a different picture", () => {
    const a = stats(frame(sceneA, 1));
    const flickered = stats(frame(sceneA, 1.25));
    const dim = stats(frame(sceneA, 0.7));
    const other = stats(frame(sceneB, 1));
    expect(structuralDifference(a, flickered)).toBeLessThan(0.03);
    expect(structuralDifference(a, dim)).toBeLessThan(0.03);
    expect(structuralDifference(a, other)).toBeGreaterThan(cutThreshold(0.5));
  });

  it("finds the shot of the centre frame", () => {
    const seq = [...Array(5)].map(() => stats(frame(sceneA, 1))).concat([...Array(5)].map(() => stats(frame(sceneB, 1))));
    expect(shotRange(seq, 2, 0.5)).toEqual({ start: 0, end: 4 });
    expect(shotRange(seq, 5, 0.5)).toEqual({ start: 5, end: 9 });
  });
});

describe("deflicker gains", () => {
  const A_FRAMES = 40;
  function flickeringCut(seed: number): { frames: Uint8ClampedArray[]; cutAt: number } {
    const rand = rng(seed);
    const frames: Uint8ClampedArray[] = [];
    for (let i = 0; i < A_FRAMES; i++) frames.push(frame(sceneA, 1 + 0.22 * (rand() * 2 - 1)));
    for (let i = 0; i < A_FRAMES; i++) frames.push(frame(sceneB, 1 + 0.22 * (rand() * 2 - 1)));
    return { frames, cutAt: A_FRAMES };
  }

  it("cuts the frame-to-frame luma variance of a flickering sequence by more than 80%", () => {
    const { frames, cutAt } = flickeringCut(7);
    const { before, after } = correct(frames, { window: 15, luma: 100, color: 0 });
    for (const [lo, hi] of [[0, cutAt], [cutAt, frames.length]] as const) {
      const reduction = 1 - variance(after.slice(lo, hi)) / variance(before.slice(lo, hi));
      expect(reduction, `shot ${lo}-${hi}`).toBeGreaterThan(0.8);
    }
    // frame-to-frame differences inside a shot
    const diffs = (v: number[]): number[] => v.slice(1).map((x, i) => x - v[i]);
    const jump = 1 - variance(diffs(after.slice(0, cutAt))) / variance(diffs(before.slice(0, cutAt)));
    expect(jump).toBeGreaterThan(0.8);
  });

  it("does not smooth or lag across a scene cut", () => {
    const { frames, cutAt } = flickeringCut(11);
    const clean = (scene: Scene): number => stats(frame(scene, 1)).y;
    const { after } = correct(frames, { window: 15, luma: 100, color: 0 });
    // The frames right beside the cut land on their own shot's level, not between the two shots. The very first and
    // last frame of a shot only have a one-sided window, so they keep more of the (here +-22%) flicker.
    for (const [i, level, tolerance] of [
      [cutAt - 1, clean(sceneA), 0.1],
      [cutAt, clean(sceneB), 0.1],
      [cutAt - 3, clean(sceneA), 0.08],
      [cutAt + 1, clean(sceneB), 0.08],
      [cutAt + 3, clean(sceneB), 0.08],
    ] as const) {
      expect(Math.abs(after[i] - level) / level, `frame ${i}`).toBeLessThan(tolerance);
    }
    // the two shots keep their distinct levels
    expect(Math.abs(after[cutAt] - after[cutAt - 1])).toBeGreaterThan(0.1);
  });

  it("keeps a real fade (trend preserved) while removing flicker", () => {
    const rand = rng(3);
    const frames: Uint8ClampedArray[] = [];
    const level: number[] = [];
    for (let i = 0; i < 40; i++) {
      const fade = 0.4 + (0.9 * i) / 39;
      level.push(fade);
      frames.push(frame(sceneA, fade * (1 + 0.15 * (rand() * 2 - 1))));
    }
    const { after } = correct(frames, { window: 15, luma: 100, color: 0 });
    const clean = level.map((f) => stats(frame(sceneA, f)).y);
    // middle of the fade follows the ideal line closely
    for (let i = 8; i < 32; i++) expect(Math.abs(after[i] - clean[i]) / clean[i], `frame ${i}`).toBeLessThan(0.05);
  });

  it("balances a flickering colour channel with colour correction", () => {
    const rand = rng(21);
    const frames = [...Array(30)].map(() => frame(sceneA, [1, 1, 1 + 0.3 * (rand() * 2 - 1)]));
    const blueMean = (d: Uint8ClampedArray): number => stats(d).b;
    const half = 7;
    const all = frames.map(stats);
    const run = (color: number): number[] =>
      frames.map((d, i) => {
        const lo = Math.max(0, i - half);
        const hi = Math.min(frames.length - 1, i + half);
        const win = all.slice(lo, hi + 1);
        const g = deflickerGains(win, win.map((_, k) => lo + k - i), { window: 15, luma: 0, color });
        const out = new Uint8ClampedArray(d);
        applyDeflicker(out, [g.r, g.g, g.b]);
        return blueMean(out);
      });
    const raw = frames.map(blueMean);
    expect(variance(run(100))).toBeLessThan(variance(raw) * 0.25);
    expect(variance(run(0))).toBeCloseTo(variance(raw), 6);
  });

  it("limits the correction", () => {
    const seq = [stats(frame(sceneA, 1)), stats(frame(sceneA, 0.3)), stats(frame(sceneA, 1))];
    const g = deflickerGains(seq, [-1, 0, 1], { luma: 100, limit: 20 });
    expect(g.r).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(g.r).toBeGreaterThan(1.15);
  });

  it("is the identity for a lone frame and for a frame between two cuts", () => {
    const lone = [stats(frame(sceneA, 1))];
    expect(deflickerGains(lone, [0], { luma: 100 })).toMatchObject({ r: 1, g: 1, b: 1 });
    const isolated = [stats(frame(sceneA, 1)), stats(frame(sceneB, 1.3)), stats(frame(sceneA, 1))];
    expect(deflickerGains(isolated, [-1, 0, 1], { luma: 100 })).toMatchObject({ r: 1, g: 1, b: 1 });
  });
});

describe("deflicker routing", () => {
  const effect = (params: Record<string, unknown>, enabled = true) => ({ id: "d1", type: "deflicker", enabled, params });

  it("finds the first enabled, non-neutral deflicker", () => {
    expect(findActiveDeflicker([effect({ luma: 100 })])).toEqual({ index: 0 });
    expect(findActiveDeflicker([{ type: "blur", params: {} }, effect({ luma: 100 })])).toEqual({ index: 1 });
    expect(findActiveDeflicker([effect({ luma: 0, color: 0 })])).toBeNull();
    expect(findActiveDeflicker([effect({ luma: 100 }, false)])).toBeNull();
  });

  it("sends clips with a deflicker (or keyframes that can switch one on) through the frame-reading renderer", () => {
    expect(clipHasDeflicker({ effects: [effect({ luma: 100 })] })).toBe(true);
    expect(clipHasDeflicker({ effects: [effect({ luma: 0 })] })).toBe(false);
    expect(
      clipHasDeflicker({ effects: [effect({ luma: 0 })], keyframes: [{ property: "fx:d1:luma" }] }),
    ).toBe(true);
    expect(
      clipHasDeflicker({ effects: [effect({ luma: 0 })], keyframes: [{ property: "fx:other:luma" }] }),
    ).toBe(false);
    expect(clipHasTemporalEffects({ effects: [effect({ luma: 100 })] })).toBe(true);
    expect(clipHasTemporalEffects({ effects: [] })).toBe(false);
  });
});
