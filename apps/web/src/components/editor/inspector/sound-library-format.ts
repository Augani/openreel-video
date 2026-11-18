/**
 * Duration label for sound-library rows. One format for the whole list: seconds
 * with a tenth ("7.5s", "10.8s") so SFX and music loops compare at a glance and
 * a 10.8 s loop never rounds to 00:11. Only sounds of a minute or more use m:ss.
 */
export function formatSoundDuration(seconds: number): string {
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const rounded = Math.max(0.1, Math.round(value * 10) / 10);
  if (rounded < 60) return `${rounded.toFixed(1)}s`;
  const total = Math.round(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
