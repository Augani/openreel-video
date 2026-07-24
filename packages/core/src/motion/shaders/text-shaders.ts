import type { MotionShaderDef } from "./types";

const GLYPH_DISSOLVE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform float u_time;
uniform float u_progress;
uniform float u_edgeWidth;
uniform float u_scale;
out vec4 fragColor;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
void main(){
  vec4 src = texture(u_input, vUv);
  float n = vnoise(vUv * u_scale + u_time * 0.05);
  float edge = max(u_edgeWidth, 0.001);
  float reveal = smoothstep(n - edge, n + edge, u_progress);
  fragColor = vec4(src.rgb, src.a * reveal);
}
`;

const GLYPH_GLOW_WAVE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_progress;
uniform float u_glow;
uniform float u_softness;
out vec4 fragColor;
void main(){
  vec4 src = texture(u_input, vUv);
  float softness = clamp(u_softness, 0.0, 1.0);
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  float radius = 1.0 + softness * 3.0;
  float coverage = 0.0;
  coverage += texture(u_input, vUv + texel * vec2(radius, 0.0)).a;
  coverage += texture(u_input, vUv - texel * vec2(radius, 0.0)).a;
  coverage += texture(u_input, vUv + texel * vec2(0.0, radius)).a;
  coverage += texture(u_input, vUv - texel * vec2(0.0, radius)).a;
  coverage += texture(u_input, vUv + texel * radius).a;
  coverage += texture(u_input, vUv - texel * radius).a;
  coverage *= 0.16666667;
  float peak = sin(clamp(u_progress, 0.0, 1.0) * 3.14159265);
  float glow = max(u_glow, 0.0) * peak;
  vec3 lit = src.rgb + src.rgb * glow;
  float halo = coverage * glow;
  vec3 color = lit + vec3(halo);
  float alpha = clamp(src.a + halo, 0.0, 1.0);
  fragColor = vec4(color, alpha);
}
`;

const CHROMATIC_CASCADE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform float u_progress;
uniform float u_amount;
out vec4 fragColor;
void main(){
  float p = clamp(u_progress, 0.0, 1.0);
  float split = max(u_amount, 0.0) * (1.0 - p);
  vec2 shift = vec2(split, 0.0);
  float r = texture(u_input, vUv + shift).r;
  vec4 g = texture(u_input, vUv);
  float b = texture(u_input, vUv - shift).b;
  float alpha = max(g.a, max(texture(u_input, vUv + shift).a, texture(u_input, vUv - shift).a));
  fragColor = vec4(r, g.g, b, alpha);
}
`;

const SCANLINE_MATERIALIZE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_progress;
uniform float u_lines;
uniform float u_jitter;
out vec4 fragColor;
float hash(float x){ return fract(sin(x * 78.233) * 43758.5453); }
void main(){
  vec4 src = texture(u_input, vUv);
  float p = clamp(u_progress, 0.0, 1.0);
  float lines = max(u_lines, 1.0);
  float jitter = clamp(u_jitter, 0.0, 1.0);
  float row = floor(vUv.y * lines);
  float flicker = (hash(row + floor(u_time * 30.0)) - 0.5) * jitter;
  float fade = smoothstep(0.0, 0.15, p) * smoothstep(0.0, 0.15, 1.0 - p);
  float thr = clamp(p + flicker * fade, 0.0, 1.0);
  float reveal = step(vUv.y, thr);
  fragColor = vec4(src.rgb, src.a * reveal);
}
`;

export const TEXT_SHADERS: readonly MotionShaderDef[] = [
  {
    id: "glyph-dissolve",
    name: "Glyph Dissolve",
    category: "text",
    glsl: GLYPH_DISSOLVE_GLSL,
    params: [
      { name: "edgeWidth", label: "Edge Width", type: "number", default: 0.15, min: 0, max: 1, step: 0.01, control: "slider" },
      { name: "scale", label: "Scale", type: "number", default: 12, min: 2, max: 40, step: 1, control: "number" },
    ],
  },
  {
    id: "glyph-glow-wave",
    name: "Glyph Glow Wave",
    category: "text",
    glsl: GLYPH_GLOW_WAVE_GLSL,
    params: [
      { name: "glow", label: "Glow", type: "number", default: 1.4, min: 0, max: 3, step: 0.1, control: "number" },
      { name: "softness", label: "Softness", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, control: "slider" },
    ],
  },
  {
    id: "chromatic-cascade",
    name: "Chromatic Cascade",
    category: "text",
    glsl: CHROMATIC_CASCADE_GLSL,
    params: [
      { name: "amount", label: "Amount", type: "number", default: 0.03, min: 0, max: 0.1, step: 0.005, control: "slider" },
    ],
  },
  {
    id: "scanline-materialize",
    name: "Scanline Materialize",
    category: "text",
    glsl: SCANLINE_MATERIALIZE_GLSL,
    params: [
      { name: "lines", label: "Lines", type: "number", default: 80, min: 10, max: 200, step: 5, control: "number" },
      { name: "jitter", label: "Jitter", type: "number", default: 0.3, min: 0, max: 1, step: 0.05, control: "slider" },
    ],
  },
];
