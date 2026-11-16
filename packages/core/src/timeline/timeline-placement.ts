import type { Project } from "../types";
import { getTrackItems, isStandardTrack } from "./timeline-items";

/**
 * "overlap" keeps the item on the requested track even when occupied, for
 * interactions that resolve the overlap themselves afterwards (clip drag drop).
 */
type TimelinePlacementPolicy = "gap" | "stack-above" | "overlap";

interface TimelinePlacementRequest {
  readonly targetTrackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly policy: TimelinePlacementPolicy;
  readonly excludeItemIds?: readonly string[];
  readonly newTrackId?: string;
}

type TimelinePlacementResult =
  | {
      readonly ok: true;
      readonly trackId: string;
      readonly startTime: number;
      readonly createdTrack?: { readonly id: string; readonly position: number };
    }
  | {
      readonly ok: false;
      readonly reason: "track-not-found" | "track-locked" | "overlap";
    };

const PLACEMENT_EPSILON = 0.0001;

function timelineIntervalsOverlap(
  leftStart: number,
  leftDuration: number,
  rightStart: number,
  rightDuration: number,
): boolean {
  const leftEnd = leftStart + leftDuration;
  const rightEnd = rightStart + rightDuration;
  return (
    leftStart < rightEnd - PLACEMENT_EPSILON &&
    rightStart < leftEnd - PLACEMENT_EPSILON
  );
}

function isTimelineIntervalClear(
  project: Project,
  trackId: string,
  startTime: number,
  duration: number,
  excludeItemIds: readonly string[] = [],
): boolean {
  const excluded = new Set(excludeItemIds);
  return getTrackItems(project, trackId).every(
    (item) =>
      excluded.has(item.id) ||
      !timelineIntervalsOverlap(
        startTime,
        duration,
        item.startTime,
        item.duration,
      ),
  );
}

/** Resolve the destination row without mutating the project. */
export function resolveTimelinePlacement(
  project: Project,
  request: TimelinePlacementRequest,
): TimelinePlacementResult {
  const targetIndex = project.timeline.tracks.findIndex(
    (track) => track.id === request.targetTrackId,
  );
  if (targetIndex < 0) return { ok: false, reason: "track-not-found" };

  const target = project.timeline.tracks[targetIndex];
  if (target.locked && request.policy === "gap") {
    return { ok: false, reason: "track-locked" };
  }

  const startTime = Math.max(0, request.startTime);
  if (request.policy === "overlap") {
    if (target.locked) return { ok: false, reason: "track-locked" };
    return { ok: true, trackId: target.id, startTime };
  }
  if (
    !target.locked &&
    isTimelineIntervalClear(
      project,
      target.id,
      startTime,
      request.duration,
      request.excludeItemIds,
    )
  ) {
    return { ok: true, trackId: target.id, startTime };
  }

  if (request.policy === "gap") return { ok: false, reason: "overlap" };

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = project.timeline.tracks[index];
    if (
      !candidate.locked &&
      isStandardTrack(candidate) &&
      isTimelineIntervalClear(
        project,
        candidate.id,
        startTime,
        request.duration,
        request.excludeItemIds,
      )
    ) {
      return { ok: true, trackId: candidate.id, startTime };
    }
  }

  const newTrackId = request.newTrackId ?? `track-${crypto.randomUUID()}`;
  return {
    ok: true,
    trackId: newTrackId,
    startTime,
    createdTrack: { id: newTrackId, position: targetIndex },
  };
}
