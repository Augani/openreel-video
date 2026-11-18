import { GAIN_DB_MAX, GAIN_DB_MIN } from "@openreel/core";

/** Fraction of the clip height, measured up from the bottom, where 0 dB sits. */
export const UNITY_FROM_BOTTOM = 0.6;
/** Gain lines are only drawn when the track is at least this tall (the "medium" size). */
export const GAIN_LINE_MIN_TRACK_HEIGHT = 48;
/** Below 0 dB the scale is logarithmic so the useful -30..0 dB band gets most of the height. */
const KNEE_DB = 6;
const LOG_SPAN = Math.log(1 + -GAIN_DB_MIN / KNEE_DB);

/** Fraction of the height from the top (0 = top edge) for a dB value, clamped to the range. */
export function dbToFraction(db: number): number {
  const clamped = Math.max(GAIN_DB_MIN, Math.min(GAIN_DB_MAX, db));
  const unity = 1 - UNITY_FROM_BOTTOM;
  if (clamped >= 0) return unity * (1 - clamped / GAIN_DB_MAX);
  const below = Math.log(1 + -clamped / KNEE_DB) / LOG_SPAN;
  return unity + UNITY_FROM_BOTTOM * below;
}

/** Inverse of {@link dbToFraction}. */
export function fractionToDb(fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  const unity = 1 - UNITY_FROM_BOTTOM;
  if (f <= unity) return GAIN_DB_MAX * (1 - f / unity);
  const below = (f - unity) / UNITY_FROM_BOTTOM;
  return -KNEE_DB * (Math.exp(below * LOG_SPAN) - 1);
}

export const formatGainDb = (db: number): string =>
  db <= GAIN_DB_MIN + 0.05 ? "-∞ dB" : `${db > 0 ? "+" : db < 0 ? "-" : ""}${Math.abs(db).toFixed(1)} dB`;
