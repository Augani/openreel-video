import type { BezierPath, BezierPoint } from "../mask-engine";
import { flattenPath } from "../mask-path";
import { fillHoles, largestComponent } from "./raster-ops";
import type { RasterPoint } from "./types";

/**
 * Outer boundary of a hole-free binary mask as a closed loop of lattice corners (fg on the right of travel),
 * starting at the top-left fg pixel. Coordinates are pixel corners: 0..width, 0..height.
 */
export function traceOutline(mask: Uint8Array, width: number, height: number): RasterPoint[] {
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const fg = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] > 0;
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const x0 = start % width;
  const y0 = (start / width) | 0;
  const out: RasterPoint[] = [];
  let x = x0;
  let y = y0;
  let d = 0;
  const limit = (width + 1) * (height + 1) * 2 + 8;
  for (let step = 0; step < limit; step++) {
    out.push({ x, y });
    x += DX[d];
    y += DY[d];
    let left: boolean;
    let right: boolean;
    if (d === 0) (left = fg(x, y - 1)), (right = fg(x, y));
    else if (d === 1) (left = fg(x, y)), (right = fg(x - 1, y));
    else if (d === 2) (left = fg(x - 1, y)), (right = fg(x - 1, y - 1));
    else (left = fg(x - 1, y - 1)), (right = fg(x, y - 1));
    if (right && left) d = (d + 3) % 4;
    else if (!right) d = (d + 1) % 4;
    if (x === x0 && y === y0 && d === 0) break;
  }
  return out;
}

function smoothLoop(points: RasterPoint[], passes: number): RasterPoint[] {
  let cur = points;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((pt, i) => {
      const a = cur[(i + cur.length - 1) % cur.length];
      const b = cur[(i + 1) % cur.length];
      return { x: (a.x + 2 * pt.x + b.x) / 4, y: (a.y + 2 * pt.y + b.y) / 4 };
    });
  }
  return cur;
}

/** `count` points evenly spaced by arc length along the closed loop. */
function resampleLoop(points: RasterPoint[], count: number): RasterPoint[] {
  const n = points.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n];
  const out: RasterPoint[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (total * k) / count;
    while (seg < n - 1 && cum[seg + 1] < target) seg++;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    const len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? (target - cum[seg]) / len : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Rotate `points` so that the loop starts at the vertex that best lines up with `reference` (same length). */
function alignStart(points: RasterPoint[], reference: readonly RasterPoint[]): RasterPoint[] {
  const n = points.length;
  let best = 0;
  let bestCost = Infinity;
  for (let shift = 0; shift < n; shift++) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const p = points[(i + shift) % n];
      cost += (p.x - reference[i].x) ** 2 + (p.y - reference[i].y) ** 2;
    }
    if (cost < bestCost) (bestCost = cost), (best = shift);
  }
  return points.map((_, i) => points[(i + best) % n]);
}

/** Smooth closed bezier through the points (Catmull-Rom tangents). */
export function smoothLoopToPath(points: readonly RasterPoint[], tension = 1 / 6): BezierPath {
  const n = points.length;
  const out: BezierPoint[] = points.map((p, i) => {
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const tx = (next.x - prev.x) * tension;
    const ty = (next.y - prev.y) * tension;
    return { x: p.x, y: p.y, handleIn: { x: p.x - tx, y: p.y - ty }, handleOut: { x: p.x + tx, y: p.y + ty } };
  });
  return { points: out, closed: true };
}

export interface MaskPathOptions {
  /** Vertices of the editable path. Every keyframe of one tracked mask uses the same count so they interpolate. */
  readonly points?: number;
  /** Vertices of the previous keyframe (normalised): the new loop starts where it best lines up. */
  readonly reference?: readonly RasterPoint[];
}

export const DEFAULT_PATH_POINTS = 32;

/** The editable bezier path (normalised 0..1 of the raster) that outlines `mask`; null when it is empty. */
export function maskToPath(mask: Uint8Array, width: number, height: number, options: MaskPathOptions = {}): BezierPath | null {
  const outline = traceOutline(fillHoles(largestComponent(mask, width, height), width, height), width, height);
  if (outline.length < 4) return null;
  const count = options.points ?? DEFAULT_PATH_POINTS;
  let loop = resampleLoop(smoothLoop(outline, 2), count);
  const ref = options.reference && options.reference.length === count ? options.reference.map((p) => ({ x: p.x * width, y: p.y * height })) : null;
  if (ref) {
    loop = alignStart(loop, ref);
  } else {
    // Stable first vertex: the topmost one, so a fresh mask always starts at the same place.
    let top = 0;
    for (let i = 1; i < loop.length; i++) if (loop[i].y < loop[top].y) top = i;
    loop = loop.map((_, i) => loop[(i + top) % loop.length]);
  }
  return smoothLoopToPath(loop.map((p) => ({ x: p.x / width, y: p.y / height })));
}

/** Even-odd scanline fill of a normalised path into a `width * height` raster (what the mask engine's fill covers). */
export function rasterizePath(path: BezierPath, width: number, height: number): Uint8Array {
  const poly = flattenPath(path, 16).map((p) => ({ x: p.x * width, y: p.y * height }));
  const out = new Uint8Array(width * height);
  if (poly.length < 3) return out;
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) out[y * width + x] = 1;
    }
  }
  return out;
}
