/**
 * WebGPU renderer of the transition library.
 *
 * The Canvas2D TransitionEngine composes a transition with drawImage calls and letterboxes each shot into a scratch
 * canvas first; every frame therefore costs scratch copies and, for the bitmap path, a createImageBitmap of the
 * result. This renderer uploads each shot once with copyExternalImageToTexture (a GPU copy, no readback), runs the
 * transition as one fragment pass (or one plan pass for the geometric transitions) into a WebGPU canvas and hands that
 * canvas to the caller, which draws it with drawImage (a GPU to GPU copy). Nothing is read back to the CPU per frame.
 *
 * The device and the compiled pipelines are shared by every renderer in the page; each renderer owns its output
 * canvas, its shot textures and its uniform / aux buffers. Compiling a pipeline is the cost of a transition's first
 * frame, which TransitionEngine.warmUp pays ahead of time (the look-ahead the preview already schedules).
 */
import {
  GPU_AUX_FLOATS,
  GPU_PLAN_SHADER,
  GPU_UNIFORM_FLOATS,
  pixelShaderSource,
  type GpuPixelShader,
} from "./transition-gpu-shaders";
import { parseHexColor, type GpuMaskUpload, type GpuTransitionSpec } from "./transition-gpu-spec";
import type { DrawPlan } from "./transition-plans";

type GpuSource = ImageBitmap | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | VideoFrame;

const FORMAT = "rgba8unorm";
const PLAN_SAMPLES = 4;
const VERTEX_FLOATS = 9;

interface SharedGpu {
  readonly device: GPUDevice;
  readonly bindLayout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly sampler: GPUSampler;
  readonly pipelines: Map<string, GPURenderPipeline>;
  readonly pending: Map<string, Promise<GPURenderPipeline | null>>;
  usable: boolean;
}

let shared: Promise<SharedGpu | null> | null = null;

export function isWebGpuTransitionSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as { gpu?: unknown }).gpu !== "undefined" &&
    (navigator as { gpu?: unknown }).gpu !== null &&
    typeof OffscreenCanvas !== "undefined"
  );
}

async function createShared(): Promise<SharedGpu | null> {
  if (!isWebGpuTransitionSupported()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const bindLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    const state: SharedGpu = {
      device,
      bindLayout,
      pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
      sampler: device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      pipelines: new Map(),
      pending: new Map(),
      usable: true,
    };
    const disable = (why: string) => {
      if (state.usable) console.warn(`[TransitionGpu] disabled, transitions fall back to Canvas2D: ${why}`);
      state.usable = false;
    };
    void device.lost.then((info) => {
      disable(`device lost (${info.reason}) ${info.message}`);
      shared = null;
    });
    device.addEventListener("uncapturederror", (event) => {
      disable(String((event as unknown as { error?: { message?: string } }).error?.message ?? "uncaptured error"));
    });
    return state;
  } catch {
    return null;
  }
}

function getShared(): Promise<SharedGpu | null> {
  shared ??= createShared().then((state) => {
    if (!state) shared = null;
    return state;
  });
  return shared;
}

/** Test seam: forget the shared device so the next renderer asks for a new one. */
export function resetSharedTransitionGpu(): void {
  shared = null;
}

const pipelineKey = (shader: GpuPixelShader | "plan"): string => shader;

async function buildPipeline(gpu: SharedGpu, shader: GpuPixelShader | "plan"): Promise<GPURenderPipeline | null> {
  const key = pipelineKey(shader);
  const cached = gpu.pipelines.get(key);
  if (cached) return cached;
  const inflight = gpu.pending.get(key);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const { device } = gpu;
      if (shader === "plan") {
        const module = device.createShaderModule({ code: GPU_PLAN_SHADER });
        const pipeline = await device.createRenderPipelineAsync({
          layout: gpu.pipelineLayout,
          vertex: {
            module,
            entryPoint: "vs",
            buffers: [
              {
                arrayStride: VERTEX_FLOATS * 4,
                attributes: [
                  { shaderLocation: 0, offset: 0, format: "float32x2" },
                  { shaderLocation: 1, offset: 8, format: "float32x2" },
                  { shaderLocation: 2, offset: 16, format: "float32x2" },
                  { shaderLocation: 3, offset: 24, format: "float32x3" },
                ],
              },
            ],
          },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [
              {
                format: FORMAT,
                blend: {
                  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                },
              },
            ],
          },
          primitive: { topology: "triangle-list" },
          multisample: { count: PLAN_SAMPLES },
        });
        gpu.pipelines.set(key, pipeline);
        return pipeline;
      }
      const module = device.createShaderModule({ code: pixelShaderSource(shader) });
      const pipeline = await device.createRenderPipelineAsync({
        layout: gpu.pipelineLayout,
        vertex: { module, entryPoint: "vs" },
        fragment: { module, entryPoint: "fs", targets: [{ format: FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      gpu.pipelines.set(key, pipeline);
      return pipeline;
    } catch (error) {
      console.warn(`[TransitionGpu] pipeline ${shader} failed to compile:`, error);
      return null;
    } finally {
      gpu.pending.delete(key);
    }
  })();
  gpu.pending.set(key, task);
  return task;
}

interface ShotTexture {
  texture: GPUTexture;
  width: number;
  height: number;
}

export interface ShotInfo {
  readonly source: GpuSource;
  readonly width: number;
  readonly height: number;
}

/** Pixel size of a shot as the browser draws it, or 0 x 0 when unknown. */
export function shotDimensions(source: unknown): { width: number; height: number } {
  const s = source as {
    displayWidth?: number;
    displayHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    width?: unknown;
    height?: unknown;
  };
  const width = s.displayWidth ?? s.videoWidth ?? (typeof s.width === "number" ? s.width : 0);
  const height = s.displayHeight ?? s.videoHeight ?? (typeof s.height === "number" ? s.height : 0);
  return { width, height };
}

/** True for the shot types copyExternalImageToTexture accepts. */
export function isGpuUploadable(source: unknown): source is GpuSource {
  if (source === null || typeof source !== "object") return false;
  return (
    (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) ||
    (typeof OffscreenCanvas !== "undefined" && source instanceof OffscreenCanvas) ||
    (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) ||
    (typeof VideoFrame !== "undefined" && source instanceof VideoFrame)
  );
}

/** Where a shot of `shotWidth x shotHeight` sits inside an engine of `width x height`: contain, centred (x, y, w, h as fractions). */
export function fitRect(shotWidth: number, shotHeight: number, width: number, height: number): [number, number, number, number] {
  if ((shotWidth === width && shotHeight === height) || shotWidth <= 0 || shotHeight <= 0) return [0, 0, 1, 1];
  const shotAspect = shotWidth / shotHeight;
  const aspect = width / height;
  const drawWidth = shotAspect > aspect ? width : height * shotAspect;
  const drawHeight = shotAspect > aspect ? width / shotAspect : height;
  return [(width - drawWidth) / 2 / width, (height - drawHeight) / 2 / height, drawWidth / width, drawHeight / height];
}

class VertexWriter {
  data: Float32Array<ArrayBuffer> = new Float32Array(VERTEX_FLOATS * 4096);
  count = 0;

  private ensure(vertices: number): void {
    const need = (this.count + vertices) * VERTEX_FLOATS;
    if (need <= this.data.length) return;
    const grown = new Float32Array(Math.max(need, this.data.length * 2));
    grown.set(this.data.subarray(0, this.count * VERTEX_FLOATS));
    this.data = grown;
  }

  vertex(x: number, y: number, sx: number, sy: number, mode: number, alpha: number, r = 0, g = 0, b = 0): void {
    this.ensure(1);
    const o = this.count * VERTEX_FLOATS;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = sx;
    d[o + 3] = sy;
    d[o + 4] = mode;
    d[o + 5] = alpha;
    d[o + 6] = r;
    d[o + 7] = g;
    d[o + 8] = b;
    this.count += 1;
  }

  reset(): void {
    this.count = 0;
  }
}

type Mat = readonly [number, number, number, number, number, number];

function invert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** Writes a plan as triangles; returns the vertex count. */
export function writePlanVertices(plan: DrawPlan, out: VertexWriter): number {
  out.reset();
  const fan = (poly: readonly (readonly [number, number])[], emit: (x: number, y: number) => void): void => {
    for (let i = 1; i + 1 < poly.length; i += 1) {
      for (const k of [0, i, i + 1]) emit(poly[k]![0], poly[k]![1]);
    }
  };
  for (const layer of plan) {
    switch (layer.kind) {
      case "rect": {
        const mode = layer.src === "A" ? 0 : 1;
        const alpha = layer.alpha ?? 1;
        const [sx, sy, sw, sh] = layer.s;
        const [dx, dy, dw, dh] = layer.d;
        const corners: [number, number, number, number][] = [
          [dx, dy, sx, sy],
          [dx + dw, dy, sx + sw, sy],
          [dx + dw, dy + dh, sx + sw, sy + sh],
          [dx, dy + dh, sx, sy + sh],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          const c = corners[k]!;
          out.vertex(c[0], c[1], c[2], c[3], mode, alpha);
        }
        break;
      }
      case "poly": {
        const mode = layer.src === "A" ? 0 : 1;
        const alpha = layer.alpha ?? 1;
        const inverse = layer.matrix ? invert(layer.matrix) : null;
        fan(layer.poly, (x, y) => {
          const sx = inverse ? inverse[0] * x + inverse[2] * y + inverse[4] : x;
          const sy = inverse ? inverse[1] * x + inverse[3] * y + inverse[5] : y;
          out.vertex(x, y, sx, sy, mode, alpha);
        });
        if (layer.tint) {
          const [r, g, b] = parseHexColor(layer.tint.color);
          fan(layer.poly, (x, y) => out.vertex(x, y, 0, 0, 2, layer.tint!.alpha, r / 255, g / 255, b / 255));
        }
        break;
      }
      case "fill": {
        const [r, g, b] = parseHexColor(layer.color);
        fan(layer.poly, (x, y) => out.vertex(x, y, 0, 0, 2, layer.alpha ?? 1, r / 255, g / 255, b / 255));
        break;
      }
      case "stroke": {
        const [r, g, b] = parseHexColor(layer.color);
        const half = layer.width / 2;
        const n = layer.poly.length;
        for (let i = 0; i < n; i += 1) {
          const a = layer.poly[i]!;
          const c = layer.poly[(i + 1) % n]!;
          const ex = c[0] - a[0];
          const ey = c[1] - a[1];
          const len = Math.hypot(ex, ey);
          if (len === 0) continue;
          const tx = (ex / len) * half;
          const ty = (ey / len) * half;
          const nx = -ty;
          const ny = tx;
          // The edge's quad, lengthened by half the width at both ends so the corners are joined square.
          const q: [number, number][] = [
            [a[0] - tx + nx, a[1] - ty + ny],
            [c[0] + tx + nx, c[1] + ty + ny],
            [c[0] + tx - nx, c[1] + ty - ny],
            [a[0] - tx - nx, a[1] - ty - ny],
          ];
          for (const k of [0, 1, 2, 0, 2, 3]) out.vertex(q[k]![0], q[k]![1], 0, 0, 2, 1, r / 255, g / 255, b / 255);
        }
        break;
      }
      case "gradient": {
        const dx = layer.to[0] - layer.from[0];
        const dy = layer.to[1] - layer.from[1];
        const len2 = dx * dx + dy * dy || 1;
        fan(layer.poly, (x, y) => {
          const t = ((x - layer.from[0]) * dx + (y - layer.from[1]) * dy) / len2;
          out.vertex(x, y, t, 0, 3, 1, layer.alpha0, layer.alpha1, 0);
        });
        break;
      }
    }
  }
  return out.count;
}

export class GpuTransitionRenderer {
  /** The WebGPU canvas every frame is drawn into; the caller draws it with drawImage. */
  canvas: OffscreenCanvas;
  private context: GPUCanvasContext | null = null;
  private readonly uniforms = new Float32Array(GPU_UNIFORM_FLOATS);
  private uniformBuffer: GPUBuffer | null = null;
  private auxBuffer: GPUBuffer | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private vertexCapacity = 0;
  private readonly vertices = new VertexWriter();
  private shotA: ShotTexture | null = null;
  private shotB: ShotTexture | null = null;
  private maskTexture: ShotTexture | null = null;
  private dummyTexture: GPUTexture | null = null;
  private msaa: ShotTexture | null = null;
  private gpu: SharedGpu | null = null;
  private disposed = false;
  /** Frames drawn, and the shaders compiled, since creation (read by tests and the perf trace). */
  framesDrawn = 0;

  private constructor(
    private width: number,
    private height: number,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
  }

  /** A renderer on the shared device, or null when WebGPU is unavailable or the device cannot be created. */
  static async create(width: number, height: number): Promise<GpuTransitionRenderer | null> {
    const gpu = await getShared();
    if (!gpu || !gpu.usable) return null;
    const renderer = new GpuTransitionRenderer(width, height);
    renderer.gpu = gpu;
    if (!renderer.configure()) return null;
    return renderer;
  }

  get usable(): boolean {
    return !this.disposed && this.gpu !== null && this.gpu.usable && this.context !== null;
  }

  private configure(): boolean {
    const gpu = this.gpu;
    if (!gpu) return false;
    try {
      const context = this.canvas.getContext("webgpu");
      if (!context) return false;
      context.configure({ device: gpu.device, format: FORMAT, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.context = context;
      const { device } = gpu;
      this.uniformBuffer = device.createBuffer({ size: GPU_UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.auxBuffer = device.createBuffer({ size: GPU_AUX_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.dummyTexture = device.createTexture({ size: [1, 1], format: FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      return true;
    } catch {
      return false;
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas = new OffscreenCanvas(width, height);
    this.context = null;
    this.msaa?.texture.destroy();
    this.msaa = null;
    const buffers = [this.uniformBuffer, this.auxBuffer];
    this.uniformBuffer = null;
    this.auxBuffer = null;
    this.dummyTexture?.destroy();
    for (const buffer of buffers) buffer?.destroy();
    this.configure();
  }

  /** Compiles the pipeline a spec needs (a no-op once compiled); false when it cannot be compiled. */
  async prepare(spec: GpuTransitionSpec): Promise<boolean> {
    if (!this.usable || !this.gpu) return false;
    return (await buildPipeline(this.gpu, spec.kind === "plan" ? "plan" : spec.shader)) !== null;
  }

  /**
   * Compiles a transition's pipeline and runs it once on 2 x 2 stand-ins (never shown: the next real frame overwrites
   * the canvas), so its first real frame does not pay for the shader compile, the pipeline's first submit or the
   * canvas's first present.
   */
  async warm(spec: GpuTransitionSpec): Promise<boolean> {
    if (!(await this.prepare(spec)) || !this.gpu) return false;
    const { device } = this.gpu;
    const stand = (r: number): ImageBitmap | OffscreenCanvas => {
      const c = new OffscreenCanvas(2, 2);
      const g = c.getContext("2d");
      if (g) {
        g.fillStyle = r ? "#fff" : "#000";
        g.fillRect(0, 0, 2, 2);
      }
      return c;
    };
    const a = stand(0);
    const b = stand(1);
    const keep: [ShotTexture | null, ShotTexture | null] = [this.shotA, this.shotB];
    this.shotA = null;
    this.shotB = null;
    try {
      const ok = this.draw(spec, a, b);
      await device.queue.onSubmittedWorkDone?.();
      return ok;
    } finally {
      const standIns = [this.shotA as ShotTexture | null, this.shotB as ShotTexture | null];
      for (const shot of standIns) shot?.texture.destroy();
      [this.shotA, this.shotB] = keep;
    }
  }

  private upload(slot: "A" | "B", source: GpuSource): ShotTexture | null {
    const gpu = this.gpu;
    if (!gpu) return null;
    const { width, height } = shotDimensions(source);
    if (width <= 0 || height <= 0) return null;
    let shot = slot === "A" ? this.shotA : this.shotB;
    if (!shot || shot.width !== width || shot.height !== height) {
      shot?.texture.destroy();
      shot = {
        texture: gpu.device.createTexture({
          size: [width, height],
          format: FORMAT,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        }),
        width,
        height,
      };
      if (slot === "A") this.shotA = shot;
      else this.shotB = shot;
    }
    gpu.device.queue.copyExternalImageToTexture({ source }, { texture: shot.texture, premultipliedAlpha: true }, [width, height]);
    return shot;
  }

  private uploadMask(mask: GpuMaskUpload): GPUTexture | null {
    const gpu = this.gpu;
    if (!gpu) return null;
    if (!this.maskTexture || this.maskTexture.width !== mask.width || this.maskTexture.height !== mask.height) {
      this.maskTexture?.texture.destroy();
      this.maskTexture = {
        texture: gpu.device.createTexture({ size: [mask.width, mask.height], format: "rg8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }),
        width: mask.width,
        height: mask.height,
      };
    }
    gpu.device.queue.writeTexture({ texture: this.maskTexture.texture }, mask.rg, { bytesPerRow: mask.width * 2, rowsPerImage: mask.height }, [mask.width, mask.height]);
    return this.maskTexture.texture;
  }

  /**
   * Draws one frame into `canvas`. Needs the spec's pipeline to be compiled (`prepare`); returns false when the frame
   * cannot be drawn on the GPU (a shot of a type or size WebGPU cannot take, an uncompiled pipeline), so the caller
   * draws it with Canvas2D.
   */
  draw(spec: GpuTransitionSpec, outgoing: unknown, incoming: unknown, progress = 0): boolean {
    const gpu = this.gpu;
    if (!this.usable || !gpu || !this.context || !this.uniformBuffer || !this.auxBuffer || !this.dummyTexture) return false;
    if (!isGpuUploadable(outgoing) || !isGpuUploadable(incoming)) return false;
    const pipeline = gpu.pipelines.get(spec.kind === "plan" ? "plan" : spec.shader);
    if (!pipeline) return false;
    const a = this.upload("A", outgoing);
    const b = this.upload("B", incoming);
    if (!a || !b) return false;
    const { device } = gpu;
    const fitA = fitRect(a.width, a.height, this.width, this.height);
    const fitB = fitRect(b.width, b.height, this.width, this.height);
    const u = this.uniforms;
    u.fill(0);
    u[0] = this.width;
    u[1] = this.height;
    u[2] = progress;
    u[3] = spec.kind === "pixel" ? spec.flag : 0;
    u.set(fitA, 4);
    u.set(fitB, 8);
    let maskView: GPUTextureView | null = null;
    if (spec.kind === "pixel") {
      u.set(spec.v, 12);
      if (spec.aux) {
        if (spec.aux.length > GPU_AUX_FLOATS) return false;
        device.queue.writeBuffer(this.auxBuffer, 0, spec.aux);
      }
      if (spec.mask) {
        const tex = this.uploadMask(spec.mask);
        maskView = tex ? tex.createView() : null;
      }
    }
    device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const bind = device.createBindGroup({
      layout: gpu.bindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: gpu.sampler },
        { binding: 2, resource: a.texture.createView() },
        { binding: 3, resource: b.texture.createView() },
        { binding: 4, resource: { buffer: this.auxBuffer } },
        { binding: 5, resource: maskView ?? this.dummyTexture.createView() },
      ],
    });
    const encoder = device.createCommandEncoder();
    const target = this.context.getCurrentTexture().createView();
    if (spec.kind === "plan") {
      const count = writePlanVertices(spec.plan, this.vertices);
      if (count === 0) return false;
      const bytes = count * VERTEX_FLOATS * 4;
      if (!this.vertexBuffer || this.vertexCapacity < bytes) {
        this.vertexBuffer?.destroy();
        this.vertexCapacity = Math.max(bytes, this.vertexCapacity * 2, 65536);
        this.vertexBuffer = device.createBuffer({ size: this.vertexCapacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      device.queue.writeBuffer(this.vertexBuffer, 0, this.vertices.data, 0, count * VERTEX_FLOATS);
      if (!this.msaa || this.msaa.width !== this.width || this.msaa.height !== this.height) {
        this.msaa?.texture.destroy();
        this.msaa = {
          texture: device.createTexture({ size: [this.width, this.height], format: FORMAT, sampleCount: PLAN_SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT }),
          width: this.width,
          height: this.height,
        };
      }
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: this.msaa.texture.createView(), resolveTarget: target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "discard" },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.setVertexBuffer(0, this.vertexBuffer, 0, bytes);
      pass.draw(count);
      pass.end();
    } else {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
    }
    device.queue.submit([encoder.finish()]);
    this.framesDrawn += 1;
    return true;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of [this.shotA, this.shotB, this.maskTexture, this.msaa]) t?.texture.destroy();
    this.dummyTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.auxBuffer?.destroy();
    this.vertexBuffer?.destroy();
    this.shotA = this.shotB = this.maskTexture = this.msaa = null;
    this.dummyTexture = this.uniformBuffer = this.auxBuffer = this.vertexBuffer = null;
    this.context = null;
  }
}
