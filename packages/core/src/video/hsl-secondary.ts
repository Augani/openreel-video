/**
 * HSL Secondary (Lumetri-style qualifier + matte-based correction).
 *
 * One secondary is one effect of type "hsl-secondary"; a clip can carry any
 * number of them (a stack, applied in effect order). This module is the pure
 * reference implementation:
 *
 *  - `secondaryUniforms`  maps stored params to ONE flat numeric struct that
 *    both the CPU reference below and the GLSL shader (pro-effect-shaders.ts)
 *    read, so every derived value is computed exactly once.
 *  - `computeSecondaryMatte` / `applyHslSecondary` are the Canvas2D / software
 *    fallback and the reference the shader is written line-for-line against.
 *  - `qualifierFromSample` is the eyedropper (set / add / subtract).
 *  - `matteCoverage` measures how much of a frame the key selects.
 *
 * Matte pipeline: qualifier (H/S/L ranges with per-range softness) ->
 * neighbourhood smoothing (blur + denoise, one 5x5 lattice) -> invert ->
 * optional shape limit (rectangle / ellipse, same shapes as the mask engine).
 * The correction (temperature, tint, wheel, contrast, saturation, sharpen) is
 * mixed with the source through the matte only.
 *
 * `matteView` (1 colour overlay, 2 gray, 3 black/white, 4 bypass) is a
 * TRANSIENT preview-only param injected by the Program monitor; it is never a
 * stored/exported parameter.
 */

export const MATTE_VIEW_OFF = 0;
export const MATTE_VIEW_COLOR = 1;
export const MATTE_VIEW_GRAY = 2;
export const MATTE_VIEW_BW = 3;
/** Show the secondary's input untouched (used while the eyedropper is armed). */
export const MATTE_VIEW_BYPASS = 4;

export type MatteViewMode = 0 | 1 | 2 | 3 | 4;

export type SecondaryMaskShape = "none" | "ellipse" | "rectangle";

/** Lattice tap offsets per axis for the matte smoothing (5x5). */
export const MATTE_LATTICE_HALF = 2;

export interface SecondaryUniforms {
  hMin: number;
  hMax: number;
  hSoft: number;
  sMin: number;
  sMax: number;
  sSoft: number;
  lMin: number;
  lMax: number;
  lSoft: number;
  /** Matte smoothing radius in px (blur + denoise reach). */
  radius: number;
  /** Denoise contrast stretch, 0..1. */
  denoise: number;
  invert: number;
  /** 0 none, 1 ellipse, 2 rectangle. */
  mShape: number;
  /** Mask centre / half extents as fractions of the frame. */
  mCx: number;
  mCy: number;
  mHx: number;
  mHy: number;
  mFeather: number;
  mInvert: number;
  /** Additive RGB offsets of the correction. */
  tempR: number;
  tempG: number;
  tempB: number;
  wheelR: number;
  wheelG: number;
  wheelB: number;
  contrast: number;
  saturation: number;
  sharpen: number;
  view: number;
}

type Raw = Readonly<Record<string, unknown>>;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function numberOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** RGB offsets of the mini colour wheel: angle picks the hue, radius the amount. */
export function secondaryWheelOffset(
  x: number,
  y: number,
): readonly [number, number, number] {
  const magnitude = Math.min(1, Math.hypot(x, y));
  if (magnitude === 0) return [0, 0, 0];
  const theta = Math.atan2(y, x);
  const k = 0.15 * magnitude;
  const third = (2 * Math.PI) / 3;
  return [
    Math.cos(theta) * k,
    Math.cos(theta - third) * k,
    Math.cos(theta + third) * k,
  ];
}

/** Stored params (already resolved or raw) -> the shared numeric struct. */
export function secondaryUniforms(p: Raw): SecondaryUniforms {
  const num = (key: string, fallback: number): number => numberOr(p[key], fallback);
  const temp = clamp(num("temperature", 0), -100, 100) / 100;
  const tint = clamp(num("tint", 0), -100, 100) / 100;
  const wheel = secondaryWheelOffset(
    clamp(num("wheelX", 0), -1, 1),
    clamp(num("wheelY", 0), -1, 1),
  );
  const shape = p.maskShape === "ellipse" ? 1 : p.maskShape === "rectangle" ? 2 : 0;
  const denoise = clamp(num("denoise", 0), 0, 100) / 100;
  const blur = clamp(num("blur", 0), 0, 20);
  const radius = blur + denoise * 4;
  return {
    hMin: clamp(num("hueMin", 0), 0, 360),
    hMax: clamp(num("hueMax", 360), 0, 360),
    hSoft: clamp(num("hueSoft", 0), 0, 180),
    sMin: clamp(num("satMin", 0), 0, 100) / 100,
    sMax: clamp(num("satMax", 100), 0, 100) / 100,
    sSoft: clamp(num("satSoft", 0), 0, 100) / 100,
    lMin: clamp(num("lumMin", 0), 0, 100) / 100,
    lMax: clamp(num("lumMax", 100), 0, 100) / 100,
    lSoft: clamp(num("lumSoft", 0), 0, 100) / 100,
    radius: radius < 0.5 ? 0 : radius,
    denoise,
    invert: p.invert === true ? 1 : 0,
    mShape: shape,
    mCx: clamp(num("maskX", 50), 0, 100) / 100,
    mCy: clamp(num("maskY", 50), 0, 100) / 100,
    mHx: clamp(num("maskW", 50), 0, 100) / 200,
    mHy: clamp(num("maskH", 50), 0, 100) / 200,
    mFeather: clamp(num("maskFeather", 0), 0, 200),
    mInvert: p.maskInvert === true ? 1 : 0,
    tempR: temp * 0.1 + tint * 0.03,
    tempG: -tint * 0.06,
    tempB: -temp * 0.1 + tint * 0.03,
    wheelR: wheel[0],
    wheelG: wheel[1],
    wheelB: wheel[2],
    contrast: 1 + clamp(num("contrast", 0), -100, 100) / 100,
    saturation: 1 + clamp(num("saturation", 0), -100, 100) / 100,
    sharpen: (clamp(num("sharpen", 0), 0, 100) / 100) * 2,
    view: Math.round(clamp(num("matteView", 0), 0, 4)),
  };
}

/** True when the correction changes nothing (the matte is irrelevant). */
export function isSecondaryCorrectionNeutral(u: SecondaryUniforms): boolean {
  return (
    u.tempR === 0 &&
    u.tempG === 0 &&
    u.tempB === 0 &&
    u.wheelR === 0 &&
    u.wheelG === 0 &&
    u.wheelB === 0 &&
    u.contrast === 1 &&
    u.saturation === 1 &&
    u.sharpen === 0
  );
}

/* -------------------------------------------------------------------------- */
/* Qualifier                                                                   */
/* -------------------------------------------------------------------------- */

export interface Hsl {
  /** Degrees, 0..360. */
  h: number;
  /** 0..1. */
  s: number;
  /** 0..1. */
  l: number;
}

/** RGB in 0..1 -> HSL (hue in degrees). Mirrors rgb2hsl in the shader. */
export function rgbToHsl01(r: number, g: number, b: number): Hsl {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) * 0.5;
  const d = mx - mn;
  let s = 0;
  let h = 0;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function linearRangeWeight(v: number, lo: number, hi: number, soft: number): number {
  if (v >= lo && v <= hi) return 1;
  if (soft <= 0) return 0;
  const d = v < lo ? lo - v : v - hi;
  return clamp(1 - d / soft, 0, 1);
}

function hueRangeWeight(h: number, lo: number, hi: number, soft: number): number {
  if (hi - lo >= 359.999) return 1;
  const inside = lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi;
  if (inside) return 1;
  if (soft <= 0) return 0;
  const d = Math.min(circularDistance(h, lo), circularDistance(h, hi));
  return clamp(1 - d / soft, 0, 1);
}

/** Raw (unsmoothed) key for one pixel, 0..1. Inputs are 0..1 RGB. */
export function qualifyPixel(
  u: SecondaryUniforms,
  r: number,
  g: number,
  b: number,
): number {
  const hsl = rgbToHsl01(r, g, b);
  return (
    hueRangeWeight(hsl.h, u.hMin, u.hMax, u.hSoft) *
    linearRangeWeight(hsl.s, u.sMin, u.sMax, u.sSoft) *
    linearRangeWeight(hsl.l, u.lMin, u.lMax, u.lSoft)
  );
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Tap offset k in -2..2 of the lattice of reach `radius`, symmetric rounding. */
export function latticeOffset(k: number, radius: number): number {
  const magnitude = Math.floor((Math.abs(k) * radius) / MATTE_LATTICE_HALF + 0.5);
  return k < 0 ? -magnitude : magnitude;
}

function maskCoverage(
  u: SecondaryUniforms,
  px: number,
  py: number,
  width: number,
  height: number,
): number {
  if (u.mShape === 0) return 1;
  const cx = u.mCx * width;
  const cy = u.mCy * height;
  const hx = u.mHx * width;
  const hy = u.mHy * height;
  let cover = 0;
  if (hx > 0 && hy > 0) {
    let inside: number;
    if (u.mShape === 2) {
      inside = Math.min(hx - Math.abs(px - cx), hy - Math.abs(py - cy));
    } else {
      const q = Math.hypot((px - cx) / hx, (py - cy) / hy);
      inside = (1 - q) * Math.min(hx, hy);
    }
    cover =
      u.mFeather <= 0
        ? inside >= 0
          ? 1
          : 0
        : clamp(0.5 + inside / u.mFeather, 0, 1);
  }
  return u.mInvert > 0.5 ? 1 - cover : cover;
}

/**
 * Final matte for every pixel (0..1, row-major). `data` is straight RGBA bytes.
 */
export function computeSecondaryMatte(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  u: SecondaryUniforms,
): Float32Array {
  const count = width * height;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    raw[i] = qualifyPixel(
      u,
      data[i * 4] / 255,
      data[i * 4 + 1] / 255,
      data[i * 4 + 2] / 255,
    );
  }

  let matte = raw;
  if (u.radius > 0) {
    matte = new Float32Array(count);
    const offsets: number[] = [];
    for (let k = -MATTE_LATTICE_HALF; k <= MATTE_LATTICE_HALF; k++) {
      offsets.push(latticeOffset(k, u.radius));
    }
    const taps = offsets.length * offsets.length;
    const lo = 0.45 * u.denoise;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (const oy of offsets) {
          const yy = clamp(y + oy, 0, height - 1);
          for (const ox of offsets) {
            sum += raw[yy * width + clamp(x + ox, 0, width - 1)];
          }
        }
        let m = sum / taps;
        if (u.denoise > 0) m = smoothstep(lo, 1 - lo, m);
        matte[y * width + x] = m;
      }
    }
  }

  const out = new Float32Array(count);
  const limited = u.mShape !== 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let m = u.invert > 0.5 ? 1 - matte[i] : matte[i];
      if (limited) m *= maskCoverage(u, x + 0.5, y + 0.5, width, height);
      out[i] = m;
    }
  }
  return out;
}

/** Fraction of the frame the matte selects (sum of matte / pixels). */
export function matteCoverage(matte: Float32Array): number {
  if (matte.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < matte.length; i++) sum += matte[i];
  return sum / matte.length;
}

/* -------------------------------------------------------------------------- */
/* Correction                                                                  */
/* -------------------------------------------------------------------------- */

function toByte(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(c * 255);
}

/**
 * CPU reference: mutates straight-alpha RGBA bytes. Alpha is never touched.
 * Neutral correction with no matte view returns without reading anything.
 */
export function applyHslSecondary(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: SecondaryUniforms,
): void {
  if (u.view === MATTE_VIEW_BYPASS) return;
  const showMatte = u.view >= MATTE_VIEW_COLOR && u.view <= MATTE_VIEW_BW;
  if (!showMatte && isSecondaryCorrectionNeutral(u)) return;

  const matte = computeSecondaryMatte(data, width, height, u);

  if (showMatte) {
    for (let i = 0; i < matte.length; i++) {
      const m = matte[i];
      const o = i * 4;
      if (u.view === MATTE_VIEW_COLOR) {
        data[o] = toByte((data[o] / 255) * 0.5 * (1 - m * 0.7) + 1.0 * m * 0.7);
        data[o + 1] = toByte((data[o + 1] / 255) * 0.5 * (1 - m * 0.7) + 0.2 * m * 0.7);
        data[o + 2] = toByte((data[o + 2] / 255) * 0.5 * (1 - m * 0.7) + 0.4 * m * 0.7);
      } else {
        const v = u.view === MATTE_VIEW_BW ? (m >= 0.5 ? 1 : 0) : m;
        data[o] = data[o + 1] = data[o + 2] = toByte(v);
      }
    }
    return;
  }

  const needsSharpen = u.sharpen > 0;
  const source = needsSharpen ? new Uint8ClampedArray(data) : data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const m = matte[i];
      if (m <= 0) continue;
      const o = i * 4;
      const sr = data[o] / 255;
      const sg = data[o + 1] / 255;
      const sb = data[o + 2] / 255;

      let r = sr + u.tempR + u.wheelR;
      let g = sg + u.tempG + u.wheelG;
      let b = sb + u.tempB + u.wheelB;
      r = (r - 0.5) * u.contrast + 0.5;
      g = (g - 0.5) * u.contrast + 0.5;
      b = (b - 0.5) * u.contrast + 0.5;
      const y0 = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y0 + (r - y0) * u.saturation;
      g = y0 + (g - y0) * u.saturation;
      b = y0 + (b - y0) * u.saturation;
      if (needsSharpen) {
        let ar = 0;
        let ag = 0;
        let ab = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clamp(y + dy, 0, height - 1);
          for (let dx = -1; dx <= 1; dx++) {
            const so = (yy * width + clamp(x + dx, 0, width - 1)) * 4;
            ar += source[so];
            ag += source[so + 1];
            ab += source[so + 2];
          }
        }
        r += u.sharpen * (sr - ar / 9 / 255);
        g += u.sharpen * (sg - ag / 9 / 255);
        b += u.sharpen * (sb - ab / 9 / 255);
      }
      r = clamp(r, 0, 1);
      g = clamp(g, 0, 1);
      b = clamp(b, 0, 1);
      data[o] = toByte(sr + (r - sr) * m);
      data[o + 1] = toByte(sg + (g - sg) * m);
      data[o + 2] = toByte(sb + (b - sb) * m);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Eyedropper                                                                  */
/* -------------------------------------------------------------------------- */

export interface SecondaryQualifier {
  hueMin: number;
  hueMax: number;
  hueSoft: number;
  satMin: number;
  satMax: number;
  satSoft: number;
  lumMin: number;
  lumMax: number;
  lumSoft: number;
}

export type EyedropperMode = "set" | "add" | "subtract";

export const QUALIFIER_FULL: Readonly<SecondaryQualifier> = {
  hueMin: 0,
  hueMax: 360,
  hueSoft: 10,
  satMin: 0,
  satMax: 100,
  satSoft: 10,
  lumMin: 0,
  lumMax: 100,
  lumSoft: 10,
};

export function readQualifier(p: Raw): SecondaryQualifier {
  const num = (key: keyof SecondaryQualifier): number =>
    numberOr(p[key], QUALIFIER_FULL[key]);
  return {
    hueMin: num("hueMin"),
    hueMax: num("hueMax"),
    hueSoft: num("hueSoft"),
    satMin: num("satMin"),
    satMax: num("satMax"),
    satSoft: num("satSoft"),
    lumMin: num("lumMin"),
    lumMax: num("lumMax"),
    lumSoft: num("lumSoft"),
  };
}

const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

/** Signed arc distance a -> b going clockwise (0..360). */
const hueForward = (a: number, b: number): number => wrapHue(b - a);

function hueInside(q: SecondaryQualifier, h: number): boolean {
  if (q.hueMax - q.hueMin >= 359.999) return true;
  return q.hueMin <= q.hueMax
    ? h >= q.hueMin && h <= q.hueMax
    : h >= q.hueMin || h <= q.hueMax;
}

/**
 * Eyedropper. `rgb` is the sampled colour in 0..1.
 *  - set: a fresh range around the sample (+-15deg, +-25% sat, +-30% lum).
 *  - add: widen the ranges just enough to include the sample.
 *  - subtract: pull the nearest range edge past the sample so it drops out.
 */
export function qualifierFromSample(
  current: SecondaryQualifier,
  rgb: readonly [number, number, number],
  mode: EyedropperMode,
): SecondaryQualifier {
  const hsl = rgbToHsl01(rgb[0], rgb[1], rgb[2]);
  const h = hsl.h;
  const s = hsl.s * 100;
  const l = hsl.l * 100;
  const margin = 2;

  if (mode === "set") {
    const half = 15;
    const gray = hsl.s < 0.04;
    return {
      ...current,
      hueMin: gray ? 0 : wrapHue(h - half),
      hueMax: gray ? 360 : wrapHue(h + half),
      satMin: clamp(s - 25, 0, 100),
      satMax: clamp(s + 25, 0, 100),
      lumMin: clamp(l - 30, 0, 100),
      lumMax: clamp(l + 30, 0, 100),
    };
  }

  if (mode === "add") {
    const next = { ...current };
    if (!hueInside(current, h)) {
      const toMin = hueForward(h, current.hueMin);
      const fromMax = hueForward(current.hueMax, h);
      if (toMin <= fromMax) next.hueMin = wrapHue(h - margin);
      else next.hueMax = wrapHue(h + margin);
    }
    next.satMin = Math.min(current.satMin, clamp(s - margin, 0, 100));
    next.satMax = Math.max(current.satMax, clamp(s + margin, 0, 100));
    next.lumMin = Math.min(current.lumMin, clamp(l - margin, 0, 100));
    next.lumMax = Math.max(current.lumMax, clamp(l + margin, 0, 100));
    return next;
  }

  // subtract: shrink the channel where the sample sits closest to an edge.
  const next = { ...current };
  const inside =
    hueInside(current, h) &&
    s >= current.satMin &&
    s <= current.satMax &&
    l >= current.lumMin &&
    l <= current.lumMax;
  if (!inside) return next;

  const hueSpan =
    current.hueMax - current.hueMin >= 359.999
      ? 360
      : wrapHue(current.hueMax - current.hueMin) || 360;
  const candidates: Array<{ cost: number; apply: () => void }> = [];
  if (hueSpan < 360) {
    const fromMin = hueForward(current.hueMin, h);
    const toMax = hueForward(h, current.hueMax);
    candidates.push({
      cost: Math.min(fromMin, toMax) / hueSpan,
      apply: () => {
        if (fromMin <= toMax) next.hueMin = wrapHue(h + margin);
        else next.hueMax = wrapHue(h - margin);
      },
    });
  }
  const satSpan = Math.max(1, current.satMax - current.satMin);
  candidates.push({
    cost: Math.min(s - current.satMin, current.satMax - s) / satSpan,
    apply: () => {
      if (s - current.satMin <= current.satMax - s) next.satMin = clamp(s + margin, 0, 100);
      else next.satMax = clamp(s - margin, 0, 100);
    },
  });
  const lumSpan = Math.max(1, current.lumMax - current.lumMin);
  candidates.push({
    cost: Math.min(l - current.lumMin, current.lumMax - l) / lumSpan,
    apply: () => {
      if (l - current.lumMin <= current.lumMax - l) next.lumMin = clamp(l + margin, 0, 100);
      else next.lumMax = clamp(l - margin, 0, 100);
    },
  });
  // A coloured sample is removed by hue (when the hue range can still shrink)
  // so a saturated neighbour that shares its saturation/luma is not dropped;
  // grays and full-circle hue ranges fall back to the cheapest S/L edge.
  if (hsl.s >= 0.08 && hueSpan < 360) {
    candidates[0].apply();
    return next;
  }
  const rest = hueSpan < 360 ? candidates.slice(1) : candidates;
  rest.sort((a, b) => a.cost - b.cost);
  rest[0].apply();
  return next;
}

/** Mean RGB (0..1) of a square window of RGBA bytes, clamped to the frame. */
export function sampleAverageRgb(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius = 2,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.max(0, Math.floor(cy) - radius); y <= Math.min(height - 1, Math.floor(cy) + radius); y++) {
    for (let x = Math.max(0, Math.floor(cx) - radius); x <= Math.min(width - 1, Math.floor(cx) + radius); x++) {
      const o = (y * width + x) * 4;
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      n++;
    }
  }
  if (n === 0) return [0, 0, 0];
  return [r / n / 255, g / n / 255, b / n / 255];
}
