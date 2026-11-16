import type { AutomationPoint } from "../types/timeline";
import { sanitizeVolumeAutomationPoints } from "./clip-volume-automation";
import { clampVolume } from "./volume-automation";

/**
 * Pure editing helpers for a clip's volume automation lane (linear gain 0..4,
 * times in clip-local timeline seconds). The on-timeline gain line, the
 * inspector keyframe button and the shortcut all go through these so every
 * surface produces the same sanitised, strictly time-ordered point list.
 */

/** Visible range of the gain line. 4 (the volume ceiling) is +12.04 dB. */
export const GAIN_DB_MIN = -60;
export const GAIN_DB_MAX = 12;

/** Smallest time gap kept between neighbouring points, so times stay unique. */
export const MIN_POINT_GAP = 0.001;

export const volumeToDb = (volume: number): number =>
  volume > 0 ? Math.max(GAIN_DB_MIN, 20 * Math.log10(volume)) : GAIN_DB_MIN;

/** The bottom of the range is silence, not -60 dB. */
export const dbToVolume = (db: number): number =>
  db <= GAIN_DB_MIN ? 0 : clampVolume(Math.pow(10, db / 20));

export interface MovePointBounds {
  /** Latest time a point may sit at (normally the clip duration). */
  readonly maxTime?: number;
  /** Snap the value to 0 dB (linear 1) when it lands within this many dB of it. */
  readonly snapUnityDb?: number;
}

const copy = (points: readonly AutomationPoint[]): AutomationPoint[] =>
  points.map((point) => ({ time: point.time, value: point.value }));

/** Time-ordered, unique-in-time, clamped. The last point wins at a coincident time. */
export const normalizePoints = (
  points: readonly AutomationPoint[] | undefined,
): AutomationPoint[] => sanitizeVolumeAutomationPoints(points);

/** Add a point at `t` with value `v`. A point already at `t` is replaced. */
export function insertPoint(
  points: readonly AutomationPoint[],
  t: number,
  v: number,
): AutomationPoint[] {
  if (!Number.isFinite(t) || !Number.isFinite(v)) return normalizePoints(points);
  const time = Math.max(0, t);
  const kept = normalizePoints(points).filter((point) => point.time !== time);
  kept.push({ time, value: clampVolume(v) });
  return kept.sort((a, b) => a.time - b.time);
}

/**
 * Move point `index` by (`dt`, `dv`). The time stays strictly between its
 * neighbours (and within 0..maxTime), the value inside the volume range, and
 * the value optionally snaps to 0 dB. An index that is not a point is a no-op.
 */
export function movePoint(
  points: readonly AutomationPoint[],
  index: number,
  dt: number,
  dv: number,
  bounds: MovePointBounds = {},
): AutomationPoint[] {
  const list = normalizePoints(points);
  const point = list[index];
  if (!point || !Number.isFinite(dt) || !Number.isFinite(dv)) return list;
  const previous = list[index - 1];
  const next = list[index + 1];
  const lower = previous ? previous.time + MIN_POINT_GAP : 0;
  const upper = Math.min(
    next ? next.time - MIN_POINT_GAP : Infinity,
    bounds.maxTime ?? Infinity,
  );
  const time = Math.max(lower, Math.min(Math.max(lower, upper), point.time + dt));
  let value = clampVolume(point.value + dv);
  if (
    bounds.snapUnityDb !== undefined &&
    bounds.snapUnityDb > 0 &&
    Math.abs(volumeToDb(value)) <= bounds.snapUnityDb
  ) {
    value = 1;
  }
  list[index] = { time, value };
  return list;
}

/**
 * Remove point `index`. Removing the last point leaves an empty lane, which
 * means "no automation": the clip plays flat at its own volume.
 */
export function deletePoint(
  points: readonly AutomationPoint[],
  index: number,
): AutomationPoint[] {
  const list = normalizePoints(points);
  if (index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return list;
}

/**
 * Raise or lower the points inside [t0, t1] by `deltaDb`. Points outside the
 * range are untouched. The range is inclusive so dragging a segment moves
 * both of its end points.
 */
export function scaleRange(
  points: readonly AutomationPoint[],
  t0: number,
  t1: number,
  deltaDb: number,
): AutomationPoint[] {
  const list = normalizePoints(points);
  if (!Number.isFinite(deltaDb)) return list;
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const factor = Math.pow(10, deltaDb / 20);
  return list.map((point) => {
    if (point.time < lo || point.time > hi) return point;
    // Silence has no dB: lift it off zero by working in dB from the floor.
    const base = point.value > 0 ? point.value : dbToVolume(GAIN_DB_MIN + 0.01);
    const value = point.value === 0 && deltaDb <= 0 ? 0 : clampVolume(base * factor);
    return { time: point.time, value };
  });
}

/**
 * Ramer-Douglas-Peucker on the value axis: drop points whose vertical distance
 * to the line through their kept neighbours is below `epsilon`. Both endpoints
 * are always kept, and every original point lies within `epsilon` of the result.
 */
export function simplify(
  points: readonly AutomationPoint[],
  epsilon: number,
): AutomationPoint[] {
  const list = normalizePoints(points);
  if (list.length <= 2 || !(epsilon > 0)) return list;
  const keep = new Array<boolean>(list.length).fill(false);
  keep[0] = true;
  keep[list.length - 1] = true;
  const stack: Array<[number, number]> = [[0, list.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop() as [number, number];
    const a = list[from];
    const b = list[to];
    let worst = -1;
    let worstDistance = 0;
    for (let i = from + 1; i < to; i += 1) {
      const progress = (list[i].time - a.time) / (b.time - a.time);
      const distance = Math.abs(list[i].value - (a.value + (b.value - a.value) * progress));
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst >= 0 && worstDistance >= epsilon) {
      keep[worst] = true;
      stack.push([from, worst], [worst, to]);
    }
  }
  return copy(list.filter((_, i) => keep[i]));
}
