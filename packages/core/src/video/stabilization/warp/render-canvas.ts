import { applyMat3, rowDelta, rowMatrix, type Mat3, type RowDelta, type WarpPlan } from "./plan";

/**
 * The stabilizing warp drawn on a canvas, the one renderer the program monitor and the export both call, so a
 * preview frame is the exported frame. It draws the same per-row matrices `render-cpu.ts` defines:
 * one affine draw when the camera correction is the same for every row, thin strips when rolling shutter makes
 * it row dependent, and a triangle mesh when the perspective terms are on.
 */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawLayer {
  readonly source: CanvasImageSource;
  /** The frame this picture was captured as (its own index), against `shown`, the frame being displayed. */
  readonly captured: number;
}

const SCRATCH: RowDelta = { dx: 0, dy: 0, rotation: 0, logScale: 0, px: 0, py: 0 };

const matrixOf = (plan: WarpPlan, shown: number, captured: number, v: number, w: number, h: number): Mat3 =>
  rowMatrix(plan, rowDelta(plan, shown, captured, v, SCRATCH), w, h, plan.zoom);

function setAffine(ctx: Canvas2D, m: Mat3): void {
  ctx.setTransform(m[0], m[3], m[1], m[4], m[2], m[5]);
}

function drawStrips(ctx: Canvas2D, layer: DrawLayer, plan: WarpPlan, shown: number, w: number, h: number): void {
  const strip = Math.max(1, Math.round(h / 270));
  for (let y = 0; y < h; y += strip) {
    const end = Math.min(h, y + strip);
    const m = matrixOf(plan, shown, layer.captured, (y + end) / 2 / h, w, h);
    setAffine(ctx, m);
    // one pixel of overlap hides the antialiased seam between neighbouring strips
    const height = Math.min(end - y + 1, h - y);
    ctx.drawImage(layer.source, 0, y, w, height, 0, y, w, height);
  }
}

type Pt = [number, number];

/** Affine mapping the triangle `s` onto `d` (setTransform order a, b, c, d, e, f), or null for a degenerate one. */
function triangleAffine(s: [Pt, Pt, Pt], d: [Pt, Pt, Pt]): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (u0: number, u1: number, u2: number): [number, number, number] => [
    (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / det,
    (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / det,
    (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / det,
  ];
  const [a, c, e] = solve(d[0][0], d[1][0], d[2][0]);
  const [b, dd, f] = solve(d[0][1], d[1][1], d[2][1]);
  return [a, b, c, dd, e, f];
}

function drawMesh(ctx: Canvas2D, layer: DrawLayer, plan: WarpPlan, shown: number, w: number, h: number): void {
  const cols = 8;
  const rows = plan.readout > 0 ? 24 : 8;
  const grid: Pt[][] = [];
  for (let j = 0; j <= rows; j++) {
    const line: Pt[] = [];
    const v = j / rows;
    const m = matrixOf(plan, shown, layer.captured, v, w, h);
    for (let i = 0; i <= cols; i++) line.push(applyMat3(m, (i / cols) * w, v * h));
    grid.push(line);
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const sx0 = (i / cols) * w;
      const sx1 = ((i + 1) / cols) * w;
      const sy0 = (j / rows) * h;
      const sy1 = ((j + 1) / rows) * h;
      const quad: Array<[[Pt, Pt, Pt], [Pt, Pt, Pt]]> = [
        [[[sx0, sy0], [sx1, sy0], [sx0, sy1]], [grid[j][i], grid[j][i + 1], grid[j + 1][i]]],
        [[[sx1, sy0], [sx1, sy1], [sx0, sy1]], [grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]],
      ];
      for (const [s, d] of quad) {
        const affine = triangleAffine(s, d);
        if (!affine) continue;
        const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
        const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
        ctx.save();
        ctx.beginPath();
        d.forEach(([x, y], k) => {
          // grown by a pixel so neighbouring triangles overlap instead of leaving a seam
          const dx = x - cx;
          const dy = y - cy;
          const len = Math.hypot(dx, dy) || 1;
          const px = x + (dx / len) * 0.8;
          const py = y + (dy / len) * 0.8;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(affine[0], affine[1], affine[2], affine[3], affine[4], affine[5]);
        const bx = Math.max(0, Math.min(s[0][0], s[1][0], s[2][0]) - 1);
        const by = Math.max(0, Math.min(s[0][1], s[1][1], s[2][1]) - 1);
        const ex = Math.min(w, Math.max(s[0][0], s[1][0], s[2][0]) + 1);
        const ey = Math.min(h, Math.max(s[0][1], s[1][1], s[2][1]) + 1);
        ctx.drawImage(layer.source, bx, by, ex - bx, ey - by, bx, by, ex - bx, ey - by);
        ctx.restore();
      }
    }
  }
}

function drawLayer(ctx: Canvas2D, layer: DrawLayer, plan: WarpPlan, shown: number, w: number, h: number): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (plan.settings.method === "perspective") drawMesh(ctx, layer, plan, shown, w, h);
  else if (plan.readout > 0) drawStrips(ctx, layer, plan, shown, w, h);
  else {
    setAffine(ctx, matrixOf(plan, shown, layer.captured, 0.5, w, h));
    ctx.drawImage(layer.source, 0, 0, w, h);
  }
  ctx.restore();
}

/**
 * Draw frame `shown` of the plan into `ctx` (a w x h canvas). `layers` are the pictures to draw, farthest first and
 * the frame itself last; the crop framing empties everything outside the crop rectangle afterwards.
 */
export function drawStabilized(ctx: Canvas2D, layers: readonly DrawLayer[], plan: WarpPlan, shown: number, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  for (const layer of layers) drawLayer(ctx, layer, plan, shown, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (plan.cropFraction < 1) {
    const x0 = (w * (1 - plan.cropFraction)) / 2;
    const y0 = (h * (1 - plan.cropFraction)) / 2;
    ctx.clearRect(0, 0, w, y0);
    ctx.clearRect(0, h - y0, w, y0);
    ctx.clearRect(0, y0, x0, h - 2 * y0);
    ctx.clearRect(w - x0, y0, x0, h - 2 * y0);
  }
}
