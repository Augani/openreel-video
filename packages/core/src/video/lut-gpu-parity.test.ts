import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorGradingEngine, LUT_SHADER, type LUTData } from "./color-grading-engine";
import { planColorGrading } from "./lumetri-pipeline";
import { isNeutralLut } from "./color-grading-defaults";
import {
  hasCurve1d,
  packCurve1dRgba,
  packRgbToRgba,
  resolveLut3dRgb,
  sampleCurve1dChannel,
  sampleLut3dRgb,
} from "../color/lut-tables";
import { hdrGradeSupported, prepareHdrLut } from "../color/hdr-working";

/** Software emulation of LUT_SHADER: texelFetch over the packed RGBA32F texels, hand-rolled trilinear mix. */
function emulateShader3d(texels: Float32Array, size: number, c: [number, number, number]): [number, number, number] {
  const m = size - 1;
  const fetch = (x: number, y: number, z: number): number[] => {
    const o = (z * size * size + y * size + x) * 4;
    return [texels[o], texels[o + 1], texels[o + 2]];
  };
  const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v * (1 - t) + b[i] * t);
  const idx = c.map((v) => Math.min(1, Math.max(0, v)) * m);
  const i0 = idx.map(Math.floor);
  const fr = idx.map((v, i) => v - i0[i]);
  const i1 = i0.map((v) => Math.min(v + 1, m));
  const c00 = mix(fetch(i0[0], i0[1], i0[2]), fetch(i1[0], i0[1], i0[2]), fr[0]);
  const c10 = mix(fetch(i0[0], i1[1], i0[2]), fetch(i1[0], i1[1], i0[2]), fr[0]);
  const c01 = mix(fetch(i0[0], i0[1], i1[2]), fetch(i1[0], i0[1], i1[2]), fr[0]);
  const c11 = mix(fetch(i0[0], i1[1], i1[2]), fetch(i1[0], i1[1], i1[2]), fr[0]);
  return mix(mix(c00, c10, fr[1]), mix(c01, c11, fr[1]), fr[2]) as [number, number, number];
}

function emulateShaderCurve(texels: Float32Array, size: number, v: number[]): number[] {
  const m = size - 1;
  return v.map((x, ch) => {
    const t = Math.min(1, Math.max(0, x)) * m;
    const f0 = Math.min(Math.floor(t), m);
    const fr = t - f0;
    const i1 = Math.min(f0 + 1, m);
    return texels[f0 * 4 + ch] * (1 - fr) + texels[i1 * 4 + ch] * fr;
  });
}

function lut3(size: number, f: (r: number, g: number, b: number) => [number, number, number]): LUTData {
  const floatData = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = (b * size * size + g * size + r) * 3;
        floatData.set(f(r / (size - 1), g / (size - 1), b / (size - 1)), o);
      }
  const data = new Uint8Array(floatData.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, floatData[i])) * 255);
  return { data, floatData, size, intensity: 1 };
}

function gammaCurve(n: number, gamma: number): LUTData {
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) d.fill(Math.pow(i / (n - 1), gamma), i * 3, i * 3 + 3);
  return {
    data: new Uint8Array(0),
    size: 2,
    intensity: 1,
    curve1d: { size: n, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: d },
  };
}

const floatOnly = (): LUTData => ({ ...lut3(3, (r, g, b) => [r * 2, g, b]), data: new Uint8Array(0) });

describe("LUT GPU shader math parity with the CPU float path", () => {
  it("3D float table: emulated shader equals the shared float sampler, preserving out-of-range values", () => {
    const lut = lut3(5, (r, g, b) => [r * 1.6 - 0.2, g * g * 0.0004, b]);
    const texels = packRgbToRgba(resolveLut3dRgb(lut), 5 ** 3);
    const inputs: [number, number, number][] = [[0, 0, 0], [1, 1, 1], [0.3, 0.7, 0.45], [0.05, 0.02, 0.99]];
    for (const c of inputs) {
      const gpu = emulateShader3d(texels, 5, c);
      const cpu = sampleLut3dRgb(lut.floatData!, 5, c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) expect(gpu[i]).toBeCloseTo(cpu[i], 5);
    }
    expect(emulateShader3d(texels, 5, [1, 0, 0])[0]).toBeCloseTo(1.4, 5);
    expect(emulateShader3d(texels, 5, [0, 0, 0])[0]).toBeCloseTo(-0.2, 5);
    expect(emulateShader3d(texels, 5, [0, 1, 0])[1]).toBeCloseTo(0.0004, 6);
  });

  it("1D curve: emulated shader equals the CPU curve sampler", () => {
    const curve = gammaCurve(33, 2.6).curve1d!;
    const texels = packCurve1dRgba(curve);
    for (const x of [0, 0.013, 0.2, 0.5, 0.77, 1]) {
      const gpu = emulateShaderCurve(texels, curve.size, [x, x, x]);
      for (let ch = 0; ch < 3; ch++) expect(gpu[ch]).toBeCloseTo(sampleCurve1dChannel(curve, ch, x), 6);
    }
  });

  it("a steep gamma 1D LUT has no banding: every 8-bit step maps to a distinct, monotonic float output", () => {
    const curve = gammaCurve(1024, 3).curve1d!;
    const texels = packCurve1dRgba(curve);
    let prev = -1;
    for (let v = 0; v <= 255; v++) {
      const out = emulateShaderCurve(texels, curve.size, [v / 255, 0, 0])[0];
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
    expect(emulateShaderCurve(texels, curve.size, [10 / 255, 0, 0])[0]).toBeCloseTo(Math.pow(10 / 255, 3), 6);
    // The old 8-bit table collapsed the first 20 shadow codes to a couple of values.
    const bytes = new Set<number>();
    for (let v = 0; v < 20; v++) bytes.add(Math.round(Math.pow(v / 255, 3) * 255));
    expect(bytes.size).toBeLessThan(3);
  });

  it("the shader fetches from the float texture and never rounds its result to 8 bits", () => {
    expect(LUT_SHADER).toContain("texelFetch(u_lut, p, 0)");
    expect(LUT_SHADER).toContain("sampleCurve");
    expect(LUT_SHADER).not.toMatch(/255/);
    expect(LUT_SHADER).not.toMatch(/round\(/);
  });
});

describe("float LUT path selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("isNeutralLut and hdrGradeSupported judge float / curve-only LUTs by their float data", () => {
    expect(isNeutralLut(floatOnly())).toBe(false);
    expect(isNeutralLut({ ...floatOnly(), intensity: 0 })).toBe(true);
    expect(isNeutralLut(gammaCurve(8, 2))).toBe(false);
    expect(isNeutralLut({ data: new Uint8Array(0), size: 3, intensity: 1 })).toBe(true);
    expect(hasCurve1d(gammaCurve(8, 2).curve1d)).toBe(true);
    const l = floatOnly();
    const clip = {
      data: [] as number[],
      size: l.size,
      intensity: 1,
      floatData: Array.from(l.floatData!),
    };
    expect(hdrGradeSupported({ lut: clip })).toBe(true);
    // out-of-range 2.0 (r at the last node) survives the HDR table build
    expect(prepareHdrLut(clip)!.rgb[6]).toBeCloseTo(2, 5);
  });

  it("export and preview share one plan: a float-only LUT is planned as the LUT stage; intensity 0 plans nothing", () => {
    const l = floatOnly();
    expect(planColorGrading({ lut: l }).cpu?.lut).toBe(l);
    expect(planColorGrading({ lut: { ...l, intensity: 0 } }).cpu).toBeNull();
  });

  it("applyLUT falls back to the CPU float path when float textures are unavailable", async () => {
    const engine = new ColorGradingEngine(8, 8);
    const gpu = vi.spyOn(engine, "applyLutGpu").mockRejectedValue(new Error("Float textures are unavailable"));
    const cpu = vi
      .spyOn(engine, "applyCpuGrading")
      .mockResolvedValue({ image: {} as ImageBitmap, processingTime: 0 });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lut = floatOnly();
    await engine.applyLUT({} as ImageBitmap, lut);
    expect(gpu).toHaveBeenCalledOnce();
    expect(cpu).toHaveBeenCalledWith(expect.anything(), { lut });
  });

  it("applyLutGpu uploads the float table as RGBA32F and rejects a GPU that refuses it", async () => {
    const engine = new ColorGradingEngine(8, 8);
    const uploads: { internal: number; type: number; data: Float32Array }[] = [];
    let error = 0;
    const base: Record<string, unknown> = {
      RGBA32F: 0x8814,
      FLOAT: 0x1406,
      NO_ERROR: 0,
      getExtension: () => ({}),
      getError: () => error,
      texImage3D: (
        _t: number, _l: number, internal: number, _w: number, _h: number, _d: number,
        _b: number, _f: number, type: number, data: Float32Array,
      ) => {
        uploads.push({ internal, type, data });
      },
    };
    const gl = new Proxy(base, {
      get: (t, k: string) => (k in t ? t[k] : k === k.toUpperCase() ? 1 : () => ({})),
    });
    Object.assign(engine as unknown as Record<string, unknown>, {
      gl,
      initialized: true,
      canvas: { width: 4, height: 4 },
      width: 4,
      height: 4,
      getShader: () => ({ program: {}, uniforms: new Map() }),
      uploadTexture: () => ({}),
      setupVertexAttributes: () => undefined,
    });
    vi.stubGlobal("createImageBitmap", async () => ({}));
    const lut = lut3(2, (r) => [r * 3, 0.0001, -1]);
    await engine.applyLutGpu({ width: 4, height: 4 } as ImageBitmap, lut);
    const tex3d = uploads[0];
    expect(tex3d.internal).toBe(0x8814);
    expect(tex3d.type).toBe(0x1406);
    expect(Math.max(...tex3d.data)).toBeCloseTo(3, 5);
    expect(Math.min(...tex3d.data)).toBeCloseTo(-1, 5);

    error = 0x502;
    await expect(engine.applyLutGpu({ width: 4, height: 4 } as ImageBitmap, lut)).rejects.toThrow(/float LUT texture/);
  });
});
