import { BT709_TO_BT2020, PQ_SDR_WHITE_NITS, pqDecodeToNits, pqEncodeNits, srgbToLinear } from "../export/color-output";
import type { HdrLayerPixels } from "./hdr-working";

/**
 * Layer effects that run on the float image of the HDR working mode (blur, sharpen, glow).
 *
 * They run on the clip's own frame, before the grade and the transform, like the 8-bit effect stack does, but on
 * scene-linear BT.2020 floats: a highlight at 1000 nits blurs into its neighbours at 1000 nits, it is not clipped
 * to 8 bits first. `hdr-gpu.ts` runs the same arithmetic as fragment passes on RGBA16F textures; this file is the
 * Float32 reference they are compared against.
 *
 *   blur     separable Gaussian, sigma = radius px (the CSS / Canvas `blur()` convention), taps are integer pixel
 *            offsets clamped to the frame edge, on premultiplied colour so transparent edges do not bleed black.
 *   sharpen  the 8-bit 4-neighbour kernel (centre 1 + 4k, neighbours -k, k = amount / 100) on the PQ working
 *            encoding, so the halo follows perceived contrast rather than raw light ratios.
 *   glow     a bloom of the Gaussian-blurred frame: bright-pass with the 8-bit effect's brightness 1.25 and
 *            contrast 1.5 about mid grey (on the extended sRGB encoding of the linear light), then a "screen" onto
 *            the frame that is exact up to SDR white and adds light above it (screen is undefined above 1.0).
 */

export type HdrLayerEffect =
  | { readonly type: "blur"; readonly radius: number }
  | { readonly type: "sharpen"; readonly amount: number }
  | {
      readonly type: "glow";
      readonly radius: number;
      readonly intensity: number;
      /** Linear BT.2020 multiplier of the glow colour; null for white. */
      readonly tint: readonly [number, number, number] | null;
    };

export const HDR_FLOAT_EFFECT_TYPES: readonly string[] = ["blur", "sharpen", "glow"];

/** Widest Gaussian half-kernel (taps each side). Wider sigmas are truncated, which loses < 1 % of the weight at sigma 21. */
export const BLUR_MAX_HALF = 64;
export const BLUR_MAX_RADIUS = 100;
export const GLOW_BRIGHTNESS = 1.25;
export const GLOW_CONTRAST = 1.5;
export const GLOW_ALPHA_PER_INTENSITY = 0.6;

function numberOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export interface GaussianKernel {
  readonly sigma: number;
  readonly half: number;
  /** Sum of the unnormalised weights over -half..half. */
  readonly norm: number;
}

export function gaussianKernel(radius: number): GaussianKernel {
  const sigma = Math.max(0.1, Math.min(BLUR_MAX_RADIUS, radius));
  const half = Math.min(BLUR_MAX_HALF, Math.max(1, Math.ceil(sigma * 3)));
  let norm = 0;
  for (let i = -half; i <= half; i++) norm += Math.exp(-(i * i) / (2 * sigma * sigma));
  return { sigma, half, norm };
}

/** sRGB OETF extended above 1.0 (the formula is monotonic there) so highlights keep their ordering. */
export function extSrgbEncode(linear: number): number {
  const v = Math.max(0, linear);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function extSrgbDecode(signal: number): number {
  const v = Math.max(0, signal);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function parseHexColor(color: unknown): [number, number, number] | null {
  if (typeof color !== "string") return null;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const channel = (i: number): number => parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
  return [channel(0), channel(1), channel(2)];
}

/** Hex colour (sRGB, BT.709 primaries) to the linear BT.2020 triple the glow multiplies by. White is null. */
export function glowTint(color: unknown): [number, number, number] | null {
  const rgb = parseHexColor(color);
  if (!rgb || (rgb[0] === 1 && rgb[1] === 1 && rgb[2] === 1)) return null;
  const lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  const out = BT709_TO_BT2020.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  return [out[0], out[1], out[2]];
}

export interface HdrEffectInput {
  readonly type: string;
  readonly enabled: boolean;
  readonly params?: Record<string, unknown>;
}

export interface ResolvedHdrEffects {
  /** The enabled, non-neutral effects in stack order. */
  readonly effects: HdrLayerEffect[];
  /** True when an enabled effect has no float implementation: the clip then renders on the 8-bit path. */
  readonly unsupported: boolean;
}

export function resolveHdrEffects(input: readonly HdrEffectInput[]): ResolvedHdrEffects {
  const effects: HdrLayerEffect[] = [];
  let unsupported = false;
  for (const effect of input) {
    if (!effect.enabled) continue;
    const params = effect.params ?? {};
    switch (effect.type) {
      case "blur": {
        const radius = Math.max(0, Math.min(BLUR_MAX_RADIUS, numberOr(params.radius, 0)));
        if (radius > 0) effects.push({ type: "blur", radius });
        break;
      }
      case "sharpen": {
        const amount = Math.max(-100, Math.min(100, numberOr(params.amount, 0)));
        if (amount !== 0) effects.push({ type: "sharpen", amount });
        break;
      }
      case "glow": {
        const radius = Math.max(0, Math.min(BLUR_MAX_RADIUS, numberOr(params.radius, 0)));
        const intensity = Math.max(0, Math.min(3, numberOr(params.intensity, 1)));
        if (radius > 0 && intensity > 0) effects.push({ type: "glow", radius, intensity, tint: glowTint(params.color) });
        break;
      }
      default:
        unsupported = true;
    }
  }
  return { effects, unsupported };
}

/** Glow strength of the screen blend, as the 8-bit effect's globalAlpha. */
export function glowWeight(intensity: number): number {
  return Math.min(1, GLOW_ALPHA_PER_INTENSITY * intensity);
}

// -- CPU reference ------------------------------------------------------------------------------------------------

function blurPremultiplied(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const { sigma, half, norm } = gaussianKernel(radius);
  const weights = new Float32Array(half * 2 + 1);
  for (let i = -half; i <= half; i++) weights[i + half] = Math.exp(-(i * i) / (2 * sigma * sigma)) / norm;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = -half; i <= half; i++) {
          const xx = Math.max(0, Math.min(width - 1, x + i));
          sum += src[(y * width + xx) * 4 + c] * weights[i + half];
        }
        tmp[o + c] = sum;
      }
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = -half; i <= half; i++) {
          const yy = Math.max(0, Math.min(height - 1, y + i));
          sum += tmp[(yy * width + x) * 4 + c] * weights[i + half];
        }
        out[o + c] = sum;
      }
    }
  }
  return out;
}

function premultiply(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let o = 0; o < data.length; o += 4) {
    const a = data[o + 3];
    out[o] = data[o] * a;
    out[o + 1] = data[o + 1] * a;
    out[o + 2] = data[o + 2] * a;
    out[o + 3] = a;
  }
  return out;
}

function unpremultiply(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let o = 0; o < data.length; o += 4) {
    const a = data[o + 3];
    if (a > 0) {
      out[o] = data[o] / a;
      out[o + 1] = data[o + 1] / a;
      out[o + 2] = data[o + 2] / a;
    }
    out[o + 3] = a;
  }
  return out;
}

const linearToPq = (linear: number): number => pqEncodeNits(Math.max(0, linear) * PQ_SDR_WHITE_NITS);
const pqToLinear = (signal: number): number => pqDecodeToNits(signal) / PQ_SDR_WHITE_NITS;

function sharpenStraight(data: Float32Array, width: number, height: number, amount: number): Float32Array {
  const k = amount / 100;
  const n = width * height;
  const pq = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    pq[p * 3] = linearToPq(data[p * 4]);
    pq[p * 3 + 1] = linearToPq(data[p * 4 + 1]);
    pq[p * 3 + 2] = linearToPq(data[p * 4 + 2]);
  }
  const out = new Float32Array(data.length);
  const at = (x: number, y: number, c: number): number =>
    pq[(Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 3 + c];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const centre = at(x, y, c);
        const v = centre * (1 + 4 * k) - k * (at(x, y - 1, c) + at(x, y + 1, c) + at(x - 1, y, c) + at(x + 1, y, c));
        out[o + c] = pqToLinear(Math.max(0, Math.min(1, v)));
      }
      out[o + 3] = data[o + 3];
    }
  }
  return out;
}

/** Glow of straight-alpha data. `blurred` is the premultiplied Gaussian of the same frame. */
export function glowCombine(
  straight: Float32Array,
  blurred: Float32Array,
  intensity: number,
  tint: readonly [number, number, number] | null,
): Float32Array {
  const w = glowWeight(intensity);
  const out = new Float32Array(straight.length);
  for (let o = 0; o < straight.length; o += 4) {
    const a = straight[o + 3];
    const ba = blurred[o + 3];
    const alpha = a + (1 - a) * Math.min(1, w * ba);
    for (let c = 0; c < 3; c++) {
      const premult = straight[o + c] * a;
      const bright = Math.max(0, (extSrgbEncode(blurred[o + c]) * GLOW_BRIGHTNESS - 0.5) * GLOW_CONTRAST + 0.5);
      const glow = extSrgbDecode(bright) * w * (tint ? tint[c] : 1);
      const lit = premult + glow * (1 - Math.max(0, Math.min(1, premult)));
      out[o + c] = alpha > 0 ? lit / alpha : 0;
    }
    out[o + 3] = alpha;
  }
  return out;
}

/** Runs the effect stack over a decoded layer (straight alpha, scene-linear BT.2020). */
export function applyHdrEffects(layer: HdrLayerPixels, effects: readonly HdrLayerEffect[]): HdrLayerPixels {
  if (effects.length === 0) return layer;
  const { width, height } = layer;
  let data = layer.data;
  for (const effect of effects) {
    if (effect.type === "blur") {
      data = unpremultiply(blurPremultiplied(premultiply(data), width, height, effect.radius));
    } else if (effect.type === "sharpen") {
      data = sharpenStraight(data, width, height, effect.amount);
    } else {
      const blurred = blurPremultiplied(premultiply(data), width, height, effect.radius);
      data = glowCombine(data, blurred, effect.intensity, effect.tint);
    }
  }
  return { width, height, data };
}
