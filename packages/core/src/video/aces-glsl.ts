import { ACESCCT_WHITE, AP0_TO_AP1, AP1_RGB2Y, AP1_TO_AP0, AP1_TO_XYZ, D60_TO_D65, XYZ_TO_AP1, type AcesMatrix3 as Matrix3 } from "../color/aces";
import {
  HDR_1000_SPLINE,
  HDR_1000_Y_MAX,
  HDR_1000_Y_MIN,
  ODT_48_SPLINE,
  ODT_SAT_MAT,
  REC2020_TO_XYZ,
  RRT_SAT_MAT,
  RRT_SPLINE,
  XYZ_TO_REC2020,
  XYZ_TO_REC709,
  type SplineParams,
} from "../color/aces-output";

/**
 * GLSL ES 3.00 port of `color/aces.ts` (the CPU reference). Every constant is written from the same TypeScript values,
 * so the shader and the reference cannot drift apart; `apps/web/e2e/aces-color.spec.ts` holds the shader to the
 * reference on a GPU.
 *
 * Entry points (inputs and outputs are 0..1 signals, ACEScg linear in):
 *   vec3 acescctEncodeV(vec3 lin), vec3 acescctDecodeV(vec3 cct)
 *   vec3 acesOutputV(vec3 acescg, int output)   1 sRGB, 2 BT.1886 (Rec.709), 3 Rec.2020 PQ 1000 nit, 4 Rec.2020 HLG
 */

/** A GLSL float literal that always carries a decimal point or exponent. */
function glf(value: number): string {
  const text = value === 0 ? "0.0" : value.toPrecision(17).replace(/0+$/, "").replace(/\.$/, ".0");
  const normalised = String(Number(text));
  return /[.e]/i.test(normalised) ? normalised : `${normalised}.0`;
}

function glMat3(m: Matrix3): string {
  const v = (i: number, j: number) => glf(m[i][j]);
  return `mat3(${v(0, 0)}, ${v(1, 0)}, ${v(2, 0)}, ${v(0, 1)}, ${v(1, 1)}, ${v(2, 1)}, ${v(0, 2)}, ${v(1, 2)}, ${v(2, 2)})`;
}

function glArray(values: readonly number[]): string {
  return `float[${values.length}](${values.map(glf).join(", ")})`;
}

function splineFunction(name: string, p: SplineParams): string {
  const nLow = p.coefsLow.length - 2;
  const nHigh = p.coefsHigh.length - 2;
  const lMin = Math.log10(p.minX);
  const lMid = Math.log10(p.midX);
  const lMax = Math.log10(p.maxX);
  return `
float ${name}(float x) {
  float cLow[${p.coefsLow.length}] = ${glArray(p.coefsLow)};
  float cHigh[${p.coefsHigh.length}] = ${glArray(p.coefsHigh)};
  float logx = log10f(max(x, HALF_MIN));
  float logy;
  if (logx <= ${glf(lMin)}) {
    logy = logx * ${glf(p.slopeLow)} + ${glf(Math.log10(p.minY) - p.slopeLow * lMin)};
  } else if (logx < ${glf(lMid)}) {
    float coord = ${glf(nLow - 1)} * (logx - ${glf(lMin)}) / ${glf(lMid - lMin)};
    int j = int(coord);
    logy = bSplineQuad(cLow[j], cLow[j + 1], cLow[j + 2], coord - float(j));
  } else if (logx < ${glf(lMax)}) {
    float coord = ${glf(nHigh - 1)} * (logx - ${glf(lMid)}) / ${glf(lMax - lMid)};
    int j = int(coord);
    logy = bSplineQuad(cHigh[j], cHigh[j + 1], cHigh[j + 2], coord - float(j));
  } else {
    logy = logx * ${glf(p.slopeHigh)} + ${glf(Math.log10(p.maxY) - p.slopeHigh * lMax)};
  }
  return pow(10.0, logy);
}
`;
}

/** ACEScct encode / decode only: what the layer shader needs to grade in ACEScct and to decode ACEScct footage. */
export function acescctGlsl(): string {
  return `
const float ACESCCT_CUT_LIN = 0.0078125;
const float ACESCCT_CUT_LOG = 0.155251141552511;
const float ACESCCT_A = 10.5402377416545;
const float ACESCCT_B = 0.0729055341958355;
const float ACESCCT_WHITE = ${glf(ACESCCT_WHITE)};
float acescctEncode1(float l) {
  return l <= ACESCCT_CUT_LIN ? ACESCCT_A * l + ACESCCT_B : (log2(l) + 9.72) / 17.52;
}
float acescctDecode1(float c) {
  return c <= ACESCCT_CUT_LOG ? (c - ACESCCT_B) / ACESCCT_A : exp2(c * 17.52 - 9.72);
}
vec3 acescctEncodeV(vec3 l) { return vec3(acescctEncode1(l.r), acescctEncode1(l.g), acescctEncode1(l.b)); }
vec3 acescctDecodeV(vec3 c) { return vec3(acescctDecode1(c.r), acescctDecode1(c.g), acescctDecode1(c.b)); }
`;
}

/** The GLSL source of the Output Transform, to be placed after the COMMON block of the HDR shaders (it uses `pqEncodeNitsV`). */
export function acesGlsl(): string {
  return `
const float HALF_MIN = 5.96046448e-8;
const float HALF_MAX = 65504.0;
const mat3 ACES_AP0_TO_AP1 = ${glMat3(AP0_TO_AP1)};
const mat3 ACES_AP1_TO_AP0 = ${glMat3(AP1_TO_AP0)};
const mat3 ACES_AP1_TO_XYZ = ${glMat3(AP1_TO_XYZ)};
const mat3 ACES_XYZ_TO_AP1 = ${glMat3(XYZ_TO_AP1)};
const mat3 ACES_D60_TO_D65 = ${glMat3(D60_TO_D65)};
const mat3 ACES_XYZ_TO_REC709 = ${glMat3(XYZ_TO_REC709)};
const mat3 ACES_XYZ_TO_REC2020 = ${glMat3(XYZ_TO_REC2020)};
const mat3 ACES_REC2020_TO_XYZ = ${glMat3(REC2020_TO_XYZ)};
const mat3 ACES_RRT_SAT = ${glMat3(RRT_SAT_MAT)};
const mat3 ACES_ODT_SAT = ${glMat3(ODT_SAT_MAT)};
const vec3 ACES_AP1_Y = vec3(${AP1_RGB2Y.map(glf).join(", ")});

float log10f(float x) { return log(x) * 0.43429448190325176; }

float bSplineQuad(float c0, float c1, float c2, float t) {
  return (0.5 * c0 - c1 + 0.5 * c2) * t * t + (-c0 + c1) * t + 0.5 * c0 + 0.5 * c1;
}
${splineFunction("acesRrtSpline", RRT_SPLINE)}
${splineFunction("acesOdtSpline", ODT_48_SPLINE)}
${splineFunction("acesHdrSpline", HDR_1000_SPLINE)}

float acesSigmoid(float x) {
  float t = max(1.0 - abs(x / 2.0), 0.0);
  return (1.0 + sign(x) * (1.0 - t * t)) / 2.0;
}
float acesCubicBasis(float x, float w) {
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

vec3 acesRrtSweeteners(vec3 aces) {
  float mx = max(aces.r, max(aces.g, aces.b));
  float mn = min(aces.r, min(aces.g, aces.b));
  float saturation = (max(mx, 1e-10) - max(mn, 1e-10)) / max(mx, 1e-2);
  float chroma = sqrt(max(aces.b * (aces.b - aces.g) + aces.g * (aces.g - aces.r) + aces.r * (aces.r - aces.b), 0.0));
  float yc = (aces.b + aces.g + aces.r + 1.75 * chroma) / 3.0;
  float s = acesSigmoid((saturation - 0.4) / 0.2);
  float glowGain = ${glf(0.05)} * s;
  float glowMid = ${glf(0.08)};
  float glow = yc <= 2.0 / 3.0 * glowMid ? glowGain : (yc >= 2.0 * glowMid ? 0.0 : glowGain * (glowMid / yc - 0.5));
  aces *= 1.0 + glow;
  float weight = 0.0;
  if (!(aces.r == aces.g && aces.g == aces.b)) {
    float hue = degrees(atan(sqrt(3.0) * (aces.g - aces.b), 2.0 * aces.r - aces.g - aces.b));
    if (hue < 0.0) hue += 360.0;
    float centered = hue;
    if (centered > 180.0) centered -= 360.0;
    weight = acesCubicBasis(centered, 135.0);
  }
  aces.r = aces.r + weight * saturation * (0.03 - aces.r) * (1.0 - 0.82);
  aces = clamp(aces, 0.0, HALF_MAX);
  vec3 rgbPre = clamp(ACES_AP0_TO_AP1 * aces, 0.0, HALF_MAX);
  return ACES_RRT_SAT * rgbPre;
}

vec3 acesSrgbOetf(vec3 y) {
  float yb = pow(0.055 * 2.4 / (1.4 * 1.055), 2.4);
  float rs = pow(1.4 / 0.055, 1.4) * pow(1.055 / 2.4, 2.4);
  return vec3(
    y.r >= yb ? 1.055 * pow(y.r, 1.0 / 2.4) - 0.055 : y.r * rs,
    y.g >= yb ? 1.055 * pow(y.g, 1.0 / 2.4) - 0.055 : y.g * rs,
    y.b >= yb ? 1.055 * pow(y.b, 1.0 / 2.4) - 0.055 : y.b * rs
  );
}

vec3 acesSdrXyz(vec3 ap0) {
  vec3 pre = acesRrtSweeteners(ap0);
  vec3 rrt = vec3(acesRrtSpline(pre.r), acesRrtSpline(pre.g), acesRrtSpline(pre.b));
  vec3 oces = ACES_AP1_TO_AP0 * rrt;
  vec3 rgbPre = ACES_AP0_TO_AP1 * oces;
  vec3 post = vec3(acesOdtSpline(rgbPre.r), acesOdtSpline(rgbPre.g), acesOdtSpline(rgbPre.b));
  vec3 lin = (post - ${glf(0.02)}) / ${glf(48 - 0.02)};
  vec3 xyz0 = ACES_AP1_TO_XYZ * lin;
  float sum = xyz0.x + xyz0.y + xyz0.z;
  if (sum == 0.0) sum = 1e-10;
  vec2 xy = xyz0.xy / sum;
  float Y = pow(clamp(xyz0.y, 0.0, HALF_MAX), 0.9811);
  float yy = max(xy.y, 1e-10);
  vec3 dim = ACES_XYZ_TO_AP1 * vec3(xy.x * Y / yy, Y, (1.0 - xy.x - xy.y) * Y / yy);
  vec3 sat = ACES_ODT_SAT * dim;
  vec3 xyz = ACES_D60_TO_D65 * (ACES_AP1_TO_XYZ * sat);
  return xyz;
}

vec3 acesSdrLinear(vec3 ap0) {
  return clamp(ACES_XYZ_TO_REC709 * acesSdrXyz(ap0), 0.0, 1.0);
}

vec3 acesSdrDisplay(vec3 ap0, bool srgb) {
  vec3 display = acesSdrLinear(ap0);
  return srgb ? acesSrgbOetf(display) : pow(display, vec3(1.0 / 2.4));
}

vec3 acesHdrXyz(vec3 ap0) {
  vec3 pre = acesRrtSweeteners(ap0);
  vec3 tone = vec3(acesHdrSpline(pre.r), acesHdrSpline(pre.g), acesHdrSpline(pre.b));
  vec3 lin = (tone - ${glf(HDR_1000_Y_MIN)}) / ${glf(HDR_1000_Y_MAX - HDR_1000_Y_MIN)};
  vec3 xyz = ACES_AP1_TO_XYZ * lin;
  vec3 limited = clamp(ACES_XYZ_TO_REC2020 * xyz, 0.0, 1.0);
  vec3 xyzLimited = ACES_REC2020_TO_XYZ * limited;
  return ACES_D60_TO_D65 * xyzLimited;
}

vec3 acesHdrNits(vec3 ap0) {
  return clamp(ACES_XYZ_TO_REC2020 * acesHdrXyz(ap0), 0.0, HALF_MAX) * ${glf(HDR_1000_Y_MAX)};
}

float acesHlgOetf1(float e) {
  return e <= 1.0 / 12.0 ? sqrt(3.0 * e) : 0.17883277 * log(12.0 * e - 0.28466892) + 0.55991073;
}

vec3 acesOutputV(vec3 acescg, int outId) {
  vec3 ap0 = ACES_AP1_TO_AP0 * acescg;
  if (outId <= 2) return acesSdrDisplay(ap0, outId == 1);
  vec3 nits = acesHdrNits(ap0);
  if (outId == 3) return pqEncodeNitsV(nits);
  float yd = dot(nits, vec3(0.2627, 0.678, 0.0593));
  if (yd <= 0.0) return vec3(0.0);
  float k = pow(yd / 1000.0, (1.0 - 1.2) / 1.2);
  vec3 scene = k * nits / 1000.0;
  return vec3(acesHlgOetf1(scene.r), acesHlgOetf1(scene.g), acesHlgOetf1(scene.b));
}
`;
}

/**
 * The Output Transform without the encodings (everything up to `acesHdrNits`): `acesSdrLinear(ap0)` and
 * `acesHdrNits(ap0)`, for the OCIO runtime, whose view transforms apply their own display encoding afterwards.
 */
export function acesGlslCore(): string {
  return acesGlsl().split("float acesHlgOetf1")[0];
}
