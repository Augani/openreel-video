import type { ProjectSettings, WorkingColorSpace } from "../types/project";
import type { HdrTransfer } from "./types";
import { getEncoderBackendFactory } from "./encoder-backend";

/**
 * Output colour: how the sequence's working colour space and the HDR export
 * option become pixels and container metadata.
 *
 * The preview and every effect run on display-referred sRGB / Rec.709 canvas
 * values, so the conversion happens once, at the end of the export pipeline:
 *
 *   sRGB code values -> linear light -> BT.709-to-BT.2020 primaries -> transfer
 *   (BT.709/sRGB, PQ or HLG) -> BT.2020 non-constant-luminance YCbCr
 *
 * and the resulting planes are handed to the encoder as an already-tagged
 * frame. The container's `colr` box (and the encoder's decoder config) then
 * report BT.2020 primaries and the chosen transfer function.
 *
 * These 8-bit converters (`rgbaToYuv420` / `rgbaToYuv444`) are the classic path. When the project works in
 * Rec.2020 or an HDR export runs, the video engine composes in half-float scene-linear Rec.2020 instead and the
 * encoder planes come from the float image (color/hdr-working.ts, `hdrFrameToYuv`), so highlights above SDR white
 * survive. See docs/colour-management.md.
 */

export interface OutputColorSpec {
  readonly primaries: "bt709" | "bt2020";
  readonly transfer: "bt709" | "pq" | "hlg";
  readonly matrix: "bt709" | "bt2020-ncl";
  readonly fullRange: false;
  readonly bitDepth: 8 | 10;
}

/** The colour-space fields a VideoColorSpaceInit / decoder config carries. */
export interface OutputVideoColorSpace {
  primaries: "bt709" | "bt2020";
  transfer: "bt709" | "pq" | "hlg";
  matrix: "bt709" | "bt2020-ncl";
  fullRange: boolean;
}

/** HEVC Main10, level 5.1: the 10-bit profile the HDR export asks the encoder for. */
export const HDR_HEVC_CODEC_STRING = "hvc1.2.4.L153.B0";

/** SDR reference white in nits for PQ output (ITU-R BT.2408). */
export const PQ_SDR_WHITE_NITS = 203;
/** Scene-linear level SDR white maps to in HLG so it lands at signal 0.75 (BT.2408). */
export const HLG_SDR_WHITE_SCENE = 0.2646;

export function resolveWorkingColorSpace(
  settings: Pick<ProjectSettings, "workingColorSpace"> | undefined,
): WorkingColorSpace {
  return settings?.workingColorSpace === "rec2020" ? "rec2020" : "rec709";
}

/**
 * `null` means the classic SDR path: frames are encoded exactly as before and
 * nothing is tagged, so a Rec.709 sequence without HDR exports identically to
 * earlier versions.
 */
export function resolveOutputColorSpec(
  working: WorkingColorSpace | undefined,
  hdr: HdrTransfer | undefined,
): OutputColorSpec | null {
  if (hdr === "pq" || hdr === "hlg") {
    return { primaries: "bt2020", transfer: hdr, matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 };
  }
  if (working === "rec2020") {
    return { primaries: "bt2020", transfer: "bt709", matrix: "bt2020-ncl", fullRange: false, bitDepth: 8 };
  }
  return null;
}

/** The spec for ProRes frames: 10-bit 4:4:4 whatever the HDR choice, so SDR Rec.2020 ProRes is 10-bit too. */
export function withBitDepth10(spec: OutputColorSpec): OutputColorSpec {
  return { ...spec, bitDepth: 10 };
}

export function toVideoColorSpace(spec: OutputColorSpec): OutputVideoColorSpace {
  return {
    primaries: spec.primaries,
    transfer: spec.transfer,
    matrix: spec.matrix,
    fullRange: spec.fullRange,
  };
}

export function outputColorForExport(
  project: { settings: Pick<ProjectSettings, "workingColorSpace"> & Partial<Pick<ProjectSettings, "colorManagement">> },
  hdr: HdrTransfer | undefined,
): OutputColorSpec | null {
  // ACES mode: an SDR export is the Output Transform's own display encoding (sRGB / Rec.709, 8-bit canvas path), so the
  // Rec.2020 working-space tagging does not apply; HDR exports keep their PQ / HLG Rec.2020 spec.
  if (project.settings.colorManagement === "aces" && hdr !== "pq" && hdr !== "hlg") return null;
  return resolveOutputColorSpec(resolveWorkingColorSpace(project.settings), hdr);
}

// -- transfer functions (all take/return 0..1; linear 1.0 = SDR reference white) ------------------------------

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(l: number): number {
  const c = l <= 0 ? 0 : l >= 1 ? 1 : l;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const PQ_M1 = 2610 / 16384;
const PQ_M2 = (2523 / 4096) * 128;
const PQ_C1 = 3424 / 4096;
const PQ_C2 = (2413 / 4096) * 32;
const PQ_C3 = (2392 / 4096) * 32;

/** SMPTE ST 2084 inverse EOTF of an absolute luminance in nits (0..10000). */
export function pqEncodeNits(nits: number): number {
  const y = Math.max(0, Math.min(1, nits / 10000));
  const p = Math.pow(y, PQ_M1);
  return Math.pow((PQ_C1 + PQ_C2 * p) / (1 + PQ_C3 * p), PQ_M2);
}

export function pqDecodeToNits(signal: number): number {
  const e = Math.pow(Math.max(0, Math.min(1, signal)), 1 / PQ_M2);
  const y = Math.pow(Math.max(e - PQ_C1, 0) / (PQ_C2 - PQ_C3 * e), 1 / PQ_M1);
  return y * 10000;
}

const HLG_A = 0.17883277;
const HLG_B = 0.28466892;
const HLG_C = 0.55991073;

/** ITU-R BT.2100 HLG OETF of scene-linear light (0..1). */
export function hlgOetf(e: number): number {
  const v = Math.max(0, Math.min(1, e));
  return v <= 1 / 12 ? Math.sqrt(3 * v) : HLG_A * Math.log(12 * v - HLG_B) + HLG_C;
}

/** Encodes linear light (1.0 = SDR white) with the output transfer function. */
export function encodeOutputTransfer(linear: number, transfer: OutputColorSpec["transfer"]): number {
  const l = linear <= 0 ? 0 : linear;
  if (transfer === "pq") return pqEncodeNits(l * PQ_SDR_WHITE_NITS);
  if (transfer === "hlg") return hlgOetf(l * HLG_SDR_WHITE_SCENE);
  return linearToSrgb(l);
}

/** Linear-light BT.709 to BT.2020 primaries (ITU-R BT.2087). Rows sum to 1, so neutrals stay neutral. */
export const BT709_TO_BT2020: readonly [readonly number[], readonly number[], readonly number[]] = [
  [0.627404, 0.329283, 0.043313],
  [0.069097, 0.919540, 0.011362],
  [0.016391, 0.088013, 0.895595],
];

const KR_2020 = 0.2627;
const KB_2020 = 0.0593;
const KG_2020 = 1 - KR_2020 - KB_2020;

export interface YuvCode {
  y: number;
  cb: number;
  cr: number;
}

/** Non-linear R'G'B' (0..1) to limited-range BT.2020 NCL Y'CbCr codes at the given bit depth. */
export function rgbToYcbcr2020(r: number, g: number, b: number, bitDepth: 8 | 10): YuvCode {
  const scale = bitDepth === 10 ? 4 : 1;
  const y = KR_2020 * r + KG_2020 * g + KB_2020 * b;
  const cb = (b - y) / (2 * (1 - KB_2020));
  const cr = (r - y) / (2 * (1 - KR_2020));
  return {
    y: (16 + 219 * y) * scale,
    cb: (128 + 224 * cb) * scale,
    cr: (128 + 224 * cr) * scale,
  };
}

const ENCODE_LUT_SIZE = 4096;

/** Per-transfer encode LUT indexed by sqrt(linear) for resolution near black. */
const encodeLutCache = new Map<string, Float32Array>();
function encodeLut(transfer: OutputColorSpec["transfer"]): Float32Array {
  let lut = encodeLutCache.get(transfer);
  if (!lut) {
    lut = new Float32Array(ENCODE_LUT_SIZE + 1);
    for (let i = 0; i <= ENCODE_LUT_SIZE; i++) {
      const root = i / ENCODE_LUT_SIZE;
      lut[i] = encodeOutputTransfer(root * root, transfer);
    }
    encodeLutCache.set(transfer, lut);
  }
  return lut;
}

function encodeFast(lut: Float32Array, linear: number): number {
  const clamped = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const position = Math.sqrt(clamped) * ENCODE_LUT_SIZE;
  const lower = Math.floor(position);
  const upper = lower >= ENCODE_LUT_SIZE ? ENCODE_LUT_SIZE : lower + 1;
  return lut[lower] + (lut[upper] - lut[lower]) * (position - lower);
}

let decodeLut: Float32Array | null = null;
function srgbDecodeLut(): Float32Array {
  if (!decodeLut) {
    decodeLut = new Float32Array(256);
    for (let i = 0; i < 256; i++) decodeLut[i] = srgbToLinear(i / 255);
  }
  return decodeLut;
}

export interface YuvFrame {
  format: "I420" | "I420P10" | "I444P10";
  /** Plane data (Y, then U, then V), 8-bit samples or little-endian 16-bit samples. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Converts an opaque RGBA frame (sRGB code values, what the canvas holds) to
 * 4:2:0 planar YCbCr in the output colour space. Dimensions must be even.
 */
export function rgbaToYuv420(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  spec: OutputColorSpec,
): YuvFrame {
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`Colour-managed export needs even frame dimensions, got ${width}x${height}.`);
  }
  const decode = srgbDecodeLut();
  const encode = encodeLut(spec.transfer);
  const convertPrimaries = spec.primaries === "bt2020";
  const [m0, m1, m2] = BT709_TO_BT2020;
  const chromaWidth = width / 2;
  const chromaHeight = height / 2;
  const planeSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  const wide = spec.bitDepth === 10;
  const samples = wide ? new Uint16Array(planeSize + chromaSize * 2) : new Uint8Array(planeSize + chromaSize * 2);
  const cbPlane = new Float32Array(planeSize);
  const crPlane = new Float32Array(planeSize);

  for (let p = 0, o = 0; p < planeSize; p++, o += 4) {
    let lr = decode[rgba[o]];
    let lg = decode[rgba[o + 1]];
    let lb = decode[rgba[o + 2]];
    if (convertPrimaries) {
      const r2 = m0[0] * lr + m0[1] * lg + m0[2] * lb;
      const g2 = m1[0] * lr + m1[1] * lg + m1[2] * lb;
      const b2 = m2[0] * lr + m2[1] * lg + m2[2] * lb;
      lr = r2;
      lg = g2;
      lb = b2;
    }
    const code = rgbToYcbcr2020(encodeFast(encode, lr), encodeFast(encode, lg), encodeFast(encode, lb), spec.bitDepth);
    samples[p] = Math.max(wide ? 64 : 16, Math.min(wide ? 940 : 235, Math.round(code.y)));
    cbPlane[p] = code.cb;
    crPlane[p] = code.cr;
  }

  for (let cy = 0; cy < chromaHeight; cy++) {
    for (let cx = 0; cx < chromaWidth; cx++) {
      const i0 = cy * 2 * width + cx * 2;
      const cb = (cbPlane[i0] + cbPlane[i0 + 1] + cbPlane[i0 + width] + cbPlane[i0 + width + 1]) / 4;
      const cr = (crPlane[i0] + crPlane[i0 + 1] + crPlane[i0 + width] + crPlane[i0 + width + 1]) / 4;
      const out = cy * chromaWidth + cx;
      const lo = wide ? 64 : 16;
      const hi = wide ? 960 : 240;
      samples[planeSize + out] = Math.max(lo, Math.min(hi, Math.round(cb)));
      samples[planeSize + chromaSize + out] = Math.max(lo, Math.min(hi, Math.round(cr)));
    }
  }

  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  return { format: wide ? "I420P10" : "I420", data: bytes, width, height };
}

/**
 * Converts an opaque RGBA frame to 4:4:4 planar 10-bit YCbCr (Y, Cb, Cr planes
 * of full size, little-endian 16-bit samples) in the output colour space. Used
 * for ProRes 4444 / 4444 XQ, whose chroma is not subsampled. No dimension
 * restrictions.
 */
export function rgbaToYuv444(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  spec: OutputColorSpec,
): YuvFrame {
  const decode = srgbDecodeLut();
  const encode = encodeLut(spec.transfer);
  const convertPrimaries = spec.primaries === "bt2020";
  const [m0, m1, m2] = BT709_TO_BT2020;
  const planeSize = width * height;
  const lo = 64;
  const hiY = 940;
  const hiC = 960;
  const samples = new Uint16Array(planeSize * 3);
  for (let p = 0, o = 0; p < planeSize; p++, o += 4) {
    let lr = decode[rgba[o]];
    let lg = decode[rgba[o + 1]];
    let lb = decode[rgba[o + 2]];
    if (convertPrimaries) {
      const r2 = m0[0] * lr + m0[1] * lg + m0[2] * lb;
      const g2 = m1[0] * lr + m1[1] * lg + m1[2] * lb;
      const b2 = m2[0] * lr + m2[1] * lg + m2[2] * lb;
      lr = r2;
      lg = g2;
      lb = b2;
    }
    const code = rgbToYcbcr2020(encodeFast(encode, lr), encodeFast(encode, lg), encodeFast(encode, lb), 10);
    samples[p] = Math.max(lo, Math.min(hiY, Math.round(code.y)));
    samples[planeSize + p] = Math.max(lo, Math.min(hiC, Math.round(code.cb)));
    samples[planeSize * 2 + p] = Math.max(lo, Math.min(hiC, Math.round(code.cr)));
  }
  return { format: "I444P10", data: new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), width, height };
}

// -- capability -----------------------------------------------------------------------------------------------

export interface HdrExportSupport {
  supported: boolean;
  /** Why HDR export is unavailable, written for the export dialog. */
  reason?: string;
}

let browserHdrProbe: Promise<HdrExportSupport> | null = null;

/**
 * Whether this environment can write a tagged 10-bit HDR file: the browser
 * WebCodecs/MediaBunny path with a 10-bit HEVC encoder, or the desktop ffmpeg
 * sidecar when it reports libx265 / hevc_videotoolbox. Without the desktop's
 * encoder list the desktop is reported as unsupported.
 */
export function probeHdrExportSupport(
  options: { native?: boolean; /** ffmpeg encoder names the desktop build reports (hardware probe). */ encoders?: readonly string[] } = {},
): Promise<HdrExportSupport> {
  if (options.native && options.encoders) {
    // Desktop: the ffmpeg sidecar writes the 10-bit file from converted YCbCr frames.
    const has10BitHevc = options.encoders.includes("libx265") || options.encoders.includes("hevc_videotoolbox");
    return Promise.resolve(
      has10BitHevc
        ? { supported: true }
        : {
            supported: false,
            reason: "This desktop build's ffmpeg has no 10-bit HEVC encoder (libx265 or hevc_videotoolbox), which HDR files need.",
          },
    );
  }
  if (options.native || getEncoderBackendFactory()) {
    return Promise.resolve({
      supported: false,
      reason: "HDR export is not available with the desktop ffmpeg encoder yet. Export from the browser build for PQ or HLG output.",
    });
  }
  if (typeof VideoEncoder === "undefined") {
    return Promise.resolve({ supported: false, reason: "This browser has no WebCodecs video encoder." });
  }
  browserHdrProbe ??= (async (): Promise<HdrExportSupport> => {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: HDR_HEVC_CODEC_STRING,
        width: 1920,
        height: 1080,
        bitrate: 20_000_000,
        framerate: 30,
      });
      return support.supported
        ? { supported: true }
        : { supported: false, reason: "This browser cannot encode 10-bit HEVC (H.265 Main10), which HDR files need." };
    } catch {
      return { supported: false, reason: "This browser could not confirm a 10-bit HEVC encoder." };
    }
  })();
  return browserHdrProbe;
}

/** Test hook: forget the cached browser probe. */
export function resetHdrExportProbe(): void {
  browserHdrProbe = null;
}
