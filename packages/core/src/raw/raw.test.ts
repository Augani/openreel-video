import { describe, expect, it } from "vitest";
import {
  asShotKelvinTint,
  bradfordAdapt,
  cameraNeutralForXY,
  D50_XYZ,
  D65_XYZ,
  decodeDng,
  decodeLosslessJpeg,
  defaultRawSettings,
  developedSize,
  developRaw,
  developRawLinear,
  encodeLosslessJpeg,
  groupCinemaDng,
  invMat3,
  isRawFileName,
  kelvinTintToXY,
  mulMat3,
  mulMat3Vec,
  normalizeRawSettings,
  orientPixel,
  outputSpaceMatrices,
  rawFormatForFile,
  rawImportBlocker,
  rawSettingsKey,
  RawDecodeError,
  writeDng,
  xyToKelvinTint,
  type CfaColor,
  type DngWriteOptions,
} from "./index";

const CM_D65 = [0.6722, -0.0635, -0.0963, -0.4287, 1.246, 0.2028, -0.0908, 0.2162, 0.5668];
const CM_A = [0.7, -0.05, -0.1, -0.4, 1.2, 0.18, -0.08, 0.2, 0.55];
const SRGB_TO_XYZ_D65 = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const SCALE = 0.6;
const BLACK = 512;
const WHITE = 16383;

const PATCHES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 1],
  [0.18, 0.18, 0.18],
  [0.5, 0.1, 0.05],
  [0.1, 0.5, 0.1],
  [0.05, 0.1, 0.5],
  [0.45, 0.3, 0.22],
  [0.02, 0.02, 0.02],
  [0.6, 0.6, 0.1],
];
const PATCH = 16;
const COLS = 4;

const cfaColorAt = (cfa: readonly CfaColor[], x: number, y: number): CfaColor => cfa[(y & 1) * 2 + (x & 1)];

function cameraValue(rgb: readonly number[], cm: readonly number[]): number[] {
  const xyz = mulMat3Vec(SRGB_TO_XYZ_D65, rgb);
  return [...mulMat3Vec(cm, xyz)].map((v) => v * SCALE);
}

/** A patch chart mosaic: each patch is flat linear-sRGB light seen through the camera matrix `cm`. */
function chartMosaic(cfa: readonly CfaColor[], cm: readonly number[]): { width: number; height: number; samples: Uint16Array } {
  const width = COLS * PATCH;
  const height = Math.ceil(PATCHES.length / COLS) * PATCH;
  const samples = new Uint16Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const patch = PATCHES[Math.floor(y / PATCH) * COLS + Math.floor(x / PATCH)] ?? [0, 0, 0];
      const cam = cameraValue(patch, cm);
      const v = Math.min(1, Math.max(0, cam[cfaColorAt(cfa, x, y)]));
      samples[y * width + x] = Math.round(BLACK + v * (WHITE - BLACK));
    }
  return { width, height, samples };
}

function neutralOf(cm: readonly number[]): number[] {
  const n = [...mulMat3Vec(cm, D65_XYZ)];
  return n.map((v) => v / Math.max(...n));
}

function patchCenter(frameWidth: number, index: number): { x: number; y: number } {
  void frameWidth;
  return { x: (index % COLS) * PATCH + PATCH / 2, y: Math.floor(index / COLS) * PATCH + PATCH / 2 };
}

function chartOptions(overrides: Partial<DngWriteOptions> = {}): DngWriteOptions {
  const cfa: [CfaColor, CfaColor, CfaColor, CfaColor] = [0, 1, 1, 2];
  const m = chartMosaic(cfa, CM_D65);
  return {
    ...m,
    cfa,
    bitsPerSample: 14,
    blackLevel: BLACK,
    whiteLevel: WHITE,
    colorMatrix1: CM_D65,
    illuminant1: 21,
    asShotNeutral: neutralOf(CM_D65),
    make: "OpenReel",
    model: "Test Chart",
    ...overrides,
  };
}

describe("lossless JPEG", () => {
  it("round-trips samples exactly (1, 2 and 3 components, 12 to 16 bit)", () => {
    for (const [comps, precision] of [[1, 16], [2, 14], [3, 12], [2, 16]] as const) {
      const w = 13;
      const h = 9;
      const data = new Uint16Array(w * comps * h);
      let seed = 7;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = seed % (1 << precision);
      }
      const decoded = decodeLosslessJpeg(encodeLosslessJpeg(data, w, h, comps, precision));
      expect(decoded.components).toBe(comps);
      expect(decoded.width).toBe(w);
      expect(Array.from(decoded.data)).toEqual(Array.from(data));
    }
  });

  it("rejects garbage and truncated streams with a clear error", () => {
    expect(() => decodeLosslessJpeg(new Uint8Array([1, 2, 3, 4]))).toThrow(RawDecodeError);
    const good = encodeLosslessJpeg(new Uint16Array(64).fill(1000), 8, 8, 1, 16);
    expect(() => decodeLosslessJpeg(good.subarray(0, 20))).toThrow(RawDecodeError);
  });
});

describe("DNG decode", () => {
  const samples = (w: number, h: number, bits: number): Uint16Array => {
    const d = new Uint16Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = (i * 2654435761) % (1 << bits);
    return d;
  };

  it("decodes every storage layout to the exact samples that were written", () => {
    const w = 34;
    const h = 22;
    const layouts: Array<[string, Partial<DngWriteOptions>, number]> = [
      ["16-bit strips", { rowsPerStrip: 5 }, 16],
      ["14-bit packed", {}, 14],
      ["12-bit packed", { rowsPerStrip: 7 }, 12],
      ["10-bit packed", {}, 10],
      ["8-bit", {}, 8],
      ["tiled 16-bit", { tile: { width: 16, height: 16 } }, 16],
      ["lossless JPEG strips", { compression: "lossless-jpeg", rowsPerStrip: 6 }, 14],
      ["lossless JPEG tiles", { compression: "lossless-jpeg", tile: { width: 16, height: 16 } }, 12],
    ];
    for (const [name, extra, bits] of layouts) {
      const data = samples(w, h, bits);
      const dng = decodeDng(writeDng({ width: w, height: h, samples: data, bitsPerSample: bits, ...extra }));
      expect(Array.from(dng.data), name).toEqual(Array.from(data));
      expect(dng.bitsPerSample).toBe(bits);
    }
  });

  it("decodes LinearRaw (3 samples per pixel), plain and lossless JPEG", () => {
    const data = new Uint16Array(8 * 6 * 3).map((_, i) => (i * 977) % 4096);
    for (const compression of ["none", "lossless-jpeg"] as const) {
      const dng = decodeDng(writeDng({ width: 8, height: 6, samples: data, linearRaw: true, bitsPerSample: 12, compression }));
      expect(dng.samplesPerPixel).toBe(3);
      expect(Array.from(dng.data)).toEqual(Array.from(data));
    }
  });

  it("reads the colour model, CFA, levels, crop and metadata", () => {
    const dng = decodeDng(
      writeDng(
        chartOptions({
          cfa: [2, 1, 1, 0],
          colorMatrix2: CM_A,
          illuminant2: 17,
          baselineExposure: 0.5,
          orientation: 6,
          activeArea: [0, 0, 32, 64],
          cropOrigin: [2, 2],
          cropSize: [60, 28],
          blackLevel: [500, 510, 520, 530],
        }),
      ),
    );
    expect(dng.cfa).toEqual([2, 1, 1, 0]);
    expect(dng.blackLevel).toEqual([500, 510, 520, 530]);
    expect(dng.whiteLevel).toBe(WHITE);
    expect(dng.crop).toEqual([2, 2, 60, 28]);
    expect(dng.orientation).toBe(6);
    expect(dng.baselineExposure).toBeCloseTo(0.5, 5);
    expect(dng.illuminant1).toBe(21);
    expect(dng.illuminant2).toBe(17);
    expect(dng.colorMatrix1?.[0]).toBeCloseTo(CM_D65[0], 5);
    expect(dng.make).toBe("OpenReel");
    expect(dng.model).toBe("Test Chart");
  });

  it("reports unsupported and corrupt files by name instead of producing garbage", () => {
    expect(() => decodeDng(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]))).toThrow(RawDecodeError);
    expect(() => decodeDng(new Uint8Array(100))).toThrow(/Not a TIFF/);
    const file = writeDng({ width: 8, height: 8, samples: new Uint16Array(64) });
    expect(() => decodeDng(file.subarray(0, file.length - 40))).toThrow(RawDecodeError);
    const xtrans = writeDng({ width: 8, height: 8, samples: new Uint16Array(64) });
    // Corrupt the CFA repeat dimension tag value (2,2) into (6,6).
    const view = new DataView(xtrans.buffer);
    const count = view.getUint16(8, true);
    for (let i = 0; i < count; i++) {
      const at = 10 + i * 12;
      if (view.getUint16(at, true) === 33421) {
        view.setUint16(at + 8, 6, true);
        view.setUint16(at + 10, 6, true);
      }
    }
    expect(() => decodeDng(xtrans)).toThrow(/X-Trans/);
  });
});

describe("colour pipeline (numeric)", () => {
  const model = { colorMatrix1: CM_D65, colorMatrix2: null, forwardMatrix1: null, forwardMatrix2: null, cameraCalibration1: null, cameraCalibration2: null, analogBalance: null, illuminant1: 21, illuminant2: 0, asShotNeutral: neutralOf(CM_D65), asShotWhiteXY: null } as const;

  it("recovers the as-shot white balance as a temperature near D65 and a tiny tint", () => {
    const { kelvin, tint } = asShotKelvinTint(model);
    expect(kelvin).toBeGreaterThan(6300);
    expect(kelvin).toBeLessThan(6700);
    expect(Math.abs(tint)).toBeLessThan(15);
  });

  it("round-trips temperature/tint through xy", () => {
    for (const k of [2500, 3200, 5000, 6500, 9000, 15000])
      for (const tint of [-60, 0, 40]) {
        const [x, y] = kelvinTintToXY(k, tint);
        const back = xyToKelvinTint(x, y);
        expect(back.kelvin / k).toBeGreaterThan(0.995);
        expect(back.kelvin / k).toBeLessThan(1.005);
        expect(back.tint).toBeCloseTo(tint, 0);
      }
  });

  it("neutral surface maps to equal output channels at the as-shot white balance, colours to the known linear values", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const settings = defaultRawSettings(dng);
    const frame = developRawLinear(dng, settings, { maxLongEdge: 100000 });
    const px = (i: number) => {
      const { x, y } = patchCenter(frame.width, i);
      const o = (y * frame.width + x) * 3;
      return [frame.rgb[o], frame.rgb[o + 1], frame.rgb[o + 2]];
    };
    const white = px(0);
    expect(white[0]).toBeCloseTo(white[1], 2);
    expect(white[2]).toBeCloseTo(white[1], 2);
    const mid = px(1);
    expect(mid[0]).toBeCloseTo(mid[1], 2);
    expect(mid[2]).toBeCloseTo(mid[1], 2);
    expect(mid[1] / white[1]).toBeCloseTo(0.18, 2);
    // Chromatic accuracy relative to white (the DNG camera-space adaptation is within a few percent of true sRGB).
    for (let i = 2; i < PATCHES.length; i++) {
      const out = px(i);
      for (let c = 0; c < 3; c++) expect(Math.abs(out[c] / white[c] - PATCHES[i][c])).toBeLessThan(0.05);
    }
  });

  it("with a ForwardMatrix the colours match exactly and absolute exposure is preserved", () => {
    const n = neutralOf(CM_D65);
    const fm = mulMat3(mulMat3(bradfordAdapt(D65_XYZ, D50_XYZ), invMat3(CM_D65)), [n[0], 0, 0, 0, n[1], 0, 0, 0, n[2]]);
    const dng = decodeDng(writeDng(chartOptions({ forwardMatrix1: fm })));
    const settings = defaultRawSettings(dng);
    const frame = developRawLinear(dng, settings, { maxLongEdge: 100000 });
    for (let i = 0; i < PATCHES.length; i++) {
      const { x, y } = patchCenter(frame.width, i);
      const o = (y * frame.width + x) * 3;
      for (let c = 0; c < 3; c++) expect(Math.abs(frame.rgb[o + c] - PATCHES[i][c] * SCALE)).toBeLessThan(0.02);
    }
  });

  it("all four Bayer layouts develop the same picture", () => {
    const reference = developRawLinear(decodeDng(writeDng(chartOptions())), defaultRawSettings(decodeDng(writeDng(chartOptions()))), { maxLongEdge: 100000 });
    for (const cfa of [[1, 0, 2, 1], [1, 2, 0, 1], [2, 1, 1, 0]] as const) {
      const m = chartMosaic(cfa, CM_D65);
      const dng = decodeDng(writeDng(chartOptions({ ...m, cfa })));
      const frame = developRawLinear(dng, defaultRawSettings(dng), { maxLongEdge: 100000 });
      const { x, y } = patchCenter(frame.width, 4);
      const o = (y * frame.width + x) * 3;
      for (let c = 0; c < 3; c++) expect(frame.rgb[o + c]).toBeCloseTo(reference.rgb[o + c], 2);
    }
  });

  it("raising the temperature setting warms the picture (more red, less blue) and exposure is exact in stops", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const base = defaultRawSettings(dng);
    const at = (s: Partial<typeof base>, i = 1) => {
      const f = developRawLinear(dng, { ...base, ...s }, { maxLongEdge: 100000 });
      const { x, y } = patchCenter(f.width, i);
      const o = (y * f.width + x) * 3;
      return [f.rgb[o], f.rgb[o + 1], f.rgb[o + 2]];
    };
    const cool = at({ temperature: 4500 });
    const warm = at({ temperature: 9000 });
    expect(warm[0] / warm[2]).toBeGreaterThan(cool[0] / cool[2]);
    const tintMagenta = at({ tint: 60 });
    const tintGreen = at({ tint: -60 });
    expect(tintGreen[1] / tintGreen[0]).toBeGreaterThan(tintMagenta[1] / tintMagenta[0]);
    const flat = at({});
    const plus1 = at({ exposure: 1 });
    for (let c = 0; c < 3; c++) expect(plus1[c] / flat[c]).toBeCloseTo(2, 5);
  });

  it("outputs wider-gamut primaries consistently: a neutral stays neutral and saturated colours move", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const base = defaultRawSettings(dng);
    const srgb = developRawLinear(dng, base, { maxLongEdge: 100000 });
    const p3 = developRawLinear(dng, { ...base, outputColorSpace: "display-p3" }, { maxLongEdge: 100000 });
    const rec = developRawLinear(dng, { ...base, outputColorSpace: "rec2020" }, { maxLongEdge: 100000 });
    const sample = (f: typeof srgb, i: number) => {
      const { x, y } = patchCenter(f.width, i);
      const o = (y * f.width + x) * 3;
      return [f.rgb[o], f.rgb[o + 1], f.rgb[o + 2]];
    };
    for (const f of [p3, rec]) {
      const w = sample(f, 0);
      expect(w[0]).toBeCloseTo(w[1], 2);
      expect(w[2]).toBeCloseTo(w[1], 2);
    }
    // An sRGB green is less saturated in the wider P3/Rec.2020 coordinates (larger red and blue components).
    const gS = sample(srgb, 3);
    const gP = sample(p3, 3);
    const gR = sample(rec, 3);
    expect(gP[0] + gP[2]).toBeGreaterThan(gS[0] + gS[2]);
    expect(gR[0] + gR[2]).toBeGreaterThan(gP[0] + gP[2]);
    // Luma is primaries independent.
    const lum = (v: number[], space: "srgb" | "display-p3" | "rec2020") => {
      const l = outputSpaceMatrices(space).lumaRow;
      return l[0] * v[0] + l[1] * v[1] + l[2] * v[2];
    };
    expect(lum(gP, "display-p3")).toBeCloseTo(lum(gS, "srgb"), 3);
    expect(lum(gR, "rec2020")).toBeCloseTo(lum(gS, "srgb"), 3);
  });

  it("cameraNeutralForXY inverts the as-shot solve", () => {
    const n = cameraNeutralForXY(model, [D65_XYZ[0] / (D65_XYZ[0] + 1 + D65_XYZ[2]), 1 / (D65_XYZ[0] + 1 + D65_XYZ[2])]);
    const expected = neutralOf(CM_D65);
    for (let c = 0; c < 3; c++) expect(n[c]).toBeCloseTo(expected[c], 2);
  });
});

describe("demosaic", () => {
  /** Smooth colour gradients, sampled through a Bayer filter, developed and compared with the ground truth. */
  function gradientError(demosaic: "standard" | "high"): number {
    const w = 64;
    const h = 64;
    const cfa: [CfaColor, CfaColor, CfaColor, CfaColor] = [0, 1, 1, 2];
    const samples = new Uint16Array(w * h);
    const truth = (x: number, y: number) => [0.2 + 0.6 * (x / w), 0.2 + 0.5 * (y / h) + 0.1 * Math.sin(x / 5), 0.3 + 0.4 * ((x + y) / (w + h))];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) samples[y * w + x] = Math.round(truth(x, y)[cfaColorAt(cfa, x, y)] * 65535);
    // An identity camera: ColorMatrix = D50 XYZ <- sRGB so output equals the camera values.
    const identityCm = invMat3(SRGB_TO_XYZ_D65);
    const dng = decodeDng(
      writeDng({ width: w, height: h, samples, cfa, colorMatrix1: identityCm, illuminant1: 21, asShotNeutral: [1, 1, 1] }),
    );
    const s = { ...defaultRawSettings(dng), demosaic };
    const frame = developRawLinear(dng, s, { maxLongEdge: 100000 });
    let sum = 0;
    let n = 0;
    for (let y = 4; y < h - 4; y++)
      for (let x = 4; x < w - 4; x++)
        for (let c = 0; c < 3; c++) {
          sum += Math.abs(frame.rgb[(y * w + x) * 3 + c] - truth(x, y)[c]);
          n++;
        }
    return sum / n;
  }
  it("high quality is at least as accurate as bilinear on smooth content, and both are close to the truth", () => {
    const standard = gradientError("standard");
    const high = gradientError("high");
    expect(standard).toBeLessThan(0.03);
    expect(high).toBeLessThan(0.03);
    expect(high).toBeLessThanOrEqual(standard + 1e-4);
  });

  it("draft quality halves the resolution; developedSize agrees with the real output", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const base = defaultRawSettings(dng);
    expect(developedSize(dng, base)).toEqual({ width: 64, height: 32 });
    const draft = { ...base, demosaic: "draft" as const };
    expect(developedSize(dng, draft)).toEqual({ width: 32, height: 16 });
    const frame = developRaw(dng, draft);
    expect(frame.width).toBe(32);
    expect(frame.height).toBe(16);
    expect(frame.rgba.length).toBe(32 * 16 * 4);
  });

  it("box-downscales to the longest-edge cap", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const frame = developRaw(dng, defaultRawSettings(dng), { maxLongEdge: 32 });
    expect(frame.width).toBe(32);
    expect(frame.height).toBe(16);
  });
});

describe("highlights, orientation and determinism", () => {
  it("highlight recovery neutralises a clipped highlight and leaves unclipped pixels alone", () => {
    const w = 16;
    const h = 16;
    const samples = new Uint16Array(w * h);
    const cfa: [CfaColor, CfaColor, CfaColor, CfaColor] = [0, 1, 1, 2];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const clipped = x >= 8;
        // Left half: a mid tone. Right half: all channels at the sensor's white level (clipped).
        samples[y * w + x] = clipped ? WHITE : Math.round(BLACK + 0.2 * (WHITE - BLACK));
      }
    const base: DngWriteOptions = { width: w, height: h, samples, cfa, bitsPerSample: 14, blackLevel: BLACK, whiteLevel: WHITE, colorMatrix1: CM_D65, illuminant1: 21, asShotNeutral: [0.5, 1, 0.65] };
    const dng = decodeDng(writeDng(base));
    const s = defaultRawSettings(dng);
    const off = developRawLinear(dng, s, { maxLongEdge: 1000 });
    const on = developRawLinear(dng, { ...s, highlightRecovery: 1 }, { maxLongEdge: 1000 });
    const at = (f: typeof off, x: number, y: number) => [f.rgb[(y * w + x) * 3], f.rgb[(y * w + x) * 3 + 1], f.rgb[(y * w + x) * 3 + 2]];
    const clipOff = at(off, 12, 8);
    const clipOn = at(on, 12, 8);
    const spread = (v: number[]) => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    expect(spread(clipOn)).toBeLessThan(spread(clipOff));
    expect(spread(clipOn)).toBeLessThan(0.05);
    expect(at(on, 3, 8)).toEqual(at(off, 3, 8));
    // The shoulder keeps a +2 stop highlight below pure white only when recovery is on.
    const hot0 = developRaw(dng, { ...s, exposure: 2 });
    const hot1 = developRaw(dng, { ...s, exposure: 2, highlightRecovery: 1 });
    const mid = (f: typeof hot0) => f.rgba[(8 * w + 3) * 4 + 1];
    expect(mid(hot0)).toBeGreaterThanOrEqual(mid(hot1));
    expect(mid(hot1)).toBeLessThanOrEqual(255);
  });

  it("applies TIFF orientation: dimensions swap and every pixel lands where orientPixel says", () => {
    const w = 8;
    const h = 4;
    const cfa: [CfaColor, CfaColor, CfaColor, CfaColor] = [0, 1, 1, 2];
    const samples = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) samples[y * w + x] = 2000 + x * 1500 + y * 200;
    const make = (orientation: number) => decodeDng(writeDng({ width: w, height: h, samples, cfa, bitsPerSample: 16, colorMatrix1: CM_D65, illuminant1: 21, asShotNeutral: [0.5, 1, 0.7], orientation }));
    const upright = make(1);
    const s = defaultRawSettings(upright);
    const a = developRawLinear(upright, s, { maxLongEdge: 1000 });
    for (const o of [2, 3, 4, 5, 6, 7, 8]) {
      const b = developRawLinear(make(o), s, { maxLongEdge: 1000 });
      expect(b.width).toBe(o >= 5 ? h : w);
      expect(b.height).toBe(o >= 5 ? w : h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [dx, dy] = orientPixel(o, x, y, w, h);
          for (let c = 0; c < 3; c++) expect(b.rgb[(dy * b.width + dx) * 3 + c]).toBeCloseTo(a.rgb[(y * w + x) * 3 + c], 6);
        }
    }
  });

  it("is deterministic: the same file and settings always give the same bytes", () => {
    const dng = decodeDng(writeDng(chartOptions()));
    const s = { ...defaultRawSettings(dng), exposure: 0.7, highlightRecovery: 0.4, demosaic: "high" as const };
    const a = developRaw(dng, s);
    const b = developRaw(decodeDng(writeDng(chartOptions())), s);
    expect(Buffer.from(a.rgba).equals(Buffer.from(b.rgba))).toBe(true);
  });
});

describe("settings and formats", () => {
  it("clamps settings and keys them stably", () => {
    const base = normalizeRawSettings({}, { temperature: 5000, tint: 0, exposure: 0, highlightRecovery: 0, demosaic: "standard", outputColorSpace: "srgb" });
    const next = normalizeRawSettings({ temperature: 99999, tint: -999, exposure: 9, highlightRecovery: 5, demosaic: "high", outputColorSpace: "rec2020" }, base);
    expect(next).toEqual({ temperature: 25000, tint: -150, exposure: 5, highlightRecovery: 1, demosaic: "high", outputColorSpace: "rec2020" });
    expect(normalizeRawSettings({ temperature: Number.NaN, demosaic: "bogus" as never }, base)).toEqual(base);
    expect(rawSettingsKey(next)).not.toBe(rawSettingsKey(base));
    expect(rawSettingsKey(next)).toBe(rawSettingsKey({ ...next }));
  });

  it("classifies camera formats and states why the proprietary ones are limited", () => {
    expect(isRawFileName("IMG_0001.DNG")).toBe(true);
    expect(isRawFileName("clip.mp4")).toBe(false);
    expect(rawFormatForFile("a.CR3")?.support).toBe("macos-imageio");
    expect(rawFormatForFile("a.braw")?.support).toBe("unsupported");
    expect(rawFormatForFile("a.r3d")?.support).toBe("unsupported");
    expect(rawFormatForFile("a.ari")?.support).toBe("unsupported");
    const dng = rawFormatForFile("a.dng")!;
    expect(rawImportBlocker(dng, false)).toBeNull();
    const cr3 = rawFormatForFile("a.cr3")!;
    expect(rawImportBlocker(cr3, false)).toMatch(/Convert to DNG/);
    expect(rawImportBlocker(cr3, true)).toBeNull();
    expect(rawImportBlocker(rawFormatForFile("a.braw")!, true)).toMatch(/not supported/);
  });

  it("groups CinemaDNG frames numerically and leaves stills alone", () => {
    const names = ["A_000010.dng", "A_000002.dng", "A_000001.dng", "single.dng", "B_0001.dng", "notes.txt", "B_0002.dng"];
    const { sequences, stills, others } = groupCinemaDng(names.map((name) => ({ name })));
    expect(sequences.map((s) => [s.prefix, s.frames.map((f) => f.name)])).toEqual([
      ["A_", ["A_000001.dng", "A_000002.dng", "A_000010.dng"]],
      ["B_", ["B_0001.dng", "B_0002.dng"]],
    ]);
    expect(stills.map((f) => f.name)).toEqual(["single.dng"]);
    expect(others.map((f) => f.name)).toEqual(["notes.txt"]);
  });
});
