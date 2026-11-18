/**
 * Frame-accurate SMPTE timecode for timeline interchange. Frames are integer
 * counts of the sequence rate; seconds are only used at the OpenReel boundary.
 * Supports 23.976, 24, 25, 29.97 (NDF + DF), 30, 50, 59.94 (NDF + DF) and 60,
 * plus any other integer rate as non-drop.
 */

export interface FrameRate {
  /** Nominal frames per second used for timecode counting (24, 25, 30, 60...). */
  readonly timebase: number;
  /** True for the 1000/1001 "NTSC" family (23.976, 29.97, 59.94). */
  readonly ntsc: boolean;
  /** Drop-frame counting; only meaningful for 29.97 / 59.94. */
  readonly dropFrame: boolean;
  /** Exact rate as the rational num/den. */
  readonly num: number;
  readonly den: number;
}

export const STANDARD_RATES: readonly { fps: number; timebase: number; ntsc: boolean }[] = [
  { fps: 24000 / 1001, timebase: 24, ntsc: true },
  { fps: 24, timebase: 24, ntsc: false },
  { fps: 25, timebase: 25, ntsc: false },
  { fps: 30000 / 1001, timebase: 30, ntsc: true },
  { fps: 30, timebase: 30, ntsc: false },
  { fps: 50, timebase: 50, ntsc: false },
  { fps: 60000 / 1001, timebase: 60, ntsc: true },
  { fps: 60, timebase: 60, ntsc: false },
];

export function makeFrameRate(timebase: number, ntsc: boolean, dropFrame = false): FrameRate {
  if (!Number.isFinite(timebase) || timebase <= 0) throw new Error(`Invalid timebase ${timebase}`);
  const drop = dropFrame && ntsc && (timebase === 30 || timebase === 60);
  return {
    timebase,
    ntsc,
    dropFrame: drop,
    num: ntsc ? timebase * 1000 : timebase,
    den: ntsc ? 1001 : 1,
  };
}

/** Map a numeric frame rate (e.g. 29.97, 23.976, 30) to an exact FrameRate. */
export function resolveFrameRate(fps: number, options: { dropFrame?: boolean } = {}): FrameRate {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`Invalid frame rate ${fps}`);
  let best: (typeof STANDARD_RATES)[number] | null = null;
  let bestError = Infinity;
  for (const candidate of STANDARD_RATES) {
    const error = Math.abs(candidate.fps - fps);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  if (best && bestError < 0.012) return makeFrameRate(best.timebase, best.ntsc, options.dropFrame);
  return makeFrameRate(Math.max(1, Math.round(fps)), false);
}

export const fpsOf = (rate: FrameRate): number => rate.num / rate.den;

export const secondsToFrames = (seconds: number, rate: FrameRate): number =>
  Math.round((seconds * rate.num) / rate.den + 1e-9);

export const framesToSeconds = (frames: number, rate: FrameRate): number =>
  (frames * rate.den) / rate.num;

function dropCount(rate: FrameRate): number {
  return Math.round(rate.timebase / 15); // 2 @ 30, 4 @ 60
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

export interface TimecodeParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly frames: number;
}

export function framesToTimecodeParts(totalFrames: number, rate: FrameRate): TimecodeParts {
  if (!Number.isInteger(totalFrames) || totalFrames < 0)
    throw new Error(`Frame count must be a non-negative integer, got ${totalFrames}`);
  let frames = totalFrames;
  if (rate.dropFrame) {
    const drop = dropCount(rate);
    const perMinute = rate.timebase * 60 - drop;
    const perTenMinutes = rate.timebase * 600 - drop * 9;
    const tenMinuteBlocks = Math.floor(frames / perTenMinutes);
    const remainder = frames % perTenMinutes;
    frames += drop * 9 * tenMinuteBlocks;
    if (remainder > drop) frames += drop * Math.floor((remainder - drop) / perMinute);
  }
  const tb = rate.timebase;
  return {
    frames: frames % tb,
    seconds: Math.floor(frames / tb) % 60,
    minutes: Math.floor(frames / (tb * 60)) % 60,
    hours: Math.floor(frames / (tb * 3600)),
  };
}

export function framesToTimecode(totalFrames: number, rate: FrameRate): string {
  const p = framesToTimecodeParts(totalFrames, rate);
  const width = rate.timebase >= 100 ? 3 : 2;
  const sep = rate.dropFrame ? ";" : ":";
  return `${pad(p.hours)}:${pad(p.minutes)}:${pad(p.seconds)}${sep}${pad(p.frames, width)}`;
}

/** Parse HH:MM:SS:FF (also `;` or `.` before frames). Returns absolute frames. */
export function timecodeToFrames(timecode: string, rate: FrameRate): number {
  const match = /^(\d+):(\d{1,2}):(\d{1,2})[:;.](\d+)$/.exec(timecode.trim());
  if (!match) throw new Error(`Invalid timecode "${timecode}"`);
  const [h, m, s, f] = match.slice(1).map(Number);
  if (f >= rate.timebase) throw new Error(`Frame field ${f} exceeds timebase ${rate.timebase}`);
  const tb = rate.timebase;
  let frames = ((h * 60 + m) * 60 + s) * tb + f;
  if (rate.dropFrame) {
    const drop = dropCount(rate);
    if (s === 0 && m % 10 !== 0 && f < drop)
      throw new Error(`Timecode "${timecode}" is a dropped frame number`);
    const totalMinutes = h * 60 + m;
    frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

/** Timecode string for a time in seconds, snapped to the nearest frame. */
export const secondsToTimecode = (seconds: number, rate: FrameRate): string =>
  framesToTimecode(Math.max(0, secondsToFrames(seconds, rate)), rate);
