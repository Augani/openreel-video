import { describe, expect, it } from "vitest";
import {
  isPointInShapePath,
  type PathSegment,
  type ShapeClip,
} from "@openreel/core";
import { renderShapeClipToCanvas } from "./canvas-renderers";

/** Records the path in device space (translate/scale only) for hit testing. */
function recordingContext() {
  let tx = 0;
  let ty = 0;
  let sx = 1;
  let sy = 1;
  let segs: PathSegment[] = [];
  const p = (x: number, y: number): [number, number] => [tx + x * sx, ty + y * sy];
  const filled: PathSegment[][] = [];
  const ctx = {
    save() {},
    restore() {},
    translate(x: number, y: number) { tx += x * sx; ty += y * sy; },
    scale(x: number, y: number) { sx *= x; sy *= y; },
    rotate() {},
    setLineDash() {},
    beginPath() { segs = []; },
    moveTo(x: number, y: number) { const [a, b] = p(x, y); segs.push({ type: "M", x: a, y: b }); },
    lineTo(x: number, y: number) { const [a, b] = p(x, y); segs.push({ type: "L", x: a, y: b }); },
    bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
      const [a1, b1] = p(x1, y1);
      const [a2, b2] = p(x2, y2);
      const [a, b] = p(x, y);
      segs.push({ type: "C", x1: a1, y1: b1, x2: a2, y2: b2, x: a, y: b });
    },
    quadraticCurveTo(x1: number, y1: number, x: number, y: number) {
      const [a1, b1] = p(x1, y1);
      const [a, b] = p(x, y);
      segs.push({ type: "Q", x1: a1, y1: b1, x: a, y: b });
    },
    closePath() { segs.push({ type: "Z" }); },
    rect() { throw new Error("path shape must not fall back to a square"); },
    fill() { filled.push([...segs]); },
    stroke() {},
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled };
}

function pathClip(extra: Partial<ShapeClip>): ShapeClip {
  return {
    id: "p1",
    type: "shape",
    shapeType: "path",
    trackId: "t",
    startTime: 0,
    duration: 1,
    style: {
      fill: { type: "solid", color: "#f00", opacity: 1 },
      stroke: { color: "#000", width: 0, opacity: 1 },
    },
    transform: {
      position: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
      anchor: { x: 0.5, y: 0.5 },
    },
    keyframes: [],
    ...extra,
  } as unknown as ShapeClip;
}

describe("preview path shape rendering", () => {
  // 400x400 canvas: shape box is 15% = 60px centered at (200,200).
  it("fills inside a triangular path and not the square corners", () => {
    const { ctx, filled } = recordingContext();
    renderShapeClipToCanvas(ctx, pathClip({ pathData: "M50 0 L100 100 L0 100 Z" }), 400, 400, 0);
    expect(filled).toHaveLength(1);
    const segs = filled[0];
    expect(isPointInShapePath(segs, 200, 220)).toBe(true);
    expect(isPointInShapePath(segs, 172, 172)).toBe(false);
    expect(isPointInShapePath(segs, 228, 172)).toBe(false);
  });

  it("draws a point-list path from normalized coordinates", () => {
    const { ctx, filled } = recordingContext();
    renderShapeClipToCanvas(
      ctx,
      pathClip({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], closed: true }),
      400,
      400,
      0,
    );
    const segs = filled[0];
    expect(isPointInShapePath(segs, 180, 180)).toBe(true);
    expect(isPointInShapePath(segs, 225, 225)).toBe(false);
  });
});
