/**
 * GLSL ES 3.00 fragment shaders for the pro effects library, packaged as
 * MotionShaderDefs so the existing MotionShaderRenderer (WebGL2) runs them in
 * real time. They are deliberately NOT part of MOTION_SHADER_LIBRARY: they are
 * first-class effect types, not entries in the "shader" effect picker.
 *
 * Every shader is a line-for-line port of the CPU reference in pro-effects.ts
 * (same pixel-space coordinates, rounding and clamping rules); uniforms are
 * produced by proEffectGpuUniforms so derived values are shared. Where a GPU
 * port must approximate (mosaic blocks wider than 8px use an 8x8 tap grid,
 * unsharp radii above 6px use strided bilinear taps) the neutral parameters
 * still short-circuit before any shader runs.
 *
 * Input is straight-alpha (UNPACK_PREMULTIPLY_ALPHA false); output is written
 * premultiplied because the renderer's canvas is a premultiplied context.
 */
import type { MotionShaderDef, MotionShaderParamDef } from "../motion/shaders/types";
import {
  PRO_EFFECT_TYPES,
  type ProEffectType,
} from "./pro-effects";
import { PRELUDE } from "./pro-effect-prelude";
import { EXTRA_GLSL, EXTRA_UNIFORMS } from "./pro-effect-shaders-extra";


const MOSAIC = `${PRELUDE}
uniform float u_size;
void main() {
  vec2 p = pxPos();
  float blk = max(floor(u_size), 1.0);
  vec2 origin = floor(p / blk) * blk;
  vec2 ext = min(vec2(blk), u_resolution - origin);
  vec2 taps = min(vec2(8.0), ext);
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (float(j) >= taps.y) break;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= taps.x) break;
      vec2 q = origin + floor((vec2(float(i), float(j)) + 0.5) * ext / taps);
      sum += fetchPx(q);
    }
  }
  vec4 avg = sum / (taps.x * taps.y);
  fragColor = emit(avg.rgb, avg.a);
}
`;

const POSTERIZE = `${PRELUDE}
uniform float u_steps;
void main() {
  vec4 c = texture(u_input, vUv);
  fragColor = emit(floor(c.rgb * u_steps + 0.5) / u_steps, c.a);
}
`;

const MIRROR = `${PRELUDE}
uniform float u_horizontal;
uniform float u_vertical;
uniform float u_center;
void main() {
  vec2 p = pxPos();
  vec2 c = floor(u_resolution * u_center + 0.5);
  if (u_horizontal > 0.5 && p.x >= c.x) p.x = clamp(2.0 * c.x - 1.0 - p.x, 0.0, u_resolution.x - 1.0);
  if (u_vertical > 0.5 && p.y >= c.y) p.y = clamp(2.0 * c.y - 1.0 - p.y, 0.0, u_resolution.y - 1.0);
  vec4 s = fetchPx(p);
  fragColor = emit(s.rgb, s.a);
}
`;

const LENS = `${PRELUDE}
uniform float u_k;
uniform float u_s;
void main() {
  vec2 p = pxPos();
  vec2 c = (u_resolution - 1.0) * 0.5;
  vec2 h = max(c, vec2(1.0));
  vec2 uv = ((p - c) / h) * u_s;
  uv *= 1.0 + u_k * dot(uv, uv);
  vec4 s = fetchCont(uv * h + c);
  fragColor = emit(s.rgb, s.a);
}
`;

const DIRECTIONAL_BLUR = `${PRELUDE}
uniform float u_dx;
uniform float u_dy;
uniform float u_half;
uniform float u_samples;
void main() {
  vec2 p = pxPos();
  vec4 sum = vec4(0.0);
  int count = int(u_samples);
  for (int i = 0; i < 64; i++) {
    if (i >= count) break;
    float t = (float(i) / (u_samples - 1.0) - 0.5) * 2.0 * u_half;
    sum += fetchPx(floor(p + vec2(u_dx, u_dy) * t + 0.5));
  }
  vec4 avg = sum / u_samples;
  fragColor = emit(avg.rgb, avg.a);
}
`;

const FIND_EDGES = `${PRELUDE}
uniform float u_mix;
uniform float u_invert;
float lumAt(vec2 q) { return luma(fetchPx(q).rgb); }
void main() {
  vec2 p = pxPos();
  float tl = lumAt(p + vec2(-1.0, -1.0));
  float tc = lumAt(p + vec2(0.0, -1.0));
  float tr = lumAt(p + vec2(1.0, -1.0));
  float ml = lumAt(p + vec2(-1.0, 0.0));
  float mr = lumAt(p + vec2(1.0, 0.0));
  float bl = lumAt(p + vec2(-1.0, 1.0));
  float bc = lumAt(p + vec2(0.0, 1.0));
  float br = lumAt(p + vec2(1.0, 1.0));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float mag = clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);
  float edge = u_invert > 0.5 ? mag : 1.0 - mag;
  vec4 s = fetchPx(p);
  fragColor = emit(mix(s.rgb, vec3(edge), u_mix), s.a);
}
`;

const EMBOSS = `${PRELUDE}
uniform float u_mix;
uniform float u_dx;
uniform float u_dy;
uniform float u_strength;
float lumAt(vec2 q) { return luma(fetchPx(q).rgb); }
void main() {
  vec2 p = pxPos();
  vec2 d = vec2(u_dx, u_dy);
  float a = lumAt(floor(p + d + 0.5));
  float b = lumAt(floor(p - d + 0.5));
  float v = clamp(128.0 / 255.0 + (a - b) * u_strength, 0.0, 1.0);
  vec4 s = fetchPx(p);
  fragColor = emit(mix(s.rgb, vec3(v), u_mix), s.a);
}
`;

const EXPOSURE = `${PRELUDE}
uniform float u_gain;
uniform float u_offset;
uniform float u_invGamma;
vec3 toLinear(vec3 c) {
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThanEqual(c, vec3(0.04045)));
}
float fromLinear(float c) {
  float v = max(c, 0.0);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
float gammaOf(float v) { return v <= 0.0 ? 0.0 : pow(v, u_invGamma); }
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 lin = toLinear(s.rgb) * u_gain + u_offset;
  vec3 g = vec3(gammaOf(clamp(lin.r, 0.0, 1.0)), gammaOf(clamp(lin.g, 0.0, 1.0)), gammaOf(clamp(lin.b, 0.0, 1.0)));
  fragColor = emit(vec3(fromLinear(g.r), fromLinear(g.g), fromLinear(g.b)), s.a);
}
`;

const THRESHOLD = `${PRELUDE}
uniform float u_level;
uniform float u_mix;
void main() {
  vec4 s = texture(u_input, vUv);
  float v = luma(s.rgb) * 255.0 >= u_level - 0.0001 ? 1.0 : 0.0;
  fragColor = emit(mix(s.rgb, vec3(v), u_mix), s.a);
}
`;

const HALFTONE = `${PRELUDE}
uniform float u_cell;
uniform float u_cs;
uniform float u_sn;
uniform float u_mix;
uniform float u_invert;
void main() {
  vec2 p = pxPos();
  vec2 g = vec2(p.x * u_cs + p.y * u_sn, -p.x * u_sn + p.y * u_cs);
  vec2 cc = (floor(g / u_cell) + 0.5) * u_cell;
  vec2 sp = floor(vec2(cc.x * u_cs - cc.y * u_sn, cc.x * u_sn + cc.y * u_cs) + 0.5);
  vec4 samp = fetchPx(sp);
  float l = luma(samp.rgb);
  float coverage = u_invert > 0.5 ? 1.0 - l : l;
  float radius = (u_cell * 0.5) * 1.2 * sqrt(coverage);
  float inside = clamp(radius - length(g - cc) + 0.5, 0.0, 1.0);
  float bg = u_invert > 0.5 ? 1.0 : 0.0;
  vec3 ht = vec3(bg) * (1.0 - inside) + samp.rgb * inside;
  vec4 cur = fetchPx(p);
  fragColor = emit(cur.rgb * (1.0 - u_mix) + ht * u_mix, cur.a);
}
`;

const VHS = `${PRELUDE}
uniform float u_scan;
uniform float u_split;
uniform float u_jit;
uniform float u_noise;
uniform float u_frame;
uniform float u_seed;
uniform float u_band;

float hash01(int a, int b, int c) {
  uint h = uint(a) * 374761393u + uint(b) * 668265263u;
  h += uint(c) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= (h >> 16u);
  return float(h) / 4294967296.0;
}

void main() {
  vec2 p = pxPos();
  int x = int(p.x);
  int y = int(p.y);
  int seed = int(u_seed);
  int frame = int(u_frame);
  int band = y / int(u_band);
  float shift = 0.0;
  if (u_jit > 0.0) {
    float gate = hash01(seed, frame, band * 2 + 1);
    if (gate > 0.7) shift = rnd((hash01(seed, frame, band * 2) * 2.0 - 1.0) * u_jit);
  }
  float scanFactor = (u_scan > 0.0 && (y - (y / 2) * 2) == 1) ? 1.0 - u_scan * 0.6 : 1.0;
  float baseX = p.x - shift;
  float r = fetchPx(vec2(baseX + u_split, p.y)).r;
  float g = fetchPx(vec2(baseX, p.y)).g;
  float b = fetchPx(vec2(baseX - u_split, p.y)).b;
  float a = fetchPx(p).a;
  vec3 rgb = vec3(r, g, b);
  if (u_noise > 0.0) {
    float nz = (hash01(seed + x, frame, y) * 2.0 - 1.0) * u_noise * 60.0 / 255.0;
    rgb += nz;
  }
  fragColor = emit(rgb * scanFactor, a);
}
`;

const UNSHARP = `${PRELUDE}
uniform float u_amount;
uniform float u_radius;
uniform float u_threshold;
void main() {
  vec2 p = pxPos();
  float sigma = max(0.1, u_radius / 2.0);
  float extent = ceil(u_radius);
  float stride = max(1.0, extent / 6.0);
  int n = int(ceil(extent / stride));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int j = -6; j <= 6; j++) {
    if (j < -n || j > n) continue;
    float dy = float(j) * stride;
    float wy = exp(-(dy * dy) / (2.0 * sigma * sigma));
    for (int i = -6; i <= 6; i++) {
      if (i < -n || i > n) continue;
      float dx = float(i) * stride;
      float w = wy * exp(-(dx * dx) / (2.0 * sigma * sigma));
      acc += fetchCont(p + vec2(dx, dy)).rgb * w;
      wsum += w;
    }
  }
  vec3 blurred = acc / wsum;
  vec4 s = fetchPx(p);
  vec3 diff = s.rgb - blurred;
  vec3 apply = step(vec3(u_threshold), abs(diff));
  fragColor = emit(s.rgb + diff * u_amount * apply, s.a);
}
`;

const GAUSSIAN_BLUR = `${PRELUDE}
uniform float u_rx;
uniform float u_ry;
// Separable gaussian evaluated in one pass: a per-axis tap count of at most
// 12 each side, strided (bilinear) when the radius is larger.
void main() {
  vec2 p = pxPos();
  float sx = max(0.1, u_rx / 2.0);
  float sy = max(0.1, u_ry / 2.0);
  float ex = u_rx > 0.0 ? ceil(u_rx) : 0.0;
  float ey = u_ry > 0.0 ? ceil(u_ry) : 0.0;
  float stx = max(1.0, ex / 12.0);
  float sty = max(1.0, ey / 12.0);
  int nx = int(ceil(ex / stx));
  int ny = int(ceil(ey / sty));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = -12; j <= 12; j++) {
    if (j < -ny || j > ny) continue;
    float dy = float(j) * sty;
    float wy = u_ry > 0.0 ? exp(-(dy * dy) / (2.0 * sy * sy)) : 1.0;
    for (int i = -12; i <= 12; i++) {
      if (i < -nx || i > nx) continue;
      float dx = float(i) * stx;
      float w = wy * (u_rx > 0.0 ? exp(-(dx * dx) / (2.0 * sx * sx)) : 1.0);
      acc += fetchCont(p + vec2(dx, dy)) * w;
      wsum += w;
    }
  }
  vec4 avg = acc / wsum;
  fragColor = emit(avg.rgb, avg.a);
}
`;

const CROP = `${PRELUDE}
uniform float u_l;
uniform float u_t;
uniform float u_r;
uniform float u_b;
uniform float u_feather;
float edge(float d) {
  return u_feather <= 0.0 ? (d >= 0.0 ? 1.0 : 0.0) : clamp(0.5 + d / u_feather, 0.0, 1.0);
}
void main() {
  vec2 p = pxPos() + 0.5;
  vec2 lt = vec2(u_l, u_t) * u_resolution;
  vec2 rb = vec2(u_r, u_b) * u_resolution;
  float cov = 1.0;
  if (lt.x > 0.0) cov *= edge(p.x - lt.x);
  if (lt.y > 0.0) cov *= edge(p.y - lt.y);
  if (rb.x > 0.0) cov *= edge(u_resolution.x - rb.x - p.x);
  if (rb.y > 0.0) cov *= edge(u_resolution.y - rb.y - p.y);
  vec4 s = texture(u_input, vUv);
  fragColor = emit(s.rgb, rnd(s.a * 255.0 * cov) / 255.0);
}
`;

const VIBRANCE = `${PRELUDE}
uniform float u_vibrance;
uniform float u_sat;
void main() {
  vec4 s = texture(u_input, vUv);
  float mx = max(s.r, max(s.g, s.b));
  float mn = min(s.r, min(s.g, s.b));
  float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float factor = max(0.0, (1.0 + u_vibrance * (1.0 - sat)) * u_sat);
  float y = luma(s.rgb);
  fragColor = emit(y + (s.rgb - y) * factor, s.a);
}
`;

const SKEW = `${PRELUDE}
uniform float u_a;
uniform float u_b;
uniform float u_c;
uniform float u_d;
uniform float u_valid;
void main() {
  vec2 p = pxPos();
  vec2 c = (u_resolution - 1.0) * 0.5;
  vec2 d = p - c;
  vec2 src = vec2(u_a * d.x + u_b * d.y, u_c * d.x + u_d * d.y) + c;
  if (u_valid < 0.5 || src.x < -0.5 || src.x > u_resolution.x - 0.5 || src.y < -0.5 || src.y > u_resolution.y - 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  vec4 s = fetchCont(src);
  fragColor = emit(s.rgb, s.a);
}
`;

const HSL_SECONDARY = `${PRELUDE}
uniform float u_hMin;
uniform float u_hMax;
uniform float u_hSoft;
uniform float u_sMin;
uniform float u_sMax;
uniform float u_sSoft;
uniform float u_lMin;
uniform float u_lMax;
uniform float u_lSoft;
uniform float u_radius;
uniform float u_denoise;
uniform float u_invert;
uniform float u_mShape;
uniform float u_mCx;
uniform float u_mCy;
uniform float u_mHx;
uniform float u_mHy;
uniform float u_mFeather;
uniform float u_mInvert;
uniform float u_tempR;
uniform float u_tempG;
uniform float u_tempB;
uniform float u_wheelR;
uniform float u_wheelG;
uniform float u_wheelB;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_sharpen;
uniform float u_view;
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float s = 0.0;
  float h = 0.0;
  if (d > 0.0) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
  }
  return vec3(h, s, l);
}
float circDist(float a, float b) {
  float d = abs(a - b);
  return min(d, 360.0 - d);
}
float linW(float v, float lo, float hi, float soft) {
  if (v >= lo && v <= hi) return 1.0;
  if (soft <= 0.0) return 0.0;
  float d = v < lo ? lo - v : v - hi;
  return clamp(1.0 - d / soft, 0.0, 1.0);
}
float hueW(float h) {
  if (u_hMax - u_hMin >= 359.999) return 1.0;
  bool inside = u_hMin <= u_hMax ? (h >= u_hMin && h <= u_hMax) : (h >= u_hMin || h <= u_hMax);
  if (inside) return 1.0;
  if (u_hSoft <= 0.0) return 0.0;
  float d = min(circDist(h, u_hMin), circDist(h, u_hMax));
  return clamp(1.0 - d / u_hSoft, 0.0, 1.0);
}
float rawAt(vec2 p) {
  vec3 hsl = rgb2hsl(fetchPx(p).rgb);
  return hueW(hsl.x) * linW(hsl.y, u_sMin, u_sMax, u_sSoft) * linW(hsl.z, u_lMin, u_lMax, u_lSoft);
}
float latOff(float k) {
  float m = floor(abs(k) * u_radius / 2.0 + 0.5);
  return k < 0.0 ? -m : m;
}
float maskCover(vec2 p) {
  vec2 c = vec2(u_mCx, u_mCy) * u_resolution;
  vec2 h = vec2(u_mHx, u_mHy) * u_resolution;
  float cover = 0.0;
  if (h.x > 0.0 && h.y > 0.0) {
    float inside;
    if (u_mShape > 1.5) {
      inside = min(h.x - abs(p.x - c.x), h.y - abs(p.y - c.y));
    } else {
      float q = length((p - c) / h);
      inside = (1.0 - q) * min(h.x, h.y);
    }
    cover = u_mFeather <= 0.0 ? (inside >= 0.0 ? 1.0 : 0.0) : clamp(0.5 + inside / u_mFeather, 0.0, 1.0);
  }
  return u_mInvert > 0.5 ? 1.0 - cover : cover;
}
float matteAt(vec2 p) {
  float m;
  if (u_radius > 0.0) {
    float sum = 0.0;
    for (int j = -2; j <= 2; j++) {
      for (int i = -2; i <= 2; i++) {
        sum += rawAt(p + vec2(latOff(float(i)), latOff(float(j))));
      }
    }
    m = sum / 25.0;
    if (u_denoise > 0.0) {
      float lo = 0.45 * u_denoise;
      m = smoothstep(lo, 1.0 - lo, m);
    }
  } else {
    m = rawAt(p);
  }
  if (u_invert > 0.5) m = 1.0 - m;
  if (u_mShape > 0.5) m *= maskCover(p + 0.5);
  return m;
}
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  if (u_view > 3.5) {
    fragColor = emit(s.rgb, s.a);
    return;
  }
  float m = matteAt(p);
  if (u_view > 0.5) {
    vec3 o;
    if (u_view < 1.5) o = s.rgb * 0.5 * (1.0 - m * 0.7) + vec3(1.0, 0.2, 0.4) * m * 0.7;
    else if (u_view < 2.5) o = vec3(m);
    else o = vec3(m >= 0.5 ? 1.0 : 0.0);
    fragColor = emit(o, s.a);
    return;
  }
  vec3 c = s.rgb + vec3(u_tempR + u_wheelR, u_tempG + u_wheelG, u_tempB + u_wheelB);
  c = (c - 0.5) * u_contrast + 0.5;
  float y = luma(c);
  c = y + (c - y) * u_saturation;
  if (u_sharpen > 0.0) {
    vec3 acc = vec3(0.0);
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        acc += fetchPx(p + vec2(float(dx), float(dy))).rgb;
      }
    }
    c += u_sharpen * (s.rgb - acc / 9.0);
  }
  c = clamp(c, 0.0, 1.0);
  fragColor = emit(mix(s.rgb, c, m), s.a);
}
`;

/** Temporal effects never reach the pixel pass; this identity shader only keeps every type's def complete. */
const TEMPORAL_PASSTHROUGH = `${PRELUDE}
void main() {
  vec4 c = texture(u_input, vUv);
  fragColor = emit(c.rgb, c.a);
}
`;

const GLSL: Readonly<Record<ProEffectType, string>> = {
  mosaic: MOSAIC,
  posterize: POSTERIZE,
  mirror: MIRROR,
  "lens-distortion": LENS,
  "directional-blur": DIRECTIONAL_BLUR,
  "find-edges": FIND_EDGES,
  emboss: EMBOSS,
  exposure: EXPOSURE,
  threshold: THRESHOLD,
  halftone: HALFTONE,
  "vhs-glitch": VHS,
  "unsharp-mask": UNSHARP,
  "gaussian-blur": GAUSSIAN_BLUR,
  crop: CROP,
  vibrance: VIBRANCE,
  skew: SKEW,
  "hsl-secondary": HSL_SECONDARY,
  echo: TEMPORAL_PASSTHROUGH,
  "posterize-time": TEMPORAL_PASSTHROUGH,
  ...EXTRA_GLSL,
};

/** Uniform names (without the `u_` prefix) each shader consumes. */
const UNIFORMS: Readonly<Record<ProEffectType, readonly string[]>> = {
  mosaic: ["size"],
  posterize: ["steps"],
  mirror: ["horizontal", "vertical", "center"],
  "lens-distortion": ["k", "s"],
  "directional-blur": ["dx", "dy", "half", "samples"],
  "find-edges": ["mix", "invert"],
  emboss: ["mix", "dx", "dy", "strength"],
  exposure: ["gain", "offset", "invGamma"],
  threshold: ["level", "mix"],
  halftone: ["cell", "cs", "sn", "mix", "invert"],
  "vhs-glitch": ["scan", "split", "jit", "noise", "frame", "seed", "band"],
  "unsharp-mask": ["amount", "radius", "threshold"],
  "gaussian-blur": ["rx", "ry"],
  crop: ["l", "t", "r", "b", "feather"],
  vibrance: ["vibrance", "sat"],
  skew: ["a", "b", "c", "d", "valid"],
  "hsl-secondary": ["hMin", "hMax", "hSoft", "sMin", "sMax", "sSoft", "lMin", "lMax", "lSoft", "radius", "denoise", "invert", "mShape", "mCx", "mCy", "mHx", "mHy", "mFeather", "mInvert", "tempR", "tempG", "tempB", "wheelR", "wheelG", "wheelB", "contrast", "saturation", "sharpen", "view"],
  echo: [],
  "posterize-time": [],
  ...EXTRA_UNIFORMS,
};

function buildDef(type: ProEffectType): MotionShaderDef {
  const params: MotionShaderParamDef[] = UNIFORMS[type].map((name) => ({
    name,
    label: name,
    type: "number",
    default: 0,
    min: -1e6,
    max: 1e6,
    step: 0.01,
  }));
  return {
    id: `pro-effect-${type}`,
    name: type,
    category: "effect",
    glsl: GLSL[type],
    params,
    origin: "builtin",
  };
}

export const PRO_EFFECT_SHADER_DEFS: Readonly<
  Record<ProEffectType, MotionShaderDef>
> = Object.fromEntries(
  PRO_EFFECT_TYPES.map((type) => [type, buildDef(type)]),
) as Record<ProEffectType, MotionShaderDef>;

export function getProEffectShaderDef(type: ProEffectType): MotionShaderDef {
  return PRO_EFFECT_SHADER_DEFS[type];
}
