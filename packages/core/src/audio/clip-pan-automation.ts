import type { AutomationPoint } from "../types/timeline";

const clampPan = (value: number): number => Math.max(-1, Math.min(1, value));

export const sanitizePanAutomationPoints = (
  points: readonly AutomationPoint[] | undefined,
): AutomationPoint[] => {
  const sorted = (points ?? [])
    .filter((p) => Number.isFinite(p.time) && p.time >= 0 && Number.isFinite(p.value))
    .map((p) => ({ time: p.time, value: clampPan(p.value) }))
    .sort((a, b) => a.time - b.time);
  return sorted.filter((p, i) => sorted[i + 1]?.time !== p.time);
};

/** Pan (-1 left .. 1 right) at a clip-relative time; `basePan` holds before the first point. */
export const getPanAutomationValueAtTime = (
  points: readonly AutomationPoint[],
  time: number,
  basePan: number,
): number => {
  let previous: AutomationPoint = { time: 0, value: clampPan(basePan) };
  for (const point of points) {
    if (point.time === time) return point.value;
    if (point.time > time) {
      const span = point.time - previous.time;
      if (span <= 0) return point.value;
      return previous.value + ((point.value - previous.value) * (time - previous.time)) / span;
    }
    previous = point;
  }
  return previous.value;
};

/** Points re-based to the rendered window (time 0 = window start), including edge values. */
export const getPanAutomationPointsForRange = (
  points: readonly AutomationPoint[] | undefined,
  clipOffset: number,
  rangeDuration: number,
  basePan: number,
): AutomationPoint[] => {
  const sanitized = sanitizePanAutomationPoints(points);
  if (rangeDuration <= 0 || sanitized.length === 0) return [];
  const start = Math.max(0, clipOffset);
  const end = start + rangeDuration;
  const result: AutomationPoint[] = [
    { time: 0, value: getPanAutomationValueAtTime(sanitized, start, basePan) },
  ];
  for (const p of sanitized) {
    if (p.time > start && p.time < end) result.push({ time: p.time - start, value: p.value });
  }
  result.push({ time: rangeDuration, value: getPanAutomationValueAtTime(sanitized, end, basePan) });
  return result;
};

/** Returns false (and schedules nothing) when there is no automation to apply. */
export const schedulePanAutomationOnParam = (
  param: Pick<AudioParam, "setValueAtTime" | "linearRampToValueAtTime" | "cancelScheduledValues">,
  points: readonly AutomationPoint[] | undefined,
  basePan: number,
  clipOffset: number,
  rangeDuration: number,
  startTime: number,
): boolean => {
  const range = getPanAutomationPointsForRange(points, clipOffset, rangeDuration, basePan);
  if (range.length === 0) return false;
  param.cancelScheduledValues(startTime);
  param.setValueAtTime(range[0].value, startTime);
  for (let i = 1; i < range.length; i++) {
    param.linearRampToValueAtTime(range[i].value, startTime + range[i].time);
  }
  return true;
};
