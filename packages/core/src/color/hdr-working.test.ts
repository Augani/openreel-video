import { describe, expect, it } from "vitest";
import {
  CpuHdrCompositor,
  HDR_LINEAR_PEAK,
  computeLayerGeometry,
  decodeSourceToLinear,
  decodeToWorkingLinear,
  fastTransferEncoder,
  gradeHdrPixel,
  hdrFrameToSdrRgba,
  hdrFrameToYuv,
  hdrSourceDecode,
  isHdrWorkingMode,
  prepareHdrGrade,
  hdrGradeSupported,
  HDR_TRANSFER_PQ,
  type HdrLayerDraw,
} from "./hdr-working";
import { encodeOutputTransfer, pqEncodeNits, resolveOutputColorSpec } from "../export/color-output";
import type { SourceColorSpace } from "./source-color";

const PQ_2020: SourceColorSpace = { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false };
const IDENT_T = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" as const };

/** A w x h frame of one PQ code (16-bit) on all channels. */
function pqCodes16(w: number, h: number, nits: number) {
  const data = new Uint16Array(w * h * 4);
  const code = Math.round(pqEncodeNits(nits) * 65535);
  for (let p = 0; p < w * h; p++) data.set([code, code, code, 65535], p * 4);
  return { depth: 16 as const, width: w, height: h, data };
}

function draw(w: number, h: number, extra: Partial<HdrLayerDraw> = {}): HdrLayerDraw {
  return { geometry: computeLayerGeometry(IDENT_T, w, h, w, h), opacity: 1, grade: null, ...extra };
}

describe("HDR working mode", () => {
  it("is only active for Rec.2020 working space or an HDR output", () => {
    expect(isHdrWorkingMode({ workingColorSpace: "rec709" }, undefined)).toBe(false);
    expect(isHdrWorkingMode({}, "none")).toBe(false);
    expect(isHdrWorkingMode({ workingColorSpace: "rec2020" }, undefined)).toBe(true);
    expect(isHdrWorkingMode({ workingColorSpace: "rec709" }, "pq")).toBe(true);
    expect(isHdrWorkingMode({}, "hlg")).toBe(true);
  });

  it("decodes a 1000-nit PQ source above SDR white without tone mapping", () => {
    const lin = decodeToWorkingLinear(pqEncodeNits(1000), HDR_TRANSFER_PQ);
    expect(lin).toBeCloseTo(1000 / 203, 3);
    const layer = decodeSourceToLinear(pqCodes16(2, 2, 1000), hdrSourceDecode(PQ_2020));
    expect(layer.data[0]).toBeGreaterThan(4.9);
    expect(layer.data[3]).toBe(1);
  });

  it("keeps highlights above SDR white through composite and PQ encode (10-bit codes)", () => {
    const w = 4;
    const h = 4;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 1000), hdrSourceDecode(PQ_2020), draw(w, h));
    const spec = resolveOutputColorSpec("rec2020", "pq")!;
    const yuv = hdrFrameToYuv(comp.readFrame(), spec, "420");
    const samples = new Uint16Array(yuv.data.buffer, yuv.data.byteOffset, w * h);
    const expectedY = Math.round(16 * 4 + 219 * 4 * pqEncodeNits(1000));
    const sdrWhiteY = Math.round(16 * 4 + 219 * 4 * pqEncodeNits(203));
    expect(Math.abs(samples[0] - expectedY)).toBeLessThanOrEqual(2);
    expect(samples[0]).toBeGreaterThan(sdrWhiteY + 100);
  });

  it("reads SDR sources as sRGB at graphics white", () => {
    const w = 2;
    const h = 2;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes({ depth: 8, width: w, height: h, data }, hdrSourceDecode(null), draw(w, h));
    const frame = comp.readFrame();
    expect(frame.data[0]).toBeCloseTo(1, 4);
    expect(frame.data[1]).toBeCloseTo(1, 4);
    expect(frame.data[2]).toBeCloseTo(1, 4);
  });

  it("places 8-bit overlays at graphics white (203 nits) over the float image", () => {
    const w = 2;
    const h = 2;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 1000), hdrSourceDecode(PQ_2020), draw(w, h));
    const overlay = new Uint8ClampedArray(w * h * 4);
    overlay.set([255, 255, 255, 255], 0);
    comp.drawOverlay({ width: w, height: h, data: overlay });
    const f = comp.readFrame();
    expect(f.data[0]).toBeCloseTo(1, 4);
    expect(f.data[4]).toBeGreaterThan(4.9);
  });

  it("applies opacity with an over operator in linear light", () => {
    const w = 2;
    const h = 2;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 1000), hdrSourceDecode(PQ_2020), draw(w, h, { opacity: 0.5 }));
    expect(comp.readFrame().data[0]).toBeCloseTo((1000 / 203) * 0.5, 2);
  });

  it("maps geometry like the canvas path (translate, scale, rotate)", () => {
    const g = computeLayerGeometry({ ...IDENT_T, position: { x: 10, y: 0 } }, 100, 50, 100, 50);
    // destination (60, 25) is the centre of the layer shifted by 10 -> the source centre.
    expect(g.m[0] * 60 + g.m[1] * 25 + g.m[2]).toBeCloseTo(50, 6);
    expect(g.m[3] * 60 + g.m[4] * 25 + g.m[5]).toBeCloseTo(25, 6);
    const half = computeLayerGeometry({ ...IDENT_T, scale: { x: 0.5, y: 0.5 } }, 100, 50, 100, 50);
    expect(half.m[0] * 75 + half.m[2]).toBeCloseTo(100, 6);
    const rot = computeLayerGeometry({ ...IDENT_T, rotation: 90 }, 50, 50, 50, 50);
    // a quarter turn about the centre sends the layer's top-right corner (source 50,0) to the bottom-right (50,50).
    const sx = rot.m[0] * 50 + rot.m[1] * 50 + rot.m[2];
    const sy = rot.m[3] * 50 + rot.m[4] * 50 + rot.m[5];
    expect(sx).toBeCloseTo(50, 6);
    expect(sy).toBeCloseTo(0, 6);
  });

  it("covers only the layer rectangle and leaves the rest transparent", () => {
    const w = 8;
    const h = 8;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const small = pqCodes16(2, 2, 400);
    comp.drawCodes(small, hdrSourceDecode(PQ_2020), {
      geometry: computeLayerGeometry({ ...IDENT_T, fitMode: "none" }, 2, 2, w, h),
      opacity: 1,
      grade: null,
    });
    const f = comp.readFrame();
    const at = (x: number, y: number) => f.data[(y * w + x) * 4 + 3];
    expect(at(0, 0)).toBeGreaterThan(0.99);
    const comp2 = new CpuHdrCompositor();
    comp2.begin(w, h);
    comp2.drawCodes(small, hdrSourceDecode(PQ_2020), {
      geometry: computeLayerGeometry({ ...IDENT_T, fitMode: "none", scale: { x: 0.25, y: 0.25 } }, 2, 2, w, h),
      opacity: 1,
      grade: null,
    });
    const f2 = comp2.readFrame();
    expect(f2.data[3]).toBe(0);
    expect(f2.data[((h / 2) * w + w / 2) * 4 + 3]).toBeGreaterThan(0.99);
  });

  it("grades in PQ and keeps highlights above SDR white", () => {
    expect(prepareHdrGrade(undefined)).toBeNull();
    expect(prepareHdrGrade({ tone: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } })).toBeNull();
    const spec = prepareHdrGrade({ tone: { exposure: 0.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } })!;
    expect(spec.exposureGain).toBeCloseTo(2, 6);
    const [r, g, b] = gradeHdrPixel(0.18, 0.18, 0.18, spec);
    expect(r).toBeCloseTo(0.36, 2);
    expect(g).toBeCloseTo(r, 5);
    expect(b).toBeCloseTo(r, 5);
    const [hr] = gradeHdrPixel(5, 5, 5, spec);
    expect(hr).toBeGreaterThan(9.5);
    expect(hr).toBeLessThanOrEqual(HDR_LINEAR_PEAK + 1e-3);
  });

  it("white balance acts without clipping highlights to SDR white", () => {
    const spec = prepareHdrGrade({ temperature: 30 })!;
    const [r, , b] = gradeHdrPixel(3, 3, 3, spec);
    expect(r).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(1.5);
  });

  it("accepts every Lumetri stage; only a malformed LUT keeps the 8-bit path", () => {
    expect(hdrGradeSupported(undefined)).toBe(true);
    expect(hdrGradeSupported({ lut: { data: new Array(27 * 3).fill(0), size: 3, intensity: 1 } })).toBe(true);
    expect(hdrGradeSupported({ lut: { data: [1, 2, 3], size: 3, intensity: 1 } })).toBe(false);
  });

  it("tone maps the SDR monitor view with a shoulder (1000 nits stays under clip)", () => {
    const w = 2;
    const h = 2;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 1000), hdrSourceDecode(PQ_2020), draw(w, h));
    const view = hdrFrameToSdrRgba(comp.readFrame());
    expect(view[0]).toBeGreaterThan(250);
    expect(view[3]).toBe(255);
    const comp2 = new CpuHdrCompositor();
    comp2.begin(w, h);
    comp2.drawCodes(pqCodes16(w, h, 203), hdrSourceDecode(PQ_2020), draw(w, h));
    const v2 = hdrFrameToSdrRgba(comp2.readFrame());
    expect(v2[0]).toBeGreaterThan(240);
    expect(v2[0]).toBeLessThanOrEqual(view[0]);
  });

  it("fast transfer encoder matches the exact curves within one 10-bit code", () => {
    for (const transfer of ["pq", "hlg", "bt709"] as const) {
      const fast = fastTransferEncoder(transfer);
      const max = transfer === "pq" ? HDR_LINEAR_PEAK : transfer === "hlg" ? 3.78 : 1;
      for (let i = 0; i <= 400; i++) {
        const l = (i / 400) * max * (i / 400);
        expect(Math.abs(fast(l) - encodeOutputTransfer(l, transfer))).toBeLessThan(1 / 1023);
      }
    }
  });

  it("emits 4:4:4 10-bit, 4:2:0 10-bit and 8-bit planes", () => {
    const w = 4;
    const h = 4;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 600), hdrSourceDecode(PQ_2020), draw(w, h));
    const f = comp.readFrame();
    const spec = resolveOutputColorSpec("rec2020", "pq")!;
    expect(hdrFrameToYuv(f, spec, "444").data.byteLength).toBe(w * h * 3 * 2);
    expect(hdrFrameToYuv(f, spec, "420").data.byteLength).toBe((w * h + 2 * (w / 2) * (h / 2)) * 2);
    const sdr = resolveOutputColorSpec("rec2020", undefined)!;
    expect(hdrFrameToYuv(f, sdr, "420").data.byteLength).toBe(w * h + 2 * (w / 2) * (h / 2));
  });
});
