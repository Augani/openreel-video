import { describe, expect, it } from "vitest";
import { CpuHdrCompositor, hdrSourceDecode, computeLayerGeometry, attachHdrPayload, takeHdrPayload } from "../color/hdr-working";
import { createHdrCompositor, exportPayload, hdrExportTargetFor, hdrOfTarget, isHdrEligibleClip, type HdrClipFacts } from "./hdr-frame";
import { pqEncodeNits } from "../export/color-output";
import type { Transform } from "../types/timeline";

const transform: Transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" };

const facts = (over: Partial<HdrClipFacts> = {}): HdrClipFacts => ({
  clip: {},
  effects: [],
  hasMasks: false,
  grading: undefined,
  transform,
  rewritesFrame: false,
  ...over,
});

describe("HDR export target", () => {
  it("is null for Rec.709 without HDR (the classic 8-bit path)", () => {
    expect(hdrExportTargetFor({ settings: { workingColorSpace: "rec709" } } as never, { hdr: "none", codec: "h265" })).toBeNull();
    expect(hdrExportTargetFor({ settings: {} } as never, { codec: "h264" })).toBeNull();
  });

  it("chooses 10-bit 4:2:0 for HEVC PQ, 10-bit 4:4:4 for ProRes, 8-bit for SDR Rec.2020", () => {
    const project = { settings: { workingColorSpace: "rec709" } } as never;
    const pq = hdrExportTargetFor(project, { hdr: "pq", codec: "h265" })!;
    expect(pq.spec).toMatchObject({ transfer: "pq", bitDepth: 10 });
    expect(pq.chroma).toBe("420");
    expect(hdrOfTarget(pq)).toBe("pq");
    const prores = hdrExportTargetFor(project, { hdr: "hlg", codec: "prores" })!;
    expect(prores.chroma).toBe("444");
    expect(prores.spec.bitDepth).toBe(10);
    const sdr = hdrExportTargetFor({ settings: { workingColorSpace: "rec2020" } } as never, { codec: "h264" })!;
    expect(sdr.spec).toMatchObject({ transfer: "bt709", bitDepth: 8 });
    expect(hdrOfTarget(sdr)).toBeUndefined();
  });
});

describe("float path eligibility", () => {
  it("takes plain clips and clips graded with supported stages", () => {
    expect(isHdrEligibleClip(facts())).toBe(true);
    expect(isHdrEligibleClip(facts({ grading: { temperature: 10, tone: { exposure: 0.2, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } } }))).toBe(true);
  });

  it("keeps clips with a non-neutral Input LUT on the 8-bit path, which applies it", () => {
    const size = 2;
    const data = new Uint8Array(size * size * size * 3).fill(100);
    const inputLut = { name: "in", size, data, intensity: 1 } as never;
    expect(isHdrEligibleClip(facts({ grading: { inputLut } }))).toBe(false);
  });

  it("leaves clips that need the 8-bit canvas on the classic path", () => {
    expect(isHdrEligibleClip(facts({ effects: [{ enabled: true, type: "chromaKey" }] }))).toBe(false);
    expect(isHdrEligibleClip(facts({ effects: [{ enabled: false, type: "chromaKey" }] }))).toBe(true);
    expect(isHdrEligibleClip(facts({ hasMasks: true }))).toBe(false);
    expect(isHdrEligibleClip(facts({ rewritesFrame: true }))).toBe(false);
    expect(isHdrEligibleClip(facts({ transform: { ...transform, borderRadius: 12 } }))).toBe(false);
    expect(isHdrEligibleClip(facts({ clip: { smoothSlowMo: true, speed: 0.5 } }))).toBe(false);
    expect(isHdrEligibleClip(facts({ effects: [{ enabled: true, type: "chromaKey" }] }))).toBe(false);
  });
});

describe("measured light level", () => {
  it("PQ export targets carry a meter that the payload feeds; HLG and SDR targets do not", () => {
    const pq = hdrExportTargetFor({ settings: {} } as never, { hdr: "pq", codec: "h265" })!;
    expect(pq.meter).toBeDefined();
    expect(hdrExportTargetFor({ settings: {} } as never, { hdr: "hlg", codec: "h265" })!.meter).toBeUndefined();
    expect(hdrExportTargetFor({ settings: { workingColorSpace: "rec2020" } } as never, { codec: "h264" })!.meter).toBeUndefined();

    const w = 4;
    const h = 4;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const code = Math.round(pqEncodeNits(600) * 65535);
    const data = new Uint16Array(w * h * 4);
    for (let p = 0; p < w * h; p++) data.set([code, code, code, 65535], p * 4);
    comp.drawCodes(
      { depth: 16, width: w, height: h, data },
      hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false }),
      { geometry: computeLayerGeometry({ ...transform }, w, h, w, h), opacity: 1, grade: null },
    );
    exportPayload(comp, pq, w, h);
    const level = pq.meter!.result()!;
    expect(level.frames).toBe(1);
    expect(level.maxCll).toBeGreaterThan(595);
    expect(level.maxCll).toBeLessThan(605);
    expect(level.maxFall).toBeGreaterThan(595);
    expect(level.maxFall).toBeLessThan(605);
  });
});

describe("export payload", () => {
  it("encodes the float image to the target's planes and rides beside the bitmap", () => {
    const w = 4;
    const h = 4;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const code = Math.round(pqEncodeNits(800) * 65535);
    const data = new Uint16Array(w * h * 4);
    for (let p = 0; p < w * h; p++) data.set([code, code, code, 65535], p * 4);
    const identity = { ...transform };
    comp.drawCodes(
      { depth: 16, width: w, height: h, data },
      hdrSourceDecode({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false }),
      { geometry: computeLayerGeometry(identity, w, h, w, h), opacity: 1, grade: null },
    );
    const target = hdrExportTargetFor({ settings: {} } as never, { hdr: "pq", codec: "h265" })!;
    const payload = exportPayload(comp, target, w, h);
    expect(payload.yuv.format).toBe("I420P10");
    expect(payload.yuv.data.byteLength).toBe((w * h + 2 * (w / 2) * (h / 2)) * 2);
    const bitmap = {};
    attachHdrPayload(bitmap, payload);
    expect(takeHdrPayload(bitmap)).toBe(payload);
    expect(takeHdrPayload({})).toBeUndefined();
  });

  it("falls back to the CPU reference when no GPU is wanted or present", () => {
    expect(createHdrCompositor(false).kind).toBe("cpu");
    expect(createHdrCompositor(true).kind).toBe("cpu");
  });
});
