/**
 * GLSL ES 3.00 ports of Lumetri Creative and Lens Correction
 * (creative-effects.ts). Each shader mirrors the CPU reference line for line;
 * uniforms come from creativeProEffectGpuUniforms. Input is straight alpha,
 * output is written premultiplied by emit().
 */
import { PRELUDE } from "./pro-effect-prelude";
import type { CreativeProEffectType } from "./creative-effects";

const LUMETRI_CREATIVE = `${PRELUDE}
uniform float u_lift;
uniform float u_sharpen;
uniform float u_vibrance;
uniform float u_shR;
uniform float u_shG;
uniform float u_shB;
uniform float u_hiR;
uniform float u_hiG;
uniform float u_hiB;
uniform float u_pivot;
float sstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float hueDeg(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  if (d <= 0.0) return 0.0;
  float h;
  if (mx == c.r) {
    h = (c.g - c.b) / d;
    if (h < 0.0) h += 6.0;
  } else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return h * 60.0;
}
float skinWeight(float h) {
  float dh = abs(mod(mod(h - 25.0 + 180.0, 360.0) + 360.0, 360.0) - 180.0);
  return 1.0 - sstep(20.0, 50.0, dh);
}
void main() {
  vec2 p = pxPos();
  vec4 s = fetchPx(p);
  vec3 c = s.rgb;
  if (u_sharpen > 0.0) {
    float blur = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
        blur += luma(fetchPx(p + vec2(float(i), float(j))).rgb) * w;
      }
    }
    blur /= 16.0;
    c = clamp(c + u_sharpen * (luma(c) - blur), 0.0, 1.0);
  }
  if (u_lift > 0.0) c = u_lift + c * (1.0 - u_lift);
  if (u_vibrance != 0.0) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
    float protect = 1.0 - 0.8 * skinWeight(hueDeg(c));
    float k = 1.0 + (u_vibrance > 0.0 ? u_vibrance * (1.0 - sat) : u_vibrance * sat) * protect;
    float y = luma(c);
    c = y + (c - y) * k;
  }
  vec3 sh = vec3(u_shR, u_shG, u_shB);
  vec3 hi = vec3(u_hiR, u_hiG, u_hiB);
  if (sh != vec3(0.0) || hi != vec3(0.0)) {
    float y = clamp(luma(c), 0.0, 1.0);
    float ws = 1.0 - sstep(0.0, u_pivot, y);
    float wh = sstep(u_pivot, 1.0, y);
    c += sh * ws + hi * wh;
  }
  fragColor = emit(c, s.a);
}
`;

const LENS_CORRECTION = `${PRELUDE}
uniform float u_k1;
uniform float u_k2;
uniform float u_p1;
uniform float u_p2;
uniform float u_invScale;
uniform float u_redScale;
uniform float u_blueScale;
uniform float u_vig;
void main() {
  vec2 hf = u_resolution * 0.5;
  float norm = length(u_resolution) * 0.5;
  vec2 q = ((pxPos() + 0.5 - hf) / norm) * u_invScale;
  float r2 = dot(q, q);
  float radial = 1.0 + u_k1 * r2 + u_k2 * r2 * r2;
  vec2 d = vec2(
    q.x * radial + 2.0 * u_p1 * q.x * q.y + u_p2 * (r2 + 2.0 * q.x * q.x),
    q.y * radial + u_p1 * (r2 + 2.0 * q.y * q.y) + 2.0 * u_p2 * q.x * q.y
  );
  vec4 g = fetchCont(hf + d * norm - 0.5);
  float rr = fetchCont(hf + d * (norm * u_redScale) - 0.5).r;
  float bb = fetchCont(hf + d * (norm * u_blueScale) - 0.5).b;
  float gain = 1.0 + u_vig * dot(d, d);
  fragColor = emit(vec3(rr, g.g, bb) * gain, g.a);
}
`;

export const CREATIVE_GLSL: Readonly<Record<CreativeProEffectType, string>> = {
  "lumetri-creative": LUMETRI_CREATIVE,
  "lens-correction": LENS_CORRECTION,
};

/** Uniform names (without the `u_` prefix) each shader consumes. */
export const CREATIVE_UNIFORMS: Readonly<Record<CreativeProEffectType, readonly string[]>> = {
  "lumetri-creative": ["lift", "sharpen", "vibrance", "shR", "shG", "shB", "hiR", "hiG", "hiB", "pivot"],
  "lens-correction": ["k1", "k2", "p1", "p2", "invScale", "redScale", "blueScale", "vig"],
};
