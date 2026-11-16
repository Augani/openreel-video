/**
 * WebGPU implementation of PluginGpuBackend.
 *
 * Each plugin shader is assembled (see shader-source.ts), compiled with
 * `getCompilationInfo()` so errors surface with the plugin's own line numbers,
 * and built into a render pipeline inside a validation error scope. A frame is
 * the canvas copied into a texture, one full-screen pass of the plugin's
 * `effect()` and a readback to straight RGBA. Readback keeps the result a
 * plain pixel buffer, which is what both the preview canvas and the export
 * frame path consume, so GPU and CPU plugins compose identically.
 *
 * The GPU surface used here is declared locally (the hand-written
 * webgpu-types.d.ts in core/video predates getCompilationInfo and error scopes).
 */

import {
  computeParamLayout,
  packPluginParams,
  type ParamLayout,
  type ResolvedPluginParams,
} from "./manifest";
import type { LoadedPlugin } from "./package";
import type { PluginFrameHost, PluginGpuBackend } from "./plugin-host";
import { assemblePluginShader, formatShaderDiagnostics, mapShaderDiagnostics } from "./shader-source";

interface GpuBufferLike {
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}
interface GpuTextureLike {
  createView(): unknown;
  destroy(): void;
}
interface GpuPassLike {
  setPipeline(p: unknown): void;
  setBindGroup(i: number, g: unknown): void;
  draw(n: number): void;
  end(): void;
}
interface GpuEncoderLike {
  beginRenderPass(d: unknown): GpuPassLike;
  copyTextureToBuffer(
    src: { texture: GpuTextureLike },
    dst: { buffer: GpuBufferLike; bytesPerRow: number; rowsPerImage: number },
    size: [number, number],
  ): void;
  finish(): unknown;
}
interface GpuDeviceLike {
  createShaderModule(d: { code: string }): {
    getCompilationInfo(): Promise<{ messages: Array<{ type: string; message: string; lineNum: number; linePos: number }> }>;
  };
  createRenderPipelineAsync(d: unknown): Promise<unknown>;
  createBindGroupLayout(d: unknown): unknown;
  createPipelineLayout(d: unknown): unknown;
  createBindGroup(d: unknown): unknown;
  createSampler(d: unknown): unknown;
  createTexture(d: unknown): GpuTextureLike;
  createBuffer(d: { size: number; usage: number }): GpuBufferLike;
  createCommandEncoder(): GpuEncoderLike;
  pushErrorScope(filter: string): void;
  popErrorScope(): Promise<{ message: string } | null>;
  queue: {
    writeBuffer(b: GpuBufferLike, offset: number, data: ArrayBuffer | ArrayBufferView): void;
    copyExternalImageToTexture(
      src: { source: unknown },
      dst: { texture: GpuTextureLike; premultipliedAlpha?: boolean },
      size: [number, number],
    ): void;
    submit(buffers: unknown[]): void;
  };
  lost: Promise<{ message: string; reason: string }>;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}

// GPUBufferUsage / GPUTextureUsage / GPUShaderStage constants (spec values).
const BUFFER_MAP_READ = 0x1;
const BUFFER_COPY_DST = 0x8;
const BUFFER_UNIFORM = 0x40;
const TEX_COPY_SRC = 0x1;
const TEX_COPY_DST = 0x2;
const TEX_BINDING = 0x4;
const TEX_RENDER = 0x10;
const STAGE_FRAGMENT = 0x2;
const MAP_READ = 0x1;

interface CompiledPlugin {
  readonly pipeline: unknown;
  readonly bindGroupLayout: unknown;
  readonly layout: ParamLayout;
  readonly paramBuffer: GpuBufferLike;
}

interface FrameResources {
  width: number;
  height: number;
  input: GpuTextureLike;
  output: GpuTextureLike;
  readback: GpuBufferLike;
  bytesPerRow: number;
}

export class PluginShaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginShaderError";
  }
}

export class WebGpuPluginBackend implements PluginGpuBackend {
  private devicePromise: Promise<GpuDeviceLike> | null = null;
  private readonly compiled = new WeakMap<LoadedPlugin, Promise<CompiledPlugin>>();
  private hostBuffer: GpuBufferLike | null = null;
  private sampler: unknown = null;
  private frame: FrameResources | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  isAvailable(): boolean {
    return typeof navigator !== "undefined" && !!(navigator as unknown as { gpu?: unknown }).gpu;
  }

  private getDevice(): Promise<GpuDeviceLike> {
    if (!this.devicePromise) {
      this.devicePromise = (async () => {
        const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<GpuAdapterLike | null> } }).gpu;
        const adapter = await gpu.requestAdapter();
        if (!adapter) throw new Error("No WebGPU adapter is available");
        const device = await adapter.requestDevice();
        void device.lost.then(() => {
          // Rebuild everything on next use.
          this.devicePromise = null;
          this.hostBuffer = null;
          this.sampler = null;
          this.frame = null;
        });
        return device;
      })();
      this.devicePromise.catch(() => {
        this.devicePromise = null;
      });
    }
    return this.devicePromise;
  }

  /**
   * Compile a plugin shader without running it. Resolves the shader error text,
   * or null when it is valid or cannot be checked here (no adapter / device):
   * a missing GPU is not the plugin's fault.
   */
  async validate(plugin: LoadedPlugin): Promise<string | null> {
    try {
      await this.compile(await this.getDevice(), plugin);
      return null;
    } catch (error) {
      return error instanceof PluginShaderError ? error.message : null;
    }
  }

  private compile(device: GpuDeviceLike, plugin: LoadedPlugin): Promise<CompiledPlugin> {
    let existing = this.compiled.get(plugin);
    if (!existing) {
      existing = this.build(device, plugin);
      this.compiled.set(plugin, existing);
      existing.catch(() => undefined);
    }
    return existing;
  }

  private async build(device: GpuDeviceLike, plugin: LoadedPlugin): Promise<CompiledPlugin> {
    if (plugin.wgsl === undefined) throw new PluginShaderError("plugin has no WGSL shader");
    const { code, lineOffset } = assemblePluginShader(plugin.manifest, plugin.wgsl);
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const diagnostics = mapShaderDiagnostics(info.messages, lineOffset);
    if (diagnostics.some((d) => d.type === "error")) {
      throw new PluginShaderError(`WGSL compile error in ${plugin.manifest.shader?.file ?? "shader"}:\n${formatShaderDiagnostics(diagnostics)}`);
    }
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE_FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: STAGE_FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: STAGE_FRAGMENT, buffer: { type: "uniform" } },
        { binding: 3, visibility: STAGE_FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    device.pushErrorScope("validation");
    let pipeline: unknown;
    let thrown: unknown;
    try {
      pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "orVs" },
        fragment: { module, entryPoint: "orFs", targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list" },
      });
    } catch (error) {
      thrown = error;
    }
    const scoped = await device.popErrorScope();
    if (thrown || scoped) {
      throw new PluginShaderError(`WGSL pipeline error: ${scoped?.message ?? (thrown as Error).message}`);
    }
    const layout = computeParamLayout(plugin.manifest);
    return {
      pipeline,
      bindGroupLayout,
      layout,
      paramBuffer: device.createBuffer({ size: layout.byteSize, usage: BUFFER_UNIFORM | BUFFER_COPY_DST }),
    };
  }

  private getFrame(device: GpuDeviceLike, width: number, height: number): FrameResources {
    const f = this.frame;
    if (f && f.width === width && f.height === height) return f;
    if (f) {
      f.input.destroy();
      f.output.destroy();
      f.readback.destroy();
    }
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    this.frame = {
      width,
      height,
      bytesPerRow,
      input: device.createTexture({
        size: [width, height],
        format: "rgba8unorm",
        usage: TEX_BINDING | TEX_COPY_DST | TEX_RENDER,
      }),
      output: device.createTexture({
        size: [width, height],
        format: "rgba8unorm",
        usage: TEX_RENDER | TEX_COPY_SRC,
      }),
      readback: device.createBuffer({ size: bytesPerRow * height, usage: BUFFER_MAP_READ | BUFFER_COPY_DST }),
    };
    return this.frame;
  }

  run(
    plugin: LoadedPlugin,
    values: ResolvedPluginParams,
    source: unknown,
    width: number,
    height: number,
    host: PluginFrameHost,
    timeoutMs: number,
  ): Promise<Uint8ClampedArray> {
    // Frame resources are shared, so frames run one at a time.
    const job = this.queue.then(() => this.runOnce(plugin, values, source, width, height, host, timeoutMs));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async runOnce(
    plugin: LoadedPlugin,
    values: ResolvedPluginParams,
    source: unknown,
    width: number,
    height: number,
    host: PluginFrameHost,
    timeoutMs: number,
  ): Promise<Uint8ClampedArray> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`WebGPU plugin exceeded the ${timeoutMs} ms frame budget`)), timeoutMs);
    });
    try {
      return await Promise.race([this.render(plugin, values, source, width, height, host), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async render(
    plugin: LoadedPlugin,
    values: ResolvedPluginParams,
    source: unknown,
    width: number,
    height: number,
    host: PluginFrameHost,
  ): Promise<Uint8ClampedArray> {
    const device = await this.getDevice();
    const compiled = await this.compile(device, plugin);
    const frame = this.getFrame(device, width, height);
    this.sampler ??= device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.hostBuffer ??= device.createBuffer({ size: 16, usage: BUFFER_UNIFORM | BUFFER_COPY_DST });

    device.queue.writeBuffer(this.hostBuffer, 0, new Float32Array([width, height, host.time, host.frame]));
    device.queue.writeBuffer(compiled.paramBuffer, 0, packPluginParams(plugin.manifest, compiled.layout, values));
    device.queue.copyExternalImageToTexture({ source }, { texture: frame.input, premultipliedAlpha: false }, [width, height]);

    const bindGroup = device.createBindGroup({
      layout: compiled.bindGroupLayout,
      entries: [
        { binding: 0, resource: frame.input.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.hostBuffer } },
        { binding: 3, resource: { buffer: compiled.paramBuffer } },
      ],
    });
    device.pushErrorScope("validation");
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: frame.output.createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }],
    });
    pass.setPipeline(compiled.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer(
      { texture: frame.output },
      { buffer: frame.readback, bytesPerRow: frame.bytesPerRow, rowsPerImage: height },
      [width, height],
    );
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();
    if (error) throw new PluginShaderError(`WebGPU validation error: ${error.message}`);

    await frame.readback.mapAsync(MAP_READ);
    const mapped = new Uint8Array(frame.readback.getMappedRange());
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      out.set(mapped.subarray(y * frame.bytesPerRow, y * frame.bytesPerRow + width * 4), y * width * 4);
    }
    frame.readback.unmap();
    return out;
  }
}

/** The shared backend, or null in runtimes without WebGPU. */
export function createWebGpuPluginBackend(): WebGpuPluginBackend | null {
  const backend = new WebGpuPluginBackend();
  return backend.isAvailable() ? backend : null;
}
