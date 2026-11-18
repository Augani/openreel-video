/**
 * Frame / timecode helpers shared by the broadcast caption formats (SCC, EBU-STL).
 *
 * `fps` is the real frame rate (29.97 = 30000/1001). `nominal` is the timecode
 * base (24, 25, 30). Drop-frame (only meaningful at 29.97) skips labels 00 and
 * 01 of every minute except each tenth minute, so the label tracks wall time.
 */

export const NTSC_FPS = 30000 / 1001;

export interface CaptionFrameRate {
  /** Real frames per second. */
  readonly fps: number;
  /** Timecode base: frames per second label. */
  readonly nominal: number;
  readonly dropFrame: boolean;
}

/** Resolve a frame rate (e.g. 29.97, 25, 30) into timecode parameters. */
export function resolveCaptionFrameRate(fps: number | undefined, dropFrame?: boolean): CaptionFrameRate {
  let rate = fps && Number.isFinite(fps) && fps > 0 ? fps : NTSC_FPS;
  // Broadcast caption timecode tops out at 30 frames: a 50 / 59.94 / 60 fps timeline uses half rate.
  while (rate > 30.5) rate /= 2;
  const ntsc = Math.abs(rate - NTSC_FPS) < 0.01;
  return {
    fps: ntsc ? NTSC_FPS : rate,
    nominal: Math.round(rate),
    dropFrame: ntsc ? (dropFrame ?? true) : false,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** Frame count -> "HH:MM:SS:FF" ("HH:MM:SS;FF" when drop-frame). */
export function framesToTimecode(frames: number, rate: CaptionFrameRate): string {
  let f = Math.max(0, Math.round(frames));
  const base = rate.nominal;
  if (rate.dropFrame) {
    const per10 = base * 600 - 18;
    const perMin = base * 60 - 2;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += 18 * tens + (rem < 2 ? 0 : 2 * Math.floor((rem - 2) / perMin));
  }
  const ff = f % base;
  const ss = Math.floor(f / base) % 60;
  const mm = Math.floor(f / (base * 60)) % 60;
  const hh = Math.floor(f / (base * 3600));
  return `${two(hh)}:${two(mm)}:${two(ss)}${rate.dropFrame ? ";" : ":"}${two(ff)}`;
}

const TC = /^(\d{1,2}):(\d{2}):(\d{2})([:;.,])(\d{2})$/;

/** "HH:MM:SS:FF" / "HH:MM:SS;FF" -> frame count, or null when malformed. */
export function timecodeToFrames(timecode: string, rate: CaptionFrameRate): number | null {
  const m = TC.exec(timecode.trim());
  if (!m) return null;
  const [hh, mm, ss, ff] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[5])];
  if (mm > 59 || ss > 59 || ff >= rate.nominal) return null;
  const base = rate.nominal;
  let frames = ((hh * 60 + mm) * 60 + ss) * base + ff;
  if (rate.dropFrame) {
    const totalMinutes = hh * 60 + mm;
    frames -= 2 * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

export const secondsToFrames = (seconds: number, rate: CaptionFrameRate): number =>
  Math.round(seconds * rate.fps);

export const framesToSeconds = (frames: number, rate: CaptionFrameRate): number => frames / rate.fps;
