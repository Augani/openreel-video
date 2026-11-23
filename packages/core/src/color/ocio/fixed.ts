import { registerFixed, type FixedStyle } from "./ops";

/**
 * OCIO FixedFunctionTransform styles: ACES 0.3 / 1.0 red modifier and glow, dark-to-dim surround, ACES 1.3 reference
 * gamut compression, Rec.2100 surround, and the XYZ -> xyY / uvY / Luv conversions. Each has a CPU form here and the same
 * arithmetic as GLSL in `fixedGlsl`, written side by side so the two stay in step.
 */

// -- ACES helpers (ACESlib.Utilities_Color.ctl, as OCIO implements them) -----------------------------------------------------

const AP1_TO_XYZ = [
  0.6624541811, 0.1340042065, 0.1561876870,
  0.2722287168, 0.6740817658, 0.0536895174,
  -0.0055746495, 0.0040607335, 1.0103391003,
];
const XYZ_TO_AP1 = [
  1.6410233797, -0.3248032942, -0.2364246952,
  -0.6636628587, 1.6153315917, 0.0167563477,
  0.0117218943, -0.0082844420, 0.9883948585,
];

function sigmoidShaper(x: number): number {
  const t = Math.max(1 - Math.abs(x / 2), 0);
  const y = 1 + Math.sign(x) * (1 - t * t);
  return y / 2;
}

function cubicBasisShaper(x: number, w: number): number {
  const knots0 = -w / 2;
  const knots4 = w / 2;
  let y = 0;
  if (x > knots0 && x < knots4) {
    const coord = ((x - knots0) * 4) / w;
    const j = Math.floor(coord);
    const t = coord - j;
    const t2 = t * t;
    const t3 = t2 * t;
    if (j === 3) y = t3 * (-1 / 6) + t2 * (3 / 6) + t * (-3 / 6) + 1 / 6;
    else if (j === 2) y = t3 * (3 / 6) + t2 * (-6 / 6) + 4 / 6;
    else if (j === 1) y = t3 * (-3 / 6) + t2 * (3 / 6) + t * (3 / 6) + 1 / 6;
    else if (j === 0) y = t3 * (1 / 6);
  }
  return (y * 3) / 2;
}

function rgbToSaturation(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return (Math.max(mx, 1e-10) - Math.max(mn, 1e-10)) / Math.max(mx, 1e-2);
}

function rgbToHue(r: number, g: number, b: number): number {
  if (r === g && g === b) return 0;
  let hue = (180 / Math.PI) * Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
  if (hue < 0) hue += 360;
  return hue;
}

function rgbToYc(r: number, g: number, b: number, radius = 1.75): number {
  const chroma = Math.sqrt(Math.max(b * (b - g) + g * (g - r) + r * (r - b), 0));
  return (b + g + r + radius * chroma) / 3;
}

function centerHue(hue: number, centerH: number): number {
  let h = hue - centerH;
  if (h < -180) h += 360;
  else if (h > 180) h -= 360;
  return h;
}

interface RedModConsts {
  readonly scale: number;
  readonly pivot: number;
  readonly width: number;
}
const RED_10: RedModConsts = { scale: 0.82, pivot: 0.03, width: 135 };

function redMod(c: number[], k: RedModConsts, inv: boolean): void {
  const [r, g, b] = c;
  const hue = rgbToHue(r, g, b);
  const centered = centerHue(hue, 0);
  const w = cubicBasisShaper(centered, k.width);
  if (!inv) {
    const sat = rgbToSaturation(r, g, b);
    c[0] = r + w * sat * (k.pivot - r) * (1 - k.scale);
    return;
  }
  if (w === 0) return;
  const minChan = g < b ? g : b;
  const a = w * (1 - k.scale) - 1;
  const bb = r - w * (k.pivot + minChan) * (1 - k.scale);
  const cc = w * k.pivot * minChan * (1 - k.scale);
  c[0] = (-bb - Math.sqrt(bb * bb - 4 * a * cc)) / (2 * a);
}

function glowFwd(ycIn: number, gain: number, mid: number): number {
  if (ycIn <= (2 / 3) * mid) return gain;
  if (ycIn >= 2 * mid) return 0;
  return gain * (mid / ycIn - 1 / 2);
}

function glowInv(ycOut: number, gain: number, mid: number): number {
  if (ycOut <= (1 + gain) * (2 / 3) * mid) return -gain / (1 + gain);
  if (ycOut >= 2 * mid) return 0;
  return (gain * (mid / ycOut - 1 / 2)) / (gain / 2 - 1);
}

interface GlowConsts {
  readonly gain: number;
  readonly mid: number;
}
const GLOW_03: GlowConsts = { gain: 0.075, mid: 0.1 };
const GLOW_10: GlowConsts = { gain: 0.05, mid: 0.08 };

function glow(c: number[], k: GlowConsts, inv: boolean): void {
  const [r, g, b] = c;
  const yc = rgbToYc(r, g, b);
  const sat = rgbToSaturation(r, g, b);
  const s = sigmoidShaper((sat - 0.4) / 0.2);
  const added = inv ? 1 + glowInv(yc, k.gain * s, k.mid) : 1 + glowFwd(yc, k.gain * s, k.mid);
  c[0] = r * added;
  c[1] = g * added;
  c[2] = b * added;
}

const DIM_GAMMA = 0.9811;

function darkToDim(c: number[], inv: boolean): void {
  const [r, g, b] = c;
  const X = AP1_TO_XYZ[0] * r + AP1_TO_XYZ[1] * g + AP1_TO_XYZ[2] * b;
  const Y0 = AP1_TO_XYZ[3] * r + AP1_TO_XYZ[4] * g + AP1_TO_XYZ[5] * b;
  const Z = AP1_TO_XYZ[6] * r + AP1_TO_XYZ[7] * g + AP1_TO_XYZ[8] * b;
  let sum = X + Y0 + Z;
  if (sum === 0) sum = 1e-10;
  const x = X / sum;
  const y = Y0 / sum;
  const Y = Math.pow(Math.min(Math.max(Y0, 0), 65504), inv ? 1 / DIM_GAMMA : DIM_GAMMA);
  const yy = Math.max(y, 1e-10);
  const X2 = (x * Y) / yy;
  const Z2 = ((1 - x - y) * Y) / yy;
  c[0] = XYZ_TO_AP1[0] * X2 + XYZ_TO_AP1[1] * Y + XYZ_TO_AP1[2] * Z2;
  c[1] = XYZ_TO_AP1[3] * X2 + XYZ_TO_AP1[4] * Y + XYZ_TO_AP1[5] * Z2;
  c[2] = XYZ_TO_AP1[6] * X2 + XYZ_TO_AP1[7] * Y + XYZ_TO_AP1[8] * Z2;
}

function rec2100Surround(c: number[], gamma: number, inv: boolean): void {
  const Y = Math.max(1e-4, 0.2627 * c[0] + 0.678 * c[1] + 0.0593 * c[2]);
  const f = Math.pow(Y, (inv ? 1 / gamma : gamma) - 1);
  c[0] *= f;
  c[1] *= f;
  c[2] *= f;
}

function xyzToXyy(c: number[], inv: boolean): void {
  if (!inv) {
    const [X, Y, Z] = c;
    const d = X + Y + Z;
    const s = d === 0 ? 0 : 1 / d;
    c[0] = X * s;
    c[1] = Y * s;
    c[2] = Y;
    return;
  }
  const [x, y, Y] = c;
  const s = y === 0 ? 0 : Y / y;
  c[0] = x * s;
  c[1] = Y;
  c[2] = (1 - x - y) * s;
}

function xyzToUvy(c: number[], inv: boolean): void {
  if (!inv) {
    const [X, Y, Z] = c;
    const d = X + 15 * Y + 3 * Z;
    const s = d === 0 ? 0 : 1 / d;
    c[0] = 4 * X * s;
    c[1] = 9 * Y * s;
    c[2] = Y;
    return;
  }
  const [u, v, Y] = c;
  const s = v === 0 ? 0 : Y / v;
  c[0] = (9 * u * s) / 4;
  c[1] = Y;
  c[2] = (s * (12 - 3 * u - 20 * v)) / 4;
}

const LUV_UN = 0.19783;
const LUV_VN = 0.46832;
const LUV_EPS = 216 / 24389;
const LUV_KAPPA = 24389 / 27;

function xyzToLuv(c: number[], inv: boolean): void {
  if (!inv) {
    const [X, Y, Z] = c;
    const d = X + 15 * Y + 3 * Z;
    const s = d === 0 ? 0 : 1 / d;
    const u = 4 * X * s;
    const v = 9 * Y * s;
    const L = Y <= LUV_EPS ? LUV_KAPPA * Y : 116 * Math.cbrt(Y) - 16;
    c[0] = L / 100;
    c[1] = (13 * L * (u - LUV_UN)) / 100;
    c[2] = (13 * L * (v - LUV_VN)) / 100;
    return;
  }
  const L = c[0] * 100;
  const Y = L <= 8 ? L / LUV_KAPPA : Math.pow((L + 16) / 116, 3);
  const u = L === 0 ? LUV_UN : (c[1] * 100) / (13 * L) + LUV_UN;
  const v = L === 0 ? LUV_VN : (c[2] * 100) / (13 * L) + LUV_VN;
  const d = 4 * v;
  c[0] = d === 0 ? 0 : (Y * 9 * u) / d;
  c[1] = Y;
  c[2] = d === 0 ? 0 : (Y * (12 - 3 * u - 20 * v)) / d;
}

function gamutCompressDist(dist: number, lim: number, thr: number, pwr: number, inv: boolean): number {
  if (dist < thr) return dist;
  const scl = (lim - thr) / Math.pow(Math.pow((1 - thr) / (lim - thr), -pwr) - 1, 1 / pwr);
  if (!inv) {
    const nd = (dist - thr) / scl;
    return thr + (scl * nd) / Math.pow(1 + Math.pow(nd, pwr), 1 / pwr);
  }
  if (dist > thr + scl) return dist;
  const p = Math.pow((dist - thr) / scl, pwr);
  return thr + scl * Math.pow(-(p / (p - 1)), 1 / pwr);
}

function gamutComp13(c: number[], params: readonly number[], inv: boolean): void {
  const lim = [params[0], params[1], params[2]];
  const thr = [params[3], params[4], params[5]];
  const pwr = params[6];
  const ach = Math.max(c[0], c[1], c[2]);
  const absAch = Math.abs(ach);
  for (let i = 0; i < 3; i++) {
    const dist = ach === 0 ? 0 : (ach - c[i]) / absAch;
    c[i] = ach - gamutCompressDist(dist, lim[i], thr[i], pwr, inv) * absAch;
  }
}

let registered = false;

/** Registers the CPU forms with the op evaluator (idempotent). */
export function registerFixedFunctions(): void {
  if (registered) return;
  registered = true;
  registerFixed("ACES_RedMod10", (c, _p, inv) => redMod(c, RED_10, inv));
  registerFixed("ACES_Glow03", (c, _p, inv) => glow(c, GLOW_03, inv));
  registerFixed("ACES_Glow10", (c, _p, inv) => glow(c, GLOW_10, inv));
  registerFixed("ACES_DarkToDim10", (c, _p, inv) => darkToDim(c, inv));
  registerFixed("REC2100_Surround", (c, p, inv) => rec2100Surround(c, p[0] ?? 1, inv));
  registerFixed("XYZ_TO_xyY", (c, _p, inv) => xyzToXyy(c, inv));
  registerFixed("XYZ_TO_uvY", (c, _p, inv) => xyzToUvy(c, inv));
  registerFixed("XYZ_TO_LUV", (c, _p, inv) => xyzToLuv(c, inv));
  registerFixed("ACES_GamutComp13", (c, p, inv) => gamutComp13(c, p, inv));
}

export const IMPLEMENTED_FIXED: readonly FixedStyle[] = [
  "ACES_RedMod10",
  "ACES_Glow03",
  "ACES_Glow10",
  "ACES_DarkToDim10",
  "REC2100_Surround",
  "XYZ_TO_xyY",
  "XYZ_TO_uvY",
  "XYZ_TO_LUV",
  "ACES_GamutComp13",
];

// -- GLSL ------------------------------------------------------------------------------------------------------------------------

function glf(v: number): string {
  if (v === 0) return "0.0";
  const s = String(Number(v.toPrecision(17)));
  return /[.e]/i.test(s) ? s : `${s}.0`;
}

const FIXED_LIB = `
float ocioSigmoid(float x) { float t = max(1.0 - abs(x / 2.0), 0.0); return (1.0 + sign(x) * (1.0 - t * t)) / 2.0; }
float ocioCubicBasis(float x, float w) {
  float y = 0.0;
  if (x > -w / 2.0 && x < w / 2.0) {
    float coord = (x + w / 2.0) * 4.0 / w;
    int j = int(coord);
    float t = coord - float(j);
    float t2 = t * t;
    float t3 = t2 * t;
    if (j == 3) y = t3 * (-1.0 / 6.0) + t2 * (3.0 / 6.0) + t * (-3.0 / 6.0) + 1.0 / 6.0;
    else if (j == 2) y = t3 * (3.0 / 6.0) + t2 * (-6.0 / 6.0) + 4.0 / 6.0;
    else if (j == 1) y = t3 * (-3.0 / 6.0) + t2 * (3.0 / 6.0) + t * (3.0 / 6.0) + 1.0 / 6.0;
    else if (j == 0) y = t3 * (1.0 / 6.0);
  }
  return y * 3.0 / 2.0;
}
float ocioSaturation(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  return (max(mx, 1e-10) - max(mn, 1e-10)) / max(mx, 1e-2);
}
float ocioHue(vec3 c) {
  if (c.r == c.g && c.g == c.b) return 0.0;
  float hue = degrees(atan(sqrt(3.0) * (c.g - c.b), 2.0 * c.r - c.g - c.b));
  if (hue < 0.0) hue += 360.0;
  return hue;
}
float ocioYc(vec3 c) {
  float chroma = sqrt(max(c.b * (c.b - c.g) + c.g * (c.g - c.r) + c.r * (c.r - c.b), 0.0));
  return (c.b + c.g + c.r + 1.75 * chroma) / 3.0;
}
vec3 ocioRedMod(vec3 c, float scale, float pivot, float width, bool inv) {
  float centered = ocioHue(c);
  if (centered > 180.0) centered -= 360.0;
  float w = ocioCubicBasis(centered, width);
  if (!inv) {
    c.r = c.r + w * ocioSaturation(c) * (pivot - c.r) * (1.0 - scale);
    return c;
  }
  if (w == 0.0) return c;
  float minChan = c.g < c.b ? c.g : c.b;
  float a = w * (1.0 - scale) - 1.0;
  float b = c.r - w * (pivot + minChan) * (1.0 - scale);
  float cc = w * pivot * minChan * (1.0 - scale);
  c.r = (-b - sqrt(b * b - 4.0 * a * cc)) / (2.0 * a);
  return c;
}
float ocioGlowFwd(float yc, float gain, float mid) {
  if (yc <= 2.0 / 3.0 * mid) return gain;
  if (yc >= 2.0 * mid) return 0.0;
  return gain * (mid / yc - 0.5);
}
float ocioGlowInv(float yc, float gain, float mid) {
  if (yc <= (1.0 + gain) * (2.0 / 3.0) * mid) return -gain / (1.0 + gain);
  if (yc >= 2.0 * mid) return 0.0;
  return gain * (mid / yc - 0.5) / (gain / 2.0 - 1.0);
}
vec3 ocioGlow(vec3 c, float gain, float mid, bool inv) {
  float s = ocioSigmoid((ocioSaturation(c) - 0.4) / 0.2);
  float yc = ocioYc(c);
  return c * (1.0 + (inv ? ocioGlowInv(yc, gain * s, mid) : ocioGlowFwd(yc, gain * s, mid)));
}
const mat3 OCIO_AP1_TO_XYZ = mat3(${[0, 3, 6, 1, 4, 7, 2, 5, 8].map((i) => glf(AP1_TO_XYZ[i])).join(", ")});
const mat3 OCIO_XYZ_TO_AP1 = mat3(${[0, 3, 6, 1, 4, 7, 2, 5, 8].map((i) => glf(XYZ_TO_AP1[i])).join(", ")});
vec3 ocioDarkToDim(vec3 c, bool inv) {
  vec3 xyz0 = OCIO_AP1_TO_XYZ * c;
  float sum = xyz0.x + xyz0.y + xyz0.z;
  if (sum == 0.0) sum = 1e-10;
  vec2 xy = xyz0.xy / sum;
  float Y = pow(clamp(xyz0.y, 0.0, 65504.0), inv ? 1.0 / ${glf(DIM_GAMMA)} : ${glf(DIM_GAMMA)});
  float yy = max(xy.y, 1e-10);
  return OCIO_XYZ_TO_AP1 * vec3(xy.x * Y / yy, Y, (1.0 - xy.x - xy.y) * Y / yy);
}
vec3 ocioSurround(vec3 c, float gamma, bool inv) {
  float Y = max(1e-4, 0.2627 * c.r + 0.678 * c.g + 0.0593 * c.b);
  return c * pow(Y, (inv ? 1.0 / gamma : gamma) - 1.0);
}
vec3 ocioXyy(vec3 c, bool inv) {
  if (!inv) { float d = c.x + c.y + c.z; float s = d == 0.0 ? 0.0 : 1.0 / d; return vec3(c.x * s, c.y * s, c.y); }
  float s = c.y == 0.0 ? 0.0 : c.z / c.y;
  return vec3(c.x * s, c.z, (1.0 - c.x - c.y) * s);
}
vec3 ocioUvy(vec3 c, bool inv) {
  if (!inv) { float d = c.x + 15.0 * c.y + 3.0 * c.z; float s = d == 0.0 ? 0.0 : 1.0 / d; return vec3(4.0 * c.x * s, 9.0 * c.y * s, c.y); }
  float s = c.y == 0.0 ? 0.0 : c.z / c.y;
  return vec3(9.0 * c.x * s / 4.0, c.z, s * (12.0 - 3.0 * c.x - 20.0 * c.y) / 4.0);
}
vec3 ocioLuv(vec3 c, bool inv) {
  const float UN = ${glf(LUV_UN)};
  const float VN = ${glf(LUV_VN)};
  const float EPS = ${glf(LUV_EPS)};
  const float KAPPA = ${glf(LUV_KAPPA)};
  if (!inv) {
    float d = c.x + 15.0 * c.y + 3.0 * c.z;
    float s = d == 0.0 ? 0.0 : 1.0 / d;
    float u = 4.0 * c.x * s;
    float v = 9.0 * c.y * s;
    float L = c.y <= EPS ? KAPPA * c.y : 116.0 * pow(c.y, 1.0 / 3.0) - 16.0;
    return vec3(L / 100.0, 13.0 * L * (u - UN) / 100.0, 13.0 * L * (v - VN) / 100.0);
  }
  float L = c.x * 100.0;
  float Y = L <= 8.0 ? L / KAPPA : pow((L + 16.0) / 116.0, 3.0);
  float u = L == 0.0 ? UN : c.y * 100.0 / (13.0 * L) + UN;
  float v = L == 0.0 ? VN : c.z * 100.0 / (13.0 * L) + VN;
  float d = 4.0 * v;
  return vec3(d == 0.0 ? 0.0 : Y * 9.0 * u / d, Y, d == 0.0 ? 0.0 : Y * (12.0 - 3.0 * u - 20.0 * v) / d);
}
float ocioGamutCompress(float dist, float lim, float thr, float pwr, bool inv) {
  if (dist < thr) return dist;
  float scl = (lim - thr) / pow(pow((1.0 - thr) / (lim - thr), -pwr) - 1.0, 1.0 / pwr);
  if (!inv) {
    float nd = (dist - thr) / scl;
    return thr + scl * nd / pow(1.0 + pow(nd, pwr), 1.0 / pwr);
  }
  if (dist > thr + scl) return dist;
  float p = pow((dist - thr) / scl, pwr);
  return thr + scl * pow(-(p / (p - 1.0)), 1.0 / pwr);
}
vec3 ocioGamutComp(vec3 c, vec3 lim, vec3 thr, float pwr, bool inv) {
  float ach = max(c.r, max(c.g, c.b));
  float absAch = abs(ach);
  vec3 dist = ach == 0.0 ? vec3(0.0) : (vec3(ach) - c) / absAch;
  return vec3(ach) - vec3(ocioGamutCompress(dist.x, lim.x, thr.x, pwr, inv), ocioGamutCompress(dist.y, lim.y, thr.y, pwr, inv), ocioGamutCompress(dist.z, lim.z, thr.z, pwr, inv)) * absAch;
}
`;

export function fixedLibGlsl(): string {
  return FIXED_LIB;
}

/** The GLSL call transforming `c`, or null when the style has no shader form. */
export function fixedCallGlsl(style: FixedStyle, params: readonly number[], inv: boolean): string | null {
  const b = inv ? "true" : "false";
  switch (style) {
    case "ACES_RedMod10":
      return `c = ocioRedMod(c, ${glf(RED_10.scale)}, ${glf(RED_10.pivot)}, ${glf(RED_10.width)}, ${b});`;
    case "ACES_Glow03":
      return `c = ocioGlow(c, ${glf(GLOW_03.gain)}, ${glf(GLOW_03.mid)}, ${b});`;
    case "ACES_Glow10":
      return `c = ocioGlow(c, ${glf(GLOW_10.gain)}, ${glf(GLOW_10.mid)}, ${b});`;
    case "ACES_DarkToDim10":
      return `c = ocioDarkToDim(c, ${b});`;
    case "REC2100_Surround":
      return `c = ocioSurround(c, ${glf(params[0] ?? 1)}, ${b});`;
    case "XYZ_TO_xyY":
      return `c = ocioXyy(c, ${b});`;
    case "XYZ_TO_uvY":
      return `c = ocioUvy(c, ${b});`;
    case "XYZ_TO_LUV":
      return `c = ocioLuv(c, ${b});`;
    case "ACES_GamutComp13":
      return `c = ocioGamutComp(c, vec3(${glf(params[0])}, ${glf(params[1])}, ${glf(params[2])}), vec3(${glf(params[3])}, ${glf(params[4])}, ${glf(params[5])}), ${glf(params[6])}, ${b});`;
    default:
      return null;
  }
}
