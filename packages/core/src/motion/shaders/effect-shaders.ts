import type { MotionShaderDef } from "./types";

const DITHER_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_levels;
uniform float u_scale;
out vec4 fragColor;

const float bayer[16] = float[16](
  0.0, 8.0, 2.0, 10.0,
  12.0, 4.0, 14.0, 6.0,
  3.0, 11.0, 1.0, 9.0,
  15.0, 7.0, 13.0, 5.0
);

float bayerValue(vec2 pixel) {
  int x = int(mod(pixel.x, 4.0));
  int y = int(mod(pixel.y, 4.0));
  return bayer[y * 4 + x] / 16.0;
}

void main() {
  vec4 src = texture(u_input, vUv);
  float scale = max(u_scale, 1.0);
  float levels = max(u_levels, 2.0);
  vec2 pixel = floor((vUv * u_resolution) / scale);
  float threshold = bayerValue(pixel) - 0.5;
  vec3 scaled = src.rgb * (levels - 1.0);
  vec3 quantized = floor(scaled + 0.5 + threshold) / (levels - 1.0);
  fragColor = vec4(clamp(quantized, 0.0, 1.0), src.a);
}
`;

const GRADIENT_MAP_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_mix;
out vec4 fragColor;

const vec3 stopDark = vec3(0.05, 0.02, 0.18);
const vec3 stopLight = vec3(1.0, 0.86, 0.45);

void main() {
  vec4 src = texture(u_input, vUv);
  float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 mapped = mix(stopDark, stopLight, luma);
  vec3 result = mix(src.rgb, mapped, clamp(u_mix, 0.0, 1.0));
  fragColor = vec4(result, src.a);
}
`;

const PIXELATE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_size;
out vec4 fragColor;

void main() {
  float size = max(u_size, 1.0);
  vec2 blocks = max(u_resolution / size, vec2(1.0));
  vec2 quantized = (floor(vUv * blocks) + 0.5) / blocks;
  fragColor = texture(u_input, quantized);
}
`;

const HALFTONE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_dotSize;
uniform float u_angle;
out vec4 fragColor;

void main() {
  vec4 src = texture(u_input, vUv);
  float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
  float dotSize = max(u_dotSize, 2.0);
  float rad = radians(u_angle);
  vec2 pixel = vUv * u_resolution;
  mat2 rot = mat2(cos(rad), -sin(rad), sin(rad), cos(rad));
  vec2 rotated = rot * pixel;
  vec2 cell = mod(rotated, dotSize) - dotSize * 0.5;
  float dist = length(cell) / (dotSize * 0.5);
  float radius = sqrt(1.0 - clamp(luma, 0.0, 1.0));
  float ink = step(dist, radius);
  vec3 result = mix(vec3(1.0), vec3(0.0), ink);
  fragColor = vec4(result, src.a);
}
`;

const VHS_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_intensity;
uniform float u_scanlines;
uniform float u_jitter;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float intensity = clamp(u_intensity, 0.0, 1.0);
  float frame = floor(u_time * 24.0);
  float lineNoise = hash(vec2(frame, floor(vUv.y * 90.0)));
  float horizontalJitter = (lineNoise - 0.5) * u_jitter * 0.035;
  horizontalJitter *= step(0.82, lineNoise);
  vec2 uv = vec2(clamp(vUv.x + horizontalJitter, 0.0, 1.0), vUv.y);
  float split = (1.0 + u_jitter * 4.0) / max(u_resolution.x, 1.0);
  vec4 src = texture(u_input, uv);
  vec3 vhs = vec3(
    texture(u_input, vec2(clamp(uv.x + split, 0.0, 1.0), uv.y)).r,
    src.g,
    texture(u_input, vec2(clamp(uv.x - split, 0.0, 1.0), uv.y)).b
  );
  float scan = sin(vUv.y * u_resolution.y * 3.14159265);
  vhs *= 1.0 - (0.5 + 0.5 * scan) * clamp(u_scanlines, 0.0, 1.0) * 0.32;
  float grain = (hash(vUv * u_resolution + frame) - 0.5) * 0.11;
  vhs += grain * intensity;
  fragColor = vec4(clamp(mix(src.rgb, vhs, intensity), 0.0, 1.0), src.a);
}
`;

const POSTERIZE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_levels;
uniform float u_mix;
out vec4 fragColor;

void main() {
  vec4 src = texture(u_input, vUv);
  float levels = max(2.0, floor(u_levels));
  vec3 posterized = floor(src.rgb * (levels - 1.0) + 0.5) / (levels - 1.0);
  fragColor = vec4(mix(src.rgb, posterized, clamp(u_mix, 0.0, 1.0)), src.a);
}
`;

const DUOTONE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_shadowColor;
uniform vec4 u_highlightColor;
uniform float u_mix;
uniform float u_contrast;
out vec4 fragColor;

void main() {
  vec4 src = texture(u_input, vUv);
  float luma = dot(src.rgb, vec3(0.2126, 0.7152, 0.0722));
  luma = clamp((luma - 0.5) * max(u_contrast, 0.1) + 0.5, 0.0, 1.0);
  vec3 mapped = mix(u_shadowColor.rgb, u_highlightColor.rgb, luma);
  fragColor = vec4(mix(src.rgb, mapped, clamp(u_mix, 0.0, 1.0)), src.a);
}
`;

const PRISM_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_amount;
uniform float u_angle;
uniform float u_mix;
out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
  float rad = radians(u_angle);
  vec2 direction = vec2(cos(rad), sin(rad));
  vec2 offset = direction * texel * u_amount;
  vec4 src = texture(u_input, vUv);
  vec3 prism = vec3(
    texture(u_input, clamp(vUv + offset, vec2(0.0), vec2(1.0))).r,
    src.g,
    texture(u_input, clamp(vUv - offset, vec2(0.0), vec2(1.0))).b
  );
  fragColor = vec4(mix(src.rgb, prism, clamp(u_mix, 0.0, 1.0)), src.a);
}
`;

const FISHEYE_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strength;
uniform float u_radius;
out vec4 fragColor;

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 centered = (vUv - 0.5) * aspect;
  float distanceFromCenter = length(centered);
  float radius = max(u_radius, 0.1);
  float falloff = 1.0 - smoothstep(radius * 0.75, radius, distanceFromCenter);
  float distortion = 1.0 + u_strength * dot(centered, centered) * falloff;
  vec2 distorted = centered * distortion;
  vec2 uv = clamp(distorted / aspect + 0.5, vec2(0.0), vec2(1.0));
  vec4 src = texture(u_input, vUv);
  vec4 warped = texture(u_input, uv);
  fragColor = vec4(warped.rgb, src.a);
}
`;

const WAVE_WARP_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_amplitude;
uniform float u_frequency;
uniform float u_speed;
out vec4 fragColor;

void main() {
  float phase = vUv.y * u_frequency * 6.2831853 + u_time * u_speed;
  vec2 uv = vec2(clamp(vUv.x + sin(phase) * u_amplitude, 0.0, 1.0), vUv.y);
  vec4 warped = texture(u_input, uv);
  vec4 src = texture(u_input, vUv);
  fragColor = vec4(warped.rgb, src.a);
}
`;

const SCANLINES_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_density;
uniform float u_intensity;
uniform float u_speed;
out vec4 fragColor;

void main() {
  vec4 src = texture(u_input, vUv);
  float position = vUv.y * u_density + u_time * u_speed * 20.0;
  float line = 0.5 + 0.5 * sin(position * 3.14159265);
  float shade = 1.0 - line * clamp(u_intensity, 0.0, 1.0);
  fragColor = vec4(src.rgb * shade, src.a);
}
`;

const EDGE_GLOW_GLSL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strength;
uniform float u_radius;
uniform vec4 u_color;
out vec4 fragColor;

float lumaAt(vec2 uv) {
  return dot(texture(u_input, clamp(uv, vec2(0.0), vec2(1.0))).rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 src = texture(u_input, vUv);
  vec2 texel = max(u_radius, 0.5) / max(u_resolution, vec2(1.0));
  float gx = lumaAt(vUv + vec2(texel.x, 0.0)) - lumaAt(vUv - vec2(texel.x, 0.0));
  float gy = lumaAt(vUv + vec2(0.0, texel.y)) - lumaAt(vUv - vec2(0.0, texel.y));
  float edge = clamp(length(vec2(gx, gy)) * u_strength, 0.0, 1.0);
  vec3 result = src.rgb + u_color.rgb * edge * u_color.a;
  fragColor = vec4(clamp(result, 0.0, 1.0), src.a);
}
`;

export const EFFECT_SHADERS: readonly MotionShaderDef[] = [
  {
    id: "dither",
    name: "Dither",
    category: "effect",
    glsl: DITHER_GLSL,
    params: [
      { name: "levels", label: "Levels", type: "number", default: 4, min: 2, max: 16, step: 1 },
      { name: "scale", label: "Scale", type: "number", default: 1, min: 1, max: 8, step: 1 },
    ],
  },
  {
    id: "gradient-map",
    name: "Gradient Map",
    category: "effect",
    glsl: GRADIENT_MAP_GLSL,
    params: [
      { name: "mix", label: "Mix", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: "pixelate",
    name: "Pixelate",
    category: "effect",
    glsl: PIXELATE_GLSL,
    params: [
      { name: "size", label: "Size", type: "number", default: 8, min: 1, max: 64, step: 1 },
    ],
  },
  {
    id: "halftone",
    name: "Halftone",
    category: "effect",
    glsl: HALFTONE_GLSL,
    params: [
      { name: "dotSize", label: "Dot Size", type: "number", default: 8, min: 2, max: 32, step: 1 },
      { name: "angle", label: "Angle", type: "number", default: 15, min: 0, max: 90, step: 1 },
    ],
  },
  {
    id: "vhs",
    name: "VHS",
    category: "effect",
    glsl: VHS_GLSL,
    params: [
      { name: "intensity", label: "Intensity", type: "number", default: 0.75, min: 0, max: 1, step: 0.01 },
      { name: "scanlines", label: "Scanlines", type: "number", default: 0.4, min: 0, max: 1, step: 0.01 },
      { name: "jitter", label: "Jitter", type: "number", default: 0.45, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: "posterize",
    name: "Posterize",
    category: "effect",
    glsl: POSTERIZE_GLSL,
    params: [
      { name: "levels", label: "Levels", type: "number", default: 5, min: 2, max: 16, step: 1 },
      { name: "mix", label: "Mix", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: "duotone",
    name: "Duotone",
    category: "effect",
    glsl: DUOTONE_GLSL,
    params: [
      { name: "shadowColor", label: "Shadow", type: "color", default: "#11133f", min: 0, max: 1, step: 0.01 },
      { name: "highlightColor", label: "Highlight", type: "color", default: "#ffca6b", min: 0, max: 1, step: 0.01 },
      { name: "mix", label: "Mix", type: "number", default: 0.9, min: 0, max: 1, step: 0.01 },
      { name: "contrast", label: "Contrast", type: "number", default: 1.15, min: 0.25, max: 2.5, step: 0.05 },
    ],
  },
  {
    id: "prism",
    name: "Prism Split",
    category: "effect",
    glsl: PRISM_GLSL,
    params: [
      { name: "amount", label: "Offset", type: "number", default: 8, min: 0, max: 40, step: 0.5 },
      { name: "angle", label: "Angle", type: "number", default: 0, min: 0, max: 360, step: 1 },
      { name: "mix", label: "Mix", type: "number", default: 1, min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    id: "fisheye",
    name: "Fisheye",
    category: "effect",
    glsl: FISHEYE_GLSL,
    params: [
      { name: "strength", label: "Strength", type: "number", default: 0.55, min: -1, max: 1.5, step: 0.05 },
      { name: "radius", label: "Radius", type: "number", default: 0.8, min: 0.2, max: 1.5, step: 0.05 },
    ],
  },
  {
    id: "wave-warp",
    name: "Wave Warp",
    category: "effect",
    glsl: WAVE_WARP_GLSL,
    params: [
      { name: "amplitude", label: "Amplitude", type: "number", default: 0.025, min: 0, max: 0.15, step: 0.005 },
      { name: "frequency", label: "Frequency", type: "number", default: 5, min: 1, max: 20, step: 0.5 },
      { name: "speed", label: "Speed", type: "number", default: 1.5, min: 0, max: 8, step: 0.1 },
    ],
  },
  {
    id: "scanlines",
    name: "Scanlines",
    category: "effect",
    glsl: SCANLINES_GLSL,
    params: [
      { name: "density", label: "Density", type: "number", default: 360, min: 40, max: 1200, step: 10 },
      { name: "intensity", label: "Intensity", type: "number", default: 0.3, min: 0, max: 1, step: 0.01 },
      { name: "speed", label: "Speed", type: "number", default: 0.2, min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    id: "edge-glow",
    name: "Edge Glow",
    category: "effect",
    glsl: EDGE_GLOW_GLSL,
    params: [
      { name: "strength", label: "Strength", type: "number", default: 4, min: 0, max: 12, step: 0.25 },
      { name: "radius", label: "Radius", type: "number", default: 1.5, min: 0.5, max: 6, step: 0.25 },
      { name: "color", label: "Glow Color", type: "color", default: "#4de8ff", min: 0, max: 1, step: 0.01 },
    ],
  },
];
