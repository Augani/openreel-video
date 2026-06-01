import type { CurvePoint } from "../types/effects";

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

export interface LUTData {
  data: Uint8Array;
  size: number;
  intensity: number;
}

export interface WaveformScopeData {
  luminance: Uint8Array;
  red: Uint8Array;
  green: Uint8Array;
  blue: Uint8Array;
  width: number;
  height: number;
}

export interface VectorscopeData {
  data: Uint8Array;
  size: number;
}

export interface HistogramData {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luminance: Uint32Array;
}

export interface ColorGradingResult {
  image: ImageBitmap;
  processingTime: number;
}

export const DEFAULT_COLOR_WHEELS: ColorWheelValues = {
  shadows: { r: 0, g: 0, b: 0 },
  midtones: { r: 0, g: 0, b: 0 },
  highlights: { r: 0, g: 0, b: 0 },
  shadowsLift: 0,
  midtonesGamma: 1,
  highlightsGain: 1,
};

export const DEFAULT_CURVES: CurvesValues = {
  rgb: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  red: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  green: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  blue: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

export const DEFAULT_HSL: HSLValues = {
  hue: [0, 0, 0, 0, 0, 0, 0, 0],
  saturation: [0, 0, 0, 0, 0, 0, 0, 0],
  luminance: [0, 0, 0, 0, 0, 0, 0, 0],
};

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

const LUT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_lut;
uniform float u_lutSize;
uniform float u_intensity;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 
 // 3D LUT lookup (stored as 2D texture)
 float blueSlice = color.b * (u_lutSize - 1.0);
 float blueSliceFloor = floor(blueSlice);
 float blueSliceCeil = ceil(blueSlice);
 float blueFrac = blueSlice - blueSliceFloor;

 
 vec2 quad1 = vec2(
 (blueSliceFloor + color.r) / u_lutSize,
 color.g
 );
 vec2 quad2 = vec2(
 (blueSliceCeil + color.r) / u_lutSize,
 color.g
 );
 
 vec3 lutColor1 = texture(u_lut, quad1).rgb;
 vec3 lutColor2 = texture(u_lut, quad2).rgb;
 vec3 lutColor = mix(lutColor1, lutColor2, blueFrac);
 
 // Mix with original based on intensity
 vec3 result = mix(color.rgb, lutColor, u_intensity);
 fragColor = vec4(result, color.a);
}
`;

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
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

    this.gl = gl;
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

    // Compile shaders
    this.compileShader("colorWheels", VERTEX_SHADER, COLOR_WHEELS_SHADER);
    this.compileShader("curves", VERTEX_SHADER, CURVES_SHADER);
    this.compileShader("hsl", VERTEX_SHADER, HSL_SHADER);
    this.compileShader("lut", VERTEX_SHADER, LUT_SHADER);

    this.initialized = true;
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
    const shader = this.shaders.get("colorWheels")!;

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

  async applyCurves(
    image: ImageBitmap,
    curves: CurvesValues,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();
    this.ensureInitialized();

    // For curves, we use CPU processing with canvas for simplicity
    // A full implementation would use a 1D LUT texture
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;
    const rgbLUT = this.buildCurveLUT(curves.rgb);
    const redLUT = this.buildCurveLUT(curves.red);
    const greenLUT = this.buildCurveLUT(curves.green);
    const blueLUT = this.buildCurveLUT(curves.blue);
    for (let i = 0; i < data.length; i += 4) {
      let r = redLUT[data[i]];
      let g = greenLUT[data[i + 1]];
      let b = blueLUT[data[i + 2]];

      // Then apply master curve
      data[i] = rgbLUT[r];
      data[i + 1] = rgbLUT[g];
      data[i + 2] = rgbLUT[b];
    }

    ctx.putImageData(imageData, 0, 0);

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

  async applyLUT(
    image: ImageBitmap,
    lut: LUTData,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();

    // CPU implementation for LUT application
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;
    const lutSize = lut.size;
    const lutData = lut.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      // 3D LUT lookup with full trilinear interpolation
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

      // Helper to get LUT value at specific indices
      const getLutValue = (
        ri: number,
        gi: number,
        bi: number,
        channel: number,
      ): number => {
        const idx = (bi * lutSize * lutSize + gi * lutSize + ri) * 3 + channel;
        return lutData[idx] / 255;
      };

      // Trilinear interpolation for each channel
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

      // Mix with original based on intensity
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

    ctx.putImageData(imageData, 0, 0);

    const result = await createImageBitmap(canvas);
    return {
      image: result,
      processingTime: performance.now() - startTime,
    };
  }

  async applyHSL(
    image: ImageBitmap,
    hsl: HSLValues,
  ): Promise<ColorGradingResult> {
    const startTime = performance.now();

    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const hslColor = this.rgbToHsl(r, g, b);

      // Determine hue range (0-7)
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

    ctx.putImageData(imageData, 0, 0);

    const result = await createImageBitmap(canvas);
    return {
      image: result,
      processingTime: performance.now() - startTime,
    };
  }

  async generateWaveform(image: ImageBitmap): Promise<WaveformScopeData> {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;
    const width = image.width;
    const height = image.height;
    const waveformHeight = 256;
    const luminance = new Uint8Array(width * waveformHeight);
    const red = new Uint8Array(width * waveformHeight);
    const green = new Uint8Array(width * waveformHeight);
    const blue = new Uint8Array(width * waveformHeight);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

        // Increment waveform bins
        luminance[luma * width + x]++;
        red[r * width + x]++;
        green[g * width + x]++;
        blue[b * width + x]++;
      }
    }

    return {
      luminance,
      red,
      green,
      blue,
      width,
      height: waveformHeight,
    };
  }

  async generateVectorscope(
    image: ImageBitmap,
    size: number = 256,
  ): Promise<VectorscopeData> {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;
    const vectorscope = new Uint8Array(size * size);
    const center = size / 2;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const u = -0.14713 * r - 0.28886 * g + 0.436 * b;
      const v = 0.615 * r - 0.51499 * g - 0.10001 * b;
      const x = Math.round(center + u * center * 2);
      const yCoord = Math.round(center - v * center * 2);

      if (x >= 0 && x < size && yCoord >= 0 && yCoord < size) {
        const idx = yCoord * size + x;
        vectorscope[idx] = Math.min(255, vectorscope[idx] + 1);
      }
    }

    return {
      data: vectorscope,
      size,
    };
  }

  async generateHistogram(image: ImageBitmap): Promise<HistogramData> {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    const red = new Uint32Array(256);
    const green = new Uint32Array(256);
    const blue = new Uint32Array(256);
    const luminance = new Uint32Array(256);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      red[r]++;
      green[g]++;
      blue[b]++;
      luminance[luma]++;
    }

    return { red, green, blue, luminance };
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
    }

    this.canvas = null;
    this.gl = null;
    this.initialized = false;
  }
}
