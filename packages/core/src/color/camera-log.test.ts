import { describe, expect, it } from "vitest";
import {
  CAMERA_LOGS,
  cameraGamutToBt2020,
  cameraGamutToBt709,
  cameraLogDef,
  cameraLogGlsl,
  cameraLogGlslExpression,
  decodeCameraLog,
  encodeCameraLog,
  type CameraLogId,
} from "./camera-log";
import { createInputTransform, transformPixel } from "./input-transform";
import { CAMERA_FOOTAGE_COLOR_PRESETS, effectiveSourceColor, inputSpaceForItem, isFootageColorPreset, needsInputTransform } from "./source-color";
import { decodeToWorkingLinear, hdrSourceDecode } from "./hdr-working";

/**
 * Published reference values. Each manufacturer states the signal for 0% and 18% grey (and most for 90% white);
 * the 10-bit code values quoted in their documents are signal * 1023.
 */
const REFERENCE: Record<CameraLogId, { black: number; grey18: number; white90: number; tolerance: number }> = {
  // Sony: 95 / 420 / 598 (10-bit CV)
  slog3: { black: 95 / 1023, grey18: 420 / 1023, white90: 598 / 1023, tolerance: 6e-4 },
  // Panasonic: 0.125 / 0.423311 / 0.5886
  vlog: { black: 0.125, grey18: 0.423311, white90: 0.5886, tolerance: 6e-4 },
  // ARRI LogC3 EI 800: 0.092809 / 0.391007 / 0.5594
  logc3: { black: 0.092809, grey18: 0.391007, white90: 0.5594, tolerance: 4e-4 },
  // ARRI LogC4: 0.092864 / 0.278395 published; 90% white is hand-evaluated from the specification formula
  logc4: { black: 95 / 1023, grey18: 0.278395, white90: 0.41798, tolerance: 4e-4 },
  // Canon C-Log3: 0.073059 / 0.313437 / 0.5678
  clog3: { black: 0.073059361, grey18: 0.313437, white90: 0.5678, tolerance: 4e-4 },
  // Nikon N-Log: 0.1243 / 0.363667 / 0.5896
  nlog: { black: 0.1243, grey18: 0.363667, white90: 0.5896, tolerance: 6e-4 },
  // Fujifilm F-Log: 95 / 470 / 705 (10-bit CV)
  flog: { black: 0.092864, grey18: 0.459319, white90: 0.68951, tolerance: 4e-4 },
  // Fujifilm F-Log2: 95 / 400 / 570
  flog2: { black: 0.092864, grey18: 0.391007, white90: 0.55713, tolerance: 4e-4 },
  // Blackmagic Film Gen5: black 0.0924657 (E), 18% grey 0.38357; 90% white hand-evaluated from the formula
  bmdfilm5: { black: 0.0924657534, grey18: 0.383566, white90: 0.52137, tolerance: 6e-4 },
};

describe("camera log curves against published reference values", () => {
  for (const def of CAMERA_LOGS) {
    const ref = REFERENCE[def.id];
    it(`${def.label}: encodes 0%, 18% grey and 90% white to the published signal`, () => {
      expect(def.encode(0)).toBeCloseTo(ref.black, 3);
      expect(Math.abs(def.encode(0.18) - ref.grey18)).toBeLessThan(ref.tolerance);
      expect(Math.abs(def.encode(0.9) - ref.white90)).toBeLessThan(ref.tolerance * 3);
      expect(Math.abs(def.grey18 - ref.grey18)).toBeLessThan(ref.tolerance);
    });
    it(`${def.label}: the 18% grey signal decodes to 0.18 scene linear`, () => {
      expect(def.decode(ref.grey18)).toBeCloseTo(0.18, 2);
      expect(def.decode(def.encode(0.18))).toBeCloseTo(0.18, 5);
    });
    it(`${def.label}: decode inverts encode across the range and is monotonic`, () => {
      let previous = -Infinity;
      for (const linear of [-0.005, 0, 0.0005, 0.002, 0.01, 0.05, 0.18, 0.5, 0.9, 1, 2, 5, 10]) {
        const signal = def.encode(linear);
        const back = def.decode(signal);
        // N-Log's two segments meet with a 0.2 code gap in the published constants.
        const tolerance = def.id === "nlog" ? 2e-3 : def.id === "flog" ? 1e-4 : 1e-5;
        expect(Math.abs(back - linear)).toBeLessThan(Math.max(tolerance, Math.abs(linear) * 1e-4));
        expect(signal).toBeGreaterThan(previous);
        previous = signal;
      }
    });
  }

  it("matches exact published values at the segment joins and landmarks", () => {
    // S-Log3: 1.0 reflectance and the cut between the log and linear segments.
    expect(decodeCameraLog(171.2102946929 / 1023, "slog3")).toBeCloseTo(0.01125, 6);
    // LogC4 mid grey is the specification's 0.2784 and 0 maps to 95/1023.
    expect(encodeCameraLog(0.18, "logc4")).toBeCloseTo(0.2784, 3);
    // ARRI LogC3 EI 800 is continuous at the cut.
    expect(encodeCameraLog(0.010591, "logc3")).toBeCloseTo(5.367655 * 0.010591 + 0.092809, 4);
    // V-Log is continuous at its cut (0.181 signal <-> 0.01 linear).
    expect(decodeCameraLog(0.181, "vlog")).toBeCloseTo(0.01, 4);
    // C-Log3 is continuous at both cuts.
    expect(decodeCameraLog(0.04076162, "clog3")).toBeCloseTo(-0.014, 4);
    expect(decodeCameraLog(0.105357102, "clog3")).toBeCloseTo(0.014, 4);
    // Blackmagic: published A, B, C and the derived toe slope D = 8.283611, E = 0.0924657.
    expect(encodeCameraLog(0.005, "bmdfilm5")).toBeCloseTo(0.13389, 4);
    expect(encodeCameraLog(0, "bmdfilm5")).toBeCloseTo(0.0924657, 6);
    expect((encodeCameraLog(0.005001, "bmdfilm5") - encodeCameraLog(0.005, "bmdfilm5")) / 0.000001).toBeCloseTo(8.283611, 2);
  });

  it("clamps nothing: highlights above white decode above 1.0", () => {
    for (const def of CAMERA_LOGS) expect(def.decode(1)).toBeGreaterThan(1);
  });
});

describe("shader parity", () => {
  // The shader expression is plain arithmetic plus pow / exp and ?:, so it evaluates as JavaScript.
  const evaluate = (id: CameraLogId): ((y: number) => number) =>
    new Function("pow", "exp", "y", `return ${cameraLogGlslExpression(id)};`).bind(null, Math.pow, Math.exp) as (y: number) => number;

  for (const def of CAMERA_LOGS) {
    it(`${def.label}: the GLSL source equals the TypeScript curve over the full signal range`, () => {
      const shader = evaluate(def.id);
      for (let i = 0; i <= 1023; i++) {
        const y = i / 1023;
        const expected = def.decode(y);
        expect(Math.abs(shader(y) - expected)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(expected) * 1e-9));
      }
    });
  }

  it("emits one GLSL function per curve and a dispatcher for transfer ids 4..12", () => {
    const glsl = cameraLogGlsl();
    for (const def of CAMERA_LOGS) {
      expect(glsl).toContain(`float camLog_${def.id}(float y)`);
      expect(glsl).toContain(`if (id == ${def.shaderId}) return`);
    }
    expect(CAMERA_LOGS.map((d) => d.shaderId)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Every numeric literal carries a decimal point or exponent (GLSL ES has no implicit int-to-float).
    expect(glsl.replace(/camLog_\w+|\bid == \d+|vec3|float|int/g, "")).not.toMatch(/(?<![\w.])\d+(?![\w.\d])/);
  });
});

describe("gamut matrices", () => {
  const rowSums = (m: readonly (readonly number[])[]) => m.map((r) => r[0] + r[1] + r[2]);

  it("every gamut conversion preserves white (rows sum to 1)", () => {
    for (const def of CAMERA_LOGS) {
      for (const s of rowSums(cameraGamutToBt709(def.gamut))) expect(s).toBeCloseTo(1, 5);
      for (const s of rowSums(cameraGamutToBt2020(def.gamut))) expect(s).toBeCloseTo(1, 5);
    }
  });

  it("matches the published S-Gamut3.Cine and ARRI Wide Gamut 3 to Rec.709 matrices", () => {
    const sony = cameraGamutToBt709("sgamut3cine");
    const sonyRef = [[1.6269474, -0.5401385, -0.0868089], [-0.1785403, 1.4179409, -0.2394006], [-0.0444361, -0.1959199, 1.240356]];
    const arri = cameraGamutToBt709("awg3");
    const arriRef = [[1.617523, -0.537287, -0.080237], [-0.070573, 1.334613, -0.26404], [-0.021102, -0.226954, 1.248056]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        expect(sony[r][c]).toBeCloseTo(sonyRef[r][c], 2);
        expect(arri[r][c]).toBeCloseTo(arriRef[r][c], 2);
      }
    }
  });

  it("Rec.2020 (Nikon, Fujifilm) converts with the standard Rec.2020 to Rec.709 matrix", () => {
    const m = cameraGamutToBt709("bt2020");
    const ref = [[1.660491, -0.587641, -0.072850], [-0.124550, 1.132900, -0.008349], [-0.018151, -0.100579, 1.118730]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(m[r][c]).toBeCloseTo(ref[r][c], 3);
  });
});

describe("camera presets in the colour pipeline", () => {
  it("offers one Camera input preset per curve and they are valid footage presets", () => {
    expect(CAMERA_FOOTAGE_COLOR_PRESETS).toHaveLength(9);
    for (const p of CAMERA_FOOTAGE_COLOR_PRESETS) {
      expect(isFootageColorPreset(p.id)).toBe(true);
      expect(needsInputTransform(p.space)).toBe(true);
    }
  });

  it("an interpretation override selects the input transform, and tags alone do not", () => {
    expect(inputSpaceForItem({ metadata: {}, colorInterpretation: "log-slog3" })?.transfer).toBe("slog3");
    expect(effectiveSourceColor({ metadata: {}, colorInterpretation: "log-logc4" }).primaries).toBe("awg4");
  });

  it("18% grey log footage lands on sRGB grey 18% (code 118) and stays neutral", () => {
    for (const def of CAMERA_LOGS) {
      const t = createInputTransform(CAMERA_FOOTAGE_COLOR_PRESETS.find((p) => p.camera?.logId === def.id)!.space)!;
      expect(t).not.toBeNull();
      // The 8-bit code nearest the published grey signal.
      const code = Math.round(def.grey18 * 255) / 255;
      const [r, g, b] = transformPixel(code, code, code, t);
      expect(Math.abs(r * 255 - 118)).toBeLessThan(3);
      expect(Math.abs(r - g)).toBeLessThan(0.01);
      expect(Math.abs(g - b)).toBeLessThan(0.01);
    }
  });

  it("black stays black and over-exposed log stays inside the display range", () => {
    const t = createInputTransform(CAMERA_FOOTAGE_COLOR_PRESETS[0].space)!;
    expect(transformPixel(0, 0, 0, t).every((v) => v < 0.02)).toBe(true);
    expect(transformPixel(1, 1, 1, t).every((v) => v <= 1)).toBe(true);
  });

  it("the HDR working-space decode (CPU reference of the shader path) uses the same curve and a BT.2020 matrix", () => {
    for (const def of CAMERA_LOGS) {
      const space = CAMERA_FOOTAGE_COLOR_PRESETS.find((p) => p.camera?.logId === def.id)!.space;
      const decode = hdrSourceDecode(space);
      expect(decode.transfer).toBe(def.shaderId);
      expect(decodeToWorkingLinear(0.5, decode.transfer)).toBeCloseTo(def.decode(0.5), 12);
      expect(cameraLogDef(def.id).gamut).toBe(space.primaries);
      for (const s of decode.toBt2020.map((r) => r[0] + r[1] + r[2])) expect(s).toBeCloseTo(1, 5);
    }
  });
});
