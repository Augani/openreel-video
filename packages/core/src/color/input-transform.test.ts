import { describe, expect, it } from "vitest";
import { encodeOutputTransfer, linearToSrgb, srgbToLinear, rgbaToYuv444, resolveOutputColorSpec } from "../export/color-output";
import {
  BT2020_TO_BT709,
  TONE_MAP_KNEE,
  applyInputTransformToRgba,
  createInputTransform,
  decodeSourceTransfer,
  hlgInverseOetf,
  inputTransformFor,
  toneMapLuminance,
  transformPixel,
} from "./input-transform";
import { DEFAULT_SOURCE_COLOR, type SourceColorSpace } from "./source-color";

const PQ: SourceColorSpace = { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false };
const HLG: SourceColorSpace = { primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl", fullRange: false };
const SDR2020: SourceColorSpace = { primaries: "bt2020", transfer: "bt709", matrix: "bt2020-ncl", fullRange: false };

describe("input transform", () => {
  it("has none for Rec.709 SDR, so those pixels are never touched", () => {
    expect(createInputTransform(DEFAULT_SOURCE_COLOR)).toBeNull();
    expect(inputTransformFor(null)).toBeNull();
    expect(inputTransformFor(DEFAULT_SOURCE_COLOR)).toBeNull();
  });

  it("converts BT.2020 to BT.709 with neutral colours staying neutral", () => {
    for (const row of BT2020_TO_BT709) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 5);
    const t = createInputTransform(SDR2020)!;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = transformPixel(v, v, v, t);
      expect(r).toBeCloseTo(v, 2);
      expect(g).toBeCloseTo(v, 2);
      expect(b).toBeCloseTo(v, 2);
    }
    // A saturated BT.2020 green is outside BT.709: it clips, red/blue go to zero.
    const [r, g, b] = transformPixel(0, 1, 0, t);
    expect(g).toBe(1);
    expect(r).toBe(0);
    expect(b).toBe(0);
  });

  it("PQ: reference white (203 nits) lands at the top of the SDR range, black stays black", () => {
    expect(decodeSourceTransfer(0, "pq")).toBeCloseTo(0, 5);
    // The PQ code of 203 nits is 0.5807 (BT.2408): decodes to linear 1.0 = SDR white.
    const whiteCode = 0.5807;
    expect(decodeSourceTransfer(whiteCode, "pq")).toBeCloseTo(1, 2);
    const t = createInputTransform(PQ)!;
    const [r, g, b] = transformPixel(whiteCode, whiteCode, whiteCode, t);
    // Tone-mapped white: knee 0.85 shoulder, Y=1 -> 0.945 linear -> sRGB about 0.978.
    expect(r).toBeCloseTo(linearToSrgb(toneMapLuminance(1)), 2);
    expect(r).toBeGreaterThan(0.95);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeCloseTo(r, 3);
    expect(b).toBeCloseTo(r, 3);
    expect(transformPixel(0, 0, 0, t)).toEqual([0, 0, 0]);
  });

  it("HLG: signal 0.75 is SDR white, and decoding inverts the export encoder", () => {
    expect(decodeSourceTransfer(0.75, "hlg")).toBeCloseTo(1, 2);
    expect(hlgInverseOetf(0)).toBe(0);
    // Round trip with the export-side HLG encode (SDR white -> 0.75).
    for (const linear of [0.01, 0.1, 0.5, 1, 2]) {
      const signal = encodeOutputTransfer(linear, "hlg");
      expect(decodeSourceTransfer(signal, "hlg")).toBeCloseTo(linear, 3);
    }
  });

  it("the tone map is identity below the knee, monotonic, C1 at the knee and never exceeds 1", () => {
    for (const y of [0, 0.2, TONE_MAP_KNEE]) expect(toneMapLuminance(y)).toBe(y);
    let previous = -1;
    for (let y = 0; y <= 20; y += 0.05) {
      const out = toneMapLuminance(y);
      expect(out).toBeGreaterThanOrEqual(previous);
      expect(out).toBeLessThanOrEqual(1);
      previous = out;
    }
    const slope = (toneMapLuminance(TONE_MAP_KNEE + 1e-4) - TONE_MAP_KNEE) / 1e-4;
    expect(slope).toBeCloseTo(1, 2);
    expect(toneMapLuminance(10)).toBeGreaterThan(0.99);
  });

  it("HDR highlights are compressed, not clipped to a flat white", () => {
    const t = createInputTransform(PQ)!;
    const out = (code: number) => transformPixel(code, code, code, t)[0];
    // 203 nits (code .58), 400 nits (~.65), 1000 nits (~.75), 4000 nits (~.90): distinct and increasing.
    const values = [0.58, 0.65, 0.75, 0.9].map(out);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values[values.length - 1]).toBeLessThanOrEqual(1);
  });

  it("applies identically through the bulk path and the per-pixel reference, alpha untouched", () => {
    const t = createInputTransform(HLG)!;
    const rgba = new Uint8ClampedArray([10, 120, 250, 77, 200, 90, 30, 255, 0, 0, 0, 0, 255, 255, 255, 128]);
    const expected = Array.from(rgba);
    applyInputTransformToRgba(rgba, t);
    for (let o = 0; o < 16; o += 4) {
      const [r, g, b] = transformPixel(expected[o] / 255, expected[o + 1] / 255, expected[o + 2] / 255, t);
      expect(Math.abs(rgba[o] - Math.round(r * 255))).toBeLessThanOrEqual(1);
      expect(Math.abs(rgba[o + 1] - Math.round(g * 255))).toBeLessThanOrEqual(1);
      expect(Math.abs(rgba[o + 2] - Math.round(b * 255))).toBeLessThanOrEqual(1);
      expect(rgba[o + 3]).toBe(expected[o + 3]);
    }
  });

  it("linear-light footage is sRGB-encoded for the working image", () => {
    const t = createInputTransform({ primaries: "bt709", transfer: "linear", matrix: "rgb", fullRange: true })!;
    // 8-bit code 128 read as linear 128/255 -> sRGB about 0.735.
    expect(transformPixel(128 / 255, 128 / 255, 128 / 255, t)[0]).toBeCloseTo(linearToSrgb(128 / 255), 2);
    expect(srgbToLinear(linearToSrgb(0.3))).toBeCloseTo(0.3, 5);
  });
});

describe("rgbaToYuv444", () => {
  it("writes full-size 10-bit planes in the output space", () => {
    const spec = resolveOutputColorSpec("rec709", "pq")!;
    const rgba = new Uint8ClampedArray(3 * 2 * 4);
    for (let i = 0; i < 6; i++) rgba.set([255, 255, 255, 255], i * 4);
    const frame = rgbaToYuv444(rgba, 3, 2, spec);
    expect(frame.format).toBe("I444P10");
    expect(frame.data.byteLength).toBe(3 * 2 * 3 * 2);
    const samples = new Uint16Array(frame.data.buffer, frame.data.byteOffset, 18);
    // SDR white in PQ is signal 0.5807 -> limited-range 10-bit luma about 64 + 876 * .58 = 572; neutral chroma 512.
    expect(samples[0]).toBeGreaterThan(560);
    expect(samples[0]).toBeLessThan(585);
    expect(samples[6]).toBe(512);
    expect(samples[12]).toBe(512);
  });
});
