import type { ProjectSettings } from "../types/project";
import type { Transform } from "../types/timeline";
import type { CurvePoint } from "../types/effects";
import type { HdrTransfer } from "../export/types";
import {
  BT709_TO_BT2020,
  HLG_SDR_WHITE_SCENE,
  PQ_SDR_WHITE_NITS,
  encodeOutputTransfer,
  pqDecodeToNits,
  pqEncodeNits,
  srgbToLinear,
  type OutputColorSpec,
  type YuvFrame,
} from "../export/color-output";
import { resolveCanvasFitDimensions } from "../video/canvas-fit";
import {
  isNeutralCurves,
  isNeutralHsl,
  isNeutralLut,
  isNeutralVignette,
  isNeutralTone,
  isNeutralColorWheels,
} from "../video/color-grading-defaults";
import type { ClipColorGrading, ColorWheelValues, CurvesValues, VignetteValues } from "../video/color-grading-engine";
import { hasByteTable, hasCurve1d, hasFloatTable, resolveLut3dRgb, sampleCurve1dChannel } from "./lut-tables";
import { buildHueCurveLuts, isNeutralHueCurves, applyHueCurvesToRgb, type HueCurveLuts } from "../video/hue-curves";
import { buildToneCurve, sampleToneCurve, vignetteWeight } from "../video/tone-curve";
import { hslToRgb, rgbToHsl } from "../video/hue-curves";
import { applyHdrEffects, type HdrLayerEffect } from "./hdr-effects";
import { applyColorWheelsToRgb } from "../video/lumetri-pipeline";
import { BT2020_TO_BT709, hlgInverseOetf, P3_TO_BT709, TONE_MAP_KNEE } from "./input-transform";
import type { SourceColorSpace, SourceTransfer } from "./source-color";
import { CAMERA_LOGS, cameraGamutToBt2020, cameraLogForShaderId, decodeCameraLog, type CameraGamutId } from "./camera-log";
import {
  acescctDecode,
  acescctEncode,
  ACESCCT_WHITE,
  gamutToAp1,
  isAcesMode,
  type AcesOutputId,
  type AcesSdrOutput,
} from "./aces";

/**
 * Scene-referred HDR working mode.
 *
 * The classic pipeline composites on an 8-bit display-referred sRGB canvas, so
 * anything above SDR white is lost at the input. In HDR working mode the
 * picture is carried as unbounded floating point instead:
 *
 *   working space   scene-linear BT.2020, 1.0 = 203 nits (SDR reference white),
 *                   no upper bound (PQ 10 000 nits = 49.3)
 *   input           code values -> linear (sRGB / PQ / HLG / linear), source
 *                   primaries -> BT.2020. NO tone map: highlights stay above 1.
 *   grading         Lumetri stages run in a PQ-encoded copy of the working
 *                   space (perceptually uniform, 0..1 spans 0..10 000 nits), so
 *                   the sliders behave like Premiere's HDR grading; the result
 *                   goes back to linear. Exposure is a true linear gain.
 *   compositing     "over" in linear light, in half float on the GPU
 *                   (rgba16float) or in the identical Float32 CPU reference.
 *                   8-bit overlays (text, shapes, SDR-only clips) enter at
 *                   graphics white: sRGB-decoded and placed at 1.0 (203 nits).
 *   output          PQ / HLG encode (HDR export), or tone map + sRGB for an
 *                   SDR monitor (the preview) and for SDR exports.
 *
 * Everything here is plain arithmetic on Float32 data so that the GPU shader
 * (video/hdr-gpu.ts) and the CPU reference can be compared pixel for pixel.
 */

export type Matrix3 = readonly [readonly number[], readonly number[], readonly number[]];

const IDENTITY: Matrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function mul3(a: Matrix3, b: Matrix3): Matrix3 {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return out as unknown as Matrix3;
}

export const P3_TO_BT2020: Matrix3 = /* @__PURE__ */ mul3(BT709_TO_BT2020, P3_TO_BT709);

/** True when the project's frames should be composed in float. SDR Rec.709 projects with no HDR output never are. */
export function isHdrWorkingMode(
  settings: Pick<ProjectSettings, "workingColorSpace" | "colorManagement"> | undefined,
  hdr: HdrTransfer | undefined,
): boolean {
  return settings?.workingColorSpace === "rec2020" || hdr === "pq" || hdr === "hlg" || isAcesMode(settings);
}

/** `acesOutputTransform` of `color/aces-output.ts`, registered by whoever runs the ACES pipeline (the video engine, tests). */
export type AcesOutputFn = (r: number, g: number, b: number, output: AcesOutputId, out: number[]) => number[];
let acesOutputFn: AcesOutputFn | null = null;

/**
 * The Output Transform (RRT + ODT) is ~10 KB of tables and splines only the compositors run, so it lives in its own module
 * that the startup bundle never imports; the code that runs an ACES pipeline hands it over here.
 */
export function registerAcesOutputTransform(fn: AcesOutputFn): void {
  acesOutputFn = fn;
}

function acesOutput(): AcesOutputFn {
  if (!acesOutputFn) throw new Error("The ACES output transform is not loaded: call registerAcesOutputTransform(acesOutputTransform) from color/aces-output.");
  return acesOutputFn;
}

/**
 * Which colour pipeline the float compositor runs.
 *   scene-hdr  working space scene-linear BT.2020, grading in PQ, SDR view / HDR encode by tone map (the Rec.2020 / HDR mode)
 *   aces       working space ACEScg (AP1), grading in ACEScct, SDR view / encode through the ACES Output Transform (RRT + ODT)
 */
export type HdrColorPipeline =
  | { readonly kind: "scene-hdr" }
  | { readonly kind: "aces"; readonly sdrOutput: AcesSdrOutput };

export const SCENE_HDR_PIPELINE: HdrColorPipeline = { kind: "scene-hdr" };

export function acesPipeline(sdrOutput: AcesSdrOutput = "srgb"): HdrColorPipeline {
  return { kind: "aces", sdrOutput };
}

/** The pipeline a project's settings select. */
export function hdrPipelineFor(settings: Pick<ProjectSettings, "colorManagement" | "acesOutput"> | undefined): HdrColorPipeline {
  return isAcesMode(settings) ? acesPipeline(settings?.acesOutput === "rec709" ? "rec709" : "srgb") : SCENE_HDR_PIPELINE;
}

// -- source decode --------------------------------------------------------------------------------------------

/** 0 sRGB, 1 PQ, 2 HLG, 3 linear, 4..12 the camera log curves (`CAMERA_LOGS[n].shaderId`), 13 ACEScct. */
export type HdrTransferId = number;
export const HDR_TRANSFER_SRGB: HdrTransferId = 0;
export const HDR_TRANSFER_PQ: HdrTransferId = 1;
export const HDR_TRANSFER_HLG: HdrTransferId = 2;
export const HDR_TRANSFER_LINEAR: HdrTransferId = 3;
/** ACEScct footage (4..12 are the camera log curves). */
export const HDR_TRANSFER_ACESCCT: HdrTransferId = 13;

export interface HdrSourceDecode {
  /** Stable identity: equal keys decode identically. */
  readonly key: string;
  readonly transfer: HdrTransferId;
  /** Source primaries to the working primaries (BT.2020 in the scene-hdr pipeline, AP1 / ACEScg in the aces pipeline), in linear light. */
  readonly toBt2020: Matrix3;
}

function transferId(transfer: SourceTransfer): HdrTransferId {
  switch (transfer) {
    case "pq":
      return HDR_TRANSFER_PQ;
    case "hlg":
      return HDR_TRANSFER_HLG;
    case "linear":
      return HDR_TRANSFER_LINEAR;
    case "acescct":
      return HDR_TRANSFER_ACESCCT;
    default:
      return CAMERA_LOGS.find((d) => d.id === transfer)?.shaderId ?? HDR_TRANSFER_SRGB;
  }
}

/** Source primaries to BT.2020 in linear light. */
function primariesToBt2020(primaries: SourceColorSpace["primaries"]): Matrix3 {
  switch (primaries) {
    case "bt2020":
      return IDENTITY;
    case "p3":
      return P3_TO_BT2020;
    case "bt709":
    case "bt601":
      return BT709_TO_BT2020;
    default:
      return cameraGamutToBt2020(primaries as CameraGamutId);
  }
}

/** The gamut id the ACES input transform takes a source's primaries as. */
function acesGamutOf(primaries: SourceColorSpace["primaries"]): CameraGamutId | "rec709" | "p3" {
  switch (primaries) {
    case "bt709":
    case "bt601":
      return "rec709";
    case "p3":
      return "p3";
    default:
      return primaries as CameraGamutId;
  }
}

/**
 * Decode description of footage. `null` (untagged / plain SDR) reads the canvas as sRGB Rec.709.
 * In the aces pipeline this is the Input Transform (IDT): the same code-value decode, then the source primaries to
 * AP1 with a Bradford adaptation to the ACES white.
 */
export function hdrSourceDecode(space: SourceColorSpace | null | undefined, pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE): HdrSourceDecode {
  if (pipeline.kind === "aces") {
    if (!space) return ACES_SDR_DECODE;
    return { key: `aces:${space.primaries}/${space.transfer}`, transfer: transferId(space.transfer), toBt2020: gamutToAp1(acesGamutOf(space.primaries)) };
  }
  if (!space) return SDR_DECODE;
  const toBt2020 = primariesToBt2020(space.primaries);
  return { key: `${space.primaries}/${space.transfer}`, transfer: transferId(space.transfer), toBt2020 };
}

export const SDR_DECODE: HdrSourceDecode = { key: "bt709/srgb", transfer: HDR_TRANSFER_SRGB, toBt2020: BT709_TO_BT2020 };

/** sRGB / Rec.709 footage through the ACES input transform (sRGB EOTF, Rec.709 primaries to AP1). */
export const ACES_SDR_DECODE: HdrSourceDecode = { key: "aces:bt709/srgb", transfer: HDR_TRANSFER_SRGB, toBt2020: /* @__PURE__ */ gamutToAp1("rec709") };

/** Graphics white: where 8-bit sRGB overlays sit in the working space. */
export const HDR_OVERLAY_DECODE: HdrSourceDecode = SDR_DECODE;

/** Where 8-bit overlays enter: sRGB white in the working primaries of the pipeline. */
export function overlayDecodeFor(pipeline: HdrColorPipeline): HdrSourceDecode {
  return pipeline.kind === "aces" ? ACES_SDR_DECODE : HDR_OVERLAY_DECODE;
}

/** Signal 0..1 to scene-linear where 1.0 = SDR reference white (no clipping above 1). */
export function decodeToWorkingLinear(signal: number, transfer: HdrTransferId): number {
  const log = cameraLogForShaderId(transfer);
  if (log) return decodeCameraLog(Math.max(0, Math.min(1, signal)), log.id);
  switch (transfer) {
    case HDR_TRANSFER_PQ:
      return pqDecodeToNits(signal) / PQ_SDR_WHITE_NITS;
    case HDR_TRANSFER_HLG:
      return hlgInverseOetf(signal) / HLG_SDR_WHITE_SCENE;
    case HDR_TRANSFER_LINEAR:
      return signal;
    case HDR_TRANSFER_ACESCCT:
      return acescctDecode(signal);
    default:
      return srgbToLinear(signal);
  }
}

const lut8Cache = new Map<number, Float32Array>();
const lut16Cache = new Map<number, Float32Array>();

/** 256-entry decode of an 8-bit code. */
export function decodeLut8(transfer: HdrTransferId): Float32Array {
  let lut = lut8Cache.get(transfer);
  if (!lut) {
    lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) lut[i] = decodeToWorkingLinear(i / 255, transfer);
    lut8Cache.set(transfer, lut);
  }
  return lut;
}

/** 65536-entry decode of a 16-bit code (exact: one entry per code). */
export function decodeLut16(transfer: HdrTransferId): Float32Array {
  let lut = lut16Cache.get(transfer);
  if (!lut) {
    lut = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) lut[i] = decodeToWorkingLinear(i / 65535, transfer);
    lut16Cache.set(transfer, lut);
  }
  return lut;
}

/** A decoded layer: scene-linear BT.2020 RGBA (straight alpha) at the source's own resolution. */
export interface HdrLayerPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

export type SourceCodes =
  | { readonly depth: 8; readonly width: number; readonly height: number; readonly data: Uint8ClampedArray | Uint8Array }
  | { readonly depth: 16; readonly width: number; readonly height: number; readonly data: Uint16Array };

/** Code values -> working linear. No tone map: a PQ code at 1000 nits becomes 4.93. */
export function decodeSourceToLinear(codes: SourceCodes, decode: HdrSourceDecode): HdrLayerPixels {
  const n = codes.width * codes.height;
  const out = new Float32Array(n * 4);
  const lut = codes.depth === 8 ? decodeLut8(decode.transfer) : decodeLut16(decode.transfer);
  const [m0, m1, m2] = decode.toBt2020;
  const src = codes.data as ArrayLike<number>;
  const maxAlpha = codes.depth === 8 ? 255 : 65535;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const lr = lut[src[o]];
    const lg = lut[src[o + 1]];
    const lb = lut[src[o + 2]];
    out[o] = m0[0] * lr + m0[1] * lg + m0[2] * lb;
    out[o + 1] = m1[0] * lr + m1[1] * lg + m1[2] * lb;
    out[o + 2] = m2[0] * lr + m2[1] * lg + m2[2] * lb;
    out[o + 3] = src[o + 3] / maxAlpha;
  }
  return { width: codes.width, height: codes.height, data: out };
}

// -- grading --------------------------------------------------------------------------------------------------

export interface HdrCurveLuts {
  readonly rgb: Float32Array;
  readonly red: Float32Array;
  readonly green: Float32Array;
  readonly blue: Float32Array;
}

export interface HdrGradeSpec {
  /** Linear multiplier from the exposure slider (2^(2*exposure)). */
  readonly exposureGain: number;
  /** Additive white balance in the PQ working encoding, per channel. */
  readonly whiteBalance: readonly [number, number, number] | null;
  readonly toneCurve: Float32Array | null;
  readonly wheels: ColorWheelValues | null;
  readonly hueLuts: HueCurveLuts | null;
  readonly curves: HdrCurveLuts | null;
  /** 3D LUT, applied in its declared colour space. */
  readonly lut: HdrLutSpec | null;
  /** Eight hue bands of Lumetri HSL: hue shift (turns), saturation and luminance offsets. */
  readonly hsl: HdrHslSpec | null;
  /** Radial vignette in source-frame coordinates. Needs a position, see `HdrGradePosition`. */
  readonly vignette: VignetteValues | null;
  /** Grade in ACEScct instead of the PQ working encoding (the aces pipeline). */
  readonly acescct?: boolean;
}

/** Colour space a clip's LUT was authored for (its input domain). */
export type HdrLutSpace = "srgb" | "linear" | "pq";

export interface HdrLutSpec {
  /** Identity of the source data: equal keys hold identical tables (lets the GPU skip a re-upload). */
  readonly key: object;
  readonly size: number;
  /** size^3 RGB triples in 0..1, red fastest then green then blue. */
  readonly rgb: Float32Array;
  readonly space: HdrLutSpace;
  readonly intensity: number;
  /** Exact 1D per-channel curve (LUT_1D_SIZE files). When set it replaces the 3D table. */
  readonly curve: HdrLutCurve | null;
}

export interface HdrLutCurve {
  readonly size: number;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
  /** Interleaved RGB, `size` entries. */
  readonly data: Float32Array;
}

export interface HdrHslSpec {
  /** Per band, in turns (degrees / 360). */
  readonly hue: Float32Array;
  readonly saturation: Float32Array;
  readonly luminance: Float32Array;
}

/** Where the pixel sits in the clip's source frame, for stages that depend on position (vignette). */
export interface HdrGradePosition {
  /** -1..1 across the source frame. */
  readonly nx: number;
  readonly ny: number;
  /** Source frame width / height. */
  readonly aspect: number;
}

export const CURVE_LUT_SIZE = 256;

/** Float Catmull-Rom curve LUT, the arithmetic of the 8-bit builder without the rounding. */
export function buildCurveLutFloat(points: readonly CurvePoint[]): Float32Array {
  const lut = new Float32Array(CURVE_LUT_SIZE);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (sorted.length === 0 || sorted[0].x > 0) sorted.unshift({ x: 0, y: 0 });
  if (sorted[sorted.length - 1].x < 1) sorted.push({ x: 1, y: 1 });
  for (let i = 0; i < CURVE_LUT_SIZE; i++) {
    const x = i / (CURVE_LUT_SIZE - 1);
    let y = x;
    for (let j = 0; j < sorted.length - 1; j++) {
      if (x >= sorted[j].x && x <= sorted[j + 1].x) {
        const p1 = sorted[j];
        const p2 = sorted[j + 1];
        if (sorted.length === 2) {
          y = p1.y + ((x - p1.x) / (p2.x - p1.x)) * (p2.y - p1.y);
          break;
        }
        const p0 = j > 0 ? sorted[j - 1] : p1;
        const p3 = j + 2 < sorted.length ? sorted[j + 2] : p2;
        const t = (x - p1.x) / (p2.x - p1.x);
        const t2 = t * t;
        const t3 = t2 * t;
        y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
        break;
      }
    }
    lut[i] = Math.max(0, Math.min(1, y));
  }
  return lut;
}

function buildCurveLuts(curves: CurvesValues): HdrCurveLuts {
  return {
    rgb: buildCurveLutFloat(curves.rgb),
    red: buildCurveLutFloat(curves.red),
    green: buildCurveLutFloat(curves.green),
    blue: buildCurveLutFloat(curves.blue),
  };
}

/**
 * Lumetri stages the float HDR path cannot run. Every stage of the grade runs in float now (the LUT needs
 * a well-formed table); a clip whose LUT is malformed keeps the 8-bit path, where the engine ignores it too.
 */
export function hdrGradeSupported(grading: Pick<ClipColorGrading, "lut"> | undefined): boolean {
  if (!grading?.lut || isNeutralLut(grading.lut as never)) return true;
  const lut = grading.lut;
  if (hasCurve1d(lut.curve1d)) return true;
  const { size } = lut;
  return Number.isInteger(size) && size <= 129 && (hasFloatTable(lut) || hasByteTable(lut));
}

const lutCache = new WeakMap<object, HdrLutSpec[]>();

/** LUT table as floats, cached per source array so a clip's LUT is converted once, not per frame. */
export function prepareHdrLut(lut: NonNullable<ClipColorGrading["lut"]>): HdrLutSpec | null {
  if (isNeutralLut(lut as never) || !hdrGradeSupported({ lut })) return null;
  const space: HdrLutSpace = lut.space ?? "srgb";
  const intensity = Math.max(0, Math.min(1, lut.intensity));
  // Key on the float table when there is one so the GPU re-uploads exactly when the precise data changes.
  const key: object = lut.floatData ?? lut.data;
  const cached = lutCache.get(key)?.find((spec) => spec.size === lut.size && spec.space === space && spec.intensity === intensity);
  if (cached) return cached;
  // Float table first (no 8-bit quantisation); the 8-bit table is only the fallback for legacy projects.
  const useTable = hasFloatTable(lut) || hasByteTable(lut);
  const rgb = useTable ? resolveLut3dRgb(lut) : new Float32Array(0);
  const curve: HdrLutCurve | null = hasCurve1d(lut.curve1d)
    ? { size: lut.curve1d.size, domainMin: lut.curve1d.domainMin, domainMax: lut.curve1d.domainMax, data: Float32Array.from(lut.curve1d.data) }
    : null;
  const spec: HdrLutSpec = { key, size: lut.size, rgb, space, intensity, curve };
  const list = lutCache.get(key) ?? [];
  list.push(spec);
  lutCache.set(key, list);
  return spec;
}

function clampUnit(v: number | undefined): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v as number)) : 0;
}

/** Bakes a clip's grading into the data both the GPU pass and the CPU reference read. Null: nothing to do. */
export function prepareHdrGrade(grading: ClipColorGrading | undefined, pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE): HdrGradeSpec | null {
  if (!grading) return null;
  const exposure = clampUnit(grading.tone?.exposure);
  const temperature = (grading.temperature ?? 0) / 100;
  const tint = (grading.tint ?? 0) / 100;
  let whiteBalance: [number, number, number] | null = null;
  if (temperature !== 0 || tint !== 0) {
    const warm = temperature > 0;
    whiteBalance = [
      temperature * 0.2 + tint * 0.1,
      temperature * (warm ? 0.1 : 0.05) - tint * 0.2,
      -temperature * 0.2 + tint * 0.1,
    ];
  }
  // Exposure is applied as a linear gain; the Basic Correction curve then runs without it.
  const tone = grading.tone && !isNeutralTone({ ...grading.tone, exposure: 0 }) ? { ...grading.tone, exposure: 0 } : null;
  const wheels = grading.colorWheels && !isNeutralColorWheels(grading.colorWheels) ? grading.colorWheels : null;
  const hue = grading.hueCurves && !isNeutralHueCurves(grading.hueCurves) ? buildHueCurveLuts(grading.hueCurves) : null;
  const curves = grading.curves && !isNeutralCurves(grading.curves) ? buildCurveLuts(grading.curves) : null;
  const lut = grading.lut ? prepareHdrLut(grading.lut) : null;
  let hsl: HdrHslSpec | null = null;
  if (grading.hsl && !isNeutralHsl(grading.hsl)) {
    const band = (values: readonly number[] | undefined, scale: number): Float32Array => {
      const out = new Float32Array(8);
      for (let i = 0; i < 8; i++) out[i] = (Number.isFinite(values?.[i]) ? (values as readonly number[])[i] : 0) * scale;
      return out;
    };
    hsl = { hue: band(grading.hsl.hue, 1 / 360), saturation: band(grading.hsl.saturation, 1), luminance: band(grading.hsl.luminance, 1) };
  }
  const vignette = grading.vignette && !isNeutralVignette(grading.vignette) ? grading.vignette : null;
  const spec: HdrGradeSpec = {
    exposureGain: exposure === 0 ? 1 : Math.pow(2, exposure * 2),
    whiteBalance,
    toneCurve: tone ? buildToneCurve(tone) : null,
    wheels,
    hueLuts: hue,
    curves,
    lut,
    hsl,
    vignette,
    ...(pipeline.kind === "aces" ? { acescct: true } : {}),
  };
  return isNeutralHdrGrade(spec) ? null : spec;
}

export function isNeutralHdrGrade(spec: HdrGradeSpec | null | undefined): boolean {
  return !spec || (spec.exposureGain === 1 && !spec.whiteBalance && !spec.toneCurve && !spec.wheels && !spec.hueLuts && !spec.curves && !spec.lut && !spec.hsl && !spec.vignette);
}

/** Largest linear value the PQ working encoding can hold (10 000 nits). */
export const HDR_LINEAR_PEAK = 10000 / PQ_SDR_WHITE_NITS;

export function linearToPqWorking(linear: number): number {
  return pqEncodeNits(Math.max(0, linear) * PQ_SDR_WHITE_NITS);
}

export function pqWorkingToLinear(signal: number): number {
  return pqDecodeToNits(signal) / PQ_SDR_WHITE_NITS;
}

function sampleLut(lut: Float32Array, x: number): number {
  return sampleToneCurve(lut, x);
}

/** Working linear -> the signal a LUT of this space expects. sRGB extends above 1 so highlights keep their ordering. */
export function lutDomainEncode(linear: number, space: HdrLutSpace): number {
  const v = Math.max(0, linear);
  if (space === "linear") return v;
  if (space === "pq") return linearToPqWorking(v);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function lutDomainDecode(signal: number, space: HdrLutSpace): number {
  const v = Math.max(0, signal);
  if (space === "linear") return v;
  if (space === "pq") return pqWorkingToLinear(v);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Trilinear lookup, each channel in 0..1 (the arithmetic of the 8-bit LUT stage, in float). */
export function sampleLut3d(lut: HdrLutSpec, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size;
  const max = n - 1;
  const ri = r * max;
  const gi = g * max;
  const bi = b * max;
  const r0 = Math.floor(ri);
  const g0 = Math.floor(gi);
  const b0 = Math.floor(bi);
  const r1 = Math.min(r0 + 1, max);
  const g1 = Math.min(g0 + 1, max);
  const b1 = Math.min(b0 + 1, max);
  const fr = ri - r0;
  const fg = gi - g0;
  const fb = bi - b0;
  const t = lut.rgb;
  const at = (x: number, y: number, z: number, c: number): number => t[(z * n * n + y * n + x) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(r0, g0, b0, c) * (1 - fr) + at(r1, g0, b0, c) * fr;
    const c01 = at(r0, g0, b1, c) * (1 - fr) + at(r1, g0, b1, c) * fr;
    const c10 = at(r0, g1, b0, c) * (1 - fr) + at(r1, g1, b0, c) * fr;
    const c11 = at(r0, g1, b1, c) * (1 - fr) + at(r1, g1, b1, c) * fr;
    const c0 = c00 * (1 - fg) + c10 * fg;
    const c1 = c01 * (1 - fg) + c11 * fg;
    out[c] = c0 * (1 - fb) + c1 * fb;
  }
  return out;
}

/** PQ working signal of SDR white: a positive vignette lifts towards it, not towards 10 000 nits. */
export const PQ_WORKING_WHITE = /* @__PURE__ */ pqEncodeNits(PQ_SDR_WHITE_NITS);

/** One pixel (scene-linear BT.2020) through the grade. The CPU reference of the GLSL grade stage. */
export function gradeHdrPixel(r: number, g: number, b: number, spec: HdrGradeSpec, pos?: HdrGradePosition): [number, number, number] {
  if (spec.exposureGain !== 1) {
    r *= spec.exposureGain;
    g *= spec.exposureGain;
    b *= spec.exposureGain;
  }
  const cct = spec.acescct === true;
  // The grade's working encoding: PQ (scene-hdr) or ACEScct (aces; negative light is floored at 0 like PQ's).
  const enc = cct ? (v: number): number => acescctEncode(Math.max(0, v)) : linearToPqWorking;
  const dec = cct ? acescctDecode : pqWorkingToLinear;
  const white = cct ? ACESCCT_WHITE : PQ_WORKING_WHITE;
  r = enc(r);
  g = enc(g);
  b = enc(b);
  if (spec.whiteBalance) {
    const wb = spec.whiteBalance;
    r = Math.max(0, Math.min(1, r + wb[0]));
    g = Math.max(0, Math.min(1, g + wb[1]));
    b = Math.max(0, Math.min(1, b + wb[2]));
  }
  if (spec.toneCurve) {
    r = sampleToneCurve(spec.toneCurve, r);
    g = sampleToneCurve(spec.toneCurve, g);
    b = sampleToneCurve(spec.toneCurve, b);
  }
  if (spec.wheels) [r, g, b] = applyColorWheelsToRgb(r, g, b, spec.wheels);
  if (spec.hueLuts) [r, g, b] = applyHueCurvesToRgb(r, g, b, spec.hueLuts);
  if (spec.curves) {
    const c = spec.curves;
    r = sampleLut(c.rgb, sampleLut(c.red, r));
    g = sampleLut(c.rgb, sampleLut(c.green, g));
    b = sampleLut(c.rgb, sampleLut(c.blue, b));
  }
  if (spec.lut) {
    const lut = spec.lut;
    // The LUT sees the image in its declared space. Signal above 1.0 (highlights over SDR white in an sRGB or
    // linear LUT) bypasses the table and is added back on top of its output, so the grade never clips what it
    // cannot address.
    const er = lutDomainEncode(dec(r), lut.space);
    const eg = lutDomainEncode(dec(g), lut.space);
    const eb = lutDomainEncode(dec(b), lut.space);
    // An exact 1D curve addresses its own domain; signal above its domainMax bypasses it like the 3D table.
    const cr = Math.min(lut.curve ? lut.curve.domainMax[0] : 1, er);
    const cg = Math.min(lut.curve ? lut.curve.domainMax[1] : 1, eg);
    const cb = Math.min(lut.curve ? lut.curve.domainMax[2] : 1, eb);
    const mapped: [number, number, number] = lut.curve
      ? [sampleCurve1dChannel(lut.curve, 0, cr), sampleCurve1dChannel(lut.curve, 1, cg), sampleCurve1dChannel(lut.curve, 2, cb)]
      : sampleLut3d(lut, cr, cg, cb);
    const k = lut.intensity;
    const outR = er + (mapped[0] + (er - cr) - er) * k;
    const outG = eg + (mapped[1] + (eg - cg) - eg) * k;
    const outB = eb + (mapped[2] + (eb - cb) - eb) * k;
    r = enc(lutDomainDecode(outR, lut.space));
    g = enc(lutDomainDecode(outG, lut.space));
    b = enc(lutDomainDecode(outB, lut.space));
  }
  if (spec.hsl) {
    const hsl = spec.hsl;
    const [h, s, l] = rgbToHsl(r, g, b);
    const band = Math.floor(h * 8) % 8;
    const h2 = h + hsl.hue[band];
    [r, g, b] = hslToRgb(
      h2 - Math.floor(h2),
      Math.max(0, Math.min(1, s + hsl.saturation[band])),
      Math.max(0, Math.min(1, l + hsl.luminance[band])),
    );
  }
  if (spec.vignette && pos) {
    const amount = Math.max(-1, Math.min(1, spec.vignette.amount));
    const w = vignetteWeight(pos.nx, pos.ny, pos.aspect, spec.vignette);
    if (w > 0) {
      if (amount < 0) {
        const gain = 1 + amount * w;
        r *= gain;
        g *= gain;
        b *= gain;
      } else {
        const lift = amount * w;
        r += Math.max(white - r, 0) * lift;
        g += Math.max(white - g, 0) * lift;
        b += Math.max(white - b, 0) * lift;
      }
    }
  }
  return [dec(r), dec(g), dec(b)];
}

// -- geometry -------------------------------------------------------------------------------------------------

/**
 * Where a layer lands on the canvas. `m` maps a destination pixel centre
 * (x + 0.5, y + 0.5) to continuous source pixel coordinates (texel centres at
 * i + 0.5): sx = m0*dx + m1*dy + m2, sy = m3*dx + m4*dy + m5. Mirrors the
 * Canvas2D transform of the 8-bit path (translate, rotate, scale, anchor, crop, fit).
 */
export interface LayerGeometry {
  readonly m: readonly [number, number, number, number, number, number];
  /** Visible source rectangle in source pixels (crop). */
  readonly rect: readonly [number, number, number, number];
  /** Destination pixels per source pixel along each source axis (for edge anti-aliasing). */
  readonly scale: readonly [number, number];
}

export function computeLayerGeometry(
  transform: Pick<Transform, "position" | "scale" | "rotation" | "anchor" | "fitMode" | "crop">,
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
): LayerGeometry {
  const crop = transform.crop;
  const cropX = crop ? crop.x * srcW : 0;
  const cropY = crop ? crop.y * srcH : 0;
  const cropW = crop ? crop.width * srcW : srcW;
  const cropH = crop ? crop.height * srcH : srcH;
  const { width: drawW, height: drawH } = resolveCanvasFitDimensions(transform.fitMode, cropW, cropH, canvasW, canvasH);
  const drawX = -drawW * transform.anchor.x;
  const drawY = -drawH * transform.anchor.y;
  const theta = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const sx = transform.scale.x || 1e-9;
  const sy = transform.scale.y || 1e-9;
  const tx = canvasW / 2 + transform.position.x;
  const ty = canvasH / 2 + transform.position.y;
  // p = S^-1 R^-1 (d - T); u = (p - draw0) / drawSize; src = crop0 + u * cropSize
  const kx = cropW / (drawW * sx);
  const ky = cropH / (drawH * sy);
  const m0 = kx * cos;
  const m1 = kx * sin;
  const m2 = cropX + kx * (-cos * tx - sin * ty) - (drawX / drawW) * cropW;
  const m3 = -ky * sin;
  const m4 = ky * cos;
  const m5 = cropY + ky * (sin * tx - cos * ty) - (drawY / drawH) * cropH;
  return {
    m: [m0, m1, m2, m3, m4, m5],
    rect: [cropX, cropY, cropW, cropH],
    scale: [Math.abs((drawW * sx) / cropW), Math.abs((drawH * sy) / cropH)],
  };
}

/** Edge coverage in 0..1 of a destination pixel whose source position is (sx, sy). */
export function layerCoverage(g: LayerGeometry, sx: number, sy: number): number {
  const [x0, y0, w, h] = g.rect;
  const dx = Math.min(sx - x0, x0 + w - sx) * g.scale[0];
  const dy = Math.min(sy - y0, y0 + h - sy) * g.scale[1];
  return Math.max(0, Math.min(1, dx + 0.5)) * Math.max(0, Math.min(1, dy + 0.5));
}

// -- compositor interface + CPU reference ---------------------------------------------------------------------

export interface HdrLayerDraw {
  readonly geometry: LayerGeometry;
  readonly opacity: number;
  readonly grade: HdrGradeSpec | null;
  /** Float layer effects (blur, sharpen, glow), run on the clip's frame before the grade and the transform. */
  readonly effects?: readonly HdrLayerEffect[];
}

/** 203 nits: SDR reference white and the default graphics white (ITU-R BT.2408). */
export const DEFAULT_GRAPHICS_WHITE_NITS = PQ_SDR_WHITE_NITS;
export const MIN_GRAPHICS_WHITE_NITS = 80;
export const MAX_GRAPHICS_WHITE_NITS = 1000;

/** Where 8-bit graphics (titles, shapes, subtitles) sit: the working-space gain of their sRGB white. */
export function graphicsWhiteGain(nits: number | undefined): number {
  if (nits === undefined || !Number.isFinite(nits)) return 1;
  return Math.max(MIN_GRAPHICS_WHITE_NITS, Math.min(MAX_GRAPHICS_WHITE_NITS, nits)) / PQ_SDR_WHITE_NITS;
}

/** Straight-alpha 8-bit RGBA (a canvas read-back) drawn over the float image at graphics white. */
export interface HdrOverlay8 {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface HdrFrame {
  readonly width: number;
  readonly height: number;
  /** Scene-linear BT.2020, premultiplied by alpha (so the colour is the picture over black). */
  readonly data: Float32Array;
}

export interface HdrCompositor {
  readonly kind: "gpu" | "cpu";
  /** Which colour pipeline the compositor runs (overlay entry, SDR view, encode). Default scene-hdr. Persists across frames. */
  setColorPipeline(pipeline: HdrColorPipeline): void;
  begin(width: number, height: number): void;
  /** Sets where 8-bit overlays (graphics) sit, as the nits of their white. Default 203. Persists across frames. */
  setGraphicsWhite(nits: number): void;
  /** A flat colour (scene-linear BT.2020) laid over the image with the given alpha: the colour of a dip transition. */
  drawSolid(rgb: readonly [number, number, number], alpha: number): void;
  /** Source codes drawn as a layer: decode -> resample -> grade -> over. */
  drawCodes(codes: SourceCodes | { readonly depth: "canvas"; readonly source: ImageBitmap | OffscreenCanvas }, decode: HdrSourceDecode, draw: HdrLayerDraw): void;
  drawOverlay(overlay: HdrOverlay8 | OffscreenCanvas | ImageBitmap): void;
  /** Tone-mapped 8-bit sRGB view (straight RGBA), for the preview and SDR consumers. */
  readSdrView(): Uint8ClampedArray;
  /** The float image (premultiplied linear BT.2020). */
  readFrame(): HdrFrame;
  /** Output-encoded R'G'B' (display referred, 0..1) per pixel, three floats each. */
  readEncodedRgb(spec: OutputColorSpec): Float32Array;
  dispose(): void;
}

function bilerpLinear(layer: HdrLayerPixels, x0: number, y0: number, w: number, h: number, sx: number, sy: number, out: number[]): void {
  // Texel centres at i + 0.5; clamp taps inside the visible rectangle.
  const fx = sx - 0.5;
  const fy = sy - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const ax = fx - ix;
  const ay = fy - iy;
  const xMax = Math.floor(x0 + w) - 1;
  const yMax = Math.floor(y0 + h) - 1;
  const xa = Math.max(Math.floor(x0), Math.min(xMax, ix));
  const xb = Math.max(Math.floor(x0), Math.min(xMax, ix + 1));
  const ya = Math.max(Math.floor(y0), Math.min(yMax, iy));
  const yb = Math.max(Math.floor(y0), Math.min(yMax, iy + 1));
  const d = layer.data;
  const i00 = (ya * layer.width + xa) * 4;
  const i10 = (ya * layer.width + xb) * 4;
  const i01 = (yb * layer.width + xa) * 4;
  const i11 = (yb * layer.width + xb) * 4;
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] * (1 - ax) + d[i10 + c] * ax;
    const bottom = d[i01 + c] * (1 - ax) + d[i11 + c] * ax;
    out[c] = top * (1 - ay) + bottom * ay;
  }
}

/** Float32 reference compositor. Also the fallback when WebGL2 half-float rendering is unavailable. */
export class CpuHdrCompositor implements HdrCompositor {
  readonly kind = "cpu" as const;
  private width = 0;
  private height = 0;
  private acc = new Float32Array(0);
  private overlayGain = 1;
  private pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE;

  setColorPipeline(pipeline: HdrColorPipeline): void {
    this.pipeline = pipeline;
  }

  setGraphicsWhite(nits: number): void {
    this.overlayGain = graphicsWhiteGain(nits);
  }

  drawSolid(rgb: readonly [number, number, number], alpha: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0) return;
    const keep = 1 - a;
    const acc = this.acc;
    for (let o = 0; o < acc.length; o += 4) {
      acc[o] = rgb[0] * a + acc[o] * keep;
      acc[o + 1] = rgb[1] * a + acc[o + 1] * keep;
      acc[o + 2] = rgb[2] * a + acc[o + 2] * keep;
      acc[o + 3] = a + acc[o + 3] * keep;
    }
  }

  begin(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.acc.length !== width * height * 4) this.acc = new Float32Array(width * height * 4);
    else this.acc.fill(0);
  }

  drawCodes(
    codes: SourceCodes | { readonly depth: "canvas"; readonly source: ImageBitmap | OffscreenCanvas },
    decode: HdrSourceDecode,
    draw: HdrLayerDraw,
  ): void {
    const resolved = codes.depth === "canvas" ? readCanvasCodes(codes.source) : codes;
    const layer = decodeSourceToLinear(resolved, decode);
    this.drawLinear(draw.effects && draw.effects.length > 0 ? applyHdrEffects(layer, draw.effects) : layer, draw);
  }

  /** Draws an already decoded layer. */
  drawLinear(layer: HdrLayerPixels, draw: HdrLayerDraw): void {
    const { geometry: g, opacity, grade } = draw;
    const [m0, m1, m2, m3, m4, m5] = g.m;
    const [x0, y0, rw, rh] = g.rect;
    const px = [0, 0, 0, 0];
    const acc = this.acc;
    const aspect = layer.width / layer.height;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dx = x + 0.5;
        const dy = y + 0.5;
        const sx = m0 * dx + m1 * dy + m2;
        const sy = m3 * dx + m4 * dy + m5;
        const coverage = layerCoverage(g, sx, sy);
        if (coverage <= 0) continue;
        bilerpLinear(layer, x0, y0, rw, rh, sx, sy, px);
        const alpha = Math.max(0, Math.min(1, px[3])) * coverage * opacity;
        if (alpha <= 0) continue;
        let r = px[0];
        let gC = px[1];
        let b = px[2];
        if (grade) {
          [r, gC, b] = gradeHdrPixel(r, gC, b, grade, { nx: (sx / layer.width) * 2 - 1, ny: (sy / layer.height) * 2 - 1, aspect });
        }
        const o = (y * this.width + x) * 4;
        const keep = 1 - alpha;
        acc[o] = r * alpha + acc[o] * keep;
        acc[o + 1] = gC * alpha + acc[o + 1] * keep;
        acc[o + 2] = b * alpha + acc[o + 2] * keep;
        acc[o + 3] = alpha + acc[o + 3] * keep;
      }
    }
  }

  drawOverlay(overlay: HdrOverlay8 | OffscreenCanvas | ImageBitmap): void {
    const pixels = "data" in overlay ? overlay : readCanvasCodes(overlay);
    if (pixels.width !== this.width || pixels.height !== this.height) throw new Error("Overlay size does not match the HDR frame.");
    const lut = decodeLut8(HDR_TRANSFER_SRGB);
    const gain = this.overlayGain;
    const [m0, m1, m2] = overlayDecodeFor(this.pipeline).toBt2020;
    const src = pixels.data as ArrayLike<number>;
    const acc = this.acc;
    const n = this.width * this.height;
    for (let p = 0, o = 0; p < n; p++, o += 4) {
      const a = src[o + 3] / 255;
      if (a <= 0) continue;
      const lr = lut[src[o]];
      const lg = lut[src[o + 1]];
      const lb = lut[src[o + 2]];
      const keep = 1 - a;
      acc[o] = (m0[0] * lr + m0[1] * lg + m0[2] * lb) * gain * a + acc[o] * keep;
      acc[o + 1] = (m1[0] * lr + m1[1] * lg + m1[2] * lb) * gain * a + acc[o + 1] * keep;
      acc[o + 2] = (m2[0] * lr + m2[1] * lg + m2[2] * lb) * gain * a + acc[o + 2] * keep;
      acc[o + 3] = a + acc[o + 3] * keep;
    }
  }

  readSdrView(): Uint8ClampedArray {
    return hdrFrameToSdrRgba(this.readFrame(), this.pipeline);
  }

  readFrame(): HdrFrame {
    return { width: this.width, height: this.height, data: this.acc.slice() };
  }

  readEncodedRgb(spec: OutputColorSpec): Float32Array {
    return encodeHdrFrameRgb({ width: this.width, height: this.height, data: this.acc }, spec, this.pipeline);
  }

  dispose(): void {
    this.acc = new Float32Array(0);
  }
}

let scratch: OffscreenCanvas | null = null;
/** 8-bit straight-alpha read-back of a canvas / bitmap. */
export function readCanvasCodes(source: ImageBitmap | OffscreenCanvas): { depth: 8; width: number; height: number; data: Uint8ClampedArray } {
  if (!scratch || scratch.width !== source.width || scratch.height !== source.height) scratch = new OffscreenCanvas(source.width, source.height);
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D context for the HDR frame read-back.");
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, source.width, source.height);
  return { depth: 8, width: image.width, height: image.height, data: image.data };
}

// -- output transforms ----------------------------------------------------------------------------------------

function toneShoulder(y: number): number {
  if (y <= TONE_MAP_KNEE) return y;
  const range = 1 - TONE_MAP_KNEE;
  return TONE_MAP_KNEE + range * (1 - Math.exp(-(y - TONE_MAP_KNEE) / range));
}

/** Hue-preserving highlight roll-off (the input transform's shoulder) applied to a linear RGB triple. */
function toneMapTriple(rgb: [number, number, number], lr: number, lg: number, lb: number): void {
  const y = lr * rgb[0] + lg * rgb[1] + lb * rgb[2];
  if (y > TONE_MAP_KNEE) {
    const scale = toneShoulder(y) / y;
    rgb[0] *= scale;
    rgb[1] *= scale;
    rgb[2] *= scale;
  }
}

const SRGB_LUT_SIZE = 4096;
let srgbEncodeTable: Float32Array | null = null;
function srgbEncode(linear: number): number {
  if (!srgbEncodeTable) {
    srgbEncodeTable = new Float32Array(SRGB_LUT_SIZE + 1);
    for (let i = 0; i <= SRGB_LUT_SIZE; i++) {
      const root = i / SRGB_LUT_SIZE;
      srgbEncodeTable[i] = encodeOutputTransfer(root * root, "bt709");
    }
  }
  const c = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const pos = Math.sqrt(c) * SRGB_LUT_SIZE;
  const lo = Math.floor(pos);
  const hi = lo >= SRGB_LUT_SIZE ? SRGB_LUT_SIZE : lo + 1;
  return srgbEncodeTable[lo] + (srgbEncodeTable[hi] - srgbEncodeTable[lo]) * (pos - lo);
}

/**
 * The SDR monitor view: BT.2020 linear -> BT.709, highlight shoulder, clip,
 * sRGB. This is what the preview canvas shows and what an SDR export of an HDR
 * project contains.
 */
export function hdrFrameToSdrRgba(frame: HdrFrame, pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE): Uint8ClampedArray {
  const n = frame.width * frame.height;
  const out = new Uint8ClampedArray(n * 4);
  if (pipeline.kind === "aces") {
    const d = frame.data;
    const rgb = [0, 0, 0];
    const transform = acesOutput();
    for (let p = 0, o = 0; p < n; p++, o += 4) {
      transform(Math.max(0, d[o]), Math.max(0, d[o + 1]), Math.max(0, d[o + 2]), pipeline.sdrOutput, rgb);
      out[o] = Math.round(rgb[0] * 255);
      out[o + 1] = Math.round(rgb[1] * 255);
      out[o + 2] = Math.round(rgb[2] * 255);
      out[o + 3] = Math.round(Math.max(0, Math.min(1, d[o + 3])) * 255);
    }
    return out;
  }
  const [m0, m1, m2] = BT2020_TO_BT709;
  const d = frame.data;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    rgb[0] = Math.max(0, m0[0] * r + m0[1] * g + m0[2] * b);
    rgb[1] = Math.max(0, m1[0] * r + m1[1] * g + m1[2] * b);
    rgb[2] = Math.max(0, m2[0] * r + m2[1] * g + m2[2] * b);
    toneMapTriple(rgb, 0.2126, 0.7152, 0.0722);
    out[o] = Math.round(srgbEncode(rgb[0]) * 255);
    out[o + 1] = Math.round(srgbEncode(rgb[1]) * 255);
    out[o + 2] = Math.round(srgbEncode(rgb[2]) * 255);
    out[o + 3] = Math.round(Math.max(0, Math.min(1, d[o + 3])) * 255);
  }
  return out;
}

const ENCODER_LUT_SIZE = 8192;
const encoderCache = new Map<string, { lut: Float32Array; max: number }>();

/** Maximum linear value each output transfer represents (above it the signal is clipped). */
export function transferLinearMax(transfer: OutputColorSpec["transfer"]): number {
  if (transfer === "pq") return HDR_LINEAR_PEAK;
  if (transfer === "hlg") return 1 / HLG_SDR_WHITE_SCENE;
  return 1;
}

/** Linear -> output signal, tabulated against sqrt(linear / max) for resolution near black. */
export function fastTransferEncoder(transfer: OutputColorSpec["transfer"]): (linear: number) => number {
  let entry = encoderCache.get(transfer);
  if (!entry) {
    const max = transferLinearMax(transfer);
    const lut = new Float32Array(ENCODER_LUT_SIZE + 1);
    for (let i = 0; i <= ENCODER_LUT_SIZE; i++) {
      const root = i / ENCODER_LUT_SIZE;
      lut[i] = encodeOutputTransfer(root * root * max, transfer);
    }
    entry = { lut, max };
    encoderCache.set(transfer, entry);
  }
  const { lut, max } = entry;
  return (linear: number): number => {
    const c = linear <= 0 ? 0 : linear >= max ? max : linear;
    const pos = Math.sqrt(c / max) * ENCODER_LUT_SIZE;
    const lo = Math.floor(pos);
    const hi = lo >= ENCODER_LUT_SIZE ? ENCODER_LUT_SIZE : lo + 1;
    return lut[lo] + (lut[hi] - lut[lo]) * (pos - lo);
  };
}

/**
 * Output transform: working linear -> display-encoded R'G'B' (three floats per
 * pixel, 0..1). PQ and HLG keep everything above SDR white up to their peak;
 * an SDR transfer applies the highlight shoulder first.
 */
/** The ACES output transform an encode of `spec` runs: PQ / HLG targets use the Rec.2020 1000 nit transforms. */
export function acesOutputForSpec(spec: OutputColorSpec, sdrOutput: AcesSdrOutput): AcesOutputId {
  return spec.transfer === "pq" ? "rec2020-pq" : spec.transfer === "hlg" ? "rec2020-hlg" : sdrOutput;
}

export function encodeHdrFrameRgb(frame: HdrFrame, spec: OutputColorSpec, pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE): Float32Array {
  const n = frame.width * frame.height;
  const out = new Float32Array(n * 3);
  if (pipeline.kind === "aces") {
    const id = acesOutputForSpec(spec, pipeline.sdrOutput);
    const d = frame.data;
    const rgb = [0, 0, 0];
    const transform = acesOutput();
    for (let p = 0, o = 0, q = 0; p < n; p++, o += 4, q += 3) {
      transform(Math.max(0, d[o]), Math.max(0, d[o + 1]), Math.max(0, d[o + 2]), id, rgb);
      out[q] = rgb[0];
      out[q + 1] = rgb[1];
      out[q + 2] = rgb[2];
    }
    return out;
  }
  const encode = fastTransferEncoder(spec.transfer);
  const sdr = spec.transfer === "bt709";
  const toBt709 = spec.primaries === "bt709";
  const [m0, m1, m2] = BT2020_TO_BT709;
  const d = frame.data;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let p = 0, o = 0, q = 0; p < n; p++, o += 4, q += 3) {
    let r = d[o];
    let g = d[o + 1];
    let b = d[o + 2];
    if (toBt709) {
      const r7 = m0[0] * r + m0[1] * g + m0[2] * b;
      const g7 = m1[0] * r + m1[1] * g + m1[2] * b;
      const b7 = m2[0] * r + m2[1] * g + m2[2] * b;
      r = r7;
      g = g7;
      b = b7;
    }
    rgb[0] = Math.max(0, r);
    rgb[1] = Math.max(0, g);
    rgb[2] = Math.max(0, b);
    if (sdr) {
      if (toBt709) toneMapTriple(rgb, 0.2126, 0.7152, 0.0722);
      else toneMapTriple(rgb, 0.2627, 0.678, 0.0593);
    }
    out[q] = encode(rgb[0]);
    out[q + 1] = encode(rgb[1]);
    out[q + 2] = encode(rgb[2]);
  }
  return out;
}

const KR = 0.2627;
const KB = 0.0593;
const KG = 1 - KR - KB;

/** Encoded R'G'B' floats to limited-range BT.2020 NCL planar YCbCr (4:2:0 or 4:4:4), 8 or 10 bit. */
export function encodedRgbToYuv(
  rgb: Float32Array,
  width: number,
  height: number,
  bitDepth: 8 | 10,
  chroma: "420" | "444",
): YuvFrame {
  if (chroma === "420" && (width % 2 !== 0 || height % 2 !== 0)) {
    throw new Error(`Colour-managed export needs even frame dimensions, got ${width}x${height}.`);
  }
  const wide = bitDepth === 10;
  const scale = wide ? 4 : 1;
  const lo = 16 * scale;
  const hiY = 235 * scale;
  const hiC = 240 * scale;
  const planeSize = width * height;
  const cw = chroma === "420" ? width / 2 : width;
  const ch = chroma === "420" ? height / 2 : height;
  const chromaSize = cw * ch;
  const samples = wide ? new Uint16Array(planeSize + chromaSize * 2) : new Uint8Array(planeSize + chromaSize * 2);
  const cb = new Float32Array(planeSize);
  const cr = new Float32Array(planeSize);
  for (let p = 0, q = 0; p < planeSize; p++, q += 3) {
    const r = rgb[q];
    const g = rgb[q + 1];
    const b = rgb[q + 2];
    const y = KR * r + KG * g + KB * b;
    samples[p] = Math.max(lo, Math.min(hiY, Math.round((16 + 219 * y) * scale)));
    cb[p] = (128 + (224 * (b - y)) / (2 * (1 - KB))) * scale;
    cr[p] = (128 + (224 * (r - y)) / (2 * (1 - KR))) * scale;
  }
  const clampC = (v: number): number => Math.max(lo, Math.min(hiC, Math.round(v)));
  if (chroma === "444") {
    for (let p = 0; p < planeSize; p++) {
      samples[planeSize + p] = clampC(cb[p]);
      samples[planeSize * 2 + p] = clampC(cr[p]);
    }
  } else {
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const i0 = cy * 2 * width + cx * 2;
        const out = cy * cw + cx;
        samples[planeSize + out] = clampC((cb[i0] + cb[i0 + 1] + cb[i0 + width] + cb[i0 + width + 1]) / 4);
        samples[planeSize + chromaSize + out] = clampC((cr[i0] + cr[i0 + 1] + cr[i0 + width] + cr[i0 + width + 1]) / 4);
      }
    }
  }
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const format = chroma === "444" ? "I444P10" : wide ? "I420P10" : "I420";
  return { format, data: bytes, width, height };
}

/** Float frame -> encoder planes in the output colour space (what the export backends send). */
export function hdrFrameToYuv(frame: HdrFrame, spec: OutputColorSpec, chroma: "420" | "444"): YuvFrame {
  return encodedRgbToYuv(encodeHdrFrameRgb(frame, spec), frame.width, frame.height, spec.bitDepth, chroma);
}

// -- float payload carried beside a rendered bitmap ----------------------------------------------------------

// Payload store lives in ./hdr-payload so the export backends can read it without loading this module.
export { attachHdrPayload, takeHdrPayload, type HdrPayload } from "./hdr-payload";
