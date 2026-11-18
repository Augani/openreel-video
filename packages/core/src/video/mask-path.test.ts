import { describe, expect, it, vi } from "vitest";
import type { BezierPath, Mask } from "./mask-engine";
import { MaskEngine } from "./mask-engine";
import {
  deletePoint,
  editMaskPathAtTime,
  editMaskStructure,
  flattenPath,
  insertPoint,
  isCornerPoint,
  isSmoothPoint,
  makeCorner,
  makeSmooth,
  maskPathAtTime,
  moveHandle,
  movePoint,
  nearestOnPath,
  pathArea,
  pathContains,
  penAddPoint,
  penDragHandle,
  penToPath,
  removeMaskKeyframeAt,
  segmentPoint,
  toggleSmooth,
  translatePath,
  upsertMaskKeyframe,
} from "./mask-path";

const square: BezierPath = {
  closed: true,
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ],
};

const mask = (path: BezierPath): Mask => ({
  id: "m",
  clipId: "c",
  type: "drawn",
  path,
  feathering: 0,
  expansion: 0,
  opacity: 1,
  inverted: false,
  keyframes: [],
});

let ids = 0;
const nextId = (): string => `k${++ids}`;

describe("mask path geometry", () => {
  it("a handle-free polygon has straight edges and exact area", () => {
    expect(pathArea(square)).toBeCloseTo(0.36, 6);
    expect(pathContains(square, { x: 0.5, y: 0.5 })).toBe(true);
    expect(pathContains(square, { x: 0.1, y: 0.5 })).toBe(false);
    expect(segmentPoint(square, 0, 0.5)).toEqual({ x: 0.5, y: 0.2 });
  });

  it("smooth vertices bulge the outline beyond the straight chord", () => {
    let p = makeSmooth(square, 0);
    p = makeSmooth(p, 1);
    expect(isSmoothPoint(p.points[0])).toBe(true);
    expect(isCornerPoint(p.points[2])).toBe(true);
    expect(pathArea(p)).not.toBeCloseTo(pathArea(square), 3);
    expect(toggleSmooth(p, 0).points[0].handleIn).toBeUndefined();
    expect(isSmoothPoint(toggleSmooth(square, 3).points[3])).toBe(true);
    expect(makeCorner(p, 1).points[1].handleOut).toBeUndefined();
  });

  it("moving a vertex carries its handles and leaves the other points alone", () => {
    const smooth = makeSmooth(square, 2);
    const moved = movePoint(smooth, 2, { x: 0.9, y: 0.9 });
    expect(moved.points[2]).toMatchObject({ x: 0.9, y: 0.9 });
    const dx = moved.points[2].handleOut!.x - moved.points[2].x;
    const dy = moved.points[2].handleOut!.y - moved.points[2].y;
    expect(dx).toBeCloseTo(smooth.points[2].handleOut!.x - 0.8, 9);
    expect(dy).toBeCloseTo(smooth.points[2].handleOut!.y - 0.8, 9);
    expect(moved.points[0]).toEqual(smooth.points[0]);
  });

  it("a smooth point keeps its handles collinear; independent drags make a cusp", () => {
    const smooth = makeSmooth(square, 1);
    const keep = moveHandle(smooth, 1, "out", { x: 0.95, y: 0.4 });
    expect(isSmoothPoint(keep.points[1])).toBe(true);
    const oldLen = Math.hypot(
      smooth.points[1].handleIn!.x - 0.8,
      smooth.points[1].handleIn!.y - 0.2,
    );
    const newLen = Math.hypot(keep.points[1].handleIn!.x - 0.8, keep.points[1].handleIn!.y - 0.2);
    expect(newLen).toBeCloseTo(oldLen, 9);
    const cusp = moveHandle(smooth, 1, "out", { x: 0.95, y: 0.4 }, true);
    expect(isSmoothPoint(cusp.points[1])).toBe(false);
    expect(cusp.points[1].handleIn).toEqual(smooth.points[1].handleIn);
  });

  it("insertPoint preserves the outline and delete keeps at least three vertices", () => {
    const curvy = makeSmooth(makeSmooth(square, 0), 1);
    const before = flattenPath(curvy, 48);
    const after = insertPoint(curvy, 0, 0.37);
    expect(after.points).toHaveLength(5);
    expect(pathArea(after)).toBeCloseTo(pathArea(curvy), 3);
    const mid = after.points[1];
    expect(nearestOnPath(curvy, mid)!.distance).toBeLessThan(1e-3);
    expect(before.length).toBeGreaterThan(0);
    const straight = insertPoint(square, 1, 0.5);
    expect(straight.points[2]).toEqual({ x: 0.8, y: 0.5 });
    expect(straight.points[2].handleIn).toBeUndefined();
    expect(deletePoint(square, 0).points).toHaveLength(3);
    expect(deletePoint(deletePoint(square, 0), 0).points).toHaveLength(3);
  });

  it("nearestOnPath finds the segment and parameter under a point", () => {
    const hit = nearestOnPath(square, { x: 0.5, y: 0.12 })!;
    expect(hit.segment).toBe(0);
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.distance).toBeCloseTo(0.08, 3);
    expect(translatePath(square, 0.1, 0).points[0].x).toBeCloseTo(0.3, 9);
  });
});

describe("pen drawing", () => {
  it("click adds a corner; click-drag adds a smooth point with mirrored handles", () => {
    let pts = penAddPoint([], { x: 0.2, y: 0.2 });
    pts = penAddPoint(pts, { x: 0.5, y: 0.1 });
    pts = penDragHandle(pts, { x: 0.6, y: 0.1 });
    expect(pts[1].handleOut).toEqual({ x: 0.6, y: 0.1 });
    expect(pts[1].handleIn!.x).toBeCloseTo(0.4, 9);
    expect(isSmoothPoint(pts[1])).toBe(true);
    pts = penAddPoint(pts, { x: 0.7, y: 0.6 });
    pts = penDragHandle(pts, { x: 0.7, y: 0.6 });
    expect(isCornerPoint(pts[2])).toBe(true);
    expect(penToPath(pts)).not.toBeNull();
    expect(penToPath(pts.slice(0, 2))).toBeNull();
  });
});

describe("mask path keyframes", () => {
  it("interpolates the path between two keyframes (and matches the engine)", () => {
    let m = mask(square);
    m = upsertMaskKeyframe(m, 1, square, 0.01, nextId);
    m = upsertMaskKeyframe(m, 3, translatePath(square, 0.1, 0), 0.01, nextId);
    expect(m.keyframes.map((k) => k.time)).toEqual([1, 3]);
    const mid = maskPathAtTime(m, 2);
    expect(mid.points[0].x).toBeCloseTo(0.25, 9);
    expect(maskPathAtTime(m, 0).points[0].x).toBeCloseTo(0.2, 9);
    expect(maskPathAtTime(m, 9).points[0].x).toBeCloseTo(0.3, 9);
    vi.stubGlobal("OffscreenCanvas", class { constructor(public width: number, public height: number) {} getContext() { return {}; } });
    try {
      const engine = new MaskEngine({ width: 10, height: 10, useGPU: false });
      engine.loadMasks([m]);
      expect(engine.getMaskAtTime("m", 2)).toEqual(mid);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an edit on a keyframed mask writes a keyframe at the playhead; unkeyframed edits the base path", () => {
    const plain = editMaskPathAtTime(mask(square), 2, (p) => movePoint(p, 0, { x: 0.1, y: 0.1 }), 0.01, nextId);
    expect(plain.keyframes).toHaveLength(0);
    expect(plain.path.points[0]).toMatchObject({ x: 0.1, y: 0.1 });
    let m = upsertMaskKeyframe(mask(square), 0, square, 0.01, nextId);
    m = editMaskPathAtTime(m, 2, (p) => movePoint(p, 0, { x: 0.4, y: 0.4 }), 0.01, nextId);
    expect(m.keyframes.map((k) => k.time)).toEqual([0, 2]);
    expect(maskPathAtTime(m, 1).points[0].x).toBeCloseTo(0.3, 9);
    // editing at an existing keyframe time replaces it instead of duplicating
    m = editMaskPathAtTime(m, 2.004, (p) => movePoint(p, 0, { x: 0.5, y: 0.5 }), 0.01, nextId);
    expect(m.keyframes).toHaveLength(2);
    expect(m.keyframes[1].path.points[0].x).toBe(0.5);
    expect(removeMaskKeyframeAt(m, 2, 0.01).keyframes).toHaveLength(1);
  });

  it("structural edits apply to the base path and every keyframe so counts stay equal", () => {
    let m = upsertMaskKeyframe(mask(square), 0, square, 0.01, nextId);
    m = upsertMaskKeyframe(m, 2, translatePath(square, 0.1, 0), 0.01, nextId);
    const edited = editMaskStructure(m, (p) => insertPoint(p, 0, 0.5));
    expect(edited.path.points).toHaveLength(5);
    for (const k of edited.keyframes) expect(k.path.points).toHaveLength(5);
    expect(maskPathAtTime(edited, 1).points[1].x).toBeCloseTo(0.55, 9);
  });
});
