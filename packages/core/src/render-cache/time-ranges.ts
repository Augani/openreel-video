/** Half-open time interval [start, end) in seconds. */
export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/** Inclusive run of frame indices. */
export interface FrameRange {
  readonly start: number;
  readonly end: number;
}

export function isValidRange(range: TimeRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start;
}

/** Sort, drop empty/non-finite entries and merge touching or overlapping ranges. */
export function normalizeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges.filter(isValidRange).slice().sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end) {
      if (range.end > last.end) out[out.length - 1] = { start: last.start, end: range.end };
    } else {
      out.push({ start: range.start, end: range.end });
    }
  }
  return out;
}

export function unionRanges(a: readonly TimeRange[], b: readonly TimeRange[]): TimeRange[] {
  return normalizeRanges([...a, ...b]);
}

export function rangesContain(ranges: readonly TimeRange[], time: number): boolean {
  return ranges.some((range) => time >= range.start && time < range.end);
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

export function subtractRanges(
  from: readonly TimeRange[],
  remove: readonly TimeRange[],
): TimeRange[] {
  const cuts = normalizeRanges(remove);
  const out: TimeRange[] = [];
  for (const range of normalizeRanges(from)) {
    let cursor = range.start;
    for (const cut of cuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= range.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    }
    if (cursor < range.end) out.push({ start: cursor, end: range.end });
  }
  return out;
}

export function intersectRanges(
  a: readonly TimeRange[],
  b: readonly TimeRange[],
): TimeRange[] {
  const out: TimeRange[] = [];
  for (const x of normalizeRanges(a)) {
    for (const y of normalizeRanges(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalizeRanges(out);
}

export function rangesEqual(a: readonly TimeRange[], b: readonly TimeRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].start !== b[i].start || a[i].end !== b[i].end) return false;
  }
  return true;
}

export function frameToTime(frame: number, frameRate: number): number {
  return frame / frameRate;
}

export function timeToFrame(time: number, frameRate: number): number {
  return Math.round(time * frameRate);
}

/**
 * Inclusive span of frames whose render time (frame / frameRate, computed with
 * the same expression the renderer uses) lies in [start, end). Uses the exact
 * float comparison the compositor applies to clip activity, so a frame is
 * invalidated if and only if the renderer would have drawn the entity in it.
 */
export function framesInRange(range: TimeRange, frameRate: number): FrameRange | null {
  if (!isValidRange(range) || !(frameRate > 0)) return null;
  const inside = (frame: number) => {
    const time = frame / frameRate;
    return time >= range.start && time < range.end;
  };
  const lo = Math.max(0, Math.floor(range.start * frameRate) - 2);
  const hi = Math.ceil(range.end * frameRate) + 2;
  let first = -1;
  let last = -1;
  for (let frame = lo; frame <= hi; frame++) {
    if (inside(frame)) {
      first = frame;
      break;
    }
  }
  if (first < 0) return null;
  for (let frame = hi; frame >= first; frame--) {
    if (inside(frame)) {
      last = frame;
      break;
    }
  }
  return { start: first, end: last };
}

/** Merge frame numbers into sorted inclusive runs. */
export function framesToRuns(frames: Iterable<number>): FrameRange[] {
  const sorted = Array.from(frames).sort((a, b) => a - b);
  const out: FrameRange[] = [];
  for (const frame of sorted) {
    const last = out[out.length - 1];
    if (last && frame <= last.end + 1) {
      if (frame > last.end) out[out.length - 1] = { start: last.start, end: frame };
    } else {
      out.push({ start: frame, end: frame });
    }
  }
  return out;
}

export function runsToTimeRanges(runs: readonly FrameRange[], frameRate: number): TimeRange[] {
  return runs.map((run) => ({
    start: run.start / frameRate,
    end: (run.end + 1) / frameRate,
  }));
}
