/** A continuous part of an edited timeline, sampled from its original clock.
 * Keeping that clock explicit lets callers preserve source frames, automation,
 * fades and animation instead of silently restarting them at a new cut. */
export interface TimelineSlice {
  startTime: number;
  duration: number;
  fromTime: number;
  inserted: boolean;
}
type TimelineSplice =
  | { type: "remove"; start: number; end: number }
  | { type: "insert"; at: number; duration: number; fromTime: number };

const EPS = 1e-8;
function finite(value: number) {
  if (!Number.isFinite(value))
    throw new Error("Timeline coordinates must be finite.");
}

/** Map one original range through a sequence edit. At most three slices are
 * returned. Unrelated tracks can leave an insertion empty; linked streams can
 * fill it with the same newly revealed source interval as the primary clip. */
export function spliceTimelineRange(
  range: { startTime: number; duration: number },
  edit: TimelineSplice,
  options: {
    fillInsertion?: boolean;
    fillAtStart?: boolean;
    fillAtEnd?: boolean;
  } = {},
): TimelineSlice[] {
  finite(range.startTime);
  finite(range.duration);
  if (range.startTime < 0 || range.duration <= 0)
    throw new Error(
      "A timeline range must have positive duration and a non-negative start.",
    );
  const start = range.startTime,
    end = start + range.duration;
  finite(end);
  const result: TimelineSlice[] = [];
  const add = (
    timelineStart: number,
    from: number,
    duration: number,
    inserted = false,
  ) => {
    if (duration > EPS)
      result.push({
        startTime: timelineStart,
        duration,
        fromTime: from,
        inserted,
      });
  };
  if (edit.type === "remove") {
    finite(edit.start);
    finite(edit.end);
    if (edit.start < 0 || edit.end < edit.start)
      throw new Error("The removed interval is invalid.");
    const removed = edit.end - edit.start;
    if (removed <= EPS)
      return [
        {
          startTime: start,
          duration: range.duration,
          fromTime: start,
          inserted: false,
        },
      ];
    const beforeEnd = Math.min(end, edit.start);
    add(start, start, beforeEnd - start);
    const afterStart = Math.max(start, edit.end);
    add(afterStart - removed, afterStart, end - afterStart);
  } else {
    finite(edit.at);
    finite(edit.duration);
    finite(edit.fromTime);
    if (edit.at < 0 || edit.duration < 0)
      throw new Error("The inserted interval is invalid.");
    if (edit.duration <= EPS)
      return [
        {
          startTime: start,
          duration: range.duration,
          fromTime: start,
          inserted: false,
        },
      ];
    add(start, start, Math.min(end, edit.at) - start);
    const inside = start < edit.at - EPS && end > edit.at + EPS;
    const atStart = Math.abs(start - edit.at) <= EPS && options.fillAtStart;
    const atEnd = Math.abs(end - edit.at) <= EPS && options.fillAtEnd;
    if (options.fillInsertion && (inside || atStart || atEnd))
      add(edit.at, edit.fromTime, edit.duration, true);
    const afterStart = Math.max(start, edit.at);
    add(afterStart + edit.duration, afterStart, end - afterStart);
  }
  return result;
}

/** Project an attached cue through source slices. An inserted/repeated source
 * interval can legitimately produce a second cue; a removed interval cannot
 * manufacture words or reset their original animation clock. */
export function projectRangeThroughSlices(
  range: { startTime: number; duration: number },
  slices: readonly TimelineSlice[],
): TimelineSlice[] {
  finite(range.startTime);
  finite(range.duration);
  if (range.duration <= 0) return [];
  return slices.flatMap((slice) => {
    const start = Math.max(range.startTime, slice.fromTime);
    const end = Math.min(
      range.startTime + range.duration,
      slice.fromTime + slice.duration,
    );
    return end - start > EPS
      ? [
          {
            startTime: slice.startTime + start - slice.fromTime,
            duration: end - start,
            fromTime: start,
            inserted: slice.inserted,
          },
        ]
      : [];
  });
}
