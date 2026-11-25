import type { AudioRackEffect, AudioRackEffectType, AutomationPoint } from "../types/timeline";
import { CREATIVE_FX_DEFINITIONS, CREATIVE_FX_TYPES, isDiscreteCreativeParam } from "./creative/creative-fx-definitions";

/**
 * Keyframes on audio rack effect parameters (gain, EQ, compressor). Points are in timeline seconds and in the
 * param's own unit (dB for gains), linear between points. The same scheduling function drives the live graph and
 * the offline export render, so preview and export hear the same curve.
 */

/** Params that can carry keyframes, per effect type. Keys match the AUDIO_RACK_EFFECT_DEFINITIONS params. */
export const AUTOMATABLE_RACK_PARAMS: Partial<Record<AudioRackEffectType, readonly string[]>> = {
  gain: ["gainDb"],
  eq: ["lowGain", "midGain", "midFreq", "midQ", "highGain"],
  compressor: ["threshold", "ratio", "attack", "release", "knee", "makeupGain"],
  // Creative effects: every continuous param (switches and mode selectors are not automatable).
  ...Object.fromEntries(
    CREATIVE_FX_TYPES.map((type) => [type, CREATIVE_FX_DEFINITIONS[type].params.filter((spec) => !isDiscreteCreativeParam(spec)).map((spec) => spec.key)]),
  ),
};

export const isAutomatableRackParam = (type: AudioRackEffectType, key: string): boolean =>
  !!AUTOMATABLE_RACK_PARAMS[type]?.includes(key);

export type RackAutomation = Record<string, AutomationPoint[]>;

/** Time-ordered, unique-in-time, finite, clamped into [min, max]. The last point at a time wins. */
export function sanitizeParamPoints(
  points: readonly AutomationPoint[] | undefined,
  min: number,
  max: number,
): AutomationPoint[] {
  if (!points) return [];
  const byTime = new Map<number, number>();
  for (const point of points) {
    if (!point || !Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    byTime.set(Math.max(0, point.time), Math.min(max, Math.max(min, point.value)));
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
}

/** Well-formed automation for an effect (only automatable keys with points), or undefined when none. */
export function sanitizeRackEffectAutomation(
  type: AudioRackEffectType,
  raw: unknown,
  ranges: (key: string) => { min: number; max: number } | undefined,
): RackAutomation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: RackAutomation = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isAutomatableRackParam(type, key) || !Array.isArray(value)) continue;
    const range = ranges(key);
    if (!range) continue;
    const points = sanitizeParamPoints(value as AutomationPoint[], range.min, range.max);
    if (points.length) out[key] = points;
  }
  return Object.keys(out).length ? out : undefined;
}

export const hasRackEffectAutomation = (effect: Pick<AudioRackEffect, "automation">): boolean =>
  !!effect.automation && Object.values(effect.automation).some((points) => points.length > 0);

/** Lane value at `time`: linear between points, the first/last value held outside them, `rest` for an empty lane. */
export function laneValueAt(points: readonly AutomationPoint[], time: number, rest: number): number {
  if (points.length === 0) return rest;
  if (time <= points[0].time) return points[0].value;
  const last = points[points.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i];
    if (time <= b.time) {
      const a = points[i - 1];
      const span = b.time - a.time;
      return span > 0 ? a.value + ((b.value - a.value) * (time - a.time)) / span : b.value;
    }
  }
  return last.value;
}

/** Largest native-unit step between two ramp events; keeps a dB->linear conversion close to linear-in-dB. */
const MAX_STEP_NATIVE = 0.5;
const MAX_SUBSTEPS = 64;
const STEP_GAP = 0.001;

/** Events of the schedule (window-relative seconds). Pure, so it is unit-tested and shared by live and offline. */
export interface ParamScheduleEvent {
  readonly time: number;
  readonly value: number;
}

/**
 * The ramp schedule of one lane over a window of the timeline: an anchor at 0 with the lane value there (the
 * `base` value before the first point), then a linear ramp event per point inside the window, subdivided
 * where the value moves more than 0.5 native units so a dB->linear conversion stays smooth.
 */
export function buildParamSchedule(
  points: readonly AutomationPoint[],
  base: number,
  timelineStart: number,
  duration: number,
): ParamScheduleEvent[] {
  const startValue = points.length && timelineStart >= points[0].time ? laneValueAt(points, timelineStart, base) : base;
  const events: ParamScheduleEvent[] = [{ time: 0, value: startValue }];
  const end = timelineStart + duration;
  let prevTime = timelineStart;
  let prevValue = startValue;
  const push = (time: number, value: number) => {
    const delta = Math.abs(value - prevValue);
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(delta / MAX_STEP_NATIVE)));
    for (let s = 1; s <= steps; s += 1) {
      const t = prevTime + ((time - prevTime) * s) / steps;
      events.push({ time: t - timelineStart, value: prevValue + ((value - prevValue) * s) / steps });
    }
    prevTime = time;
    prevValue = value;
  };
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point.time <= timelineStart) continue;
    if (point.time >= end) {
      push(end, laneValueAt(points, end, base));
      return events;
    }
    if (i === 0) {
      // Before the first point the lane holds `base`; it steps to the first point over 1 ms.
      push(Math.max(timelineStart, point.time - STEP_GAP), base);
    }
    push(point.time, point.value);
  }
  return events;
}

/** Schedules a lane onto an AudioParam starting at context time `ctxStart` (cancels earlier schedule from there). */
export function scheduleParamAutomation(
  param: AudioParam,
  points: readonly AutomationPoint[],
  base: number,
  toParam: (native: number) => number,
  timelineStart: number,
  duration: number,
  ctxStart: number,
): void {
  param.cancelScheduledValues(ctxStart);
  const events = buildParamSchedule(points, base, timelineStart, duration);
  param.setValueAtTime(toParam(events[0].value), ctxStart);
  for (let i = 1; i < events.length; i += 1) {
    param.linearRampToValueAtTime(toParam(events[i].value), ctxStart + events[i].time);
  }
}
