import { clamp01, lerp } from "../schema/common";
import { encodeBase64, encodePng } from "../geometry";

export type ProceduralTexturePattern =
  | "noise"
  | "voronoi"
  | "fbm"
  | "marble"
  | "circuit"
  | "fabric-weave"
  | "lunar-dust"
  | "hex-grid"
  | "gradient"
  | "brushed"
  | "checker";

export interface ProceduralTextureOptions {
  readonly pattern: ProceduralTexturePattern | string;
  readonly size?: number;
  readonly colorA?: string;
  readonly colorB?: string;
  readonly scale?: number;
  readonly seed?: number;
}

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;
  return [r, g, b];
}

function rgbToHex(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = hash2(ix, iy, seed);
  const v10 = hash2(ix + 1, iy, seed);
  const v01 = hash2(ix, iy + 1, seed);
  const v11 = hash2(ix + 1, iy + 1, seed);
  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(x * freq, y * freq, seed + octave * 17) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return clamp01(sum * 1.35);
}

function voronoi(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let minDistance = 2;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = ix + dx;
      const cy = iy + dy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 101);
      minDistance = Math.min(minDistance, Math.hypot(px - x, py - y));
    }
  }
  return clamp01(minDistance);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

export function proceduralField(
  pattern: string,
  u: number,
  v: number,
  scale: number,
  seed: number,
): number {
  const x = u * scale;
  const y = v * scale;
  switch (pattern) {
    case "gradient":
      return clamp01(u);
    case "checker":
      return (Math.floor(x) + Math.floor(y)) % 2 === 0 ? 0 : 1;
    case "voronoi":
      return voronoi(x, y, seed);
    case "fbm":
    case "lunar-dust":
      return fbm(x, y, seed);
    case "marble":
      return clamp01(0.5 + 0.5 * Math.sin((x + fbm(x, y, seed) * 4) * Math.PI));
    case "circuit": {
      const line = fract(x) < 0.08 || fract(y) < 0.08 ? 1 : 0;
      const node = hash2(Math.floor(x), Math.floor(y), seed) > 0.82 ? 1 : 0;
      return Math.max(line, node);
    }
    case "fabric-weave": {
      const warp = 0.5 + 0.5 * Math.sin(x * Math.PI * 2);
      const weft = 0.5 + 0.5 * Math.sin(y * Math.PI * 2);
      return (Math.floor(x) + Math.floor(y)) % 2 === 0 ? warp : weft;
    }
    case "hex-grid": {
      const hx = fract(x);
      const hy = fract(y + (Math.floor(x) % 2 === 0 ? 0 : 0.5));
      return clamp01(Math.hypot(hx - 0.5, hy - 0.5) * 2);
    }
    case "brushed":
      return valueNoise(x * 0.12, y * 6, seed);
    case "noise":
    default:
      return valueNoise(x, y, seed);
  }
}

export interface BakedTexture {
  readonly rgba: Uint8Array;
  readonly size: number;
  readonly averageColor: string;
}

export function bakeProceduralTexture(options: ProceduralTextureOptions): BakedTexture {
  const size = Math.max(2, Math.min(512, Math.floor(options.size ?? 64)));
  const scale = Math.max(0.25, options.scale ?? 4);
  const seed = Math.floor(options.seed ?? 1);
  const colorA = hexToRgb(options.colorA, [148, 163, 184]);
  const colorB = hexToRgb(options.colorB, [30, 41, 59]);
  const rgba = new Uint8Array(size * size * 4);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const u = px / size;
      const v = py / size;
      const field = clamp01(proceduralField(options.pattern, u, v, scale, seed));
      const r = lerp(colorA[0], colorB[0], field);
      const g = lerp(colorA[1], colorB[1], field);
      const b = lerp(colorA[2], colorB[2], field);
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r);
      rgba[offset + 1] = Math.round(g);
      rgba[offset + 2] = Math.round(b);
      rgba[offset + 3] = 255;
      sumR += r;
      sumG += g;
      sumB += b;
    }
  }
  const count = size * size;
  return {
    rgba,
    size,
    averageColor: rgbToHex([sumR / count, sumG / count, sumB / count]),
  };
}

export interface BakedTexturePng {
  readonly pngBase64: string;
  readonly dataUri: string;
  readonly size: number;
  readonly averageColor: string;
}

export function bakeProceduralTexturePng(options: ProceduralTextureOptions): BakedTexturePng {
  const baked = bakeProceduralTexture(options);
  const png = encodePng(baked.rgba, baked.size, baked.size);
  const base64 = encodeBase64(png);
  return {
    pngBase64: base64,
    dataUri: `data:image/png;base64,${base64}`,
    size: baked.size,
    averageColor: baked.averageColor,
  };
}
