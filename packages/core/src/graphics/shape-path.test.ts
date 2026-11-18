import { describe, it, expect, vi } from "vitest";
import {
  flattenShapePath,
  getShapePathBounds,
  isPointInShapePath,
  parseShapeSvgPath,
  resolveShapePath,
  type PathSegment,
} from "./shape-path";
import { GraphicsEngine } from "./graphics-engine";

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * Minimal software Canvas2D: tracks transforms, records the current path in
 * device space and fills/strokes it into an RGBA buffer, so tests assert on
 * real pixels rather than on mock calls.
 */
class RasterContext {
  readonly pixels: Uint8Array;
  globalAlpha = 1;
  fillStyle: string | object = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  lineDashOffset = 0;
  shadowColor = "";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  globalCompositeOperation = "source-over";
  private m: Matrix = [1, 0, 0, 1, 0, 0];
  private stack: Matrix[] = [];
  private segs: PathSegment[] = [];
  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8Array(width * height * 4);
  }
  save() { this.stack.push([...this.m] as Matrix); }
  restore() { const m = this.stack.pop(); if (m) this.m = m; }
  translate(x: number, y: number) { this.m = mul(this.m, [1, 0, 0, 1, x, y]); }
  scale(x: number, y: number) { this.m = mul(this.m, [x, 0, 0, y, 0, 0]); }
  rotate(a: number) { this.m = mul(this.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); }
  private p(x: number, y: number): [number, number] {
    return [this.m[0] * x + this.m[2] * y + this.m[4], this.m[1] * x + this.m[3] * y + this.m[5]];
  }
  beginPath() { this.segs = []; }
  moveTo(x: number, y: number) { const [a, b] = this.p(x, y); this.segs.push({ type: "M", x: a, y: b }); }
  lineTo(x: number, y: number) { const [a, b] = this.p(x, y); this.segs.push({ type: "L", x: a, y: b }); }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    const [a1, b1] = this.p(x1, y1); const [a2, b2] = this.p(x2, y2); const [a, b] = this.p(x, y);
    this.segs.push({ type: "C", x1: a1, y1: b1, x2: a2, y2: b2, x: a, y: b });
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number) {
    const [a1, b1] = this.p(x1, y1); const [a, b] = this.p(x, y);
    this.segs.push({ type: "Q", x1: a1, y1: b1, x: a, y: b });
  }
  closePath() { this.segs.push({ type: "Z" }); }
  setLineDash = vi.fn();
  createLinearGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  createRadialGradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  fill() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (isPointInShapePath(this.segs, x + 0.5, y + 0.5)) this.pixels[(y * this.width + x) * 4 + 3] = 255;
      }
    }
  }
  stroke() {
    const half = this.lineWidth / 2;
    for (const sub of flattenShapePath(this.segs)) {
      const pts = sub.closed ? [...sub.points, sub.points[0]] : sub.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const steps = Math.ceil(len * 2);
        for (let s = 0; s <= steps; s++) {
          const px = x1 + ((x2 - x1) * s) / steps; const py = y1 + ((y2 - y1) * s) / steps;
          for (let dy = -Math.ceil(half); dy <= Math.ceil(half); dy++) {
            for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
              const ix = Math.floor(px) + dx; const iy = Math.floor(py) + dy;
              if (ix >= 0 && iy >= 0 && ix < this.width && iy < this.height) this.pixels[(iy * this.width + ix) * 4 + 3] = 255;
            }
          }
        }
      }
    }
  }
  filled(x: number, y: number) { return this.pixels[(Math.floor(y) * this.width + Math.floor(x)) * 4 + 3] === 255; }
}

describe("parseShapeSvgPath", () => {
  it("parses absolute and relative lines with implicit lineto", () => {
    expect(parseShapeSvgPath("M10 10 20 10 l0 10 z")).toEqual([
      { type: "M", x: 10, y: 10 },
      { type: "L", x: 20, y: 10 },
      { type: "L", x: 20, y: 20 },
      { type: "Z" },
    ]);
  });
  it("handles H/V, curves, smooth curves and compact numbers", () => {
    const segs = parseShapeSvgPath("M0,0H10V5C10,8 5,8 0,5S-5,0 0,0Q1-1 2,0T4,0Z");
    expect(segs.map((s) => s.type)).toEqual(["M", "L", "L", "C", "C", "Q", "Q", "Z"]);
    const smooth = segs[4];
    // S reflects the previous cubic's second control point (5,8) about (0,5).
    expect(smooth).toMatchObject({ type: "C", x1: -5, y1: 2 });
  });
  it("converts arcs to cubic curves ending at the target point", () => {
    const segs = parseShapeSvgPath("M0 0 A10 10 0 0 1 20 0");
    const last = segs[segs.length - 1];
    expect(last.type).toBe("C");
    expect(last).toMatchObject({ x: 20, y: 0 });
    const b = getShapePathBounds(segs)!;
    // sweep=1 is clockwise in y-down space: the semicircle bulges up by its radius.
    expect(b.minY).toBeCloseTo(-10, 1);
    expect(b.maxY).toBeCloseTo(0, 1);
  });
  it("rejects malformed data", () => {
    expect(parseShapeSvgPath("")).toEqual([]);
    expect(parseShapeSvgPath("L10 10")).toEqual([]);
    expect(parseShapeSvgPath("M10")).toEqual([]);
    expect(parseShapeSvgPath("M10 10 X5 5")).toEqual([]);
  });
});

describe("resolveShapePath", () => {
  it("prefers pathData, adds Z when closed, and falls back to points", () => {
    expect(resolveShapePath({ pathData: "M0 0 L1 0 L1 1", closed: true }).at(-1)).toEqual({ type: "Z" });
    expect(resolveShapePath({ pathData: "M0 0 L1 0 L1 1" }).at(-1)).not.toEqual({ type: "Z" });
    const fromPoints = resolveShapePath({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: true });
    expect(fromPoints).toHaveLength(4);
    expect(resolveShapePath({})).toEqual([]);
  });
});

describe("path shape rendering", () => {
  const W = 400;
  const H = 400;
  function render(
    params: Parameters<GraphicsEngine["createShape"]>[0],
  ): Promise<RasterContext> {
    const ctx = new RasterContext(W, H);
    class FakeCanvas {
      getContext() { return ctx; }
    }
    vi.stubGlobal("OffscreenCanvas", FakeCanvas);
    vi.stubGlobal("HTMLCanvasElement", class {});
    const engine = new GraphicsEngine();
    const clip = engine.createShape(params, "t", 0, 1);
    return engine.renderGraphic(clip, 0, W, H).then(() => ctx);
  }

  // Shape box is 15% of min(W,H) = 60px, centered on the canvas position.
  it("fills the inside of a closed SVG path and leaves the outside empty", async () => {
    const ctx = await render({
      shapeType: "path",
      width: 100,
      height: 100,
      pathData: "M0 0 L100 0 L100 100 L0 100 Z",
      style: { stroke: { color: "#000", width: 0, opacity: 1 } },
    });
    const cx = W / 2; const cy = H / 2;
    expect(ctx.filled(cx, cy)).toBe(true);
    expect(ctx.filled(cx + 25, cy - 25)).toBe(true);
    expect(ctx.filled(cx + 45, cy)).toBe(false);
    expect(ctx.filled(5, 5)).toBe(false);
  });

  it("fills curved paths (heart-like cubic shape) at the centre", async () => {
    const ctx = await render({
      shapeType: "path",
      width: 100,
      height: 100,
      pathData: "M50 90 C0 50 10 10 50 35 C90 10 100 50 50 90 Z",
      style: { stroke: { color: "#000", width: 0, opacity: 1 } },
    });
    expect(ctx.filled(W / 2, H / 2)).toBe(true);
    expect(ctx.filled(W / 2 - 28, H / 2 - 28)).toBe(false);
  });

  it("draws a point-list path as a filled closed triangle", async () => {
    const ctx = await render({
      shapeType: "path",
      width: 100,
      height: 100,
      points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      closed: true,
      style: { stroke: { color: "#000", width: 0, opacity: 1 } },
    });
    expect(ctx.filled(W / 2, H / 2 + 15)).toBe(true);
    expect(ctx.filled(W / 2 - 25, H / 2 - 25)).toBe(false);
  });

  it("strokes an open path without filling empty space beside it", async () => {
    const ctx = await render({
      shapeType: "path",
      width: 100,
      height: 100,
      pathData: "M0 50 L100 50",
      style: { fill: { type: "none", opacity: 1 }, stroke: { color: "#f00", width: 4, opacity: 1 } },
    });
    expect(ctx.filled(W / 2, H / 2)).toBe(true);
    expect(ctx.filled(W / 2, H / 2 + 20)).toBe(false);
  });

  it("draws nothing for invalid path data", async () => {
    const ctx = await render({
      shapeType: "path",
      width: 100,
      height: 100,
      pathData: "not a path",
      style: { stroke: { color: "#000", width: 0, opacity: 1 } },
    });
    expect(ctx.pixels.every((v) => v === 0)).toBe(true);
  });
});

describe("parseShapeSvgPath arc flags and post-close commands", () => {
  it("parses arc flags written without separators", () => {
    const segs = parseShapeSvgPath("M0 0a1 1 0 011 1");
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[segs.length - 1]).toMatchObject({ type: "C", x: 1, y: 1 });
    const packed = parseShapeSvgPath("M0 0A5 5 0 1010 0");
    expect(packed[packed.length - 1]).toMatchObject({ x: 10, y: 0 });
  });
  it("rejects arc flags other than 0 or 1", () => {
    expect(parseShapeSvgPath("M0 0a1 1 0 21 1 1")).toEqual([]);
  });
  it("starts a new implicit subpath at the start point after Z", () => {
    const segs = parseShapeSvgPath("M10 10 L20 10 L20 20 Z L30 30");
    const subs = flattenShapePath(segs);
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].points[0]).toEqual([10, 10]);
    expect(subs[1].points[1]).toEqual([30, 30]);
    expect(getShapePathBounds(segs)!.maxX).toBe(30);
  });
});
