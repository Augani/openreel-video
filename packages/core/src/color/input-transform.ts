import { BT709_TO_BT2020, HLG_SDR_WHITE_SCENE, PQ_SDR_WHITE_NITS, linearToSrgb, pqDecodeToNits, srgbToLinear } from "../export/color-output";
import { cameraGamutToBt709, decodeCameraLog, type CameraGamutId } from "./camera-log";
import { acescctDecode } from "./aces";
import { isCameraLogTransfer, needsInputTransform, type SourceColorSpace } from "./source-color";

/**
 * Input transform: footage in its own colour space -> the editor's working
 * image (display-referred sRGB / Rec.709, 8-bit canvas values).
 *
 *   code values -> scene/display-linear (1.0 = SDR reference white, 203 nits)
 *   -> source primaries to BT.709 primaries (3x3 in linear light)
 *   -> highlight tone map (HDR sources only, documented below)
 *   -> gamut clip -> sRGB OETF
 *
 * The same function runs in the preview and in the export renderer, so the two
 * cannot disagree. Sources that are already Rec.709 / sRGB SDR have no
 * transform at all (`createInputTransform` returns null) and their pixels are
 * never touched.
 *
 * Tone map (SDR outputs). PQ and HLG footage carries highlights above SDR
 * white (PQ up to 10 000 nits, HLG to about 3.8x white). The 8-bit sRGB
 * working image cannot hold them, so the luminance is rolled off with an
 * exponential shoulder:
 *
 *   Y' = Y                                      for Y <= K   (K = 0.85)
 *   Y' = K + (1-K) * (1 - exp(-(Y-K)/(1-K)))    for Y >  K
 *
 * The shoulder starts with slope 1 (C1-continuous), is monotonic and tends to
 * 1.0, so it never overshoots. SDR reference white (Y = 1.0) lands at 0.945
 * linear (sRGB code about 247). RGB is scaled by Y'/Y so hue and saturation
 * are kept; channels still above 1 after the gamut conversion are clipped.
 * No HLG system OOTF (gamma 1.2) is applied: HLG is read as scene light
 * scaled so signal 0.75 = SDR white, matching how the HLG export encodes it
 * (BT.2408), which makes an HLG round trip consistent.
 */

export const TONE_MAP_KNEE = 0.85;

type Matrix3 = readonly [readonly number[], readonly number[], readonly number[]];

function invert3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Linear BT.2020 -> linear BT.709 (the inverse of the export-side matrix, rows sum to 1). */
export const BT2020_TO_BT709: Matrix3 = invert3(BT709_TO_BT2020);

/** Linear Display-P3 (D65) -> linear BT.709. */
export const P3_TO_BT709: Matrix3 = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

/** Inverse of the BT.2100 HLG OETF: signal 0..1 to scene-linear 0..1. */
export function hlgInverseOetf(signal: number): number {
  const v = Math.max(0, Math.min(1, signal));
  return v <= 0.5 ? (v * v) / 3 : (Math.exp((v - HLG_C) / HLG_A) + HLG_B) / 12;
}

/** Signal 0..1 to linear light where 1.0 = SDR reference white. */
export function decodeSourceTransfer(signal: number, transfer: SourceColorSpace["transfer"]): number {
  if (isCameraLogTransfer(transfer)) return decodeCameraLog(signal, transfer);
  switch (transfer) {
    case "pq":
      return pqDecodeToNits(signal) / PQ_SDR_WHITE_NITS;
    case "hlg":
      return hlgInverseOetf(signal) / HLG_SDR_WHITE_SCENE;
    case "linear":
      return signal;
    case "acescct":
      return acescctDecode(signal);
    default:
      return srgbToLinear(signal);
  }
}

/** The luminance roll-off applied to HDR sources (see the module comment). */
export function toneMapLuminance(y: number): number {
  if (y <= TONE_MAP_KNEE) return y;
  const range = 1 - TONE_MAP_KNEE;
  return TONE_MAP_KNEE + range * (1 - Math.exp(-(y - TONE_MAP_KNEE) / range));
}

export interface InputTransform {
  readonly source: SourceColorSpace;
  /** Stable identity for caching: equal keys mean the same pixel function. */
  readonly key: string;
  readonly toneMap: boolean;
  readonly matrix: Matrix3 | null;
  /** 256-entry decode of an 8-bit code to linear light. */
  readonly decodeLut: Float32Array;
}

function primariesToBt709(primaries: SourceColorSpace["primaries"]): Matrix3 | null {
  switch (primaries) {
    case "bt2020":
      return BT2020_TO_BT709;
    case "p3":
      return P3_TO_BT709;
    case "bt709":
    case "bt601":
      return null;
    default:
      return cameraGamutToBt709(primaries as CameraGamutId);
  }
}

export function inputTransformKey(source: SourceColorSpace): string {
  return `${source.primaries}/${source.transfer}`;
}

/** Null when the source is plain SDR Rec.709/sRGB: no transform, pixels untouched. */
export function createInputTransform(source: SourceColorSpace): InputTransform | null {
  if (!needsInputTransform(source)) return null;
  const decodeLut = new Float32Array(256);
  for (let i = 0; i < 256; i++) decodeLut[i] = decodeSourceTransfer(i / 255, source.transfer);
  return {
    source,
    key: inputTransformKey(source),
    // Camera log scene light goes through the same shoulder: log footage holds highlights far above white.
    toneMap:
      source.transfer === "pq" ||
      source.transfer === "hlg" ||
      source.transfer === "acescct" ||
      source.primaries === "ap0" ||
      source.primaries === "ap1" ||
      isCameraLogTransfer(source.transfer),
    matrix: primariesToBt709(source.primaries),
    decodeLut,
  };
}

const ENCODE_SIZE = 4096;
let encodeLut: Float32Array | null = null;
/** sRGB OETF of linear 0..1, tabulated against sqrt(linear) for resolution near black. */
function srgbEncodeFast(linear: number): number {
  if (!encodeLut) {
    encodeLut = new Float32Array(ENCODE_SIZE + 1);
    for (let i = 0; i <= ENCODE_SIZE; i++) {
      const root = i / ENCODE_SIZE;
      encodeLut[i] = linearToSrgb(root * root);
    }
  }
  const clamped = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const position = Math.sqrt(clamped) * ENCODE_SIZE;
  const lower = Math.floor(position);
  const upper = lower >= ENCODE_SIZE ? ENCODE_SIZE : lower + 1;
  return encodeLut[lower] + (encodeLut[upper] - encodeLut[lower]) * (position - lower);
}

/** One pixel, 0..1 code values in and out (the reference the bulk path repeats). */
export function transformPixel(r: number, g: number, b: number, t: InputTransform): [number, number, number] {
  return transformCodes(
    t.decodeLut[Math.round(Math.max(0, Math.min(1, r)) * 255)],
    t.decodeLut[Math.round(Math.max(0, Math.min(1, g)) * 255)],
    t.decodeLut[Math.round(Math.max(0, Math.min(1, b)) * 255)],
    t,
  );
}

function transformCodes(lr: number, lg: number, lb: number, t: InputTransform): [number, number, number] {
  if (t.matrix) {
    const [m0, m1, m2] = t.matrix;
    const r = m0[0] * lr + m0[1] * lg + m0[2] * lb;
    const g = m1[0] * lr + m1[1] * lg + m1[2] * lb;
    const b = m2[0] * lr + m2[1] * lg + m2[2] * lb;
    lr = r;
    lg = g;
    lb = b;
  }
  if (t.toneMap) {
    const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    if (y > TONE_MAP_KNEE) {
      const scale = toneMapLuminance(y) / y;
      lr *= scale;
      lg *= scale;
      lb *= scale;
    }
  }
  return [srgbEncodeFast(lr), srgbEncodeFast(lg), srgbEncodeFast(lb)];
}

/** Transforms an RGBA frame in place. Alpha is untouched. */
export function applyInputTransformToRgba(rgba: Uint8ClampedArray, t: InputTransform): void {
  const lut = t.decodeLut;
  for (let o = 0; o < rgba.length; o += 4) {
    const [r, g, b] = transformCodes(lut[rgba[o]], lut[rgba[o + 1]], lut[rgba[o + 2]], t);
    rgba[o] = Math.round(r * 255);
    rgba[o + 1] = Math.round(g * 255);
    rgba[o + 2] = Math.round(b * 255);
  }
}

/**
 * Applies the transform to a decoded frame and returns a new bitmap; the input
 * bitmap is left for the caller to close. Used by the preview and the export
 * renderer at the same stage (before effects and grading).
 */
export async function applyInputTransformToBitmap(image: ImageBitmap, t: InputTransform): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  applyInputTransformToRgba(data.data, t);
  ctx.putImageData(data, 0, 0);
  return createImageBitmap(canvas);
}

const transformCache = new Map<string, InputTransform | null>();

/** Cached `createInputTransform`, keyed by primaries/transfer. */
export function inputTransformFor(source: SourceColorSpace | null): InputTransform | null {
  if (!source) return null;
  const key = inputTransformKey(source);
  if (!transformCache.has(key)) transformCache.set(key, createInputTransform(source));
  return transformCache.get(key) ?? null;
}
