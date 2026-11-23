import {
  PQ_WORKING_WHITE,
  SCENE_HDR_PIPELINE,
  acesOutputForSpec,
  graphicsWhiteGain,
  overlayDecodeFor,
  type HdrColorPipeline,
  type HdrCompositor,
  type HdrFrame,
  type HdrGradeSpec,
  type HdrLayerDraw,
  type HdrOverlay8,
  type HdrSourceDecode,
  type SourceCodes,
} from "../color/hdr-working";
import type { OutputColorSpec } from "../export/color-output";
import { packRgbToRgba } from "../color/lut-tables";
import { HUE_CURVES_GLSL, HUE_CURVE_LUT_SIZE, packHueCurveLuts } from "./hue-curves";
import { BT2020_TO_BT709, TONE_MAP_KNEE } from "../color/input-transform";
import { cameraLogGlsl } from "../color/camera-log";
import { acescctGlsl, acesGlsl } from "./aces-glsl";
import { BLUR_MAX_HALF, GLOW_BRIGHTNESS, GLOW_CONTRAST, gaussianKernel, glowWeight, type HdrLayerEffect } from "../color/hdr-effects";

/**
 * WebGL2 half-float implementation of the scene-referred HDR compositor.
 *
 * The accumulation image is a pair of RGBA16F textures (ping-pong, so no float
 * blending extension is needed): every layer pass reads the previous image,
 * decodes its source (8-bit RGBA8 or exact 16-bit codes from RGBA16UI),
 * resamples in linear light, grades in a PQ working encoding, and writes the
 * "over" result. The output pass tone maps to an 8-bit SDR view or encodes PQ /
 * HLG into an RGBA32F target for read-back. The arithmetic mirrors
 * `CpuHdrCompositor` in color/hdr-working.ts, which is the reference.
 */

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const COMMON = `
const float PQ_M1 = 0.1593017578125;
const float PQ_M2 = 78.84375;
const float PQ_C1 = 0.8359375;
const float PQ_C2 = 18.8515625;
const float PQ_C3 = 18.6875;
const float SDR_WHITE_NITS = 203.0;
const float HLG_A = 0.17883277;
const float HLG_B = 0.28466892;
const float HLG_C = 0.55991073;
const float HLG_SDR_WHITE_SCENE = 0.2646;

vec3 pqEncodeNitsV(vec3 nits) {
  vec3 y = clamp(nits / 10000.0, 0.0, 1.0);
  vec3 p = pow(y, vec3(PQ_M1));
  return pow((PQ_C1 + PQ_C2 * p) / (1.0 + PQ_C3 * p), vec3(PQ_M2));
}
vec3 pqDecodeNitsV(vec3 signal) {
  vec3 e = pow(clamp(signal, 0.0, 1.0), vec3(1.0 / PQ_M2));
  vec3 y = pow(max(e - PQ_C1, 0.0) / (PQ_C2 - PQ_C3 * e), vec3(1.0 / PQ_M1));
  return y * 10000.0;
}
vec3 srgbEncodeV(vec3 l) {
  vec3 c = clamp(l, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 srgbDecodeV(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 hlgInverseV(vec3 s) {
  vec3 v = clamp(s, 0.0, 1.0);
  return mix((v * v) / 3.0, (exp((v - HLG_C) / HLG_A) + HLG_B) / 12.0, step(vec3(0.5), v));
}
float hlgOetf1(float e) {
  float v = clamp(e, 0.0, 1.0);
  return v <= 1.0 / 12.0 ? sqrt(3.0 * v) : HLG_A * log(12.0 * v - HLG_B) + HLG_C;
}
vec3 hlgOetfV(vec3 e) { return vec3(hlgOetf1(e.r), hlgOetf1(e.g), hlgOetf1(e.b)); }
// sRGB transfer extended above 1.0 (no clamp), for LUT domains and the glow bright-pass.
vec3 extSrgbEncodeV(vec3 l) {
  vec3 c = max(l, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 extSrgbDecodeV(vec3 s) {
  vec3 c = max(s, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 linearToPqWorking(vec3 l) { return pqEncodeNitsV(max(l, 0.0) * SDR_WHITE_NITS); }
vec3 pqWorkingToLinear(vec3 p) { return pqDecodeNitsV(p) / SDR_WHITE_NITS; }
`;

const SOURCE_DECODE = `
uniform sampler2D u_src8;
uniform usampler2D u_src16;
uniform int u_depth;
uniform int u_transfer;
uniform mat3 u_toBt2020;

${acescctGlsl()}
${cameraLogGlsl()}
vec3 decodeTransfer(vec3 c) {
  if (u_transfer == 13) return acescctDecodeV(c);
  if (u_transfer >= 4) return decodeCameraLog(c, u_transfer);
  if (u_transfer == 1) return pqDecodeNitsV(c) / SDR_WHITE_NITS;
  if (u_transfer == 2) return hlgInverseV(c) / HLG_SDR_WHITE_SCENE;
  if (u_transfer == 3) return c;
  return srgbDecodeV(c);
}

vec4 decodeCodes(ivec2 p) {
  vec4 raw = u_depth == 16 ? vec4(texelFetch(u_src16, p, 0)) / 65535.0 : texelFetch(u_src8, p, 0);
  return vec4(u_toBt2020 * decodeTransfer(raw.rgb), raw.a);
}
`;

const DECODE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
out vec4 outColor;
${COMMON}
${SOURCE_DECODE}
void main() {
  outColor = decodeCodes(ivec2(gl_FragCoord.xy));
}
`;

const EFFECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D u_in;
uniform sampler2D u_orig;
uniform int u_op;            // 0 blur horizontal, 1 blur vertical, 2 sharpen, 3 glow combine
uniform bool u_premulIn;
uniform bool u_premulOut;
uniform float u_sigma;
uniform int u_half;
uniform float u_norm;
uniform float u_sharpK;
uniform float u_glowW;
uniform vec3 u_tint;
const int MAX_HALF = ${BLUR_MAX_HALF};
${COMMON}

ivec2 clampTo(ivec2 p, ivec2 size) { return clamp(p, ivec2(0), size - 1); }

vec4 tapPremult(ivec2 p) {
  vec4 c = texelFetch(u_in, p, 0);
  if (!u_premulIn) c.rgb *= c.a;
  return c;
}

vec4 finish(vec4 c) {
  if (!u_premulOut) c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  return c;
}

void main() {
  ivec2 size = textureSize(u_in, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (u_op == 0 || u_op == 1) {
    ivec2 dir = u_op == 0 ? ivec2(1, 0) : ivec2(0, 1);
    vec4 sum = vec4(0.0);
    for (int i = -MAX_HALF; i <= MAX_HALF; i++) {
      if (i < -u_half || i > u_half) continue;
      float w = exp(-float(i * i) / (2.0 * u_sigma * u_sigma)) / u_norm;
      sum += tapPremult(clampTo(p + dir * i, size)) * w;
    }
    outColor = finish(sum);
    return;
  }
  if (u_op == 2) {
    vec4 centre = texelFetch(u_in, p, 0);
    vec3 pc = linearToPqWorking(centre.rgb);
    vec3 around = linearToPqWorking(texelFetch(u_in, clampTo(p + ivec2(0, -1), size), 0).rgb)
      + linearToPqWorking(texelFetch(u_in, clampTo(p + ivec2(0, 1), size), 0).rgb)
      + linearToPqWorking(texelFetch(u_in, clampTo(p + ivec2(-1, 0), size), 0).rgb)
      + linearToPqWorking(texelFetch(u_in, clampTo(p + ivec2(1, 0), size), 0).rgb);
    vec3 v = pc * (1.0 + 4.0 * u_sharpK) - u_sharpK * around;
    outColor = vec4(pqWorkingToLinear(clamp(v, 0.0, 1.0)), centre.a);
    return;
  }
  vec4 orig = texelFetch(u_orig, p, 0);
  vec4 blurred = texelFetch(u_in, p, 0);
  float a = orig.a;
  float alpha = a + (1.0 - a) * min(1.0, u_glowW * blurred.a);
  vec3 premult = orig.rgb * a;
  vec3 bright = max((extSrgbEncodeV(blurred.rgb) * ${GLOW_BRIGHTNESS.toFixed(2)} - 0.5) * ${GLOW_CONTRAST.toFixed(2)} + 0.5, 0.0);
  vec3 glow = extSrgbDecodeV(bright) * u_glowW * u_tint;
  vec3 lit = premult + glow * (1.0 - clamp(premult, 0.0, 1.0));
  // lit / alpha is already straight colour; the premultiplied-output helper must not divide by alpha a second time.
  outColor = vec4(alpha > 0.0 ? lit / alpha : vec3(0.0), alpha);
}
`;

const LAYER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp usampler2D;
out vec4 outColor;

uniform sampler2D u_acc;
uniform sampler2D u_srcF;
uniform sampler3D u_lut;
uniform sampler2D u_lutCurve;
uniform bool u_useLutCurve;
uniform float u_lutCurveSize;
uniform vec3 u_lutDomainMin;
uniform vec3 u_lutDomainMax;
uniform sampler2D u_toneCurve;
uniform sampler2D u_curves;
uniform bool u_solid;
uniform vec3 u_solidColor;
uniform float u_gain;
uniform bool u_useLut;
uniform float u_lutSize;
uniform int u_lutSpace;
uniform float u_lutIntensity;
uniform bool u_useHsl;
uniform float u_hslHue[8];
uniform float u_hslSat[8];
uniform float u_hslLum[8];
uniform bool u_useVignette;
uniform vec4 u_vig;
uniform vec3 u_m0;
uniform vec3 u_m1;
uniform vec4 u_rect;
uniform vec2 u_scale;
uniform vec2 u_srcSize;
uniform float u_opacity;
uniform float u_exposureGain;
uniform bool u_useGrade;
uniform bool u_useWB;
uniform vec3 u_wb;
uniform bool u_useTone;
uniform bool u_useWheels;
uniform bool u_useHue;
uniform bool u_useCurves;
uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform float u_shadowsLift;
uniform float u_midtonesGamma;
uniform float u_highlightsGain;
uniform bool u_gradeAces;
const float PQ_WORKING_WHITE = ${PQ_WORKING_WHITE.toFixed(8)};
${COMMON}
${SOURCE_DECODE}
${HUE_CURVES_GLSL}

vec4 fetchLinear(ivec2 p) {
  if (u_depth == 32) return texelFetch(u_srcF, p, 0);
  return decodeCodes(p);
}

float lutEncode1(float l) {
  l = max(l, 0.0);
  if (u_lutSpace == 1) return l;
  if (u_lutSpace == 2) return linearToPqWorking(vec3(l)).x;
  return extSrgbEncodeV(vec3(l)).x;
}

float lutDecode1(float s) {
  s = max(s, 0.0);
  if (u_lutSpace == 1) return s;
  if (u_lutSpace == 2) return pqWorkingToLinear(vec3(s)).x;
  return extSrgbDecodeV(vec3(s)).x;
}

vec3 lutTexel(ivec3 p) { return texelFetch(u_lut, p, 0).rgb; }

// Exact 1D per-channel curve (RGBA32F, one texel per entry), linearly interpolated over the file's domain.
vec3 sampleLutCurve(vec3 v) {
  float m = u_lutCurveSize - 1.0;
  vec3 t = clamp((v - u_lutDomainMin) / (u_lutDomainMax - u_lutDomainMin), 0.0, 1.0) * m;
  vec3 f0 = min(floor(t), vec3(m));
  vec3 fr = t - f0;
  ivec3 i0 = ivec3(f0);
  ivec3 i1 = min(i0 + ivec3(1), ivec3(int(m)));
  return vec3(
    mix(texelFetch(u_lutCurve, ivec2(i0.x, 0), 0).r, texelFetch(u_lutCurve, ivec2(i1.x, 0), 0).r, fr.x),
    mix(texelFetch(u_lutCurve, ivec2(i0.y, 0), 0).g, texelFetch(u_lutCurve, ivec2(i1.y, 0), 0).g, fr.y),
    mix(texelFetch(u_lutCurve, ivec2(i0.z, 0), 0).b, texelFetch(u_lutCurve, ivec2(i1.z, 0), 0).b, fr.z)
  );
}

vec3 sampleLut3d(vec3 c) {
  float m = u_lutSize - 1.0;
  vec3 idx = c * m;
  vec3 f0 = floor(idx);
  vec3 fr = idx - f0;
  ivec3 i0 = ivec3(f0);
  ivec3 i1 = min(i0 + ivec3(1), ivec3(int(m)));
  vec3 c000 = lutTexel(ivec3(i0.x, i0.y, i0.z));
  vec3 c100 = lutTexel(ivec3(i1.x, i0.y, i0.z));
  vec3 c010 = lutTexel(ivec3(i0.x, i1.y, i0.z));
  vec3 c110 = lutTexel(ivec3(i1.x, i1.y, i0.z));
  vec3 c001 = lutTexel(ivec3(i0.x, i0.y, i1.z));
  vec3 c101 = lutTexel(ivec3(i1.x, i0.y, i1.z));
  vec3 c011 = lutTexel(ivec3(i0.x, i1.y, i1.z));
  vec3 c111 = lutTexel(ivec3(i1.x, i1.y, i1.z));
  vec3 c00 = mix(c000, c100, fr.x);
  vec3 c10 = mix(c010, c110, fr.x);
  vec3 c01 = mix(c001, c101, fr.x);
  vec3 c11 = mix(c011, c111, fr.x);
  return mix(mix(c00, c10, fr.y), mix(c01, c11, fr.y), fr.z);
}

float vignetteWeight(vec2 n, float aspect) {
  float ellipse = length(n) / 1.41421356237;
  float circle = length(vec2(n.x * aspect, n.y)) / length(vec2(aspect, 1.0));
  float rect = max(abs(n.x), abs(n.y));
  float roundness = clamp(u_vig.z, -1.0, 1.0);
  float dist = roundness >= 0.0 ? ellipse + (circle - ellipse) * roundness : ellipse + (rect - ellipse) * -roundness;
  float midpoint = clamp(u_vig.y, 0.0, 1.0);
  float feather = clamp(u_vig.w, 0.0, 1.0);
  float edge0 = clamp(midpoint - feather * 0.5, 0.0, 1.0);
  float edge1 = max(edge0 + 0.001, midpoint + feather * 0.5);
  float t = clamp((dist - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float toneSample(float x) {
  float position = clamp(x, 0.0, 1.0) * 255.0;
  float lower = floor(position);
  float fraction = position - lower;
  int i0 = int(lower);
  int i1 = min(255, i0 + 1);
  float a = texelFetch(u_toneCurve, ivec2(i0, 0), 0).r;
  float b = texelFetch(u_toneCurve, ivec2(i1, 0), 0).r;
  return a + (b - a) * fraction;
}

float curveSample(int channel, float x) {
  float position = clamp(x, 0.0, 1.0) * 255.0;
  float lower = floor(position);
  float fraction = position - lower;
  int i0 = int(lower);
  int i1 = min(255, i0 + 1);
  float a = texelFetch(u_curves, ivec2(i0, 0), 0)[channel];
  float b = texelFetch(u_curves, ivec2(i1, 0), 0)[channel];
  return a + (b - a) * fraction;
}

// The grade's working encoding: ACEScct in the aces pipeline (negative light floored at 0), PQ otherwise.
vec3 gradeEnc(vec3 l) { return u_gradeAces ? acescctEncodeV(max(l, vec3(0.0))) : linearToPqWorking(l); }
vec3 gradeDec(vec3 p) { return u_gradeAces ? acescctDecodeV(p) : pqWorkingToLinear(p); }

vec3 gradeHdr(vec3 lin, vec2 srcPos) {
  lin *= u_exposureGain;
  vec3 p = gradeEnc(lin);
  if (u_useWB) p = clamp(p + u_wb, 0.0, 1.0);
  if (u_useTone) p = vec3(toneSample(p.r), toneSample(p.g), toneSample(p.b));
  if (u_useWheels) {
    float luma = dot(p, vec3(0.299, 0.587, 0.114));
    float shadowWeight = 1.0 - smoothstep(0.0, 0.5, luma);
    float highlightWeight = smoothstep(0.5, 1.0, luma);
    float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
    vec3 w = p;
    w += u_shadows * shadowWeight;
    w += u_midtones * midtoneWeight;
    w += u_highlights * highlightWeight;
    w += u_shadowsLift * shadowWeight;
    w = pow(max(w, vec3(0.0)), vec3(1.0 / u_midtonesGamma));
    w = w * (1.0 + (u_highlightsGain - 1.0) * highlightWeight);
    p = clamp(w, 0.0, 1.0);
  }
  if (u_useHue) p = applyHueCurves(p);
  if (u_useCurves) {
    p = vec3(
      curveSample(0, curveSample(1, p.r)),
      curveSample(0, curveSample(2, p.g)),
      curveSample(0, curveSample(3, p.b))
    );
  }
  if (u_useLut) {
    vec3 pl = gradeDec(p);
    vec3 e = vec3(lutEncode1(pl.r), lutEncode1(pl.g), lutEncode1(pl.b));
    vec3 cl = u_useLutCurve ? min(e, u_lutDomainMax) : min(e, vec3(1.0));
    vec3 mapped = u_useLutCurve ? sampleLutCurve(cl) : sampleLut3d(cl);
    vec3 outE = e + (mapped + (e - cl) - e) * u_lutIntensity;
    p = gradeEnc(vec3(lutDecode1(outE.r), lutDecode1(outE.g), lutDecode1(outE.b)));
  }
  if (u_useHsl) {
    vec3 hsl = hcRgb2Hsl(p);
    int band = int(floor(hsl.x * 8.0)) % 8;
    float h2 = hsl.x + u_hslHue[band];
    p = hcHsl2Rgb(vec3(h2 - floor(h2), clamp(hsl.y + u_hslSat[band], 0.0, 1.0), clamp(hsl.z + u_hslLum[band], 0.0, 1.0)));
  }
  if (u_useVignette) {
    float amount = clamp(u_vig.x, -1.0, 1.0);
    vec2 n = vec2(srcPos.x / u_srcSize.x * 2.0 - 1.0, srcPos.y / u_srcSize.y * 2.0 - 1.0);
    float w = vignetteWeight(n, u_srcSize.x / u_srcSize.y);
    if (w > 0.0) {
      if (amount < 0.0) p *= 1.0 + amount * w;
      else p += max(vec3(u_gradeAces ? ACESCCT_WHITE : PQ_WORKING_WHITE) - p, 0.0) * (amount * w);
    }
  }
  return gradeDec(p);
}

void main() {
  vec4 acc = texelFetch(u_acc, ivec2(gl_FragCoord.xy), 0);
  if (u_solid) {
    float sa = clamp(u_opacity, 0.0, 1.0);
    outColor = vec4(u_solidColor * sa + acc.rgb * (1.0 - sa), sa + acc.a * (1.0 - sa));
    return;
  }
  vec2 d = gl_FragCoord.xy;
  vec2 s = vec2(dot(u_m0, vec3(d, 1.0)), dot(u_m1, vec3(d, 1.0)));
  vec2 edge = min(s - u_rect.xy, u_rect.xy + u_rect.zw - s) * u_scale;
  float coverage = clamp(edge.x + 0.5, 0.0, 1.0) * clamp(edge.y + 0.5, 0.0, 1.0);
  if (coverage <= 0.0) { outColor = acc; return; }
  vec2 f = s - 0.5;
  vec2 base = floor(f);
  vec2 a = f - base;
  ivec2 lo = ivec2(floor(u_rect.xy));
  ivec2 hi = ivec2(floor(u_rect.xy + u_rect.zw)) - 1;
  ivec2 i0 = clamp(ivec2(base), lo, hi);
  ivec2 i1 = clamp(ivec2(base) + 1, lo, hi);
  vec4 c00 = fetchLinear(ivec2(i0.x, i0.y));
  vec4 c10 = fetchLinear(ivec2(i1.x, i0.y));
  vec4 c01 = fetchLinear(ivec2(i0.x, i1.y));
  vec4 c11 = fetchLinear(ivec2(i1.x, i1.y));
  vec4 px = mix(mix(c00, c10, a.x), mix(c01, c11, a.x), a.y);
  float alpha = clamp(px.a, 0.0, 1.0) * coverage * u_opacity;
  if (alpha <= 0.0) { outColor = acc; return; }
  vec3 lin = px.rgb;
  if (u_useGrade) { lin = gradeHdr(lin, s); }
  lin *= u_gain;
  outColor = vec4(lin * alpha + acc.rgb * (1.0 - alpha), alpha + acc.a * (1.0 - alpha));
}
`;

const OUTPUT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D u_acc;
uniform int u_mode;        // 0 SDR view, 1 encode
uniform int u_outTransfer; // 0 SDR (sRGB), 1 PQ, 2 HLG
uniform bool u_to709;
uniform mat3 u_bt2020To709;
const float KNEE = ${TONE_MAP_KNEE.toFixed(4)};
${COMMON}

vec3 toneMap(vec3 rgb, vec3 lumaCoeffs) {
  float y = dot(rgb, lumaCoeffs);
  if (y > KNEE) {
    float range = 1.0 - KNEE;
    float mapped = KNEE + range * (1.0 - exp(-(y - KNEE) / range));
    rgb *= mapped / y;
  }
  return rgb;
}

void main() {
  vec4 acc = texelFetch(u_acc, ivec2(gl_FragCoord.xy), 0);
  vec3 rgb = max(acc.rgb, 0.0);
  if (u_mode == 0) {
    rgb = max(u_bt2020To709 * rgb, 0.0);
    rgb = toneMap(rgb, vec3(0.2126, 0.7152, 0.0722));
    outColor = vec4(srgbEncodeV(rgb), clamp(acc.a, 0.0, 1.0));
    return;
  }
  if (u_to709) rgb = max(u_bt2020To709 * rgb, 0.0);
  vec3 enc;
  if (u_outTransfer == 1) enc = pqEncodeNitsV(rgb * SDR_WHITE_NITS);
  else if (u_outTransfer == 2) enc = hlgOetfV(rgb * HLG_SDR_WHITE_SCENE);
  else {
    rgb = u_to709 ? toneMap(rgb, vec3(0.2126, 0.7152, 0.0722)) : toneMap(rgb, vec3(0.2627, 0.678, 0.0593));
    enc = srgbEncodeV(rgb);
  }
  outColor = vec4(enc, 1.0);
}
`;

/**
 * The ACES Output Transform pass. Same inputs as OUTPUT_FRAGMENT (the premultiplied ACEScg image in u_acc): mode 0 is the
 * SDR view (u_aces 1 = sRGB, 2 = BT.1886), mode 1 the encode (u_aces 3 = PQ 1000 nit, 4 = HLG, or an SDR id).
 */
const ACES_OUTPUT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D u_acc;
uniform int u_mode;
uniform int u_aces;
${COMMON}
${acesGlsl()}

void main() {
  vec4 acc = texelFetch(u_acc, ivec2(gl_FragCoord.xy), 0);
  vec3 enc = acesOutputV(max(acc.rgb, 0.0), u_aces);
  outColor = vec4(enc, u_mode == 0 ? clamp(acc.a, 0.0, 1.0) : 1.0);
}
`;

/** The fragment shaders, for offline validation (glslangValidator) and tests. */
export const HDR_SHADER_SOURCES = { layer: LAYER_FRAGMENT, output: OUTPUT_FRAGMENT, acesOutput: ACES_OUTPUT_FRAGMENT, decode: DECODE_FRAGMENT, effect: EFFECT_FRAGMENT } as const;

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

/** The OCIO decode: the layer / decode shaders with `decodeCodes` running the config's transform instead of the fixed decode. */
function withOcioDecode(fragment: string, snippet: string): string {
  const marker = "vec4 decodeCodes(ivec2 p) {";
  const at = fragment.indexOf(marker);
  if (at < 0) throw new Error("The HDR decode hook is missing from the shader.");
  const patched = fragment.slice(0, at) + snippet + "\n" + fragment.slice(at);
  return patched.replace("vec4(u_toBt2020 * decodeTransfer(raw.rgb), raw.a)", "vec4(ocioTransform(raw.rgb), raw.a)");
}

/** The OCIO output pass: view (mode 0) or encode (mode 1) through the project's transform. */
function ocioOutputFragment(snippet: string): string {
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D u_acc;
uniform int u_mode;
${snippet}
float ocioSane(float x) { return x == x ? x : 0.0; }
void main() {
  vec4 acc = texelFetch(u_acc, ivec2(gl_FragCoord.xy), 0);
  vec3 enc = ocioTransform(acc.rgb);
  enc = vec3(ocioSane(enc.r), ocioSane(enc.g), ocioSane(enc.b));
  outColor = vec4(enc, u_mode == 0 ? clamp(acc.a, 0.0, 1.0) : 1.0);
}
`;
}

/** Texture units of the OCIO LUT textures: after the layer program's own (0..8). */
const OCIO_LAYER_LUT_UNIT = 9;
const OCIO_DECODE_LUT_UNIT = 3;
const OCIO_OUTPUT_LUT_UNIT = 1;
const OCIO_SCRATCH_UNIT = 15;

interface FxTargets {
  width: number;
  height: number;
  textures: WebGLTexture[];
  fbos: WebGLFramebuffer[];
}

function flatten3(m: ReadonlyArray<readonly number[]>): Float32Array {
  // GLSL mat3 is column-major; our matrices are row-major (out = M * in).
  return new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);
}

export function isGpuHdrAvailable(): boolean {
  if (typeof OffscreenCanvas === "undefined") return false;
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2");
    return !!gl && !!gl.getExtension("EXT_color_buffer_float");
  } catch {
    return false;
  }
}

export class GpuHdrCompositor implements HdrCompositor {
  readonly kind = "gpu" as const;
  private canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private layerProgram: Program;
  private outputProgram: Program;
  private decodeProgram: Program;
  private effectProgram: Program;
  /** Compiled the first time an ACES frame is output (the RRT / ODT shader is the largest one). */
  private acesProgram: Program | null = null;
  /** OCIO variants, by transform key: layer / decode shaders with a config transform in them, and the output passes. */
  private ocioLayerPrograms = new Map<string, Program>();
  private ocioDecodePrograms = new Map<string, Program>();
  private ocioOutputPrograms = new Map<string, Program>();
  private ocioLutTextures = new Map<string, WebGLTexture>();
  private pipeline: HdrColorPipeline = SCENE_HDR_PIPELINE;
  private graphicsGain = 1;
  private fx: FxTargets | null = null;
  private dummy3d: WebGLTexture;
  private lutTexture: WebGLTexture;
  private lutKey: object | null = null;
  private lutCurveTexture: WebGLTexture;
  private lutUploadedSize = 0;
  private width = 0;
  private height = 0;
  private accTextures: WebGLTexture[] = [];
  private accFbos: WebGLFramebuffer[] = [];
  private current = 0;
  private viewTexture: WebGLTexture | null = null;
  private viewFbo: WebGLFramebuffer | null = null;
  private encodeTexture: WebGLTexture | null = null;
  private encodeFbo: WebGLFramebuffer | null = null;
  private dummy8: WebGLTexture;
  private dummy16: WebGLTexture;
  private toneTexture: WebGLTexture;
  private curveTexture: WebGLTexture;
  private hueTexture: WebGLTexture;

  constructor() {
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable.");
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = this.canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is unavailable.");
    if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Half-float render targets (EXT_color_buffer_float) are unavailable.");
    this.gl = gl;
    this.layerProgram = this.compile(LAYER_FRAGMENT);
    this.outputProgram = this.compile(OUTPUT_FRAGMENT);
    this.decodeProgram = this.compile(DECODE_FRAGMENT);
    this.effectProgram = this.compile(EFFECT_FRAGMENT);
    this.dummy3d = this.create3dTexture(1, new Float32Array(4));
    this.lutTexture = this.create3dTexture(1, new Float32Array(4));
    this.lutCurveTexture = this.createTexture(1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(4));
    this.dummy8 = this.createTexture(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.dummy16 = this.createTexture(1, 1, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(4));
    this.toneTexture = this.createTexture(256, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(256 * 4));
    this.curveTexture = this.createTexture(256, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(256 * 4));
    this.hueTexture = this.createTexture(HUE_CURVE_LUT_SIZE, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(HUE_CURVE_LUT_SIZE * 4));
  }

  private compile(fragment: string): Program {
    const gl = this.gl;
    const compileShader = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`HDR shader error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    const vs = compileShader(gl.VERTEX_SHADER, VERTEX);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`HDR program link error: ${gl.getProgramInfoLog(program)}`);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return { program, uniforms: new Map() };
  }

  /** The RGBA32F data texture of a transform's LUTs (one per transform key), or a 1x1 dummy when it has none. */
  private ocioLutTexture(transform: NonNullable<HdrSourceDecode["ocio"]>): WebGLTexture {
    let texture = this.ocioLutTextures.get(transform.key);
    if (!texture) {
      const gl = this.gl;
      const lut = transform.gpu().lut;
      // Create on a scratch unit: texture creation binds on the active unit and must not displace a texture the caller
      // has already bound for this pass.
      gl.activeTexture(gl.TEXTURE0 + OCIO_SCRATCH_UNIT);
      texture = lut ? this.createTexture(lut.width, lut.height, gl.RGBA32F, gl.RGBA, gl.FLOAT, lut.data) : this.createTexture(1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(4));
      this.ocioLutTextures.set(transform.key, texture);
    }
    return texture;
  }

  private layerProgramFor(decode: HdrSourceDecode): Program {
    if (!decode.ocio) return this.layerProgram;
    let p = this.ocioLayerPrograms.get(decode.ocio.key);
    if (!p) {
      p = this.compile(withOcioDecode(LAYER_FRAGMENT, decode.ocio.gpu().source));
      this.ocioLayerPrograms.set(decode.ocio.key, p);
    }
    return p;
  }

  private decodeProgramFor(decode: HdrSourceDecode): Program {
    if (!decode.ocio) return this.decodeProgram;
    let p = this.ocioDecodePrograms.get(decode.ocio.key);
    if (!p) {
      p = this.compile(withOcioDecode(DECODE_FRAGMENT, decode.ocio.gpu().source));
      this.ocioDecodePrograms.set(decode.ocio.key, p);
    }
    return p;
  }

  private uniform(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.program, name));
    return p.uniforms.get(name) ?? null;
  }

  private createTexture(
    w: number,
    h: number,
    internal: number,
    format: number,
    type: number,
    data: ArrayBufferView | null,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    this.nearest();
    return texture;
  }

  private create3dTexture(size: number, rgba: Float32Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, size, size, size, 0, gl.RGBA, gl.FLOAT, rgba);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private uploadLut(lut: NonNullable<HdrGradeSpec["lut"]>): void {
    if (this.lutKey === lut.key && this.lutUploadedSize === lut.size) return;
    const gl = this.gl;
    const n = lut.size;
    // RGBA32F straight from the float table (texelFetch: no filtering, so no float-linear extension needed).
    gl.deleteTexture(this.lutTexture);
    gl.deleteTexture(this.lutCurveTexture);
    this.lutTexture = lut.curve
      ? this.create3dTexture(1, new Float32Array(4))
      : this.create3dTexture(n, packRgbToRgba(lut.rgb, n * n * n));
    this.lutCurveTexture = lut.curve
      ? this.createTexture(lut.curve.size, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, packRgbToRgba(lut.curve.data, lut.curve.size))
      : this.createTexture(1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, new Float32Array(4));
    this.lutKey = lut.key;
    this.lutUploadedSize = n;
  }

  private nearest(): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private target(w: number, h: number, internal: number, type: number): { texture: WebGLTexture; fbo: WebGLFramebuffer } {
    const gl = this.gl;
    const texture = this.createTexture(w, h, internal, gl.RGBA, type, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("The GPU cannot render to this float format.");
    }
    return { texture, fbo };
  }

  begin(width: number, height: number): void {
    const gl = this.gl;
    if (width !== this.width || height !== this.height) {
      this.releaseTargets();
      this.width = width;
      this.height = height;
      for (let i = 0; i < 2; i++) {
        const t = this.target(width, height, gl.RGBA16F, gl.HALF_FLOAT);
        this.accTextures.push(t.texture);
        this.accFbos.push(t.fbo);
      }
      const view = this.target(width, height, gl.RGBA8, gl.UNSIGNED_BYTE);
      this.viewTexture = view.texture;
      this.viewFbo = view.fbo;
    }
    this.current = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accFbos[0]);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private releaseTargets(): void {
    const gl = this.gl;
    for (const t of this.accTextures) gl.deleteTexture(t);
    for (const f of this.accFbos) gl.deleteFramebuffer(f);
    this.accTextures = [];
    this.accFbos = [];
    if (this.viewTexture) gl.deleteTexture(this.viewTexture);
    if (this.viewFbo) gl.deleteFramebuffer(this.viewFbo);
    if (this.encodeTexture) gl.deleteTexture(this.encodeTexture);
    if (this.encodeFbo) gl.deleteFramebuffer(this.encodeFbo);
    this.viewTexture = this.viewFbo = this.encodeTexture = this.encodeFbo = null;
  }

  private bindTex(unit: number, texture: WebGLTexture, program: Program, name: string): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(program, name), unit);
  }

  private uploadGrade(grade: HdrGradeSpec | null, p: Program): void {
    const gl = this.gl;
    const set1 = (name: string, v: number): void => gl.uniform1f(this.uniform(p, name), v);
    const setB = (name: string, v: boolean): void => gl.uniform1i(this.uniform(p, name), v ? 1 : 0);
    const set3 = (name: string, x: number, y: number, z: number): void => gl.uniform3f(this.uniform(p, name), x, y, z);
    setB("u_useGrade", !!grade);
    setB("u_gradeAces", grade?.acescct === true);
    set1("u_exposureGain", grade?.exposureGain ?? 1);
    setB("u_useWB", !!grade?.whiteBalance);
    const wb = grade?.whiteBalance ?? [0, 0, 0];
    set3("u_wb", wb[0], wb[1], wb[2]);
    setB("u_useTone", !!grade?.toneCurve);
    setB("u_useWheels", !!grade?.wheels);
    setB("u_useHue", !!grade?.hueLuts);
    setB("u_useCurves", !!grade?.curves);
    const w = grade?.wheels;
    set3("u_shadows", w?.shadows.r ?? 0, w?.shadows.g ?? 0, w?.shadows.b ?? 0);
    set3("u_midtones", w?.midtones.r ?? 0, w?.midtones.g ?? 0, w?.midtones.b ?? 0);
    set3("u_highlights", w?.highlights.r ?? 0, w?.highlights.g ?? 0, w?.highlights.b ?? 0);
    set1("u_shadowsLift", w?.shadowsLift ?? 0);
    set1("u_midtonesGamma", w && w.midtonesGamma > 0 ? w.midtonesGamma : 1);
    set1("u_highlightsGain", w?.highlightsGain ?? 1);

    if (grade?.toneCurve) {
      const data = new Float32Array(256 * 4);
      for (let i = 0; i < 256; i++) data[i * 4] = grade.toneCurve[i];
      this.updateFloatTexture(this.toneTexture, 256, data);
    }
    if (grade?.curves) {
      const data = new Float32Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        data[i * 4] = grade.curves.rgb[i];
        data[i * 4 + 1] = grade.curves.red[i];
        data[i * 4 + 2] = grade.curves.green[i];
        data[i * 4 + 3] = grade.curves.blue[i];
      }
      this.updateFloatTexture(this.curveTexture, 256, data);
    }
    if (grade?.hueLuts) this.updateFloatTexture(this.hueTexture, HUE_CURVE_LUT_SIZE, packHueCurveLuts(grade.hueLuts));

    setB("u_useLut", !!grade?.lut);
    if (grade?.lut) {
      this.uploadLut(grade.lut);
      set1("u_lutSize", grade.lut.size);
      gl.uniform1i(this.uniform(p, "u_lutSpace"), grade.lut.space === "linear" ? 1 : grade.lut.space === "pq" ? 2 : 0);
      set1("u_lutIntensity", grade.lut.intensity);
      const curve = grade.lut.curve;
      gl.uniform1i(this.uniform(p, "u_useLutCurve"), curve ? 1 : 0);
      set1("u_lutCurveSize", curve ? curve.size : 1);
      gl.uniform3f(this.uniform(p, "u_lutDomainMin"), curve?.domainMin[0] ?? 0, curve?.domainMin[1] ?? 0, curve?.domainMin[2] ?? 0);
      gl.uniform3f(this.uniform(p, "u_lutDomainMax"), curve?.domainMax[0] ?? 1, curve?.domainMax[1] ?? 1, curve?.domainMax[2] ?? 1);
    }
    setB("u_useHsl", !!grade?.hsl);
    const zeros = new Float32Array(8);
    gl.uniform1fv(this.uniform(p, "u_hslHue"), grade?.hsl?.hue ?? zeros);
    gl.uniform1fv(this.uniform(p, "u_hslSat"), grade?.hsl?.saturation ?? zeros);
    gl.uniform1fv(this.uniform(p, "u_hslLum"), grade?.hsl?.luminance ?? zeros);
    setB("u_useVignette", !!grade?.vignette);
    const v = grade?.vignette;
    gl.uniform4f(this.uniform(p, "u_vig"), v?.amount ?? 0, v?.midpoint ?? 0.5, v?.roundness ?? 0, v?.feather ?? 0.5);
  }

  private updateFloatTexture(texture: WebGLTexture, width: number, data: Float32Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, 1, gl.RGBA, gl.FLOAT, data);
  }

  private runLayer(
    src: { depth: 8 | 16 | 32; texture: WebGLTexture; width: number; height: number },
    decode: HdrSourceDecode,
    draw: HdrLayerDraw,
    options: { gain?: number; solid?: readonly [number, number, number] } = {},
  ): void {
    const gl = this.gl;
    const p = this.layerProgramFor(decode);
    const next = 1 - this.current;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accFbos[next]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(p.program);
    this.bindTex(0, this.accTextures[this.current], p, "u_acc");
    this.bindTex(1, src.depth === 8 ? src.texture : this.dummy8, p, "u_src8");
    this.bindTex(2, src.depth === 16 ? src.texture : this.dummy16, p, "u_src16");
    this.bindTex(6, src.depth === 32 ? src.texture : this.dummy8, p, "u_srcF");
    this.bindTex(3, this.toneTexture, p, "u_toneCurve");
    this.bindTex(4, this.curveTexture, p, "u_curves");
    this.bindTex(5, this.hueTexture, p, "u_hueCurves");
    gl.uniform1i(this.uniform(p, "u_solid"), options.solid ? 1 : 0);
    const solid = options.solid ?? [0, 0, 0];
    gl.uniform3f(this.uniform(p, "u_solidColor"), solid[0], solid[1], solid[2]);
    gl.uniform1f(this.uniform(p, "u_gain"), options.gain ?? 1);
    gl.uniform1i(this.uniform(p, "u_depth"), src.depth);
    gl.uniform1i(this.uniform(p, "u_transfer"), decode.transfer);
    gl.uniformMatrix3fv(this.uniform(p, "u_toBt2020"), false, flatten3(decode.toBt2020));
    const g = draw.geometry;
    gl.uniform3f(this.uniform(p, "u_m0"), g.m[0], g.m[1], g.m[2]);
    gl.uniform3f(this.uniform(p, "u_m1"), g.m[3], g.m[4], g.m[5]);
    gl.uniform4f(this.uniform(p, "u_rect"), g.rect[0], g.rect[1], g.rect[2], g.rect[3]);
    gl.uniform2f(this.uniform(p, "u_scale"), g.scale[0], g.scale[1]);
    gl.uniform2f(this.uniform(p, "u_srcSize"), src.width, src.height);
    gl.uniform1f(this.uniform(p, "u_opacity"), draw.opacity);
    this.uploadGrade(draw.grade, p);
    if (decode.ocio) this.bindTex(OCIO_LAYER_LUT_UNIT, this.ocioLutTexture(decode.ocio), p, "ocioLut");
    // The 3D LUT unit is bound last: uploadLut may have replaced the texture.
    gl.activeTexture(gl.TEXTURE0 + 7);
    gl.bindTexture(gl.TEXTURE_3D, draw.grade?.lut ? this.lutTexture : this.dummy3d);
    gl.uniform1i(this.uniform(p, "u_lut"), 7);
    gl.activeTexture(gl.TEXTURE0 + 8);
    gl.bindTexture(gl.TEXTURE_2D, this.lutCurveTexture);
    gl.uniform1i(this.uniform(p, "u_lutCurve"), 8);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.current = next;
  }

  setColorPipeline(pipeline: HdrColorPipeline): void {
    // OCIO shaders and LUT textures belong to one settings key; drop them when the settings (or the mode) change.
    const key = pipeline.kind === "ocio" ? pipeline.key : null;
    const had = this.pipeline.kind === "ocio" ? this.pipeline.key : null;
    if (had !== null && had !== key) this.purgeOcio();
    this.pipeline = pipeline;
  }

  private purgeOcio(): void {
    const gl = this.gl;
    for (const map of [this.ocioLayerPrograms, this.ocioDecodePrograms, this.ocioOutputPrograms]) {
      for (const p of map.values()) gl.deleteProgram(p.program);
      map.clear();
    }
    for (const t of this.ocioLutTextures.values()) gl.deleteTexture(t);
    this.ocioLutTextures.clear();
  }

  setGraphicsWhite(nits: number): void {
    this.graphicsGain = graphicsWhiteGain(nits);
  }

  drawSolid(rgb: readonly [number, number, number], alpha: number): void {
    const w = this.width;
    this.runLayer(
      { depth: 8, texture: this.dummy8, width: 1, height: 1 },
      overlayDecodeFor(this.pipeline),
      { geometry: { m: [1, 0, 0, 0, 1, 0], rect: [0, 0, w, this.height], scale: [1, 1] }, opacity: Math.max(0, Math.min(1, alpha)), grade: null },
      { solid: rgb },
    );
  }

  private ensureFx(width: number, height: number): FxTargets {
    const gl = this.gl;
    if (this.fx && this.fx.width === width && this.fx.height === height) return this.fx;
    this.releaseFx();
    const textures: WebGLTexture[] = [];
    const fbos: WebGLFramebuffer[] = [];
    for (let i = 0; i < 3; i++) {
      const t = this.target(width, height, gl.RGBA16F, gl.HALF_FLOAT);
      textures.push(t.texture);
      fbos.push(t.fbo);
    }
    this.fx = { width, height, textures, fbos };
    return this.fx;
  }

  private releaseFx(): void {
    if (!this.fx) return;
    const gl = this.gl;
    for (const t of this.fx.textures) gl.deleteTexture(t);
    for (const f of this.fx.fbos) gl.deleteFramebuffer(f);
    this.fx = null;
  }

  /** Decodes a source into the first float scratch texture (straight alpha, working linear) and returns the texture holding the result of the effect stack. */
  private runEffects(
    src: { depth: 8 | 16; texture: WebGLTexture; width: number; height: number },
    decode: HdrSourceDecode,
    effects: readonly HdrLayerEffect[],
  ): WebGLTexture {
    const gl = this.gl;
    const fx = this.ensureFx(src.width, src.height);
    // 1. codes -> float
    const dp = this.decodeProgramFor(decode);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fx.fbos[0]);
    gl.viewport(0, 0, src.width, src.height);
    gl.useProgram(dp.program);
    this.bindTex(1, src.depth === 8 ? src.texture : this.dummy8, dp, "u_src8");
    this.bindTex(2, src.depth === 16 ? src.texture : this.dummy16, dp, "u_src16");
    gl.uniform1i(this.uniform(dp, "u_depth"), src.depth);
    gl.uniform1i(this.uniform(dp, "u_transfer"), decode.transfer);
    gl.uniformMatrix3fv(this.uniform(dp, "u_toBt2020"), false, flatten3(decode.toBt2020));
    if (decode.ocio) this.bindTex(OCIO_DECODE_LUT_UNIT, this.ocioLutTexture(decode.ocio), dp, "ocioLut");
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. the effect stack, ping-ponging between three textures
    const ep = this.effectProgram;
    gl.useProgram(ep.program);
    const pass = (
      input: number,
      output: number,
      op: number,
      premulIn: boolean,
      premulOut: boolean,
      orig?: number,
    ): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fx.fbos[output]);
      gl.viewport(0, 0, src.width, src.height);
      this.bindTex(0, fx.textures[input], ep, "u_in");
      this.bindTex(1, fx.textures[orig ?? input], ep, "u_orig");
      gl.uniform1i(this.uniform(ep, "u_op"), op);
      gl.uniform1i(this.uniform(ep, "u_premulIn"), premulIn ? 1 : 0);
      gl.uniform1i(this.uniform(ep, "u_premulOut"), premulOut ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const blur = (radius: number): void => {
      const k = gaussianKernel(radius);
      gl.uniform1f(this.uniform(ep, "u_sigma"), k.sigma);
      gl.uniform1i(this.uniform(ep, "u_half"), k.half);
      gl.uniform1f(this.uniform(ep, "u_norm"), k.norm);
    };
    let cur = 0;
    for (const effect of effects) {
      const other = (cur + 1) % 3;
      const third = (cur + 2) % 3;
      if (effect.type === "blur") {
        blur(effect.radius);
        pass(cur, other, 0, false, true);
        pass(other, cur, 1, true, false);
      } else if (effect.type === "sharpen") {
        gl.uniform1f(this.uniform(ep, "u_sharpK"), effect.amount / 100);
        pass(cur, other, 2, false, false);
        cur = other;
      } else {
        blur(effect.radius);
        pass(cur, other, 0, false, true);
        pass(other, third, 1, true, true);
        gl.uniform1f(this.uniform(ep, "u_glowW"), glowWeight(effect.intensity));
        const tint = effect.tint ?? [1, 1, 1];
        gl.uniform3f(this.uniform(ep, "u_tint"), tint[0], tint[1], tint[2]);
        // The combine shader already writes straight colour; premulOut=true stops finish() dividing by alpha a second time.
        pass(third, other, 3, true, true, cur);
        cur = other;
      }
    }
    return fx.textures[cur];
  }

  drawCodes(
    codes: SourceCodes | { readonly depth: "canvas"; readonly source: ImageBitmap | OffscreenCanvas },
    decode: HdrSourceDecode,
    draw: HdrLayerDraw,
  ): void {
    const gl = this.gl;
    let texture: WebGLTexture;
    let depth: 8 | 16;
    let width: number;
    let height: number;
    if (codes.depth === "canvas") {
      depth = 8;
      width = codes.source.width;
      height = codes.source.height;
      texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, codes.source);
      this.nearest();
    } else if (codes.depth === 8) {
      depth = 8;
      width = codes.width;
      height = codes.height;
      texture = this.createTexture(width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, codes.data as Uint8Array);
    } else {
      depth = 16;
      width = codes.width;
      height = codes.height;
      texture = this.createTexture(width, height, gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, codes.data);
    }
    try {
      if (draw.effects && draw.effects.length > 0) {
        const processed = this.runEffects({ depth, texture, width, height }, decode, draw.effects);
        this.runLayer({ depth: 32, texture: processed, width, height }, decode, draw);
      } else {
        this.runLayer({ depth, texture, width, height }, decode, draw);
      }
    } finally {
      gl.deleteTexture(texture);
    }
  }

  drawOverlay(overlay: HdrOverlay8 | OffscreenCanvas | ImageBitmap): void {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if ("data" in overlay) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, overlay.width, overlay.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, overlay.data as unknown as Uint8Array);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, overlay);
    }
    this.nearest();
    const w = this.width;
    const h = this.height;
    try {
      this.runLayer(
        { depth: 8, texture, width: w, height: h },
        overlayDecodeFor(this.pipeline),
        {
          geometry: { m: [1, 0, 0, 0, 1, 0], rect: [0, 0, w, h], scale: [1, 1] },
          opacity: 1,
          grade: null,
        },
        { gain: this.graphicsGain },
      );
    } finally {
      gl.deleteTexture(texture);
    }
  }

  private runOutput(mode: 0 | 1, spec: OutputColorSpec | null): void {
    const gl = this.gl;
    if (this.pipeline.kind === "ocio") {
      const out = this.pipeline.output;
      let op = this.ocioOutputPrograms.get(out.key);
      if (!op) {
        op = this.compile(ocioOutputFragment(out.gpu().source));
        this.ocioOutputPrograms.set(out.key, op);
      }
      gl.useProgram(op.program);
      this.bindTex(0, this.accTextures[this.current], op, "u_acc");
      this.bindTex(OCIO_OUTPUT_LUT_UNIT, this.ocioLutTexture(out), op, "ocioLut");
      gl.uniform1i(this.uniform(op, "u_mode"), mode);
      gl.viewport(0, 0, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    if (this.pipeline.kind === "aces") {
      this.acesProgram ??= this.compile(ACES_OUTPUT_FRAGMENT);
      const ap = this.acesProgram;
      gl.useProgram(ap.program);
      this.bindTex(0, this.accTextures[this.current], ap, "u_acc");
      gl.uniform1i(this.uniform(ap, "u_mode"), mode);
      const id = mode === 0 || !spec ? this.pipeline.sdrOutput : acesOutputForSpec(spec, this.pipeline.sdrOutput);
      gl.uniform1i(this.uniform(ap, "u_aces"), id === "srgb" ? 1 : id === "rec709" ? 2 : id === "rec2020-pq" ? 3 : 4);
      gl.viewport(0, 0, this.width, this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    const p = this.outputProgram;
    gl.useProgram(p.program);
    this.bindTex(0, this.accTextures[this.current], p, "u_acc");
    gl.uniform1i(this.uniform(p, "u_mode"), mode);
    const transfer = spec?.transfer === "pq" ? 1 : spec?.transfer === "hlg" ? 2 : 0;
    gl.uniform1i(this.uniform(p, "u_outTransfer"), transfer);
    gl.uniform1i(this.uniform(p, "u_to709"), spec && spec.primaries === "bt709" ? 1 : 0);
    gl.uniformMatrix3fv(this.uniform(p, "u_bt2020To709"), false, flatten3(BT2020_TO_BT709));
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  readSdrView(): Uint8ClampedArray {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.viewFbo);
    this.runOutput(0, null);
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  readFrame(): HdrFrame {
    const gl = this.gl;
    // Resolve the half-float image through a 32F target, then read it as float.
    const raw = this.readTarget(this.accFbos[this.current], gl.RGBA16F);
    return { width: this.width, height: this.height, data: raw };
  }

  private readTarget(fbo: WebGLFramebuffer, _format: number): Float32Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const out = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  readEncodedRgb(spec: OutputColorSpec): Float32Array {
    const gl = this.gl;
    if (!this.encodeFbo) {
      const t = this.target(this.width, this.height, gl.RGBA32F, gl.FLOAT);
      this.encodeTexture = t.texture;
      this.encodeFbo = t.fbo;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.encodeFbo);
    this.runOutput(1, spec);
    const rgba = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, rgba);
    const n = this.width * this.height;
    const out = new Float32Array(n * 3);
    for (let p = 0, o = 0, q = 0; p < n; p++, o += 4, q += 3) {
      out[q] = rgba[o];
      out[q + 1] = rgba[o + 1];
      out[q + 2] = rgba[o + 2];
    }
    return out;
  }

  dispose(): void {
    this.releaseTargets();
    this.releaseFx();
    const gl = this.gl;
    for (const t of [this.dummy8, this.dummy16, this.dummy3d, this.lutTexture, this.lutCurveTexture, this.toneTexture, this.curveTexture, this.hueTexture]) gl.deleteTexture(t);
    gl.deleteProgram(this.layerProgram.program);
    gl.deleteProgram(this.outputProgram.program);
    gl.deleteProgram(this.decodeProgram.program);
    gl.deleteProgram(this.effectProgram.program);
    if (this.acesProgram) gl.deleteProgram(this.acesProgram.program);
    for (const p of [...this.ocioLayerPrograms.values(), ...this.ocioDecodePrograms.values(), ...this.ocioOutputPrograms.values()]) gl.deleteProgram(p.program);
    for (const t of this.ocioLutTextures.values()) gl.deleteTexture(t);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

