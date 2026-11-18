import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BT709_TO_BT2020,
  HDR_HEVC_CODEC_STRING,
  HLG_SDR_WHITE_SCENE,
  hlgOetf,
  linearToSrgb,
  outputColorForExport,
  pqDecodeToNits,
  pqEncodeNits,
  probeHdrExportSupport,
  resetHdrExportProbe,
  resolveOutputColorSpec,
  resolveWorkingColorSpace,
  rgbToYcbcr2020,
  rgbaToYuv420,
  srgbToLinear,
  toVideoColorSpace,
} from "./color-output";
import { setEncoderBackendFactory } from "./encoder-backend";

const rgbaFrame = (width: number, height: number, [r, g, b]: [number, number, number]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
};

const plane = (frame: ReturnType<typeof rgbaToYuv420>) => {
  const wide = frame.format === "I420P10";
  const view = wide
    ? new Uint16Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength / 2)
    : frame.data;
  const luma = frame.width * frame.height;
  const chroma = luma / 4;
  return { y: view[0], u: view[luma], v: view[luma + chroma], length: view.length };
};

describe("resolveOutputColorSpec", () => {
  it("keeps the classic SDR path untouched (null) for Rec.709 without HDR", () => {
    expect(resolveOutputColorSpec("rec709", undefined)).toBeNull();
    expect(resolveOutputColorSpec(undefined, "none")).toBeNull();
    expect(resolveWorkingColorSpace(undefined)).toBe("rec709");
    expect(resolveWorkingColorSpace({ workingColorSpace: "rec2020" })).toBe("rec2020");
  });

  it("tags Rec.2020 SDR as BT.2020 primaries with the BT.709 transfer at 8 bit", () => {
    const spec = resolveOutputColorSpec("rec2020", "none")!;
    expect(toVideoColorSpace(spec)).toEqual({ primaries: "bt2020", transfer: "bt709", matrix: "bt2020-ncl", fullRange: false });
    expect(spec.bitDepth).toBe(8);
  });

  it("tags PQ and HLG as BT.2020 at 10 bit whatever the working space", () => {
    for (const working of ["rec709", "rec2020"] as const) {
      expect(resolveOutputColorSpec(working, "pq")).toMatchObject({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", bitDepth: 10 });
      expect(resolveOutputColorSpec(working, "hlg")).toMatchObject({ transfer: "hlg", bitDepth: 10 });
    }
    expect(outputColorForExport({ settings: { workingColorSpace: "rec2020" } }, undefined)?.primaries).toBe("bt2020");
    expect(HDR_HEVC_CODEC_STRING.startsWith("hvc1.2.")).toBe(true);
  });
});

describe("transfer functions", () => {
  it("round-trips sRGB", () => {
    for (const v of [0, 0.02, 0.18, 0.5, 0.9, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });

  it("PQ: 203 nits encodes to about 0.58 and decodes back", () => {
    expect(pqEncodeNits(203)).toBeCloseTo(0.5807, 3);
    expect(pqEncodeNits(10000)).toBeCloseTo(1, 6);
    expect(pqEncodeNits(0)).toBeCloseTo(0, 5);
    expect(pqDecodeToNits(pqEncodeNits(203))).toBeCloseTo(203, 3);
  });

  it("HLG: SDR white lands at signal 0.75 and the curve is continuous at 1/12", () => {
    expect(hlgOetf(HLG_SDR_WHITE_SCENE)).toBeCloseTo(0.75, 3);
    expect(hlgOetf(1)).toBeCloseTo(1, 4);
    expect(hlgOetf(1 / 12 - 1e-9)).toBeCloseTo(hlgOetf(1 / 12 + 1e-9), 5);
  });
});

describe("colour conversion", () => {
  it("BT.709 to BT.2020 rows each sum to one so neutrals stay neutral", () => {
    for (const row of BT709_TO_BT2020) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 5);
  });

  it("maps limited-range black and white to the nominal codes", () => {
    expect(rgbToYcbcr2020(0, 0, 0, 8)).toEqual({ y: 16, cb: 128, cr: 128 });
    const white = rgbToYcbcr2020(1, 1, 1, 10);
    expect(white.y).toBeCloseTo(940, 5);
    expect(white.cb).toBeCloseTo(512, 5);
    expect(white.cr).toBeCloseTo(512, 5);
  });
});

describe("rgbaToYuv420", () => {
  it("writes 10-bit PQ planes (I420P10) with SDR white near code 572 and neutral chroma", () => {
    const spec = resolveOutputColorSpec("rec709", "pq")!;
    const frame = rgbaToYuv420(rgbaFrame(4, 4, [255, 255, 255]), 4, 4, spec);
    const p = plane(frame);
    expect(frame.format).toBe("I420P10");
    expect(frame.data.byteLength).toBe((16 + 4 + 4) * 2);
    expect(p.length).toBe(24);
    expect(p.y).toBeGreaterThan(565);
    expect(p.y).toBeLessThan(580);
    expect(p.u).toBe(512);
    expect(p.v).toBe(512);
  });

  it("puts black at the nominal black code in HLG", () => {
    const spec = resolveOutputColorSpec("rec709", "hlg")!;
    const p = plane(rgbaToYuv420(rgbaFrame(2, 2, [0, 0, 0]), 2, 2, spec));
    expect(p.y).toBe(64);
    expect(p.u).toBe(512);
  });

  it("Rec.2020 SDR keeps neutral grey at the same luma code a plain BT.2020 conversion gives", () => {
    const spec = resolveOutputColorSpec("rec2020", "none")!;
    const frame = rgbaToYuv420(rgbaFrame(2, 2, [128, 128, 128]), 2, 2, spec);
    expect(frame.format).toBe("I420");
    const expected = Math.round(16 + 219 * (128 / 255));
    expect(Math.abs(plane(frame).y - expected)).toBeLessThanOrEqual(1);
    expect(plane(frame).u).toBe(128);
  });

  it("a saturated sRGB red is less saturated in BT.2020 than the same code values untouched", () => {
    const spec = resolveOutputColorSpec("rec2020", "none")!;
    const p = plane(rgbaToYuv420(rgbaFrame(2, 2, [255, 0, 0]), 2, 2, spec));
    const untouched = rgbToYcbcr2020(1, 0, 0, 8);
    expect(p.v).toBeLessThan(untouched.cr);
    expect(p.v).toBeGreaterThan(128);
  });

  it("rejects odd dimensions", () => {
    const spec = resolveOutputColorSpec("rec2020", "none")!;
    expect(() => rgbaToYuv420(rgbaFrame(3, 2, [0, 0, 0]), 3, 2, spec)).toThrow(/even/);
  });
});

describe("probeHdrExportSupport", () => {
  afterEach(() => {
    resetHdrExportProbe();
    setEncoderBackendFactory(null);
    vi.unstubAllGlobals();
  });

  it("is honest about the desktop ffmpeg encoder", async () => {
    const result = await probeHdrExportSupport({ native: true });
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/desktop/i);
  });

  it("supports the desktop when the sidecar reports a 10-bit HEVC encoder", async () => {
    expect((await probeHdrExportSupport({ native: true, encoders: ["libx264", "libx265"] })).supported).toBe(true);
    expect((await probeHdrExportSupport({ native: true, encoders: ["hevc_videotoolbox"] })).supported).toBe(true);
    const none = await probeHdrExportSupport({ native: true, encoders: ["libx264", "prores_ks"] });
    expect(none.supported).toBe(false);
    expect(none.reason).toMatch(/10-bit HEVC/);
  });

  it("reports a missing WebCodecs encoder", async () => {
    vi.stubGlobal("VideoEncoder", undefined);
    const result = await probeHdrExportSupport();
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/WebCodecs/);
  });

  it("asks the browser for 10-bit HEVC and reports its answer", async () => {
    const isConfigSupported = vi.fn().mockResolvedValue({ supported: false });
    vi.stubGlobal("VideoEncoder", { isConfigSupported });
    const no = await probeHdrExportSupport();
    expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ codec: HDR_HEVC_CODEC_STRING }));
    expect(no.supported).toBe(false);
    expect(no.reason).toMatch(/10-bit HEVC/);
    resetHdrExportProbe();
    isConfigSupported.mockResolvedValue({ supported: true });
    expect((await probeHdrExportSupport()).supported).toBe(true);
  });
});
