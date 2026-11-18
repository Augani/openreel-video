import { describe, expect, it } from "vitest";
import {
  hasCurve1d,
  isLutUsable,
  packCurve1dRgba,
  packRgbToRgba,
  resolveLut3dRgb,
  sampleCurve1dChannel,
  sampleLut3dRgb,
} from "./lut-tables";
import { cubeLutToTable, parseCubeLut, parseCubeToLutData, sampleCubeLut } from "./cube-lut";
import { gradeHdrPixel, hdrGradeSupported, prepareHdrGrade, prepareHdrLut } from "./hdr-working";
import { isNeutralLut } from "../video/color-grading-defaults";
import { ColorGradingEngine, type ClipColorGrading, type LUTData } from "../video/color-grading-engine";

const CURVE_CUBE = `LUT_1D_SIZE 6
0.0 0.0 0.0
0.01 0.05 0.1
0.09 0.2 0.3
0.3 0.5 0.55
0.7 0.8 0.85
1.0 1.0 1.0
`;

function cube3d(size: number, header = ""): string {
  const lines: string[] = [`LUT_3D_SIZE ${size}`, header].filter(Boolean);
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        lines.push(`${(r / (size - 1)) ** 2} ${g / (size - 1)} ${(b / (size - 1)) * 0.5}`);
      }
    }
  }
  return lines.join("\n");
}

describe("lut table builders", () => {
  it("resolveLut3dRgb keeps float precision instead of the quantised bytes", () => {
    const size = 2;
    const floatData = new Float32Array(size ** 3 * 3).fill(0.123456);
    const data = new Uint8Array(size ** 3 * 3).fill(31); // 31 / 255 != 0.123456
    const rgb = resolveLut3dRgb({ data, floatData, size });
    expect(rgb[0]).toBeCloseTo(0.123456, 6);
    expect(Math.abs(rgb[0] - 31 / 255)).toBeGreaterThan(1e-4);
  });

  it("keeps out-of-range float outputs that 8-bit bytes would clamp", () => {
    const size = 2;
    const floatData = new Float32Array(size ** 3 * 3).fill(1.25);
    const rgb = resolveLut3dRgb({ data: new Uint8Array(size ** 3 * 3).fill(255), floatData, size });
    expect(rgb[5]).toBeCloseTo(1.25, 6);
  });

  it("falls back to the 8-bit table only when there is no usable float table", () => {
    const size = 2;
    const data = new Uint8Array(size ** 3 * 3).fill(51);
    expect(resolveLut3dRgb({ data, size })[0]).toBeCloseTo(0.2, 6);
    expect(resolveLut3dRgb({ data, floatData: new Float32Array(3), size })[0]).toBeCloseTo(0.2, 6);
  });

  it("packs RGB triples and 1D curves as RGBA32F texels with alpha 1", () => {
    const rgba = packRgbToRgba([0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 2);
    expect(Array.from(rgba).map((v) => Math.round(v * 10) / 10)).toEqual([0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1]);
    const curve = parseCubeToLutData(CURVE_CUBE).curve1d!;
    const tex = packCurve1dRgba(curve);
    expect(tex.length).toBe(curve.size * 4);
    expect(tex[4 + 1]).toBeCloseTo(0.05, 6);
    expect(tex[4 + 3]).toBe(1);
  });

  it("a baked non-default domain maps the table input to the file's domain", () => {
    const text = `LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n${[0, 1, 2, 3, 4, 5, 6, 7]
      .map((i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`)
      .join("\n")}`;
    const lut = parseCubeLut(text);
    const { size, floatData } = cubeLutToTable(lut);
    const m = size - 1;
    // Normalised table input 0.5 is domain input 1.0, the middle of the 0..2 cube.
    const mid = Math.floor(m / 2);
    const idx = (mid * size * size + mid * size + mid) * 3;
    const expected = sampleCubeLut(lut, [(mid / m) * 2, (mid / m) * 2, (mid / m) * 2]);
    expect(floatData[idx]).toBeCloseTo(expected[0], 6);
    // Sampling the baked table at 0.5 agrees with sampling the cube at domain 1.0.
    const baked = sampleLut3dRgb(floatData, size, 0.5, 0.5, 0.5);
    const direct = sampleCubeLut(lut, [1, 1, 1]);
    for (let c = 0; c < 3; c++) expect(baked[c]).toBeCloseTo(direct[c], 4);
  });

  it("sampleCurve1dChannel is exact on the 1D file, unlike the 33^3 resample", () => {
    const lut = parseCubeLut(CURVE_CUBE);
    const data = parseCubeToLutData(CURVE_CUBE);
    const curve = data.curve1d!;
    expect(hasCurve1d(curve)).toBe(true);
    const x = 0.205; // a cell of the 33-point grid containing the 0.2 kink
    const exact = sampleCubeLut(lut, [x, x, x]);
    for (let c = 0; c < 3; c++) expect(sampleCurve1dChannel(curve, c, x)).toBeCloseTo(exact[c], 6);
    const approx = sampleLut3dRgb(data.floatData!, data.size, x, x, x);
    // The resample is a different (coarser) function of the same curve.
    expect(Math.abs(approx[1] - exact[1])).toBeGreaterThan(1e-4);
  });

  it("isLutUsable / isNeutralLut accept float-only and curve-only tables", () => {
    const size = 2;
    const floatData = new Float32Array(size ** 3 * 3);
    expect(isLutUsable({ data: new Uint8Array(0), floatData, size })).toBe(true);
    expect(isLutUsable({ data: new Uint8Array(0), size })).toBe(false);
    expect(isNeutralLut({ data: new Uint8Array(0), floatData, size, intensity: 1 })).toBe(false);
    expect(isNeutralLut({ data: new Uint8Array(0), size, intensity: 1 })).toBe(true);
  });
});

describe("HDR LUT path consumes the float data", () => {
  const toClip = (lut: LUTData): NonNullable<ClipColorGrading["lut"]> => ({
    data: Array.from(lut.data),
    ...(lut.floatData ? { floatData: Array.from(lut.floatData) } : {}),
    ...(lut.curve1d ? { curve1d: { ...lut.curve1d, data: Array.from(lut.curve1d.data) } } : {}),
    size: lut.size,
    intensity: lut.intensity,
    space: "linear",
  });

  it("an identity 1D LUT keeps HDR highlights above its domain, like the 3D identity", () => {
    const id1d = toClip(parseCubeToLutData("LUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1\n"));
    const identity3d = ["LUT_3D_SIZE 2"];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) identity3d.push(`${r} ${g} ${b}`);
    const id3d = toClip(parseCubeToLutData(identity3d.join("\n")));
    const spec1d = prepareHdrGrade({ lut: id1d })!;
    const spec3d = prepareHdrGrade({ lut: id3d })!;
    for (const v of [0.25, 2, 4]) {
      const [r1, g1, b1] = gradeHdrPixel(v, v, v, spec1d);
      const [r3] = gradeHdrPixel(v, v, v, spec3d);
      expect(r1).toBeCloseTo(v, 3);
      expect(g1).toBeCloseTo(v, 3);
      expect(b1).toBeCloseTo(v, 3);
      expect(r1).toBeCloseTo(r3, 3);
    }
  });

  it("prepareHdrLut builds its table from floatData, not the bytes", () => {
    const lut = parseCubeToLutData(cube3d(5));
    const clip = toClip(lut);
    const spec = prepareHdrLut(clip)!;
    expect(spec.rgb[3]).toBeCloseTo(lut.floatData![3], 6);
    // 0.0625 is not representable in 8 bits (16/255 = 0.0627).
    expect(Math.abs(spec.rgb[3] - lut.data[3] / 255)).toBeGreaterThan(1e-4);
    expect(spec.curve).toBeNull();
    expect(prepareHdrLut(clip)).toBe(spec);
  });

  it("is supported with only a float table or only a 1D curve", () => {
    const lut = parseCubeToLutData(cube3d(3));
    expect(hdrGradeSupported({ lut: { ...toClip(lut), data: [] } })).toBe(true);
    const curveLut = toClip(parseCubeToLutData(CURVE_CUBE));
    expect(hdrGradeSupported({ lut: { ...curveLut, data: [], floatData: undefined, size: 2 } })).toBe(true);
    expect(hdrGradeSupported({ lut: { data: [1, 2, 3], size: 3, intensity: 1 } })).toBe(false);
  });

  it("a 1D LUT is applied exactly (HDR CPU reference matches the file's curve)", () => {
    const lut = parseCubeToLutData(CURVE_CUBE);
    const clip = toClip(lut);
    const spec = prepareHdrGrade({ lut: clip })!;
    expect(spec.lut!.curve).not.toBeNull();
    const x = 0.33;
    const [r, g, b] = gradeHdrPixel(x, x, x, spec);
    const exact = parseCubeLut(CURVE_CUBE);
    const e = sampleCubeLut(exact, [x, x, x]);
    expect(r).toBeCloseTo(e[0], 3);
    expect(g).toBeCloseTo(e[1], 3);
    expect(b).toBeCloseTo(e[2], 3);
  });

  it("a 3D LUT through the HDR path matches the float CPU sampler", () => {
    const lut = parseCubeToLutData(cube3d(7));
    const spec = prepareHdrGrade({ lut: toClip(lut) })!;
    const [x, y, z] = [0.21, 0.64, 0.47];
    const [r, g, b] = gradeHdrPixel(x, y, z, spec);
    const e = sampleLut3dRgb(lut.floatData!, lut.size, x, y, z);
    expect(r).toBeCloseTo(e[0], 3);
    expect(g).toBeCloseTo(e[1], 3);
    expect(b).toBeCloseTo(e[2], 3);
  });
});

describe("VideoEngine-independent path agreement", () => {
  it("engine CPU float path equals the shared float sampler for 3D and 1D LUTs", () => {
    const engine = new ColorGradingEngine(8, 8) as unknown as {
      applyLutToData(data: Uint8ClampedArray, lut: LUTData): void;
    };
    const lut3 = parseCubeToLutData(cube3d(7));
    const px = new Uint8ClampedArray([54, 163, 120, 255]);
    engine.applyLutToData(px, lut3);
    const e = sampleLut3dRgb(lut3.floatData!, lut3.size, 54 / 255, 163 / 255, 120 / 255);
    for (let c = 0; c < 3; c++) expect(Math.abs(px[c] - Math.round(e[c] * 255))).toBeLessThanOrEqual(1);

    const lut1 = parseCubeToLutData(CURVE_CUBE);
    const q = new Uint8ClampedArray([54, 163, 120, 255]);
    engine.applyLutToData(q, lut1);
    const vals = [54, 163, 120];
    for (let c = 0; c < 3; c++) {
      const expected = Math.round(sampleCurve1dChannel(lut1.curve1d!, c, vals[c] / 255) * 255);
      expect(q[c]).toBe(expected);
    }
  });
});
