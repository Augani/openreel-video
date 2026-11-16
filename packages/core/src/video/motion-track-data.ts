import type { Point, TrackingData, TrackingKeyframe } from "./motion-tracking-engine";
import type { TrackStatus } from "./motion-track-session";

/** Pure helpers over persisted tracking paths. None of them mutate their input. */

function stateOf(data: TrackingData, index: number): TrackStatus {
  return data.states?.[index] ?? (data.lostFrames.includes(data.keyframes[index].frame) ? "predicted" : "tracked");
}

/**
 * Replace the frames a re-track covered. Frames outside the incoming range are kept, so a partial
 * re-track ("from here", or backward from the playhead) refines the path instead of discarding it.
 */
export function mergeTrackingData(existing: TrackingData | null, incoming: TrackingData): TrackingData {
  if (!existing || existing.clipId !== incoming.clipId || existing.frameRate !== incoming.frameRate || incoming.keyframes.length === 0) return incoming;
  const first = incoming.keyframes[0].frame, last = incoming.keyframes[incoming.keyframes.length - 1].frame;
  const rows: Array<{ key: TrackingKeyframe; confidence: number; state: TrackStatus; lost: boolean }> = [];
  const lostBefore = new Set(existing.lostFrames), lostNow = new Set(incoming.lostFrames);
  existing.keyframes.forEach((key, index) => {
    if (key.frame < first || key.frame > last) rows.push({ key, confidence: existing.confidence[index] ?? 1, state: stateOf(existing, index), lost: lostBefore.has(key.frame) });
  });
  incoming.keyframes.forEach((key, index) => rows.push({ key, confidence: incoming.confidence[index] ?? 1, state: stateOf(incoming, index), lost: lostNow.has(key.frame) }));
  rows.sort((a, b) => a.key.frame - b.key.frame);
  return {
    ...incoming, region: existing.region, keyframes: rows.map(row => row.key), confidence: rows.map(row => row.confidence),
    states: rows.map(row => row.state), lostFrames: rows.filter(row => row.lost).map(row => row.key.frame),
    manualFrames: (existing.manualFrames ?? []).filter(frame => frame < first || frame > last),
  };
}

/** Position and confidence at a frame, interpolating between neighbours. Null when the path is empty. */
export function trackingPointAt(data: TrackingData, frame: number): { position: Point; confidence: number; state: TrackStatus; exact: boolean } | null {
  const keys = data.keyframes;
  if (!keys.length) return null;
  let next = keys.findIndex(key => key.frame >= frame);
  if (next < 0) next = keys.length - 1;
  const after = keys[next];
  if (after.frame === frame || next === 0 || after.frame < frame) {
    return { position: { ...after.position }, confidence: data.confidence[next] ?? 1, state: stateOf(data, next), exact: after.frame === frame };
  }
  const before = keys[next - 1], t = (frame - before.frame) / Math.max(1, after.frame - before.frame);
  return {
    position: { x: before.position.x + (after.position.x - before.position.x) * t, y: before.position.y + (after.position.y - before.position.y) * t },
    confidence: Math.min(data.confidence[next - 1] ?? 1, data.confidence[next] ?? 1), state: stateOf(data, next - 1), exact: false,
  };
}

/** Set (or add) the point at `frame` by hand. The result is full-confidence and no longer counted as lost. */
export function correctTrackingFrame(data: TrackingData, frame: number, position: Point): TrackingData {
  if (!Number.isInteger(frame) || frame < 0 || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Choose a valid frame and position");
  const keys = data.keyframes.map(key => ({ ...key, position: { ...key.position } }));
  const confidence = [...data.confidence], states: TrackStatus[] = data.keyframes.map((_, index) => stateOf(data, index));
  const at = keys.findIndex(key => key.frame === frame);
  if (at >= 0) { keys[at].position = { ...position }; confidence[at] = 1; states[at] = "tracked"; }
  else {
    const insert = keys.findIndex(key => key.frame > frame), index = insert < 0 ? keys.length : insert;
    const reference = keys[Math.max(0, index - 1)];
    keys.splice(index, 0, { frame, position: { ...position }, scale: reference?.scale ?? 1, rotation: reference?.rotation ?? 0 });
    confidence.splice(index, 0, 1);
    states.splice(index, 0, "tracked");
  }
  return {
    ...data, keyframes: keys, confidence, states, lostFrames: data.lostFrames.filter(lost => lost !== frame),
    manualFrames: [...new Set([...(data.manualFrames ?? []), frame])].sort((a, b) => a - b),
  };
}

export interface TrackQualityRun { start: number; end: number; kind: "lost" | "weak" }

/** Consecutive frames the tracker was unsure about, for the quality strip and for re-track suggestions. */
export function trackQualityRuns(data: TrackingData, weakBelow = 0.85): TrackQualityRun[] {
  const lost = new Set(data.lostFrames), runs: TrackQualityRun[] = [];
  data.keyframes.forEach((key, index) => {
    const manual = data.manualFrames?.includes(key.frame);
    const kind = manual ? null : lost.has(key.frame) ? "lost" : (data.confidence[index] ?? 1) < weakBelow ? "weak" : null;
    const last = runs[runs.length - 1];
    if (kind && last && last.kind === kind && key.frame - last.end <= 1) last.end = key.frame;
    else if (kind) runs.push({ start: key.frame, end: key.frame, kind });
  });
  return runs;
}
