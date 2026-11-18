/**
 * Pure editing operations for free-form Bezier mask paths (the mask pen
 * tool). Paths use the mask engine's convention: composition-space
 * coordinates in 0..1 (top-left origin) and ABSOLUTE handle positions. A point
 * without handles is a corner; a missing handle falls back to the engine's
 * chord-aligned default, so a handle-free polygon renders with straight edges.
 *
 * Nothing here mutates its input and nothing touches the DOM, so every
 * operation is unit tested and the UI only has to translate pointer gestures.
 */
import {
  maskPathAtTime,
  type BezierPath,
  type BezierPoint,
  type Mask,
  type MaskKeyframe,
  type MaskPoint,
} from "./mask-engine";

export type HandleKind = "in" | "out";

const EPS = 1e-9;

const sub = (a: MaskPoint, b: MaskPoint): MaskPoint => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: MaskPoint, b: MaskPoint): MaskPoint => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: MaskPoint, k: number): MaskPoint => ({ x: a.x * k, y: a.y * k });
const len = (a: MaskPoint): number => Math.hypot(a.x, a.y);
const lerp = (a: MaskPoint, b: MaskPoint, t: number): MaskPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export function clonePath(path: BezierPath): BezierPath {
  return {
    closed: path.closed,
    points: path.points.map((p) => ({
      x: p.x,
      y: p.y,
      ...(p.handleIn ? { handleIn: { ...p.handleIn } } : {}),
      ...(p.handleOut ? { handleOut: { ...p.handleOut } } : {}),
    })),
  };
}

/** Control points of the segment leaving point `i`, with the engine's defaults. */
export function segmentControls(
  path: BezierPath,
  i: number,
): [MaskPoint, MaskPoint, MaskPoint, MaskPoint] {
  const cur = path.points[i];
  const next = path.points[wrap(i + 1, path.points.length)];
  return [
    { x: cur.x, y: cur.y },
    cur.handleOut ?? lerp(cur, next, 0.3),
    next.handleIn ?? lerp(next, cur, 0.3),
    { x: next.x, y: next.y },
  ];
}

/** Number of drawn segments (a closed path has one per point). */
export function segmentCount(path: BezierPath): number {
  const n = path.points.length;
  return path.closed ? n : Math.max(0, n - 1);
}

export function cubicPoint(
  c: readonly [MaskPoint, MaskPoint, MaskPoint, MaskPoint],
  t: number,
): MaskPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x,
    y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y,
  };
}

export function segmentPoint(path: BezierPath, segment: number, t: number): MaskPoint {
  return cubicPoint(segmentControls(path, segment), t);
}

/** The outline as a polygon (for hit testing, coverage and previews). */
export function flattenPath(path: BezierPath, stepsPerSegment = 24): MaskPoint[] {
  const out: MaskPoint[] = [];
  const segs = segmentCount(path);
  for (let s = 0; s < segs; s++) {
    const c = segmentControls(path, s);
    for (let k = 0; k < stepsPerSegment; k++) out.push(cubicPoint(c, k / stepsPerSegment));
  }
  if (!path.closed && path.points.length > 0) out.push({ ...path.points[path.points.length - 1] });
  return out;
}

/** Signed area of the flattened outline (absolute value = covered fraction of the frame). */
export function pathArea(path: BezierPath): number {
  const poly = flattenPath(path);
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Non-zero winding point-in-path test on the flattened outline. */
export function pathContains(path: BezierPath, pt: MaskPoint): boolean {
  const poly = flattenPath(path);
  let wn = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const side = (b.x - a.x) * (pt.y - a.y) - (pt.x - a.x) * (b.y - a.y);
    if (a.y <= pt.y) {
      if (b.y > pt.y && side > 0) wn++;
    } else if (b.y <= pt.y && side < 0) {
      wn--;
    }
  }
  return wn !== 0;
}

export interface PathHit {
  readonly segment: number;
  readonly t: number;
  readonly distance: number;
  readonly point: MaskPoint;
}

/** Closest point on the outline to `pt` (coarse sampling then local refinement). */
export function nearestOnPath(path: BezierPath, pt: MaskPoint): PathHit | null {
  const segs = segmentCount(path);
  let best: PathHit | null = null;
  for (let s = 0; s < segs; s++) {
    const c = segmentControls(path, s);
    let bestT = 0;
    let bestD = Infinity;
    const N = 32;
    for (let k = 0; k <= N; k++) {
      const d = len(sub(cubicPoint(c, k / N), pt));
      if (d < bestD) {
        bestD = d;
        bestT = k / N;
      }
    }
    let lo = Math.max(0, bestT - 1 / N);
    let hi = Math.min(1, bestT + 1 / N);
    for (let it = 0; it < 18; it++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (len(sub(cubicPoint(c, m1), pt)) < len(sub(cubicPoint(c, m2), pt))) hi = m2;
      else lo = m1;
    }
    const t = (lo + hi) / 2;
    const point = cubicPoint(c, t);
    const distance = len(sub(point, pt));
    if (!best || distance < best.distance) best = { segment: s, t, distance, point };
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Vertex / handle edits                                                       */
/* -------------------------------------------------------------------------- */

export function isCornerPoint(p: BezierPoint): boolean {
  return !p.handleIn && !p.handleOut;
}

/** True when both handles exist, point opposite ways and are collinear with the vertex. */
export function isSmoothPoint(p: BezierPoint, tolerance = 1e-3): boolean {
  if (!p.handleIn || !p.handleOut) return false;
  const a = sub(p.handleIn, p);
  const b = sub(p.handleOut, p);
  const la = len(a);
  const lb = len(b);
  if (la < EPS || lb < EPS) return false;
  const cross = Math.abs(a.x * b.y - a.y * b.x) / (la * lb);
  const dot = (a.x * b.x + a.y * b.y) / (la * lb);
  return cross <= tolerance && dot < 0;
}

export function movePoint(path: BezierPath, index: number, to: MaskPoint): BezierPath {
  const next = clonePath(path);
  const p = next.points[index];
  if (!p) return path;
  const d = sub(to, p);
  p.x = to.x;
  p.y = to.y;
  if (p.handleIn) p.handleIn = add(p.handleIn, d);
  if (p.handleOut) p.handleOut = add(p.handleOut, d);
  return next;
}

export function translatePath(path: BezierPath, dx: number, dy: number): BezierPath {
  const next = clonePath(path);
  for (const p of next.points) {
    p.x += dx;
    p.y += dy;
    if (p.handleIn) p.handleIn = { x: p.handleIn.x + dx, y: p.handleIn.y + dy };
    if (p.handleOut) p.handleOut = { x: p.handleOut.x + dx, y: p.handleOut.y + dy };
  }
  return next;
}

/**
 * Moves one handle. On a smooth point the opposite handle stays collinear
 * (same length as before) unless `independent`, which breaks the pair and
 * leaves the point a cusp.
 */
export function moveHandle(
  path: BezierPath,
  index: number,
  kind: HandleKind,
  to: MaskPoint,
  independent = false,
): BezierPath {
  const next = clonePath(path);
  const p = next.points[index];
  if (!p) return path;
  const wasSmooth = isSmoothPoint(path.points[index]);
  const other: HandleKind = kind === "in" ? "out" : "in";
  const key = kind === "in" ? "handleIn" : "handleOut";
  const otherKey = other === "in" ? "handleIn" : "handleOut";
  const oldOther = path.points[index][otherKey];
  p[key] = { ...to };
  if (!independent && wasSmooth && oldOther) {
    const dir = sub(to, p);
    const l = len(dir);
    if (l > EPS) {
      const keep = len(sub(oldOther, p));
      p[otherKey] = add(p, scale(dir, -keep / l));
    }
  }
  return next;
}

/** Drops both handles: the vertex becomes a sharp corner. */
export function makeCorner(path: BezierPath, index: number): BezierPath {
  const next = clonePath(path);
  const p = next.points[index];
  if (!p) return path;
  delete p.handleIn;
  delete p.handleOut;
  return next;
}

/**
 * Gives the vertex symmetric tangent handles aligned with its neighbours
 * (one third of the distance to each) so the curve flows through it.
 */
export function makeSmooth(path: BezierPath, index: number): BezierPath {
  const n = path.points.length;
  if (n < 2 || !path.points[index]) return path;
  const next = clonePath(path);
  const p = next.points[index];
  const hasPrev = path.closed || index > 0;
  const hasNext = path.closed || index < n - 1;
  const prev = path.points[wrap(index - 1, n)];
  const nxt = path.points[wrap(index + 1, n)];
  const a = hasPrev ? prev : p;
  const b = hasNext ? nxt : p;
  let tangent = sub(b, a);
  const tl = len(tangent);
  if (tl < EPS) return path;
  tangent = scale(tangent, 1 / tl);
  const lenIn = hasPrev ? len(sub(p, prev)) / 3 : len(sub(nxt, p)) / 3;
  const lenOut = hasNext ? len(sub(nxt, p)) / 3 : len(sub(p, prev)) / 3;
  p.handleIn = sub(p, scale(tangent, lenIn));
  p.handleOut = add(p, scale(tangent, lenOut));
  return next;
}

/**
 * Alt-drag from a vertex: pulls symmetric handles out of it (outgoing handle
 * at `to`, incoming mirrored), the same result as dragging while placing it.
 */
export function pullHandles(path: BezierPath, index: number, to: MaskPoint): BezierPath {
  const next = clonePath(path);
  const p = next.points[index];
  if (!p) return path;
  const d = sub(to, p);
  if (len(d) < 1e-4) {
    delete p.handleIn;
    delete p.handleOut;
  } else {
    p.handleOut = { x: to.x, y: to.y };
    p.handleIn = { x: p.x - d.x, y: p.y - d.y };
  }
  return next;
}

/** Toggles a vertex between corner and smooth. */
export function toggleSmooth(path: BezierPath, index: number): BezierPath {
  const p = path.points[index];
  if (!p) return path;
  return isSmoothPoint(p) ? makeCorner(path, index) : makeSmooth(path, index);
}

/**
 * Inserts a vertex on `segment` at parameter t without changing the outline
 * (de Casteljau split). A straight, handle-free segment gains a plain corner.
 */
export function insertPoint(path: BezierPath, segment: number, t: number): BezierPath {
  const n = path.points.length;
  if (segment < 0 || segment >= segmentCount(path)) return path;
  const next = clonePath(path);
  const cur = next.points[segment];
  const nxt = next.points[wrap(segment + 1, n)];
  const tt = Math.min(1, Math.max(0, t));
  let inserted: BezierPoint;
  if (!cur.handleOut && !nxt.handleIn) {
    const q = lerp(cur, nxt, tt);
    inserted = { x: q.x, y: q.y };
  } else {
    const [p0, p1, p2, p3] = segmentControls(path, segment);
    const a = lerp(p0, p1, tt);
    const b = lerp(p1, p2, tt);
    const c = lerp(p2, p3, tt);
    const d = lerp(a, b, tt);
    const e = lerp(b, c, tt);
    const q = lerp(d, e, tt);
    cur.handleOut = a;
    nxt.handleIn = c;
    inserted = { x: q.x, y: q.y, handleIn: d, handleOut: e };
  }
  next.points.splice(segment + 1, 0, inserted);
  return next;
}

/** Removes a vertex; a closed mask keeps at least three. */
export function deletePoint(path: BezierPath, index: number): BezierPath {
  if (!path.points[index] || path.points.length <= (path.closed ? 3 : 2)) return path;
  const next = clonePath(path);
  next.points.splice(index, 1);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Pen drawing                                                                 */
/* -------------------------------------------------------------------------- */

/** Starts a corner vertex at `at` (a plain click). */
export function penAddPoint(points: readonly BezierPoint[], at: MaskPoint): BezierPoint[] {
  return [...points.map((p) => ({ ...p })), { x: at.x, y: at.y }];
}

/**
 * Click-and-drag while placing the last vertex: pulls the outgoing handle to
 * `to` and mirrors the incoming one, turning the vertex smooth.
 */
export function penDragHandle(points: readonly BezierPoint[], to: MaskPoint): BezierPoint[] {
  if (points.length === 0) return [];
  const out = points.map((p) => ({ ...p }));
  const last = out[out.length - 1];
  const d = sub(to, last);
  if (len(d) < 1e-4) {
    delete last.handleIn;
    delete last.handleOut;
  } else {
    last.handleOut = { x: to.x, y: to.y };
    last.handleIn = { x: last.x - d.x, y: last.y - d.y };
  }
  return out;
}

export function penToPath(points: readonly BezierPoint[]): BezierPath | null {
  if (points.length < 3) return null;
  return clonePath({ closed: true, points: points as BezierPoint[] });
}

/* -------------------------------------------------------------------------- */
/* Mask path keyframes                                                         */
/* -------------------------------------------------------------------------- */

let idCounter = 0;
function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `mask-key-${Date.now()}-${++idCounter}`;
}

export { maskPathAtTime };

export function findMaskKeyframe(
  mask: Pick<Mask, "keyframes">,
  time: number,
  tolerance: number,
): MaskKeyframe | undefined {
  return mask.keyframes.find((k) => Math.abs(k.time - time) <= tolerance);
}

/** Adds or replaces the path keyframe at `time` (keyframes stay time-sorted). */
export function upsertMaskKeyframe(
  mask: Mask,
  time: number,
  path: BezierPath,
  tolerance: number,
  makeId: () => string = defaultId,
): Mask {
  const existing = findMaskKeyframe(mask, time, tolerance);
  const keyframes = existing
    ? mask.keyframes.map((k) => (k.id === existing.id ? { ...k, path: clonePath(path) } : k))
    : [
        ...mask.keyframes,
        { id: makeId(), time, path: clonePath(path), easing: "linear" as const },
      ].sort((a, b) => a.time - b.time);
  return { ...mask, keyframes };
}

export function removeMaskKeyframeAt(
  mask: Mask,
  time: number,
  tolerance: number,
): Mask {
  const existing = findMaskKeyframe(mask, time, tolerance);
  if (!existing) return mask;
  return { ...mask, keyframes: mask.keyframes.filter((k) => k.id !== existing.id) };
}

/**
 * Applies a shape edit (move a vertex or handle, drag the whole mask) at
 * `time`. Without keyframes it edits the static path; once the mask is
 * keyframed the edit is written as a keyframe at `time`, like a stopwatch
 * that is switched on.
 */
export function editMaskPathAtTime(
  mask: Mask,
  time: number,
  edit: (path: BezierPath) => BezierPath,
  tolerance: number,
  makeId?: () => string,
): Mask {
  if (mask.keyframes.length === 0) return { ...mask, path: edit(mask.path) };
  return upsertMaskKeyframe(mask, time, edit(maskPathAtTime(mask, time)), tolerance, makeId);
}

/**
 * Applies a structural edit (insert / delete a vertex, corner <-> smooth)
 * to the static path and to every keyframe so all of them keep the same
 * vertex count and interpolation stays well defined.
 */
export function editMaskStructure(
  mask: Mask,
  edit: (path: BezierPath) => BezierPath,
): Mask {
  return {
    ...mask,
    path: edit(mask.path),
    keyframes: mask.keyframes.map((k) => ({ ...k, path: edit(k.path) })),
  };
}
