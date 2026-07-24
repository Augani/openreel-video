import { getShaderNoiseTexture } from "@paper-design/shaders";
import type { MotionShaderDef, MotionShaderParamDef, MotionShaderParamType } from "./shaders";

function getNoiseTextureSource(): HTMLImageElement | null {
  try {
    const source = getShaderNoiseTexture();
    if (!source) return null;
    return source.complete && source.naturalWidth > 0 ? source : null;
  } catch {
    return null;
  }
}

export interface MotionShaderRenderInput {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly progress?: number;
  readonly params: Record<string, number | string>;
  readonly inputCanvas?: CanvasImageSource;
}

interface ActiveUniformInfo {
  readonly type: number;
  readonly location: WebGLUniformLocation;
}

interface CompiledProgram {
  readonly program: WebGLProgram;
  readonly ownVertexShader: WebGLShader | null;
  readonly attribLocation: number;
  readonly resolutionLocation: WebGLUniformLocation | null;
  readonly timeLocation: WebGLUniformLocation | null;
  readonly progressLocation: WebGLUniformLocation | null;
  readonly inputLocation: WebGLUniformLocation | null;
  readonly activeUniforms: ReadonlyMap<string, ActiveUniformInfo>;
}

const FALLBACK_COLOR: readonly [number, number, number, number] = [0, 0, 0, 1];

const FALLBACK_COLOR_PARAM: MotionShaderParamDef = {
  name: "color",
  label: "Color",
  type: "color",
  default: "#ffffff",
  min: 0,
  max: 1,
  step: 1,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseHexByte(hex: string, start: number): number | null {
  const slice = hex.slice(start, start + 2);
  if (!/^[0-9a-fA-F]{2}$/.test(slice)) return null;
  return parseInt(slice, 16) / 255;
}

export function parseShaderColor(
  value: string,
): readonly [number, number, number, number] {
  if (typeof value !== "string") return FALLBACK_COLOR;
  if (!value.startsWith("#")) return FALLBACK_COLOR;
  let hex = value.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (hex.length === 6) hex = hex + "ff";
  if (hex.length !== 8) return FALLBACK_COLOR;
  const r = parseHexByte(hex, 0);
  const g = parseHexByte(hex, 2);
  const b = parseHexByte(hex, 4);
  const a = parseHexByte(hex, 6);
  if (r === null || g === null || b === null || a === null) return FALLBACK_COLOR;
  return [clamp01(r), clamp01(g), clamp01(b), clamp01(a)];
}

function colorLuminance(
  color: readonly [number, number, number, number],
): number {
  return clamp01(0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]);
}

export type ShaderParamUpload =
  | { readonly kind: "vec4"; readonly value: readonly [number, number, number, number] }
  | { readonly kind: "float"; readonly value: number };

export function resolveShaderParamUpload(
  uniformType: number,
  floatVec4Const: number,
  paramType: MotionShaderParamType,
  color: readonly [number, number, number, number],
  scalar: number,
): ShaderParamUpload {
  if (uniformType === floatVec4Const) {
    return { kind: "vec4", value: color };
  }
  if (paramType === "color") {
    return { kind: "float", value: colorLuminance(color) };
  }
  return { kind: "float", value: scalar };
}

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 vUv;

void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const QUAD_VERTICES = new Float32Array([
  -1, -1, 3, -1, -1, 3,
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asTexImageSource(
  source: CanvasImageSource,
): TexImageSource | null {
  if (typeof SVGImageElement !== "undefined" && source instanceof SVGImageElement) {
    return null;
  }
  return source as TexImageSource;
}

export type MotionShaderCanvas = HTMLCanvasElement | OffscreenCanvas;

function createMotionShaderCanvas(
  width: number,
  height: number,
): MotionShaderCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Some browser surfaces expose OffscreenCanvas without a constructible
      // implementation. Fall through to a regular canvas on the main thread.
    }
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function getWebGL2Context(
  canvas: MotionShaderCanvas,
  attributes?: WebGLContextAttributes,
): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null;
}

function shaderFallbackColors(
  def: MotionShaderDef,
  params: Record<string, number | string>,
): string[] {
  const colors = def.params
    .filter((param) => param.type === "color")
    .map((param) => params[param.name] ?? param.default)
    .filter((value): value is string => typeof value === "string");
  if (colors.length >= 2) return colors.slice(0, 6);
  let hash = 0;
  for (let index = 0; index < def.id.length; index += 1) {
    hash = (hash * 31 + def.id.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return [
    `hsl(${hue} 78% 58%)`,
    `hsl(${(hue + 85) % 360} 82% 48%)`,
    `hsl(${(hue + 175) % 360} 72% 54%)`,
  ];
}

/**
 * A deterministic 2D material approximation used when WebGL2 is unavailable
 * or a third-party program cannot compile. It deliberately keeps the input
 * alpha, so text/effect previews remain useful instead of silently reverting
 * to a solid color.
 */
export function renderMotionShaderFallbackCanvas(
  def: MotionShaderDef,
  input: MotionShaderRenderInput,
): MotionShaderCanvas | null {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const canvas = createMotionShaderCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  const colors = shaderFallbackColors(def, input.params);
  let material: string | CanvasGradient = colors[0] ?? "#7c3aed";
  if (typeof ctx.createLinearGradient === "function") {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    colors.forEach((color, index) => {
      gradient.addColorStop(
        colors.length === 1 ? 0 : index / (colors.length - 1),
        color,
      );
    });
    material = gradient;
  }

  if (input.inputCanvas) {
    ctx.drawImage(input.inputCanvas, 0, 0, width, height);
    ctx.globalCompositeOperation =
      def.category === "effect" ? "source-atop" : "source-in";
  }
  ctx.globalAlpha = def.category === "effect" ? 0.82 : 1;
  ctx.fillStyle = material;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  const id = def.id.toLowerCase();
  if (id.includes("dot") || id.includes("halftone") || id.includes("dither")) {
    ctx.fillStyle = "rgba(255,255,255,.34)";
    const step = Math.max(5, Math.round(Math.min(width, height) / 9));
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, step * 0.16), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (id.includes("wave") || id.includes("water") || id.includes("swirl")) {
    ctx.strokeStyle = "rgba(255,255,255,.3)";
    ctx.lineWidth = Math.max(1, height / 42);
    for (let row = 1; row < 6; row += 1) {
      const y = (row / 6) * height;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 4) {
        const wave = Math.sin(x / 12 + row + input.time * 2) * (height / 18);
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
  }

  if (input.inputCanvas) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(input.inputCanvas, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }

  return canvas;
}

export class MotionShaderRenderer {
  private canvas: MotionShaderCanvas | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private vertexShader: WebGLShader | null = null;
  private inputTexture: WebGLTexture | null = null;
  private noiseTexture: WebGLTexture | null = null;
  private readonly programs = new Map<string, CompiledProgram | null>();
  private contextLostHandler: ((event: Event) => void) | null = null;
  private unavailable = false;

  static isSupported(): boolean {
    try {
      const canvas = createMotionShaderCanvas(1, 1);
      if (!canvas) return false;
      const context = getWebGL2Context(canvas);
      return context !== null;
    } catch {
      return false;
    }
  }

  render(
    def: MotionShaderDef,
    input: MotionShaderRenderInput,
  ): MotionShaderCanvas | null {
    const gl = this.ensureContext();
    if (!gl || !this.canvas) return renderMotionShaderFallbackCanvas(def, input);

    const compiled = this.ensureProgram(gl, def);
    if (!compiled) return renderMotionShaderFallbackCanvas(def, input);

    const width = Math.max(1, Math.floor(input.width));
    const height = Math.max(1, Math.floor(input.height));
    try {
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(compiled.program);

      if (!this.vertexBuffer) return null;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(compiled.attribLocation);
      gl.vertexAttribPointer(compiled.attribLocation, 2, gl.FLOAT, false, 0, 0);

      const inputUniformName = def.inputUniform ?? "u_input";
      const inputLocation = def.inputUniform
        ? compiled.activeUniforms.get(inputUniformName)?.location ?? null
        : compiled.inputLocation;
      const texSource = input.inputCanvas
        ? asTexImageSource(input.inputCanvas)
        : null;
      if (texSource && this.uploadInputTexture(gl, texSource)) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        if (inputLocation) gl.uniform1i(inputLocation, 0);
      }

      if (def.needsNoiseTexture) {
        this.bindNoiseTexture(gl, compiled, def.needsNoiseTexture);
      }

      if (compiled.resolutionLocation) {
        gl.uniform2f(compiled.resolutionLocation, width, height);
      }
      if (compiled.timeLocation) {
        const time = isFiniteNumber(input.time) ? input.time : 0;
        const scale = isFiniteNumber(def.timeScale) ? def.timeScale : 1;
        gl.uniform1f(compiled.timeLocation, time * scale);
      }
      if (compiled.progressLocation) {
        const progress = isFiniteNumber(input.progress) ? input.progress : 0;
        gl.uniform1f(compiled.progressLocation, progress);
      }

      this.uploadStaticUniforms(gl, compiled, def.staticUniforms);
      this.uploadParamUniforms(gl, compiled, def, input.params);
      this.uploadColorArray(gl, compiled, def, input.params);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.canvas;
    } catch (error) {
      console.warn(`[MotionShaderRenderer] Render failed for ${def.id}:`, error);
      return renderMotionShaderFallbackCanvas(def, input);
    }
  }

  validateFragmentSource(
    glsl: string,
  ): { readonly ok: true } | { readonly ok: false; readonly error: string } {
    const gl = this.ensureContext();
    if (!gl) return { ok: true };
    const shader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!shader) return { ok: false, error: "unable to create shader" };
    try {
      gl.shaderSource(shader, glsl);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        return {
          ok: false,
          error: log && log.length > 0 ? log : "shader compile failed",
        };
      }
      return { ok: true };
    } finally {
      gl.deleteShader(shader);
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      try {
        for (const compiled of this.programs.values()) {
          if (compiled) {
            gl.deleteProgram(compiled.program);
            if (compiled.ownVertexShader) gl.deleteShader(compiled.ownVertexShader);
          }
        }
        if (this.vertexShader) gl.deleteShader(this.vertexShader);
        if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
        if (this.inputTexture) gl.deleteTexture(this.inputTexture);
        if (this.noiseTexture) gl.deleteTexture(this.noiseTexture);
      } catch {
        // Disposal is best-effort; a lost context already freed these resources.
      }
    }
    if (this.canvas && this.contextLostHandler) {
      try {
        this.canvas.removeEventListener(
          "webglcontextlost",
          this.contextLostHandler as EventListener,
        );
      } catch {
        // Removal is best-effort.
      }
    }
    this.programs.clear();
    this.contextLostHandler = null;
    this.vertexShader = null;
    this.vertexBuffer = null;
    this.inputTexture = null;
    this.noiseTexture = null;
    this.gl = null;
    this.canvas = null;
  }

  private ensureContext(): WebGL2RenderingContext | null {
    if (this.unavailable) return null;
    if (this.gl) return this.gl;
    try {
      const canvas = createMotionShaderCanvas(1, 1);
      if (!canvas) {
        this.unavailable = true;
        return null;
      }
      const context = getWebGL2Context(canvas, {
        premultipliedAlpha: true,
        preserveDrawingBuffer: true,
        antialias: false,
      });
      if (!context) {
        this.unavailable = true;
        return null;
      }
      const handler = (): void => {
        for (const compiled of this.programs.values()) {
          if (compiled) {
            try {
              context.deleteProgram(compiled.program);
              if (compiled.ownVertexShader) context.deleteShader(compiled.ownVertexShader);
            } catch {
              // The context is already lost; nothing to free.
            }
          }
        }
        this.programs.clear();
        this.inputTexture = null;
        this.noiseTexture = null;
      };
      canvas.addEventListener(
        "webglcontextlost",
        handler as EventListener,
      );
      const buffer = context.createBuffer();
      if (!buffer) {
        this.unavailable = true;
        return null;
      }
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, QUAD_VERTICES, context.STATIC_DRAW);

      this.canvas = canvas;
      this.gl = context;
      this.vertexBuffer = buffer;
      this.contextLostHandler = handler;
      return context;
    } catch {
      this.unavailable = true;
      return null;
    }
  }

  private ensureProgram(
    gl: WebGL2RenderingContext,
    def: MotionShaderDef,
  ): CompiledProgram | null {
    if (this.programs.has(def.id)) return this.programs.get(def.id) ?? null;
    const compiled = this.compileProgram(gl, def);
    this.programs.set(def.id, compiled);
    return compiled;
  }

  private compileProgram(
    gl: WebGL2RenderingContext,
    def: MotionShaderDef,
  ): CompiledProgram | null {
    let ownVertexShader: WebGLShader | null = null;
    try {
      let vertexShader: WebGLShader | null;
      if (def.vertexShader) {
        ownVertexShader = this.compileShader(gl, gl.VERTEX_SHADER, def.vertexShader);
        vertexShader = ownVertexShader;
      } else {
        vertexShader = this.ensureVertexShader(gl);
      }
      if (!vertexShader) return null;
      const fragmentShader = this.compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        def.glsl,
      );
      if (!fragmentShader) {
        if (ownVertexShader) gl.deleteShader(ownVertexShader);
        return null;
      }

      const program = gl.createProgram();
      if (!program) {
        gl.deleteShader(fragmentShader);
        if (ownVertexShader) gl.deleteShader(ownVertexShader);
        return null;
      }
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.detachShader(program, fragmentShader);
      gl.deleteShader(fragmentShader);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn(
          `[MotionShaderRenderer] Program link failed for ${def.id}:`,
          gl.getProgramInfoLog(program) ?? "unknown link error",
        );
        gl.deleteProgram(program);
        if (ownVertexShader) gl.deleteShader(ownVertexShader);
        return null;
      }

      const attribLocation = gl.getAttribLocation(program, "a_position");
      if (attribLocation < 0) {
        gl.deleteProgram(program);
        if (ownVertexShader) gl.deleteShader(ownVertexShader);
        return null;
      }

      const activeUniforms = this.enumerateActiveUniforms(gl, program);

      return {
        program,
        ownVertexShader,
        attribLocation,
        resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
        timeLocation: gl.getUniformLocation(program, "u_time"),
        progressLocation: gl.getUniformLocation(program, "u_progress"),
        inputLocation: gl.getUniformLocation(program, "u_input"),
        activeUniforms,
      };
    } catch (error) {
      console.warn(
        `[MotionShaderRenderer] Program setup failed for ${def.id}:`,
        error,
      );
      if (ownVertexShader) {
        try {
          gl.deleteShader(ownVertexShader);
        } catch {
          gl.getError();
        }
      }
      return null;
    }
  }

  private enumerateActiveUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
  ): ReadonlyMap<string, ActiveUniformInfo> {
    const map = new Map<string, ActiveUniformInfo>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    if (!isFiniteNumber(count)) return map;
    for (let index = 0; index < count; index += 1) {
      const info = gl.getActiveUniform(program, index);
      if (!info) continue;
      const baseName = info.name.endsWith("[0]")
        ? info.name.slice(0, info.name.length - 3)
        : info.name;
      const location = gl.getUniformLocation(program, info.name);
      if (!location) continue;
      map.set(baseName, { type: info.type, location });
    }
    return map;
  }

  private uploadStaticUniforms(
    gl: WebGL2RenderingContext,
    compiled: CompiledProgram,
    staticUniforms: MotionShaderDef["staticUniforms"],
  ): void {
    if (!staticUniforms) return;
    for (const [name, value] of Object.entries(staticUniforms)) {
      const info = compiled.activeUniforms.get(name);
      if (!info) continue;
      if (typeof value === "number") {
        if (isFiniteNumber(value)) gl.uniform1f(info.location, value);
        continue;
      }
      this.uploadVectorFloat(gl, info.location, value);
    }
  }

  private uploadVectorFloat(
    gl: WebGL2RenderingContext,
    location: WebGLUniformLocation,
    values: readonly number[],
  ): void {
    const safe = values.map((v) => (isFiniteNumber(v) ? v : 0));
    if (safe.length === 2) gl.uniform2f(location, safe[0] ?? 0, safe[1] ?? 0);
    else if (safe.length === 3) gl.uniform3f(location, safe[0] ?? 0, safe[1] ?? 0, safe[2] ?? 0);
    else if (safe.length === 4) gl.uniform4f(location, safe[0] ?? 0, safe[1] ?? 0, safe[2] ?? 0, safe[3] ?? 0);
    else if (safe.length === 1) gl.uniform1f(location, safe[0] ?? 0);
  }

  private uploadParamUniforms(
    gl: WebGL2RenderingContext,
    compiled: CompiledProgram,
    def: MotionShaderDef,
    params: Record<string, number | string>,
  ): void {
    for (const param of def.params) {
      const info = compiled.activeUniforms.get(`u_${param.name}`);
      if (!info) continue;
      const raw = params[param.name];
      const color = this.resolveColor(raw, param);
      const scalar = isFiniteNumber(raw) ? raw : this.resolveScalar(param);
      const upload = resolveShaderParamUpload(
        info.type,
        gl.FLOAT_VEC4,
        param.type,
        color,
        scalar,
      );
      if (upload.kind === "vec4") {
        gl.uniform4f(
          info.location,
          upload.value[0],
          upload.value[1],
          upload.value[2],
          upload.value[3],
        );
        continue;
      }
      gl.uniform1f(info.location, upload.value);
    }
  }

  private resolveScalar(param: MotionShaderParamDef): number {
    return isFiniteNumber(param.default) ? param.default : 0;
  }

  private resolveColor(
    raw: number | string | undefined,
    param: MotionShaderParamDef,
  ): readonly [number, number, number, number] {
    if (typeof raw === "string") return parseShaderColor(raw);
    if (isFiniteNumber(raw)) return [raw, raw, raw, 1];
    if (typeof param.default === "string") return parseShaderColor(param.default);
    const shade = isFiniteNumber(param.default) ? param.default : 0;
    return [shade, shade, shade, 1];
  }

  private uploadColorArray(
    gl: WebGL2RenderingContext,
    compiled: CompiledProgram,
    def: MotionShaderDef,
    params: Record<string, number | string>,
  ): void {
    const spec = def.colorArrayParams;
    if (!spec) return;
    const arrayInfo = compiled.activeUniforms.get(spec.uniform);
    if (!arrayInfo) return;
    const flat: number[] = [];
    let count = 0;
    for (let index = 1; index <= spec.max; index += 1) {
      const name = `color${index}`;
      const paramDef = def.params.find((entry) => entry.name === name);
      const raw = params[name];
      if (raw === undefined && !paramDef) break;
      const color = this.resolveColor(raw, paramDef ?? FALLBACK_COLOR_PARAM);
      flat.push(color[0], color[1], color[2], color[3]);
      count += 1;
    }
    if (count === 0) return;
    gl.uniform4fv(arrayInfo.location, new Float32Array(flat));
    const countInfo = compiled.activeUniforms.get(spec.countUniform);
    if (!countInfo) return;
    if (countInfo.type === gl.INT) gl.uniform1i(countInfo.location, count);
    else gl.uniform1f(countInfo.location, count);
  }

  private bindNoiseTexture(
    gl: WebGL2RenderingContext,
    compiled: CompiledProgram,
    uniformName: string,
  ): void {
    const info = compiled.activeUniforms.get(uniformName);
    if (!info) return;
    const texture = this.ensureNoiseTexture(gl);
    if (!texture) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(info.location, 1);
    gl.activeTexture(gl.TEXTURE0);
  }

  private ensureNoiseTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    if (this.noiseTexture) return this.noiseTexture;
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const source = getNoiseTextureSource();
    try {
      if (source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([127, 127, 127, 255]),
        );
      }
    } catch {
      gl.deleteTexture(texture);
      return null;
    }
    this.noiseTexture = texture;
    return texture;
  }

  private ensureVertexShader(gl: WebGL2RenderingContext): WebGLShader | null {
    if (this.vertexShader) return this.vertexShader;
    const shader = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    this.vertexShader = shader;
    return shader;
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(
        "[MotionShaderRenderer] Shader compilation failed:",
        gl.getShaderInfoLog(shader) ?? "unknown compile error",
      );
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private uploadInputTexture(
    gl: WebGL2RenderingContext,
    source: TexImageSource,
  ): boolean {
    try {
      if (!this.inputTexture) {
        this.inputTexture = gl.createTexture();
        if (!this.inputTexture) return false;
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      return true;
    } catch {
      return false;
    }
  }
}
