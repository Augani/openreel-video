/**
 * Threshold-field transitions (Premiere's Iris, Band, Barn Door, Clock and Gradient wipes).
 *
 * Every transition here is one scalar field T(x, y) in [0, 1]: the incoming shot shows where T is below the
 * wipe front. That one idea carries feather (a soft front), border (a coloured strip just ahead of the front),
 * reverse (T becomes 1 - T) and the custom start/end percentage (the front's range), so the same raster
 * serves every shape and a gradient wipe is just a luma image used as T.
 *
 * The raster is pure (no canvas). The Canvas2D transition engine uploads it as an alpha mask, which makes this
 * module the reference the engine is compared against in the tests and the browser parity spec.
 */
import { LUMA_MAX_ENCODED_LENGTH, LUMA_MAX_SIDE } from "./transition-luma-limits";

export const MASK_TRANSITION_TYPES = [
  "irisRound",
  "irisBox",
  "irisCross",
  "irisDiamond",
  "bandWipe",
  "barnDoor",
  "clockWipe",
  "gradientWipe",
  "checkerboard",
  "checkerWipe",
  "inset",
  "wedgeWipe",
  "randomBlocks",
  "randomWipe",
] as const;
export type MaskTransitionType = (typeof MASK_TRANSITION_TYPES)[number];

export function isMaskTransition(type: string): type is MaskTransitionType {
  return (MASK_TRANSITION_TYPES as readonly string[]).includes(type);
}

export const BUILTIN_GRADIENTS = ["linear", "radial", "diagonal", "checker", "noise", "spiral"] as const;
export type BuiltinGradient = (typeof BUILTIN_GRADIENTS)[number];

export interface LumaMap {
  readonly width: number;
  readonly height: number;
  /** 8-bit luma, row-major. Dark areas of the map are revealed first. */
  readonly data: Uint8Array;
}

export interface MaskParams {
  readonly feather: number;
  readonly borderWidth: number;
  readonly borderColor: string;
  readonly reverse: boolean;
  readonly cx: number;
  readonly cy: number;
  readonly bands: number;
  readonly orientation: "horizontal" | "vertical";
  readonly startAngle: number;
  readonly clockwise: boolean;
  readonly gradient: BuiltinGradient;
  readonly luma: LumaMap | null;
  /** The edge the wipe enters from (checker wipe, random wipe). */
  readonly direction: "left" | "right" | "up" | "down";
  /** The corner an inset grows from. */
  readonly corner: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  /** Columns of the checker / random grids. */
  readonly tiles: number;
  /** Seed of the random transitions: the same seed always gives the same pattern. */
  readonly seed: number;
}

export interface MaskRaster {
  readonly width: number;
  readonly height: number;
  /** Incoming shot coverage, 0..255 per pixel. */
  readonly incoming: Uint8ClampedArray;
  /** Border strip coverage, 0..255 per pixel (all zero without a border). */
  readonly border: Uint8ClampedArray;
}

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Standard base64 (no padding required) to bytes, without Node's Buffer or the DOM's atob. */
export function decodeLumaBase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (let i = 0; i < clean.length; i += 1) {
    acc = (acc << 6) | alphabet.indexOf(clean[i]!);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

export function encodeLumaBase64(data: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i]!;
    const b = i + 1 < data.length ? data[i + 1]! : 0;
    const c = i + 2 < data.length ? data[i + 2]! : 0;
    out += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < data.length ? alphabet[((b & 15) << 2) | (c >> 6)]! : "=";
    out += i + 2 < data.length ? alphabet[c & 63]! : "=";
  }
  return out;
}

/** The luma map stored on a transition (`lumaData` + `lumaWidth` + `lumaHeight`), or null when absent or malformed. */
export function readLumaMap(params: Record<string, unknown>): LumaMap | null {
  const width = Math.round(num(params.lumaWidth, 0));
  const height = Math.round(num(params.lumaHeight, 0));
  if (typeof params.lumaData !== "string" || width < 2 || height < 2 || width > LUMA_MAX_SIDE || height > LUMA_MAX_SIDE || params.lumaData.length > LUMA_MAX_ENCODED_LENGTH) return null;
  const data = decodeLumaBase64(params.lumaData);
  return data.length === width * height ? { width, height, data } : null;
}

export function resolveMaskParams(params: Record<string, unknown>): MaskParams {
  const center = (params.center ?? {}) as { x?: unknown; y?: unknown };
  const gradient = BUILTIN_GRADIENTS.includes(params.gradient as BuiltinGradient)
    ? (params.gradient as BuiltinGradient)
    : "linear";
  return {
    feather: clamp(num(params.feather, 0), 0, 1),
    borderWidth: clamp(num(params.borderWidth, 0), 0, 100),
    borderColor: typeof params.borderColor === "string" ? params.borderColor : "#ffffff",
    reverse: params.reverse === true,
    cx: clamp(num(center.x, 0.5), 0, 1),
    cy: clamp(num(center.y, 0.5), 0, 1),
    bands: Math.round(clamp(num(params.bands, 5), 2, 64)),
    orientation: params.orientation === "vertical" ? "vertical" : "horizontal",
    startAngle: num(params.startAngle, 0),
    clockwise: params.clockwise !== false,
    gradient,
    luma: readLumaMap(params),
    direction: DIRECTIONS.includes(params.direction as never) ? (params.direction as MaskParams["direction"]) : "left",
    corner: CORNERS.includes(params.corner as never) ? (params.corner as MaskParams["corner"]) : "topLeft",
    tiles: Math.round(clamp(num(params.tiles, 8), 2, 64)),
    seed: Math.round(clamp(num(params.seed, 1), 0, 999999)),
  };
}

const DIRECTIONS = ["left", "right", "up", "down"] as const;
const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

/**
 * Deterministic 32-bit hash of a seed and a cell: integer maths only, so the same seed gives the same pattern in
 * the preview, the export, another browser and the desktop app.
 */
export function hashCell(seed: number, a: number, b: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Each cell's reveal time: a permutation of 0..1, so exactly the share of cells equal to the progress is open. */
export function randomCellOrder(seed: number, columns: number, rows: number): Float64Array {
  const count = columns * rows;
  const keys = Array.from({ length: count }, (_, index) => ({ index, key: hashCell(seed, index % columns, Math.floor(index / columns)) }));
  keys.sort((a, b) => a.key - b.key || a.index - b.index);
  const order = new Float64Array(count);
  keys.forEach((entry, rank) => {
    order[entry.index] = count > 1 ? rank / (count - 1) : 0;
  });
  return order;
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise(u: number, v: number): number {
  const gx = u * 6;
  const gy = v * 6;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function builtinGradient(kind: BuiltinGradient, u: number, v: number, aspect: number): number {
  switch (kind) {
    case "radial":
      return clamp(Math.hypot((u - 0.5) * aspect, v - 0.5) / Math.hypot(0.5 * aspect, 0.5), 0, 1);
    case "diagonal":
      return clamp((u + v) / 2, 0, 1);
    case "checker":
      return ((Math.floor(u * 8) + Math.floor(v * 8)) & 1) === 0
        ? clamp(0.1 + 0.4 * (u + v) / 2, 0, 1)
        : clamp(0.55 + 0.4 * (u + v) / 2, 0, 1);
    case "noise":
      return clamp(smoothNoise(u, v), 0, 1);
    case "spiral": {
      const angle = (Math.atan2(v - 0.5, (u - 0.5) * aspect) + Math.PI) / (2 * Math.PI);
      const radius = clamp(Math.hypot((u - 0.5) * aspect, v - 0.5) / Math.hypot(0.5 * aspect, 0.5), 0, 1);
      return clamp((angle + radius * 3) % 1, 0, 1);
    }
    default:
      return clamp(u, 0, 1);
  }
}

function sampleLuma(map: LumaMap, u: number, v: number): number {
  const x = clamp(u * map.width - 0.5, 0, map.width - 1);
  const y = clamp(v * map.height - 0.5, 0, map.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const y1 = Math.min(map.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => map.data[py * map.width + px]! / 255;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
  return top + (bottom - top) * fy;
}

/** Pixels spanned by T going 0 to 1 (so a border width in pixels converts to T units). */
export function maskFieldScale(type: MaskTransitionType, width: number, height: number): number {
  switch (type) {
    case "irisRound":
      return Math.hypot(width, height) / 2;
    case "irisBox":
    case "irisDiamond":
    case "irisCross":
      return Math.max(width, height) / 2;
    case "bandWipe":
      return 0; // set per orientation below
    case "barnDoor":
      return width / 2;
    case "clockWipe":
    case "wedgeWipe":
      return Math.PI * Math.min(width, height) / 2;
    default:
      return Math.max(width, height);
  }
}

type Field = (x: number, y: number) => number;

function buildField(type: MaskTransitionType, p: MaskParams, w: number, h: number): { field: Field; scale: number } {
  const cx = p.cx * w;
  const cy = p.cy * h;
  const ex = Math.max(cx, w - cx, 1);
  const ey = Math.max(cy, h - cy, 1);
  const aspect = w / h;
  let scale = maskFieldScale(type, w, h);
  let field: Field;
  switch (type) {
    case "irisRound": {
      const max = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy), 1);
      scale = max;
      field = (x, y) => Math.hypot(x - cx, y - cy) / max;
      break;
    }
    case "irisBox":
      field = (x, y) => Math.max(Math.abs(x - cx) / ex, Math.abs(y - cy) / ey);
      break;
    case "irisDiamond":
      field = (x, y) => (Math.abs(x - cx) / ex + Math.abs(y - cy) / ey) / 2;
      break;
    case "irisCross": {
      const k = 0.25;
      field = (x, y) => {
        const ax = Math.abs(x - cx) / ex;
        const ay = Math.abs(y - cy) / ey;
        return k * Math.min(Math.max(ax, ay / k), Math.max(ax / k, ay));
      };
      break;
    }
    case "bandWipe": {
      const horizontalBands = p.orientation === "horizontal";
      scale = horizontalBands ? w : h;
      field = (x, y) => {
        const along = horizontalBands ? (x + 0.5) / w : (y + 0.5) / h;
        const across = horizontalBands ? (y + 0.5) / h : (x + 0.5) / w;
        const band = Math.min(p.bands - 1, Math.floor(across * p.bands));
        return band % 2 === 0 ? along : 1 - along;
      };
      break;
    }
    case "barnDoor": {
      const vertical = p.orientation === "horizontal"; // doors split along a vertical seam, wipe along x
      scale = vertical ? w / 2 : h / 2;
      field = (x, y) => (vertical ? Math.abs((x + 0.5) / w - 0.5) * 2 : Math.abs((y + 0.5) / h - 0.5) * 2);
      break;
    }
    case "clockWipe": {
      const start = (p.startAngle * Math.PI) / 180;
      field = (x, y) => {
        const angle = Math.atan2(x + 0.5 - cx, -(y + 0.5 - cy));
        let turn = (p.clockwise ? angle - start : start - angle) / (2 * Math.PI);
        turn -= Math.floor(turn);
        return turn;
      };
      break;
    }
    case "checkerboard": {
      const cell = w / p.tiles;
      scale = cell;
      field = (x, y) => {
        const i = Math.floor((x + 0.5) / cell);
        const j = Math.floor((y + 0.5) / cell);
        const lx = (((x + 0.5) / cell) - i - 0.5) * 2;
        const ly = (((y + 0.5) / cell) - j - 0.5) * 2;
        const distance = Math.max(Math.abs(lx), Math.abs(ly)); // 0 at the middle of the square, 1 at its edge
        return ((i + j) & 1) === 0 ? 0.5 * distance : 0.5 + 0.5 * distance;
      };
      break;
    }
    case "checkerWipe": {
      const cell = w / p.tiles;
      scale = cell;
      field = (x, y) => {
        const i = Math.floor((x + 0.5) / cell);
        const j = Math.floor((y + 0.5) / cell);
        const lx = (x + 0.5) / cell - i;
        const ly = (y + 0.5) / cell - j;
        const along = p.direction === "left" ? lx : p.direction === "right" ? 1 - lx : p.direction === "up" ? ly : 1 - ly;
        return ((i + j) & 1) === 0 ? along : 1 - along;
      };
      break;
    }
    case "inset": {
      const left = p.corner === "topLeft" || p.corner === "bottomLeft";
      const top = p.corner === "topLeft" || p.corner === "topRight";
      field = (x, y) => {
        const fx = left ? (x + 0.5) / w : 1 - (x + 0.5) / w;
        const fy = top ? (y + 0.5) / h : 1 - (y + 0.5) / h;
        return Math.max(fx, fy);
      };
      break;
    }
    case "wedgeWipe": {
      const start = (p.startAngle * Math.PI) / 180;
      field = (x, y) => {
        const angle = Math.atan2(x + 0.5 - cx, -(y + 0.5 - cy));
        let diff = angle - start;
        diff -= Math.round(diff / (2 * Math.PI)) * 2 * Math.PI;
        return Math.min(1, Math.abs(diff) / Math.PI);
      };
      break;
    }
    case "randomBlocks": {
      const cell = w / p.tiles;
      const rows = Math.max(1, Math.ceil(h / cell));
      const order = randomCellOrder(p.seed, p.tiles, rows);
      scale = Math.max(w, h);
      field = (x, y) => {
        const i = Math.min(p.tiles - 1, Math.floor((x + 0.5) / cell));
        const j = Math.min(rows - 1, Math.floor((y + 0.5) / cell));
        return order[j * p.tiles + i]!;
      };
      break;
    }
    case "randomWipe": {
      const horizontal = p.direction === "left" || p.direction === "right"; // strips run across the wipe
      const strips = p.tiles * 2;
      const lengthAcross = horizontal ? h : w;
      const jitter = Array.from({ length: strips }, (_, index) => hashCell(p.seed, index, 7));
      scale = horizontal ? w : h;
      field = (x, y) => {
        const strip = Math.min(strips - 1, Math.floor(((horizontal ? y : x) + 0.5) / lengthAcross * strips));
        const along = p.direction === "left" ? (x + 0.5) / w : p.direction === "right" ? 1 - (x + 0.5) / w : p.direction === "up" ? (y + 0.5) / h : 1 - (y + 0.5) / h;
        return 0.7 * along + 0.3 * jitter[strip]!;
      };
      break;
    }
    default: {
      // gradientWipe: normalise the map to span exactly 0..1 so the wipe always completes.
      const luma = p.luma;
      let lo = 0;
      let hi = 1;
      if (luma) {
        lo = 255;
        hi = 0;
        for (let i = 0; i < luma.data.length; i += 1) {
          const value = luma.data[i]!;
          if (value < lo) lo = value;
          if (value > hi) hi = value;
        }
        lo /= 255;
        hi /= 255;
      }
      const range = Math.max(1e-6, hi - lo);
      field = (x, y) => {
        const u = (x + 0.5) / w;
        const v = (y + 0.5) / h;
        return luma ? clamp((sampleLuma(luma, u, v) - lo) / range, 0, 1) : builtinGradient(p.gradient, u, v, aspect);
      };
    }
  }
  if (p.reverse) {
    const base = field;
    field = (x, y) => 1 - base(x, y);
  }
  return { field, scale: Math.max(1, scale) };
}

/** Rasterises the incoming-shot mask and the border strip for `progress` (0..1, already eased and range-mapped). */
export function rasterizeMaskTransition(
  type: MaskTransitionType,
  rawParams: Record<string, unknown>,
  width: number,
  height: number,
  progress: number,
): MaskRaster {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const params = resolveMaskParams(rawParams);
  const incoming = new Uint8ClampedArray(w * h);
  const border = new Uint8ClampedArray(w * h);
  const p = clamp(progress, 0, 1);
  if (p <= 0) return { width: w, height: h, incoming, border };
  if (p >= 1) {
    incoming.fill(255);
    return { width: w, height: h, incoming, border };
  }
  const { field, scale } = buildField(type, params, w, h);
  const aa = 1 / scale; // one pixel in T units
  const bw = params.borderWidth / scale;
  const f = params.feather;
  const softness = Math.max(f, aa);
  const q = p * (1 + f + bw + aa);
  const reveal = q - bw;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const t = field(x, y);
      const i = y * w + x;
      // Centre the antialiased hard edge on the front so a pixel on the front is half covered.
      const c = clamp((reveal - t) / softness + (f === 0 ? 0.5 : 0), 0, 1);
      incoming[i] = Math.round(c * 255);
      // The strip runs from where the (feathered) incoming shot ends to bw further out, so a feather fades into the
      // outgoing shot and only the strip itself is the border colour.
      if (bw > 0) border[i] = Math.round(clamp((q - t) / aa + 0.5, 0, 1) * (1 - clamp((reveal - t) / aa + 0.5, 0, 1)) * 255);
    }
  }
  return { width: w, height: h, incoming, border };
}

/** Whether a gradient/mask transition shows the incoming shot at (x, y) fully, partly or not at all. */
export function maskCoverageAt(raster: MaskRaster, x: number, y: number): number {
  return raster.incoming[Math.min(raster.height - 1, Math.max(0, y)) * raster.width + Math.min(raster.width - 1, Math.max(0, x))]! / 255;
}
