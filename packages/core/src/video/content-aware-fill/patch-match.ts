import type { RGBAFrame } from "../time-interpolation/frame-blend";

/**
 * Patch-based spatial inpainting (PatchMatch, Barnes et al., used the way Wexler's image completion does): a
 * coarse-to-fine EM loop. Every patch that touches the hole finds its best match among the patches that lie
 * entirely on known pixels (random initialisation, propagation and a shrinking random search), then each hole
 * pixel becomes the weighted vote of the matches that cover it. The coarsest level starts from a smooth onion peel.
 * Pure and deterministic (seeded generator), so a re-analysis gives the same pixels and preview == export.
 */
export interface InpaintOptions {
  /** Patch half width; 2 = 5x5 patches. */
  readonly patchRadius?: number;
  /** EM rounds per pyramid level. */
  readonly iterations?: number;
  readonly seed?: number;
  readonly maxLevels?: number;
}

interface Level {
  w: number;
  h: number;
  rgb: Float32Array;
  hole: Uint8Array;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function holeBounds(level: Level): { w: number; h: number } | null {
  let x0 = level.w, y0 = level.h, x1 = -1, y1 = -1;
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      if (!level.hole[y * level.w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function downsample(level: Level): Level {
  const w = level.w >> 1;
  const h = level.h >> 1;
  const rgb = new Float32Array(w * h * 3);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const p = (2 * y + j) * level.w + 2 * x + i;
          if (level.hole[p]) continue;
          r += level.rgb[p * 3];
          g += level.rgb[p * 3 + 1];
          b += level.rgb[p * 3 + 2];
          n++;
        }
      }
      const o = y * w + x;
      if (n === 0) hole[o] = 1;
      else {
        rgb[o * 3] = r / n;
        rgb[o * 3 + 1] = g / n;
        rgb[o * 3 + 2] = b / n;
      }
    }
  }
  return { w, h, rgb, hole };
}

/** Smooth start for the coarsest level: hole pixels take the mean of their already known neighbours, ring by ring. */
function onionPeel(level: Level): void {
  const { w, h, rgb, hole } = level;
  const known = Uint8Array.from(hole, (v) => 1 - v);
  for (let ring = 0; ring < w + h; ring++) {
    const next: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let n = 0, r = 0, g = 0, b = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const xx = x + i, yy = y + j;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (!known[q]) continue;
            r += rgb[q * 3]; g += rgb[q * 3 + 1]; b += rgb[q * 3 + 2];
            n++;
          }
        }
        if (n === 0) continue;
        rgb[p * 3] = r / n; rgb[p * 3 + 1] = g / n; rgb[p * 3 + 2] = b / n;
        next.push(p);
      }
    }
    if (next.length === 0) break;
    for (const p of next) known[p] = 1;
  }
}

function upsampleInto(fine: Level, coarse: Level): void {
  for (let y = 0; y < fine.h; y++) {
    for (let x = 0; x < fine.w; x++) {
      const p = y * fine.w + x;
      if (!fine.hole[p]) continue;
      const fx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
      const fy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(coarse.w - 1, x0 + 1), y1 = Math.min(coarse.h - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      for (let c = 0; c < 3; c++) {
        const top = coarse.rgb[(y0 * coarse.w + x0) * 3 + c] * (1 - ax) + coarse.rgb[(y0 * coarse.w + x1) * 3 + c] * ax;
        const bottom = coarse.rgb[(y1 * coarse.w + x0) * 3 + c] * (1 - ax) + coarse.rgb[(y1 * coarse.w + x1) * 3 + c] * ax;
        fine.rgb[p * 3 + c] = top * (1 - ay) + bottom * ay;
      }
    }
  }
}

interface Field {
  sx: Int32Array;
  sy: Int32Array;
  dist: Float32Array;
}

/** Patch centres whose whole patch is known: the only places a match may come from. */
function sourceCentres(level: Level, r: number): { valid: Uint8Array; list: Int32Array } {
  const { w, h, hole } = level;
  const sums = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      sums[(y + 1) * (w + 1) + x + 1] = sums[y * (w + 1) + x + 1] + row;
    }
  }
  const valid = new Uint8Array(w * h);
  const list: number[] = [];
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      const a = sums[(y + r + 1) * (w + 1) + x + r + 1] - sums[(y - r) * (w + 1) + x + r + 1] - sums[(y + r + 1) * (w + 1) + x - r] + sums[(y - r) * (w + 1) + x - r];
      if (a === 0) {
        valid[y * w + x] = 1;
        list.push(y * w + x);
      }
    }
  }
  return { valid, list: Int32Array.from(list) };
}

function patchDistance(rgb: Float32Array, w: number, r: number, dx: number, dy: number, sx: number, sy: number, limit: number): number {
  let d = 0;
  for (let j = -r; j <= r; j++) {
    let a = ((dy + j) * w + dx - r) * 3;
    let b = ((sy + j) * w + sx - r) * 3;
    for (let i = -r; i <= r; i++) {
      const e0 = rgb[a] - rgb[b];
      const e1 = rgb[a + 1] - rgb[b + 1];
      const e2 = rgb[a + 2] - rgb[b + 2];
      d += e0 * e0 + e1 * e1 + e2 * e2;
      a += 3;
      b += 3;
    }
    if (d >= limit) return d;
  }
  return d;
}

function refine(level: Level, r: number, iterations: number, random: () => number, start: Field | null): Field | null {
  const { w, h, hole, rgb } = level;
  if (w < 2 * r + 1 || h < 2 * r + 1) return null;
  const { valid, list } = sourceCentres(level, r);
  if (list.length === 0) return null;
  // destination centres: every patch that overlaps the hole
  const dest: number[] = [];
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      let touches = false;
      for (let j = -r; j <= r && !touches; j++) for (let i = -r; i <= r; i++) if (hole[(y + j) * w + x + i]) { touches = true; break; }
      if (touches) dest.push(y * w + x);
    }
  }
  if (dest.length === 0) return start;
  const isDest = new Uint8Array(w * h);
  for (const p of dest) isDest[p] = 1;
  const field: Field = start ?? { sx: new Int32Array(w * h), sy: new Int32Array(w * h), dist: new Float32Array(w * h) };
  const randomSource = (p: number): void => {
    const s = list[Math.floor(random() * list.length)];
    field.sx[p] = s % w;
    field.sy[p] = (s / w) | 0;
  };
  for (const p of dest) {
    const sx = field.sx[p], sy = field.sy[p];
    if (!start || sx < r || sy < r || sx >= w - r || sy >= h - r || !valid[sy * w + sx]) randomSource(p);
    field.dist[p] = patchDistance(rgb, w, r, p % w, (p / w) | 0, field.sx[p], field.sy[p], Infinity);
  }
  const patchArea = (2 * r + 1) * (2 * r + 1);
  const try_ = (p: number, x: number, y: number, sx: number, sy: number): void => {
    if (sx < r || sy < r || sx >= w - r || sy >= h - r || !valid[sy * w + sx]) return;
    const d = patchDistance(rgb, w, r, x, y, sx, sy, field.dist[p]);
    if (d < field.dist[p]) {
      field.dist[p] = d;
      field.sx[p] = sx;
      field.sy[p] = sy;
    }
  };

  for (let iteration = 0; iteration < iterations; iteration++) {
    const forward = iteration % 2 === 0;
    const step = forward ? 1 : -1;
    for (let k = forward ? 0 : dest.length - 1; k >= 0 && k < dest.length; k += step) {
      const p = dest[k];
      const x = p % w, y = (p / w) | 0;
      // propagation from the left / upper (or right / lower) neighbour's match
      for (const [nx, ny] of [[x - step, y], [x, y - step]] as const) {
        const q = ny * w + nx;
        if (nx < r || ny < r || nx >= w - r || ny >= h - r || !isDest[q]) continue;
        try_(p, x, y, field.sx[q] + (x - nx), field.sy[q] + (y - ny));
      }
      // random search around the current best, window halving down to 1 px
      let radius = Math.max(w, h) >> 1;
      while (radius >= 1) {
        const sx = field.sx[p] + Math.round((random() * 2 - 1) * radius);
        const sy = field.sy[p] + Math.round((random() * 2 - 1) * radius);
        try_(p, x, y, sx, sy);
        radius >>= 1;
      }
    }
    // vote
    let meanDist = 0;
    for (const p of dest) meanDist += field.dist[p];
    meanDist = meanDist / dest.length / patchArea + 1;
    const acc = new Float32Array(w * h * 3);
    const weight = new Float32Array(w * h);
    for (const p of dest) {
      const x = p % w, y = (p / w) | 0;
      const wgt = Math.exp(-field.dist[p] / patchArea / (2 * meanDist));
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const t = (y + j) * w + x + i;
          if (!hole[t]) continue;
          const s = ((field.sy[p] + j) * w + field.sx[p] + i) * 3;
          acc[t * 3] += rgb[s] * wgt;
          acc[t * 3 + 1] += rgb[s + 1] * wgt;
          acc[t * 3 + 2] += rgb[s + 2] * wgt;
          weight[t] += wgt;
        }
      }
    }
    for (let t = 0; t < w * h; t++) {
      if (!hole[t] || weight[t] <= 0) continue;
      rgb[t * 3] = acc[t * 3] / weight[t];
      rgb[t * 3 + 1] = acc[t * 3 + 1] / weight[t];
      rgb[t * 3 + 2] = acc[t * 3 + 2] / weight[t];
    }
  }
  return field;
}

/** Match field of a coarser level, scaled for the next finer one. */
function upsampleField(field: Field, coarse: Level, fine: Level): Field {
  const out: Field = { sx: new Int32Array(fine.w * fine.h), sy: new Int32Array(fine.w * fine.h), dist: new Float32Array(fine.w * fine.h) };
  for (let y = 0; y < fine.h; y++) {
    for (let x = 0; x < fine.w; x++) {
      const cx = Math.min(coarse.w - 1, x >> 1), cy = Math.min(coarse.h - 1, y >> 1);
      const c = cy * coarse.w + cx;
      out.sx[y * fine.w + x] = field.sx[c] * 2 + (x & 1);
      out.sy[y * fine.w + x] = field.sy[c] * 2 + (y & 1);
    }
  }
  return out;
}

/** Fill `hole` (1 = synthesise) of an RGBA frame; every other pixel is returned unchanged. */
export function patchMatchInpaint(frame: RGBAFrame, hole: Uint8Array, options: InpaintOptions = {}): Uint8ClampedArray {
  const { width, height } = frame;
  const out = new Uint8ClampedArray(frame.data);
  let holeCount = 0;
  for (let i = 0; i < hole.length; i++) if (hole[i]) holeCount++;
  if (holeCount === 0) return out;
  const r = options.patchRadius ?? 2;
  const iterations = options.iterations ?? 4;
  const random = mulberry32(options.seed ?? 1);

  const base: Level = { w: width, h: height, rgb: new Float32Array(width * height * 3), hole: Uint8Array.from(hole, (v) => (v ? 1 : 0)) };
  let known = 0;
  for (let i = 0; i < width * height; i++) {
    base.rgb[i * 3] = frame.data[i * 4];
    base.rgb[i * 3 + 1] = frame.data[i * 4 + 1];
    base.rgb[i * 3 + 2] = frame.data[i * 4 + 2];
    if (!base.hole[i]) known++;
  }
  if (known === 0) {
    for (let i = 0; i < width * height; i++) out.set([128, 128, 128, 255], i * 4);
    return out;
  }

  const levels: Level[] = [base];
  const patch = 2 * r + 1;
  while (levels.length < (options.maxLevels ?? 6)) {
    const top = levels[levels.length - 1];
    const bounds = holeBounds(top);
    if (!bounds || (bounds.w <= 3 * patch && bounds.h <= 3 * patch) || top.w < 8 * patch || top.h < 8 * patch) break;
    const next = downsample(top);
    if (!next.hole.some((v) => v === 0)) break;
    levels.push(next);
  }
  onionPeel(levels[levels.length - 1]);
  let field: Field | null = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const level = levels[li];
    if (li < levels.length - 1) upsampleInto(level, levels[li + 1]);
    const start: Field | null = field && li < levels.length - 1 ? upsampleField(field, levels[li + 1], level) : null;
    field = refine(level, r, li === 0 ? Math.max(2, iterations - 1) : iterations, random, start);
  }
  for (let i = 0; i < width * height; i++) {
    if (!base.hole[i]) continue;
    out[i * 4] = base.rgb[i * 3];
    out[i * 4 + 1] = base.rgb[i * 3 + 1];
    out[i * 4 + 2] = base.rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}
