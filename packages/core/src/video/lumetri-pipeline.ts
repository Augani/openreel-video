import type {
  ClipColorGrading,
  ColorWheelValues,
  CpuGradingStages,
  ToneValues,
} from "./color-grading-engine";
import {
  isNeutralColorWheels,
  isNeutralCurves,
  isNeutralHsl,
  isNeutralLut,
  isNeutralTone,
  isNeutralVignette,
} from "./color-grading-defaults";
import {
  applyHueCurvesToRgb,
  buildHueCurveLuts,
  isNeutralHueCurves,
  type HueCurveLuts,
  type HueCurvesValues,
} from "./hue-curves";
import { buildToneCurve, sampleToneCurve } from "./tone-curve";

/**
 * Lumetri processing order.
 *
 *  - Version 1 (every clip with no `pipelineVersion`) is the classic order the
 *    editor has always used: colour wheels first, then the 8-bit CPU stages
 *    tone -> vignette -> curves -> LUT -> HSL, then white balance. Existing
 *    projects keep rendering exactly as before.
 *  - Version 2 is the Premiere-style order: white balance and Basic Correction
 *    first, then the colour wheels and the hue curves, all fused in one float
 *    pass (GPU fragment shader or the identical CPU reference below), then
 *    curves -> LUT -> HSL -> vignette. Clips opt in explicitly.
 */
export type ColorPipelineVersion = 1 | 2;

export const LEGACY_COLOR_PIPELINE: ColorPipelineVersion = 1;
export const PREMIERE_COLOR_PIPELINE: ColorPipelineVersion = 2;

export function resolveColorPipelineVersion(
  grading: { pipelineVersion?: number } | undefined,
): ColorPipelineVersion {
  return grading?.pipelineVersion === 2 ? 2 : 1;
}

/** Stages that run in one float pass (no 8-bit quantisation between them). */
export interface FusedGradeStages {
  tone?: ToneValues;
  wheels?: ColorWheelValues;
  hueCurves?: HueCurvesValues;
}

export interface FusedGradeData {
  /** 256-entry float tone curve, absent when Basic Correction is neutral. */
  toneCurve?: Float32Array;
  wheels?: ColorWheelValues;
  hueLuts?: HueCurveLuts;
}

export function prepareFusedGrade(stages: FusedGradeStages): FusedGradeData {
  const data: FusedGradeData = {};
  if (stages.tone && !isNeutralTone(stages.tone)) data.toneCurve = buildToneCurve(stages.tone);
  if (stages.wheels && !isNeutralColorWheels(stages.wheels)) data.wheels = stages.wheels;
  if (stages.hueCurves && !isNeutralHueCurves(stages.hueCurves)) {
    data.hueLuts = buildHueCurveLuts(stages.hueCurves);
  }
  return data;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Float colour wheels: the same arithmetic as the fused GLSL stage (negative values clamp before the gamma). */
export function applyColorWheelsToRgb(
  r: number,
  g: number,
  b: number,
  wheels: ColorWheelValues,
): [number, number, number] {
  const luma = r * 0.299 + g * 0.587 + b * 0.114;
  const shadowWeight = 1 - smoothstep(0, 0.5, luma);
  const highlightWeight = smoothstep(0.5, 1, luma);
  const midtoneWeight = 1 - shadowWeight - highlightWeight;
  const channels = [r, g, b] as const;
  const keys = ["r", "g", "b"] as const;
  const out: [number, number, number] = [0, 0, 0];
  const invGamma = 1 / (wheels.midtonesGamma > 0 ? wheels.midtonesGamma : 1);
  const gain = 1 + (wheels.highlightsGain - 1) * highlightWeight;
  for (let c = 0; c < 3; c++) {
    const k = keys[c];
    let value = channels[c];
    value += wheels.shadows[k] * shadowWeight;
    value += wheels.midtones[k] * midtoneWeight;
    value += wheels.highlights[k] * highlightWeight;
    value += wheels.shadowsLift * shadowWeight;
    value = Math.pow(Math.max(value, 0), invGamma);
    out[c] = clamp01(value * gain);
  }
  return out;
}

/** One pixel through tone -> wheels -> hue curves in float (the CPU reference for the GPU pass). */
export function applyFusedGradeToRgb(
  r: number,
  g: number,
  b: number,
  data: FusedGradeData,
): [number, number, number] {
  if (data.toneCurve) {
    r = sampleToneCurve(data.toneCurve, r);
    g = sampleToneCurve(data.toneCurve, g);
    b = sampleToneCurve(data.toneCurve, b);
  }
  if (data.wheels) {
    [r, g, b] = applyColorWheelsToRgb(r, g, b, data.wheels);
  }
  if (data.hueLuts) {
    [r, g, b] = applyHueCurvesToRgb(r, g, b, data.hueLuts);
  }
  return [r, g, b];
}

/**
 * CPU fallback for the fused pass: float arithmetic per pixel, one rounding to
 * 8 bits at the very end. Alpha is untouched.
 */
export function applyFusedGradeToData(data: Uint8ClampedArray, stages: FusedGradeStages): void {
  const prepared = prepareFusedGrade(stages);
  if (!prepared.toneCurve && !prepared.wheels && !prepared.hueLuts) return;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = applyFusedGradeToRgb(
      data[i] / 255,
      data[i + 1] / 255,
      data[i + 2] / 255,
      prepared,
    );
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
}

export function hasFusedStages(stages: FusedGradeStages | null | undefined): stages is FusedGradeStages {
  if (!stages) return false;
  return (
    !isNeutralTone(stages.tone) ||
    !isNeutralColorWheels(stages.wheels) ||
    !isNeutralHueCurves(stages.hueCurves)
  );
}

export interface PlannableGrading {
  pipelineVersion?: number;
  colorWheels?: ColorWheelValues;
  curves?: ClipColorGrading["curves"];
  lut?: CpuGradingStages["lut"];
  /** Input LUT, applied to the source before every other stage. */
  inputLut?: CpuGradingStages["lut"];
  hsl?: ClipColorGrading["hsl"];
  tone?: ToneValues;
  vignette?: ClipColorGrading["vignette"];
  hueCurves?: HueCurvesValues;
  temperature?: number;
  tint?: number;
}

export interface ColorGradingPlan {
  version: ColorPipelineVersion;
  /** Version 1 only: the WebGL wheels pass that runs before the CPU stages. */
  legacyWheels: ColorWheelValues | null;
  /** Version 2 only: tone -> wheels -> hue curves in one float pass. */
  fused: FusedGradeStages | null;
  /** The 8-bit CPU stages (curves/LUT/HSL, plus tone/vignette on version 1). */
  cpu: CpuGradingStages | null;
  /** Input LUT (camera log -> working space): runs first, before white balance and every grading stage. */
  inputLut: CpuGradingStages["lut"] | null;
  /** True when white balance must run before every other stage (version 2). */
  whiteBalanceFirst: boolean;
}

/**
 * Single decision point for stage order, shared by the preview bridge, the
 * export renderer and the fallback so they cannot drift apart.
 */
export function planColorGrading(grading: PlannableGrading): ColorGradingPlan {
  const version = resolveColorPipelineVersion(grading);
  const cpu: CpuGradingStages = {};
  let hasCpu = false;
  const inputLut =
    grading.inputLut && !isNeutralLut(grading.inputLut) ? grading.inputLut : null;

  if (version === 1) {
    if (grading.tone && !isNeutralTone(grading.tone)) {
      cpu.tone = grading.tone;
      hasCpu = true;
    }
    if (grading.vignette && !isNeutralVignette(grading.vignette)) {
      cpu.vignette = grading.vignette;
      hasCpu = true;
    }
  }
  if (grading.curves && !isNeutralCurves(grading.curves)) {
    cpu.curves = grading.curves;
    hasCpu = true;
  }
  if (grading.lut && !isNeutralLut(grading.lut)) {
    cpu.lut = grading.lut;
    hasCpu = true;
  }
  if (grading.hsl && !isNeutralHsl(grading.hsl)) {
    cpu.hsl = grading.hsl;
    hasCpu = true;
  }

  if (version === 1) {
    return {
      version,
      inputLut,
      legacyWheels:
        grading.colorWheels && !isNeutralColorWheels(grading.colorWheels)
          ? grading.colorWheels
          : null,
      fused: null,
      cpu: hasCpu ? cpu : null,
      whiteBalanceFirst: false,
    };
  }

  if (grading.vignette && !isNeutralVignette(grading.vignette)) {
    cpu.vignette = grading.vignette;
    cpu.vignetteLast = true;
    hasCpu = true;
  }
  const fusedCandidate: FusedGradeStages = {
    tone: grading.tone,
    wheels: grading.colorWheels,
    hueCurves: grading.hueCurves,
  };
  return {
    version,
    inputLut,
    legacyWheels: null,
    fused: hasFusedStages(fusedCandidate) ? fusedCandidate : null,
    cpu: hasCpu ? cpu : null,
    whiteBalanceFirst: true,
  };
}
