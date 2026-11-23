import type { Project, Track } from "../types";
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
  return resolvePlacementOn(
    project.timeline.tracks,
    (trackId, startTime, duration, exclude) => isTimelineIntervalClear(project, trackId, startTime, duration, exclude),
    request,
  );
}

type PlacementTrack = Pick<Track, "id" | "locked">;

/** The placement rules, independent of where occupancy comes from (the project, or a planner's running picture of it). */
function resolvePlacementOn(
  tracks: readonly PlacementTrack[],
  isClear: (trackId: string, startTime: number, duration: number, excludeItemIds?: readonly string[]) => boolean,
  request: TimelinePlacementRequest,
): TimelinePlacementResult {
  const targetIndex = tracks.findIndex(
    (track) => track.id === request.targetTrackId,
  );
  if (targetIndex < 0) return { ok: false, reason: "track-not-found" };

  const target = tracks[targetIndex];
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
    isClear(
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
    const candidate = tracks[index];
    if (
      !candidate.locked &&
      isStandardTrack(candidate as Track) &&
      isClear(
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

/**
 * Placement of MANY items in one pass (paste of a big selection): the same rules as `resolveTimelinePlacement`, applied to a
 * running picture of the timeline that already contains the items planned so far and the rows they created. Resolving item
 * by item against the live project costs one project read per item; this reads the project once.
 */
export interface TimelinePlacementPlanner {
  /** The rows as they will be once everything planned so far is applied (new rows included, in order). */
  readonly tracks: readonly PlacementTrack[];
  /** Resolves one item (policy "stack-above" or "gap") against what is planned so far; does not reserve it. */
  place(request: Omit<TimelinePlacementRequest, "excludeItemIds">): TimelinePlacementResult;
  /** Reserves an item at a resolved placement (and the new row, when the placement created one). */
  reserve(placement: Extract<TimelinePlacementResult, { ok: true }>, duration: number): void;
}

export function createTimelinePlacementPlanner(project: Project): TimelinePlacementPlanner {
  const tracks: PlacementTrack[] = project.timeline.tracks.map((track) => ({ id: track.id, locked: track.locked }));
  const occupancy = new Map<string, Array<{ startTime: number; duration: number }>>();
  const occupancyOf = (trackId: string) => {
    let list = occupancy.get(trackId);
    if (!list) {
      list = getTrackItems(project, trackId).map((item) => ({ startTime: item.startTime, duration: item.duration }));
      occupancy.set(trackId, list);
    }
    return list;
  };
  const isClear = (trackId: string, startTime: number, duration: number) =>
    occupancyOf(trackId).every((item) => !timelineIntervalsOverlap(startTime, duration, item.startTime, item.duration));
  return {
    tracks,
    place: (request) => resolvePlacementOn(tracks, isClear, request),
    reserve: (placement, duration) => {
      if (placement.createdTrack) {
        tracks.splice(placement.createdTrack.position, 0, { id: placement.createdTrack.id, locked: false });
        occupancy.set(placement.createdTrack.id, []);
      }
      occupancyOf(placement.trackId).push({ startTime: placement.startTime, duration });
    },
  };
}
