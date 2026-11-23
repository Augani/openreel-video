/**
 * GLSL ES 3.00 ports of the VR effects in vr-effects.ts. Each shader mirrors the CPU reference line for line:
 * integer pixel coordinates with centres at +0.5, manual bilinear taps (wrap across the 0/360 seam, clamp at the
 * poles, never across the boundary between the two eyes of a stereo frame) and the same direction maths as
 * vr/vr-math.ts. Uniforms come from vrEffectGpuUniforms.
 */
import { PRELUDE } from "./pro-effect-prelude";
import type { VrProEffectType } from "./vr-effects";

export const VR_HELPERS = `${PRELUDE}
const float PI = 3.141592653589793;
const float DEG = 0.017453292519943295;

// Pixel rectangle (x, y, w, h) of an eye; layout 0 mono, 1 over/under, 2 side by side.
vec4 eyeRect(float lay, float eye) {
  vec2 R = u_resolution;
  if (lay < 0.5) return vec4(0.0, 0.0, R.x, R.y);
  if (lay < 1.5) {
    float h = floor(R.y * 0.5);
    return eye < 0.5 ? vec4(0.0, 0.0, R.x, h) : vec4(0.0, h, R.x, R.y - h);
  }
  float w = floor(R.x * 0.5);
  return eye < 0.5 ? vec4(0.0, 0.0, w, R.y) : vec4(w, 0.0, R.x - w, R.y);
}
float eyeOf(float lay, vec2 p) {
  vec2 R = u_resolution;
  if (lay < 0.5) return 0.0;
  if (lay < 1.5) return p.y >= floor(R.y * 0.5) ? 1.0 : 0.0;
  return p.x >= floor(R.x * 0.5) ? 1.0 : 0.0;
}
vec4 texelAt(vec2 ip) { return texture(u_input, toUv(ip)); }

// Bilinear sample of an eye image at normalised (u, v): wrap in x, clamp in y.
vec4 sampleEq(vec4 r, vec2 uv) {
  float sx = uv.x * r.z - 0.5;
  float sy = uv.y * r.w - 0.5;
  float x0 = floor(sx);
  float y0 = floor(sy);
  float tx = sx - x0;
  float ty = sy - y0;
  float xa = mod(x0, r.z) + r.x;
  float xb = mod(x0 + 1.0, r.z) + r.x;
  float ya = clamp(y0, 0.0, r.w - 1.0) + r.y;
  float yb = clamp(y0 + 1.0, 0.0, r.w - 1.0) + r.y;
  vec4 a = texelAt(vec2(xa, ya));
  vec4 b = texelAt(vec2(xb, ya));
  vec4 c = texelAt(vec2(xa, yb));
  vec4 d = texelAt(vec2(xb, yb));
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}
// Same with colour weighted by alpha.
vec4 sampleEqP(vec4 r, vec2 uv) {
  float sx = uv.x * r.z - 0.5;
  float sy = uv.y * r.w - 0.5;
  float x0 = floor(sx);
  float y0 = floor(sy);
  float tx = sx - x0;
  float ty = sy - y0;
  float xa = mod(x0, r.z) + r.x;
  float xb = mod(x0 + 1.0, r.z) + r.x;
  float ya = clamp(y0, 0.0, r.w - 1.0) + r.y;
  float yb = clamp(y0 + 1.0, 0.0, r.w - 1.0) + r.y;
  vec4 t0 = texelAt(vec2(xa, ya));
  vec4 t1 = texelAt(vec2(xb, ya));
  vec4 t2 = texelAt(vec2(xa, yb));
  vec4 t3 = texelAt(vec2(xb, yb));
  float w0 = (1.0 - tx) * (1.0 - ty) * t0.a;
  float w1 = tx * (1.0 - ty) * t1.a;
  float w2 = (1.0 - tx) * ty * t2.a;
  float w3 = tx * ty * t3.a;
  float a = w0 + w1 + w2 + w3;
  vec3 rgb = (t0.rgb * w0 + t1.rgb * w1 + t2.rgb * w2 + t3.rgb * w3);
  return vec4(a > 0.0 ? rgb / a : vec3(0.0), a);
}
// Pixel-unit sample with seam wrap and reflection over the poles.
vec4 sampleSphere(vec4 r, vec2 pix) {
  float x = pix.x;
  float period = r.w * 2.0;
  float y = mod(pix.y + 0.5, period);
  if (y >= r.w) {
    y = period - y;
    x += r.z * 0.5;
  }
  y -= 0.5;
  return sampleEq(r, vec2((x + 0.5) / r.z, (y + 0.5) / r.w));
}
vec3 dirFromUv(vec2 uv) {
  float lon = (uv.x - 0.5) * 2.0 * PI;
  float lat = (0.5 - uv.y) * PI;
  float cl = cos(lat);
  return vec3(cl * sin(lon), sin(lat), cl * cos(lon));
}
vec2 uvFromDir(vec3 d) {
  float lon = (abs(d.x) + abs(d.z) < 1e-9) ? 0.0 : atan(d.x, d.z);
  return vec2(0.5 + lon / (2.0 * PI), 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
}
`;

export const MATRIX = `
uniform float u_m0; uniform float u_m1; uniform float u_m2;
uniform float u_m3; uniform float u_m4; uniform float u_m5;
uniform float u_m6; uniform float u_m7; uniform float u_m8;
// Row-major uniforms into a column-major mat3.
mat3 vrMatrix() { return mat3(u_m0, u_m3, u_m6, u_m1, u_m4, u_m7, u_m2, u_m5, u_m8); }
`;

const ROTATE_SPHERE = `${VR_HELPERS}${MATRIX}
uniform float u_layout;
void main() {
  vec2 p = pxPos();
  float eye = eyeOf(u_layout, p);
  vec4 r = eyeRect(u_layout, eye);
  vec2 uv = (p - r.xy + 0.5) / r.zw;
  vec3 s = vrMatrix() * dirFromUv(uv);
  vec4 c = sampleEq(r, uvFromDir(s));
  fragColor = emit(c.rgb, c.a);
}
`;

const PROJECTION = `${VR_HELPERS}${MATRIX}
uniform float u_layout;
uniform float u_projection;
uniform float u_fov;
uniform float u_aspect;
void main() {
  vec2 p = pxPos();
  vec2 R = u_resolution;
  vec4 rect;
  if (R.x / R.y >= u_aspect) {
    float w = R.y * u_aspect;
    rect = vec4((R.x - w) * 0.5, 0.0, w, R.y);
  } else {
    float h = R.x / u_aspect;
    rect = vec4(0.0, (R.y - h) * 0.5, R.x, h);
  }
  float s = (p.x + 0.5 - rect.x) / rect.z;
  float t = (p.y + 0.5 - rect.y) / rect.w;
  if (s < 0.0 || s > 1.0 || t < 0.0 || t > 1.0) { fragColor = vec4(0.0); return; }
  float asp = rect.z / rect.w;
  vec3 vd;
  if (u_projection < 0.5) {
    float k = tan(u_fov * DEG * 0.5);
    vd = normalize(vec3((s * 2.0 - 1.0) * k, (1.0 - t * 2.0) * (k / asp), 1.0));
  } else if (u_projection < 1.5) {
    float k = 2.0 * tan(u_fov * DEG * 0.25);
    float x = (s * 2.0 - 1.0) * k;
    float y = (1.0 - t * 2.0) * (k / asp);
    float r2 = x * x + y * y;
    float d = 4.0 + r2;
    vd = vec3(4.0 * x / d, 4.0 * y / d, (4.0 - r2) / d);
  } else {
    float x = s * 2.0 - 1.0;
    float y = (1.0 - t * 2.0) / asp;
    float rr = length(vec2(x, y));
    if (rr > 1.0) { fragColor = vec4(0.0); return; }
    float theta = rr * (u_fov * DEG * 0.5);
    float inv = rr > 1e-9 ? sin(theta) / rr : 0.0;
    vd = vec3(x * inv, y * inv, cos(theta));
  }
  vec4 src = eyeRect(u_layout, 0.0);
  vec4 c = sampleEq(src, uvFromDir(vrMatrix() * vd));
  fragColor = emit(c.rgb, c.a);
}
`;

const BLUR = `${VR_HELPERS}
uniform float u_layout;
uniform float u_degrees;
void main() {
  vec2 p = pxPos();
  float eye = eyeOf(u_layout, p);
  vec4 r = eyeRect(u_layout, eye);
  vec2 lp = p - r.xy;
  float radius = u_degrees / 360.0 * r.z;
  float count = min(64.0, max(16.0, ceil(radius * 2.0) + 8.0));
  float lat = (0.5 - (lp.y + 0.5) / r.w) * PI;
  float hs = 1.0 / max(cos(lat), 0.05);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= count) break;
    float rho = radius * sqrt((float(i) + 0.5) / count);
    float th = float(i) * 2.399963229728653;
    acc += sampleSphere(r, lp + vec2(rho * cos(th) * hs, rho * sin(th)));
  }
  vec4 c = acc / count;
  fragColor = emit(c.rgb, c.a);
}
`;

const PLANE_TO_SPHERE = `${VR_HELPERS}${MATRIX}
uniform float u_kTan;
void main() {
  vec2 p = pxPos();
  vec2 R = u_resolution;
  vec3 d = vrMatrix() * dirFromUv((p + 0.5) / R);
  if (d.z <= 1e-6) { fragColor = vec4(0.0); return; }
  float asp = R.x / R.y;
  float s = 0.5 + d.x / d.z / (2.0 * u_kTan);
  float t = 0.5 - (d.y / d.z) / (2.0 * (u_kTan / asp));
  if (s < 0.0 || s > 1.0 || t < 0.0 || t > 1.0) { fragColor = vec4(0.0); return; }
  float edge = 0.5 / R.x;
  s = clamp(s, edge, 1.0 - edge);
  vec4 c = sampleEqP(vec4(0.0, 0.0, R.x, R.y), vec2(s, t));
  fragColor = emit(c.rgb, c.a);
}
`;

export const VR_GLSL: Readonly<Record<VrProEffectType, string>> = {
  "vr-rotate-sphere": ROTATE_SPHERE,
  "vr-projection": PROJECTION,
  "vr-blur": BLUR,
  "vr-plane-to-sphere": PLANE_TO_SPHERE,
};
