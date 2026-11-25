import type { BezierPath, MaskKeyframe } from "../mask-engine";
import type { ObjectTrackFrame } from "./track";

let counter = 0;
const newId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `object-mask-key-${Date.now()}-${++counter}`;
};

export interface TrackedKeyframeOptions {
  /** Timeline time of a footage frame. */
  timeOf(frame: number): number;
  /** Footage-normalised outline to composition-normalised (the clip's transform at that frame). Identity by default. */
  mapPath?(frame: number, path: BezierPath): BezierPath;
  makeId?: () => string;
}

/** One linear path keyframe per tracked frame, sorted by time. */
export function trackedFramesToKeyframes(frames: readonly ObjectTrackFrame[], options: TrackedKeyframeOptions): MaskKeyframe[] {
  const makeId = options.makeId ?? newId;
  return frames
    .map((f) => ({ id: makeId(), time: options.timeOf(f.frame), path: options.mapPath ? options.mapPath(f.frame, f.path) : f.path, easing: "linear" as const }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Put a tracked run into the mask's existing keyframes. The run replaces whatever keyframes lie in its time
 * range (the anchor keyframe included, it is part of the run), earlier and later keyframes stay untouched, so
 * tracking forward from a hand-corrected frame never disturbs what was already tracked behind it.
 */
export function mergeTrackedKeyframes(existing: readonly MaskKeyframe[], tracked: readonly MaskKeyframe[], tolerance = 1e-6): MaskKeyframe[] {
  if (tracked.length === 0) return [...existing];
  const from = Math.min(...tracked.map((k) => k.time)) - tolerance;
  const to = Math.max(...tracked.map((k) => k.time)) + tolerance;
  return [...existing.filter((k) => k.time < from || k.time > to), ...tracked].sort((a, b) => a.time - b.time);
}
