/**
 * Camera log input transforms: the published manufacturer log encodings and
 * wide gamuts, as formulas (no LUT files), for Sony S-Log3 / S-Gamut3.Cine,
 * Panasonic V-Log / V-Gamut, ARRI LogC3 / LogC4 (AWG3 / AWG4), Canon C-Log3 /
 * Cinema Gamut, Nikon N-Log (Rec.2020), Fujifilm F-Log and F-Log2 (Rec.2020)
 * and Blackmagic Film Gen5 / Wide Gamut.
 *
 * Each curve maps the normalised log signal (0..1, i.e. 10-bit code / 1023,
 * after the decoder's range handling) to SCENE-LINEAR reflectance where
 * 18% grey = 0.18 and a 90% white card = 0.9. That is the same unit the HDR
 * working space uses (1.0 = SDR reference white), so the CPU input transform,
 * the CPU HDR reference and the WebGL2 shader all share one definition: the
 * shader source below is generated from the same constants as the TypeScript
 * decoders, and `camera-log.test.ts` evaluates that shader source against the
 * TypeScript curves.
 *
 * Display rendering (log -> Rec.709) is done by the shared input transform:
 * gamut matrix to Rec.709 primaries, the shared highlight shoulder
 * (`toneMapLuminance`), then the sRGB OETF. It is a technical, exposure
 * neutral conversion, not a creative look: grey stays grey, 18% grey lands on
 * sRGB code 118, and nothing is added to contrast.
 *
 * Sources of the constants: Sony "Technical Summary for S-Gamut3.Cine/S-Log3",
 * Panasonic "V-Log/V-Gamut Reference Manual", ARRI "LogC3 curve" white paper
 * (EI 800) and "ARRI LogC4 Logarithmic Color Space Specification", Canon
 * "Canon Log 3 / Cinema Gamut" white paper, Nikon "N-Log Specification
 * Document", Fujifilm "F-Log / F-Log2 Data Sheet", Blackmagic Design
 * "Blackmagic Generation 5 Color Science".
 *
 * This module imports nothing so every colour module can depend on it.
 */

export type CameraLogId =
  | "slog3"
  | "vlog"
  | "logc3"
  | "logc4"
  | "clog3"
  | "nlog"
  | "flog"
  | "flog2"
  | "bmdfilm5";

export type CameraGamutId = "sgamut3cine" | "vgamut" | "awg3" | "awg4" | "cinemagamut" | "bt2020" | "bmdwg" | "ap0" | "ap1";

type Matrix3 = readonly [readonly number[], readonly number[], readonly number[]];

// -- constants -----------------------------------------------------------------------------------------------

const SLOG3_CUT = 171.2102946929 / 1023;

const VLOG = { cut1: 0.01, cut2: 0.181, b: 0.00873, c: 0.241514, d: 0.598206 } as const;

const LOGC3 = { cut: 0.010591, a: 5.555556, b: 0.052272, c: 0.24719, d: 0.385537, e: 5.367655, f: 0.092809 } as const;

const LOGC4_A = (2 ** 18 - 16) / 117.45;
const LOGC4_B = (1023 - 95) / 1023;
const LOGC4_C = 95 / 1023;
const LOGC4 = {
  a: LOGC4_A,
  b: LOGC4_B,
  c: LOGC4_C,
  s: (7 * Math.LN2 * 2 ** (7 - (14 * LOGC4_C) / LOGC4_B)) / (LOGC4_A * LOGC4_B),
  t: (2 ** (14 * (-LOGC4_C / LOGC4_B) + 6) - 64) / LOGC4_A,
} as const;

const CLOG3 = {
  lowCut: 0.04076162,
  highCut: 0.105357102,
  lowOffset: 0.07623209,
  lowSlope: 0.42889912,
  lowScale: 14.98325,
  midOffset: 0.073059361,
  midSlope: 2.3069815,
  highOffset: 0.069886632,
} as const;

const NLOG = { cut: 452 / 1023, scale: 650, offset: 0.0075, logBase: 619, logScale: 150 } as const;

const FLOG = { a: 0.555556, b: 0.009468, c: 0.344676, d: 0.790453, e: 8.735631, f: 0.092864, cut1: 0.00089, cut2: 0.100537775223865 } as const;
const FLOG2 = { a: 5.555556, b: 0.064829, c: 0.245281, d: 0.384316, e: 8.799461, f: 0.092864, cut1: 0.000889, cut2: 0.100686685370811 } as const;

const BMD_A = 0.08692876065491224;
const BMD_B = 0.005494072432257808;
const BMD_C = 0.5300133039991736;
const BMD_LIN_CUT = 0.005;
/** The linear toe is the tangent of the log segment at the cut, which fixes both of its constants. */
const BMD_D = BMD_A / (BMD_LIN_CUT + BMD_B);
const BMD_E = BMD_A * Math.log(BMD_LIN_CUT + BMD_B) + BMD_C - BMD_D * BMD_LIN_CUT;
const BMDFILM5 = { a: BMD_A, b: BMD_B, c: BMD_C, d: BMD_D, e: BMD_E, linCut: BMD_LIN_CUT, logCut: BMD_D * BMD_LIN_CUT + BMD_E } as const;

// -- curves: log signal -> scene linear ----------------------------------------------------------------------

const log10 = Math.log10;

function slog3Decode(y: number): number {
  return y >= SLOG3_CUT
    ? 10 ** ((y * 1023 - 420) / 261.5) * (0.18 + 0.01) - 0.01
    : ((y * 1023 - 95) * 0.01125) / (171.2102946929 - 95);
}
function slog3Encode(x: number): number {
  return x >= 0.01125 ? (420 + log10((x + 0.01) / (0.18 + 0.01)) * 261.5) / 1023 : ((x * (171.2102946929 - 95)) / 0.01125 + 95) / 1023;
}

function vlogDecode(y: number): number {
  return y < VLOG.cut2 ? (y - 0.125) / 5.6 : 10 ** ((y - VLOG.d) / VLOG.c) - VLOG.b;
}
function vlogEncode(x: number): number {
  return x < VLOG.cut1 ? 5.6 * x + 0.125 : VLOG.c * log10(x + VLOG.b) + VLOG.d;
}

function logc3Decode(y: number): number {
  return y > LOGC3.e * LOGC3.cut + LOGC3.f ? (10 ** ((y - LOGC3.d) / LOGC3.c) - LOGC3.b) / LOGC3.a : (y - LOGC3.f) / LOGC3.e;
}
function logc3Encode(x: number): number {
  return x > LOGC3.cut ? LOGC3.c * log10(LOGC3.a * x + LOGC3.b) + LOGC3.d : LOGC3.e * x + LOGC3.f;
}

function logc4Decode(y: number): number {
  return y >= 0 ? (2 ** ((14 * (y - LOGC4.c)) / LOGC4.b + 6) - 64) / LOGC4.a : y * LOGC4.s + LOGC4.t;
}
function logc4Encode(x: number): number {
  return x >= LOGC4.t ? ((Math.log2(LOGC4.a * x + 64) - 6) / 14) * LOGC4.b + LOGC4.c : (x - LOGC4.t) / LOGC4.s;
}

function clog3Decode(y: number): number {
  const k = CLOG3;
  if (y < k.lowCut) return -(10 ** ((k.lowOffset - y) / k.lowSlope) - 1) / k.lowScale;
  if (y <= k.highCut) return (y - k.midOffset) / k.midSlope;
  return (10 ** ((y - k.highOffset) / k.lowSlope) - 1) / k.lowScale;
}
function clog3Encode(x: number): number {
  const k = CLOG3;
  if (x < -0.014) return -k.lowSlope * log10(-x * k.lowScale + 1) + k.lowOffset;
  if (x <= 0.014) return k.midSlope * x + k.midOffset;
  return k.lowSlope * log10(x * k.lowScale + 1) + k.highOffset;
}

function nlogDecode(y: number): number {
  const code = y * 1023;
  return y < NLOG.cut ? (code / NLOG.scale) ** 3 - NLOG.offset : Math.exp((code - NLOG.logBase) / NLOG.logScale);
}
function nlogEncode(x: number): number {
  return (x < 0.328 ? NLOG.scale * Math.cbrt(x + NLOG.offset) : NLOG.logScale * Math.log(x) + NLOG.logBase) / 1023;
}

function makeFujiDecode(k: typeof FLOG | typeof FLOG2): (y: number) => number {
  return (y) => (y >= k.cut2 ? (10 ** ((y - k.d) / k.c) - k.b) / k.a : (y - k.f) / k.e);
}
function makeFujiEncode(k: typeof FLOG | typeof FLOG2): (x: number) => number {
  return (x) => (x >= k.cut1 ? k.c * log10(k.a * x + k.b) + k.d : k.e * x + k.f);
}

function bmdDecode(y: number): number {
  return y >= BMDFILM5.logCut ? Math.exp((y - BMDFILM5.c) / BMDFILM5.a) - BMDFILM5.b : (y - BMDFILM5.e) / BMDFILM5.d;
}
function bmdEncode(x: number): number {
  return x >= BMDFILM5.linCut ? BMDFILM5.a * Math.log(x + BMDFILM5.b) + BMDFILM5.c : BMDFILM5.d * x + BMDFILM5.e;
}

// -- shader source ---------------------------------------------------------------------------------------------

/** A GLSL float literal that always carries a decimal point or exponent. */
function glf(value: number): string {
  const text = String(value);
  return /[.e]/i.test(text) ? text : `${text}.0`;
}

const cube = (expr: string) => `((${expr})*(${expr})*(${expr}))`;

/**
 * Each curve as a single GLSL ES 3.00 float expression of `y` (the log
 * signal). Only `pow`, `exp`, `?:` and arithmetic are used, so the same text
 * is valid JavaScript once `pow` and `exp` are mapped: the unit test does that
 * to hold the shader to the TypeScript curve.
 */
const GLSL_EXPR: Record<CameraLogId, string> = {
  slog3: `y >= ${glf(SLOG3_CUT)} ? pow(10.0, (y * 1023.0 - 420.0) / 261.5) * 0.19 - 0.01 : (y * 1023.0 - 95.0) * 0.01125 / (171.2102946929 - 95.0)`,
  vlog: `y < ${glf(VLOG.cut2)} ? (y - 0.125) / 5.6 : pow(10.0, (y - ${glf(VLOG.d)}) / ${glf(VLOG.c)}) - ${glf(VLOG.b)}`,
  logc3: `y > ${glf(LOGC3.e * LOGC3.cut + LOGC3.f)} ? (pow(10.0, (y - ${glf(LOGC3.d)}) / ${glf(LOGC3.c)}) - ${glf(LOGC3.b)}) / ${glf(LOGC3.a)} : (y - ${glf(LOGC3.f)}) / ${glf(LOGC3.e)}`,
  logc4: `y >= 0.0 ? (pow(2.0, 14.0 * (y - ${glf(LOGC4.c)}) / ${glf(LOGC4.b)} + 6.0) - 64.0) / ${glf(LOGC4.a)} : y * ${glf(LOGC4.s)} + ${glf(LOGC4.t)}`,
  clog3: `y < ${glf(CLOG3.lowCut)} ? -(pow(10.0, (${glf(CLOG3.lowOffset)} - y) / ${glf(CLOG3.lowSlope)}) - 1.0) / ${glf(CLOG3.lowScale)} : y <= ${glf(CLOG3.highCut)} ? (y - ${glf(CLOG3.midOffset)}) / ${glf(CLOG3.midSlope)} : (pow(10.0, (y - ${glf(CLOG3.highOffset)}) / ${glf(CLOG3.lowSlope)}) - 1.0) / ${glf(CLOG3.lowScale)}`,
  nlog: `y < ${glf(NLOG.cut)} ? ${cube(`y * 1023.0 / ${glf(NLOG.scale)}`)} - ${glf(NLOG.offset)} : exp((y * 1023.0 - ${glf(NLOG.logBase)}) / ${glf(NLOG.logScale)})`,
  flog: `y >= ${glf(FLOG.cut2)} ? (pow(10.0, (y - ${glf(FLOG.d)}) / ${glf(FLOG.c)}) - ${glf(FLOG.b)}) / ${glf(FLOG.a)} : (y - ${glf(FLOG.f)}) / ${glf(FLOG.e)}`,
  flog2: `y >= ${glf(FLOG2.cut2)} ? (pow(10.0, (y - ${glf(FLOG2.d)}) / ${glf(FLOG2.c)}) - ${glf(FLOG2.b)}) / ${glf(FLOG2.a)} : (y - ${glf(FLOG2.f)}) / ${glf(FLOG2.e)}`,
  bmdfilm5: `y >= ${glf(BMDFILM5.logCut)} ? exp((y - ${glf(BMDFILM5.c)}) / ${glf(BMDFILM5.a)}) - ${glf(BMDFILM5.b)} : (y - ${glf(BMDFILM5.e)}) / ${glf(BMDFILM5.d)}`,
};

/** The single-expression GLSL body of a curve (a function of `y`), exposed for parity tests. */
export function cameraLogGlslExpression(id: CameraLogId): string {
  return GLSL_EXPR[id];
}

// -- gamuts ----------------------------------------------------------------------------------------------------

type XY = readonly [number, number];
export interface GamutDef {
  readonly r: XY;
  readonly g: XY;
  readonly b: XY;
  readonly white: XY;
}

const D65: XY = [0.3127, 0.329];

/** ACES white point (ST 2065-1), the white of AP0 and AP1. */
const ACES_WHITE: XY = [0.32168, 0.33767];

const GAMUTS: Record<CameraGamutId | "rec709" | "p3", GamutDef> = {
  rec709: { r: [0.64, 0.33], g: [0.3, 0.6], b: [0.15, 0.06], white: D65 },
  p3: { r: [0.68, 0.32], g: [0.265, 0.69], b: [0.15, 0.06], white: D65 },
  // ACES primaries (SMPTE ST 2065-1 AP0, S-2014-004 AP1). Used as footage spaces: ACES2065-1, ACEScg, ACEScct.
  ap0: { r: [0.7347, 0.2653], g: [0, 1], b: [0.0001, -0.077], white: ACES_WHITE },
  ap1: { r: [0.713, 0.293], g: [0.165, 0.83], b: [0.128, 0.044], white: ACES_WHITE },
  bt2020: { r: [0.708, 0.292], g: [0.17, 0.797], b: [0.131, 0.046], white: D65 },
  sgamut3cine: { r: [0.766, 0.275], g: [0.225, 0.8], b: [0.089, -0.087], white: D65 },
  vgamut: { r: [0.73, 0.28], g: [0.165, 0.84], b: [0.1, -0.03], white: D65 },
  awg3: { r: [0.684, 0.313], g: [0.221, 0.848], b: [0.0861, -0.102], white: D65 },
  awg4: { r: [0.7347, 0.2653], g: [0.1424, 0.8576], b: [0.0991, -0.0308], white: D65 },
  cinemagamut: { r: [0.74, 0.27], g: [0.17, 1.14], b: [0.08, -0.1], white: D65 },
  bmdwg: { r: [0.7177215, 0.3171181], g: [0.228041, 0.861569], b: [0.1005841, -0.0825512], white: [0.312717, 0.3290312] },
};

/** Chromaticities of a camera / ACES gamut (or "rec709" / "p3"), for the ACES input transforms. */
export function gamutDef(id: CameraGamutId | "rec709" | "p3"): GamutDef {
  return GAMUTS[id];
}

export { mul3 as multiply3x3, inv3 as invert3x3, rgbToXyz as gamutToXyz, adaptation as chromaticAdaptation };

function mul3(a: Matrix3, b: Matrix3): Matrix3 {
  const out = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
  return out as unknown as Matrix3;
}

function inv3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

const xyzOf = ([x, y]: XY): [number, number, number] => [x / y, 1, (1 - x - y) / y];

/** Linear RGB (the gamut's own primaries and white) to CIE XYZ. */
function rgbToXyz(g: GamutDef): Matrix3 {
  const cols = [xyzOf(g.r), xyzOf(g.g), xyzOf(g.b)];
  const prim: Matrix3 = [
    [cols[0][0], cols[1][0], cols[2][0]],
    [cols[0][1], cols[1][1], cols[2][1]],
    [cols[0][2], cols[1][2], cols[2][2]],
  ];
  const w = xyzOf(g.white);
  const inverse = inv3(prim);
  const s = [0, 1, 2].map((i) => inverse[i][0] * w[0] + inverse[i][1] * w[1] + inverse[i][2] * w[2]);
  return [
    [prim[0][0] * s[0], prim[0][1] * s[1], prim[0][2] * s[2]],
    [prim[1][0] * s[0], prim[1][1] * s[1], prim[1][2] * s[2]],
    [prim[2][0] * s[0], prim[2][1] * s[1], prim[2][2] * s[2]],
  ];
}

const BRADFORD: Matrix3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

/** Bradford chromatic adaptation from one white to another (identity when they match). */
function adaptation(from: XY, to: XY): Matrix3 {
  if (from[0] === to[0] && from[1] === to[1]) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const src = xyzOf(from);
  const dst = xyzOf(to);
  const cs = [0, 1, 2].map((i) => BRADFORD[i][0] * src[0] + BRADFORD[i][1] * src[1] + BRADFORD[i][2] * src[2]);
  const cd = [0, 1, 2].map((i) => BRADFORD[i][0] * dst[0] + BRADFORD[i][1] * dst[1] + BRADFORD[i][2] * dst[2]);
  const scale: Matrix3 = [[cd[0] / cs[0], 0, 0], [0, cd[1] / cs[1], 0], [0, 0, cd[2] / cs[2]]];
  return mul3(inv3(BRADFORD), mul3(scale, BRADFORD));
}

/** Linear light in `from` primaries to linear light in `to` primaries, both viewed under D65. */
export function gamutConversion(from: CameraGamutId | "rec709" | "p3", to: CameraGamutId | "rec709" | "p3"): Matrix3 {
  const f = GAMUTS[from];
  const t = GAMUTS[to];
  return mul3(inv3(rgbToXyz({ ...t, white: D65 })), mul3(adaptation(f.white, D65), rgbToXyz(f)));
}

const conversionCache = new Map<string, Matrix3>();
function cachedConversion(from: CameraGamutId, to: "rec709" | "bt2020"): Matrix3 {
  const key = `${from}>${to}`;
  let m = conversionCache.get(key);
  if (!m) {
    m = gamutConversion(from, to);
    conversionCache.set(key, m);
  }
  return m;
}

/** Linear camera gamut to linear Rec.709 primaries. */
export function cameraGamutToBt709(gamut: CameraGamutId): Matrix3 {
  return cachedConversion(gamut, "rec709");
}

/** Linear camera gamut to linear Rec.2020 primaries (HDR working space). */
export function cameraGamutToBt2020(gamut: CameraGamutId): Matrix3 {
  return cachedConversion(gamut, "bt2020");
}

// -- registry --------------------------------------------------------------------------------------------------

export interface CameraLogDef {
  readonly id: CameraLogId;
  readonly maker: string;
  /** Picker label, e.g. "Sony S-Log3 / S-Gamut3.Cine". */
  readonly label: string;
  readonly gamut: CameraGamutId;
  /** Shader transfer id (hdr-working's HdrTransferId space; 0..3 are sRGB, PQ, HLG, linear). */
  readonly shaderId: number;
  /** Published 18% grey signal (0..1), the anchor the tests check. */
  readonly grey18: number;
  decode(signal: number): number;
  encode(linear: number): number;
}

export const CAMERA_LOGS: readonly CameraLogDef[] = [
  { id: "slog3", maker: "Sony", label: "Sony S-Log3 / S-Gamut3.Cine", gamut: "sgamut3cine", shaderId: 4, grey18: 420 / 1023, decode: slog3Decode, encode: slog3Encode },
  { id: "vlog", maker: "Panasonic", label: "Panasonic V-Log / V-Gamut", gamut: "vgamut", shaderId: 5, grey18: 0.423311, decode: vlogDecode, encode: vlogEncode },
  { id: "logc3", maker: "ARRI", label: "ARRI LogC3 (EI 800) / AWG3", gamut: "awg3", shaderId: 6, grey18: 0.391007, decode: logc3Decode, encode: logc3Encode },
  { id: "logc4", maker: "ARRI", label: "ARRI LogC4 / AWG4", gamut: "awg4", shaderId: 7, grey18: 0.278396, decode: logc4Decode, encode: logc4Encode },
  { id: "clog3", maker: "Canon", label: "Canon C-Log3 / Cinema Gamut", gamut: "cinemagamut", shaderId: 8, grey18: 0.313437, decode: clog3Decode, encode: clog3Encode },
  { id: "nlog", maker: "Nikon", label: "Nikon N-Log / Rec.2020", gamut: "bt2020", shaderId: 9, grey18: 0.363667, decode: nlogDecode, encode: nlogEncode },
  { id: "flog", maker: "Fujifilm", label: "Fujifilm F-Log / Rec.2020", gamut: "bt2020", shaderId: 10, grey18: 0.459319, decode: makeFujiDecode(FLOG), encode: makeFujiEncode(FLOG) },
  { id: "flog2", maker: "Fujifilm", label: "Fujifilm F-Log2 / Rec.2020", gamut: "bt2020", shaderId: 11, grey18: 0.391007, decode: makeFujiDecode(FLOG2), encode: makeFujiEncode(FLOG2) },
  { id: "bmdfilm5", maker: "Blackmagic", label: "Blackmagic Film Gen5 / Wide Gamut", gamut: "bmdwg", shaderId: 12, grey18: 0.383566, decode: bmdDecode, encode: bmdEncode },
];

const BY_ID = new Map<string, CameraLogDef>(CAMERA_LOGS.map((d) => [d.id, d]));

export function isCameraLogId(value: unknown): value is CameraLogId {
  return typeof value === "string" && BY_ID.has(value);
}

export function cameraLogDef(id: CameraLogId): CameraLogDef {
  return BY_ID.get(id)!;
}

/** Log signal 0..1 to scene-linear (0.18 = 18% grey). */
export function decodeCameraLog(signal: number, id: CameraLogId): number {
  return BY_ID.get(id)!.decode(signal);
}

/** Scene-linear to log signal; the inverse of `decodeCameraLog`. */
export function encodeCameraLog(linear: number, id: CameraLogId): number {
  return BY_ID.get(id)!.encode(linear);
}

/** Camera log whose shader transfer id this is, or undefined for the sRGB / PQ / HLG / linear ids. */
export function cameraLogForShaderId(shaderId: number): CameraLogDef | undefined {
  return CAMERA_LOGS.find((d) => d.shaderId === shaderId);
}

/**
 * GLSL ES 3.00 for the shader decode: `decodeCameraLog(vec3 c, int id)` returns
 * scene-linear in the camera gamut for transfer ids 4..12.
 */
export function cameraLogGlsl(): string {
  const fns = CAMERA_LOGS.map((d) => `float camLog_${d.id}(float y) { return ${GLSL_EXPR[d.id]}; }`).join("\n");
  const cases = CAMERA_LOGS.map((d) => `  if (id == ${d.shaderId}) return vec3(camLog_${d.id}(c.r), camLog_${d.id}(c.g), camLog_${d.id}(c.b));`).join("\n");
  return `${fns}
vec3 decodeCameraLog(vec3 c, int id) {
  c = clamp(c, 0.0, 1.0);
${cases}
  return c;
}
`;
}
