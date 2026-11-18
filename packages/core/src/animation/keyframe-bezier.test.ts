import { describe, expect, it } from "vitest";
import type { Keyframe } from "../types/timeline";
import { AnimationEngine } from "../video/animation-engine";
import { keyframeEngine } from "../video/keyframe-engine";
import { evaluateKeyframesAt } from "./evaluate-keyframes";
import {
  EASE_PRESETS,
  clampBezierHandles,
  effectiveBezierHandles,
  keyframeSpeedAt,
  solveBezierEase,
  BEZIER_Y_MAX,
  BEZIER_Y_MIN,
} from "./keyframe-bezier";
import { copyKeyframeSet, pasteKeyframeSet } from "./keyframe-clipboard";

const key = (over: Partial<Keyframe> & Pick<Keyframe, "id" | "time" | "value">): Keyframe => ({
  property: "opacity",
  easing: "linear",
  ...over,
});

describe("solveBezierEase", () => {
  it("is the identity for the linear handles and pins endpoints", () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(solveBezierEase(t, 1 / 3, 1 / 3, 2 / 3, 2 / 3)).toBeCloseTo(t, 6);
    }
    expect(solveBezierEase(0, 0.2, 0.9, 0.7, 0.1)).toBe(0);
    expect(solveBezierEase(1, 0.2, 0.9, 0.7, 0.1)).toBe(1);
  });

  it("keeps time monotonic: progress is a function of time even with extreme handle x", () => {
    // Handle x outside 0..1 would fold the time axis back on itself; it must be clamped.
    const cases: [number, number, number, number][] = [
      [5, 0.5, -5, 0.5],
      [-3, 0, 4, 1],
      [1, 2, 0, -1],
    ];
    for (const [x1, y1, x2, y2] of cases) {
      const clamped = clampBezierHandles({ in: { x: x1, y: y1 }, out: { x: x2, y: y2 } });
      expect(clamped.in.x).toBeGreaterThanOrEqual(0);
      expect(clamped.in.x).toBeLessThanOrEqual(1);
      expect(clamped.out.x).toBeGreaterThanOrEqual(0);
      expect(clamped.out.x).toBeLessThanOrEqual(1);
      // Same value whether handles are pre-clamped or not (the solver clamps too).
      for (let i = 0; i <= 50; i++) {
        const t = i / 50;
        expect(solveBezierEase(t, x1, y1, x2, y2)).toBeCloseTo(
          solveBezierEase(t, clamped.in.x, clamped.in.y, clamped.out.x, clamped.out.y),
          9,
        );
      }
    }
  });

  it("is monotonic in time when progress handles are within 0..1", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const v = solveBezierEase(i / 400, 0.8, 0.1, 0.2, 0.9);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("allows bounded overshoot and clamps handle progress", () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => solveBezierEase(i / 100, 0.3, 2, 0.7, 1)));
    expect(peak).toBeGreaterThan(1);
    const clamped = clampBezierHandles({ in: { x: 0.5, y: 99 }, out: { x: 0.5, y: -99 } });
    expect(clamped.in.y).toBe(BEZIER_Y_MAX);
    expect(clamped.out.y).toBe(BEZIER_Y_MIN);
    expect(clampBezierHandles({ in: { x: NaN, y: NaN }, out: { x: Infinity, y: 1 } }).in.x).toBeGreaterThanOrEqual(0);
  });

  it("ease presets expose the expected shapes", () => {
    const f = (id: keyof typeof EASE_PRESETS, t: number) => {
      const h = EASE_PRESETS[id].bezierHandles!;
      return solveBezierEase(t, h.in.x, h.in.y, h.out.x, h.out.y);
    };
    expect(f("ease-in", 0.25)).toBeLessThan(0.25);
    expect(f("ease-out", 0.25)).toBeGreaterThan(0.25);
    expect(f("ease-in-out", 0.5)).toBeCloseTo(0.5, 3);
    expect(EASE_PRESETS.hold.bezierHandles).toBeUndefined();
    expect(effectiveBezierHandles({ easing: "hold" })).toBeNull();
    expect(effectiveBezierHandles({ easing: "linear" })).not.toBeNull();
  });
});

describe("preview and export evaluate bezier keyframes identically", () => {
  const keys: Keyframe[] = [
    key({ id: "a", time: 0, value: 0, easing: "bezier", bezierHandles: { in: { x: 0.9, y: 0 }, out: { x: 0.1, y: 1.4 } } }),
    key({ id: "b", time: 2, value: 100 }),
  ];
  it("AnimationEngine (preview), KeyframeEngine (export) and evaluateKeyframesAt agree", () => {
    const preview = new AnimationEngine();
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * 2;
      const p = preview.getValueAtTime(keys, t).value as number;
      const e = keyframeEngine.getValueAtTime(keys, t).value as number;
      const m = evaluateKeyframesAt(keys, t).get("opacity") as number;
      expect(p).toBeCloseTo(e, 9);
      expect(m).toBeCloseTo(e, 9);
    }
    // And it really is not linear, so the handles are being honoured.
    expect(keyframeEngine.getValueAtTime(keys, 0.5).value as number).not.toBeCloseTo(25, 0);
  });
  it("hold keeps the start value until the next key", () => {
    const hold = [key({ id: "a", time: 0, value: 1, easing: "hold" }), key({ id: "b", time: 1, value: 5 })];
    expect(keyframeEngine.getValueAtTime(hold, 0.99).value).toBe(1);
    expect(new AnimationEngine().getValueAtTime(hold, 0.99).value).toBe(1);
  });
});

describe("keyframeSpeedAt", () => {
  it("is constant for linear and zero for hold, peaking mid-segment for ease-in-out", () => {
    const lin = [key({ id: "a", time: 0, value: 0 }), key({ id: "b", time: 2, value: 10 })];
    const ease = (t: number, k: Keyframe) => keyframeEngine.easeSegment(t, k);
    expect(keyframeSpeedAt(lin, 1, ease)).toBeCloseTo(5, 3);
    const io = [{ ...lin[0], ...EASE_PRESETS["ease-in-out"] }, lin[1]] as Keyframe[];
    expect(keyframeSpeedAt(io, 1, ease)).toBeGreaterThan(keyframeSpeedAt(io, 0.1, ease));
    const hold = [{ ...lin[0], easing: "hold" as const }, lin[1]];
    expect(keyframeSpeedAt(hold, 1, ease)).toBe(0);
  });
});

describe("keyframe clipboard", () => {
  const src = [
    key({ id: "a", time: 1, value: 0, bezierHandles: { in: { x: 0.2, y: 0 }, out: { x: 0.8, y: 1 } }, easing: "bezier" }),
    key({ id: "b", time: 3, value: 1 }),
  ];
  it("rebases to the playhead, keeps handles and assigns fresh ids", () => {
    let n = 0;
    const out = pasteKeyframeSet([], copyKeyframeSet(src), { time: 5, newId: () => `n${n++}` });
    expect(out.map((k) => k.time)).toEqual([5, 7]);
    expect(out[0].bezierHandles).toEqual(src[0].bezierHandles);
    expect(out.map((k) => k.id)).toEqual(["n0", "n1"]);
  });
  it("retargets a single copied property and replaces keys at the same instant", () => {
    const existing = [key({ id: "x", time: 5, value: 9, property: "scale.x" })];
    const out = pasteKeyframeSet(existing, copyKeyframeSet(src), { time: 5, targetProperty: "scale.x", newId: () => "z" });
    expect(out.every((k) => k.property === "scale.x")).toBe(true);
    expect(out.find((k) => k.id === "x")).toBeUndefined();
  });
  it("skips retargeting onto an incompatible value type", () => {
    const existing = [key({ id: "t", time: 0, value: "hi", property: "text" })];
    const out = pasteKeyframeSet(existing, copyKeyframeSet(src), { time: 0, targetProperty: "text", newId: () => "z" });
    expect(out).toHaveLength(1);
  });
});
