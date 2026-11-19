/**
 * GLSL ES 3.00 ports of the wave 7 effects in pro-effects-extra.ts. Each
 * shader mirrors the CPU reference line for line (same pixel-space
 * coordinates, rounding and clamping); uniforms come from
 * extraProEffectGpuUniforms. Input is straight alpha, output is written
 * premultiplied by emit().
 */
import { PRELUDE } from "./pro-effect-prelude";
import type { ExtraProEffectType } from "./pro-effects-extra";
import { ULTRA_KEY_GLSL } from "./ultra-key-shader";
import { ULTRA_KEY_UNIFORM_NAMES } from "./ultra-key";

const HELPERS = `${PRELUDE}
float hashU(int a, int b, int c) {
  uint h = uint(a) * 374761393u + uint(b) * 668265263u;
  h += uint(c) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= (h >> 16u);
  return float(h) / 4294967296.0;
}
float distPct(vec3 a, vec3 k) { return length((a - k) * 255.0) / 441.6729559300637 * 100.0; }
float matchW(float dist, float tol, float soft) {
  if (soft <= 0.0) return dist <= tol ? 1.0 : 0.0;
  return 1.0 - clamp((dist - tol) / soft, 0.0, 1.0);
}
// Golden-angle disc average, n samples (n <= 96).
vec4 discAvg(vec2 p, float r, float n) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 96; i++) {
    if (float(i) >= n) break;
    float rho = r * sqrt((float(i) + 0.5) / n);
    float th = float(i) * 2.399963229728653;
    vec4 t = fetchCont(p + rho * vec2(cos(th), sin(th)));
    acc += vec4(t.rgb * t.a, t.a);
  }
  // Alpha-weighted colour so transparent texels (stored as rgb 0) never darken the edge.
  return vec4(acc.a > 0.0 ? acc.rgb / acc.a : vec3(0.0), acc.a / n);
}
// Strided gaussian: at most 13 taps per axis, bilinear between texels.
vec4 gblur(vec2 p, float r) {
  float sigma = max(0.1, r / 2.0);
  float extent = ceil(r);
  float stride = max(1.0, extent / 6.0);
  int taps = int(ceil(extent / stride));
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int j = -6; j <= 6; j++) {
    if (j < -taps || j > taps) continue;
    float dy = float(j) * stride;
    float wy = exp(-(dy * dy) / (2.0 * sigma * sigma));
    for (int i = -6; i <= 6; i++) {
      if (i < -taps || i > taps) continue;
      float dx = float(i) * stride;
      float w = wy * exp(-(dx * dx) / (2.0 * sigma * sigma));
      acc += fetchCont(p + vec2(dx, dy)) * w;
      wsum += w;
    }
  }
  return acc / wsum;
}
`;

const CAMERA_BLUR = `${HELPERS}
uniform float u_radius;
uniform float u_count;
void main() {
  vec2 p = pxPos();
  vec4 s = discAvg(p, u_radius, u_count);
  fragColor = emit(s.rgb, s.a);
}
`;

const CHANNEL_BLUR = `${HELPERS}
uniform float u_red;
uniform float u_green;
uniform float u_blue;
uniform float u_alpha;
void main() {
  vec2 p = pxPos();
  vec4 o = fetchPx(p);
  if (u_red >= 0.5) o.r = gblur(p, u_red).r;
  if (u_green >= 0.5) o.g = gblur(p, u_green).g;
  if (u_blue >= 0.5) o.b = gblur(p, u_blue).b;
  if (u_alpha >= 0.5) o.a = gblur(p, u_alpha).a;
  fragColor = emit(o.rgb, o.a);
}
`;

const TILT_SHIFT = `${HELPERS}
uniform float u_blur;
uniform float u_count;
uniform float u_nx;
uniform float u_ny;
uniform float u_shiftPct;
uniform float u_bandPct;
uniform float u_fadePct;
void main() {
  vec2 p = pxPos();
  vec2 c = (u_resolution - 1.0) * 0.5;
  float span = abs(u_resolution.x * u_nx) + abs(u_resolution.y * u_ny);
  float d = dot(p - c, vec2(u_nx, u_ny)) - u_shiftPct * span;
  float halfBand = u_bandPct * span * 0.5;
  float fade = max(u_fadePct * span * 0.5, 0.001);
  float r = u_blur * clamp((abs(d) - halfBand) / fade, 0.0, 1.0);
  vec4 s = r < 0.5 ? fetchPx(p) : discAvg(p, r, u_count);
  fragColor = emit(s.rgb, s.a);
}
`;

const LUMA_KEY = `${HELPERS}
uniform float u_dark;
uniform float u_threshold;
uniform float u_softness;
void main() {
  vec4 s = texture(u_input, vUv);
  float l = luma(s.rgb);
  float edge = u_dark > 0.5 ? l - u_threshold : u_threshold - l;
  float cov = u_softness <= 0.0 ? (edge >= 0.0 ? 1.0 : 0.0) : clamp(edge / u_softness, 0.0, 1.0);
  fragColor = emit(s.rgb, s.a * cov);
}
`;

const COLOR_KEY = `${HELPERS}
uniform float u_keyR;
uniform float u_keyG;
uniform float u_keyB;
uniform float u_tolerance;
uniform float u_softness;
uniform float u_invert;
void main() {
  vec4 s = texture(u_input, vUv);
  float cov = 1.0 - matchW(distPct(s.rgb, vec3(u_keyR, u_keyG, u_keyB)), u_tolerance, u_softness);
  if (u_invert > 0.5) cov = 1.0 - cov;
  fragColor = emit(s.rgb, s.a * cov);
}
`;

const ALPHA_ADJUST = `${HELPERS}
uniform float u_opacity;
uniform float u_ignore;
uniform float u_invert;
uniform float u_matte;
void main() {
  vec4 s = texture(u_input, vUv);
  float a = u_ignore > 0.5 ? 1.0 : s.a;
  if (u_invert > 0.5) a = 1.0 - a;
  a *= u_opacity;
  if (u_matte > 0.5) fragColor = vec4(vec3(clamp(a, 0.0, 1.0)), 1.0);
  else fragColor = emit(s.rgb, a);
}
`;

const LEAVE_COLOR = `${HELPERS}
uniform float u_keyR;
uniform float u_keyG;
uniform float u_keyB;
uniform float u_amount;
uniform float u_tolerance;
uniform float u_softness;
void main() {
  vec4 s = texture(u_input, vUv);
  float w = matchW(distPct(s.rgb, vec3(u_keyR, u_keyG, u_keyB)), u_tolerance, u_softness);
  fragColor = emit(mix(s.rgb, vec3(luma(s.rgb)), u_amount * (1.0 - w)), s.a);
}
`;

const CHANGE_TO_COLOR = `${HELPERS}
uniform float u_fromR;
uniform float u_fromG;
uniform float u_fromB;
uniform float u_dR;
uniform float u_dG;
uniform float u_dB;
uniform float u_tolerance;
uniform float u_softness;
void main() {
  vec4 s = texture(u_input, vUv);
  float w = matchW(distPct(s.rgb, vec3(u_fromR, u_fromG, u_fromB)), u_tolerance, u_softness);
  fragColor = emit(s.rgb + vec3(u_dR, u_dG, u_dB) * w, s.a);
}
`;

const SOLARIZE = `${HELPERS}
uniform float u_threshold;
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 m = vec3(greaterThan(s.rgb, vec3(u_threshold)));
  fragColor = emit(mix(s.rgb, 1.0 - s.rgb, m), s.a);
}
`;

const LEVELS = `${HELPERS}
uniform float u_inBlack;
uniform float u_inWhite;
uniform float u_invGamma;
uniform float u_outBlack;
uniform float u_outWhite;
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 v = clamp((s.rgb * 255.0 - u_inBlack) / max(u_inWhite - u_inBlack, 1.0), 0.0, 1.0);
  v = pow(v, vec3(u_invGamma));
  fragColor = emit((u_outBlack + (u_outWhite - u_outBlack) * v) / 255.0, s.a);
}
`;

const CHANNEL_MIXER = `${HELPERS}
uniform float u_mono;
uniform float u_rr;
uniform float u_rg;
uniform float u_rb;
uniform float u_gr;
uniform float u_gg;
uniform float u_gb;
uniform float u_br;
uniform float u_bg;
uniform float u_bb;
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 o = clamp(vec3(
    dot(vec3(u_rr, u_rg, u_rb), s.rgb),
    dot(vec3(u_gr, u_gg, u_gb), s.rgb),
    dot(vec3(u_br, u_bg, u_bb), s.rgb)), 0.0, 1.0);
  if (u_mono > 0.5) o = vec3(luma(o));
  fragColor = emit(o, s.a);
}
`;

const TINT_MAP = `${HELPERS}
uniform float u_blackR;
uniform float u_blackG;
uniform float u_blackB;
uniform float u_whiteR;
uniform float u_whiteG;
uniform float u_whiteB;
uniform float u_amount;
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 mapped = mix(vec3(u_blackR, u_blackG, u_blackB), vec3(u_whiteR, u_whiteG, u_whiteB), luma(s.rgb));
  fragColor = emit(mix(s.rgb, mapped, u_amount), s.a);
}
`;

const SPHERIZE = `${HELPERS}
uniform float u_e;
uniform float u_radiusPct;
uniform float u_cx;
uniform float u_cy;
void main() {
  vec2 p = pxPos();
  vec2 c = vec2(u_cx, u_cy) * (u_resolution - 1.0);
  float R = u_radiusPct * min(u_resolution.x, u_resolution.y) * 0.5;
  vec2 d = p - c;
  float r = length(d);
  vec2 q = p;
  if (r < R && r > 0.0) q = c + d * (R * pow(r / R, u_e) / r);
  vec4 s = fetchCont(q);
  fragColor = emit(s.rgb, s.a);
}
`;

const TWIRL = `${HELPERS}
uniform float u_angle;
uniform float u_radiusPct;
uniform float u_cx;
uniform float u_cy;
void main() {
  vec2 p = pxPos();
  vec2 c = vec2(u_cx, u_cy) * (u_resolution - 1.0);
  float R = u_radiusPct * min(u_resolution.x, u_resolution.y) * 0.5;
  vec2 d = p - c;
  float r = length(d);
  vec2 q = p;
  if (r < R) {
    float t = 1.0 - r / R;
    float th = u_angle * t * t;
    float cs = cos(th);
    float sn = sin(th);
    q = c + vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs);
  }
  vec4 s = fetchCont(q);
  fragColor = emit(s.rgb, s.a);
}
`;

const RIPPLE = `${HELPERS}
uniform float u_dx;
uniform float u_dy;
uniform float u_amp;
uniform float u_k;
uniform float u_phase;
void main() {
  vec2 p = pxPos();
  float disp = u_amp * sin(dot(p, vec2(u_dx, u_dy)) * u_k + u_phase);
  vec4 s = fetchCont(p + vec2(-u_dy, u_dx) * disp);
  fragColor = emit(s.rgb, s.a);
}
`;

const TURBULENT = `${HELPERS}
uniform float u_amount;
uniform float u_size;
uniform float u_octaves;
uniform float u_evo;
uniform float u_seed;
float vnoise(vec2 q, int seed, int salt) {
  vec2 i = floor(q);
  vec2 f = q - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  int xi = int(i.x);
  int yi = int(i.y);
  float a = hashU(seed + xi, yi, salt);
  float b = hashU(seed + xi + 1, yi, salt);
  float c = hashU(seed + xi, yi + 1, salt);
  float d = hashU(seed + xi + 1, yi + 1, salt);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float fbm(vec2 q, int seed, int salt, int oct) {
  float sum = 0.0;
  float norm = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int o = 0; o < 4; o++) {
    if (o >= oct) break;
    sum += amp * vnoise(q * freq, seed, salt + o * 2);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}
void main() {
  vec2 p = pxPos();
  vec2 g = p / u_size + u_evo;
  int seed = int(u_seed);
  int oct = int(u_octaves);
  vec2 q = p + vec2(fbm(g, seed, 0, oct) - 0.5, fbm(g, seed, 1000, oct) - 0.5) * 2.0 * u_amount;
  vec4 s = fetchCont(q);
  fragColor = emit(s.rgb, s.a);
}
`;

const OFFSET = `${HELPERS}
uniform float u_sxPct;
uniform float u_syPct;
uniform float u_mode;
void main() {
  vec2 p = pxPos();
  vec2 q = p - floor(vec2(u_sxPct, u_syPct) * u_resolution + 0.5);
  if (u_mode < 0.5) {
    q = mod(q, u_resolution);
  } else if (u_mode > 1.5) {
    if (q.x < 0.0 || q.x >= u_resolution.x || q.y < 0.0 || q.y >= u_resolution.y) {
      fragColor = vec4(0.0);
      return;
    }
  }
  vec4 s = fetchPx(q);
  fragColor = emit(s.rgb, s.a);
}
`;

const CORNER_PIN = `${HELPERS}
uniform float u_valid;
uniform float u_h0;
uniform float u_h1;
uniform float u_h2;
uniform float u_h3;
uniform float u_h4;
uniform float u_h5;
uniform float u_h6;
uniform float u_h7;
uniform float u_h8;
void main() {
  vec2 X = (pxPos() + 0.5) / u_resolution;
  float w = u_h6 * X.x + u_h7 * X.y + u_h8;
  if (u_valid < 0.5 || abs(w) <= 1e-9) { fragColor = vec4(0.0); return; }
  float u = (u_h0 * X.x + u_h1 * X.y + u_h2) / w;
  float v = (u_h3 * X.x + u_h4 * X.y + u_h5) / w;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) { fragColor = vec4(0.0); return; }
  vec4 s = fetchCont(vec2(u, v) * u_resolution - 0.5);
  fragColor = emit(s.rgb, s.a);
}
`;

const POLAR = `${HELPERS}
uniform float u_toPolar;
uniform float u_amount;
void main() {
  vec2 p = pxPos();
  vec2 c = (u_resolution - 1.0) * 0.5;
  float rmax = max(1e-6, length(c));
  vec2 m;
  if (u_toPolar > 0.5) {
    vec2 d = p - c;
    float ang = (d.x == 0.0 && d.y == 0.0) ? 0.0 : atan(d.y, d.x);
    m = vec2((ang / 6.283185307179586 + 0.5) * (u_resolution.x - 1.0), length(d) / rmax * (u_resolution.y - 1.0));
  } else {
    float th = (p.x / max(1.0, u_resolution.x - 1.0) - 0.5) * 6.283185307179586;
    float rho = p.y / max(1.0, u_resolution.y - 1.0) * rmax;
    m = c + rho * vec2(cos(th), sin(th));
  }
  vec4 s = fetchCont(mix(p, m, u_amount));
  fragColor = emit(s.rgb, s.a);
}
`;

const REPLICATE = `${HELPERS}
uniform float u_count;
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(mod(p * u_count, u_resolution));
  fragColor = emit(s.rgb, s.a);
}
`;

const COLOR_EMBOSS = `${HELPERS}
uniform float u_dx;
uniform float u_dy;
uniform float u_k;
void main() {
  vec2 p = pxPos();
  vec2 d = vec2(u_dx, u_dy);
  vec4 s = fetchPx(p);
  vec3 a = fetchPx(floor(p + d + 0.5)).rgb;
  vec3 b = fetchPx(floor(p - d + 0.5)).rgb;
  fragColor = emit(s.rgb + (a - b) * u_k, s.a);
}
`;

const NOISE = `${HELPERS}
uniform float u_amt;
uniform float u_size;
uniform float u_mono;
uniform float u_frame;
uniform float u_seed;
void main() {
  vec2 p = pxPos();
  int sz = int(u_size);
  int bx = int(p.x) / sz;
  int by = int(p.y) / sz;
  int seed = int(u_seed);
  int frame = int(u_frame);
  vec4 s = fetchPx(p);
  vec3 nz = vec3(0.0);
  for (int ch = 0; ch < 3; ch++) {
    int salt = u_mono > 0.5 ? 0 : ch * 7919;
    nz[ch] = (hashU(seed + salt + bx, frame, by) * 2.0 - 1.0) * u_amt;
  }
  fragColor = emit(s.rgb + nz, s.a);
}
`;

const BEVEL_ALPHA = `${HELPERS}
uniform float u_thickness;
uniform float u_dx;
uniform float u_dy;
uniform float u_intensity;
float alphaAt(vec2 q) {
  if (q.x < 0.0 || q.x >= u_resolution.x || q.y < 0.0 || q.y >= u_resolution.y) return 0.0;
  return fetchPx(q).a;
}
void main() {
  vec2 p = pxPos();
  vec2 d = vec2(u_dx, u_dy);
  float g = 0.0;
  for (int k = 1; k <= 4; k++) {
    float off = u_thickness * float(k) / 4.0;
    g += alphaAt(floor(p - d * off + 0.5)) - alphaAt(floor(p + d * off + 0.5));
  }
  vec4 s = fetchPx(p);
  g = g / 4.0 * s.a;
  vec3 target = g > 0.0 ? 1.0 - s.rgb : s.rgb;
  fragColor = emit(s.rgb + g * u_intensity * target, s.a);
}
`;

const FOUR_COLOR = `${HELPERS}
uniform float u_c1R;
uniform float u_c1G;
uniform float u_c1B;
uniform float u_c2R;
uniform float u_c2G;
uniform float u_c2B;
uniform float u_c3R;
uniform float u_c3G;
uniform float u_c3B;
uniform float u_c4R;
uniform float u_c4G;
uniform float u_c4B;
uniform float u_opacity;
uniform float u_blend;
void main() {
  vec2 p = pxPos();
  vec2 uv = (p + 0.5) / u_resolution;
  vec3 top = mix(vec3(u_c1R, u_c1G, u_c1B), vec3(u_c2R, u_c2G, u_c2B), uv.x);
  vec3 bot = mix(vec3(u_c3R, u_c3G, u_c3B), vec3(u_c4R, u_c4G, u_c4B), uv.x);
  vec3 g = mix(top, bot, uv.y);
  vec4 s = fetchPx(p);
  vec3 mixed = g;
  if (u_blend > 2.5) mixed = min(s.rgb + g, 1.0);
  else if (u_blend > 1.5) mixed = 1.0 - (1.0 - s.rgb) * (1.0 - g);
  else if (u_blend > 0.5) mixed = s.rgb * g;
  fragColor = emit(mix(s.rgb, mixed, u_opacity), s.a);
}
`;

const LENS_FLARE = `${HELPERS}
uniform float u_cx;
uniform float u_cy;
uniform float u_light;
uniform float u_sizePct;
vec3 ghost(vec2 p, vec2 f, vec2 a, float t, float r, float i, vec3 c, float s) {
  float gd = length(p - (f + a * t));
  float rr = r * s;
  return i * exp(-(gd / rr) * (gd / rr)) * c;
}
void main() {
  vec2 p = pxPos();
  float s = u_sizePct * 0.06 * min(u_resolution.x, u_resolution.y);
  vec2 f = vec2(u_cx, u_cy) * u_resolution;
  float d = length(p - f);
  float core = exp(-(d / s) * (d / s));
  float halo = 0.35 * exp(-(d / (4.0 * s)) * (d / (4.0 * s)));
  float rg = (d - 5.0 * s) / (0.6 * s);
  float ring = 0.25 * exp(-rg * rg);
  vec3 col = core * vec3(1.0, 0.93, 0.8) + halo * vec3(1.0, 0.75, 0.45) + ring * vec3(0.6, 0.8, 1.0);
  vec2 a = u_resolution * 0.5 - f;
  col += ghost(p, f, a, 0.55, 0.9, 0.3, vec3(0.4, 1.0, 0.6), s);
  col += ghost(p, f, a, 1.0, 0.5, 0.22, vec3(1.0, 0.6, 0.5), s);
  col += ghost(p, f, a, 1.45, 1.3, 0.16, vec3(0.5, 0.6, 1.0), s);
  vec4 src = fetchPx(p);
  fragColor = emit(src.rgb + col * u_light, src.a);
}
`;

const STROBE = `${HELPERS}
uniform float u_flashR;
uniform float u_flashG;
uniform float u_flashB;
uniform float u_opacity;
uniform float u_on;
uniform float u_add;
void main() {
  vec4 s = texture(u_input, vUv);
  vec3 rgb = s.rgb;
  if (u_on > 0.5) {
    vec3 col = vec3(u_flashR, u_flashG, u_flashB);
    rgb = u_add > 0.5 ? s.rgb + col * u_opacity : mix(s.rgb, col, u_opacity);
  }
  fragColor = emit(rgb, s.a);
}
`;

const GRID = `${HELPERS}
uniform float u_size;
uniform float u_border;
uniform float u_lineR;
uniform float u_lineG;
uniform float u_lineB;
uniform float u_opacity;
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  vec3 rgb = s.rgb;
  if (mod(p.x, u_size) < u_border || mod(p.y, u_size) < u_border) {
    rgb = mix(s.rgb, vec3(u_lineR, u_lineG, u_lineB), u_opacity);
  }
  fragColor = emit(rgb, s.a);
}
`;

export const EXTRA_GLSL: Readonly<Record<ExtraProEffectType, string>> = {
  "camera-blur": CAMERA_BLUR,
  "channel-blur": CHANNEL_BLUR,
  "tilt-shift": TILT_SHIFT,
  "luma-key": LUMA_KEY,
  "color-key": COLOR_KEY,
  "ultra-key": ULTRA_KEY_GLSL,
  "alpha-adjust": ALPHA_ADJUST,
  "leave-color": LEAVE_COLOR,
  "change-to-color": CHANGE_TO_COLOR,
  solarize: SOLARIZE,
  levels: LEVELS,
  "channel-mixer": CHANNEL_MIXER,
  "tint-map": TINT_MAP,
  spherize: SPHERIZE,
  twirl: TWIRL,
  ripple: RIPPLE,
  "turbulent-displace": TURBULENT,
  offset: OFFSET,
  "corner-pin": CORNER_PIN,
  "polar-coordinates": POLAR,
  replicate: REPLICATE,
  "color-emboss": COLOR_EMBOSS,
  noise: NOISE,
  "bevel-alpha": BEVEL_ALPHA,
  "four-color-gradient": FOUR_COLOR,
  "lens-flare": LENS_FLARE,
  "strobe-light": STROBE,
  grid: GRID,
};

const h = (): string[] => Array.from({ length: 9 }, (_, i) => `h${i}`);
const ch = (...names: string[]): string[] => names;

/** Uniform names (without `u_`) each extra shader consumes. */
export const EXTRA_UNIFORMS: Readonly<Record<ExtraProEffectType, readonly string[]>> = {
  "camera-blur": ["radius", "count"],
  "channel-blur": ["red", "green", "blue", "alpha"],
  "tilt-shift": ["blur", "count", "nx", "ny", "shiftPct", "bandPct", "fadePct"],
  "luma-key": ["dark", "threshold", "softness"],
  "color-key": ["keyR", "keyG", "keyB", "tolerance", "softness", "invert"],
  "ultra-key": ULTRA_KEY_UNIFORM_NAMES,
  "alpha-adjust": ["opacity", "ignore", "invert", "matte"],
  "leave-color": ["keyR", "keyG", "keyB", "amount", "tolerance", "softness"],
  "change-to-color": ["fromR", "fromG", "fromB", "dR", "dG", "dB", "tolerance", "softness"],
  solarize: ["threshold"],
  levels: ["inBlack", "inWhite", "invGamma", "outBlack", "outWhite"],
  "channel-mixer": ["mono", "rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"],
  "tint-map": ["blackR", "blackG", "blackB", "whiteR", "whiteG", "whiteB", "amount"],
  spherize: ["e", "radiusPct", "cx", "cy"],
  twirl: ["angle", "radiusPct", "cx", "cy"],
  ripple: ["dx", "dy", "amp", "k", "phase"],
  "turbulent-displace": ["amount", "size", "octaves", "evo", "seed"],
  offset: ["sxPct", "syPct", "mode"],
  "corner-pin": ["valid", ...h()],
  "polar-coordinates": ["toPolar", "amount"],
  replicate: ["count"],
  "color-emboss": ["dx", "dy", "k"],
  noise: ["amt", "size", "mono", "frame", "seed"],
  "bevel-alpha": ["thickness", "dx", "dy", "intensity"],
  "four-color-gradient": [
    ...ch("c1R", "c1G", "c1B", "c2R", "c2G", "c2B", "c3R", "c3G", "c3B", "c4R", "c4G", "c4B"),
    "opacity",
    "blend",
  ],
  "lens-flare": ["cx", "cy", "light", "sizePct"],
  "strobe-light": ["flashR", "flashG", "flashB", "opacity", "on", "add"],
  grid: ["size", "border", "lineR", "lineG", "lineB", "opacity"],
};
