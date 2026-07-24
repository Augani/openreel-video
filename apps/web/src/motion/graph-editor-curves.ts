import { EASING_FUNCTIONS, cubicBezier } from "@openreel/core";
import type { EasingType } from "@openreel/core";

export interface GraphSegmentFrame {
  readonly t0: number;
  readonly t1: number;
  readonly v0: number;
  readonly v1: number;
  readonly toX: (time: number) => number;
  readonly toY: (value: number) => number;
  readonly fromX: (x: number) => number;
  readonly fromY: (y: number) => number;
}

export interface NormalizedHandle {
  readonly x: number;
  readonly y: number;
}

export interface BezierHandlePair {
  readonly in: NormalizedHandle;
  readonly out: NormalizedHandle;
}

export interface SpeedSegment {
  readonly t0: number;
  readonly t1: number;
  readonly v0: number;
  readonly v1: number;
  readonly easing: EasingType;
  readonly bezierHandles?: BezierHandlePair;
}

export interface SpeedSample {
  readonly time: number;
  readonly speed: number;
}

const HANDLE_X_MIN = 0;
const HANDLE_X_MAX = 1;
const HANDLE_Y_MIN = -1;
const HANDLE_Y_MAX = 2;
const FLAT_EPSILON = 1e-6;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampProgress(value: number): number {
  return clamp(value, 0, 1);
}

export function isFlatSegment(v0: number, v1: number): boolean {
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return true;
  return Math.abs(v1 - v0) < FLAT_EPSILON;
}

export function normalizedHandleToGraphPoint(
  handle: { readonly x: number; readonly y: number },
  seg: GraphSegmentFrame,
): { readonly x: number; readonly y: number } {
  const time = seg.t0 + handle.x * (seg.t1 - seg.t0);
  const value = seg.v0 + handle.y * (seg.v1 - seg.v0);
  return { x: seg.toX(time), y: seg.toY(value) };
}

export function graphPointToNormalizedHandle(
  point: { readonly x: number; readonly y: number },
  seg: GraphSegmentFrame,
): { readonly x: number; readonly y: number } {
  const timeSpan = seg.t1 - seg.t0;
  const valueSpan = seg.v1 - seg.v0;
  const time = seg.fromX(point.x);
  const value = seg.fromY(point.y);
  const rawX = timeSpan !== 0 ? (time - seg.t0) / timeSpan : 0;
  const rawY = valueSpan !== 0 ? (value - seg.v0) / valueSpan : 0;
  return {
    x: clamp(rawX, HANDLE_X_MIN, HANDLE_X_MAX),
    y: clamp(rawY, HANDLE_Y_MIN, HANDLE_Y_MAX),
  };
}

function isNamedEasing(easing: EasingType): boolean {
  return easing in EASING_FUNCTIONS;
}

function evaluateEasing(
  progress: number,
  easing: EasingType,
  bezierHandles: BezierHandlePair | undefined,
): number {
  const clampedT = clampProgress(progress);
  if (bezierHandles && easing === "bezier") {
    return cubicBezier(
      bezierHandles.in.x,
      bezierHandles.in.y,
      bezierHandles.out.x,
      bezierHandles.out.y,
    )(clampedT);
  }
  switch (easing) {
    case "linear":
      return clampedT;
    case "ease-in":
      return clampedT * clampedT;
    case "ease-out":
      return clampedT * (2 - clampedT);
    case "ease-in-out":
      return clampedT < 0.5
        ? 2 * clampedT * clampedT
        : -1 + (4 - 2 * clampedT) * clampedT;
    case "bezier":
      return cubicBezier(0.25, 0.1, 0.25, 1.0)(clampedT);
    default:
      if (isNamedEasing(easing)) {
        return EASING_FUNCTIONS[easing](clampedT);
      }
      return clampedT;
  }
}

function evaluateSegmentValue(segment: SpeedSegment, time: number): number {
  const duration = segment.t1 - segment.t0;
  if (duration <= 0) return segment.v1;
  const linearProgress = clampProgress((time - segment.t0) / duration);
  const eased = evaluateEasing(
    linearProgress,
    segment.easing,
    segment.bezierHandles,
  );
  return segment.v0 + (segment.v1 - segment.v0) * eased;
}

export function seedBezierHandlesFromEasing(
  easing: EasingType,
): BezierHandlePair {
  const fn = isNamedEasing(easing)
    ? EASING_FUNCTIONS[easing]
    : EASING_FUNCTIONS.linear;
  const firstY = fn(1 / 3);
  const secondY = fn(2 / 3);
  return {
    in: { x: 1 / 3, y: Number.isFinite(firstY) ? firstY : 1 / 3 },
    out: { x: 2 / 3, y: Number.isFinite(secondY) ? secondY : 2 / 3 },
  };
}

export function sampleSegmentSpeed(
  segment: SpeedSegment,
  samples: number,
): SpeedSample[] {
  const count = Math.max(2, Math.floor(samples));
  const duration = segment.t1 - segment.t0;
  if (!Number.isFinite(duration) || duration <= 0) {
    return Array.from({ length: count }, () => ({
      time: segment.t0,
      speed: 0,
    }));
  }
  const step = duration / (count - 1);
  const delta = step > 0 ? step : duration / count;
  const result: SpeedSample[] = [];
  for (let index = 0; index < count; index++) {
    const time = index === count - 1 ? segment.t1 : segment.t0 + index * step;
    const half = Math.min(delta / 2, duration / 2);
    const before = Math.max(segment.t0, time - half);
    const after = Math.min(segment.t1, time + half);
    const span = after - before;
    const speed =
      span > 0
        ? (evaluateSegmentValue(segment, after) -
            evaluateSegmentValue(segment, before)) /
          span
        : 0;
    result.push({ time, speed });
  }
  return result;
}
