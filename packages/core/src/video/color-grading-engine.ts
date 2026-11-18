import type { CurvePoint } from "../types/effects";
import { releaseGLContext, trackGLContext } from "./gl-context";
import { applyToneToData, applyVignetteToData } from "./tone-curve";
import { hasCurve1d, isLutUsable, packCurve1dRgba, packRgbToRgba, resolveLut3dRgb } from "../color/lut-tables";
import { HUE_CURVES_GLSL, HUE_CURVE_LUT_SIZE, packHueCurveLuts, type HueCurvesValues } from "./hue-curves";
import {
  applyFusedGradeToData,
  prepareFusedGrade,
  type FusedGradeStages,
} from "./lumetri-pipeline";

export interface ColorWheelValues {
  shadows: { r: number; g: number; b: number };
  midtones: { r: number; g: number; b: number };
  highlights: { r: number; g: number; b: number };
  shadowsLift: number;
  midtonesGamma: number;
  highlightsGain: number;
}

export interface CurvesValues {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export interface HSLValues {
  hue: number[];
  saturation: number[];
  luminance: number[];
}

/**
 * Lumetri-style Basic Correction. Every field is in -1..1 and 0 is neutral.
 * Applied as a single 256-entry 1D tone curve (see `buildToneCurve`).
 */
export interface ToneValues {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

/**
 * Radial vignette. `amount` is -1..1 (negative darkens the edges, positive
 * lightens them, 0 is off); the rest shape the falloff, all 0..1 except
 * `roundness` which is -1 (rectangular) .. 0 (frame-shaped) .. 1 (circle).
 */
export interface VignetteValues {
  amount: number;
  midpoint: number;
  roundness: number;
  feather: number;
}

export interface LUTData {
  data: Uint8Array;
  /**
   * Full-precision table (input normalised to 0..1, red fastest, same indexing
   * as `data`). When present the CPU path samples this instead of 8-bit `data`.
   */
  floatData?: Float32Array;
  /**
   * Exact 1D per-channel curve (from LUT_1D_SIZE files). Interleaved RGB, input
   * mapped over domainMin..domainMax. When present the CPU path applies this
   * instead of the 3D approximation in `data`/`floatData`.
   */
  curve1d?: {
    size: number;
    domainMin: [number, number, number];
    domainMax: [number, number, number];
    data: Float32Array;
  };
  size: number;
  intensity: number;
  /** Colour space the table was authored for; absent = "srgb". Read by the float HDR working mode only. */
  space?: "srgb" | "linear" | "pq";
}

/** JSON-safe LUT (typed arrays flattened to number[]) stored on a clip. */
export interface ClipLutJson {
  data: number[];
  /** Full-precision 3D table (see LUTData.floatData). Optional for old projects. */
  floatData?: number[];
  /** Exact 1D curve (see LUTData.curve1d). */
  curve1d?: {
    size: number;
    domainMin: [number, number, number];
    domainMax: [number, number, number];
    data: number[];
  };
  size: number;
  intensity: number;
  /**
   * Colour space the LUT was authored for. Absent = "srgb" (a display-referred LUT). Only the float HDR working
   * mode reads it: it decides what signal the table sees ("srgb" / "linear" of the working image, or "pq").
   */
  space?: "srgb" | "linear" | "pq";
}

/**
 * Persisted, JSON-serializable color grading settings stored on a clip.
 * LUT data is a plain number[] (not a typed array) so it survives the
 * structured-clone / JSON snapshots used by the undo system and project
 * storage. The live effects bridge converts to/from typed arrays.
 */
export interface ClipColorGrading {
  colorWheels?: ColorWheelValues;
  curves?: CurvesValues;
  lut?: ClipLutJson;
  /**
   * Input LUT (camera log to working space). Applied before every other
   * grading stage, independent of the creative `lut`. Optional: absent means none.
   */
  inputLut?: ClipLutJson;
  hsl?: HSLValues;
  temperature?: number;
  tint?: number;
  /** Basic Correction (exposure/contrast/highlights/shadows/whites/blacks). Optional: absent means neutral. */
  tone?: ToneValues;
  /** Radial vignette. Optional: absent means off. */
  vignette?: VignetteValues;
  /**
   * Hue vs Sat / Hue vs Hue / Hue vs Luma / Luma vs Sat curves (0.5 = neutral).
   * Only rendered by the Premiere-order pipeline (`pipelineVersion` 2).
   */
  hueCurves?: HueCurvesValues;
  /**
   * Processing order. Absent (or 1) keeps the classic order so existing
   * projects render exactly as before; 2 is the Premiere-style order with
   * Basic Correction first and the float wheels/hue-curves pass. See
   * `lumetri-pipeline.ts`.
   */
  pipelineVersion?: 1 | 2;
}

interface ColorGradingResult {
  image: ImageBitmap;
  processingTime: number;
}

export { DEFAULT_COLOR_WHEELS, DEFAULT_CURVES, DEFAULT_HSL, DEFAULT_TONE, DEFAULT_VIGNETTE } from "./color-grading-defaults";

// WebGL2 shaders for color grading

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
 gl_Position = vec4(a_position, 0.0, 1.0);
 v_texCoord = a_texCoord;
}
`;

const COLOR_WHEELS_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform float u_shadowsLift;
uniform float u_midtonesGamma;
uniform float u_highlightsGain;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
 float shadowWeight = 1.0 - smoothstep(0.0, 0.5, luma);
 float highlightWeight = smoothstep(0.5, 1.0, luma);
 float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
 vec3 rgb = color.rgb;
 rgb += u_shadows * shadowWeight;
 rgb += u_midtones * midtoneWeight;
 rgb += u_highlights * highlightWeight;
 rgb = rgb + u_shadowsLift * shadowWeight;
 rgb = pow(rgb, vec3(1.0 / u_midtonesGamma));
 rgb = rgb * (1.0 + (u_highlightsGain - 1.0) * highlightWeight);
 
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const CURVES_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_curveLUT;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 float r = texture(u_curveLUT, vec2(color.r, 0.125)).r;
 float g = texture(u_curveLUT, vec2(color.g, 0.375)).r;
 float b = texture(u_curveLUT, vec2(color.b, 0.625)).r;
 float masterR = texture(u_curveLUT, vec2(r, 0.875)).r;
 float masterG = texture(u_curveLUT, vec2(g, 0.875)).r;
 float masterB = texture(u_curveLUT, vec2(b, 0.875)).r;
 
 fragColor = vec4(masterR, masterG, masterB, color.a);
}
`;

const HSL_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_hue[8];
uniform float u_saturation[8];
uniform float u_luminance[8];

vec3 rgb2hsl(vec3 c) {
 float maxC = max(max(c.r, c.g), c.b);
 float minC = min(min(c.r, c.g), c.b);
 float l = (maxC + minC) / 2.0;
 
 if (maxC == minC) {
 return vec3(0.0, 0.0, l);
 }
 
 float d = maxC - minC;
 float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
 
 float h;
 if (maxC == c.r) {
 h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
 } else if (maxC == c.g) {
 h = (c.b - c.r) / d + 2.0;
 } else {
 h = (c.r - c.g) / d + 4.0;
 }
 h /= 6.0;
 
 return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
 if (t < 0.0) t += 1.0;
 if (t > 1.0) t -= 1.0;
 if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
 if (t < 1.0/2.0) return q;
 if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
 return p;
}

vec3 hsl2rgb(vec3 hsl) {
 if (hsl.y == 0.0) {
 return vec3(hsl.z);
 }
 
 float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
 float p = 2.0 * hsl.z - q;
 
 float r = hue2rgb(p, q, hsl.x + 1.0/3.0);
 float g = hue2rgb(p, q, hsl.x);
 float b = hue2rgb(p, q, hsl.x - 1.0/3.0);
 
 return vec3(r, g, b);
}

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec3 hsl = rgb2hsl(color.rgb);
 
 // Determine which hue range this pixel falls into (8 ranges)
 int hueIndex = int(hsl.x * 8.0) % 8;
 hsl.x = fract(hsl.x + u_hue[hueIndex] / 360.0);
 hsl.y = clamp(hsl.y + u_saturation[hueIndex], 0.0, 1.0);
 hsl.z = clamp(hsl.z + u_luminance[hueIndex], 0.0, 1.0);
 
 vec3 rgb = hsl2rgb(hsl);
 fragColor = vec4(rgb, color.a);
}
`;

export const LUT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler3D u_lut;
uniform sampler2D u_lutCurve;
uniform bool u_useCurve;
uniform float u_lutSize;
uniform float u_curveSize;
uniform vec3 u_domainMin;
uniform vec3 u_domainMax;
uniform float u_intensity;

vec3 lutTexel(ivec3 p) { return texelFetch(u_lut, p, 0).rgb; }

// Trilinear lookup of the RGBA32F table, done by hand with texelFetch so no float-linear extension is needed.
vec3 sampleLut3d(vec3 c) {
  float m = u_lutSize - 1.0;
  vec3 idx = clamp(c, 0.0, 1.0) * m;
  vec3 f0 = floor(idx);
  vec3 fr = idx - f0;
  ivec3 i0 = ivec3(f0);
  ivec3 i1 = min(i0 + ivec3(1), ivec3(int(m)));
  vec3 c00 = mix(lutTexel(ivec3(i0.x, i0.y, i0.z)), lutTexel(ivec3(i1.x, i0.y, i0.z)), fr.x);
  vec3 c10 = mix(lutTexel(ivec3(i0.x, i1.y, i0.z)), lutTexel(ivec3(i1.x, i1.y, i0.z)), fr.x);
  vec3 c01 = mix(lutTexel(ivec3(i0.x, i0.y, i1.z)), lutTexel(ivec3(i1.x, i0.y, i1.z)), fr.x);
  vec3 c11 = mix(lutTexel(ivec3(i0.x, i1.y, i1.z)), lutTexel(ivec3(i1.x, i1.y, i1.z)), fr.x);
  return mix(mix(c00, c10, fr.y), mix(c01, c11, fr.y), fr.z);
}

// Exact 1D per-channel curve over the file's domain.
vec3 sampleCurve(vec3 v) {
  float m = u_curveSize - 1.0;
  vec3 t = clamp((v - u_domainMin) / (u_domainMax - u_domainMin), 0.0, 1.0) * m;
  vec3 f0 = min(floor(t), vec3(m));
  vec3 fr = t - f0;
  ivec3 i0 = ivec3(f0);
  ivec3 i1 = min(i0 + ivec3(1), ivec3(int(m)));
  return vec3(
    mix(texelFetch(u_lutCurve, ivec2(i0.x, 0), 0).r, texelFetch(u_lutCurve, ivec2(i1.x, 0), 0).r, fr.x),
    mix(texelFetch(u_lutCurve, ivec2(i0.y, 0), 0).g, texelFetch(u_lutCurve, ivec2(i1.y, 0), 0).g, fr.y),
    mix(texelFetch(u_lutCurve, ivec2(i0.z, 0), 0).b, texelFetch(u_lutCurve, ivec2(i1.z, 0), 0).b, fr.z)
  );
}

void main() {
  vec4 color = texture(u_texture, v_texCoord);
  vec3 lutColor = u_useCurve ? sampleCurve(color.rgb) : sampleLut3d(color.rgb);
  vec3 result = mix(color.rgb, lutColor, u_intensity);
  fragColor = vec4(result, color.a);
}
`;


/**
 * Premiere-order float pass: Basic Correction tone curve -> colour wheels ->
 * hue curves in one fragment shader, so nothing is quantised to 8 bits between
 * the stages. Mirrors `applyFusedGradeToRgb` in lumetri-pipeline.ts.
 */
const FUSED_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_toneCurve;
uniform bool u_useTone;
uniform bool u_useWheels;
uniform bool u_useHue;
uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform float u_shadowsLift;
uniform float u_midtonesGamma;
uniform float u_highlightsGain;
${HUE_CURVES_GLSL}

float toneSample(float x) {
 float position = clamp(x, 0.0, 1.0) * 255.0;
 float lower = floor(position);
 float fraction = position - lower;
 int i0 = int(lower);
 int i1 = min(255, i0 + 1);
 float a = texelFetch(u_toneCurve, ivec2(i0, 0), 0).r;
 float b = texelFetch(u_toneCurve, ivec2(i1, 0), 0).r;
 return a + (b - a) * fraction;
}

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec3 rgb = color.rgb;
 if (u_useTone) {
 rgb = vec3(toneSample(rgb.r), toneSample(rgb.g), toneSample(rgb.b));
 }
 if (u_useWheels) {
 float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
 float shadowWeight = 1.0 - smoothstep(0.0, 0.5, luma);
 float highlightWeight = smoothstep(0.5, 1.0, luma);
 float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
 vec3 w = rgb;
 w += u_shadows * shadowWeight;
 w += u_midtones * midtoneWeight;
 w += u_highlights * highlightWeight;
 w += u_shadowsLift * shadowWeight;
 w = pow(max(w, vec3(0.0)), vec3(1.0 / u_midtonesGamma));
 w = w * (1.0 + (u_highlightsGain - 1.0) * highlightWeight);
 rgb = clamp(w, 0.0, 1.0);
 }
 if (u_useHue) {
 rgb = applyHueCurves(rgb);
 }
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

type ColorGradingShaderName = "colorWheels" | "curves" | "hsl" | "lut" | "fused";

const COLOR_GRADING_FRAGMENT_SOURCES: Record<ColorGradingShaderName, string> = {
  colorWheels: COLOR_WHEELS_SHADER,
  curves: CURVES_SHADER,
  hsl: HSL_SHADER,
  lut: LUT_SHADER,
  fused: FUSED_SHADER,
};

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
}

export interface CpuGradingStages {
  tone?: ToneValues;
  vignette?: VignetteValues;
  /** Apply the vignette after HSL instead of after tone (Premiere-order pipeline). */
  vignetteLast?: boolean;
  curves?: CurvesValues;
  lut?: LUTData;
  hsl?: HSLValues;
}

export class ColorGradingEngine {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private shaders: Map<string, ShaderProgram> = new Map();
  private quadBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private curveLUTTexture: WebGLTexture | null = null;
  private width: number;
  private height: number;
  private initialized = false;

  private _cpuCanvas: OffscreenCanvas | null = null;
  private _cpuCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(width: number = 1920, height: number = 1080) {
    this.width = width;
    this.height = height;
  }

  initialize(): void {
    if (this.initialized) return;

    this.canvas = new OffscreenCanvas(this.width, this.height);
    const gl = this.canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
      alpha: true,
    });

    if (!gl) {
      throw new Error("WebGL2 not supported");
    }

    this.gl = trackGLContext(gl);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
      gl.STATIC_DRAW,
    );

    // Shader programs are compiled on first use (getShader): compiling all of them here cost a
    // synchronous GPU round trip per program on the editor warm-up path, and only the colour
    // wheels program is used by the GPU stage.
    this.initialized = true;
  }

  private getShader(name: ColorGradingShaderName): ShaderProgram {
    let shader = this.shaders.get(name);
    if (!shader) {
      this.compileShader(name, VERTEX_SHADER, COLOR_GRADING_FRAGMENT_SOURCES[name]);
      shader = this.shaders.get(name)!;
    }
    return shader;
  }

  private compileShader(
    name: string,
    vertexSrc: string,
    fragmentSrc: string,
  ): void {
    const gl = this.gl!;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertexShader, vertexSrc);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error(
        `Vertex shader error: ${gl.getShaderInfoLog(vertexShader)}`,
      );
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragmentShader, fragmentSrc);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error(
        `Fragment shader error: ${gl.getShaderInfoLog(fragmentShader)}`,
      );
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) {
        const location = gl.getUniformLocation(program, info.name);
        if (location) {
          uniforms.set(info.name, location);
        }
      }
    }
    const attributes = new Map<string, number>();
    const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < numAttribs; i++) {
      const info = gl.getActiveAttrib(program, i);
      if (info) {
        attributes.set(info.name, gl.getAttribLocation(program, info.name));
      }
    }

    this.shaders.set(name, { program, uniforms, attributes });

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }

  async applyColorWheels(
    image: ImageBitmap,
    values: ColorWheelValues,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    this.ensureInitialized();

    const gl = this.gl!;
    const shader = this.getShader("colorWheels");

    // Render at the source frame's own resolution so a clip whose aspect
    // differs from the project canvas keeps its orientation. Rendering into the
    // fixed engine canvas stretches the frame to fill the GL viewport, and the
    // downstream contain re-fit would then bake that distortion in.
    if (
      this.canvas &&
      (this.canvas.width !== image.width || this.canvas.height !== image.height)
    ) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.width = image.width;
      this.height = image.height;
    }

    // Upload source image
    const sourceTexture = this.uploadTexture(image);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(shader.program);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    const texLoc = shader.uniforms.get("u_texture");
    if (texLoc) gl.uniform1i(texLoc, 0);
    const shadowsLoc = shader.uniforms.get("u_shadows");
    const midtonesLoc = shader.uniforms.get("u_midtones");
    const highlightsLoc = shader.uniforms.get("u_highlights");
    const liftLoc = shader.uniforms.get("u_shadowsLift");
    const gammaLoc = shader.uniforms.get("u_midtonesGamma");
    const gainLoc = shader.uniforms.get("u_highlightsGain");

    if (shadowsLoc)
      gl.uniform3f(
        shadowsLoc,
        values.shadows.r,
        values.shadows.g,
        values.shadows.b,
      );
    if (midtonesLoc)
      gl.uniform3f(
        midtonesLoc,
        values.midtones.r,
        values.midtones.g,
        values.midtones.b,
      );
    if (highlightsLoc)
      gl.uniform3f(
        highlightsLoc,
        values.highlights.r,
        values.highlights.g,
        values.highlights.b,
      );
    if (liftLoc) gl.uniform1f(liftLoc, values.shadowsLift);
    if (gammaLoc) gl.uniform1f(gammaLoc, values.midtonesGamma);
    if (gainLoc) gl.uniform1f(gainLoc, values.highlightsGain);

    this.setupVertexAttributes(shader);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.deleteTexture(sourceTexture);

    const result = await createImageBitmap(this.canvas!);
    return {
      image: result,
      processingTime: performance.now() - startTime,
    };
  }

  /**
   * Runs the Premiere-order float stages (tone -> wheels -> hue curves) as one
   * WebGL2 fragment pass at the frame's own resolution. Throws when WebGL2 is
   * unavailable; `applyFusedGrading` falls back to the CPU reference.
   */
  async applyFusedGradingGpu(
    image: ImageBitmap,
    stages: FusedGradeStages,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    this.ensureInitialized();
    const prepared = prepareFusedGrade(stages);

    const gl = this.gl!;
    const shader = this.getShader("fused");

    if (
      this.canvas &&
      (this.canvas.width !== image.width || this.canvas.height !== image.height)
    ) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.width = image.width;
      this.height = image.height;
    }

    const sourceTexture = this.uploadTexture(image);
    const toneTexture = this.uploadFloatTexture(
      prepared.toneCurve ? this.expandToRgba(prepared.toneCurve) : new Float32Array(4 * 256),
      256,
    );
    const hueTexture = this.uploadFloatTexture(
      prepared.hueLuts ? packHueCurveLuts(prepared.hueLuts) : new Float32Array(4 * HUE_CURVE_LUT_SIZE),
      HUE_CURVE_LUT_SIZE,
    );

    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(shader.program);

      const bind = (unit: number, texture: WebGLTexture, name: string): void => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const location = shader.uniforms.get(name);
        if (location) gl.uniform1i(location, unit);
      };
      bind(0, sourceTexture, "u_texture");
      bind(1, toneTexture, "u_toneCurve");
      bind(2, hueTexture, "u_hueCurves");

      const flag = (name: string, on: boolean): void => {
        const location = shader.uniforms.get(name);
        if (location) gl.uniform1i(location, on ? 1 : 0);
      };
      flag("u_useTone", !!prepared.toneCurve);
      flag("u_useWheels", !!prepared.wheels);
      flag("u_useHue", !!prepared.hueLuts);

      const wheels = prepared.wheels;
      const triple = (name: string, v: { r: number; g: number; b: number }): void => {
        const location = shader.uniforms.get(name);
        if (location) gl.uniform3f(location, v.r, v.g, v.b);
      };
      const zero = { r: 0, g: 0, b: 0 };
      triple("u_shadows", wheels?.shadows ?? zero);
      triple("u_midtones", wheels?.midtones ?? zero);
      triple("u_highlights", wheels?.highlights ?? zero);
      const scalar = (name: string, v: number): void => {
        const location = shader.uniforms.get(name);
        if (location) gl.uniform1f(location, v);
      };
      scalar("u_shadowsLift", wheels?.shadowsLift ?? 0);
      scalar("u_midtonesGamma", wheels && wheels.midtonesGamma > 0 ? wheels.midtonesGamma : 1);
      scalar("u_highlightsGain", wheels?.highlightsGain ?? 1);

      this.setupVertexAttributes(shader);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } finally {
      gl.deleteTexture(sourceTexture);
      gl.deleteTexture(toneTexture);
      gl.deleteTexture(hueTexture);
    }

    const result = await createImageBitmap(this.canvas!);
    return { image: result, processingTime: performance.now() - startTime };
  }

  /** CPU reference for the fused pass (float math, single 8-bit rounding). */
  async applyFusedGradingCpu(
    image: ImageBitmap,
    stages: FusedGradeStages,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    const ctx = this.getCpuCtx(image.width, image.height);
    ctx.clearRect(0, 0, image.width, image.height);
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    applyFusedGradeToData(imageData.data, stages);
    ctx.putImageData(imageData, 0, 0);
    const result = await createImageBitmap(this._cpuCanvas!);
    return { image: result, processingTime: performance.now() - startTime };
  }

  /** GPU float pass, or the identical CPU float reference when WebGL2 is unavailable. */
  async applyFusedGrading(
    image: ImageBitmap,
    stages: FusedGradeStages,
  ): Promise<ColorGradingResult> {
    try {
      return await this.applyFusedGradingGpu(image, stages);
    } catch (error) {
      console.warn("Fused float grading fell back to the CPU path:", error);
      return this.applyFusedGradingCpu(image, stages);
    }
  }

  private expandToRgba(values: Float32Array): Float32Array {
    const rgba = new Float32Array(values.length * 4);
    for (let i = 0; i < values.length; i++) rgba[i * 4] = values[i];
    return rgba;
  }

  private uploadFloatTexture(data: Float32Array, width: number): WebGLTexture {
    const gl = this.gl!;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  async applyCurves(
    image: ImageBitmap,
    curves: CurvesValues,
  ): Promise<ColorGradingResult> {
    return this.applyCpuGrading(image, { curves });
  }

  private getCpuCtx(
    width: number,
    height: number,
  ): OffscreenCanvasRenderingContext2D {
    if (
      !this._cpuCanvas ||
      !this._cpuCtx ||
      this._cpuCanvas.width !== width ||
      this._cpuCanvas.height !== height
    ) {
      const canvas = this._cpuCanvas ?? new OffscreenCanvas(width, height);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        throw new Error("Failed to acquire 2D context for CPU color grading");
      }
      this._cpuCanvas = canvas;
      this._cpuCtx = ctx;
    }

    return this._cpuCtx;
  }

  private applyCurvesToData(data: Uint8ClampedArray, curves: CurvesValues): void {
    const rgbLUT = this.buildCurveLUT(curves.rgb);
    const redLUT = this.buildCurveLUT(curves.red);
    const greenLUT = this.buildCurveLUT(curves.green);
    const blueLUT = this.buildCurveLUT(curves.blue);
    for (let i = 0; i < data.length; i += 4) {
      const r = redLUT[data[i]];
      const g = greenLUT[data[i + 1]];
      const b = blueLUT[data[i + 2]];

      data[i] = rgbLUT[r];
      data[i + 1] = rgbLUT[g];
      data[i + 2] = rgbLUT[b];
    }
  }

  private applyCurve1dToData(
    data: Uint8ClampedArray,
    curve: NonNullable<LUTData["curve1d"]>,
    intensity: number,
  ): void {
    const m = curve.size - 1;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = data[i + c] / 255;
        let t = (v - curve.domainMin[c]) / (curve.domainMax[c] - curve.domainMin[c]);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const p = t * m;
        const i0 = Math.min(Math.floor(p), m);
        const i1 = Math.min(i0 + 1, m);
        const f = p - i0;
        const out = curve.data[i0 * 3 + c] * (1 - f) + curve.data[i1 * 3 + c] * f;
        data[i + c] = Math.round((v * (1 - intensity) + out * intensity) * 255);
      }
    }
  }

  private applyLutToData(data: Uint8ClampedArray, lut: LUTData): void {
    if (lut.curve1d) {
      this.applyCurve1dToData(data, lut.curve1d, lut.intensity);
      return;
    }
    const lutSize = lut.size;
    const hasFloat =
      lut.floatData !== undefined &&
      lut.floatData.length === lutSize * lutSize * lutSize * 3;
    const lutData: ArrayLike<number> = hasFloat
      ? (lut.floatData as Float32Array)
      : lut.data;
    const lutScale = hasFloat ? 1 : 1 / 255;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const rIdx = r * (lutSize - 1);
      const gIdx = g * (lutSize - 1);
      const bIdx = b * (lutSize - 1);

      const r0 = Math.floor(rIdx);
      const g0 = Math.floor(gIdx);
      const b0 = Math.floor(bIdx);

      const r1 = Math.min(r0 + 1, lutSize - 1);
      const g1 = Math.min(g0 + 1, lutSize - 1);
      const b1 = Math.min(b0 + 1, lutSize - 1);

      const rFrac = rIdx - r0;
      const gFrac = gIdx - g0;
      const bFrac = bIdx - b0;

      const getLutValue = (
        ri: number,
        gi: number,
        bi: number,
        channel: number,
      ): number => {
        const idx = (bi * lutSize * lutSize + gi * lutSize + ri) * 3 + channel;
        return lutData[idx] * lutScale;
      };

      const interpolateChannel = (channel: number): number => {
        const c00 =
          getLutValue(r0, g0, b0, channel) * (1 - rFrac) +
          getLutValue(r1, g0, b0, channel) * rFrac;
        const c01 =
          getLutValue(r0, g0, b1, channel) * (1 - rFrac) +
          getLutValue(r1, g0, b1, channel) * rFrac;
        const c10 =
          getLutValue(r0, g1, b0, channel) * (1 - rFrac) +
          getLutValue(r1, g1, b0, channel) * rFrac;
        const c11 =
          getLutValue(r0, g1, b1, channel) * (1 - rFrac) +
          getLutValue(r1, g1, b1, channel) * rFrac;
        const c0 = c00 * (1 - gFrac) + c10 * gFrac;
        const c1 = c01 * (1 - gFrac) + c11 * gFrac;
        return c0 * (1 - bFrac) + c1 * bFrac;
      };

      const lutR = interpolateChannel(0);
      const lutG = interpolateChannel(1);
      const lutB = interpolateChannel(2);

      data[i] = Math.round(
        (r * (1 - lut.intensity) + lutR * lut.intensity) * 255,
      );
      data[i + 1] = Math.round(
        (g * (1 - lut.intensity) + lutG * lut.intensity) * 255,
      );
      data[i + 2] = Math.round(
        (b * (1 - lut.intensity) + lutB * lut.intensity) * 255,
      );
    }
  }

  private applyHslToData(data: Uint8ClampedArray, hsl: HSLValues): void {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const hslColor = this.rgbToHsl(r, g, b);

      const hueIndex = Math.floor(hslColor.h * 8) % 8;
      hslColor.h = (hslColor.h + hsl.hue[hueIndex] / 360 + 1) % 1;
      hslColor.s = Math.max(
        0,
        Math.min(1, hslColor.s + hsl.saturation[hueIndex]),
      );
      hslColor.l = Math.max(
        0,
        Math.min(1, hslColor.l + hsl.luminance[hueIndex]),
      );
      const rgb = this.hslToRgb(hslColor.h, hslColor.s, hslColor.l);

      data[i] = Math.round(rgb.r * 255);
      data[i + 1] = Math.round(rgb.g * 255);
      data[i + 2] = Math.round(rgb.b * 255);
    }
  }

  async applyCpuGradingToCanvas(
    image: ImageBitmap,
    stages: CpuGradingStages,
  ): Promise<OffscreenCanvas> {
    const ctx = this.getCpuCtx(image.width, image.height);
    ctx.clearRect(0, 0, image.width, image.height);
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    if (stages.tone) {
      applyToneToData(data, stages.tone);
    }
    if (stages.vignette && !stages.vignetteLast) {
      applyVignetteToData(data, image.width, image.height, stages.vignette);
    }
    if (stages.curves) {
      this.applyCurvesToData(data, stages.curves);
    }
    if (stages.lut) {
      this.applyLutToData(data, stages.lut);
    }
    if (stages.hsl) {
      this.applyHslToData(data, stages.hsl);
    }
    if (stages.vignette && stages.vignetteLast) {
      applyVignetteToData(data, image.width, image.height, stages.vignette);
    }

    ctx.putImageData(imageData, 0, 0);

    return this._cpuCanvas!;
  }

  async applyCpuGrading(
    image: ImageBitmap,
    stages: CpuGradingStages,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    const canvas = await this.applyCpuGradingToCanvas(image, stages);
    const result = await createImageBitmap(canvas);
    return {
      image: result,
      processingTime: performance.now() - startTime,
    };
  }

  private buildCurveLUT(points: CurvePoint[]): Uint8Array {
    const lut = new Uint8Array(256);
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (sorted.length === 0 || sorted[0].x > 0) {
      sorted.unshift({ x: 0, y: 0 });
    }
    if (sorted[sorted.length - 1].x < 1) {
      sorted.push({ x: 1, y: 1 });
    }
    if (sorted.length === 2) {
      for (let i = 0; i < 256; i++) {
        const x = i / 255;
        const t = (x - sorted[0].x) / (sorted[1].x - sorted[0].x);
        const y = sorted[0].y + t * (sorted[1].y - sorted[0].y);
        lut[i] = Math.round(Math.max(0, Math.min(255, y * 255)));
      }
      return lut;
    }

    // Catmull-Rom spline interpolation for smooth curves
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      let y = x; // Default to linear
      for (let j = 0; j < sorted.length - 1; j++) {
        if (x >= sorted[j].x && x <= sorted[j + 1].x) {
          const p0 = j > 0 ? sorted[j - 1] : sorted[j];
          const p1 = sorted[j];
          const p2 = sorted[j + 1];
          const p3 = j + 2 < sorted.length ? sorted[j + 2] : sorted[j + 1];
          const t = (x - p1.x) / (p2.x - p1.x);

          // Catmull-Rom spline formula
          const t2 = t * t;
          const t3 = t2 * t;

          y =
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
          break;
        }
      }

      lut[i] = Math.round(Math.max(0, Math.min(255, y * 255)));
    }

    return lut;
  }

  /**
   * GPU LUT pass. The 3D table is uploaded as an RGBA32F texture straight from `floatData` (8-bit `data` only
   * when there is no float table) and a 1D curve as its own RGBA32F texture, so nothing is quantised and 1D LUTs
   * are exact. Throws when WebGL2 or float textures are unavailable; `applyLUT` then uses the CPU float path.
   */
  async applyLutGpu(
    image: ImageBitmap,
    lut: LUTData,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    this.ensureInitialized();
    const gl = this.gl!;
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("Float textures are unavailable");
    }
    const curve = hasCurve1d(lut.curve1d) ? lut.curve1d : null;
    if (!curve && !isLutUsable(lut)) {
      throw new Error("LUT has no usable table");
    }
    const shader = this.getShader("lut");

    if (
      this.canvas &&
      (this.canvas.width !== image.width || this.canvas.height !== image.height)
    ) {
      this.canvas.width = image.width;
      this.canvas.height = image.height;
      this.width = image.width;
      this.height = image.height;
    }

    const sourceTexture = this.uploadTexture(image);
    const n = lut.size;
    const lutTexture = gl.createTexture()!;
    const curveTexture = this.uploadFloatTexture(
      curve ? packCurve1dRgba(curve) : new Float32Array(4),
      curve ? curve.size : 1,
    );
    try {
      gl.bindTexture(gl.TEXTURE_3D, lutTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const texels = curve ? 1 : n;
      const rgba = curve
        ? new Float32Array(4)
        : packRgbToRgba(resolveLut3dRgb(lut), n * n * n);
      gl.getError(); // drain stale errors so only this upload is judged
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, texels, texels, texels, 0, gl.RGBA, gl.FLOAT, rgba);
      if (gl.getError() !== gl.NO_ERROR) {
        // Never fall back to an 8-bit upload: the caller routes to the CPU float path instead.
        throw new Error("The GPU rejected the float LUT texture");
      }
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(shader.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      const u = (name: string) => shader.uniforms.get(name);
      const srcLoc = u("u_texture");
      if (srcLoc) gl.uniform1i(srcLoc, 0);
      gl.activeTexture(gl.TEXTURE0 + 1);
      gl.bindTexture(gl.TEXTURE_3D, lutTexture);
      const lutLoc = u("u_lut");
      if (lutLoc) gl.uniform1i(lutLoc, 1);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, curveTexture);
      const curveLoc = u("u_lutCurve");
      if (curveLoc) gl.uniform1i(curveLoc, 2);

      const useCurve = u("u_useCurve");
      if (useCurve) gl.uniform1i(useCurve, curve ? 1 : 0);
      const sizeLoc = u("u_lutSize");
      if (sizeLoc) gl.uniform1f(sizeLoc, texels);
      const curveSizeLoc = u("u_curveSize");
      if (curveSizeLoc) gl.uniform1f(curveSizeLoc, curve ? curve.size : 1);
      const minLoc = u("u_domainMin");
      if (minLoc) gl.uniform3f(minLoc, curve?.domainMin[0] ?? 0, curve?.domainMin[1] ?? 0, curve?.domainMin[2] ?? 0);
      const maxLoc = u("u_domainMax");
      if (maxLoc) gl.uniform3f(maxLoc, curve?.domainMax[0] ?? 1, curve?.domainMax[1] ?? 1, curve?.domainMax[2] ?? 1);
      const intensityLoc = u("u_intensity");
      if (intensityLoc) gl.uniform1f(intensityLoc, lut.intensity);

      this.setupVertexAttributes(shader);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } finally {
      gl.deleteTexture(sourceTexture);
      gl.deleteTexture(lutTexture);
      gl.deleteTexture(curveTexture);
    }

    const result = await createImageBitmap(this.canvas!);
    return { image: result, processingTime: performance.now() - startTime };
  }

  /** GPU float LUT pass, falling back to the CPU float reference when WebGL2 / float textures are unavailable. */
  async applyLUT(
    image: ImageBitmap,
    lut: LUTData,
  ): Promise<ColorGradingResult> {
    try {
      return await this.applyLutGpu(image, lut);
    } catch (error) {
      console.warn("LUT grading fell back to the CPU path:", error);
      return this.applyCpuGrading(image, { lut });
    }
  }

  async applyHSL(
    image: ImageBitmap,
    hsl: HSLValues,
  ): Promise<ColorGradingResult> {
    return this.applyCpuGrading(image, { hsl });
  }

  private rgbToHsl(
    r: number,
    g: number,
    b: number,
  ): { h: number; s: number; l: number } {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
      return { h: 0, s: 0, l };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    if (max === r) {
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
      h = ((b - r) / d + 2) / 6;
    } else {
      h = ((r - g) / d + 4) / 6;
    }

    return { h, s, l };
  }

  private hslToRgb(
    h: number,
    s: number,
    l: number,
  ): { r: number; g: number; b: number } {
    if (s === 0) {
      return { r: l, g: l, b: l };
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const hue2rgb = (t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    return {
      r: hue2rgb(h + 1 / 3),
      g: hue2rgb(h),
      b: hue2rgb(h - 1 / 3),
    };
  }

  private uploadTexture(image: ImageBitmap): WebGLTexture {
    const gl = this.gl!;
    const texture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  private setupVertexAttributes(shader: ShaderProgram): void {
    const gl = this.gl!;

    const posLoc = shader.attributes.get("a_position");
    if (posLoc !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    const texCoordLoc = shader.attributes.get("a_texCoord");
    if (texCoordLoc !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
      gl.enableVertexAttribArray(texCoordLoc);
      gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initialize();
    }
  }

  dispose(): void {
    if (this.gl) {
      for (const shader of this.shaders.values()) {
        this.gl.deleteProgram(shader.program);
      }
      this.shaders.clear();

      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
      if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
      if (this.curveLUTTexture) this.gl.deleteTexture(this.curveLUTTexture);
      releaseGLContext(this.gl);
    }

    this.canvas = null;
    this.gl = null;
    this._cpuCanvas = null;
    this._cpuCtx = null;
    this.initialized = false;
  }
}
