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

/** Labels skipped per minute (except every tenth) by drop-frame: 2 at 29.97, 4 at 59.94. */
export const dropLabelsPerMinute = (rate: CaptionFrameRate): number => (rate.nominal >= 60 ? 4 : 2);

const two = (n: number) => String(n).padStart(2, "0");

/** Frame count -> "HH:MM:SS:FF" ("HH:MM:SS;FF" when drop-frame). */
export function framesToTimecode(frames: number, rate: CaptionFrameRate): string {
  let f = Math.max(0, Math.round(frames));
  const base = rate.nominal;
  if (rate.dropFrame) {
    const drop = dropLabelsPerMinute(rate);
    const per10 = base * 600 - 9 * drop;
    const perMin = base * 60 - drop;
    const tens = Math.floor(f / per10);
    const rem = f % per10;
    f += 9 * drop * tens + (rem < drop ? 0 : drop * Math.floor((rem - drop) / perMin));
  }
  const ff = f % base;
  const ss = Math.floor(f / base) % 60;
  const mm = Math.floor(f / (base * 60)) % 60;
  const hh = Math.floor(f / (base * 3600));
  return `${two(hh)}:${two(mm)}:${two(ss)}${rate.dropFrame ? ";" : ":"}${two(ff)}`;
}

/** True for a label that drop-frame skips: frames 00-01 (00-03 at 59.94) of second 0 in every minute but each tenth. */
export function isDroppedLabel(mm: number, ss: number, ff: number, rate: CaptionFrameRate): boolean {
  return rate.dropFrame && ss === 0 && mm % 10 !== 0 && ff < dropLabelsPerMinute(rate);
}

/** Why a timecode label cannot be read at this rate, or null when it is valid. */
export function timecodeProblem(timecode: string, rate: CaptionFrameRate): string | null {
  const m = TC.exec(timecode.trim());
  if (!m) return `"${timecode}" is not a timecode.`;
  const [mm, ss, ff] = [Number(m[2]), Number(m[3]), Number(m[5])];
  if (isDroppedLabel(mm, ss, ff, rate))
    return `"${timecode}" is a dropped drop-frame label: frames 0-${dropLabelsPerMinute(rate) - 1} do not exist at the start of a minute that is not a multiple of ten.`;
  if (mm > 59 || ss > 59 || ff >= rate.nominal) return `"${timecode}" is out of range for ${rate.nominal} fps.`;
  return null;
}

const TC = /^(\d{1,2}):(\d{2}):(\d{2})([:;.,])(\d{2})$/;

/** "HH:MM:SS:FF" / "HH:MM:SS;FF" -> frame count, or null when malformed. */
export function timecodeToFrames(timecode: string, rate: CaptionFrameRate): number | null {
  const m = TC.exec(timecode.trim());
  if (!m) return null;
  const [hh, mm, ss, ff] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[5])];
  if (mm > 59 || ss > 59 || ff >= rate.nominal) return null;
  if (isDroppedLabel(mm, ss, ff, rate)) return null;
  const base = rate.nominal;
  let frames = ((hh * 60 + mm) * 60 + ss) * base + ff;
  if (rate.dropFrame) {
    const totalMinutes = hh * 60 + mm;
    frames -= dropLabelsPerMinute(rate) * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

export const secondsToFrames = (seconds: number, rate: CaptionFrameRate): number =>
  Math.round(seconds * rate.fps);

export const framesToSeconds = (frames: number, rate: CaptionFrameRate): number => frames / rate.fps;
