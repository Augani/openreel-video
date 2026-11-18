import type { ClipFade } from "../types/timeline";

interface ClipFadePoint {
  readonly time: number;
  readonly value: number;
}

interface FadeEnvelopeOptions {
  clipOffset: number;
  rangeDuration: number;
  clipDuration: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeOrigin?: ClipFade["origin"];
  transitionFadeIn?: number;
  transitionFadeOut?: number;
}

const positive = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

/** Exact piecewise-linear minimum of the user and transition fade ramps.
 * Original-clock fades survive internal cuts; transitions stay on the current
 * piece's edges. Ramp intersections matter when fade-in and fade-out overlap. */
export function getClipFadeEnvelopePoints(
  options: FadeEnvelopeOptions,
): ClipFadePoint[] {
  const { clipOffset, rangeDuration, clipDuration, fadeOrigin } = options;
  if (
    !Number.isFinite(clipOffset) ||
    !Number.isFinite(rangeDuration) ||
    !Number.isFinite(clipDuration) ||
    rangeDuration <= 0 ||
    clipDuration <= 0
  )
    return [];
  const rangeStart = Math.max(0, clipOffset);
  const rangeEnd = Math.min(clipDuration, rangeStart + rangeDuration);
  if (rangeEnd <= rangeStart) return [];
  const fadeIn = positive(options.fadeIn),
    fadeOut = positive(options.fadeOut);
  const transitionIn = positive(options.transitionFadeIn),
    transitionOut = positive(options.transitionFadeOut);
  if (!fadeIn && !fadeOut && !transitionIn && !transitionOut) return [];
  const origin: NonNullable<ClipFade["origin"]> =
    fadeOrigin &&
    Number.isFinite(fadeOrigin.offset) &&
    Number.isFinite(fadeOrigin.duration) &&
    fadeOrigin.duration > 0
      ? fadeOrigin
      : { offset: 0, duration: clipDuration };
  const ramps: Array<{
    length: number;
    offset: number;
    duration: number;
    out: boolean;
  }> = [];
  const outOrigin = origin.out && Number.isFinite(origin.out.offset) &&
    Number.isFinite(origin.out.duration) && origin.out.duration > 0 ? origin.out : origin;
  const add = (
    length: number,
    offset: number,
    duration: number,
    out: boolean,
  ) => {
    if (length) ramps.push({ length, offset, duration, out });
  };
  add(
    fadeIn,
    origin.fadeIn === false ? 0 : origin.offset,
    origin.duration,
    false,
  );
  add(
    fadeOut,
    origin.fadeOut === false ? 0 : outOrigin.offset,
    origin.fadeOut === false ? clipDuration : outOrigin.duration,
    true,
  );
  add(transitionIn, 0, clipDuration, false);
  add(transitionOut, 0, clipDuration, true);
  const value = (ramp: (typeof ramps)[number], time: number) => {
    const clock = time + ramp.offset;
    return Math.min(
      1,
      Math.max(0, (ramp.out ? ramp.duration - clock : clock) / ramp.length),
    );
  };
  const boundaries = new Set([rangeStart, rangeEnd]);
  const include = (time: number) => {
    if (time > rangeStart && time < rangeEnd) boundaries.add(time);
  };
  for (const ramp of ramps) {
    const zero = ramp.out ? ramp.duration - ramp.offset : -ramp.offset;
    let full = ramp.out
      ? ramp.duration - ramp.length - ramp.offset
      : ramp.length - ramp.offset;
    // An extremely short fade can be smaller than one representable step at
    // its clip edge. Keep its corner next to that edge, never across the clip.
    if (full === zero && Number.isFinite(zero)) {
      const step = Math.max(Number.MIN_VALUE, Math.abs(zero) * Number.EPSILON);
      full += ramp.out ? -step : step;
    }
    include(zero);
    include(full);
  }
  const corners = [...boundaries].sort((a, b) => a - b);
  // Between clamp boundaries every ramp is linear. Include every pair's
  // crossing so linearRampToValueAtTime cannot cut underneath a fade's peak.
  for (let i = 1; i < corners.length; i++) {
    const start = corners[i - 1],
      end = corners[i];
    for (let a = 0; a < ramps.length; a++)
      for (let b = a + 1; b < ramps.length; b++) {
        const first = value(ramps[a], start) - value(ramps[b], start);
        const last = value(ramps[a], end) - value(ramps[b], end);
        if ((first < 0 && last > 0) || (first > 0 && last < 0))
          include(start + (end - start) * (first / (first - last)));
      }
  }
  return [...boundaries]
    .sort((a, b) => a - b)
    .map((time) => ({
      time: time - rangeStart,
      value: Math.min(...ramps.map((ramp) => value(ramp, time))),
    }));
}

export function scheduleClipFadeEnvelope(
  gain: AudioParam,
  options: FadeEnvelopeOptions & { startTime: number },
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
