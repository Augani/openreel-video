import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import { BEZIER_Y_MAX, BEZIER_Y_MIN, clampBezierHandles, solveBezierEase } from "./keyframe-bezier";
import { applyKeyframeInterpolation, segmentTangents } from "./keyframe-interpolation";
import { effectiveBezierHandles } from "./keyframe-bezier";

/** Independent reference: sample the parametric curve densely and interpolate progress at the wanted time. */
function reference(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const N = 200000;
  let px = 0, py = 0;
  for (let i = 1; i <= N; i++) {
    const u = i / N, v = 1 - u;
    const x = 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u;
    const y = 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u;
    if (x >= t) {
      const f = x === px ? 0 : (t - px) / (x - px);
      return py + (y - py) * f;
    }
    px = x; py = y;
  }
  return 1;
}

describe("temporal Bezier against an analytic reference", () => {
  const curves: [number, number, number, number][] = [
    [0.25, 0.1, 0.25, 1], [0.42, 0, 0.58, 1], [0.1, 0.9, 0.9, 0.1], [0.5, -0.5, 0.5, 1.5], [0, 0, 1, 1], [0.8, 2, 0.2, -1],
  ];
  for (const c of curves) {
    it(`cubic-bezier(${c.join(", ")}) matches the dense parametric solution`, () => {
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        expect(solveBezierEase(t, ...c)).toBeCloseTo(reference(t, ...c), 4);
      }
    });
  }

  it("clamps handle TIME to 0..1 (monotonic) and handle PROGRESS to the overshoot window", () => {
    const h = clampBezierHandles({ in: { x: -0.4, y: 9 }, out: { x: 1.7, y: -9 } });
    expect(h.in).toEqual({ x: 0, y: BEZIER_Y_MAX });
    expect(h.out).toEqual({ x: 1, y: BEZIER_Y_MIN });
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const y = solveBezierEase(t, -0.4, 0.3, 1.7, 0.8);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it("overshoots where the handles ask for it and never beyond the clamped window", () => {
    let max = -Infinity;
    for (let i = 0; i <= 200; i++) max = Math.max(max, solveBezierEase(i / 200, 0.3, 3, 0.7, 3));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(BEZIER_Y_MAX + 1e-9);
    // Beyond the window the request is clamped, so the curve is identical to the clamped one.
    expect(solveBezierEase(0.5, 0.3, 50, 0.7, 50)).toBeCloseTo(solveBezierEase(0.5, 0.3, BEZIER_Y_MAX, 0.7, BEZIER_Y_MAX), 9);
  });
});

describe("Auto Bezier tangent algorithm against the analytic slope", () => {
  const k = (id: string, time: number, value: number): Keyframe => ({ id, time, property: "opacity", value, easing: "linear" });
  const num = (key: Keyframe) => key as Keyframe & { value: number };

  it("an interior key's slope is the neighbour secant (value units per second)", () => {
    const keys = applyKeyframeInterpolation([k("a", 0, 0), k("b", 1, 1), k("c", 3, 3)], ["a", "b", "c"], "auto-bezier");
    const [a, b, c] = ["a", "b", "c"].map((id) => num(keys.find((x) => x.id === id)!));
    const expected = (3 - 0) / (3 - 0); // (c.value - a.value) / (c.time - a.time)
    expect(segmentTangents(a, b, effectiveBezierHandles(a)!).in).toBeCloseTo(expected, 6);
    expect(segmentTangents(b, c, effectiveBezierHandles(b)!).out).toBeCloseTo(expected, 6);
    // End keys are flat.
    expect(segmentTangents(a, b, effectiveBezierHandles(a)!).out).toBeCloseTo(0, 9);
    expect(segmentTangents(b, c, effectiveBezierHandles(b)!).in).toBeCloseTo(0, 9);
  });

  it("is flat at a local extremum so the curve never overshoots the keys", () => {
    const keys = applyKeyframeInterpolation([k("a", 0, 0), k("b", 1, 2), k("c", 2, 0)], ["a", "b", "c"], "auto-bezier");
    const [a, b] = ["a", "b"].map((id) => num(keys.find((x) => x.id === id)!));
    expect(segmentTangents(a, b, effectiveBezierHandles(a)!).in).toBeCloseTo(0, 9);
    for (let i = 0; i <= 100; i++) {
      const h = effectiveBezierHandles(a)!;
      const y = solveBezierEase(i / 100, h.in.x, h.in.y, h.out.x, h.out.y);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
