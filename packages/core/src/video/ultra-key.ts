/**
 * Ultra Key: a Premiere-style chroma keyer. This file is the single source of
 * truth for the key math. The CPU reference (applyUltraKey, used by the Canvas2D
 * fallback renderer and export) and the GLSL port in ultra-key-shader.ts are
 * written line for line against it.
 *
 * Pipeline, per pixel (straight-alpha RGBA, origin top-left):
 *
 *  1. Matte generation. Pixel and key colour are converted to BT.601 YCbCr.
 *     Chroma is divided by luma (floored at 0.15) so a shaded part of the
 *     screen keys like a lit one. The chroma distance d to the key decides
 *     how keyed the pixel is:
 *       core  = tolerance / 100 * 0.7      (fully keyed inside this radius)
 *       width = transparency / 100 * 0.45  (soft falloff outside the core)
 *       keyed = 1 - clamp((d - core) / width)
 *     Highlight and Shadow then protect pixels much brighter / darker than the
 *     key (whose chroma is unreliable) by pulling the key back towards opaque, and Pedestal clips
 *     the lowest opacities to fully transparent (grey noise in the screen).
 *  2. Matte cleanup. Choke erodes the matte (minimum over a disc), Soften
 *     blurs it (average over a disc), Contrast steepens it around Mid Point.
 *     Both radii are in 1080p pixels and scale with the frame height.
 *  3. Spill suppression on the foreground. Chroma that points towards the key
 *     hue (within Range) has its key-direction component removed by Spill,
 *     soft edge pixels are Desaturated and Luma gives back brightness.
 *  4. Colour correction (Saturation, Hue, Luminance) of the foreground.
 *  5. Output: composite (colour + matte), alpha channel (matte as grey) or
 *     colour channel (the corrected foreground, matte ignored).
 */

export const ULTRA_KEY_OUTPUTS = ["composite", "alpha", "color", "source"] as const;
export type UltraKeyOutput = (typeof ULTRA_KEY_OUTPUTS)[number];

export interface UltraKeyParams {
  keyR: number;
  keyG: number;
  keyB: number;
  transparency: number;
  highlight: number;
  shadow: number;
  tolerance: number;
  pedestal: number;
  choke: number;
  soften: number;
  contrast: number;
  midPoint: number;
  desaturate: number;
  range: number;
  spill: number;
  luma: number;
  saturation: number;
  hue: number;
  luminance: number;
  output: UltraKeyOutput | string;
}

/** BT.601 chroma scale factors (Cb, Cr in -0.5..0.5 for RGB in 0..1). */
const KB = 0.564;
const KR = 0.713;
const CORE_MAX = 0.7;
const BAND_MAX = 0.45;
/** Luma floor of the chroma normalisation, so near-black pixels do not blow up. */
const Y_FLOOR = 0.15;
/** Luma given back per unit of removed spill chroma at Luma = 100. */
const LUMA_RESTORE = 0.35;
const GOLDEN_ANGLE = 2.399963229728653;

/** Everything derived from the parameters once per frame (shared with the GPU uniforms). */
export interface UltraKeyPrep {
  kCb: number;
  kCr: number;
  /** Key luma (floored); highlight and shadow are relative to it. */
  kLuma: number;
  core: number;
  band: number;
  hasKey: boolean;
  highlight: number;
  shadow: number;
  pedestal: number;
  chokeRadius: number;
  chokeCount: number;
  softenRadius: number;
  softenCount: number;
  contrastGain: number;
  midPoint: number;
  /** Unit key chroma direction, or 0,0 for a grey key. */
  uCb: number;
  uCr: number;
  spill: number;
  desaturate: number;
  cosIn: number;
  cosOut: number;
  rangeOn: boolean;
  luma: number;
  satGain: number;
  hueCos: number;
  hueSin: number;
  lumGain: number;
  colorActive: boolean;
  output: 0 | 1 | 2 | 3;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Neighbourhood sample count for a cleanup disc of `radius` pixels. */
export function ultraKeyKernelCount(radius: number, max: number): number {
  return Math.min(max, Math.max(6, Math.ceil(radius * 2) + 4));
}

const OUTPUT_INDEX: Record<string, 0 | 1 | 2 | 3> = { composite: 0, alpha: 1, color: 2, source: 3 };

export function prepareUltraKey(p: UltraKeyParams, height: number): UltraKeyPrep {
  const kr = clamp(p.keyR, 0, 255) / 255;
  const kg = clamp(p.keyG, 0, 255) / 255;
  const kb = clamp(p.keyB, 0, 255) / 255;
  const ky = 0.299 * kr + 0.587 * kg + 0.114 * kb;
  const rawCb = (kb - ky) * KB;
  const rawCr = (kr - ky) * KR;
  const kMag = Math.hypot(rawCb, rawCr);
  const ks = Math.max(ky, Y_FLOOR);
  const kCb = rawCb / ks;
  const kCr = rawCr / ks;
  const core = (clamp(p.tolerance, 0, 100) / 100) * CORE_MAX;
  const band = (clamp(p.transparency, 0, 100) / 100) * BAND_MAX;
  const scale = Math.max(1, height) / 1080;
  const chokeRadius = (clamp(p.choke, 0, 100) / 100) * 10 * scale;
  const softenRadius = (clamp(p.soften, 0, 100) / 100) * 10 * scale;
  const range = clamp(p.range, 0, 100);
  const halfAngle = (range / 100) * (Math.PI / 2);
  const spill = clamp(p.spill, 0, 100) / 100;
  const desaturate = clamp(p.desaturate, 0, 100) / 100;
  const hueRad = (clamp(p.hue, -180, 180) * Math.PI) / 180;
  const satGain = clamp(p.saturation, 0, 200) / 100;
  const lumGain = clamp(p.luminance, 0, 200) / 100;
  const luma = clamp(p.luma, 0, 100) / 100;
  const spillActive = kMag > 1e-4 && range > 0 && (spill > 0 || desaturate > 0);
  const colorActive =
    spillActive || satGain !== 1 || hueRad !== 0 || lumGain !== 1;
  return {
    kCb,
    kCr,
    kLuma: ks,
    core,
    band,
    hasKey: core > 0 || band > 0,
    highlight: clamp(p.highlight, 0, 100) / 100,
    shadow: clamp(p.shadow, 0, 100) / 100,
    pedestal: Math.min(clamp(p.pedestal, 0, 100) / 100, 0.999),
    chokeRadius,
    chokeCount: ultraKeyKernelCount(chokeRadius, 12),
    softenRadius,
    softenCount: ultraKeyKernelCount(softenRadius, 16),
    contrastGain: 1 + (clamp(p.contrast, 0, 100) / 100) * 7,
    midPoint: clamp(p.midPoint, 0, 100) / 100,
    uCb: kMag > 1e-4 ? rawCb / kMag : 0,
    uCr: kMag > 1e-4 ? rawCr / kMag : 0,
    spill,
    desaturate,
    cosIn: Math.cos(halfAngle * 0.5),
    cosOut: Math.cos(halfAngle),
    rangeOn: spillActive,
    luma,
    satGain,
    hueCos: Math.cos(hueRad),
    hueSin: Math.sin(hueRad),
    lumGain,
    colorActive,
    output: OUTPUT_INDEX[String(p.output)] ?? 0,
  };
}

/** Opacity (1 keeps the pixel) of the raw matte at one pixel, before cleanup. Inputs are 0-255. */
export function ultraKeyBaseMatte(r255: number, g255: number, b255: number, u: UltraKeyPrep): number {
  if (!u.hasKey) return 1;
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = Math.max(y, Y_FLOOR);
  const d = Math.hypot(((b - y) * KB) / s - u.kCb, ((r - y) * KR) / s - u.kCr);
  let keyed: number;
  if (u.band > 0) keyed = clamp(1 - (d - u.core) / u.band, 0, 1);
  else keyed = d <= u.core ? 1 : 0;
  const ratio = y / u.kLuma;
  keyed *= (1 - u.highlight * smoothstep(1.15, 1.75, ratio)) * (1 - u.shadow * (1 - smoothstep(0.1, 0.6, ratio)));
  const a = 1 - keyed;
  return clamp((a - u.pedestal) / (1 - u.pedestal), 0, 1);
}

/** Matte value after Contrast / Mid Point. */
export function ultraKeyContrast(a: number, u: UltraKeyPrep): number {
  if (u.contrastGain === 1) return a;
  return clamp((a - u.midPoint) * u.contrastGain + u.midPoint, 0, 1);
}

/** Integer pixel offsets of the golden-angle disc (index i of n samples). */
export function ultraKeyOffset(i: number, n: number, radius: number): [number, number] {
  const rho = radius * Math.sqrt((i + 0.5) / n);
  const th = i * GOLDEN_ANGLE;
  return [Math.floor(rho * Math.cos(th) + 0.5), Math.floor(rho * Math.sin(th) + 0.5)];
}

/**
 * Foreground colour after spill suppression and colour correction for a pixel
 * whose final matte value is `alpha`. Inputs and outputs are 0-1.
 */
export function ultraKeyForeground(
  r: number,
  g: number,
  b: number,
  alpha: number,
  u: UltraKeyPrep,
  out: [number, number, number],
): void {
  if (!u.colorActive) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return;
  }
  let y = 0.299 * r + 0.587 * g + 0.114 * b;
  let cb = (b - y) * KB;
  let cr = (r - y) * KR;
  if (u.rangeOn) {
    const mag = Math.hypot(cb, cr);
    const proj = cb * u.uCb + cr * u.uCr;
    if (mag > 1e-5 && proj > 0) {
      const w = clamp((proj / mag - u.cosOut) / (u.cosIn - u.cosOut + 1e-6), 0, 1);
      const hw = w * w * (3 - 2 * w);
      const rem = proj * u.spill * hw;
      cb -= u.uCb * rem;
      cr -= u.uCr * rem;
      const f = 1 - u.desaturate * hw * (1 - alpha);
      cb *= f;
      cr *= f;
      y += u.luma * LUMA_RESTORE * rem;
    }
  }
  const rotCb = cb * u.hueCos - cr * u.hueSin;
  const rotCr = cb * u.hueSin + cr * u.hueCos;
  cb = rotCb * u.satGain;
  cr = rotCr * u.satGain;
  y *= u.lumGain;
  const nr = y + cr / KR;
  const nb = y + cb / KB;
  const ng = (y - 0.299 * nr - 0.114 * nb) / 0.587;
  out[0] = clamp(nr, 0, 1);
  out[1] = clamp(ng, 0, 1);
  out[2] = clamp(nb, 0, 1);
}

/** True when the parameters leave the picture unchanged. */
export function isUltraKeyNeutral(p: UltraKeyParams): boolean {
  const u = prepareUltraKey(p, 1080);
  return u.output === 0 && !u.hasKey && !u.colorActive;
}

/** CPU reference. Mutates straight-alpha RGBA bytes. */
export function applyUltraKey(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  p: UltraKeyParams,
): void {
  const u = prepareUltraKey(p, height);
  if (u.output === 3) return;
  if (!u.hasKey && !u.colorActive && u.output === 0) return;
  const total = width * height;
  let matte: Float32Array = new Float32Array(total);
  for (let i = 0, o = 0; i < total; i++, o += 4) {
    matte[i] = ultraKeyBaseMatte(data[o], data[o + 1], data[o + 2], u);
  }
  if (u.hasKey && u.chokeRadius > 0) matte = disc(matte, width, height, u.chokeRadius, u.chokeCount, "min");
  if (u.hasKey && u.softenRadius > 0) matte = disc(matte, width, height, u.softenRadius, u.softenCount, "mean");
  const fg: [number, number, number] = [0, 0, 0];
  for (let i = 0, o = 0; i < total; i++, o += 4) {
    const a = ultraKeyContrast(matte[i], u);
    if (u.output === 1) {
      const v = Math.round(a * data[o + 3]);
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
      continue;
    }
    ultraKeyForeground(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, a, u, fg);
    if (u.colorActive) {
      data[o] = Math.round(fg[0] * 255);
      data[o + 1] = Math.round(fg[1] * 255);
      data[o + 2] = Math.round(fg[2] * 255);
    }
    if (u.output === 0 && a < 1) data[o + 3] = Math.round(data[o + 3] * a);
  }
}

function disc(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  count: number,
  mode: "min" | "mean",
): Float32Array {
  const dst = new Float32Array(src.length);
  const offsets: [number, number][] = [];
  for (let i = 0; i < count; i++) offsets.push(ultraKeyOffset(i, count, radius));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = src[y * width + x];
      for (const [dx, dy] of offsets) {
        const sx = clamp(x + dx, 0, width - 1);
        const sy = clamp(y + dy, 0, height - 1);
        const v = src[sy * width + sx];
        if (mode === "min") {
          if (v < acc) acc = v;
        } else acc += v;
      }
      dst[y * width + x] = mode === "min" ? acc : acc / (count + 1);
    }
  }
  return dst;
}

/** Uniform values for the GLSL port (names without `u_`). Radii are 1080p pixels. */
export function ultraKeyGpuUniforms(p: UltraKeyParams): Record<string, number> {
  const u = prepareUltraKey(p, 1080);
  return {
    kCb: u.kCb,
    kCr: u.kCr,
    kLuma: u.kLuma,
    core: u.core,
    band: u.band,
    hasKey: u.hasKey ? 1 : 0,
    highlight: u.highlight,
    shadow: u.shadow,
    pedestal: u.pedestal,
    // Radii at 1080p; the shader scales them by its own frame height.
    chokeRadius: u.hasKey ? u.chokeRadius : 0,
    softenRadius: u.hasKey ? u.softenRadius : 0,
    contrastGain: u.contrastGain,
    midPoint: u.midPoint,
    uCb: u.uCb,
    uCr: u.uCr,
    spill: u.spill,
    desaturate: u.desaturate,
    cosIn: u.cosIn,
    cosOut: u.cosOut,
    rangeOn: u.rangeOn ? 1 : 0,
    lumaRestore: u.luma * LUMA_RESTORE,
    satGain: u.satGain,
    hueCos: u.hueCos,
    hueSin: u.hueSin,
    lumGain: u.lumGain,
    colorActive: u.colorActive ? 1 : 0,
    output: u.output,
  };
}

export const ULTRA_KEY_UNIFORM_NAMES = Object.keys(
  ultraKeyGpuUniforms(
    {
      keyR: 0, keyG: 255, keyB: 0, transparency: 0, highlight: 0, shadow: 0, tolerance: 0,
      pedestal: 0, choke: 0, soften: 0, contrast: 0, midPoint: 50, desaturate: 0, range: 0,
      spill: 0, luma: 0, saturation: 100, hue: 0, luminance: 100, output: "composite",
    },
  ),
);

/**
 * Key colour that best represents a sampled region of a frame: the average
 * RGB, 0-255. Used by the Program monitor eyedropper.
 */
export function ultraKeyColorFromSample(rgb: { r: number; g: number; b: number }): {
  keyR: number;
  keyG: number;
  keyB: number;
} {
  const c = (v: number): number => Math.round(clamp(v, 0, 255));
  return { keyR: c(rgb.r), keyG: c(rgb.g), keyB: c(rgb.b) };
}
