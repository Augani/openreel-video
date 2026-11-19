import type { Keyframe } from "../types/timeline";
import {
  LINEAR_BEZIER_HANDLES,
  clampBezierHandles,
  effectiveBezierHandles,
  type BezierHandlePoint,
  type BezierHandles,
} from "./keyframe-bezier";

/**
 * Premiere-style temporal interpolation for keyframes, with independent incoming and outgoing
 * types per key.
 *
 * Storage model (unchanged for the engines): each segment A->B lives on key A as `easing` plus
 * `bezierHandles` (P1 = in, the handle leaving A; P2 = out, the handle entering B). The two ends of
 * a segment therefore have distinct owners: P1 belongs to A's OUT side, P2 to B's IN side. Every
 * mode is baked into those handles so preview, export and the graph evaluate identically.
 *
 * "auto-bezier" and "continuous-bezier" are additionally persisted per side (`interpolationIn` /
 * `interpolationOut`) so a side's handle can be re-derived when neighbours move. A smooth side only
 * ever rewrites the handle it owns, so a hand-tuned handle on the other end of a shared segment is
 * never overwritten. Older projects lack the fields and are never touched.
 */
export const KEYFRAME_INTERPOLATION_OPS = [
  "linear",
  "bezier",
  "auto-bezier",
  "continuous-bezier",
  "hold",
  "ease-in",
  "ease-out",
] as const;
export type KeyframeInterpolationOp = (typeof KEYFRAME_INTERPOLATION_OPS)[number];
export type KeyframeInterpolationSide = "both" | "in" | "out";

export const KEYFRAME_INTERPOLATION_LABELS: Readonly<Record<KeyframeInterpolationOp, string>> = {
  linear: "Linear",
  bezier: "Bezier",
  "auto-bezier": "Auto Bezier",
  "continuous-bezier": "Continuous Bezier",
  hold: "Hold",
  "ease-in": "Ease In",
  "ease-out": "Ease Out",
};
export const KEYFRAME_INTERPOLATION_SIDE_LABELS: Readonly<Record<KeyframeInterpolationSide, string>> = {
  both: "Both sides",
  in: "In only",
  out: "Out only",
};

type Side = "in" | "out";
type SmoothTag = NonNullable<Keyframe["interpolationIn"]>;
const THIRD = 1 / 3;
const EPS = 1e-9;
const NONE: ReadonlySet<string> = new Set();
type NumKey = Keyframe & { value: number };
const isNum = (key: Keyframe): key is NumKey => typeof key.value === "number" && Number.isFinite(key.value);
const sideId = (id: string, side: Side) => `${id}:${side}`;
const tagField = (side: Side) => (side === "in" ? "interpolationIn" : "interpolationOut") as "interpolationIn" | "interpolationOut";
const samePoint = (a: BezierHandlePoint, b: BezierHandlePoint) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Value-per-second slope leaving a segment's start (P1) and arriving at its end (P2). */
export function segmentTangents(a: NumKey, b: NumKey, h: BezierHandles): { out: number; in: number } {
  const dt = b.time - a.time;
  const dv = b.value - a.value;
  const xo = Math.max(h.in.x, EPS);
  const xi = Math.max(1 - h.out.x, EPS);
  return { out: (h.in.y * dv) / (xo * dt), in: ((1 - h.out.y) * dv) / (xi * dt) };
}

type KeyMap = Map<string, Keyframe>;
type Order = readonly string[];

function groups(keys: readonly Keyframe[]): Order[] {
  const byProp = new Map<string, Keyframe[]>();
  for (const key of keys) byProp.set(key.property, [...(byProp.get(key.property) ?? []), key]);
  return [...byProp.values()].map(list => [...list].sort((a, b) => a.time - b.time).map(k => k.id));
}
const rebuild = (keys: readonly Keyframe[], m: KeyMap) => keys.map(k => m.get(k.id) ?? k);

function setTagField(key: Keyframe, field: "interpolationIn" | "interpolationOut", tag: SmoothTag | undefined): Keyframe {
  if (tag) return { ...key, [field]: tag };
  if (key[field] === undefined) return key;
  const next = { ...key } as Record<string, unknown>;
  delete next[field];
  return next as unknown as Keyframe;
}
/** Clearing one side of a Continuous pair unlinks both (a single continuous side has no meaning). */
function clearTag(m: KeyMap, id: string, side: Side): void {
  const key = m.get(id) as Keyframe;
  const other = tagField(side === "in" ? "out" : "in");
  let next = setTagField(key, tagField(side), undefined);
  if (key[tagField(side)] === "continuous-bezier" && next[other] === "continuous-bezier") next = setTagField(next, other, undefined);
  m.set(id, next);
}

/** Handles owned by a side: out side = P1 of the segment starting here; in side = P2 of the segment ending here. */
function segmentFor(order: Order, pos: number, side: Side): { segId: string; endId: string } | null {
  if (side === "out") return pos < order.length - 1 ? { segId: order[pos], endId: order[pos + 1] } : null;
  return pos > 0 ? { segId: order[pos - 1], endId: order[pos] } : null;
}
function handlesOf(m: KeyMap, segId: string): BezierHandles {
  return effectiveBezierHandles(m.get(segId) as Keyframe) ?? LINEAR_BEZIER_HANDLES;
}
function writePoint(m: KeyMap, segId: string, side: Side, point: BezierHandlePoint): void {
  const key = m.get(segId) as Keyframe;
  const h = handlesOf(m, segId);
  const handles = clampBezierHandles(side === "out" ? { in: point, out: h.out } : { in: h.in, out: point });
  m.set(segId, { ...key, easing: "bezier", bezierHandles: handles });
}
/** A segment whose two handles are exactly the identity curve is stored as plain linear. */
function normalizeLinear(m: KeyMap, segId: string): void {
  const key = m.get(segId) as Keyframe;
  if (key.easing !== "bezier" || !key.bezierHandles) return;
  const h = clampBezierHandles(key.bezierHandles);
  if (samePoint(h.in, LINEAR_BEZIER_HANDLES.in) && samePoint(h.out, LINEAR_BEZIER_HANDLES.out)) {
    const next = { ...key, easing: "linear" } as Record<string, unknown>;
    delete next.bezierHandles;
    m.set(segId, next as unknown as Keyframe);
  }
}
function makeHold(m: KeyMap, segId: string): void {
  const next = { ...(m.get(segId) as Keyframe), easing: "hold" } as Record<string, unknown>;
  delete next.bezierHandles;
  m.set(segId, next as unknown as Keyframe);
}
/** Smooth tangent at index k: Catmull-Rom slope, flat at ends and at local extrema (no overshoot). */
function autoTangent(keys: NumKey[], k: number): number {
  const prev = keys[k - 1];
  const next = keys[k + 1];
  if (!prev || !next) return 0;
  const d0 = keys[k].value - prev.value;
  const d1 = next.value - keys[k].value;
  if (d0 * d1 <= 0) return 0;
  const span = next.time - prev.time;
  return span > EPS ? (next.value - prev.value) / span : 0;
}

/** Slope of the side's own handle, in value units per second; undefined when the segment can't carry one. */
function readSlope(m: KeyMap, num: NumKey[], pos: number, side: Side): number | undefined {
  const seg = segmentFor(num.map(k => k.id), pos, side);
  if (!seg) return undefined;
  const a = m.get(seg.segId) as NumKey, b = m.get(seg.endId) as NumKey;
  if (a.easing === "hold" || !(b.time > a.time)) return undefined;
  const t = segmentTangents(a, b, handlesOf(m, seg.segId));
  return side === "out" ? t.out : t.in;
}
/** Points the side's own handle at `slope`, preserving its time influence unless `influence` is given. */
function writeSlope(m: KeyMap, num: NumKey[], pos: number, side: Side, slope: number, protect: ReadonlySet<string>): void {
  const seg = segmentFor(num.map(k => k.id), pos, side);
  if (!seg || protect.has(sideId(num[pos].id, side))) return;
  const a = m.get(seg.segId) as NumKey, b = m.get(seg.endId) as NumKey;
  if (a.easing === "hold" || !(b.time > a.time) || !Number.isFinite(slope)) return;
  const h = handlesOf(m, seg.segId);
  const dv = b.value - a.value;
  const dt = b.time - a.time;
  if (side === "out") {
    const x = h.in.x > EPS ? h.in.x : THIRD;
    writePoint(m, seg.segId, "out", { x, y: Math.abs(dv) > EPS ? (slope * x * dt) / dv : 0 });
  } else {
    const xi = 1 - h.out.x > EPS ? 1 - h.out.x : THIRD;
    writePoint(m, seg.segId, "in", { x: 1 - xi, y: Math.abs(dv) > EPS ? 1 - (slope * xi * dt) / dv : 1 });
  }
}

/**
 * Re-derives smooth sides: Auto sides always follow their neighbours; a Continuous key (both sides
 * tagged) mirrors the side in `edited` onto the other, or averages both when neither was edited.
 * Sides in `protect` are never rewritten. Keys without tags are never touched.
 */
export function refreshSmoothKeyframes(
  keyframes: readonly Keyframe[],
  edited: ReadonlySet<string> = NONE,
  protect: ReadonlySet<string> = NONE,
): Keyframe[] {
  if (!keyframes.some(k => k.interpolationIn || k.interpolationOut)) return [...keyframes];
  const m: KeyMap = new Map(keyframes.map(k => [k.id, k]));
  for (const order of groups(keyframes)) {
    const ordered = order.map(id => m.get(id) as Keyframe);
    if (!ordered.some(k => k.interpolationIn || k.interpolationOut)) continue;
    if (!ordered.every(isNum)) continue;
    const num = ordered as NumKey[];
    for (let pos = 0; pos < num.length; pos++) {
      const key = m.get(num[pos].id) as Keyframe;
      const tin = key.interpolationIn, tout = key.interpolationOut;
      if (tout === "auto-bezier") writeSlope(m, num, pos, "out", autoTangent(num, pos), protect);
      if (tin === "auto-bezier") writeSlope(m, num, pos, "in", autoTangent(num, pos), protect);
      if (tin === "continuous-bezier" && tout === "continuous-bezier") {
        const outSlope = readSlope(m, num, pos, "out");
        const inSlope = readSlope(m, num, pos, "in");
        const outEdited = edited.has(sideId(key.id, "out")) && outSlope !== undefined;
        const inEdited = edited.has(sideId(key.id, "in")) && inSlope !== undefined;
        if (outEdited && !inEdited) writeSlope(m, num, pos, "in", outSlope as number, protect);
        else if (inEdited && !outEdited) writeSlope(m, num, pos, "out", inSlope as number, protect);
        else if (!outEdited && !inEdited && (outSlope !== undefined || inSlope !== undefined)) {
          const o = (outSlope ?? inSlope) as number;
          const i = (inSlope ?? outSlope) as number;
          const slope = (o + i) / 2;
          writeSlope(m, num, pos, "out", slope, protect);
          writeSlope(m, num, pos, "in", slope, protect);
        }
      }
    }
  }
  return rebuild(keyframes, m);
}

/** Apply a temporal interpolation mode to one or both sides of the selected keyframes. Pure. */
export function applyKeyframeInterpolation(
  keyframes: readonly Keyframe[],
  ids: readonly string[],
  op: KeyframeInterpolationOp,
  side: KeyframeInterpolationSide = "both",
): Keyframe[] {
  const selected = new Set(ids);
  const m: KeyMap = new Map(keyframes.map(k => [k.id, k]));
  const touched = new Set<string>();
  const smooth = op === "auto-bezier" || op === "continuous-bezier";
  for (const order of groups(keyframes)) {
    order.forEach((id, pos) => {
      if (!selected.has(id)) return;
      const key = m.get(id) as Keyframe;
      // Hold is outgoing by definition; Ease In / Ease Out name their own side; Continuous links both.
      let sides: Side[] = side === "both" ? ["in", "out"] : [side];
      if (op === "hold" && side === "both") sides = ["out"];
      if (op === "ease-out") sides = side === "in" ? [] : ["out"];
      if (op === "ease-in") sides = side === "out" ? [] : ["in"];
      if (op === "continuous-bezier") sides = ["in", "out"];
      for (const s of sides) {
        const seg = segmentFor(order, pos, s);
        if (smooth) {
          if (isNum(key)) m.set(id, setTagField(m.get(id) as Keyframe, tagField(s), op));
          if (seg && (m.get(seg.segId) as Keyframe).easing === "hold") writePoint(m, seg.segId, s, s === "out" ? LINEAR_BEZIER_HANDLES.in : LINEAR_BEZIER_HANDLES.out);
          continue;
        }
        if (!seg) {
          if (op === "hold" && s === "out") m.set(id, { ...(m.get(id) as Keyframe), easing: "hold" });
          clearTag(m, id, s);
          continue;
        }
        touched.add(sideId(id, s));
        clearTag(m, id, s);
        const h = handlesOf(m, seg.segId);
        const numeric = isNum(m.get(seg.segId) as Keyframe);
        switch (op) {
          case "hold":
            makeHold(m, seg.segId);
            clearTag(m, seg.endId, "in");
            touched.add(sideId(seg.endId, "in"));
            break;
          case "linear":
            writePoint(m, seg.segId, s, s === "out" ? LINEAR_BEZIER_HANDLES.in : LINEAR_BEZIER_HANDLES.out);
            normalizeLinear(m, seg.segId);
            break;
          case "bezier":
            if (numeric) writePoint(m, seg.segId, s, s === "out" ? h.in : h.out);
            else m.set(seg.segId, { ...(m.get(seg.segId) as Keyframe), easing: "bezier" });
            break;
          case "ease-out":
            if (numeric) writePoint(m, seg.segId, "out", { x: THIRD, y: 0 });
            break;
          case "ease-in":
            if (numeric) writePoint(m, seg.segId, "in", { x: 1 - THIRD, y: 1 });
            break;
        }
      }
    });
  }
  // Explicit modes own the sides they touched; neighbouring smooth sides must not undo them.
  return refreshSmoothKeyframes(rebuild(keyframes, m), NONE, smooth ? NONE : touched);
}

/**
 * Re-derives smooth sides after any keyframe list change (time/value edits, add, delete, paste,
 * handle drags, presets). Sides whose handle differs from `prior` were set explicitly: they are
 * protected from re-derivation. Dragging one handle of an Auto side converts it to plain Bezier
 * (as Premiere does); Continuous keeps its link and mirrors the opposite handle; replacing a
 * whole segment (a preset, an easing change) unlinks Continuous too.
 */
export function refreshSmoothKeyframesAfterEdit(
  prior: readonly Keyframe[] | undefined,
  next: readonly Keyframe[],
): Keyframe[] {
  if (!next.some(k => k.interpolationIn || k.interpolationOut)) return [...next];
  const before = new Map((prior ?? []).map(k => [k.id, k]));
  const m: KeyMap = new Map(next.map(k => [k.id, k]));
  const edited = new Set<string>();
  for (const order of groups(next)) {
    order.forEach((id, pos) => {
      const old = before.get(id);
      const now = m.get(id) as Keyframe;
      const nextId = order[pos + 1];
      if (!old || !nextId) return;
      const oh = effectiveBezierHandles(old), nh = effectiveBezierHandles(now);
      let p1 = false, p2 = false;
      if (oh && nh) { p1 = !samePoint(oh.in, nh.in); p2 = !samePoint(oh.out, nh.out); }
      else if (oh !== nh || old.easing !== now.easing) { p1 = true; p2 = true; }
      if (p1) edited.add(sideId(id, "out"));
      if (p2) edited.add(sideId(nextId, "in"));
      if (p1 && p2) { clearTag(m, id, "out"); clearTag(m, nextId, "in"); }
      else {
        if (p1 && m.get(id)?.interpolationOut === "auto-bezier") clearTag(m, id, "out");
        if (p2 && m.get(nextId)?.interpolationIn === "auto-bezier") clearTag(m, nextId, "in");
      }
    });
  }
  return refreshSmoothKeyframes(rebuild(next, m), edited, edited);
}

export type KeyframeSideType = KeyframeInterpolationOp | Keyframe["easing"];

/**
 * The interpolation type each side of `key` currently has. `previous` is the earlier key of the
 * same property (its easing/handles describe the incoming side). Smooth tags win while their
 * segment is still a curve; a Hold segment always reads Hold on both of its ends.
 */
export function keyframeSideTypes(previous: Keyframe | undefined, key: Keyframe, hasNext = true): { in?: KeyframeSideType; out?: KeyframeSideType } {
  const describe = (seg: Keyframe, tag: SmoothTag | undefined): KeyframeSideType => {
    if (seg.easing === "hold") return "hold";
    if (tag) return tag;
    if (seg.easing === "bezier") return "bezier";
    return seg.easing;
  };
  return {
    in: previous ? describe(previous, key.interpolationIn) : undefined,
    out: hasNext ? describe(key, key.interpolationOut) : undefined,
  };
}
