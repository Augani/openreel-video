import type { AutomationPoint, Timeline, Track, TrackAutomation } from "../types/timeline";
import { sanitizeVolumeAutomationPoints } from "./clip-volume-automation";
import { sanitizePanAutomationPoints } from "./clip-pan-automation";

/**
 * Track fader and pan automation lanes (timeline seconds). The lane replaces the
 * rack fader / pan while it plays, in the realtime graph and in the offline mixdown.
 */

export type TrackAutomationLane = "volume" | "pan";

export const TRACK_AUTOMATION_LANES: readonly TrackAutomationLane[] = ["volume", "pan"];

export const isTrackAutomationLane = (value: unknown): value is TrackAutomationLane =>
  value === "volume" || value === "pan";

export const sanitizeTrackLane = (
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | undefined,
): AutomationPoint[] =>
  lane === "volume" ? sanitizeVolumeAutomationPoints(points) : sanitizePanAutomationPoints(points);

/** Well-formed automation, or undefined when no lane has a point. */
export function sanitizeTrackAutomation(raw: unknown): TrackAutomation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as { volume?: unknown; pan?: unknown };
  const volume = Array.isArray(source.volume) ? sanitizeTrackLane("volume", source.volume as AutomationPoint[]) : [];
  const pan = Array.isArray(source.pan) ? sanitizeTrackLane("pan", source.pan as AutomationPoint[]) : [];
  if (volume.length === 0 && pan.length === 0) return undefined;
  return { ...(volume.length ? { volume } : {}), ...(pan.length ? { pan } : {}) };
}

export const hasTrackAutomation = (track: Pick<Track, "automation">): boolean =>
  !!track.automation && ((track.automation.volume?.length ?? 0) > 0 || (track.automation.pan?.length ?? 0) > 0);

export type TrackAutomationPlan =
  | { readonly ok: true; readonly trackId: string; readonly lane: TrackAutomationLane; readonly points: AutomationPoint[] | null; readonly label: string }
  | { readonly ok: false; readonly message: string };

/** Plans replacing one lane's points; an empty list (or null) clears the lane. */
export function planSetTrackAutomation(
  timeline: Pick<Timeline, "tracks">,
  trackId: string,
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | null,
): TrackAutomationPlan {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return { ok: false, message: `Track not found: ${trackId}` };
  if (!isTrackAutomationLane(lane)) return { ok: false, message: "lane must be 'volume' or 'pan'" };
  const cleaned = points ? sanitizeTrackLane(lane, points) : [];
  return {
    ok: true,
    trackId,
    lane,
    points: cleaned.length ? cleaned : null,
    label: `Edit ${track.name} ${lane} automation`,
  };
}

/** Returns the track with one lane replaced (null clears it). Drops `automation` when empty. */
export function withTrackLane<T extends Pick<Track, "automation">>(
  track: T,
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | null,
): T {
  const next: { volume?: AutomationPoint[]; pan?: AutomationPoint[] } = { ...(track.automation ?? {}) };
  const cleaned = points ? sanitizeTrackLane(lane, points) : [];
  if (cleaned.length) next[lane] = cleaned;
  else delete next[lane];
  const { automation: _old, ...rest } = track;
  void _old;
  return (next.volume || next.pan ? { ...rest, automation: next } : rest) as T;
}

/** Smallest time gap kept between neighbouring lane points. */
export const LANE_POINT_GAP = 0.001;

/** Adds a point (a point already at `time` is replaced). */
export function insertLanePoint(
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | undefined,
  time: number,
  value: number,
): AutomationPoint[] {
  if (!Number.isFinite(time) || !Number.isFinite(value)) return sanitizeTrackLane(lane, points);
  const t = Math.max(0, time);
  const kept = sanitizeTrackLane(lane, points).filter((p) => p.time !== t);
  return sanitizeTrackLane(lane, [...kept, { time: t, value }]);
}

/**
 * Moves point `index` to (`time`, `value`). The time stays strictly between its
 * neighbours (and >= 0) so a drag never reorders or merges points; the value is clamped
 * to the lane's range. An index that is not a point is a no-op.
 */
export function moveLanePoint(
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | undefined,
  index: number,
  time: number,
  value: number,
): AutomationPoint[] {
  const list = sanitizeTrackLane(lane, points);
  if (!list[index] || !Number.isFinite(time) || !Number.isFinite(value)) return list;
  const lower = list[index - 1] ? list[index - 1].time + LANE_POINT_GAP : 0;
  const upper = list[index + 1] ? list[index + 1].time - LANE_POINT_GAP : Infinity;
  const next = list.slice();
  next[index] = { time: Math.max(lower, Math.min(Math.max(lower, upper), time)), value };
  return sanitizeTrackLane(lane, next);
}

export function deleteLanePoint(
  lane: TrackAutomationLane,
  points: readonly AutomationPoint[] | undefined,
  index: number,
): AutomationPoint[] {
  return sanitizeTrackLane(lane, points).filter((_, i) => i !== index);
}

/** Lane value range: volume is linear gain 0..4, pan is -1..1. */
export const TRACK_LANE_RANGE: Record<TrackAutomationLane, { readonly min: number; readonly max: number; readonly rest: number }> = {
  volume: { min: 0, max: 4, rest: 1 },
  pan: { min: -1, max: 1, rest: 0 },
};
