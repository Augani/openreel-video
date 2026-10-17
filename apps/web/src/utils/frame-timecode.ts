import { normalizeEditingFrameRate } from "../components/editor/editing-frame-rate";

/** Non-drop-frame labels count frames, including at fractional project rates. */
export function formatFrameTimecode(seconds: number, frameRate: number): string {
  const rate = normalizeEditingFrameRate(frameRate);
  const nominal = Math.max(1, Math.round(rate));
  const total = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * rate));
  const frames = total % nominal;
  const whole = Math.floor(total / nominal);
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60, frames]
    .map((value, index) => String(value).padStart(index === 3 && nominal > 100 ? 3 : 2, "0")).join(":");
}

/** Accept HH:MM:SS:FF, MM:SS:FF, MM:SS, or a number of seconds. */
export function parseFrameTimecode(value: string, frameRate: number): number | null {
  const rate = normalizeEditingFrameRate(frameRate);
  const parts = value.trim().split(":");
  let frames: number;
  if (parts.length === 1 && /^\d+(?:\.\d+)?$/.test(parts[0])) {
    frames = Math.round(Number(parts[0]) * rate);
  } else if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}(?:\.\d+)?$/.test(parts[1]) && Number(parts[1]) < 60) {
    frames = Math.round((Number(parts[0]) * 60 + Number(parts[1])) * rate);
  } else if ((parts.length === 3 || parts.length === 4) && parts.every((part) => /^\d+$/.test(part))) {
    const nominal = Math.max(1, Math.round(rate));
    const [hours, minutes, seconds, frame] = parts.length === 4 ? parts.map(Number) : [0, ...parts.map(Number)];
    if (seconds >= 60 || frame >= nominal || (parts.length === 4 && minutes >= 60)) return null;
    frames = ((hours * 60 + minutes) * 60 + seconds) * nominal + frame;
  } else return null;
  return Number.isSafeInteger(frames) && frames >= 0 ? frames / rate : null;
}
