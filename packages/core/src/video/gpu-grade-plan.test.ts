import { describe, expect, it } from "vitest";
import type { Effect } from "../types/timeline";
import {
  DEFAULT_COLOR_WHEELS,
  DEFAULT_CURVES,
  DEFAULT_HSL,
  DEFAULT_TONE,
  DEFAULT_VIGNETTE,
  buildCurveLut8,
  type LUTData,
} from "./color-grading-engine";
import { PRO_EFFECT_DEFAULTS, PRO_EFFECT_NEUTRAL_PARAMS, proEffectGpuUniforms } from "./pro-effects";
import { PRO_EFFECT_SHADER_DEFS } from "./pro-effect-shaders";
import { buildToneCurve, buildToneCurve8 } from "./tone-curve";
import { applyColorWheelsToRgb } from "./lumetri-pipeline";
import { GPU_GRADE_ENTRIES, GPU_GRADE_WGSL, GPU_PRO_ENTRY, GPU_PRO_UNIFORM_ORDER, GPU_UNIFORM_FLOATS, type GpuProEffectType } from "./gpu-grade-wgsl";
import { MAX_GPU_GRADE_PASSES, planGpuGradeChain, type GpuGradeInput } from "./gpu-grade-plan";

const effect = (type: string, params: Record<string, unknown> = {}, enabled = true): Effect => ({
  id: `fx-${type}`,
  type,
  enabled,
  params: { ...(PRO_EFFECT_DEFAULTS as Record<string, Record<string, unknown>>)[type], ...params },
});

const tone = { ...DEFAULT_TONE, exposure: 0.2, contrast: 0.3, shadows: 0.25 };
const wheels = { ...DEFAULT_COLOR_WHEELS, midtonesGamma: 1.2, highlightsGain: 1.1, shadows: { r: 0.04, g: 0, b: 0.05 } };
const curves = { ...DEFAULT_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 1, y: 1 }] };
const hsl = { ...DEFAULT_HSL, hue: [10, 0, 0, 0, 0, 0, 0, 0] };
const vignette = { ...DEFAULT_VIGNETTE, amount: -0.5 };

function lut3(size: number, intensity = 1): LUTData {
  const floatData = new Float32Array(size ** 3 * 3);
  for (let i = 0; i < floatData.length; i++) floatData[i] = (i % 7) / 7;
  return { data: new Uint8Array(floatData.length), floatData, size, intensity };
}

const labels = (grading: GpuGradeInput | undefined, effects: Effect[] = []): string[] | null =>
  planGpuGradeChain(effects, grading, 320, 180)?.passes.map((p) => p.label) ?? null;

describe("planGpuGradeChain stage order", () => {
  it("is empty for a neutral clip", () => {
    expect(labels(undefined)).toEqual([]);
    expect(labels({ colorWheels: DEFAULT_COLOR_WHEELS, curves: DEFAULT_CURVES, hsl: DEFAULT_HSL })).toEqual([]);
    expect(labels(undefined, [effect("lumetri-creative", {}, false)])).toEqual([]);
  });

  it("runs the classic order: wheels, tone, vignette, curves, LUT, HSL, then white balance", () => {
    expect(labels({ colorWheels: wheels, tone, vignette, curves, lut: lut3(5), hsl, temperature: 20 })).toEqual([
      "wheels",
      "tone",
      "vignette",
      "curves",
      "lut",
      "hsl",
      "white-balance",
    ]);
  });

  it("runs the Premiere order: white balance, fused float pass, curves, LUT, HSL, vignette last", () => {
    expect(labels({ pipelineVersion: 2, colorWheels: wheels, tone, vignette, curves, lut: lut3(5), hsl, temperature: 20, inputLut: lut3(5) })).toEqual([
      "input-lut",
      "white-balance",
      "fused",
      "curves",
      "lut",
      "hsl",
      "vignette",
    ]);
  });

  it("puts the effects before the grade, in the clip's effect order", () => {
    expect(labels({ tone }, [effect("dehaze", { amount: 40 }), effect("lumetri-creative", { vibrance: 50 }), effect("deband", { threshold: 6 })])).toEqual([
      "dehaze",
      "lumetri-creative",
      "deband",
      "tone",
    ]);
  });

  it("skips disabled, neutral and temporal effects without refusing the clip", () => {
    const neutral = (type: string): Effect => ({ id: `n-${type}`, type, enabled: true, params: { ...(PRO_EFFECT_NEUTRAL_PARAMS as Record<string, Record<string, unknown>>)[type] } });
    const effects = [effect("dehaze", { amount: 40 }, false), neutral("lumetri-creative"), effect("echo"), effect("posterize-time"), neutral("lens-correction")];
    expect(labels(undefined, effects)).toEqual([]);
  });
});

describe("planGpuGradeChain falls back (null) for what has no WGSL port", () => {
  it("refuses a clip with an effect the chain cannot run, so the effect order is never changed", () => {
    expect(labels({ tone }, [effect("dehaze", { amount: 40 }), { id: "b", type: "blur", enabled: true, params: { radius: 4 } }])).toBeNull();
    expect(labels(undefined, [effect("gaussian-blur", { radius: 6 })])).toBeNull();
    expect(labels(undefined, [{ id: "p", type: "plugin:acme.glow", enabled: true, params: {} }])).toBeNull();
  });

  it("ignores an unsupported effect that is disabled", () => {
    expect(labels({ tone }, [{ id: "b", type: "blur", enabled: false, params: { radius: 4 } }])).toEqual(["tone"]);
  });

  it("refuses a LUT with no usable table and a degenerate frame size", () => {
    const empty: LUTData = { data: new Uint8Array(0), size: 17, intensity: 1 };
    expect(labels({ lut: { ...empty, curve1d: undefined, floatData: new Float32Array(3) } })).toBeNull();
    expect(planGpuGradeChain([], { tone }, 0, 180)).toBeNull();
  });

  it("refuses a chain longer than the uniform buffer holds", () => {
    const many = Array.from({ length: MAX_GPU_GRADE_PASSES + 1 }, (_, i) => ({ ...effect("dehaze", { amount: 30 }), id: `d${i}` }));
    expect(planGpuGradeChain(many, undefined, 320, 180)).toBeNull();
  });
});

describe("pass uniforms and tables", () => {
  it("packs each pro effect's uniforms in the shader's declared order", () => {
    for (const type of Object.keys(GPU_PRO_UNIFORM_ORDER) as GpuProEffectType[]) {
      const params = type === "deflicker" ? { gainR: 1.1, gainG: 0.9, gainB: 1.05 } : type === "hsl-secondary" ? { saturation: -40, temperature: 20 } : {};
      const e = effect(type, params);
      const plan = planGpuGradeChain([e], undefined, 320, 180);
      expect(plan, type).not.toBeNull();
      const pass = plan!.passes[0];
      expect(pass.entry).toBe(GPU_PRO_ENTRY[type]);
      expect(pass.uniforms).toHaveLength(GPU_UNIFORM_FLOATS);
      const u = proEffectGpuUniforms(type, e.params, 180);
      GPU_PRO_UNIFORM_ORDER[type].forEach((name, i) => expect(pass.uniforms[i], `${type}.${name}`).toBe(u[name] ?? 0));
    }
  });

  it("keeps the WGSL uniform order identical to the GLSL shaders' uniform lists", () => {
    for (const type of Object.keys(GPU_PRO_UNIFORM_ORDER) as GpuProEffectType[]) {
      const glslOrder = PRO_EFFECT_SHADER_DEFS[type].params.map((p) => p.name);
      expect([...GPU_PRO_UNIFORM_ORDER[type]], type).toEqual(glslOrder);
    }
  });

  it("every planned entry point exists in the WGSL module", () => {
    for (const entry of GPU_GRADE_ENTRIES) expect(GPU_GRADE_WGSL).toContain(`fn ${entry}(`);
    for (const entry of Object.values(GPU_PRO_ENTRY)) expect(GPU_GRADE_ENTRIES as readonly string[]).toContain(entry);
  });

  it("builds the tone, curve and LUT tables from the same CPU functions the reference uses", () => {
    const plan = planGpuGradeChain([], { tone, curves, lut: lut3(5, 0.5) }, 320, 180)!;
    const toneTable = plan.passes.find((p) => p.label === "tone")!.table!;
    const t8 = buildToneCurve8(tone);
    const built = toneTable.build();
    for (let i = 0; i < 256; i++) expect(built[i * 4]).toBeCloseTo(t8[i] / 255, 6);

    const curvesTable = plan.passes.find((p) => p.label === "curves")!.table!.build();
    const rgb = buildCurveLut8(curves.rgb);
    for (let i = 0; i < 256; i++) expect(curvesTable[i * 4 + 3]).toBeCloseTo(rgb[i] / 255, 6);

    const lutPass = plan.passes.find((p) => p.label === "lut")!;
    expect(lutPass.entry).toBe("fs_lut3");
    expect(lutPass.uniforms.slice(0, 2)).toEqual([5, 0.5]);
    expect(lutPass.lut3!.build()).toHaveLength(5 ** 3 * 4);
  });

  it("the fused pass carries the float tone curve and the wheel constants of the CPU reference", () => {
    const plan = planGpuGradeChain([], { pipelineVersion: 2, tone, colorWheels: wheels }, 320, 180)!;
    const pass = plan.passes[0];
    expect(pass.entry).toBe("fs_fused");
    expect(pass.uniforms.slice(0, 3)).toEqual([1, 1, 0]);
    expect(pass.uniforms[11]).toBe(wheels.midtonesGamma);
    expect(pass.uniforms[15]).toBe(wheels.highlightsGain);
    const curve = buildToneCurve(tone);
    const table = pass.table!.build();
    for (let i = 0; i < 256; i++) expect(table[i * 4]).toBeCloseTo(curve[i], 6);
    // sanity: the reference wheel maths the shader mirrors is finite for a mid grey
    expect(applyColorWheelsToRgb(0.5, 0.5, 0.5, wheels).every(Number.isFinite)).toBe(true);
  });

  it("gives equal grades equal table keys so a resident table is reused, and different grades different keys", () => {
    const a = planGpuGradeChain([], { tone, curves }, 320, 180)!.passes.map((p) => p.table?.key);
    const b = planGpuGradeChain([], { tone: { ...tone }, curves: { ...curves } }, 320, 180)!.passes.map((p) => p.table?.key);
    const c = planGpuGradeChain([], { tone: { ...tone, exposure: 0.4 }, curves }, 320, 180)!.passes.map((p) => p.table?.key);
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(c[0]);
  });
});
