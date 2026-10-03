export interface PlaybackLoopRange {
  start: number;
  end: number;
}

export function resolvePlaybackLoop(
  settings: { loopEnabled: boolean; loopStart: number; loopEnd: number },
  duration: number,
): PlaybackLoopRange | null {
  if (!settings.loopEnabled || !Number.isFinite(duration) || duration <= 0) return null;
  const start = Number.isFinite(settings.loopStart) ? Math.max(0, Math.min(duration, settings.loopStart)) : 0;
  const end = Number.isFinite(settings.loopEnd) ? Math.max(0, Math.min(duration, settings.loopEnd)) : duration;
  // An unset range or a range invalidated by trimming means the full project.
  return end > start ? { start, end } : { start: 0, end: duration };
}

export function resolvePlaybackStart(
  position: number,
  duration: number,
  loop: PlaybackLoopRange | null,
): number {
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  if (loop && (safePosition < loop.start || safePosition >= loop.end)) return loop.start;
  return safePosition >= duration ? 0 : safePosition;
}
