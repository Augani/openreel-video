import { describe, expect, it } from "vitest";
import {
  CpuHdrCompositor,
  DEFAULT_GRAPHICS_WHITE_NITS,
  PQ_WORKING_WHITE,
  computeLayerGeometry,
  decodeSourceToLinear,
  gradeHdrPixel,
  graphicsWhiteGain,
  hdrFrameToYuv,
  hdrGradeSupported,
  hdrSourceDecode,
  lutDomainDecode,
  lutDomainEncode,
  prepareHdrGrade,
  prepareHdrLut,
  sampleLut3d,
  type HdrLayerDraw,
  type HdrLayerPixels,
} from "./hdr-working";
import { applyHdrEffects, gaussianKernel, glowCombine, resolveHdrEffects, type HdrLayerEffect } from "./hdr-effects";
import { HdrLightLevelMeter, formatMaxCll } from "./hdr-light-level";
import { pqDecodeToNits, pqEncodeNits, resolveOutputColorSpec } from "../export/color-output";
import { planHdrTransition } from "../video/hdr-transition";
import type { SourceColorSpace } from "./source-color";

const PQ_2020: SourceColorSpace = { primaries: "bt2020", transfer: "pq", matrix: "bt2020-ncl", fullRange: false };
const IDENT_T = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1, fitMode: "stretch" as const };

function pqCodes16(w: number, h: number, nits: number) {
  const data = new Uint16Array(w * h * 4);
  const code = Math.round(pqEncodeNits(nits) * 65535);
  for (let p = 0; p < w * h; p++) data.set([code, code, code, 65535], p * 4);
  return { depth: 16 as const, width: w, height: h, data };
}

function draw(w: number, h: number, extra: Partial<HdrLayerDraw> = {}): HdrLayerDraw {
  return { geometry: computeLayerGeometry(IDENT_T, w, h, w, h), opacity: 1, grade: null, ...extra };
}

/** Linear layer: every pixel `value` (grey), alpha 1. */
function flat(w: number, h: number, value: number): HdrLayerPixels {
  const data = new Float32Array(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([value, value, value, 1], p * 4);
  return { width: w, height: h, data };
}

function identityLut(size: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) out.push((r / (size - 1)) * 255, (g / (size - 1)) * 255, (b / (size - 1)) * 255);
  return out;
}

describe("LUT in float", () => {
  it("an identity LUT in any space leaves SDR and HDR values alone (highlights over the table's range bypass it)", () => {
    for (const space of ["srgb", "linear", "pq"] as const) {
      const spec = prepareHdrGrade({ lut: { data: identityLut(9), size: 9, intensity: 1, space } })!;
      expect(spec.lut?.space).toBe(space);
      for (const v of [0.02, 0.3, 1, 4.9]) {
        const [r, g, b] = gradeHdrPixel(v, v, v, spec);
        // PQ-working round trips and table interpolation: well under one 10-bit PQ code at these levels.
        expect(r / v).toBeCloseTo(1, 2);
        expect(g / v).toBeCloseTo(1, 2);
        expect(b / v).toBeCloseTo(1, 2);
      }
    }
  });

  it("applies a 0.5 scale LUT in its declared space and passes the part above 1.0 through", () => {
    const size = 9;
    const half = identityLut(size).map((v) => v * 0.5);
    const linearLut = prepareHdrLut({ data: half, size, intensity: 1, space: "linear" })!;
    // In a "linear" LUT the table sees working linear 0..1 (0..203 nits): 0.6 -> 0.3.
    const g = prepareHdrGrade({ lut: { data: half, size, intensity: 1, space: "linear" } })!;
    expect(g.lut).toBe(linearLut);
    const [mid] = gradeHdrPixel(0.6, 0.6, 0.6, g);
    expect(mid).toBeCloseTo(0.3, 2);
    // 3.0 is above the table: clamp(3)=1 -> 0.5, plus the 2.0 overshoot kept -> 2.5 (highlights are not clipped).
    const [hi] = gradeHdrPixel(3, 3, 3, g);
    expect(hi).toBeGreaterThan(2.3);
    expect(hi).toBeLessThan(2.7);
  });

  it("intensity mixes the LUT with the ungraded image", () => {
    const size = 5;
    const black = new Array(size * size * size * 3).fill(0);
    const full = prepareHdrGrade({ lut: { data: black, size, intensity: 1, space: "linear" } })!;
    const half = prepareHdrGrade({ lut: { data: black, size, intensity: 0.5, space: "linear" } })!;
    expect(gradeHdrPixel(0.8, 0.8, 0.8, full)[0]).toBeCloseTo(0, 3);
    expect(gradeHdrPixel(0.8, 0.8, 0.8, half)[0]).toBeCloseTo(0.4, 2);
    expect(prepareHdrGrade({ lut: { data: black, size, intensity: 0, space: "linear" } })).toBeNull();
  });

  it("converts LUT tables once per source array and encodes domains reversibly", () => {
    const lut = { data: identityLut(5), size: 5, intensity: 1 };
    expect(prepareHdrLut(lut)).toBe(prepareHdrLut(lut));
    expect(prepareHdrLut({ ...lut, space: "pq" })).not.toBe(prepareHdrLut(lut));
    for (const space of ["srgb", "linear", "pq"] as const) {
      for (const v of [0, 0.01, 0.5, 1, 3]) expect(lutDomainDecode(lutDomainEncode(v, space), space)).toBeCloseTo(v, 4);
    }
    const spec = prepareHdrLut(lut)!;
    const [r, g, b] = sampleLut3d(spec, 0.3, 0.6, 0.9);
    expect([r, g, b].map((v) => Math.round(v * 1000) / 1000)).toEqual([0.3, 0.6, 0.9]);
  });

  it("rejects a malformed table and keeps neutral LUTs out of the grade", () => {
    expect(hdrGradeSupported({ lut: { data: [1, 2, 3], size: 4, intensity: 1 } })).toBe(false);
    expect(prepareHdrGrade({ lut: { data: [], size: 0, intensity: 1 } })).toBeNull();
  });
});

describe("HSL bands and vignette in float", () => {
  it("shifts one hue band and leaves the others", () => {
    const hsl = { hue: [0, 0, 0, 0, 0, 0, 0, 0], saturation: [0, 0, 0, 0, 0, 0, 0, 0], luminance: [0, 0, 0, 0, 0, 0, 0, 0] };
    hsl.saturation[0] = -1; // band 0 (reds): fully desaturate
    const spec = prepareHdrGrade({ hsl })!;
    const [r, g, b] = gradeHdrPixel(2, 0.1, 0.1, spec);
    expect(Math.abs(r - g)).toBeLessThan(0.05);
    expect(Math.abs(g - b)).toBeLessThan(0.05);
    // A blue pixel (band 5) is untouched.
    const [br, bg, bb] = gradeHdrPixel(0.1, 0.1, 2, spec);
    expect(bb / br).toBeGreaterThan(5);
    expect(bg).toBeCloseTo(br, 3);
  });

  it("darkens the frame edge and not its centre; a positive amount lifts to graphics white, never above", () => {
    const dark = prepareHdrGrade({ vignette: { amount: -0.8, midpoint: 0.3, roundness: 0, feather: 0.4 } })!;
    const centre = gradeHdrPixel(4, 4, 4, dark, { nx: 0, ny: 0, aspect: 16 / 9 });
    const edge = gradeHdrPixel(4, 4, 4, dark, { nx: 1, ny: 1, aspect: 16 / 9 });
    expect(centre[0]).toBeCloseTo(4, 2);
    expect(edge[0]).toBeLessThan(2);
    const light = prepareHdrGrade({ vignette: { amount: 1, midpoint: 0.3, roundness: 0, feather: 0.4 } })!;
    const lifted = gradeHdrPixel(0.05, 0.05, 0.05, light, { nx: 1, ny: 1, aspect: 1 });
    expect(lifted[0]).toBeGreaterThan(0.5);
    const bright = gradeHdrPixel(4, 4, 4, light, { nx: 1, ny: 1, aspect: 1 });
    expect(bright[0]).toBeCloseTo(4, 2);
    expect(PQ_WORKING_WHITE).toBeCloseTo(pqEncodeNits(203), 6);
  });

  it("draws the vignette from the clip's source frame through the compositor", () => {
    const w = 16;
    const h = 16;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const grade = prepareHdrGrade({ vignette: { amount: -1, midpoint: 0.2, roundness: 0, feather: 0.3 } });
    comp.drawCodes(pqCodes16(w, h, 600), hdrSourceDecode(PQ_2020), draw(w, h, { grade }));
    const f = comp.readFrame().data;
    const at = (x: number, y: number): number => f[(y * w + x) * 4];
    expect(at(8, 8)).toBeGreaterThan(at(0, 0) * 2);
    expect(at(8, 8)).toBeGreaterThan(2.5);
  });
});

describe("float layer effects", () => {
  it("resolves blur, sharpen and glow and reports anything else as unsupported", () => {
    const r = resolveHdrEffects([
      { type: "blur", enabled: true, params: { radius: 6 } },
      { type: "sharpen", enabled: true, params: { amount: 40 } },
      { type: "glow", enabled: true, params: { radius: 8, intensity: 1.5, color: "#ff8800" } },
      { type: "blur", enabled: false, params: { radius: 9 } },
      { type: "blur", enabled: true, params: { radius: 0 } },
    ]);
    expect(r.unsupported).toBe(false);
    expect(r.effects.map((e) => e.type)).toEqual(["blur", "sharpen", "glow"]);
    const glow = r.effects[2] as Extract<HdrLayerEffect, { type: "glow" }>;
    expect(glow.tint).not.toBeNull();
    expect(resolveHdrEffects([{ type: "chromaKey", enabled: true }]).unsupported).toBe(true);
    expect(resolveHdrEffects([{ type: "chromaKey", enabled: false }]).unsupported).toBe(false);
  });

  it("blur conserves light and keeps a spread highlight above SDR white", () => {
    const w = 31;
    const h = 31;
    const layer = flat(w, h, 0);
    const c = (15 * w + 15) * 4;
    layer.data.set([40, 40, 40, 1], c); // 8120 nits point
    for (let p = 0; p < w * h; p++) layer.data[p * 4 + 3] = 1;
    const out = applyHdrEffects(layer, [{ type: "blur", radius: 2 }]);
    let before = 0;
    let after = 0;
    for (let p = 0; p < w * h; p++) {
      before += layer.data[p * 4];
      after += out.data[p * 4];
    }
    expect(after / before).toBeCloseTo(1, 3);
    expect(out.data[c]).toBeLessThan(40);
    expect(out.data[c]).toBeGreaterThan(1);
    expect(out.data[c - 4]).toBeGreaterThan(1);
    expect(gaussianKernel(2).half).toBe(6);
  });

  it("blur of a transparent edge does not bleed black into the colour", () => {
    const w = 8;
    const h = 1;
    const layer = flat(w, h, 3);
    for (let x = 4; x < 8; x++) layer.data[x * 4 + 3] = 0;
    const out = applyHdrEffects(layer, [{ type: "blur", radius: 1 }]);
    expect(out.data[3 * 4]).toBeGreaterThan(2.9);
    expect(out.data[3 * 4 + 3]).toBeLessThan(1);
    expect(out.data[3 * 4 + 3]).toBeGreaterThan(0.3);
  });

  it("sharpen overshoots a hard edge and leaves flat areas unchanged", () => {
    const w = 8;
    const h = 3;
    const layer = flat(w, h, 0.2);
    for (let y = 0; y < h; y++) for (let x = 4; x < w; x++) layer.data.set([5, 5, 5, 1], (y * w + x) * 4);
    const out = applyHdrEffects(layer, [{ type: "sharpen", amount: 80 }]);
    expect(out.data[(1 * w + 1) * 4]).toBeCloseTo(0.2, 4);
    expect(out.data[(1 * w + 3) * 4]).toBeLessThan(0.2);
    expect(out.data[(1 * w + 4) * 4]).toBeGreaterThan(5);
  });

  it("glow adds light around a highlight and leaves an opaque bright pixel at its value", () => {
    const w = 21;
    const h = 21;
    const layer = flat(w, h, 0.005);
    const c = (10 * w + 10) * 4;
    layer.data.set([30, 30, 30, 1], c);
    const out = applyHdrEffects(layer, [{ type: "glow", radius: 3, intensity: 1, tint: null }]);
    expect(out.data[c]).toBeCloseTo(30, 3);
    expect(out.data[c + 4]).toBeGreaterThan(0.005 * 20);
    // Far from the highlight the bright-pass (below the contrast pivot) adds nothing.
    expect(out.data[0]).toBeCloseTo(0.005, 4);
    const tinted = glowCombine(layer.data, new Float32Array(layer.data.length), 1, [1, 0, 0]);
    expect(tinted[0]).toBeCloseTo(0.005, 6);
  });

  it("runs the stack through the compositor before grade and transform", () => {
    const w = 16;
    const h = 16;
    const code = Math.round(pqEncodeNits(1000) * 65535);
    const data = new Uint16Array(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const x = p % w;
      const v = x === 8 ? code : Math.round(pqEncodeNits(20) * 65535);
      data.set([v, v, v, 65535], p * 4);
    }
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes({ depth: 16, width: w, height: h, data }, hdrSourceDecode(PQ_2020), draw(w, h, { effects: [{ type: "blur", radius: 1.5 }] }));
    const f = comp.readFrame().data;
    const peak = f[(8 * w + 8) * 4];
    expect(peak).toBeLessThan(1000 / 203);
    expect(peak).toBeGreaterThan(20 / 203);
    expect(f[(8 * w + 9) * 4]).toBeGreaterThan(0.3);
  });
});

describe("float transitions and graphics white", () => {
  it("plans crossfade and dip draws like the 8-bit engine's phases", () => {
    expect(planHdrTransition({ kind: "crossfade", progress: 0.25 })).toEqual([
      { layer: "outgoing", opacity: 1 },
      { layer: "incoming", opacity: 0.25 },
    ]);
    expect(planHdrTransition({ kind: "crossfade", progress: 0.25, edge: "out" })).toEqual([{ layer: "outgoing", opacity: 0.75 }]);
    expect(planHdrTransition({ kind: "crossfade", progress: 0.25, edge: "in" })).toEqual([{ layer: "incoming", opacity: 0.25 }]);
    expect(planHdrTransition({ kind: "dipToBlack", progress: 0.25 })).toEqual([
      { layer: "outgoing", opacity: 1 },
      { layer: "solid", color: "black", opacity: 0.5 },
    ]);
    expect(planHdrTransition({ kind: "dipToWhite", progress: 0.5, holdDuration: 1 })).toEqual([{ layer: "solid", color: "white", opacity: 1 }]);
    expect(planHdrTransition({ kind: "dipToBlack", progress: 0.75 })).toEqual([
      { layer: "solid", color: "black", opacity: 1 },
      { layer: "incoming", opacity: 0.5 },
    ]);
    // A hold stretches the solid phase: phases = 2 + 2, fade out ends at 0.25, hold ends at 0.75.
    expect(planHdrTransition({ kind: "dipToBlack", progress: 0.5, holdDuration: 2 })).toEqual([{ layer: "solid", color: "black", opacity: 1 }]);
  });

  it("a crossfade of two highlights is the linear average, above SDR white", () => {
    const w = 4;
    const h = 4;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const decode = hdrSourceDecode(PQ_2020);
    for (const step of planHdrTransition({ kind: "crossfade", progress: 0.5 })) {
      if (step.layer === "solid") continue;
      const nits = step.layer === "outgoing" ? 1000 : 3000;
      comp.drawCodes(pqCodes16(w, h, nits), decode, draw(w, h, { opacity: step.opacity }));
    }
    const f = comp.readFrame().data;
    expect(f[0]).toBeCloseTo(2000 / 203, 2);
    expect(f[3]).toBe(1);
  });

  it("a dip to white lands at graphics white and a dip to black at zero", () => {
    const comp = new CpuHdrCompositor();
    comp.begin(2, 2);
    comp.drawCodes(pqCodes16(2, 2, 1000), hdrSourceDecode(PQ_2020), draw(2, 2));
    comp.drawSolid([graphicsWhiteGain(400), graphicsWhiteGain(400), graphicsWhiteGain(400)], 1);
    expect(comp.readFrame().data[0]).toBeCloseTo(400 / 203, 4);
    comp.begin(2, 2);
    comp.drawCodes(pqCodes16(2, 2, 1000), hdrSourceDecode(PQ_2020), draw(2, 2));
    comp.drawSolid([0, 0, 0], 0.5);
    expect(comp.readFrame().data[0]).toBeCloseTo(1000 / 203 / 2, 3);
  });

  it("places 8-bit graphics at the configured graphics white", () => {
    const overlay = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 128]) };
    const at = (nits?: number): Float32Array => {
      const comp = new CpuHdrCompositor();
      comp.begin(2, 1);
      if (nits !== undefined) comp.setGraphicsWhite(nits);
      comp.drawOverlay(overlay);
      return comp.readFrame().data;
    };
    expect(DEFAULT_GRAPHICS_WHITE_NITS).toBe(203);
    expect(at()[0]).toBeCloseTo(1, 4);
    expect(at(203)[0]).toBeCloseTo(1, 4);
    expect(at(300)[0]).toBeCloseTo(300 / 203, 4);
    // Half-transparent white over black: coverage multiplies the elevated white.
    expect(at(300)[4]).toBeCloseTo((300 / 203) * (128 / 255), 3);
    expect(graphicsWhiteGain(5000)).toBeCloseTo(1000 / 203, 6);
    expect(graphicsWhiteGain(undefined)).toBe(1);
  });
});

describe("PQ export keeps highlights above SDR white through an effect and a transition", () => {
  const spec = resolveOutputColorSpec("rec2020", "pq")!;
  const lumaNits = (data: Uint8Array | Uint16Array, width: number, height: number): number => {
    // I420P10 is 16-bit little-endian samples; read the luma plane at the centre.
    const samples = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
    const code = samples[Math.floor(height / 2) * width + Math.floor(width / 2)];
    return pqDecodeToNits((code - 64) / 876);
  };

  it("blur then crossfade of 1000 and 600 nit flats encodes to the 800 nit average at 10 bit", () => {
    const w = 16;
    const h = 16;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    const decode = hdrSourceDecode(PQ_2020);
    const blur: HdrLayerEffect[] = [{ type: "blur", radius: 2 }];
    for (const step of planHdrTransition({ kind: "crossfade", progress: 0.5 })) {
      if (step.layer === "solid") continue;
      comp.drawCodes(pqCodes16(w, h, step.layer === "outgoing" ? 1000 : 600), decode, draw(w, h, { opacity: step.opacity, effects: blur }));
    }
    const yuv = hdrFrameToYuv(comp.readFrame(), spec, "420");
    expect(yuv.format).toBe("I420P10");
    const nits = lumaNits(yuv.data, w, h);
    expect(nits).toBeGreaterThan(203 * 3);
    expect(nits).toBeGreaterThan(760);
    expect(nits).toBeLessThan(840);
  });

  it("an 8-bit pipeline would have clipped the same frame to SDR white", () => {
    const w = 16;
    const h = 16;
    const comp = new CpuHdrCompositor();
    comp.begin(w, h);
    comp.drawCodes(pqCodes16(w, h, 1000), hdrSourceDecode(PQ_2020), draw(w, h, { effects: [{ type: "blur", radius: 2 }] }));
    comp.drawSolid([0, 0, 0], 0.5);
    const nits = lumaNits(hdrFrameToYuv(comp.readFrame(), spec, "420").data, w, h);
    expect(nits).toBeGreaterThan(450);
    expect(nits).toBeLessThan(550);
    const layer = decodeSourceToLinear(pqCodes16(2, 2, 1000), hdrSourceDecode(PQ_2020));
    expect(layer.data[0]).toBeGreaterThan(4.9);
  });
});

describe("measured MaxCLL / MaxFALL", () => {
  const frame = (pixels: number, nits: number[]): Float32Array => {
    const out = new Float32Array(pixels * 3);
    for (let p = 0; p < pixels; p++) {
      const v = pqEncodeNits(nits[p % nits.length]);
      out.set([v, v * 0.5, v * 0.25], p * 3);
    }
    return out;
  };

  it("takes the brightest component over all frames and the largest frame average", () => {
    const meter = new HdrLightLevelMeter();
    expect(meter.result()).toBeNull();
    meter.add(frame(100, [100, 1000])); // peak 1000, average 550
    meter.add(frame(100, [200, 400])); // peak 400, average 300
    const level = meter.result()!;
    expect(level.frames).toBe(2);
    expect(level.maxCll).toBeGreaterThanOrEqual(999);
    expect(level.maxCll).toBeLessThanOrEqual(1001);
    expect(level.maxFall).toBeGreaterThan(540);
    expect(level.maxFall).toBeLessThan(560);
    expect(formatMaxCll(level)).toBe(`${level.maxCll},${level.maxFall}`);
    meter.reset();
    expect(meter.result()).toBeNull();
  });
});
