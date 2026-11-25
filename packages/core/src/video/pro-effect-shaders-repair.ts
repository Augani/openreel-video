/**
 * GLSL ES 3.00 ports of the repair effects in repair-effects.ts (Dehaze,
 * Deflicker, Deband). Each shader mirrors the CPU reference line for line (same
 * pixel-space sample positions, rounding and clamping); uniforms come from
 * repairProEffectGpuUniforms. Input is straight alpha, output is written
 * premultiplied by emit().
 */
import { PRELUDE } from "./pro-effect-prelude";
import type { RepairProEffectType } from "./repair-effects";

const DEHAZE = `${PRELUDE}
uniform float u_amount;
uniform float u_step;
uniform float u_sky;
float sstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  if (u_amount == 0.0) { fragColor = emit(s.rgb, s.a); return; }
  // Atmospheric light: colour of the sample of an 8x8 grid with the brightest darkest channel.
  float best = -1.0;
  vec3 light = vec3(1.0);
  for (int j = 0; j < 8; j++) {
    for (int i = 0; i < 8; i++) {
      vec2 q = min(floor((vec2(float(i), float(j)) + 0.5) / 8.0 * u_resolution), u_resolution - 1.0);
      vec3 c = fetchPx(q).rgb;
      float m = min(c.r, min(c.g, c.b));
      if (m > best) { best = m; light = c; }
    }
  }
  light = max(light, vec3(0.55));
  if (u_amount < 0.0) {
    float h = -u_amount * 0.6;
    fragColor = emit(s.rgb * (1.0 - h) + light * h, s.a);
    return;
  }
  float omega = 0.95 * u_amount;
  float mn = 1.0;
  float sum = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 off = floor(vec2(float(i), float(j)) * u_step + 0.5);
      vec3 c = fetchPx(p + off).rgb / light;
      float v = min(c.r, min(c.g, c.b));
      mn = min(mn, v);
      sum += v;
    }
  }
  float d = clamp(mn + (sum / 25.0 - mn) * 0.35, 0.0, 1.0);
  float t = max(1.0 - omega * d, 0.25);
  t = t + (1.0 - t) * (u_sky * sstep(0.8, 0.98, d));
  fragColor = emit((s.rgb - light) / t + light, s.a);
}
`;

const DEFLICKER = `${PRELUDE}
uniform float u_gr;
uniform float u_gg;
uniform float u_gb;
void main() {
  vec4 c = texture(u_input, vUv);
  fragColor = emit(c.rgb * vec3(u_gr, u_gg, u_gb), c.a);
}
`;

const DEBAND = `${PRELUDE}
uniform float u_thr;
uniform float u_radius;
uniform float u_iters;
uniform float u_amp;
float hashU(int a, int b, int c) {
  uint h = uint(a) * 374761393u + uint(b) * 668265263u;
  h += uint(c) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= (h >> 16u);
  return float(h) / 4294967296.0;
}
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  vec3 c = s.rgb;
  int px = int(p.x);
  int py = int(p.y);
  if (u_thr > 0.0) {
    for (int it = 1; it <= 4; it++) {
      if (float(it) > u_iters) break;
      float theta = hashU(px, py, 2 * it) * 6.283185307179586;
      float rho = max(1.0, u_radius * (float(it) / u_iters) * (0.5 + 0.5 * hashU(px, py, 2 * it + 1)));
      vec2 d = vec2(cos(theta), sin(theta)) * rho;
      vec2 e = vec2(-d.y, d.x);
      vec3 t0 = fetchPx(floor(p + d + 0.5)).rgb;
      vec3 t1 = fetchPx(floor(p - d + 0.5)).rgb;
      vec3 t2 = fetchPx(floor(p + e + 0.5)).rgb;
      vec3 t3 = fetchPx(floor(p - e + 0.5)).rgb;
      vec3 m = max(max(abs(t0 - c), abs(t1 - c)), max(abs(t2 - c), abs(t3 - c)));
      if (max(m.r, max(m.g, m.b)) < u_thr) c = (t0 + t1 + t2 + t3) * 0.25;
    }
  }
  if (u_amp > 0.0) c += (hashU(px, py, 977) * 2.0 - 1.0) * u_amp;
  fragColor = emit(c, s.a);
}
`;

export const REPAIR_GLSL: Readonly<Record<RepairProEffectType, string>> = {
  dehaze: DEHAZE,
  deflicker: DEFLICKER,
  deband: DEBAND,
};

/** Uniform names (without the `u_` prefix) each shader consumes. */
export const REPAIR_UNIFORMS: Readonly<Record<RepairProEffectType, readonly string[]>> = {
  dehaze: ["amount", "step", "sky"],
  deflicker: ["gr", "gg", "gb"],
  deband: ["thr", "radius", "iters", "amp"],
};
