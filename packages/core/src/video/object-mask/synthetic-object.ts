import type { RGBAFrame } from "./types";

/**
 * Analytic test footage: a shaded, noisy ellipse that translates, turns and breathes over a static, strongly
 * textured background. The true object mask of every frame is known exactly. Used by the unit tests only.
 */
const hash = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) % 10007) / 10007;
};

function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const s = (t: number): number => t * t * (3 - 2 * t);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - s(fx)) + b * s(fx)) * (1 - s(fy)) + (c * (1 - s(fx)) + d * s(fx)) * s(fy);
}

export interface ObjectScene {
  readonly width: number;
  readonly height: number;
  frame(n: number): RGBAFrame;
  /** Exact object mask (coverage >= 0.5) of frame n. */
  truth(n: number): Uint8Array;
  /** Object centre of frame n. */
  center(n: number): { x: number; y: number };
}

export function movingObjectScene(width = 192, height = 108, frames = 60): ObjectScene {
  const center = (n: number): { x: number; y: number } => ({
    x: width * 0.28 + (width * 0.42 * n) / Math.max(1, frames - 1),
    y: height * 0.5 + height * 0.14 * Math.sin((n / Math.max(1, frames - 1)) * Math.PI * 2),
  });
  const shape = (n: number) => ({
    rx: width * 0.135 * (1 + 0.08 * Math.sin(n * 0.11)),
    ry: height * 0.2 * (1 - 0.06 * Math.sin(n * 0.11)),
    angle: ((n * 0.6) * Math.PI) / 180,
  });
  const coverage = (x: number, y: number, n: number): number => {
    const c = center(n);
    const { rx, ry, angle } = shape(n);
    const dx = x - c.x;
    const dy = y - c.y;
    const u = dx * Math.cos(angle) + dy * Math.sin(angle);
    const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const r = Math.sqrt((u / rx) ** 2 + (v / ry) ** 2);
    const edge = Math.min(rx, ry) * 0.5; // distance scale of one pixel in `r` units
    return Math.max(0, Math.min(1, (1 - r) * edge + 0.5));
  };
  const background = (x: number, y: number): [number, number, number] => {
    const n1 = valueNoise(x, y, 7, 3);
    const n2 = valueNoise(x, y, 2.5, 9);
    const checker = (Math.floor(x / 9) + Math.floor(y / 9)) % 2 === 0 ? 14 : -14;
    return [60 + 55 * n1 + 24 * n2 + checker * 0.4, 105 + 60 * n1 + 26 * n2 + checker, 125 + 55 * n2 + 16 * n1 - checker * 0.5];
  };
  const objectColour = (x: number, y: number, n: number): [number, number, number] => {
    const c = center(n);
    const t = Math.max(0, Math.min(1, (x - c.x + 20) / 40));
    const g = valueNoise(x - c.x, y - c.y, 3, 21) - 0.5;
    return [200 + 40 * t + 16 * g, 90 + 55 * t + 14 * g, 55 + 30 * t + 12 * g];
  };
  return {
    width,
    height,
    center,
    frame(n) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cov = coverage(x + 0.5, y + 0.5, n);
          const bg = background(x, y);
          const fg = objectColour(x + 0.5, y + 0.5, n);
          const o = (y * width + x) * 4;
          data[o] = bg[0] * (1 - cov) + fg[0] * cov;
          data[o + 1] = bg[1] * (1 - cov) + fg[1] * cov;
          data[o + 2] = bg[2] * (1 - cov) + fg[2] * cov;
          data[o + 3] = 255;
        }
      }
      return { width, height, data };
    },
    truth(n) {
      const out = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = coverage(x + 0.5, y + 0.5, n) >= 0.5 ? 1 : 0;
      return out;
    },
  };
}
