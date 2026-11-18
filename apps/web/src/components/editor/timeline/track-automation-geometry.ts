import { dbToVolume, volumeToDb, type TrackAutomationLane } from "@openreel/core";
import { dbToFraction, fractionToDb } from "./clip-gain-geometry";

/** Height of one automation lane row under a track. */
export const AUTOMATION_LANE_HEIGHT = 44;
/** Both lanes (volume, then pan) are shown together. */
export const AUTOMATION_LANES_HEIGHT = AUTOMATION_LANE_HEIGHT * 2;

/** Fraction of the lane height from the top (0 = top edge) for a lane value. */
export function laneValueToFraction(lane: TrackAutomationLane, value: number): number {
  if (lane === "volume") return dbToFraction(volumeToDb(value));
  // Pan: right at the top, centre in the middle, left at the bottom.
  return (1 - Math.max(-1, Math.min(1, value))) / 2;
}

/** Inverse of {@link laneValueToFraction}. */
export function laneFractionToValue(lane: TrackAutomationLane, fraction: number): number {
  const f = Math.max(0, Math.min(1, fraction));
  if (lane === "volume") return dbToVolume(fractionToDb(f));
  return 1 - 2 * f;
}

export function formatLaneValue(lane: TrackAutomationLane, value: number): string {
  if (lane === "pan") {
    if (Math.abs(value) < 0.005) return "C";
    return `${value < 0 ? "L" : "R"}${Math.round(Math.abs(value) * 100)}`;
  }
  const db = volumeToDb(value);
  return value <= 0 ? "-inf dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}
