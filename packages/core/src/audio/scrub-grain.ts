/**
 * Audible scrubbing: while the playhead is dragged, a short grain of every audible
 * clip at the playhead is played through the normal track path (so mute, solo,
 * fader and track automation apply). This file is the pure part: which clips
 * sound, from where in their source, and how often grains may fire.
 */

export interface ScrubClipLike {
  readonly clipId: string;
  readonly trackId: string;
  readonly audioBuffer: { readonly duration: number };
  readonly startTime: number;
  readonly endTime: number;
  readonly mediaOffset: number;
  readonly speed: number;
}

export interface ScrubGrain<T extends ScrubClipLike> {
  readonly schedule: T;
  /** Source position (seconds into the buffer) where the grain starts. */
  readonly sourceOffset: number;
  /** Source seconds the grain covers. */
  readonly sourceDuration: number;
  /** Wall-clock length of the grain at the clip's speed. */
  readonly duration: number;
}

export const SCRUB_GRAIN_SECONDS = 0.09;
/** Shortest time between two grains. */
export const SCRUB_MIN_INTERVAL_SECONDS = 0.045;
/** Grains audible at once; more would only add up to noise. */
export const SCRUB_MAX_GRAINS = 8;

/** The clips sounding at `time` and the source slice each contributes. */
export function planScrubGrains<T extends ScrubClipLike>(
  schedules: readonly T[],
  time: number,
  grainSeconds: number = SCRUB_GRAIN_SECONDS,
): ScrubGrain<T>[] {
  if (!Number.isFinite(time) || !(grainSeconds > 0)) return [];
  const grains: ScrubGrain<T>[] = [];
  for (const schedule of schedules) {
    if (time < schedule.startTime || time >= schedule.endTime) continue;
    const speed = Number.isFinite(schedule.speed) && schedule.speed > 0 ? schedule.speed : 1;
    const sourceOffset = schedule.mediaOffset + (time - schedule.startTime) * speed;
    const available = schedule.audioBuffer.duration - sourceOffset;
    if (!(available > 0.001)) continue;
    // Never run past the end of the clip on the timeline or the end of the media.
    const sourceDuration = Math.min(grainSeconds * speed, available, (schedule.endTime - time) * speed);
    if (!(sourceDuration > 0.001)) continue;
    grains.push({ schedule, sourceOffset, sourceDuration, duration: sourceDuration / speed });
  }
  return grains;
}

/** Rate limit: true when a grain may fire at `now` (seconds, any monotonic clock), and records it. */
export class ScrubGrainThrottle {
  private last = Number.NEGATIVE_INFINITY;
  private lastTime: number | null = null;

  constructor(private readonly minInterval: number = SCRUB_MIN_INTERVAL_SECONDS) {}

  /** A grain fires when enough time passed and the playhead actually moved. */
  take(now: number, timelineTime: number): boolean {
    if (now - this.last < this.minInterval) return false;
    if (this.lastTime !== null && Math.abs(timelineTime - this.lastTime) < 1e-4) return false;
    this.last = now;
    this.lastTime = timelineTime;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
    this.lastTime = null;
  }
}
