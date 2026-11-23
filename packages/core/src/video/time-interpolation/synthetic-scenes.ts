import type { RGBAFrame } from "./frame-blend";

/**
 * Analytic test scenes: every frame is a closed-form function of the scene time s, so the true frame at a
 * fractional time (the thing an interpolator tries to produce) is known exactly. Used by the unit tests and the
 * browser benchmark; nothing in the product imports this file.
 */
export type SceneFn = (x: number, y: number, s: number) => [number, number, number];

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Smooth, strongly textured field with detail at several scales. */
export function texture(u: number, v: number, seed: number): [number, number, number] {
  const a = Math.sin(u * 0.31 + seed) * Math.cos(v * 0.27 - seed * 1.3);
  const b = Math.sin((u + v) * 0.17 + seed * 2.1) + Math.sin(u * 0.09 - v * 0.13 + seed);
  const c = Math.sin(u * 0.63 + v * 0.41 + seed * 0.7);
  return [clamp255(128 + 70 * a + 30 * c), clamp255(128 + 55 * b + 40 * a * c), clamp255(128 + 60 * c - 35 * b)];
}

/** A textured rectangle (own texture, moves with the rectangle) over a static textured background. */
export function translatingSquare(width: number, height: number, vx: number, vy: number): SceneFn {
  const sw = Math.round(width * 0.38);
  const sh = Math.round(height * 0.42);
  const x0 = width * 0.28;
  const y0 = height * 0.3;
  return (x, y, s) => {
    const left = x0 + vx * s;
    const top = y0 + vy * s;
    if (x >= left && x < left + sw && y >= top && y < top + sh) return texture(x - left, y - top, 4.2);
    return texture(x, y, 0.5);
  };
}

/** Whole picture panning by (vx, vy) px per frame (subpixel allowed). */
export function pan(vx: number, vy: number): SceneFn {
  return (x, y, s) => texture(x - vx * s, y - vy * s, 1.1);
}

/** A textured disc rotating about the centre by `degPerFrame` over a static background. */
export function rotatingDisc(width: number, height: number, degPerFrame: number): SceneFn {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.4;
  return (x, y, s) => {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r * r) {
      const a = (-degPerFrame * s * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      return texture(cx + dx * ca - dy * sa, cy + dx * sa + dy * ca, 2.7);
    }
    return texture(x, y, 0.5);
  };
}

/** Fade to black of one static picture: no motion at all, brightness changes. */
export function fade(): SceneFn {
  return (x, y, s) => {
    const a = texture(x, y, 0.9);
    return [a[0] * (1 - s), a[1] * (1 - s), a[2] * (1 - s)];
  };
}

/** Cross dissolve between two unrelated static pictures: no motion, the content changes. */
export function crossDissolve(): SceneFn {
  return (x, y, s) => {
    const a = texture(x, y, 0.9);
    const b = texture(x, y, 3.3);
    return [a[0] * (1 - s) + b[0] * s, a[1] * (1 - s) + b[1] * s, a[2] * (1 - s) + b[2] * s];
  };
}

/** Rasterise the scene at time s with n x n supersampling (an anti-aliased, analytic frame). */
export function renderScene(scene: SceneFn, width: number, height: number, s: number, ss = 3): RGBAFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const c = scene(x + (i + 0.5) / ss - 0.5, y + (j + 0.5) / ss - 0.5, s);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = ss * ss;
      const o = (y * width + x) * 4;
      data[o] = Math.round(r / n);
      data[o + 1] = Math.round(g / n);
      data[o + 2] = Math.round(b / n);
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** PSNR in dB over RGB (255 peak); `mask` restricts it to flagged pixels. */
export function psnr(a: ArrayLike<number>, b: ArrayLike<number>, mask?: Uint8Array): number {
  let se = 0;
  let n = 0;
  const px = a.length / 4;
  for (let i = 0; i < px; i++) {
    if (mask && !mask[i]) continue;
    for (let c = 0; c < 3; c++) {
      const d = a[i * 4 + c] - b[i * 4 + c];
      se += d * d;
    }
    n += 3;
  }
  if (n === 0 || se === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / (se / n));
}

export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(Math.round(seed * 1000), 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(u: number, v: number, seed: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
}

/**
 * Non-periodic natural-ish picture: three octaves of hashed value noise per channel. Two different seeds share no
 * structure at any translation, which the sinusoid `texture` (periodic, so any two are correlated somewhere) cannot offer.
 */
export function noiseTexture(u: number, v: number, seed: number): [number, number, number] {
  const ch = (k: number): number => {
    const n = 0.55 * valueNoise(u / 14, v / 14, seed + k) + 0.3 * valueNoise(u / 6, v / 6, seed + k + 10) + 0.15 * valueNoise(u / 2.5, v / 2.5, seed + k + 20);
    return clamp255(255 * n * 1.25 - 20);
  };
  return [ch(0), ch(100), ch(200)];
}

/** A picture of a few flat-coloured rectangles and discs on a gradient: the "graphic" kind of shot. */
export function shapesScene(width: number, height: number, seed: number): SceneFn {
  const items = Array.from({ length: 6 }, (_, i) => ({
    x: hash2(i, 1, seed) * width,
    y: hash2(i, 2, seed) * height,
    w: (0.12 + 0.25 * hash2(i, 3, seed)) * width,
    h: (0.12 + 0.25 * hash2(i, 4, seed)) * height,
    round: hash2(i, 5, seed) > 0.5,
    c: [hash2(i, 6, seed) * 255, hash2(i, 7, seed) * 255, hash2(i, 8, seed) * 255] as [number, number, number],
  }));
  const g0 = [hash2(9, 1, seed) * 255, hash2(9, 2, seed) * 255, hash2(9, 3, seed) * 255];
  return (x, y) => {
    let out: [number, number, number] = [g0[0] * (1 - y / height) + 40, g0[1] * (x / width) + 20, g0[2] * 0.6 + 40];
    for (const it of items) {
      const dx = (x - it.x) / it.w;
      const dy = (y - it.y) / it.h;
      if (it.round ? dx * dx + dy * dy <= 1 : dx >= 0 && dx < 1 && dy >= 0 && dy < 1) out = it.c;
    }
    return out;
  };
}
