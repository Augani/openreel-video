/** Shared GLSL prelude for the pro effect fragment shaders. */
export const PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D u_input;
uniform vec2 u_resolution;
out vec4 fragColor;

// Integer pixel index, origin top-left (matches the CPU buffers).
vec2 pxPos() { return floor(vec2(vUv.x, 1.0 - vUv.y) * u_resolution); }
vec2 toUv(vec2 p) { return vec2(p.x + 0.5, u_resolution.y - p.y - 0.5) / u_resolution; }
// Nearest texel with edge clamp.
vec4 fetchPx(vec2 p) {
  p = clamp(p, vec2(0.0), u_resolution - 1.0);
  return texture(u_input, toUv(p));
}
// Bilinear at continuous texel-centre coordinates (hardware edge clamp).
vec4 fetchCont(vec2 p) { return texture(u_input, toUv(p)); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float rnd(float v) { return floor(v + 0.5); }
vec4 emit(vec3 rgb, float a) { return vec4(clamp(rgb, 0.0, 1.0) * a, a); }
`;
