/**
 * Pure planner of the WebGPU grade chain.
 *
 * Turns a clip's enabled effects and colour grade into the ordered list of fragment passes that reproduce what the
 * Canvas2D / WebGL path does, stage for stage, in the same order (effects first, then the grade chosen by
 * planColorGrading: input LUT, white balance, wheels or the fused float pass, then tone / vignette / curves / LUT /
 * HSL). Returns null when any stage has no WGSL port (a blur effect, a plugin ...); the caller then keeps the
 * existing path for the whole clip so the effect order is never changed.
 *
 * Nothing here touches the GPU: tables are described by a cache key plus a lazy builder, so a frame whose tables are
 * already resident never rebuilds them.
 */
import type { Effect } from "../types/timeline";
import type { CurvePoint } from "../types/effects";
import { hasCurve1d, isLutUsable, packCurve1dRgba, packRgbToRgba, resolveLut3dRgb } from "../color/lut-tables";
import {
  buildCurveLut8,
  type ClipColorGrading,
  type CurvesValues,
  type HSLValues,
  type LUTData,
  type VignetteValues,
} from "./color-grading-engine";
import { isNeutralColorGrading } from "./color-grading-defaults";
import { planColorGrading, prepareFusedGrade, type FusedGradeStages } from "./lumetri-pipeline";
import { HUE_CURVE_LUT_SIZE, packHueCurveLuts } from "./hue-curves";
import { buildToneCurve, buildToneCurve8, TONE_CURVE_SIZE } from "./tone-curve";
import { isProEffectNeutral, isProEffectType, proEffectGpuUniforms, type ProEffectType } from "./pro-effects";
import { isTemporalEffectType } from "./temporal-effects";
import {
  GPU_PRO_ENTRY,
  GPU_PRO_UNIFORM_ORDER,
  GPU_UNIFORM_FLOATS,
  type GpuGradeEntry,
  type GpuProEffectType,
} from "./gpu-grade-wgsl";

/** A colour grade whose LUTs are typed tables (what VideoEngine.normalizeClipColorGrading produces). */
export type GpuGradeInput = Omit<ClipColorGrading, "lut" | "inputLut"> & {
  lut?: LUTData;
  inputLut?: LUTData;
};

/** An RGBA32F 2D table (256 wide for tone / curves / hue luts, `size` wide for a 1D LUT). */
export interface GpuTableSpec {
  /** Cache key: equal keys always build equal tables. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  build(): Float32Array;
}

/** An RGBA32F size^3 table (red fastest). `source` is the object whose identity keys the GPU copy. */
export interface GpuLut3Spec {
  readonly source: object;
  readonly size: number;
  build(): Float32Array;
}

export interface GpuGradePass {
  readonly entry: GpuGradeEntry;
  /** Up to GPU_UNIFORM_FLOATS floats, read by the shader as U(i). */
  readonly uniforms: readonly number[];
  readonly table?: GpuTableSpec;
  readonly lut3?: GpuLut3Spec;
  /** Short label for stats and tests. */
  readonly label: string;
}

export interface GpuGradeChainPlan {
  readonly passes: readonly GpuGradePass[];
}

export const MAX_GPU_GRADE_PASSES = 32;

const GPU_PRO_TYPES = Object.keys(GPU_PRO_UNIFORM_ORDER) as GpuProEffectType[];

export function isGpuProEffectType(type: string): type is GpuProEffectType {
  return (GPU_PRO_TYPES as string[]).includes(type);
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
/** Stable id of an object, so a table keyed by identity gets a string cache key. */
function objectId(value: object): number {
  let id = objectIds.get(value);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(value, id);
  }
  return id;
}

function pad(values: readonly number[]): number[] {
  const out = new Array<number>(GPU_UNIFORM_FLOATS).fill(0);
  for (let i = 0; i < values.length && i < GPU_UNIFORM_FLOATS; i++) out[i] = values[i];
  return out;
}

/* ------------------------------------------------------------------ tables */

function toneTable(tone: Parameters<typeof buildToneCurve>[0], bytes: boolean): GpuTableSpec {
  return {
    key: `${bytes ? "tone8" : "tone"}:${tone.exposure},${tone.contrast},${tone.highlights},${tone.shadows},${tone.whites},${tone.blacks}`,
    width: TONE_CURVE_SIZE,
    height: 1,
    build() {
      const out = new Float32Array(TONE_CURVE_SIZE * 4);
      const curve = bytes ? buildToneCurve8(tone) : buildToneCurve(tone);
      for (let i = 0; i < TONE_CURVE_SIZE; i++) out[i * 4] = bytes ? (curve[i] as number) / 255 : (curve[i] as number);
      return out;
    },
  };
}

function curvesTable(curves: CurvesValues): GpuTableSpec {
  const key = (points: readonly CurvePoint[]): string => points.map((p) => `${p.x},${p.y}`).join(";");
  return {
    key: `curves:${key(curves.red)}|${key(curves.green)}|${key(curves.blue)}|${key(curves.rgb)}`,
    width: 256,
    height: 1,
    build() {
      const red = buildCurveLut8(curves.red);
      const green = buildCurveLut8(curves.green);
      const blue = buildCurveLut8(curves.blue);
      const rgb = buildCurveLut8(curves.rgb);
      const out = new Float32Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        out[i * 4] = red[i] / 255;
        out[i * 4 + 1] = green[i] / 255;
        out[i * 4 + 2] = blue[i] / 255;
        out[i * 4 + 3] = rgb[i] / 255;
      }
      return out;
    },
  };
}

/* ------------------------------------------------------------------ grade stages */

function fusedPass(stages: FusedGradeStages, label: string): GpuGradePass | null {
  const prepared = prepareFusedGrade(stages);
  if (!prepared.toneCurve && !prepared.wheels && !prepared.hueLuts) return null;
  const wheels = prepared.wheels;
  const u = new Array<number>(16).fill(0);
  u[0] = prepared.toneCurve ? 1 : 0;
  u[1] = wheels ? 1 : 0;
  u[2] = prepared.hueLuts ? 1 : 0;
  if (wheels) {
    u[4] = wheels.shadows.r; u[5] = wheels.shadows.g; u[6] = wheels.shadows.b; u[7] = wheels.shadowsLift;
    u[8] = wheels.midtones.r; u[9] = wheels.midtones.g; u[10] = wheels.midtones.b;
    u[11] = wheels.midtonesGamma > 0 ? wheels.midtonesGamma : 1;
    u[12] = wheels.highlights.r; u[13] = wheels.highlights.g; u[14] = wheels.highlights.b;
    u[15] = wheels.highlightsGain;
  }
  const toneKey = stages.tone && prepared.toneCurve ? toneTable(stages.tone, false).key : "none";
  const hueKey = stages.hueCurves && prepared.hueLuts ? JSON.stringify(stages.hueCurves) : "none";
  const table: GpuTableSpec = {
    key: `fused:${toneKey}|${hueKey}`,
    width: Math.max(TONE_CURVE_SIZE, HUE_CURVE_LUT_SIZE),
    height: 2,
    build() {
      const out = new Float32Array(256 * 2 * 4);
      if (prepared.toneCurve) for (let i = 0; i < 256; i++) out[i * 4] = prepared.toneCurve[i];
      if (prepared.hueLuts) out.set(packHueCurveLuts(prepared.hueLuts), 256 * 4);
      return out;
    },
  };
  return { entry: "fs_fused", uniforms: pad(u), table, label };
}

function lutPass(lut: LUTData, label: string): GpuGradePass | null {
  if (!isLutUsable(lut)) return null;
  const intensity = lut.intensity;
  if (hasCurve1d(lut.curve1d)) {
    const curve = lut.curve1d;
    const u = [curve.size, intensity, 0, 0, ...curve.domainMin, 0, ...curve.domainMax, 0];
    return {
      entry: "fs_lut1",
      uniforms: pad(u),
      table: {
        key: `lut1d:${objectId(curve)}`,
        width: curve.size,
        height: 1,
        build: () => packCurve1dRgba(curve),
      },
      label,
    };
  }
  const size = lut.size;
  return {
    entry: "fs_lut3",
    uniforms: pad([size, intensity]),
    lut3: {
      source: lut,
      size,
      build: () => packRgbToRgba(resolveLut3dRgb(lut), size * size * size),
    },
    label,
  };
}

function hslPass(hsl: HSLValues): GpuGradePass {
  const u = new Array<number>(24).fill(0);
  for (let i = 0; i < 8; i++) {
    u[i] = finite(hsl.hue[i], 0);
    u[8 + i] = finite(hsl.saturation[i], 0);
    u[16 + i] = finite(hsl.luminance[i], 0);
  }
  return { entry: "fs_hsl", uniforms: pad(u), label: "hsl" };
}

function vignettePass(v: VignetteValues, width: number, height: number): GpuGradePass {
  return {
    entry: "fs_vignette",
    uniforms: pad([v.amount, v.midpoint, v.roundness, v.feather, width / height, width, height]),
    label: "vignette",
  };
}

function whiteBalancePass(grading: GpuGradeInput): GpuGradePass | null {
  const temperature = finite(grading.temperature, 0);
  const tint = finite(grading.tint, 0);
  if (temperature === 0 && tint === 0) return null;
  return { entry: "fs_wb", uniforms: pad([temperature, tint]), label: "white-balance" };
}

/** Passes of the colour grade, in the order VideoEngine.applyClipColorGrading runs the same stages. */
function gradePasses(grading: GpuGradeInput, width: number, height: number): GpuGradePass[] | null {
  if (isNeutralColorGrading(grading)) return [];
  const plan = planColorGrading(grading);
  const passes: GpuGradePass[] = [];
  const push = (pass: GpuGradePass | null): void => {
    if (pass) passes.push(pass);
  };

  if (plan.inputLut) {
    const pass = lutPass(plan.inputLut, "input-lut");
    if (!pass) return null;
    passes.push(pass);
  }
  if (plan.whiteBalanceFirst) push(whiteBalancePass(grading));
  if (plan.legacyWheels) push(fusedPass({ wheels: plan.legacyWheels }, "wheels"));
  if (plan.fused) push(fusedPass(plan.fused, "fused"));

  const cpu = plan.cpu;
  if (cpu) {
    if (cpu.tone) {
      passes.push({ entry: "fs_tone8", uniforms: pad([]), table: toneTable(cpu.tone, true), label: "tone" });
    }
    if (cpu.vignette && !cpu.vignetteLast) passes.push(vignettePass(cpu.vignette, width, height));
    if (cpu.curves) passes.push({ entry: "fs_curves", uniforms: pad([]), table: curvesTable(cpu.curves), label: "curves" });
    if (cpu.lut) {
      const pass = lutPass(cpu.lut, "lut");
      if (!pass) return null;
      passes.push(pass);
    }
    if (cpu.hsl) passes.push(hslPass(cpu.hsl));
    if (cpu.vignette && cpu.vignetteLast) passes.push(vignettePass(cpu.vignette, width, height));
  }
  if (!plan.whiteBalanceFirst) push(whiteBalancePass(grading));
  return passes;
}

/* ------------------------------------------------------------------ effect stages */

function proPass(effect: Effect, height: number): GpuGradePass | null | "unsupported" {
  const type = effect.type;
  if (!isProEffectType(type) || !isGpuProEffectType(type)) return "unsupported";
  if (isProEffectNeutral(type as ProEffectType, effect.params)) return null;
  const uniforms = proEffectGpuUniforms(type as ProEffectType, effect.params, height);
  const order = GPU_PRO_UNIFORM_ORDER[type];
  const packed = order.map((name) => finite(uniforms[name], 0));
  return { entry: GPU_PRO_ENTRY[type] as GpuGradeEntry, uniforms: pad(packed), label: type };
}

/**
 * Builds the plan for one clip frame, or null when some stage cannot run on the GPU chain.
 * `effects` are the clip's already-animated effects; disabled ones are ignored here as everywhere else.
 */
export function planGpuGradeChain(
  effects: readonly Effect[],
  grading: GpuGradeInput | undefined,
  width: number,
  height: number,
): GpuGradeChainPlan | null {
  if (width <= 0 || height <= 0) return null;
  const passes: GpuGradePass[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    // Echo / Posterize Time pick source frames upstream; there is nothing to draw per pixel.
    if (isTemporalEffectType(effect.type)) continue;
    const pass = proPass(effect, height);
    if (pass === "unsupported") return null;
    if (pass) passes.push(pass);
  }
  if (grading) {
    const stages = gradePasses(grading, width, height);
    if (!stages) return null;
    passes.push(...stages);
  }
  if (passes.length > MAX_GPU_GRADE_PASSES) return null;
  return { passes };
}
