/**
 * WebGPU runner of the per-clip effect / grade chain.
 *
 * The Canvas2D / WebGL path hands every stage a new ImageBitmap: a canvas draw, a getImageData / putImageData round
 * trip for the 8-bit CPU stages, and a createImageBitmap per stage. This runner uploads the decoded frame ONCE with
 * copyExternalImageToTexture (a GPU copy), runs every planned pass between two resident rgba8unorm textures, presents
 * the last one into a WebGPU canvas and detaches that canvas as an ImageBitmap (transferToImageBitmap: the GPU
 * texture itself, no pixels cross to the CPU). Nothing is read back per frame.
 *
 * The planner (gpu-grade-plan.ts) returns null for anything the chain cannot do, and every failure here (no WebGPU,
 * device lost, shader or pipeline error, canvas problem) resolves to null so the caller keeps the existing path.
 */
import { isSoftwareGpuAdapter } from "./renderer-factory";
import {
  GPU_GRADE_ENTRIES,
  GPU_GRADE_WGSL,
  GPU_UNIFORM_FLOATS,
  type GpuGradeEntry,
} from "./gpu-grade-wgsl";
import type { GpuGradeChainPlan, GpuGradePass, GpuTableSpec } from "./gpu-grade-plan";
import { MAX_GPU_GRADE_PASSES } from "./gpu-grade-plan";

const FORMAT = "rgba8unorm";
const UNIFORM_STRIDE = 256;
const TABLE_CACHE_LIMIT = 48;
const LUT3_CACHE_LIMIT = 4;

export function isWebGpuGradeSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as { gpu?: unknown }).gpu !== "undefined" &&
    (navigator as { gpu?: unknown }).gpu !== null &&
    typeof OffscreenCanvas !== "undefined"
  );
}

interface SharedGpu {
  readonly device: GPUDevice;
  readonly module: GPUShaderModule;
  readonly layout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  readonly sampler: GPUSampler;
  readonly dummyTable: GPUTexture;
  readonly dummyLut3: GPUTexture;
  readonly pipelines: Map<GpuGradeEntry, GPURenderPipeline>;
  readonly pending: Map<GpuGradeEntry, Promise<GPURenderPipeline | null>>;
  usable: boolean;
}

let shared: Promise<SharedGpu | null> | null = null;

async function createShared(): Promise<SharedGpu | null> {
  if (!isWebGpuGradeSupported()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    // SwiftShader can return flat frames from the external-texture grade path.
    // Software adapters use the reference renderer and its synchronous readback.
    if (!adapter || isSoftwareGpuAdapter(adapter)) return null;
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: GPU_GRADE_WGSL });
    const layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform", hasDynamicOffset: true } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "3d" } },
      ],
    });
    const dummyTable = device.createTexture({
      size: [1, 1],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const dummyLut3 = device.createTexture({
      size: [1, 1, 1],
      dimension: "3d",
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const state: SharedGpu = {
      device,
      module,
      layout,
      pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      sampler: device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }),
      dummyTable,
      dummyLut3,
      pipelines: new Map(),
      pending: new Map(),
      usable: true,
    };
    const disable = (why: string): void => {
      if (state.usable) console.warn(`[GpuGradeChain] disabled, clips fall back to the Canvas2D grade: ${why}`);
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

/** The device the grade chain runs on (null without WebGPU), for other GPU stages that must queue behind it. */
export async function getSharedGpuDevice(): Promise<GPUDevice | null> {
  const gpu = await getShared();
  return gpu?.usable ? gpu.device : null;
}

/** Test seam: forget the shared device so the next chain asks for a new one. */
export function resetSharedGpuGrade(): void {
  shared = null;
}

async function pipelineFor(gpu: SharedGpu, entry: GpuGradeEntry): Promise<GPURenderPipeline | null> {
  const cached = gpu.pipelines.get(entry);
  if (cached) return cached;
  const inflight = gpu.pending.get(entry);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const pipeline = await gpu.device.createRenderPipelineAsync({
        layout: gpu.pipelineLayout,
        vertex: { module: gpu.module, entryPoint: "vs" },
        fragment: { module: gpu.module, entryPoint: entry, targets: [{ format: FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      gpu.pipelines.set(entry, pipeline);
      return pipeline;
    } catch (error) {
      console.warn(`[GpuGradeChain] pipeline ${entry} failed to build`, error);
      return null;
    } finally {
      gpu.pending.delete(entry);
    }
  })();
  gpu.pending.set(entry, task);
  return task;
}

export interface GpuGradeStats {
  /** Frames the chain rendered. */
  frames: number;
  /** Frames handed back to the caller's existing path (unsupported plan, no WebGPU, failure). */
  fallbacks: number;
  /** Passes encoded in total. */
  passes: number;
  /** Pixel readbacks the chain performed (always 0: the result leaves as a GPU-backed bitmap). */
  readbacks: number;
  /** Wall time of the last frame's encode + submit + detach on the CPU, in ms. */
  lastCpuMs: number;
  /** Mean CPU ms per rendered frame. */
  meanCpuMs: number;
}

interface Targets {
  width: number;
  height: number;
  source: GPUTexture;
  ping: GPUTexture;
  pong: GPUTexture;
}

/** One chain per VideoEngine; the device, shader module and pipelines are shared by every chain on the page. */
export class GpuGradeChain {
  private targets: Targets | null = null;
  private canvas: OffscreenCanvas | null = null;
  private context: GPUCanvasContext | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private uniformBufferDevice: GPUDevice | null = null;
  private readonly uniformData = new Float32Array((UNIFORM_STRIDE / 4) * (MAX_GPU_GRADE_PASSES + 1));
  private readonly tables = new Map<string, GPUTexture>();
  private readonly lut3 = new Map<object, GPUTexture>();
  private disposed = false;
  private totalCpuMs = 0;
  /** True once the chain cannot render at all (no WebGPU, device lost, a pipeline or frame failed). */
  broken = false;
  readonly stats: GpuGradeStats = { frames: 0, fallbacks: 0, passes: 0, readbacks: 0, lastCpuMs: 0, meanCpuMs: 0 };

  static isSupported(): boolean {
    return isWebGpuGradeSupported();
  }

  /** Compiles the pipelines a plan will need, so its first frame does not pay for them. */
  async warmUp(plan: GpuGradeChainPlan): Promise<boolean> {
    const gpu = await getShared();
    if (!gpu?.usable) return false;
    const entries = new Set<GpuGradeEntry>(plan.passes.map((p) => p.entry));
    entries.add("fs_present");
    const built = await Promise.all([...entries].map((entry) => pipelineFor(gpu, entry)));
    return built.every((p) => p !== null);
  }

  /**
   * Runs the plan over `image`. Resolves to a new ImageBitmap (the caller owns it), or null when the chain could not
   * run, in which case `image` is untouched and the caller uses its existing path.
   */
  async run(image: ImageBitmap, plan: GpuGradeChainPlan): Promise<ImageBitmap | null> {
    if (this.disposed || plan.passes.length === 0) return null;
    const result = await this.tryRun(image, plan);
    if (!result) this.stats.fallbacks++;
    return result;
  }

  private async tryRun(image: ImageBitmap, plan: GpuGradeChainPlan): Promise<ImageBitmap | null> {
    const gpu = await getShared();
    if (!gpu?.usable || this.disposed) {
      this.broken = true;
      return null;
    }
    const { device } = gpu;
    const width = image.width;
    const height = image.height;
    if (width <= 0 || height <= 0 || width > device.limits.maxTextureDimension2D || height > device.limits.maxTextureDimension2D) {
      return null;
    }

    const entries = [...new Set<GpuGradeEntry>([...plan.passes.map((p) => p.entry), "fs_present"])];
    const pipelines = await Promise.all(entries.map((entry) => pipelineFor(gpu, entry)));
    if (pipelines.some((p) => p === null) || !gpu.usable || this.disposed) {
      this.broken = true;
      return null;
    }
    const pipelineByEntry = new Map(entries.map((entry, i) => [entry, pipelines[i] as GPURenderPipeline] as const));

    // From here to the detach everything is synchronous, so two clips rendering concurrently never interleave.
    const started = performance.now();
    try {
      const targets = this.ensureTargets(device, width, height);
      const context = this.ensureCanvas(device, width, height);
      if (!context || !this.canvas) {
        this.broken = true;
        return null;
      }
      const uniformBuffer = this.ensureUniformBuffer(device);

      device.queue.copyExternalImageToTexture({ source: image }, { texture: targets.source, premultipliedAlpha: false }, [width, height]);

      this.uniformData.fill(0);
      const presentIndex = plan.passes.length;
      plan.passes.forEach((pass, i) => this.uniformData.set(pass.uniforms.slice(0, GPU_UNIFORM_FLOATS), (i * UNIFORM_STRIDE) / 4));
      device.queue.writeBuffer(uniformBuffer, 0, this.uniformData, 0, ((presentIndex + 1) * UNIFORM_STRIDE) / 4);

      const encoder = device.createCommandEncoder();
      let input = targets.source;
      let useRing: GPUTexture = targets.ping;
      const run = (pass: GpuGradePass | null, index: number, output: GPUTexture): void => {
        const entry = pass ? pass.entry : "fs_present";
        const bindGroup = device.createBindGroup({
          layout: gpu.layout,
          entries: [
            { binding: 0, resource: { buffer: uniformBuffer, offset: 0, size: UNIFORM_STRIDE } },
            { binding: 1, resource: input.createView() },
            { binding: 2, resource: gpu.sampler },
            { binding: 3, resource: this.tableView(gpu, pass?.table) },
            { binding: 4, resource: this.lut3View(gpu, pass) },
          ],
        });
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{ view: output.createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }],
        });
        renderPass.setPipeline(pipelineByEntry.get(entry) as GPURenderPipeline);
        renderPass.setBindGroup(0, bindGroup, [index * UNIFORM_STRIDE]);
        renderPass.draw(3);
        renderPass.end();
      };
      plan.passes.forEach((pass, index) => {
        run(pass, index, useRing);
        input = useRing;
        useRing = useRing === targets.ping ? targets.pong : targets.ping;
      });
      run(null, presentIndex, context.getCurrentTexture());
      device.queue.submit([encoder.finish()]);

      const bitmap = this.detach();
      const elapsed = performance.now() - started;
      this.stats.frames++;
      this.stats.passes += plan.passes.length + 1;
      this.stats.lastCpuMs = elapsed;
      this.totalCpuMs += elapsed;
      this.stats.meanCpuMs = this.totalCpuMs / this.stats.frames;
      return bitmap;
    } catch (error) {
      console.warn("[GpuGradeChain] frame failed, using the Canvas2D grade", error);
      this.broken = true;
      return null;
    }
  }

  private detach(): ImageBitmap {
    const canvas = this.canvas as OffscreenCanvas;
    return canvas.transferToImageBitmap();
  }

  private ensureTargets(device: GPUDevice, width: number, height: number): Targets {
    const current = this.targets;
    if (current && current.width === width && current.height === height) return current;
    this.destroyTargets();
    const make = (extra: number): GPUTexture =>
      device.createTexture({
        size: [width, height],
        format: FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | extra,
      });
    this.targets = { width, height, source: make(GPUTextureUsage.COPY_DST), ping: make(0), pong: make(0) };
    return this.targets;
  }

  private ensureCanvas(device: GPUDevice, width: number, height: number): GPUCanvasContext | null {
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(width, height);
      this.context = null;
    }
    const resized = this.canvas.width !== width || this.canvas.height !== height;
    if (resized) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (!this.context) {
      const context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) return null;
      context.configure({ device, format: FORMAT, alphaMode: "premultiplied", usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.context = context;
    }
    return this.context;
  }

  private ensureUniformBuffer(device: GPUDevice): GPUBuffer {
    if (!this.uniformBuffer || this.uniformBufferDevice !== device) {
      this.uniformBuffer?.destroy();
      this.uniformBuffer = device.createBuffer({
        size: UNIFORM_STRIDE * (MAX_GPU_GRADE_PASSES + 1),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.uniformBufferDevice = device;
    }
    return this.uniformBuffer;
  }

  private tableView(gpu: SharedGpu, spec: GpuTableSpec | undefined): GPUTextureView {
    if (!spec) return gpu.dummyTable.createView();
    let texture = this.tables.get(spec.key);
    if (texture) {
      this.tables.delete(spec.key);
    } else {
      texture = gpu.device.createTexture({
        size: [spec.width, spec.height],
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      gpu.device.queue.writeTexture({ texture }, spec.build() as Float32Array<ArrayBuffer>, { bytesPerRow: spec.width * 16, rowsPerImage: spec.height }, [spec.width, spec.height]);
      if (this.tables.size >= TABLE_CACHE_LIMIT) {
        const oldest = this.tables.keys().next().value as string;
        this.tables.get(oldest)?.destroy();
        this.tables.delete(oldest);
      }
    }
    this.tables.set(spec.key, texture);
    return texture.createView();
  }

  private lut3View(gpu: SharedGpu, pass: GpuGradePass | null): GPUTextureView {
    const spec = pass?.lut3;
    if (!spec) return gpu.dummyLut3.createView({ dimension: "3d" });
    let texture = this.lut3.get(spec.source);
    if (texture) {
      this.lut3.delete(spec.source);
    } else {
      const n = spec.size;
      texture = gpu.device.createTexture({
        size: [n, n, n],
        dimension: "3d",
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      gpu.device.queue.writeTexture({ texture }, spec.build() as Float32Array<ArrayBuffer>, { bytesPerRow: n * 16, rowsPerImage: n }, [n, n, n]);
      if (this.lut3.size >= LUT3_CACHE_LIMIT) {
        const oldest = this.lut3.keys().next().value as object;
        this.lut3.get(oldest)?.destroy();
        this.lut3.delete(oldest);
      }
    }
    this.lut3.set(spec.source, texture);
    return texture.createView({ dimension: "3d" });
  }

  private destroyTargets(): void {
    if (!this.targets) return;
    this.targets.source.destroy();
    this.targets.ping.destroy();
    this.targets.pong.destroy();
    this.targets = null;
  }

  dispose(): void {
    this.disposed = true;
    this.destroyTargets();
    for (const texture of this.tables.values()) texture.destroy();
    for (const texture of this.lut3.values()) texture.destroy();
    this.tables.clear();
    this.lut3.clear();
    this.uniformBuffer?.destroy();
    this.uniformBuffer = null;
    this.context = null;
    this.canvas = null;
  }
}

/** Every entry point of the shader module, for tests that compile it. */
export const GPU_GRADE_ENTRY_POINTS: readonly GpuGradeEntry[] = GPU_GRADE_ENTRIES;
