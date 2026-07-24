import type { MotionShaderDef } from "./types";

const LIQUID_METAL_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_speed;
uniform float u_contrast;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * valueNoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  float scale = max(u_scale, 1.0);
  vec2 p = vUv * scale;
  float flow = u_time * u_speed;
  float field = fbm(p + vec2(flow, flow * 0.5));
  field += 0.4 * sin((p.x + p.y) * 1.5 + field * 6.2831 + flow);
  float ramp = 0.5 + 0.5 * sin(field * 6.2831 * u_contrast);
  float metal = pow(clamp(ramp, 0.0, 1.0), 1.6);
  vec3 color = mix(vec3(0.08, 0.09, 0.11), vec3(0.92, 0.94, 0.98), metal);
  fragColor = vec4(color, 1.0);
}
`;

const WATERCOLOR_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_bleed;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(91.73, 53.41));
  p += dot(p, p + 21.97);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  float scale = max(u_scale, 1.0);
  vec2 p = vUv * scale;
  float bleed = clamp(u_bleed, 0.0, 1.0);
  float base = valueNoise(p);
  float mid = valueNoise(p * 2.0 + 7.3);
  float fine = valueNoise(p * 4.0 + 19.1);
  float mottle = base * 0.55 + mid * 0.3 + fine * 0.15;
  float soft = mix(mottle, smoothstep(0.2, 0.8, mottle), bleed);
  vec3 paper = mix(vec3(0.97, 0.96, 0.92), vec3(0.74, 0.78, 0.86), soft);
  fragColor = vec4(paper, 1.0);
}
`;

const GRADIENT_NOISE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform float u_warp;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.45);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  float scale = max(u_scale, 1.0);
  float warp = clamp(u_warp, 0.0, 1.0);
  vec2 p = vUv * scale;
  vec2 offset = vec2(valueNoise(p + 1.7), valueNoise(p + 9.2));
  vec2 warped = p + warp * (offset - 0.5) * 4.0;
  float field = valueNoise(warped);
  vec3 lo = vec3(0.12, 0.20, 0.45);
  vec3 hi = vec3(0.95, 0.55, 0.30);
  vec3 color = mix(lo, hi, clamp(field, 0.0, 1.0));
  fragColor = vec4(color, 1.0);
}
`;

export const FILL_SHADERS: readonly MotionShaderDef[] = [
  {
    id: "liquid-metal",
    name: "Liquid Metal",
    category: "fill",
    glsl: LIQUID_METAL_GLSL,
    params: [
      { name: "scale", label: "Scale", type: "number", default: 6, min: 1, max: 20, step: 0.5, control: "number" },
      { name: "speed", label: "Speed", type: "number", default: 0, min: 0, max: 2, step: 0.05, control: "number" },
      { name: "contrast", label: "Contrast", type: "number", default: 1.4, min: 0.5, max: 3, step: 0.1, control: "number" },
    ],
  },
  {
    id: "watercolor",
    name: "Watercolor",
    category: "fill",
    glsl: WATERCOLOR_GLSL,
    params: [
      { name: "scale", label: "Scale", type: "number", default: 5, min: 1, max: 16, step: 0.5, control: "number" },
      { name: "bleed", label: "Bleed", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, control: "slider" },
    ],
  },
  {
    id: "gradient-noise",
    name: "Gradient Noise",
    category: "fill",
    glsl: GRADIENT_NOISE_GLSL,
    params: [
      { name: "scale", label: "Scale", type: "number", default: 8, min: 1, max: 24, step: 0.5, control: "number" },
      { name: "warp", label: "Warp", type: "number", default: 0.4, min: 0, max: 1, step: 0.05, control: "slider" },
    ],
  },
];
