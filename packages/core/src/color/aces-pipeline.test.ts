import { describe, expect, it } from "vitest";
import {
  ACES_SDR_DECODE,
  CpuHdrCompositor,
  acesPipeline,
  computeLayerGeometry,
  decodeSourceToLinear,
  decodeToWorkingLinear,
  gradeHdrPixel,
  hdrFrameToSdrRgba,
  hdrPipelineFor,
  hdrSourceDecode,
  isHdrWorkingMode,
  prepareHdrGrade,
  registerAcesOutputTransform,
  HDR_TRANSFER_ACESCCT,
  type HdrLayerDraw,
} from "./hdr-working";
import { acescctEncode, acesOutputForExport, isAcesMode } from "./aces";
import { acesOutputTransform } from "./aces-output";
import { CAMERA_LOGS } from "./camera-log";
import {
  ACES_FOOTAGE_COLOR_PRESETS,
  effectiveSourceColor,
  footageColorPresetSpace,
  inputSpaceForItem,
  isFootageColorPreset,
  type SourceColorSpace,
} from "./source-color";
import { outputColorForExport, pqEncodeNits, srgbToLinear } from "../export/color-output";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import { ActionValidator } from "../actions/action-validator";
import type { Project } from "../types/project";

registerAcesOutputTransform(acesOutputTransform);

const IDENT_T = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" as const };
const ACES = acesPipeline("srgb");
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

function flat8(w: number, h: number, r: number, g: number, b: number, a = 255) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([r, g, b, a], p * 4);
  return { depth: 8 as const, width: w, height: h, data };
}
function draw(w: number, h: number, extra: Partial<HdrLayerDraw> = {}): HdrLayerDraw {
  return { geometry: computeLayerGeometry(IDENT_T, w, h, w, h), opacity: 1, grade: null, ...extra };
}

describe("ACES mode selection", () => {
  it("only the aces colour management setting enters the float pipeline for a Rec.709 SDR project", () => {
    expect(isAcesMode({})).toBe(false);
    expect(isAcesMode({ colorManagement: "display-referred" })).toBe(false);
    expect(isAcesMode({ colorManagement: "aces" })).toBe(true);
    expect(isHdrWorkingMode({ workingColorSpace: "rec709" }, undefined)).toBe(false);
    expect(isHdrWorkingMode({ workingColorSpace: "rec709", colorManagement: "aces" }, undefined)).toBe(true);
    expect(hdrPipelineFor(undefined).kind).toBe("scene-hdr");
    expect(hdrPipelineFor({ colorManagement: "aces", acesOutput: "rec709" })).toEqual({ kind: "aces", sdrOutput: "rec709" });
    expect(hdrPipelineFor({ colorManagement: "aces" })).toEqual({ kind: "aces", sdrOutput: "srgb" });
  });

  it("an ACES SDR export is the 8-bit classic path; HDR exports keep their Rec.2020 PQ / HLG spec", () => {
    const aces = { settings: { workingColorSpace: "rec2020" as const, colorManagement: "aces" as const } };
    expect(outputColorForExport(aces, undefined)).toBeNull();
    expect(outputColorForExport(aces, "pq")?.transfer).toBe("pq");
    expect(outputColorForExport(aces, "hlg")?.transfer).toBe("hlg");
    // Display-referred projects are unchanged.
    expect(outputColorForExport({ settings: { workingColorSpace: "rec2020" } }, undefined)?.primaries).toBe("bt2020");
    expect(outputColorForExport({ settings: { workingColorSpace: "rec709" } }, undefined)).toBeNull();
    expect(acesOutputForExport({ colorManagement: "aces" }, "pq")).toBe("rec2020-pq");
  });
});

describe("ACES input transforms (IDT)", () => {
  it("sRGB / Rec.709 white and mid grey enter as ACES 1.0 and the sRGB-decoded grey", () => {
    const white = decodeSourceToLinear(flat8(1, 1, 255, 255, 255), ACES_SDR_DECODE);
    for (let c = 0; c < 3; c++) close(white.data[c], 1, 1e-5);
    const grey = decodeSourceToLinear(flat8(1, 1, 118, 118, 118), hdrSourceDecode(null, ACES));
    // sRGB code 118 is 18% grey.
    for (let c = 0; c < 3; c++) close(grey.data[c], 0.18, 2e-3);
    // A saturated sRGB red lands in AP1 with the published ACEScg values (Bradford): R 0.6131, G 0.0702, B 0.0206.
    const red = decodeSourceToLinear(flat8(1, 1, 255, 0, 0), ACES_SDR_DECODE);
    close(red.data[0], 0.6131, 1e-3);
    close(red.data[1], 0.0702, 1e-3);
    close(red.data[2], 0.0206, 1e-3);
  });

  it("every camera log preset maps its published 18% grey signal to neutral ACEScg 0.18", () => {
    for (const def of CAMERA_LOGS) {
      const space: SourceColorSpace = { primaries: def.gamut, transfer: def.id, matrix: "rgb", fullRange: true };
      const decode = hdrSourceDecode(space, ACES);
      const code = Math.round(def.grey18 * 65535);
      const px = decodeSourceToLinear({ depth: 16, width: 1, height: 1, data: new Uint16Array([code, code, code, 65535]) }, decode);
      for (let c = 0; c < 3; c++) close(px.data[c], 0.18, 2.5e-3);
    }
  });

  it("Rec.2020, PQ and HLG sources decode to ACEScg with 203 nits at 1.0", () => {
    const pq: SourceColorSpace = { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false };
    const code = Math.round(pqEncodeNits(203) * 65535);
    const px = decodeSourceToLinear({ depth: 16, width: 1, height: 1, data: new Uint16Array([code, code, code, 65535]) }, hdrSourceDecode(pq, ACES));
    for (let c = 0; c < 3; c++) close(px.data[c], 1, 2e-3);
    const hlg: SourceColorSpace = { primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl", fullRange: false };
    const hlgSdrWhite = Math.round(0.75 * 65535);
    const h = decodeSourceToLinear({ depth: 16, width: 1, height: 1, data: new Uint16Array([hlgSdrWhite, hlgSdrWhite, hlgSdrWhite, 65535]) }, hdrSourceDecode(hlg, ACES));
    for (let c = 0; c < 3; c++) close(h.data[c], 1, 2e-2);
  });

  it("ACES-native footage presets: ACEScg is a pass-through, ACES2065-1 goes AP0 -> AP1, ACEScct decodes the log", () => {
    expect(ACES_FOOTAGE_COLOR_PRESETS.map((p) => p.id)).toEqual(["aces-acescg", "aces-aces2065", "aces-acescct", "linear-rec709", "linear-rec2020", "linear-p3"]);
    for (const p of ACES_FOOTAGE_COLOR_PRESETS) expect(isFootageColorPreset(p.id)).toBe(true);
    const cg = hdrSourceDecode(footageColorPresetSpace("aces-acescg"), ACES);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(cg.toBt2020[i][j], i === j ? 1 : 0, 1e-9);
    const ap0 = hdrSourceDecode(footageColorPresetSpace("aces-aces2065"), ACES);
    // ACES2065-1 white (1,1,1) is ACEScg white (1,1,1).
    for (const row of ap0.toBt2020) close(row[0] + row[1] + row[2], 1, 1e-6);
    const cct = hdrSourceDecode(footageColorPresetSpace("aces-acescct"), ACES);
    expect(cct.transfer).toBe(HDR_TRANSFER_ACESCCT);
    close(decodeToWorkingLinear(acescctEncode(0.18), HDR_TRANSFER_ACESCCT), 0.18, 1e-9);
  });

  it("a clip's own override wins over the footage item's interpretation", () => {
    const item = { colorInterpretation: "srgb" as const };
    expect(effectiveSourceColor(item, "aces-acescg").primaries).toBe("ap1");
    expect(inputSpaceForItem(item, "log-slog3")?.transfer).toBe("slog3");
    // No override: the footage's own setting, and plain sRGB footage needs no transform.
    expect(inputSpaceForItem(item)).toBeNull();
    expect(inputSpaceForItem({}, "aces-acescg")?.primaries).toBe("ap1");
  });

  it("an ACES preset set on a footage item is honoured as the input colour space (the Interpret Footage override)", () => {
    const item = { colorInterpretation: "aces-acescg" as const };
    expect(effectiveSourceColor(item).primaries).toBe("ap1");
    expect(inputSpaceForItem(item)?.primaries).toBe("ap1");
  });
});

describe("ACES compositing and output", () => {
  const w = 4;
  const h = 3;

  it("the SDR view is the Output Transform of the composited ACEScg image", () => {
    const comp = new CpuHdrCompositor();
    comp.setColorPipeline(ACES);
    comp.begin(w, h);
    comp.drawCodes(flat8(w, h, 118, 118, 118), hdrSourceDecode(null, ACES), draw(w, h));
    const view = comp.readSdrView();
    const expected = acesOutputTransform(0.18, 0.18, 0.18, "srgb");
    for (let c = 0; c < 3; c++) close(view[c] / 255, expected[c], 1 / 255 + 1e-3);
    expect(view[3]).toBe(255);
    // The same image in the default pipeline is the tone-mapped display-referred view, not the ACES look.
    const plain = new CpuHdrCompositor();
    plain.begin(w, h);
    plain.drawCodes(flat8(w, h, 118, 118, 118), hdrSourceDecode(null), draw(w, h));
    expect(Math.abs(plain.readSdrView()[0] - view[0])).toBeGreaterThan(20);
  });

  it("Rec.709 output uses the BT.1886 encoding", () => {
    const comp = new CpuHdrCompositor();
    comp.setColorPipeline(acesPipeline("rec709"));
    comp.begin(2, 2);
    comp.drawCodes(flat8(2, 2, 118, 118, 118), hdrSourceDecode(null, acesPipeline("rec709")), draw(2, 2));
    const expected = acesOutputTransform(0.18, 0.18, 0.18, "rec709");
    close(comp.readSdrView()[0] / 255, expected[0], 1 / 255 + 1e-3);
  });

  it("8-bit overlays enter at graphics white through the sRGB IDT, in ACEScg", () => {
    const comp = new CpuHdrCompositor();
    comp.setColorPipeline(ACES);
    comp.begin(2, 2);
    comp.setGraphicsWhite(203);
    comp.drawOverlay(flat8(2, 2, 255, 255, 255));
    const frame = comp.readFrame();
    for (let c = 0; c < 3; c++) close(frame.data[c], 1, 1e-5);
    const view = comp.readSdrView();
    close(view[0] / 255, acesOutputTransform(1, 1, 1, "srgb")[0], 1 / 255 + 1e-3);
  });

  it("HDR export encodes through the Rec.2020 PQ and HLG Output Transforms", () => {
    const comp = new CpuHdrCompositor();
    comp.setColorPipeline(ACES);
    comp.begin(2, 2);
    comp.drawCodes(flat8(2, 2, 118, 118, 118), hdrSourceDecode(null, ACES), draw(2, 2));
    const pq = comp.readEncodedRgb({ primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 });
    // sRGB code 118 decodes to 0.1812 (the float image holds exactly that, in float32).
    const v = srgbToLinear(118 / 255);
    close(pq[0], acesOutputTransform(v, v, v, "rec2020-pq")[0], 2e-6);
    const hlg = comp.readEncodedRgb({ primaries: "bt2020", transfer: "hlg", matrix: "bt2020-ncl", fullRange: false, bitDepth: 10 });
    close(hlg[0], acesOutputTransform(v, v, v, "rec2020-hlg")[0], 2e-6);
    expect(Math.abs(pq[0] - hlg[0])).toBeGreaterThan(0.02);
  });

  it("changes the picture against the display-referred pipeline for the same footage (the ACES look)", () => {
    const ramp = new Uint8ClampedArray(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const v = Math.round((p / (w * h - 1)) * 255);
      ramp.set([v, Math.round(v * 0.6), Math.round(v * 0.3), 255], p * 4);
    }
    const codes = { depth: 8 as const, width: w, height: h, data: ramp };
    const classic = new CpuHdrCompositor();
    classic.begin(w, h);
    classic.drawCodes(codes, hdrSourceDecode(null), draw(w, h));
    const aces = new CpuHdrCompositor();
    aces.setColorPipeline(ACES);
    aces.begin(w, h);
    aces.drawCodes(codes, hdrSourceDecode(null, ACES), draw(w, h));
    const a = classic.readSdrView();
    const b = aces.readSdrView();
    let differing = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 3 || Math.abs(a[i + 1] - b[i + 1]) > 3) differing++;
    expect(differing).toBeGreaterThan(w * h * 0.6);
  });

  it("hdrFrameToSdrRgba in the aces pipeline keeps alpha and clamps negative light", () => {
    const data = new Float32Array([-0.5, 0.2, 0.1, 0.5]);
    const out = hdrFrameToSdrRgba({ width: 1, height: 1, data }, ACES);
    expect(out[3]).toBe(128);
    expect(out[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("grading in ACEScct", () => {
  it("prepareHdrGrade marks the spec for ACEScct only in the aces pipeline", () => {
    expect(prepareHdrGrade({ temperature: 30 })?.acescct).toBeUndefined();
    expect(prepareHdrGrade({ temperature: 30 }, ACES)?.acescct).toBe(true);
    expect(prepareHdrGrade(undefined, ACES)).toBeNull();
  });

  it("an offset in the grade is an offset of ACEScct code values (white balance on mid grey)", () => {
    const spec = prepareHdrGrade({ temperature: 30 }, ACES)!;
    const [r, g, b] = gradeHdrPixel(0.18, 0.18, 0.18, spec);
    const wb = spec.whiteBalance!;
    const base = acescctEncode(0.18);
    // decode(encode(x) + offset) = x * 2^(17.52 * offset) in the log segment.
    close(Math.log2(r / 0.18), 17.52 * wb[0], 1e-6);
    close(Math.log2(g / 0.18), 17.52 * wb[1], 1e-6);
    close(Math.log2(b / 0.18), 17.52 * wb[2], 1e-6);
    expect(base).toBeCloseTo(0.4135884, 6);
  });

  it("exposure is a linear gain and a neutral grade round-trips through ACEScct unchanged", () => {
    const exposure = prepareHdrGrade({ tone: { exposure: 0.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } }, ACES)!;
    const [r] = gradeHdrPixel(0.18, 0.18, 0.18, exposure);
    close(r, 0.18 * 2, 1e-5);
    const lut = prepareHdrGrade({ lut: { data: identity(9), size: 9, intensity: 1, space: "linear" } }, ACES);
    if (lut) {
      const out = gradeHdrPixel(0.18, 0.05, 0.4, lut);
      close(out[0], 0.18, 2e-3);
      close(out[1], 0.05, 2e-3);
      close(out[2], 0.4, 2e-3);
    }
  });

  it("a positive vignette lifts towards SDR white in ACEScct, not towards the top of the encoding", () => {
    const spec = prepareHdrGrade({ vignette: { amount: 1, midpoint: 0, roundness: 0, feather: 0.01 } }, ACES)!;
    const [r] = gradeHdrPixel(0.18, 0.18, 0.18, spec, { nx: 1, ny: 1, aspect: 1 });
    expect(r).toBeGreaterThan(0.18);
    expect(r).toBeLessThanOrEqual(1.0001);
  });
});

function identity(n: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) out.push((r / (n - 1)) * 255, (g / (n - 1)) * 255, (b / (n - 1)) * 255);
  return out;
}

describe("project setting: undoable and persisted", () => {
  function project(): Project {
    return {
      id: "aces",
      name: "ACES",
      createdAt: 1,
      modifiedAt: 1,
      settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
      mediaLibrary: { items: [] },
      timeline: { tracks: [], subtitles: [], markers: [], duration: 0 },
    };
  }

  it("switching to ACES and changing the output transform undo and redo as one step each", async () => {
    const p = project();
    const history = new ActionHistory();
    const executor = new ActionExecutor(history);
    await executor.execute({ type: "project/updateSettings", id: "a", timestamp: 2, params: { colorManagement: "aces" } }, p);
    expect(p.settings.colorManagement).toBe("aces");
    await executor.execute({ type: "project/updateSettings", id: "b", timestamp: 3, params: { acesOutput: "rec709" } }, p);
    expect(p.settings.acesOutput).toBe("rec709");
    await executor.undo(p);
    expect(p.settings.acesOutput).toBeUndefined();
    expect(p.settings.colorManagement).toBe("aces");
    await executor.undo(p);
    expect(p.settings.colorManagement).toBeUndefined();
    await executor.redo(p);
    expect(p.settings.colorManagement).toBe("aces");
  });

  it("the validator rejects unknown modes and output transforms", () => {
    const validator = new ActionValidator();
    const p = project();
    const bad = validator.validate({ type: "project/updateSettings", id: "x", timestamp: 1, params: { colorManagement: "p3-magic" } } as never, p);
    expect(bad.valid).toBe(false);
    const bad2 = validator.validate({ type: "project/updateSettings", id: "y", timestamp: 1, params: { acesOutput: "rec2020-pq" } } as never, p);
    expect(bad2.valid).toBe(false);
    const ok = validator.validate({ type: "project/updateSettings", id: "z", timestamp: 1, params: { colorManagement: "aces", acesOutput: "srgb" } } as never, p);
    expect(ok.valid).toBe(true);
  });
});
