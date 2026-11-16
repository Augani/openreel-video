import type { EasingType, Keyframe } from "../types/timeline";

/**
 * Temporal Bezier model for the keyframe graph editor.
 *
 * A segment runs from keyframe A to the next keyframe B. Keyframe A stores the
 * two control points of that segment in normalized (0..1) time / progress space:
 *   bezierHandles.in  = P1, the handle leaving A   (x1, y1)
 *   bezierHandles.out = P2, the handle entering B  (x2, y2)
 * This is exactly CSS cubic-bezier(x1, y1, x2, y2). Handle time (x) is clamped to
 * [0, 1] so the time axis stays monotonic (one progress value per instant); handle
 * progress (y) may over/undershoot within [BEZIER_Y_MIN, BEZIER_Y_MAX].
 * Preview, export and the graph editor all evaluate through solveBezierEase.
 */

export interface BezierHandlePoint {
  readonly x: number;
  readonly y: number;
}
export interface BezierHandles {
  readonly in: BezierHandlePoint;
  readonly out: BezierHandlePoint;
}

export const BEZIER_Y_MIN = -2;
export const BEZIER_Y_MAX = 3;
export const DEFAULT_BEZIER_HANDLES: BezierHandles = {
  in: { x: 0.25, y: 0.1 },
  out: { x: 0.25, y: 1 },
};
/** P1=(1/3,1/3), P2=(2/3,2/3) is exactly the identity curve. */
export const LINEAR_BEZIER_HANDLES: BezierHandles = {
  in: { x: 1 / 3, y: 1 / 3 },
  out: { x: 2 / 3, y: 2 / 3 },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export function clampBezierHandles(handles: BezierHandles): BezierHandles {
  return {
    in: {
      x: clamp(finiteOr(handles.in.x, DEFAULT_BEZIER_HANDLES.in.x), 0, 1),
      y: clamp(finiteOr(handles.in.y, DEFAULT_BEZIER_HANDLES.in.y), BEZIER_Y_MIN, BEZIER_Y_MAX),
    },
    out: {
      x: clamp(finiteOr(handles.out.x, DEFAULT_BEZIER_HANDLES.out.x), 0, 1),
      y: clamp(finiteOr(handles.out.y, DEFAULT_BEZIER_HANDLES.out.y), BEZIER_Y_MIN, BEZIER_Y_MAX),
    },
  };
}

/** Eased progress for linear progress `t` along a cubic-bezier(x1,y1,x2,y2) curve. */
export function solveBezierEase(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  const cx1 = clamp(finiteOr(x1, 0), 0, 1);
  const cx2 = clamp(finiteOr(x2, 1), 0, 1);
  const cy1 = clamp(finiteOr(y1, 0), BEZIER_Y_MIN, BEZIER_Y_MAX);
  const cy2 = clamp(finiteOr(y2, 1), BEZIER_Y_MIN, BEZIER_Y_MAX);
  const ax = 3 * cx1 - 3 * cx2 + 1, bx = 3 * cx2 - 6 * cx1, cx = 3 * cx1;
  const ay = 3 * cy1 - 3 * cy2 + 1, by = 3 * cy2 - 6 * cy1, cy = 3 * cy1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  // Newton from u=t, guarded; bisection (X is monotonic because x1,x2 are in [0,1]) as fallback.
  let u = t;
  for (let i = 0; i < 8; i++) {
    const err = sx(u) - t;
    if (Math.abs(err) < 1e-9) return sy(u);
    const slope = dx(u);
    if (Math.abs(slope) < 1e-6) break;
    u -= err / slope;
  }
  let lo = 0, hi = 1;
  u = t;
  for (let i = 0; i < 40; i++) {
    const err = sx(u) - t;
    if (Math.abs(err) < 1e-9) break;
    if (err > 0) hi = u; else lo = u;
    u = (lo + hi) / 2;
  }
  return sy(u);
}

export type EasePresetId = "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";
export interface EasePresetUpdate {
  readonly easing: EasingType;
  readonly bezierHandles: BezierHandles | undefined;
}
/** Presets set a Bezier (so handles stay editable) except linear/hold, which clear handles. */
export const EASE_PRESETS: Readonly<Record<EasePresetId, EasePresetUpdate>> = {
  linear: { easing: "linear", bezierHandles: undefined },
  hold: { easing: "hold", bezierHandles: undefined },
  "ease-in": { easing: "bezier", bezierHandles: { in: { x: 0.42, y: 0 }, out: { x: 1, y: 1 } } },
  "ease-out": { easing: "bezier", bezierHandles: { in: { x: 0, y: 0 }, out: { x: 0.58, y: 1 } } },
  "ease-in-out": { easing: "bezier", bezierHandles: { in: { x: 0.42, y: 0 }, out: { x: 0.58, y: 1 } } },
};

/** Handles to draw/edit for a keyframe's outgoing segment; null when its easing is not bezier-expressible. */
export function effectiveBezierHandles(key: Pick<Keyframe, "easing" | "bezierHandles">): BezierHandles | null {
  switch (key.easing) {
    case "bezier":
      return clampBezierHandles(key.bezierHandles ?? DEFAULT_BEZIER_HANDLES);
    case "linear":
      return LINEAR_BEZIER_HANDLES;
    // Legacy named easings are quadratic in the engines; ease-in/out are exact cubic-bezier equivalents.
    case "ease-in":
      return { in: { x: 1 / 3, y: 0 }, out: { x: 2 / 3, y: 1 / 3 } };
    case "ease-out":
      return { in: { x: 1 / 3, y: 2 / 3 }, out: { x: 2 / 3, y: 1 } };
    case "ease-in-out":
      return EASE_PRESETS["ease-in-out"].bezierHandles ?? null;
    default:
      return null;
  }
}

/** Speed (value units per second) at `time` for a property's keyframes, given the shared easing function. */
export function keyframeSpeedAt(
  keyframes: readonly Keyframe[],
  time: number,
  easeAt: (t: number, key: Keyframe) => number,
): number {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (time < a.time || time > b.time) continue;
    if (typeof a.value !== "number" || typeof b.value !== "number") return 0;
    const dur = b.time - a.time;
    if (!(dur > 0)) return 0;
    const t = (time - a.time) / dur;
    const h = 1e-3;
    const t0 = clamp(t - h, 0, 1), t1 = clamp(t + h, 0, 1);
    if (t1 <= t0) return 0;
    return ((b.value - a.value) * (easeAt(t1, a) - easeAt(t0, a))) / ((t1 - t0) * dur);
  }
  return 0;
}
