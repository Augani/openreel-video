import { GridGraphCut, GRID_DIRS } from "./graph-cut";
import { Gmm } from "./gmm";
import { downscaleRgba, fillHoles, growMask, largestComponent, maskArea, maskBounds, resizeMask, smoothMask } from "./raster-ops";
import type { ObjectSegmenter, RasterPoint, RGBAFrame, SegmentPrompt, SegmentResult } from "./types";

/** GrabCut labels (OpenCV's meaning). */
const BG = 0;
const FG = 1;
const PBG = 2;
const PFG = 3;
const HARD = 1e6;

export interface GrabCutOptions {
  /** The cut runs on a frame whose long side is at most this (the mask is scaled back up). */
  readonly maxDim?: number;
  readonly components?: number;
  readonly iterations?: number;
  /** Smoothness weight of the pairwise term. */
  readonly gamma?: number;
}

const GROW_THRESHOLDS = [14, 22, 32, 44, 58, 76, 100];

function colourDistance(d: ArrayLike<number>, a: number, mean: readonly number[]): number {
  return Math.hypot(d[a * 4] - mean[0], d[a * 4 + 1] - mean[1], d[a * 4 + 2] - mean[2]);
}

/** 4-connected region grow from `seed`: pixels within `threshold` (RGB distance) of the seed patch colour. */
function growRegion(frame: RGBAFrame, seed: RasterPoint, threshold: number, mean: readonly number[]): Uint8Array {
  const { width, height, data } = frame;
  const out = new Uint8Array(width * height);
  const sx = Math.min(width - 1, Math.max(0, Math.round(seed.x)));
  const sy = Math.min(height - 1, Math.max(0, Math.round(seed.y)));
  const stack = [sy * width + sx];
  out[stack[0]] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i / width) | 0;
    const visit = (j: number): void => {
      if (!out[j] && colourDistance(data, j, mean) <= threshold) {
        out[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (y > 0) visit(i - width);
    if (y < height - 1) visit(i + width);
  }
  return out;
}

/**
 * The region a click most plausibly means: grown from the click at rising colour tolerances; the first tolerance
 * whose region is big enough and stable (the next step barely grows it) is the object, a leak into the background
 * shows as a sudden jump and is never chosen.
 */
function seedRegion(frame: RGBAFrame, seed: RasterPoint): Uint8Array {
  const { width, height, data } = frame;
  const n = width * height;
  const sx = Math.min(width - 1, Math.max(0, Math.round(seed.x)));
  const sy = Math.min(height - 1, Math.max(0, Math.round(seed.y)));
  const mean = [0, 0, 0];
  let count = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(height - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(width - 1, sx + 2); x++) {
      const i = (y * width + x) * 4;
      mean[0] += data[i];
      mean[1] += data[i + 1];
      mean[2] += data[i + 2];
      count++;
    }
  }
  for (let c = 0; c < 3; c++) mean[c] /= count;
  const regions = GROW_THRESHOLDS.map((t) => growRegion(frame, seed, t, mean));
  const areas = regions.map(maskArea);
  const minArea = Math.max(12, n * 0.004);
  for (let i = 0; i < regions.length - 1; i++) {
    if (areas[i] >= minArea && areas[i + 1] <= areas[i] * 1.35 && areas[i] < n * 0.7) return regions[i];
  }
  let pick = 0;
  for (let i = 0; i < regions.length; i++) if (areas[i] <= n * 0.35) pick = i;
  return regions[pick];
}

function paintDisc(labels: Uint8Array, width: number, height: number, c: RasterPoint, radius: number, label: number): void {
  const r = Math.max(1, radius);
  for (let y = Math.max(0, Math.floor(c.y - r)); y <= Math.min(height - 1, Math.ceil(c.y + r)); y++) {
    for (let x = Math.max(0, Math.floor(c.x - r)); x <= Math.min(width - 1, Math.ceil(c.x + r)); x++) {
      if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= r * r) labels[y * width + x] = label;
    }
  }
}

function paintStroke(labels: Uint8Array, width: number, height: number, points: readonly RasterPoint[], radius: number, label: number): void {
  for (let p = 0; p < points.length; p++) {
    const a = points[p];
    const b = points[Math.min(points.length - 1, p + 1)];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, radius * 0.5)));
    for (let s = 0; s <= steps; s++) paintDisc(labels, width, height, { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }, radius, label);
  }
}

/**
 * Classical, model-free object segmentation: GrabCut (colour mixture models + a minimum graph cut on the pixel
 * grid). A click grows a seed region that defines the initial colour models; a prior mask (tracking) defines a
 * narrow band around the previous shape that the cut may move inside. No weights, no downloads.
 */
export class GrabCutSegmenter implements ObjectSegmenter {
  readonly id = "grabcut-classical";
  private readonly maxDim: number;
  private readonly components: number;
  private readonly iterations: number;
  private readonly gamma: number;

  constructor(options: GrabCutOptions = {}) {
    this.maxDim = options.maxDim ?? 192;
    this.components = options.components ?? 5;
    this.iterations = options.iterations ?? 4;
    this.gamma = options.gamma ?? 50;
  }

  segment(image: RGBAFrame, prompt: SegmentPrompt): SegmentResult {
    const work = downscaleRgba(image, this.maxDim);
    const { width, height, data } = work;
    const scale = width / image.width;
    const n = width * height;
    const empty: SegmentResult = { width: image.width, height: image.height, mask: new Uint8Array(image.width * image.height), confidence: 0 };
    const include = (prompt.include ?? []).map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const exclude = (prompt.exclude ?? []).map((p) => ({ x: p.x * scale, y: p.y * scale }));
    const strokes = (prompt.strokes ?? []).map((s) => ({ include: s.include, radius: Math.max(1, s.radius * scale), points: s.points.map((p) => ({ x: p.x * scale, y: p.y * scale })) }));
    const seedRadius = Math.max(2, Math.min(width, height) * 0.015);
    const prior = prompt.prior && prompt.prior.length === image.width * image.height ? resizeMask(prompt.prior, image.width, image.height, width, height) : null;
    if (!prior && include.length === 0 && !strokes.some((s) => s.include)) return empty;

    const labels = new Uint8Array(n);
    if (prior) {
      const area = maskArea(prior);
      if (area === 0) return empty;
      const band = Math.max(2, Math.round((prompt.band ?? 0) * scale) || Math.sqrt(area) * 0.14);
      const core = growMask(prior, width, height, -Math.max(1, Math.round(band * 0.7)));
      const outer = growMask(prior, width, height, Math.round(band));
      for (let i = 0; i < n; i++) labels[i] = core[i] ? FG : prior[i] ? PFG : outer[i] ? PBG : BG;
    } else {
      const seeds: Uint8Array[] = include.map((p) => seedRegion(work, p));
      for (const stroke of strokes) if (stroke.include) {
        // The stroke itself is certain; the object around it is found the way a click finds it.
        const m = new Uint8Array(n);
        paintStroke(m, width, height, stroke.points, stroke.radius, 1);
        seeds.push(m);
        const samples = Math.min(5, stroke.points.length);
        for (let s = 0; s < samples; s++) seeds.push(seedRegion(work, stroke.points[Math.round((s * (stroke.points.length - 1)) / Math.max(1, samples - 1))]));
      }
      const region = new Uint8Array(n);
      for (const s of seeds) for (let i = 0; i < n; i++) if (s[i]) region[i] = 1;
      const box = maskBounds(region, width, height);
      if (!box) return empty;
      const margin = Math.max(4, Math.round(0.35 * Math.max(box.x1 - box.x0, box.y1 - box.y0)));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const inside = x >= box.x0 - margin && x <= box.x1 + margin && y >= box.y0 - margin && y <= box.y1 + margin;
          labels[i] = !inside ? BG : region[i] ? PFG : PBG;
        }
      }
    }
    // Explicit user marks always win.
    for (const p of include) paintDisc(labels, width, height, p, seedRadius, FG);
    for (const p of exclude) paintDisc(labels, width, height, p, seedRadius, BG);
    for (const stroke of strokes) paintStroke(labels, width, height, stroke.points, stroke.radius, stroke.include ? FG : BG);

    // Pairwise weights from local colour contrast (8-connected, diagonal links weighted by 1/distance).
    let diffSum = 0;
    let diffCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let k = 0; k < 4; k += 2) {
          const nx = x + GRID_DIRS[k][0];
          const ny = y + GRID_DIRS[k][1];
          if (nx >= width || ny >= height) continue;
          const a = (y * width + x) * 4;
          const b = (ny * width + nx) * 4;
          diffSum += (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2;
          diffCount++;
        }
      }
    }
    const beta = 1 / (2 * Math.max(1, diffSum / Math.max(1, diffCount)));
    const link = new Float64Array(n * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let k = 0; k < 4; k++) {
          const dir = k < 2 ? k * 2 : k === 2 ? 4 : 6;
          const nx = x + GRID_DIRS[dir][0];
          const ny = y + GRID_DIRS[dir][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const a = (y * width + x) * 4;
          const b = (ny * width + nx) * 4;
          const d2 = (data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2;
          link[(y * width + x) * 4 + k] = (this.gamma * Math.exp(-beta * d2)) / (dir >= 4 ? Math.SQRT2 : 1);
        }
      }
    }

    const fgModel = new Gmm();
    const bgModel = new Gmm();
    let margin = 0;
    let result: Uint8Array | null = null;
    for (let iter = 0; iter < this.iterations; iter++) {
      const fgSamples: number[] = [];
      const bgSamples: number[] = [];
      for (let i = 0; i < n; i++) {
        const target = labels[i] === FG || labels[i] === PFG ? fgSamples : bgSamples;
        target.push(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      }
      if (fgSamples.length < 6 || bgSamples.length < 6) return empty;
      fgModel.fit(Float32Array.from(fgSamples), this.components);
      bgModel.fit(Float32Array.from(bgSamples), this.components);
      const graph = new GridGraphCut(width, height);
      margin = 0;
      let counted = 0;
      for (let i = 0; i < n; i++) {
        const l = labels[i];
        if (l === FG) graph.source[i] = HARD;
        else if (l === BG) graph.sink[i] = HARD;
        else {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          const dFg = fgModel.cost(r, g, b);
          const dBg = bgModel.cost(r, g, b);
          graph.source[i] = dBg;
          graph.sink[i] = dFg;
          margin += Math.min(1, Math.abs(dBg - dFg) / 8);
          counted++;
        }
        for (let k = 0; k < 4; k++) {
          const w = link[i * 4 + k];
          if (w > 0) graph.setLink(i, k < 2 ? k * 2 : k === 2 ? 4 : 6, w);
        }
      }
      margin = counted ? margin / counted : 0;
      const side = graph.solve();
      let changed = 0;
      for (let i = 0; i < n; i++) {
        if (labels[i] === FG || labels[i] === BG) continue;
        const next = side[i] ? PFG : PBG;
        if (next !== labels[i]) changed++;
        labels[i] = next;
      }
      result = side;
      if (iter > 0 && changed < n * 0.0005) break;
    }
    if (!result) return empty;
    let mask: Uint8Array = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = labels[i] === FG || labels[i] === PFG ? 1 : 0;
    const prefer = include.length ? (i: number): boolean => include.some((p) => Math.abs((i % width) - p.x) <= seedRadius * 1.5 && Math.abs(((i / width) | 0) - p.y) <= seedRadius * 1.5) : undefined;
    mask = largestComponent(mask, width, height, prefer);
    mask = fillHoles(mask, width, height);
    mask = largestComponent(smoothMask(mask, width, height, 1), width, height, prefer);
    return { width: image.width, height: image.height, mask: resizeMask(mask, width, height, image.width, image.height), confidence: margin };
  }
}
