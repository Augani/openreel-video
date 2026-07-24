export interface AdvanceMotionPlayheadOptions {
  readonly currentTime: number;
  readonly deltaSeconds: number;
  readonly duration: number;
  readonly playbackRate: number;
  readonly loop: boolean;
  readonly frameStepSeconds?: number | null;
  readonly workAreaStart?: number | null;
  readonly workAreaEnd?: number | null;
}

export interface AdvanceMotionPlayheadResult {
  readonly time: number;
  readonly isPlaying: boolean;
}

export function advanceMotionPlayhead({
  currentTime,
  deltaSeconds,
  duration,
  playbackRate,
  loop,
  frameStepSeconds,
  workAreaStart,
  workAreaEnd,
}: AdvanceMotionPlayheadOptions): AdvanceMotionPlayheadResult {
  const safeDuration = Math.max(0, finiteOr(duration, 0));
  const start = clamp(finiteOr(workAreaStart ?? 0, 0), 0, safeDuration);
  const end = clamp(
    finiteOr(workAreaEnd ?? safeDuration, safeDuration),
    start,
    safeDuration,
  );
  const span = end - start;

  if (safeDuration <= 0 || span <= 0) {
    return { time: start, isPlaying: false };
  }

  const rate = clamp(finiteOr(playbackRate, 1), 0.05, 8);
  const delta = Math.max(0, finiteOr(deltaSeconds, 0)) * rate;
  const normalizedCurrent =
    currentTime < start || currentTime >= end ? start : currentTime;
  const next = applyFrameStep(normalizedCurrent + delta, start, frameStepSeconds);

  if (next < end) {
    return { time: next, isPlaying: true };
  }

  if (loop) {
    return {
      time: start + ((next - start) % span),
      isPlaying: true,
    };
  }

  return { time: end, isPlaying: false };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyFrameStep(
  time: number,
  start: number,
  frameStepSeconds: number | null | undefined,
): number {
  if (!frameStepSeconds || !Number.isFinite(frameStepSeconds) || frameStepSeconds <= 0) {
    return time;
  }
  const elapsed = Math.max(0, time - start);
  return start + Math.floor(elapsed / frameStepSeconds) * frameStepSeconds;
}
