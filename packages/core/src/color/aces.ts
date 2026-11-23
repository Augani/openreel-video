/**
 * ACES colour management: analytic transforms, no LUT files and no OCIO runtime.
 *
 *   IDT   footage code values -> scene-linear in the source primaries (the existing camera-log / sRGB / Rec.709 /
 *         Rec.2020 / PQ / HLG decoders), source primaries -> AP1 with a Bradford adaptation to the ACES white
 *         (ACEScg, the working primaries of the pipeline). ACES2065-1 is AP0 = `AP1_TO_AP0 x ACEScg`.
 *   grade ACEScct (log, `acescctEncode`): the grading sliders run on this encoding in ACES mode.
 *   OT    Output Transform = RRT + ODT, ported from the ACES 1.3 CTL reference (github.com/ampas/aces-dev, tag v1.3):
 *           sRGB / Rec.709 (BT.1886)  `RRT.ctl` + `ODT.Academy.sRGB_100nits_dim.ctl` / `ODT.Academy.Rec709_100nits_dim.ctl`
 *                                     (segmented splines c5 and c9, dim surround, ODT saturation, D60 -> D65)
 *           Rec.2020 PQ, 1000 nit     `RRTODT.Academy.Rec2020_1000nits_15nits_ST2084.ctl` (single stage SSTS,
 *                                     `outputTransform` of ACESlib.OutputTransforms.ctl)
 *           Rec.2020 HLG              `RRTODT.Academy.Rec2020_1000nits_15nits_HLG.ctl` (the PQ result re-encoded to HLG
 *                                     for a 1000 nit display, BT.2100 / BT.2390 section 7)
 *
 * Units. Scene-linear 1.0 is the pipeline's "SDR reference white" (the unit of every other colour module here):
 * 18% grey is 0.18, a 90% card 0.9. ACES2065-1 / ACEScg code values are the same numbers, so sRGB white 1.0 enters
 * the RRT as ACES 1.0. SDR outputs return display-encoded 0..1; the PQ / HLG outputs return the 0..1 signal of a
 * 1000 nit mastering display.
 *
 * Matrices are computed from the published chromaticities (the CTL does the same) and pinned against the published
 * constants in `aces.test.ts`. Every function here is plain arithmetic on numbers so that the GLSL port
 * (`aces-glsl.ts`) and this reference can be held against each other pixel for pixel.
 *
 * Row-major matrices, column vectors: out = M x in.
 */

import { chromaticAdaptation, gamutDef, gamutToXyz, invert3x3, multiply3x3, type CameraGamutId, type GamutDef } from "./camera-log";

export type AcesMatrix3 = readonly [readonly number[], readonly number[], readonly number[]];
type Matrix3 = AcesMatrix3;

// -- primaries and matrices -----------------------------------------------------------------------------------

/** AP0 (ACES2065-1) and AP1 (ACEScg) chromaticities. */
export const AP0_PRIMARIES: GamutDef = /* @__PURE__ */ gamutDef("ap0");
export const AP1_PRIMARIES: GamutDef = /* @__PURE__ */ gamutDef("ap1");

export const AP0_TO_XYZ: Matrix3 = /* @__PURE__ */ gamutToXyz(AP0_PRIMARIES);
export const XYZ_TO_AP0: Matrix3 = /* @__PURE__ */ invert3x3(AP0_TO_XYZ);
export const AP1_TO_XYZ: Matrix3 = /* @__PURE__ */ gamutToXyz(AP1_PRIMARIES);
export const XYZ_TO_AP1: Matrix3 = /* @__PURE__ */ invert3x3(AP1_TO_XYZ);
export const AP0_TO_AP1: Matrix3 = /* @__PURE__ */ multiply3x3(XYZ_TO_AP1, AP0_TO_XYZ);
export const AP1_TO_AP0: Matrix3 = /* @__PURE__ */ multiply3x3(XYZ_TO_AP0, AP1_TO_XYZ);

const REC709_PRIMARIES = /* @__PURE__ */ gamutDef("rec709");

/** Bradford adaptation from the ACES white (D60-ish) to D65, applied to XYZ. */
export const D60_TO_D65: Matrix3 = /* @__PURE__ */ chromaticAdaptation(AP0_PRIMARIES.white, REC709_PRIMARIES.white);

/** Luminance weights of AP1 (the Y row of AP1 -> XYZ). */
export const AP1_RGB2Y: readonly [number, number, number] = [AP1_TO_XYZ[1][0], AP1_TO_XYZ[1][1], AP1_TO_XYZ[1][2]];

/** Linear light in a camera / standard gamut (D65 or its own white) to ACEScg (AP1), Bradford adapted to the ACES white. */
export function gamutToAp1(id: CameraGamutId | "rec709" | "p3"): Matrix3 {
  const g = gamutDef(id);
  return multiply3x3(XYZ_TO_AP1, multiply3x3(chromaticAdaptation(g.white, AP1_PRIMARIES.white), gamutToXyz(g)));
}

/** The same into ACES2065-1 (AP0). */
export function gamutToAp0(id: CameraGamutId | "rec709" | "p3"): Matrix3 {
  const g = gamutDef(id);
  return multiply3x3(XYZ_TO_AP0, multiply3x3(chromaticAdaptation(g.white, AP0_PRIMARIES.white), gamutToXyz(g)));
}

export function applyAcesMatrix(m: Matrix3, r: number, g: number, b: number): [number, number, number] {
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

// -- ACEScct / ACEScc (S-2016-001, S-2014-003) -----------------------------------------------------------------

const CCT_CUT_LIN = 0.0078125;
const CCT_CUT_LOG = 0.155251141552511;
const CCT_A = 10.5402377416545;
const CCT_B = 0.0729055341958355;

/** ACEScg (linear AP1) to ACEScct. */
export function acescctEncode(lin: number): number {
  return lin <= CCT_CUT_LIN ? CCT_A * lin + CCT_B : (Math.log2(lin) + 9.72) / 17.52;
}

/** ACEScct to ACEScg (linear AP1). */
export function acescctDecode(cct: number): number {
  return cct <= CCT_CUT_LOG ? (cct - CCT_B) / CCT_A : Math.pow(2, cct * 17.52 - 9.72);
}

/** ACEScct of scene-linear 1.0 (SDR white): where a positive vignette lifts towards in the grade. */
export const ACESCCT_WHITE = /* @__PURE__ */ acescctEncode(1);

/** ACEScc (S-2014-003), for completeness and the published-value tests. */
export function acesccEncode(lin: number): number {
  if (lin <= 0) return (Math.log2(Math.pow(2, -16)) + 9.72) / 17.52;
  if (lin < Math.pow(2, -15)) return (Math.log2(Math.pow(2, -16) + lin * 0.5) + 9.72) / 17.52;
  return (Math.log2(lin) + 9.72) / 17.52;
}

// -- output transform ids ----------------------------------------------------------------------------------------

export type AcesSdrOutput = "srgb" | "rec709";
export type AcesOutputId = AcesSdrOutput | "rec2020-pq" | "rec2020-hlg";

export const ACES_OUTPUT_IDS: readonly AcesOutputId[] = ["srgb", "rec709", "rec2020-pq", "rec2020-hlg"];

export function isAcesSdrOutput(value: unknown): value is AcesSdrOutput {
  return value === "srgb" || value === "rec709";
}

/** Colour primaries the signal of each output transform is in. */
export function acesOutputPrimaries(output: AcesOutputId): "bt709" | "bt2020" {
  return output === "srgb" || output === "rec709" ? "bt709" : "bt2020";
}

// -- project settings ----------------------------------------------------------------------------------------------

export type ColorManagementMode = "display-referred" | "aces" | "ocio";

export interface AcesSettings {
  readonly colorManagement?: ColorManagementMode;
  readonly acesOutput?: AcesSdrOutput;
}

export function isAcesMode(settings: AcesSettings | undefined): boolean {
  return settings?.colorManagement === "aces";
}

/** The SDR output transform of the monitor and of SDR exports (sRGB unless the project says Rec.709). */
export function acesSdrOutputOf(settings: AcesSettings | undefined): AcesSdrOutput {
  return settings?.acesOutput === "rec709" ? "rec709" : "srgb";
}

/**
 * What an export renders to. An HDR10 export always uses the Rec.2020 PQ 1000 nit transform, HLG the HLG one; every
 * SDR export uses the project's SDR output transform.
 */
export function acesOutputForExport(settings: AcesSettings | undefined, hdr: "pq" | "hlg" | undefined): AcesOutputId {
  if (hdr === "pq") return "rec2020-pq";
  if (hdr === "hlg") return "rec2020-hlg";
  return acesSdrOutputOf(settings);
}
