/**
 * GLSL ES 3.00 ports of the VR image effects in vr-image-effects.ts (VR Sharpen, Glow, Chromatic Aberrations,
 * Digital Glitch, De-Noise). They share the helpers of vr-effect-shaders.ts (eye rectangles, wrapped bilinear
 * taps, pole reflection) and mirror the CPU reference line for line; uniforms come from vrImageEffectGpuUniforms.
 * In the eye rectangle `r`, r.xy is the origin and r.z / r.w the width / height.
 */
import { MATRIX, VR_HELPERS } from "./vr-effect-shaders";
import type { VrImageEffectType } from "./vr-image-effects";

// Prologue shared by the disc kernels: eye, eye-local pixel, radius in pixels, sample count and latitude stretch.
const DISC_SETUP = `
  vec2 p = pxPos();
  float eye = eyeOf(u_layout, p);
  vec4 r = eyeRect(u_layout, eye);
  vec2 lp = p - r.xy;
  float radius = u_degrees / 360.0 * r.z;
  float count = min(64.0, max(16.0, ceil(radius * 2.0) + 8.0));
  float lat = (0.5 - (lp.y + 0.5) / r.w) * PI;
  float hs = 1.0 / max(cos(lat), 0.05);
`;

const SHARPEN = `${VR_HELPERS}
uniform float u_layout;
uniform float u_degrees;
uniform float u_k;
void main() {${DISC_SETUP}
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= count) break;
    float rho = radius * sqrt((float(i) + 0.5) / count);
    float th = float(i) * 2.399963229728653;
    acc += sampleSphere(r, lp + vec2(rho * cos(th) * hs, rho * sin(th))).rgb;
  }
  vec4 c = texelAt(p);
  fragColor = emit(c.rgb + u_k * (c.rgb - acc / count), c.a);
}
`;

const GLOW = `${VR_HELPERS}
uniform float u_layout;
uniform float u_degrees;
uniform float u_thr;
uniform float u_boost;
uniform float u_tintR;
uniform float u_tintG;
uniform float u_tintB;
void main() {${DISC_SETUP}
  float range = max(1.0 - u_thr, 0.001);
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= count) break;
    float rho = radius * sqrt((float(i) + 0.5) / count);
    float th = float(i) * 2.399963229728653;
    vec4 s = sampleSphere(r, lp + vec2(rho * cos(th) * hs, rho * sin(th)));
    float l = luma(s.rgb);
    float ex = l > u_thr ? (l - u_thr) / range : 0.0;
    float w = exp(-2.0 * (float(i) + 0.5) / count);
    acc += w * ex * s.a * s.rgb;
    ws += w;
  }
  vec4 c = texelAt(p);
  fragColor = emit(c.rgb + u_boost * vec3(u_tintR, u_tintG, u_tintB) * (acc / ws), c.a);
}
`;

const CHROMATIC = `${VR_HELPERS}${MATRIX}
uniform float u_layout;
uniform float u_scale;
// Direction whose angle from the view axis (matrix: view -> world) is scaled by 1 + k w (w fades behind the axis).
vec3 aberrate(vec3 d, float k) {
  mat3 R = vrMatrix();
  vec3 v = transpose(R) * d;
  float sinT = length(v.xy);
  float theta = atan(sinT, v.z);
  float f = 1.0 + (v.z < 0.0 ? k * sinT * sinT : k);
  float t2 = theta * f;
  float ratio = sinT > 1e-9 ? sin(t2) / sinT : f;
  return R * vec3(v.xy * ratio, cos(t2));
}
void main() {
  vec2 p = pxPos();
  float eye = eyeOf(u_layout, p);
  vec4 r = eyeRect(u_layout, eye);
  vec2 uv = (p - r.xy + 0.5) / r.zw;
  vec3 d = dirFromUv(uv);
  vec4 a = sampleEq(r, uvFromDir(aberrate(d, u_scale)));
  vec4 b = sampleEq(r, uvFromDir(d));
  vec4 c = sampleEq(r, uvFromDir(aberrate(d, -u_scale)));
  fragColor = emit(vec3(a.r, b.g, c.b), (a.a + b.a + c.a) / 3.0);
}
`;

const GLITCH = `${VR_HELPERS}
uniform float u_layout;
uniform float u_k;
uniform float u_seed;
uniform float u_frame;
float hashU(int a, int b, int c) {
  uint h = uint(a) * 374761393u + uint(b) * 668265263u;
  h += uint(c) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= (h >> 16u);
  return float(h) / 4294967296.0;
}
void main() {
  vec2 p = pxPos();
  float eye = eyeOf(u_layout, p);
  vec4 r = eyeRect(u_layout, eye);
  vec2 lp = p - r.xy;
  int seed = int(u_seed);
  int frame = int(u_frame);
  int y = int(lp.y);
  // 16 bands of latitude over the eye height (rounded half up like Math.round).
  float rows = max(1.0, floor(r.w / 16.0 + 0.5));
  int band = int(floor(lp.y / rows));
  float k = u_k;
  float shift = 0.0;
  if (hashU(seed, frame, band * 4 + 1) < 0.1 + 0.5 * k) {
    shift = rnd((hashU(seed, frame, band * 4) * 2.0 - 1.0) * k * 0.2 * r.z);
  }
  if (hashU(seed + 10007, frame, y * 4 + 2) < 0.3 * k) {
    shift += rnd((hashU(seed + 10007, frame, y * 4 + 3) * 2.0 - 1.0) * k * 0.02 * r.z);
  }
  float split = shift != 0.0 ? rnd(k * 0.01 * r.z * (0.5 + hashU(seed, frame, band * 4 + 2))) : 0.0;
  if (shift == 0.0 && split == 0.0) {
    vec4 c0 = texelAt(p);
    fragColor = emit(c0.rgb, c0.a);
    return;
  }
  float x = lp.x;
  vec4 cr = texelAt(vec2(r.x + mod(x - shift - split, r.z), p.y));
  vec4 cg = texelAt(vec2(r.x + mod(x - shift, r.z), p.y));
  vec4 cb = texelAt(vec2(r.x + mod(x - shift + split, r.z), p.y));
  fragColor = emit(vec3(cr.r, cg.g, cb.b), cg.a);
}
`;

const DENOISE = `${VR_HELPERS}
uniform float u_layout;
uniform float u_degrees;
uniform float u_sigma;
void main() {${DISC_SETUP}
  vec4 c = texelAt(p);
  float inv = 1.0 / (2.0 * u_sigma * u_sigma);
  vec3 acc = c.rgb;
  float ws = 1.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= count) break;
    float rho = radius * sqrt((float(i) + 0.5) / count);
    float th = float(i) * 2.399963229728653;
    vec3 s = sampleSphere(r, lp + vec2(rho * cos(th) * hs, rho * sin(th))).rgb;
    vec3 dd = s - c.rgb;
    float w = exp(-2.0 * (float(i) + 0.5) / count) * exp(-(dot(dd, dd) / 3.0) * inv);
    acc += w * s;
    ws += w;
  }
  fragColor = emit(acc / ws, c.a);
}
`;

export const VR_IMAGE_GLSL: Readonly<Record<VrImageEffectType, string>> = {
  "vr-sharpen": SHARPEN,
  "vr-glow": GLOW,
  "vr-chromatic-aberrations": CHROMATIC,
  "vr-digital-glitch": GLITCH,
  "vr-de-noise": DENOISE,
};
