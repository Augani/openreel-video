export interface ClipFadePoint {
  readonly time: number;
  readonly value: number;
}

function fadeValueAtTime(time: number, clipDuration: number, fadeIn: number, fadeOut: number): number {
  const inValue = fadeIn > 0 ? Math.min(1, Math.max(0, time / fadeIn)) : 1;
  const outValue = fadeOut > 0 ? Math.min(1, Math.max(0, (clipDuration - time) / fadeOut)) : 1;
  return Math.min(inValue, outValue);
}

export function getClipFadeEnvelopePoints({ clipOffset, rangeDuration, clipDuration, fadeIn = 0, fadeOut = 0 }: {
  clipOffset: number;
  rangeDuration: number;
  clipDuration: number;
  fadeIn?: number;
  fadeOut?: number;
}): ClipFadePoint[] {
  if (rangeDuration <= 0 || (fadeIn <= 0 && fadeOut <= 0)) return [];
  const rangeStart = Math.max(0, clipOffset);
  const rangeEnd = Math.min(clipDuration, rangeStart + rangeDuration);
  const boundaries = [rangeStart, rangeEnd];
  if (fadeIn > rangeStart && fadeIn < rangeEnd) boundaries.push(fadeIn);
  const fadeOutStart = clipDuration - fadeOut;
  if (fadeOutStart > rangeStart && fadeOutStart < rangeEnd) boundaries.push(fadeOutStart);
  return Array.from(new Set(boundaries))
    .sort((left, right) => left - right)
    .map((time) => ({
      time: time - rangeStart,
      value: fadeValueAtTime(time, clipDuration, fadeIn, fadeOut),
    }));
}

export function scheduleClipFadeEnvelope(
  gain: AudioParam,
  options: Parameters<typeof getClipFadeEnvelopePoints>[0] & { startTime: number },
): void {
  const points = getClipFadeEnvelopePoints(options);
  gain.cancelScheduledValues(options.startTime);
  if (points.length === 0) {
    gain.setValueAtTime(1, options.startTime);
    return;
  }
  gain.setValueAtTime(points[0].value, options.startTime);
  for (const point of points.slice(1)) {
    gain.linearRampToValueAtTime(point.value, options.startTime + point.time);
  }
}
