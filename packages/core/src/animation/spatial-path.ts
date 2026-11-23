import type { Keyframe } from "../types/timeline";

/**
 * Spatial interpolation for the position path (Premiere's "Spatial Interpolation").
 *
 * Position is stored as two scalar properties, `position.x` and `position.y`. Temporal interpolation
 * (the value / speed graphs) decides HOW FAST the clip moves; spatial interpolation decides the ROUTE.
 * A path exists when every `position.x` key has a `position.y` partner at the same time and at least one
 * key has a non-linear `spatialMode`. Then the position at time t is
 *
 *     P(t) = Bezier_segment( arcLengthInverse( ease(t) * segmentLength ) )
 *
 * where `ease` is the temporal progress of the segment's `position.x` key (the engines' shared easing),
 * so speed along the route follows the temporal curve and the route follows the handles. Without a path
 * the two axes are evaluated independently, exactly as before (linear spatial is the legacy behaviour).
 *
 * Handles are stored on the `position.x` key as offsets from its point (`spatialIn` toward the previous
 * key, `spatialOut` toward the next). Auto Bezier derives them from the neighbours at evaluation time
 * (nothing is stored); dragging a handle converts Auto to Continuous (collinear handles, as Premiere
 * does); Bezier keeps the two handles independent.
 */
export const SPATIAL_INTERPOLATION_OPS = ["linear", "bezier", "auto-bezier", "continuous-bezier"] as const;
export type SpatialInterpolationOp = (typeof SPATIAL_INTERPOLATION_OPS)[number];
export const SPATIAL_INTERPOLATION_LABELS: Readonly<Record<SpatialInterpolationOp, string>> = {
  linear: "Linear",
  bezier: "Bezier",
  "auto-bezier": "Auto Bezier",
  "continuous-bezier": "Continuous Bezier",
};

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}
export type KeyframeEase = (t: number, key: Keyframe) => number;

export const SPATIAL_SAME_TIME = 1e-6;
const ARC_STEPS = 128;
const EPS = 1e-12;
const ZERO: Vec2 = { x: 0, y: 0 };

type NumKey = Keyframe & { value: number };
const isNum = (key: Keyframe): key is NumKey => typeof key.value === "number" && Number.isFinite(key.value) && Number.isFinite(key.time);
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const len = (a: Vec2): number => Math.hypot(a.x, a.y);
const finiteVec = (v: Vec2 | undefined): Vec2 =>
  v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : ZERO;

export interface SpatialVertex {
  readonly index: number;
  readonly time: number;
  readonly xKeyId: string;
  readonly yKeyId: string;
  readonly point: Vec2;
  readonly mode: SpatialInterpolationOp;
  /** Resolved handles (offsets from `point`); Auto sides are derived, Linear is zero. */
  readonly tangentIn: Vec2;
  readonly tangentOut: Vec2;
}

/** Position keys paired by time, or null when x and y keys do not line up one to one (no path). */
export function pairPositionKeys(keys: readonly Keyframe[]): { x: NumKey; y: NumKey }[] | null {
  const xs = keys.filter((k) => k.property === "position.x").sort((a, b) => a.time - b.time);
  const ys = keys.filter((k) => k.property === "position.y").sort((a, b) => a.time - b.time);
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const pairs: { x: NumKey; y: NumKey }[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!isNum(x) || !isNum(y) || Math.abs(x.time - y.time) > SPATIAL_SAME_TIME) return null;
    if (i > 0 && x.time - xs[i - 1].time <= SPATIAL_SAME_TIME) return null;
    pairs.push({ x, y });
  }
  return pairs;
}

/** Smooth tangent at vertex k: along the neighbour chord, one third of each adjacent leg's length; flat at the ends. */
export function autoSpatialTangents(points: readonly Vec2[], k: number): { in: Vec2; out: Vec2 } {
  const prev = points[k - 1], next = points[k + 1];
  if (!prev || !next) return { in: ZERO, out: ZERO };
  const chord = sub(next, prev);
  const chordLen = len(chord);
  if (chordLen < EPS) return { in: ZERO, out: ZERO };
  const dir = scale(chord, 1 / chordLen);
  const here = points[k];
  return {
    out: scale(dir, len(sub(next, here)) / 3),
    in: scale(dir, -len(sub(here, prev)) / 3),
  };
}

export function resolveSpatialVertices(keys: readonly Keyframe[]): SpatialVertex[] | null {
  const pairs = pairPositionKeys(keys);
  if (!pairs) return null;
  const points = pairs.map((p) => ({ x: p.x.value, y: p.y.value }));
  return pairs.map((pair, i) => {
    const mode = pair.x.spatialMode ?? "linear";
    let tangentIn = ZERO, tangentOut = ZERO;
    if (mode === "auto-bezier") {
      const auto = autoSpatialTangents(points, i);
      tangentIn = auto.in; tangentOut = auto.out;
    } else if (mode === "bezier" || mode === "continuous-bezier") {
      tangentIn = finiteVec(pair.x.spatialIn); tangentOut = finiteVec(pair.x.spatialOut);
    }
    return { index: i, time: pair.x.time, xKeyId: pair.x.id, yKeyId: pair.y.id, point: points[i], mode, tangentIn, tangentOut };
  });
}

export interface BezierSegment2D {
  readonly p0: Vec2;
  readonly c1: Vec2;
  readonly c2: Vec2;
  readonly p3: Vec2;
}
export function bezierPoint(seg: BezierSegment2D, u: number): Vec2 {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
  return {
    x: a * seg.p0.x + b * seg.c1.x + c * seg.c2.x + d * seg.p3.x,
    y: a * seg.p0.y + b * seg.c1.y + c * seg.c2.y + d * seg.p3.y,
  };
}
export function bezierDerivative(seg: BezierSegment2D, u: number): Vec2 {
  const v = 1 - u;
  const a = 3 * v * v, b = 6 * v * u, c = 3 * u * u;
  const d1 = sub(seg.c1, seg.p0), d2 = sub(seg.c2, seg.c1), d3 = sub(seg.p3, seg.c2);
  return add(add(scale(d1, a), scale(d2, b)), scale(d3, c));
}
/** Cumulative chord lengths at u = i / steps (index 0 is 0). */
export function arcLengthTable(seg: BezierSegment2D, steps = ARC_STEPS): number[] {
  const table = [0];
  let prev = seg.p0;
  for (let i = 1; i <= steps; i++) {
    const point = bezierPoint(seg, i / steps);
    table.push(table[i - 1] + len(sub(point, prev)));
    prev = point;
  }
  return table;
}
export function bezierArcLength(seg: BezierSegment2D, steps = ARC_STEPS): number {
  const table = arcLengthTable(seg, steps);
  return table[table.length - 1];
}
const isStraight = (seg: BezierSegment2D) =>
  len(sub(seg.c1, seg.p0)) < EPS && len(sub(seg.c2, seg.p3)) < EPS;

/**
 * Point at `fraction` of the segment's ARC LENGTH. Fractions outside [0, 1] (temporal overshoot)
 * continue along the end tangent so a bouncing ease still moves along the route, then past it.
 */
export function pointAtArcFraction(seg: BezierSegment2D, fraction: number): Vec2 {
  if (isStraight(seg)) return add(seg.p0, scale(sub(seg.p3, seg.p0), fraction));
  const table = arcLengthTable(seg);
  const total = table[table.length - 1];
  if (!(total > EPS)) return seg.p0;
  if (fraction <= 0 || fraction >= 1) {
    const atEnd = fraction >= 1;
    const d = bezierDerivative(seg, atEnd ? 1 : 0);
    const dl = len(d);
    const dir = dl > EPS ? scale(d, 1 / dl) : scale(sub(seg.p3, seg.p0), 1 / total);
    const overshoot = (atEnd ? fraction - 1 : fraction) * total;
    return add(atEnd ? seg.p3 : seg.p0, scale(dir, overshoot));
  }
  const target = fraction * total;
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= target) lo = mid; else hi = mid;
  }
  const span = table[hi] - table[lo];
  const frac = span > EPS ? (target - table[lo]) / span : 0;
  return bezierPoint(seg, (lo + frac) / (table.length - 1));
}

export function spatialSegments(vertices: readonly SpatialVertex[]): BezierSegment2D[] {
  const segments: BezierSegment2D[] = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i], b = vertices[i + 1];
    segments.push({ p0: a.point, c1: add(a.point, a.tangentOut), c2: add(b.point, b.tangentIn), p3: b.point });
  }
  return segments;
}

/** True when the keys form a position path with at least one non-linear spatial key. */
export function hasSpatialPath(keys: readonly Keyframe[]): boolean {
  if (!keys.some((k) => k.property === "position.x" && k.spatialMode && k.spatialMode !== "linear")) return false;
  return pairPositionKeys(keys) !== null;
}

/**
 * Position at clip-local `time` when the keys describe a spatial path, otherwise null (callers then
 * evaluate each axis independently). `ease` is the engine's per-segment progress function so preview,
 * export, the inspector and the agent all share one temporal curve.
 */
export function samplePositionPath(
  keys: readonly Keyframe[] | undefined,
  time: number,
  ease: KeyframeEase,
): Vec2 | null {
  if (!keys || keys.length < 4) return null;
  if (!keys.some((k) => k.property === "position.x" && k.spatialMode && k.spatialMode !== "linear")) return null;
  const vertices = resolveSpatialVertices(keys);
  if (!vertices) return null;
  const first = vertices[0], last = vertices[vertices.length - 1];
  if (time <= first.time) return first.point;
  if (time >= last.time) return last.point;
  const xKeys = keys.filter((k) => k.property === "position.x").sort((a, b) => a.time - b.time);
  let i = 0;
  while (i < vertices.length - 2 && time > vertices[i + 1].time) i++;
  const a = vertices[i], b = vertices[i + 1];
  const dur = b.time - a.time;
  const t = dur > 0 ? (time - a.time) / dur : 0;
  const progress = ease(Math.max(0, Math.min(1, t)), xKeys[i]);
  if (!Number.isFinite(progress)) return null;
  return pointAtArcFraction(spatialSegments(vertices)[i], progress);
}

/** Polyline of the route for drawing (the geometry, independent of timing). */
export function sampleSpatialRoute(keys: readonly Keyframe[], perSegment = 24): Vec2[] {
  const vertices = resolveSpatialVertices(keys);
  if (!vertices) return [];
  const out: Vec2[] = [];
  spatialSegments(vertices).forEach((seg, i) => {
    for (let s = i === 0 ? 0 : 1; s <= perSegment; s++) out.push(bezierPoint(seg, s / perSegment));
  });
  return out;
}

// ---- edits ------------------------------------------------------------------------------------

function pairIndexFor(pairs: { x: NumKey; y: NumKey }[], id: string): number {
  return pairs.findIndex((p) => p.x.id === id || p.y.id === id);
}
function writeKey(keys: Keyframe[], id: string, patch: Partial<Keyframe>, drop: ReadonlyArray<keyof Keyframe> = []): void {
  const at = keys.findIndex((k) => k.id === id);
  if (at < 0) return;
  const next = { ...keys[at], ...patch } as Record<string, unknown>;
  for (const field of drop) delete next[field as string];
  for (const [field, value] of Object.entries(patch)) if (value === undefined) delete next[field];
  keys[at] = next as unknown as Keyframe;
}

/** Chord-third handles used to seed a freshly Bezier key so it still looks straight until dragged. */
function chordTangents(points: readonly Vec2[], k: number): { in: Vec2; out: Vec2 } {
  const here = points[k], prev = points[k - 1], next = points[k + 1];
  return {
    in: prev ? scale(sub(prev, here), 1 / 3) : ZERO,
    out: next ? scale(sub(next, here), 1 / 3) : ZERO,
  };
}

/** Apply a spatial interpolation type to the position keys (x or y) in `ids`. Returns the keys unchanged when no position path pair exists. */
export function applySpatialInterpolation(
  keyframes: readonly Keyframe[],
  ids: readonly string[],
  op: SpatialInterpolationOp,
): Keyframe[] {
  const pairs = pairPositionKeys(keyframes);
  const next = [...keyframes];
  if (!pairs) return next;
  const points = pairs.map((p) => ({ x: p.x.value, y: p.y.value }));
  const resolved = resolveSpatialVertices(keyframes) as SpatialVertex[];
  const picked = new Set<number>();
  for (const id of ids) {
    const at = pairIndexFor(pairs, id);
    if (at >= 0) picked.add(at);
  }
  for (const at of picked) {
    const xId = pairs[at].x.id;
    if (op === "linear" || op === "auto-bezier") {
      writeKey(next, xId, { spatialMode: op === "linear" ? undefined : op }, ["spatialIn", "spatialOut"]);
      continue;
    }
    const wasSmooth = resolved[at].mode === "auto-bezier" || resolved[at].mode === "continuous-bezier";
    const seed = op === "continuous-bezier" || wasSmooth ? (resolved[at].mode === "linear" ? autoSpatialTangents(points, at) : { in: resolved[at].tangentIn, out: resolved[at].tangentOut }) : chordTangents(points, at);
    writeKey(next, xId, { spatialMode: op, spatialIn: seed.in, spatialOut: seed.out });
  }
  return next;
}

/** Move one spatial handle of the key `keyId` (a position.x or position.y key) to `offset` from its point. Auto becomes Continuous; Continuous mirrors the opposite handle's direction. */
export function setSpatialHandle(
  keyframes: readonly Keyframe[],
  keyId: string,
  which: "in" | "out",
  offset: Vec2,
): Keyframe[] {
  const pairs = pairPositionKeys(keyframes);
  const next = [...keyframes];
  if (!pairs) return next;
  const at = pairIndexFor(pairs, keyId);
  if (at < 0) return next;
  const vertices = resolveSpatialVertices(keyframes) as SpatialVertex[];
  const points = pairs.map((p) => ({ x: p.x.value, y: p.y.value }));
  const v = vertices[at];
  let mode: SpatialInterpolationOp = v.mode;
  let seed = { in: v.tangentIn, out: v.tangentOut };
  if (mode === "linear") { mode = "bezier"; seed = chordTangents(points, at); }
  if (mode === "auto-bezier") mode = "continuous-bezier";
  const moved = finiteVec(offset);
  let tangentIn = seed.in, tangentOut = seed.out;
  if (which === "out") tangentOut = moved; else tangentIn = moved;
  if (mode === "continuous-bezier") {
    const edited = which === "out" ? tangentOut : tangentIn;
    const other = which === "out" ? tangentIn : tangentOut;
    const editedLen = len(edited);
    const otherLen = len(other) > EPS ? len(other) : editedLen;
    const mirrored = editedLen > EPS ? scale(edited, -otherLen / editedLen) : ZERO;
    if (which === "out") tangentIn = mirrored; else tangentOut = mirrored;
  }
  writeKey(next, pairs[at].x.id, { spatialMode: mode, spatialIn: tangentIn, spatialOut: tangentOut });
  return next;
}
