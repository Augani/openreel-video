import type { HdrOcioTransform } from "../color/hdr-working";

/**
 * Runs a compiled OCIO transform's GLSL (the exact snippet the compositor embeds) over a list of colours on the GPU, in
 * full float (RGBA32F in and out), and returns the results. For tests that hold the shader to the CPU reference and to
 * OpenColorIO; the product never calls it.
 */
export function evalOcioTransformOnGpu(transform: HdrOcioTransform, rgb: Float32Array): Float32Array {
  if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas is unavailable.");
  const count = rgb.length / 3;
  const width = 256;
  const height = Math.max(1, Math.ceil(count / width));
  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL2 is unavailable.");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("EXT_color_buffer_float is unavailable.");
  const { source, lut } = transform.gpu();
  const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const fragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform sampler2D u_in;
${source}
void main() {
  vec3 c = texelFetch(u_in, ivec2(gl_FragCoord.xy), 0).rgb;
  outColor = vec4(ocioTransform(c), 1.0);
}`;
  const compile = (type: number, text: string): WebGLShader => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`OCIO shader error: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`OCIO program link error: ${gl.getProgramInfoLog(program)}`);
  const texture = (unit: number, w: number, h: number, data: Float32Array): WebGLTexture => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const input = new Float32Array(width * height * 4);
  for (let i = 0; i < count; i++) {
    input[i * 4] = rgb[i * 3];
    input[i * 4 + 1] = rgb[i * 3 + 1];
    input[i * 4 + 2] = rgb[i * 3 + 2];
    input[i * 4 + 3] = 1;
  }
  gl.useProgram(program);
  texture(0, width, height, input);
  gl.uniform1i(gl.getUniformLocation(program, "u_in"), 0);
  if (lut) {
    texture(1, lut.width, lut.height, lut.data);
    gl.uniform1i(gl.getUniformLocation(program, "ocioLut"), 1);
  }
  const target = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, target);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("The GPU cannot render to RGBA32F.");
  gl.viewport(0, 0, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = new Float32Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    result[i * 3] = out[i * 4];
    result[i * 3 + 1] = out[i * 4 + 1];
    result[i * 3 + 2] = out[i * 4 + 2];
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return result;
}
