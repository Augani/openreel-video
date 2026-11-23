/**
 * Used-range maths for Project Manager: merge, frame-snap and cap the source ranges a project plays,
 * lay them end to end as the segments of a trimmed copy, and map source times and clip in/out points
 * from the original file to the trimmed one.
 *
 * A trimmed file is the used ranges concatenated, so every segment starts on a frame boundary and is a whole
 * number of frames long: the frame grid of the copy is the frame grid of the source, and a clip keeps showing the
 * same pictures after `mapRange` rewrites its in/out points.
 */

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

/** One kept stretch of the source (`srcStart`..`srcEnd`), placed at `outStart` in the trimmed file. */
export interface Segment {
  readonly srcStart: number;
  readonly srcEnd: number;
  readonly outStart: number;
}

const EPS = 1e-6;

/** NTSC-family rates are fractions (30000/1001); probes and metadata round them (29.97). */
export function exactFrameRate(fps: number): number {
  if (!(fps > 0) || !Number.isFinite(fps)) return 0;
  for (const base of [24, 30, 48, 60, 120]) {
    const ntsc = (base * 1000) / 1001;
    if (Math.abs(fps - ntsc) < 0.006) return ntsc;
  }
  return Math.abs(fps - Math.round(fps)) < 1e-4 ? Math.round(fps) : fps;
}

/** Sorted, with overlapping ranges and ranges closer than `gap` seconds joined. Empty and inverted ranges are dropped. */
export function mergeRanges(ranges: readonly TimeRange[], gap = 0): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.start <= last.end + gap + EPS) last.end = Math.max(last.end, range.end);
    else out.push(range);
  }
  return out;
}

/** Extend a range by `handleSeconds` on both sides, clamped to the file. */
export function withHandles(range: TimeRange, handleSeconds: number, duration: number): TimeRange {
  const limit = duration > 0 ? duration : Infinity;
  return { start: Math.max(0, range.start - handleSeconds), end: Math.min(limit, range.end + handleSeconds) };
}

/** Widen a range to whole frames (start rounds down, end rounds up), clamped to the file's whole frames. */
export function snapRangeToFrames(range: TimeRange, fps: number, duration = 0): TimeRange {
  if (!(fps > 0)) return { start: Math.max(0, range.start), end: duration > 0 ? Math.min(duration, range.end) : range.end };
  const first = Math.max(0, Math.floor(range.start * fps + EPS));
  let last = Math.ceil(range.end * fps - EPS);
  if (duration > 0) last = Math.min(last, Math.floor(duration * fps + EPS));
  return { start: first / fps, end: Math.max(first + 1, last) / fps };
}

/**
 * Merge the closest neighbours until at most `max` ranges remain (an ffmpeg command takes one input per
 * segment, so a hundred cuts in one source become a few longer keeps).
 */
export function capSegmentCount(ranges: readonly TimeRange[], max: number): TimeRange[] {
  const out = ranges.map((r) => ({ ...r }));
  while (out.length > Math.max(1, max)) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < out.length; i++) {
      const gap = out[i + 1].start - out[i].end;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    out.splice(best, 2, { start: out[best].start, end: out[best + 1].end });
  }
  return out;
}

/** Lay ranges end to end: `outStart` of each is the total length of the ones before it. */
export function buildSegments(ranges: readonly TimeRange[]): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const range of ranges) {
    out.push({ srcStart: range.start, srcEnd: range.end, outStart: at });
    at += range.end - range.start;
  }
  return out;
}

export function segmentsDuration(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.srcEnd - s.srcStart), 0);
}

/** Within `EPS` of a frame boundary: that boundary exactly. Keeps frame lookups (`floor(t * fps)`) off a rounding edge. */
export function snapToGrid(time: number, fps: number): number {
  if (!(fps > 0)) return time;
  const frames = time * fps;
  const nearest = Math.round(frames);
  return Math.abs(frames - nearest) < 1e-6 ? nearest / fps : time;
}

/** Source time `t` as a time in the trimmed file; null when `t` is outside every kept segment. */
export function mapSourceTime(segments: readonly Segment[], t: number, fps = 0): number | null {
  for (const s of segments) {
    if (t >= s.srcStart - EPS && t <= s.srcEnd + EPS) return snapToGrid(t - s.srcStart + s.outStart, fps);
  }
  return null;
}

/** An in/out pair as times in the trimmed file; null unless both ends lie in ONE segment (a clip never straddles a cut). */
export function mapRange(
  segments: readonly Segment[],
  start: number,
  end: number,
  fps = 0,
): { start: number; end: number } | null {
  for (const s of segments) {
    if (start >= s.srcStart - EPS && end <= s.srcEnd + EPS) {
      return { start: snapToGrid(start - s.srcStart + s.outStart, fps), end: snapToGrid(end - s.srcStart + s.outStart, fps) };
    }
  }
  return null;
}
