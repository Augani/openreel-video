import type { AutomationPoint } from "../types/timeline";
import { clampVolume } from "./volume-automation";

export const sanitizeVolumeAutomationPoints = (
  points: readonly AutomationPoint[] | undefined,
): AutomationPoint[] => {
  const sorted = (points ?? [])
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        point.time >= 0 &&
        Number.isFinite(point.value),
    )
    .map((point) => ({
      time: point.time,
      value: clampVolume(point.value),
    }))
    .sort((left, right) => left.time - right.time);
  // WebAudio schedules the last value at coincident times. Seeking and
  // fragment boundaries must resolve that same value rather than the first.
  return sorted.filter((point, index) => sorted[index + 1]?.time !== point.time);
};

const getAutomationValueAtTime = (
  points: readonly AutomationPoint[],
  time: number,
  baseVolume: number,
): number => {
  if (points.length === 0) {
    return baseVolume;
  }

  let previous: AutomationPoint = { time: 0, value: baseVolume };

  for (const point of points) {
    if (point.time === time) {
      return point.value;
    }

    if (point.time > time) {
      const span = point.time - previous.time;
      if (span <= 0) {
        return point.value;
      }

      const progress = (time - previous.time) / span;
      return clampVolume(
        previous.value + (point.value - previous.value) * progress,
      );
    }

    previous = point;
  }

  return previous.value;
};

export const getVolumeAutomationPointsForRange = (
  points: readonly AutomationPoint[] | undefined,
  clipOffset: number,
  clipDuration: number,
  baseVolume: number,
): AutomationPoint[] => {
  const sanitizedPoints = sanitizeVolumeAutomationPoints(points);
  const clampedBaseVolume = clampVolume(baseVolume);

  if (clipDuration <= 0 || sanitizedPoints.length === 0) {
    return [];
  }

  const rangeStart = Math.max(0, clipOffset);
  const rangeEnd = rangeStart + clipDuration;
  const result: AutomationPoint[] = [
    {
      time: 0,
      value: getAutomationValueAtTime(
        sanitizedPoints,
        rangeStart,
        clampedBaseVolume,
      ),
    },
  ];

  for (const point of sanitizedPoints) {
    if (point.time <= rangeStart || point.time >= rangeEnd) {
      continue;
    }

    result.push({
      time: point.time - rangeStart,
      value: point.value,
    });
  }

  result.push({
    time: clipDuration,
    value: getAutomationValueAtTime(
      sanitizedPoints,
      rangeEnd,
      clampedBaseVolume,
    ),
  });

  const deduped: AutomationPoint[] = [];

  for (const point of result) {
    const lastPoint = deduped[deduped.length - 1];
    if (lastPoint && lastPoint.time === point.time) {
      deduped[deduped.length - 1] = point;
      continue;
    }

    deduped.push(point);
  }

  return deduped;
};

export const scheduleVolumeAutomationOnGain = (
  gainNode: GainNode,
  points: readonly AutomationPoint[] | undefined,
  baseVolume: number,
  clipOffset: number,
  clipDuration: number,
  startTime: number,
): void => {
  const clampedBaseVolume = clampVolume(baseVolume);
  const rangePoints = getVolumeAutomationPointsForRange(
    points,
    clipOffset,
    clipDuration,
    clampedBaseVolume,
  );

  gainNode.gain.cancelScheduledValues(startTime);

  if (rangePoints.length === 0) {
    gainNode.gain.setValueAtTime(clampedBaseVolume, startTime);
    return;
  }

  gainNode.gain.setValueAtTime(rangePoints[0].value, startTime);

  for (let index = 1; index < rangePoints.length; index += 1) {
    const point = rangePoints[index];
    gainNode.gain.linearRampToValueAtTime(point.value, startTime + point.time);
  }

  const lastPoint = rangePoints[rangePoints.length - 1];
  if (lastPoint.time < clipDuration) {
    gainNode.gain.setValueAtTime(lastPoint.value, startTime + lastPoint.time);
  }
};
