import type { Effect } from "../types/timeline";
import {
  RendererFactory,
  type Renderer,
  type RendererConfig,
  isWebGPUSupported,
} from "./renderer-factory";

export interface FilterResult {
  image: ImageBitmap;
  processingTime: number;
  gpuAccelerated: boolean;
}

export interface OrderedEffect extends Effect {
  orderIndex: number;
}

export interface VideoEffectsConfig {
  width: number;
  height: number;
  useGPU?: boolean;
  preferWebGPU?: boolean;
}

// WebGL2 shader sources for video effects

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

const PASSTHROUGH_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;

void main() {
 fragColor = texture(u_texture, v_texCoord);
}
`;

const BRIGHTNESS_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_brightness;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec3 rgb = color.rgb + u_brightness;
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const CONTRAST_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_contrast;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec3 rgb = (color.rgb - 0.5) * u_contrast + 0.5;
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const SATURATION_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_saturation;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
 vec3 rgb = mix(vec3(luminance), color.rgb, u_saturation);
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const HUE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_hueRotation;

vec3 rgb2hsv(vec3 c) {
 vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
 vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
 vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
 float d = q.x - min(q.w, q.y);
 float e = 1.0e-10;
 return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
 vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
 vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
 return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec3 hsv = rgb2hsv(color.rgb);
 hsv.x = fract(hsv.x + u_hueRotation / 360.0);
 vec3 rgb = hsv2rgb(hsv);
 fragColor = vec4(rgb, color.a);
}
`;

const BLUR_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_radius;

void main() {
 vec2 texelSize = 1.0 / u_resolution;
 vec4 color = vec4(0.0);
 float total = 0.0;
 
 int r = int(min(u_radius, 10.0));
 for (int x = -r; x <= r; x++) {
 for (int y = -r; y <= r; y++) {
 vec2 offset = vec2(float(x), float(y)) * texelSize;
 color += texture(u_texture, v_texCoord + offset);
 total += 1.0;
 }
 }
 
 fragColor = color / total;
}
`;

const SHARPEN_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_amount;

void main() {
 vec2 texelSize = 1.0 / u_resolution;
 
 vec4 center = texture(u_texture, v_texCoord);
 vec4 top = texture(u_texture, v_texCoord + vec2(0.0, -texelSize.y));
 vec4 bottom = texture(u_texture, v_texCoord + vec2(0.0, texelSize.y));
 vec4 left = texture(u_texture, v_texCoord + vec2(-texelSize.x, 0.0));
 vec4 right = texture(u_texture, v_texCoord + vec2(texelSize.x, 0.0));
 
 vec4 sharpened = center * (1.0 + 4.0 * u_amount) - (top + bottom + left + right) * u_amount;
 fragColor = vec4(clamp(sharpened.rgb, 0.0, 1.0), center.a);
}
`;

const VIGNETTE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_amount;
uniform float u_midpoint;
uniform float u_feather;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec2 center = vec2(0.5, 0.5);
 float dist = distance(v_texCoord, center);
 float vignette = smoothstep(u_midpoint - u_feather, u_midpoint + u_feather, dist);
 vec3 rgb = color.rgb * (1.0 - vignette * u_amount);
 fragColor = vec4(rgb, color.a);
}
`;

const GRAIN_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_amount;
uniform float u_size;
uniform float u_time;

float random(vec2 st) {
 return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 vec2 st = v_texCoord * u_size + u_time;
 float noise = random(st) * 2.0 - 1.0;
 vec3 rgb = color.rgb + noise * u_amount;
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const CHROMA_KEY_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec3 u_keyColor;
uniform float u_tolerance;
uniform float u_softness;

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 float diff = distance(color.rgb, u_keyColor);
 float alpha = smoothstep(u_tolerance - u_softness, u_tolerance + u_softness, diff);
 fragColor = vec4(color.rgb, color.a * alpha);
}
`;

const TEMPERATURE_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_temperature; // -1 (cool/blue) to 1 (warm/orange)

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 
 // Temperature adjustment using color balance

 vec3 rgb = color.rgb;
 
 if (u_temperature > 0.0) {
 rgb.r = rgb.r + u_temperature * 0.2;
 rgb.g = rgb.g + u_temperature * 0.1;
 rgb.b = rgb.b - u_temperature * 0.2;
 } else {
 rgb.r = rgb.r + u_temperature * 0.2;
 rgb.g = rgb.g + u_temperature * 0.05;
 rgb.b = rgb.b - u_temperature * 0.2;
 }
 
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const TINT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_tint; // -1 (green) to 1 (magenta)

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 
 // Tint adjustment

 vec3 rgb = color.rgb;
 
 rgb.r = rgb.r + u_tint * 0.1;
 rgb.g = rgb.g - u_tint * 0.2;
 rgb.b = rgb.b + u_tint * 0.1;
 
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

const TONAL_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_shadows; // -1 to 1
uniform float u_midtones; // -1 to 1
uniform float u_highlights; // -1 to 1

void main() {
 vec4 color = texture(u_texture, v_texCoord);
 float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
 float shadowWeight = 1.0 - smoothstep(0.0, 0.33, luma);
 float highlightWeight = smoothstep(0.66, 1.0, luma);
 float midtoneWeight = 1.0 - shadowWeight - highlightWeight;
 midtoneWeight = max(0.0, midtoneWeight);
 vec3 rgb = color.rgb;
 rgb += u_shadows * shadowWeight * 0.3;
 rgb += u_midtones * midtoneWeight * 0.3;
 rgb += u_highlights * highlightWeight * 0.3;
 
 fragColor = vec4(clamp(rgb, 0.0, 1.0), color.a);
}
`;

interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
}

export type FilterType =
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "blur"
  | "sharpen"
  | "vignette"
  | "grain"
  | "chromaKey"
  | "temperature"
  | "tint"
  | "tonal"
  | "shadow"
  | "glow"
  | "motion-blur"
  | "radial-blur"
  | "chromatic-aberration";

export class VideoEffectsEngine {
  private canvas: OffscreenCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private shaders: Map<FilterType | "passthrough", ShaderProgram> = new Map();
  private quadBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private framebuffers: WebGLFramebuffer[] = [];
  private renderTextures: WebGLTexture[] = [];
  private currentRenderTarget = 0;
  private width: number;
  private height: number;
  private useGPU: boolean;
  private preferWebGPU: boolean;
  private initialized = false;
  private initializing = false;
  private initPromise: Promise<boolean> | null = null;

  // New WebGPU renderer via RendererFactory
  private renderer: Renderer | null = null;
  private rendererFactory: RendererFactory | null = null;
  private useNewRenderer = false;

  constructor(config: VideoEffectsConfig) {
    this.width = config.width;
    this.height = config.height;
    this.useGPU = config.useGPU ?? true;
    this.preferWebGPU = config.preferWebGPU ?? true;
    void this._applyEffectsWithNewRenderer;
    void this._applyEffectsGPU;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    if (this.initializing && this.initPromise) {
      return this.initPromise;
    }

    this.initializing = true;
    this.initPromise = this.doInitialize();

    try {
      const result = await this.initPromise;
      this.initialized = result;
      return result;
    } finally {
      this.initializing = false;
    }
  }

  private async doInitialize(): Promise<boolean> {
    if (this.useGPU) {
      if (this.preferWebGPU && isWebGPUSupported()) {
        try {
          await this.initializeNewRenderer();
          return true;
        } catch (error) {
          console.warn(
            "[VideoEffectsEngine] WebGPU initialization failed, falling back to WebGL2:",
            error,
          );
        }
      }

      if (VideoEffectsEngine.isWebGL2Supported()) {
        this.initializeWebGL();
        return true;
      }
    }

    return true;
  }

  private async initializeNewRenderer(): Promise<void> {
    try {
      this.rendererFactory = RendererFactory.getInstance();
      this.canvas = new OffscreenCanvas(this.width, this.height);

      const config: RendererConfig = {
        canvas: this.canvas,
        width: this.width,
        height: this.height,
        preferredRenderer: this.preferWebGPU ? "webgpu" : "canvas2d",
      };

      this.renderer = await this.rendererFactory.createRenderer(config);
      this.useNewRenderer = true;
    } catch (error) {
      console.warn(
        "[VideoEffectsEngine] Failed to initialize new renderer, falling back to WebGL2:",
        error,
      );
      this.useNewRenderer = false;
      this.initializeWebGL();
    }
  }

  private initializeWebGL(): void {
    this.canvas = new OffscreenCanvas(this.width, this.height);
    const gl = this.canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
    });

    if (!gl) {
      console.warn("WebGL2 not available, falling back to CPU processing");
      this.useGPU = false;
      return;
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
    for (let i = 0; i < 2; i++) {
      const fb = gl.createFramebuffer()!;
      const tex = this.createRenderTexture();
      this.framebuffers.push(fb);
      this.renderTextures.push(tex);
    }

    // Compile all shaders
    this.compileShader("passthrough", VERTEX_SHADER, PASSTHROUGH_SHADER);
    this.compileShader("brightness", VERTEX_SHADER, BRIGHTNESS_SHADER);
    this.compileShader("contrast", VERTEX_SHADER, CONTRAST_SHADER);
    this.compileShader("saturation", VERTEX_SHADER, SATURATION_SHADER);
    this.compileShader("hue", VERTEX_SHADER, HUE_SHADER);
    this.compileShader("blur", VERTEX_SHADER, BLUR_SHADER);
    this.compileShader("sharpen", VERTEX_SHADER, SHARPEN_SHADER);
    this.compileShader("vignette", VERTEX_SHADER, VIGNETTE_SHADER);
    this.compileShader("grain", VERTEX_SHADER, GRAIN_SHADER);
    this.compileShader("chromaKey", VERTEX_SHADER, CHROMA_KEY_SHADER);
    // Color grading shaders
    this.compileShader("temperature", VERTEX_SHADER, TEMPERATURE_SHADER);
    this.compileShader("tint", VERTEX_SHADER, TINT_SHADER);
    this.compileShader("tonal", VERTEX_SHADER, TONAL_SHADER);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createRenderTexture(): WebGLTexture {
    const gl = this.gl!;
    const texture = gl.createTexture()!;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  private compileShader(
    name: FilterType | "passthrough",
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

  async applyEffects(
    image: ImageBitmap,
    effects: Effect[],
  ): Promise<FilterResult> {
    const startTime = performance.now();
    const enabledEffects = effects.filter((e) => e.enabled);
    if (enabledEffects.length === 0) {
      return {
        image: await createImageBitmap(image),
        processingTime: performance.now() - startTime,
        gpuAccelerated: false,
      };
    }

    // Use CPU processing (Canvas2D filters) - reliable and fast for most effects
    // WebGPU effects pipeline has rendering issues, using CPU for now
    const result = await this.applyEffectsCPU(image, enabledEffects);
    return {
      image: result,
      processingTime: performance.now() - startTime,
      gpuAccelerated: false,
    };
  }

  private async _applyEffectsWithNewRenderer(
    image: ImageBitmap,
    effects: Effect[],
  ): Promise<ImageBitmap> {
    if (!this.renderer) {
      throw new Error("Renderer not initialized");
    }

    try {
      const texture = this.renderer.createTextureFromImage(image);
      const processedTexture = this.renderer.applyEffects(texture, effects);

      this.renderer.beginFrame();
      this.renderer.renderLayer({
        texture: processedTexture,
        transform: {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          opacity: 1,
          anchor: { x: 0.5, y: 0.5 },
        },
        effects: [],
        opacity: 1,
        borderRadius: 0,
      });
      const result = await this.renderer.endFrame();

      this.renderer.releaseTexture(texture);

      if (!result || result.width === 0 || result.height === 0) {
        console.warn(
          "[VideoEffectsEngine] Renderer returned invalid result, using CPU fallback",
        );
        return this.applyEffectsCPU(image, effects);
      }

      return result;
    } catch (error) {
      console.warn(
        "[VideoEffectsEngine] applyEffectsWithNewRenderer failed:",
        error,
      );
      return this.applyEffectsCPU(image, effects);
    }
  }

  private async _applyEffectsGPU(
    image: ImageBitmap,
    effects: Effect[],
  ): Promise<ImageBitmap> {
    const gl = this.gl!;
    if (gl.isContextLost()) {
      console.warn(
        "[VideoEffectsEngine] WebGL context lost, falling back to CPU",
      );
      return this.applyEffectsCPU(image, effects);
    }

    try {
      // Resize canvas if needed to match input image
      if (
        this.canvas!.width !== image.width ||
        this.canvas!.height !== image.height
      ) {
        this.canvas!.width = image.width;
        this.canvas!.height = image.height;
        this.width = image.width;
        this.height = image.height;

        // Recreate render textures with new size
        for (let i = 0; i < 2; i++) {
          gl.bindTexture(gl.TEXTURE_2D, this.renderTextures[i]);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            this.width,
            this.height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            null,
          );
        }
      }

      // Upload source image to texture
      const sourceTexture = this.uploadTexture(image);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[i]);
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          this.renderTextures[i],
          0,
        );
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      let currentTexture = sourceTexture;
      this.currentRenderTarget = 0;

      // Apply effects in sequence using ping-pong framebuffers
      // Each effect reads from currentTexture and writes to renderTextures[currentRenderTarget]
      // Next effect uses that as input, avoiding read-write conflicts
      for (const effect of effects) {
        const filterType = effect.type as FilterType;
        const shader = this.shaders.get(filterType);

        if (!shader) {
          continue;
        }

        // Render effect: read from currentTexture, write to renderTextures[currentRenderTarget]
        this.renderWithShader(filterType, currentTexture, effect.params);

        // Ping-pong: next iteration reads from texture we just wrote to
        // Toggle between framebuffers[0]/[1] to avoid reading while writing
        currentTexture = this.renderTextures[this.currentRenderTarget];
        this.currentRenderTarget = 1 - this.currentRenderTarget;
      }

      // Final pass: render result to screen (unbind framebuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      this.renderPassthrough(currentTexture);

      // Clean up source texture
      gl.deleteTexture(sourceTexture);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.warn("[VideoEffectsEngine] WebGL error:", error);
        // Fall back to returning original image
        return createImageBitmap(image);
      }
      return createImageBitmap(this.canvas!);
    } catch (error) {
      console.error("[VideoEffectsEngine] GPU processing failed:", error);
      // Fall back to CPU processing
      return this.applyEffectsCPU(image, effects);
    }
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

  private renderWithShader(
    filterType: FilterType,
    texture: WebGLTexture,
    params: Record<string, unknown>,
  ): void {
    const gl = this.gl!;
    const shader = this.shaders.get(filterType);
    if (!shader) return;
    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      this.framebuffers[this.currentRenderTarget],
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.renderTextures[this.currentRenderTarget],
      0,
    );
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(shader.program);

    // Bind texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const texLoc = shader.uniforms.get("u_texture");
    if (texLoc) gl.uniform1i(texLoc, 0);
    this.setFilterUniforms(filterType, shader, params);
    this.setupVertexAttributes(shader);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderPassthrough(texture: WebGLTexture): void {
    const gl = this.gl!;
    const shader = this.shaders.get("passthrough")!;

    gl.useProgram(shader.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const texLoc = shader.uniforms.get("u_texture");
    if (texLoc) gl.uniform1i(texLoc, 0);

    this.setupVertexAttributes(shader);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

  private setFilterUniforms(
    filterType: FilterType,
    shader: ShaderProgram,
    params: Record<string, unknown>,
  ): void {
    const gl = this.gl!;

    switch (filterType) {
      case "brightness": {
        const loc = shader.uniforms.get("u_brightness");
        if (loc) gl.uniform1f(loc, (params.value as number) || 0);
        break;
      }
      case "contrast": {
        const loc = shader.uniforms.get("u_contrast");
        if (loc) gl.uniform1f(loc, (params.value as number) || 1);
        break;
      }
      case "saturation": {
        const loc = shader.uniforms.get("u_saturation");
        if (loc) gl.uniform1f(loc, (params.value as number) || 1);
        break;
      }
      case "hue": {
        const loc = shader.uniforms.get("u_hueRotation");
        if (loc) gl.uniform1f(loc, (params.rotation as number) || 0);
        break;
      }
      case "blur": {
        const radiusLoc = shader.uniforms.get("u_radius");
        const resLoc = shader.uniforms.get("u_resolution");
        if (radiusLoc)
          gl.uniform1f(radiusLoc, Math.min((params.radius as number) || 0, 10));
        if (resLoc) gl.uniform2f(resLoc, this.width, this.height);
        break;
      }
      case "sharpen": {
        const amountLoc = shader.uniforms.get("u_amount");
        const resLoc = shader.uniforms.get("u_resolution");
        if (amountLoc) gl.uniform1f(amountLoc, (params.amount as number) || 0);
        if (resLoc) gl.uniform2f(resLoc, this.width, this.height);
        break;
      }

      case "vignette": {
        const amountLoc = shader.uniforms.get("u_amount");
        const midpointLoc = shader.uniforms.get("u_midpoint");
        const featherLoc = shader.uniforms.get("u_feather");
        if (amountLoc)
          gl.uniform1f(amountLoc, (params.amount as number) || 0.5);
        if (midpointLoc)
          gl.uniform1f(midpointLoc, (params.midpoint as number) || 0.5);
        if (featherLoc)
          gl.uniform1f(featherLoc, (params.feather as number) || 0.3);
        break;
      }
      case "grain": {
        const amountLoc = shader.uniforms.get("u_amount");
        const sizeLoc = shader.uniforms.get("u_size");
        const timeLoc = shader.uniforms.get("u_time");
        if (amountLoc)
          gl.uniform1f(amountLoc, (params.amount as number) || 0.1);
        if (sizeLoc) gl.uniform1f(sizeLoc, (params.size as number) || 1);
        if (timeLoc) gl.uniform1f(timeLoc, performance.now() / 1000);
        break;
      }
      case "chromaKey": {
        const keyColorLoc = shader.uniforms.get("u_keyColor");
        const toleranceLoc = shader.uniforms.get("u_tolerance");
        const softnessLoc = shader.uniforms.get("u_softness");
        const keyColor = params.keyColor as
          | { r: number; g: number; b: number }
          | undefined;
        if (keyColorLoc) {
          gl.uniform3f(
            keyColorLoc,
            keyColor?.r ?? 0,
            keyColor?.g ?? 1,
            keyColor?.b ?? 0,
          );
        }
        if (toleranceLoc)
          gl.uniform1f(toleranceLoc, (params.tolerance as number) || 0.3);
        if (softnessLoc)
          gl.uniform1f(softnessLoc, (params.edgeSoftness as number) || 0.1);
        break;
      }
      // Color grading filters
      case "temperature": {
        const tempLoc = shader.uniforms.get("u_temperature");
        if (tempLoc) gl.uniform1f(tempLoc, (params.value as number) || 0);
        break;
      }
      case "tint": {
        const tintLoc = shader.uniforms.get("u_tint");
        if (tintLoc) gl.uniform1f(tintLoc, (params.value as number) || 0);
        break;
      }
      case "tonal": {
        const shadowsLoc = shader.uniforms.get("u_shadows");
        const midtonesLoc = shader.uniforms.get("u_midtones");
        const highlightsLoc = shader.uniforms.get("u_highlights");
        if (shadowsLoc)
          gl.uniform1f(shadowsLoc, (params.shadows as number) || 0);
        if (midtonesLoc)
          gl.uniform1f(midtonesLoc, (params.midtones as number) || 0);
        if (highlightsLoc)
          gl.uniform1f(highlightsLoc, (params.highlights as number) || 0);
        break;
      }
    }
  }

  /**
   * Applies effects using Canvas 2D CPU rendering (fallback from GPU).
   * Optimization: Split effects into two categories:
   * 1. CSS filters (brightness, contrast, hue, blur, saturate): hardware-accelerated by browsers
   * 2. Pixel-level effects (sharpen, vignette, grain, chroma-key): require manual pixel manipulation
   *
   * This avoids manual pixel manipulation for simple effects while supporting complex ones.
   * CSS filters are chained in one drawImage call for efficiency.
   */
  private async applyEffectsCPU(
    image: ImageBitmap,
    effects: Effect[],
  ): Promise<ImageBitmap> {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const cssFilters: string[] = [];
    const pixelEffects: Effect[] = [];

    // Categorize effects: CSS-compatible vs pixel-level
    for (const effect of effects) {
      const filterString = this.buildCSSFilter(effect);
      if (filterString) {
        // Simple effects that canvas.ctx.filter supports natively
        cssFilters.push(filterString);
      } else {
        // Complex effects requiring pixel-by-pixel processing
        pixelEffects.push(effect);
      }
    }

    // Apply CSS filters efficiently in one drawImage call
    if (cssFilters.length > 0) {
      ctx.filter = cssFilters.join(" ");
      ctx.drawImage(image, 0, 0);
      ctx.filter = "none";
    } else {
      ctx.drawImage(image, 0, 0);
    }

    // Apply pixel-level effects sequentially (each modifies getImageData/putImageData)
    for (const effect of pixelEffects) {
      await this.applyEffectPixelLevel(
        ctx,
        effect,
        canvas.width,
        canvas.height,
      );
    }

    return createImageBitmap(canvas);
  }

  private async applyEffectPixelLevel(
    ctx: OffscreenCanvasRenderingContext2D,
    effect: Effect,
    width: number,
    height: number,
  ): Promise<void> {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const params = effect.params as Record<string, unknown>;

    switch (effect.type) {
      case "sharpen": {
        const amount = (params.amount as number) || 0.5;
        this.applySharpenKernel(data, width, height, amount);
        break;
      }
      case "vignette": {
        const vigAmount = (params.amount as number) || 0.5;
        const midpoint = (params.midpoint as number) || 0.5;
        const feather = (params.feather as number) || 0.3;
        this.applyVignette(data, width, height, vigAmount, midpoint, feather);
        break;
      }
      case "grain": {
        const grainAmount = (params.amount as number) || 0.1;
        this.applyGrain(data, grainAmount);
        break;
      }
      case "chromaKey": {
        const keyColor = params.keyColor as
          | { r: number; g: number; b: number }
          | undefined;
        const tolerance = (params.tolerance as number) || 0.3;
        const softness = (params.edgeSoftness as number) || 0.1;
        this.applyChromaKey(
          data,
          keyColor || { r: 0, g: 1, b: 0 },
          tolerance,
          softness,
        );
        break;
      }
      // Color grading filters
      case "temperature": {
        const temperature = (params.value as number) || 0;
        this.applyTemperature(data, temperature);
        break;
      }
      case "tint": {
        const tint = (params.value as number) || 0;
        this.applyTint(data, tint);
        break;
      }
      case "tonal": {
        const shadows = (params.shadows as number) || 0;
        const midtones = (params.midtones as number) || 0;
        const highlights = (params.highlights as number) || 0;
        this.applyTonal(data, shadows, midtones, highlights);
        break;
      }
      case "motion-blur": {
        const distance = (params.distance as number) || 0;
        const angle = (params.angle as number) || 0;
        this.applyMotionBlur(data, width, height, distance, angle);
        break;
      }
      case "radial-blur": {
        const amount = (params.amount as number) || 0;
        const centerX = (params.centerX as number) || 50;
        const centerY = (params.centerY as number) || 50;
        this.applyRadialBlur(data, width, height, amount, centerX, centerY);
        break;
      }
      case "chromatic-aberration": {
        const amount = (params.amount as number) || 0;
        this.applyChromaticAberration(data, width, height, amount);
        break;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private applySharpenKernel(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    amount: number,
  ): void {
    const normalizedAmount = amount / 100;
    const copy = new Uint8ClampedArray(data);
    const kernel = [
      0,
      -normalizedAmount,
      0,
      -normalizedAmount,
      1 + 4 * normalizedAmount,
      -normalizedAmount,
      0,
      -normalizedAmount,
      0,
    ];

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const idx = ((y + ky) * width + (x + kx)) * 4 + c;
              sum += copy[idx] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          data[(y * width + x) * 4 + c] = Math.max(0, Math.min(255, sum));
        }
      }
    }
  }

  private applyVignette(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    amount: number,
    midpoint: number,
    feather: number,
  ): void {
    const normalizedAmount = amount / 100;
    const centerX = width / 2;
    const centerY = height / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - centerX) / centerX;
        const dy = (y - centerY) / centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;

        const vignette = this.smoothstep(
          midpoint - feather,
          midpoint + feather,
          dist,
        );
        const factor = 1 - vignette * normalizedAmount;

        const idx = (y * width + x) * 4;
        data[idx] = Math.round(data[idx] * factor);
        data[idx + 1] = Math.round(data[idx + 1] * factor);
        data[idx + 2] = Math.round(data[idx + 2] * factor);
      }
    }
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  private applyGrain(data: Uint8ClampedArray, amount: number): void {
    const normalizedAmount = amount / 100;
    const intensity = normalizedAmount * 50;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * intensity;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
  }

  private applyChromaKey(
    data: Uint8ClampedArray,
    keyColor: { r: number; g: number; b: number },
    tolerance: number,
    softness: number,
  ): void {
    const keyR = keyColor.r * 255;
    const keyG = keyColor.g * 255;
    const keyB = keyColor.b * 255;
    const tolDist = tolerance * 441.67; // sqrt(255^2 * 3)
    const softDist = softness * 441.67;

    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - keyR;
      const dg = data[i + 1] - keyG;
      const db = data[i + 2] - keyB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      const alpha = this.smoothstep(
        tolDist - softDist,
        tolDist + softDist,
        dist,
      );
      data[i + 3] = Math.round(data[i + 3] * alpha);
    }
  }

  private applyTemperature(data: Uint8ClampedArray, temperature: number): void {
    const normalizedTemp = temperature / 100;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (normalizedTemp > 0) {
        r = Math.min(255, r + normalizedTemp * 51);
        g = Math.min(255, g + normalizedTemp * 25.5);
        b = Math.max(0, b - normalizedTemp * 51);
      } else {
        r = Math.max(0, r + normalizedTemp * 51);
        g = Math.max(0, g + normalizedTemp * 12.75);
        b = Math.min(255, b - normalizedTemp * 51);
      }

      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
    }
  }

  private applyTint(data: Uint8ClampedArray, tint: number): void {
    const normalizedTint = tint / 100;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      r = Math.max(0, Math.min(255, r + normalizedTint * 25.5));
      g = Math.max(0, Math.min(255, g - normalizedTint * 51));
      b = Math.max(0, Math.min(255, b + normalizedTint * 25.5));

      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
    }
  }

  private applyTonal(
    data: Uint8ClampedArray,
    shadows: number,
    midtones: number,
    highlights: number,
  ): void {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const shadowWeight = 1 - this.smoothstep(0, 0.33, luma);
      const highlightWeight = this.smoothstep(0.66, 1, luma);
      const midtoneWeight = Math.max(0, 1 - shadowWeight - highlightWeight);
      const adjustment =
        shadows * shadowWeight * 0.3 +
        midtones * midtoneWeight * 0.3 +
        highlights * highlightWeight * 0.3;

      data[i] = Math.round(Math.max(0, Math.min(255, (r + adjustment) * 255)));
      data[i + 1] = Math.round(
        Math.max(0, Math.min(255, (g + adjustment) * 255)),
      );
      data[i + 2] = Math.round(
        Math.max(0, Math.min(255, (b + adjustment) * 255)),
      );
    }
  }

  private applyMotionBlur(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    distance: number,
    angle: number,
  ): void {
    const blurDistance = Math.max(0, distance);
    if (blurDistance <= 0) {
      return;
    }

    const copy = new Uint8ClampedArray(data);
    const sampleCount = Math.max(2, Math.min(16, Math.ceil(blurDistance / 4) + 1));
    const radians = (angle * Math.PI) / 180;
    const dirX = Math.cos(radians);
    const dirY = Math.sin(radians);
    const maxOffset = blurDistance / 2;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let samples = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          const t = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
          const offset = (t - 0.5) * 2 * maxOffset;
          const sampleX = Math.round(x + dirX * offset);
          const sampleY = Math.round(y + dirY * offset);

          if (
            sampleX < 0 ||
            sampleX >= width ||
            sampleY < 0 ||
            sampleY >= height
          ) {
            continue;
          }

          const sampleOffset = (sampleY * width + sampleX) * 4;
          red += copy[sampleOffset];
          green += copy[sampleOffset + 1];
          blue += copy[sampleOffset + 2];
          alpha += copy[sampleOffset + 3];
          samples += 1;
        }

        if (samples === 0) {
          continue;
        }

        const pixelOffset = (y * width + x) * 4;
        data[pixelOffset] = Math.round(red / samples);
        data[pixelOffset + 1] = Math.round(green / samples);
        data[pixelOffset + 2] = Math.round(blue / samples);
        data[pixelOffset + 3] = Math.round(alpha / samples);
      }
    }
  }

  private applyRadialBlur(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    amount: number,
    centerX: number,
    centerY: number,
  ): void {
    const blurAmount = Math.max(0, amount);
    if (blurAmount <= 0) {
      return;
    }

    const copy = new Uint8ClampedArray(data);
    const sampleCount = Math.max(2, Math.min(12, Math.ceil(blurAmount / 8) + 2));
    const strength = Math.max(0, Math.min(1, blurAmount / 100));
    const centerPixelX = (centerX / 100) * Math.max(0, width - 1);
    const centerPixelY = (centerY / 100) * Math.max(0, height - 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const deltaX = x - centerPixelX;
        const deltaY = y - centerPixelY;
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        let samples = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          const t = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
          const scale = 1 + (t - 0.5) * strength * 1.5;
          const sampleX = Math.round(centerPixelX + deltaX * scale);
          const sampleY = Math.round(centerPixelY + deltaY * scale);

          if (
            sampleX < 0 ||
            sampleX >= width ||
            sampleY < 0 ||
            sampleY >= height
          ) {
            continue;
          }

          const sampleOffset = (sampleY * width + sampleX) * 4;
          red += copy[sampleOffset];
          green += copy[sampleOffset + 1];
          blue += copy[sampleOffset + 2];
          alpha += copy[sampleOffset + 3];
          samples += 1;
        }

        if (samples === 0) {
          continue;
        }

        const pixelOffset = (y * width + x) * 4;
        data[pixelOffset] = Math.round(red / samples);
        data[pixelOffset + 1] = Math.round(green / samples);
        data[pixelOffset + 2] = Math.round(blue / samples);
        data[pixelOffset + 3] = Math.round(alpha / samples);
      }
    }
  }

  private applyChromaticAberration(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    amount: number,
  ): void {
    const offset = Math.max(0, Math.round(amount / 2));
    if (offset <= 0) {
      return;
    }

    const copy = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelOffset = (y * width + x) * 4;
        const redX = Math.min(width - 1, x + offset);
        const blueX = Math.max(0, x - offset);
        const redOffset = (y * width + redX) * 4;
        const blueOffset = (y * width + blueX) * 4;

        data[pixelOffset] = copy[redOffset];
        data[pixelOffset + 1] = copy[pixelOffset + 1];
        data[pixelOffset + 2] = copy[blueOffset + 2];
        data[pixelOffset + 3] = copy[pixelOffset + 3];
      }
    }
  }

  private toFilterColor(color: string | undefined, opacity: number): string {
    const alpha = Math.max(0, Math.min(1, opacity));
    if (!color) {
      return `rgba(0, 0, 0, ${alpha})`;
    }

    if (color.startsWith("rgb(" ) || color.startsWith("rgba(")) {
      return color;
    }

    const normalized = color.replace(/^#/, "");
    const hex =
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : normalized;

    if (hex.length !== 6) {
      return `rgba(0, 0, 0, ${alpha})`;
    }

    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);

    if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
      return `rgba(0, 0, 0, ${alpha})`;
    }

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  private buildCSSFilter(effect: Effect): string {
    const params = effect.params as Record<string, number | string>;
    const value = typeof params.value === "number" ? params.value : 0;

    switch (effect.type) {
      case "brightness":
        return `brightness(${1 + value / 100})`;
      case "contrast":
        return `contrast(${params.value || 1})`;
      case "saturation":
        return `saturate(${params.value || 1})`;
      case "hue":
        return `hue-rotate(${params.rotation || 0}deg)`;
      case "blur":
        return `blur(${params.radius || 0}px)`;
      case "shadow": {
        const color = this.toFilterColor(
          typeof params.color === "string" ? params.color : undefined,
          typeof params.opacity === "number" ? params.opacity : 0.8,
        );
        return `drop-shadow(${params.offsetX || 0}px ${params.offsetY || 0}px ${params.blur || 0}px ${color})`;
      }
      case "glow": {
        const radius = Number(params.radius || 0);
        const intensity =
          typeof params.intensity === "number"
            ? Math.max(0, Math.min(3, params.intensity))
            : 1;
        const primaryColor = this.toFilterColor(
          typeof params.color === "string" ? params.color : undefined,
          Math.min(1, 0.35 * intensity),
        );
        const secondaryColor = this.toFilterColor(
          typeof params.color === "string" ? params.color : undefined,
          Math.min(1, 0.2 * intensity),
        );
        return `drop-shadow(0 0 ${radius}px ${primaryColor}) drop-shadow(0 0 ${Math.max(1, radius / 2)}px ${secondaryColor})`;
      }
      default:
        return "";
    }
  }

  async applyEffect(image: ImageBitmap, effect: Effect): Promise<FilterResult> {
    return this.applyEffects(image, [effect]);
  }

  removeEffect(effects: Effect[], effectId: string): Effect[] {
    return effects.filter((e) => e.id !== effectId);
  }

  reorderEffects(
    effects: Effect[],
    fromIndex: number,
    toIndex: number,
  ): Effect[] {
    const result = [...effects];
    const [removed] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, removed);
    return result;
  }

  getEffectOrder(effects: Effect[]): string[] {
    return effects.filter((e) => e.enabled).map((e) => e.id);
  }

  static isWebGL2Supported(): boolean {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext("webgl2");
      return gl !== null;
    } catch {
      return false;
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Resize new renderer if available
    if (this.renderer) {
      this.renderer.resize(width, height);
    }

    // Resize legacy WebGL2 resources
    if (this.gl) {
      // Recreate render textures
      for (const tex of this.renderTextures) {
        this.gl.deleteTexture(tex);
      }
      this.renderTextures = [];

      for (let i = 0; i < 2; i++) {
        this.renderTextures.push(this.createRenderTexture());
      }
    }
  }

  getAvailableFilters(): FilterType[] {
    return [
      "brightness",
      "contrast",
      "saturation",
      "hue",
      "blur",
      "sharpen",
      "vignette",
      "grain",
      "chromaKey",
      "temperature",
      "tint",
      "tonal",
      "shadow",
      "glow",
      "motion-blur",
      "radial-blur",
      "chromatic-aberration",
    ];
  }

  isFilterSupported(filterType: string): boolean {
    return this.getAvailableFilters().includes(filterType as FilterType);
  }

  dispose(): void {
    // Clean up new renderer
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this.rendererFactory = null;
    this.useNewRenderer = false;

    // Clean up legacy WebGL2 resources
    if (this.gl) {
      for (const shader of this.shaders.values()) {
        this.gl.deleteProgram(shader.program);
      }
      this.shaders.clear();
      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
      if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
      for (const fb of this.framebuffers) {
        this.gl.deleteFramebuffer(fb);
      }
      for (const tex of this.renderTextures) {
        this.gl.deleteTexture(tex);
      }

      this.framebuffers = [];
      this.renderTextures = [];
    }

    this.canvas = null;
    this.gl = null;
    this.initialized = false;
  }

  getRendererType(): string {
    if (this.useNewRenderer && this.renderer) {
      return this.renderer.type;
    }
    if (this.gl) {
      return "legacy-webgl2";
    }
    return "cpu";
  }

  isUsingWebGPU(): boolean {
    return this.useNewRenderer && this.renderer?.type === "webgpu";
  }

  getRenderer(): Renderer | null {
    return this.renderer;
  }
}
let videoEffectsEngineInstance: VideoEffectsEngine | null = null;
let initializationPromise: Promise<VideoEffectsEngine> | null = null;

export async function getVideoEffectsEngineAsync(
  width: number = 1920,
  height: number = 1080,
): Promise<VideoEffectsEngine> {
  if (videoEffectsEngineInstance) {
    if (
      videoEffectsEngineInstance["width"] !== width ||
      videoEffectsEngineInstance["height"] !== height
    ) {
      videoEffectsEngineInstance.resize(width, height);
    }
    return videoEffectsEngineInstance;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    videoEffectsEngineInstance = new VideoEffectsEngine({ width, height });
    await videoEffectsEngineInstance.initialize();
    return videoEffectsEngineInstance;
  })();

  return initializationPromise;
}

export function getVideoEffectsEngine(
  width: number = 1920,
  height: number = 1080,
): VideoEffectsEngine {
  if (!videoEffectsEngineInstance) {
    videoEffectsEngineInstance = new VideoEffectsEngine({ width, height });
    videoEffectsEngineInstance.initialize().catch((error) => {
      console.error(
        "[VideoEffectsEngine] Background initialization failed:",
        error,
      );
    });
  } else if (
    videoEffectsEngineInstance["width"] !== width ||
    videoEffectsEngineInstance["height"] !== height
  ) {
    videoEffectsEngineInstance.resize(width, height);
  }
  return videoEffectsEngineInstance;
}

export function disposeVideoEffectsEngine(): void {
  if (videoEffectsEngineInstance) {
    videoEffectsEngineInstance.dispose();
    videoEffectsEngineInstance = null;
  }
}
