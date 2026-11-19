/**
 * GLSL ES 3.00 port of the Ultra Key math in ultra-key.ts. Matte cleanup
 * (choke then soften) recomputes the raw matte at each neighbour tap, so the
 * result is the same nested minimum / mean the CPU reference computes over
 * its matte planes. Input is straight alpha, output is premultiplied by emit().
 */
import { PRELUDE } from "./pro-effect-prelude";

export const ULTRA_KEY_GLSL = `${PRELUDE}
uniform float u_kCb;
uniform float u_kCr;
uniform float u_kLuma;
uniform float u_core;
uniform float u_band;
uniform float u_hasKey;
uniform float u_highlight;
uniform float u_shadow;
uniform float u_pedestal;
uniform float u_chokeRadius;
uniform float u_softenRadius;
uniform float u_contrastGain;
uniform float u_midPoint;
uniform float u_uCb;
uniform float u_uCr;
uniform float u_spill;
uniform float u_desaturate;
uniform float u_cosIn;
uniform float u_cosOut;
uniform float u_rangeOn;
uniform float u_lumaRestore;
uniform float u_satGain;
uniform float u_hueCos;
uniform float u_hueSin;
uniform float u_lumGain;
uniform float u_colorActive;
uniform float u_output;

const float KB = 0.564;
const float KR = 0.713;
const float GOLDEN = 2.399963229728653;

float baseMatte(vec3 c) {
  if (u_hasKey < 0.5) return 1.0;
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  float ys = max(y, 0.15);
  float d = length(vec2(((c.b - y) * KB) / ys - u_kCb, ((c.r - y) * KR) / ys - u_kCr));
  float keyed = u_band > 0.0 ? clamp(1.0 - (d - u_core) / u_band, 0.0, 1.0) : (d <= u_core ? 1.0 : 0.0);
  float ratio = y / u_kLuma;
  keyed *= (1.0 - u_highlight * smoothstep(1.15, 1.75, ratio)) * (1.0 - u_shadow * (1.0 - smoothstep(0.1, 0.6, ratio)));
  return clamp((1.0 - keyed - u_pedestal) / (1.0 - u_pedestal), 0.0, 1.0);
}
float matteAt(vec2 p) { return baseMatte(fetchPx(p).rgb); }
float kernelCount(float radius, float mx) { return min(mx, max(6.0, ceil(radius * 2.0) + 4.0)); }
vec2 offs(float i, float n, float radius) {
  float rho = radius * sqrt((i + 0.5) / n);
  float th = i * GOLDEN;
  return floor(vec2(rho * cos(th), rho * sin(th)) + 0.5);
}
// Choke: minimum of the matte over the disc.
float choked(vec2 p) {
  float acc = matteAt(p);
  float r = u_chokeRadius * u_resolution.y / 1080.0;
  if (r <= 0.0) return acc;
  float n = kernelCount(r, 12.0);
  for (int i = 0; i < 12; i++) {
    if (float(i) >= n) break;
    acc = min(acc, matteAt(p + offs(float(i), n, r)));
  }
  return acc;
}
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  if (u_output > 2.5) { fragColor = emit(s.rgb, s.a); return; }
  float a = choked(p);
  float sr = u_softenRadius * u_resolution.y / 1080.0;
  if (sr > 0.0) {
    float n = kernelCount(sr, 16.0);
    float acc = a;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= n) break;
      acc += choked(clamp(p + offs(float(i), n, sr), vec2(0.0), u_resolution - 1.0));
    }
    a = acc / (n + 1.0);
  }
  if (u_contrastGain != 1.0) a = clamp((a - u_midPoint) * u_contrastGain + u_midPoint, 0.0, 1.0);
  if (u_output > 0.5 && u_output < 1.5) { fragColor = vec4(vec3(clamp(a * s.a, 0.0, 1.0)), 1.0); return; }
  vec3 rgb = s.rgb;
  if (u_colorActive > 0.5) {
    float y = dot(rgb, vec3(0.299, 0.587, 0.114));
    float cb = (rgb.b - y) * KB;
    float cr = (rgb.r - y) * KR;
    if (u_rangeOn > 0.5) {
      float mag = length(vec2(cb, cr));
      float proj = cb * u_uCb + cr * u_uCr;
      if (mag > 1e-5 && proj > 0.0) {
        float w = clamp((proj / mag - u_cosOut) / (u_cosIn - u_cosOut + 1e-6), 0.0, 1.0);
        float hw = w * w * (3.0 - 2.0 * w);
        float rem = proj * u_spill * hw;
        cb -= u_uCb * rem;
        cr -= u_uCr * rem;
        float f = 1.0 - u_desaturate * hw * (1.0 - a);
        cb *= f;
        cr *= f;
        y += u_lumaRestore * rem;
      }
    }
    float rotCb = cb * u_hueCos - cr * u_hueSin;
    float rotCr = cb * u_hueSin + cr * u_hueCos;
    cb = rotCb * u_satGain;
    cr = rotCr * u_satGain;
    y *= u_lumGain;
    float nr = y + cr / KR;
    float nb = y + cb / KB;
    float ng = (y - 0.299 * nr - 0.114 * nb) / 0.587;
    rgb = clamp(vec3(nr, ng, nb), 0.0, 1.0);
  }
  float alpha = u_output < 0.5 ? s.a * a : s.a;
  fragColor = emit(rgb, alpha);
}
`;
