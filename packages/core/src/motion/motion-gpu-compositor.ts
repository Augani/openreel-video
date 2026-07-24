import type { BlendMode } from "../video/types";
import { buildMotionBlendWgsl, motionBlendIndex } from "./motion-gpu-blend";

export type MotionGpuLayerImage = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;

export interface MotionGpuCompositeBackground {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const ACCUM_FORMAT: GPUTextureFormat = "rgba16float";

function buildBlendShaderSource(): string {
  return `${buildMotionBlendWgsl()}
struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VSOut {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let xy = corners[idx];
  var out: VSOut;
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}

struct BlendParams {
  mode: u32,
  opacity: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var pointSampler: sampler;
@group(0) @binding(1) var backdropTex: texture_2d<f32>;
@group(0) @binding(2) var layerTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: BlendParams;

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let backdrop = textureSample(backdropTex, pointSampler, in.uv);
  var layer = textureSample(layerTex, pointSampler, in.uv);
  layer.a = clamp(layer.a * params.opacity, 0.0, 1.0);
  return motionComposite(backdrop, layer, params.mode);
}
`;
}

function buildPresentShaderSource(): string {
  return `struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) idx: u32) -> VSOut {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let xy = corners[idx];
  var out: VSOut;
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}

struct PresentParams {
  texelX: f32,
  texelY: f32,
  taps: f32,
  pad: f32,
};

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: PresentParams;

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let taps = i32(params.taps);
  if (taps <= 1) {
    return textureSample(sourceTex, linearSampler, in.uv);
  }
  var acc = vec4<f32>(0.0);
  let half = (params.taps - 1.0) * 0.5;
  for (var y = 0; y < taps; y = y + 1) {
    for (var x = 0; x < taps; x = x + 1) {
      let ox = (f32(x) - half) * params.texelX;
      let oy = (f32(y) - half) * params.texelY;
      acc = acc + textureSample(sourceTex, linearSampler, in.uv + vec2<f32>(ox, oy));
    }
  }
  return acc / (params.taps * params.taps);
}
`;
}

export function isMotionGpuCompositorSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined" &&
    (navigator as Navigator & { gpu?: unknown }).gpu !== null
  );
}

export class MotionGpuCompositor {
  private device: GPUDevice | null = null;
  private pointSampler: GPUSampler | null = null;
  private linearSampler: GPUSampler | null = null;
  private blendPipeline: GPURenderPipeline | null = null;
  private presentPipeline: GPURenderPipeline | null = null;
  private blendParams: GPUBuffer | null = null;
  private presentParams: GPUBuffer | null = null;

  private accum: [GPUTexture | null, GPUTexture | null] = [null, null];
  private current = 0;
  private physicalWidth = 0;
  private physicalHeight = 0;
  private pendingTextures: GPUTexture[] = [];
  private initialized = false;

  static isSupported(): boolean {
    return isMotionGpuCompositorSupported();
  }

  isReady(): boolean {
    return this.initialized && this.device !== null;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return this.device !== null;
    }
    this.initialized = true;
    try {
      if (!isMotionGpuCompositorSupported()) {
        return false;
      }
      const gpu = (navigator as Navigator & { gpu: GPU }).gpu;
      const adapter = await gpu.requestAdapter({
        powerPreference: "high-performance",
      });
      if (!adapter) {
        return false;
      }
      const device = await adapter.requestDevice();
      this.device = device;
      device.lost.then(() => {
        this.device = null;
      });

      this.pointSampler = device.createSampler({
        magFilter: "nearest",
        minFilter: "nearest",
      });
      this.linearSampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
      });

      const blendModule = device.createShaderModule({
        code: buildBlendShaderSource(),
      });
      this.blendPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: blendModule, entryPoint: "vs" },
        fragment: {
          module: blendModule,
          entryPoint: "fs",
          targets: [{ format: ACCUM_FORMAT }],
        },
        primitive: { topology: "triangle-list" },
      });

      const presentModule = device.createShaderModule({
        code: buildPresentShaderSource(),
      });
      this.presentPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: presentModule, entryPoint: "vs" },
        fragment: {
          module: presentModule,
          entryPoint: "fs",
          targets: [{ format: gpu.getPreferredCanvasFormat() }],
        },
        primitive: { topology: "triangle-list" },
      });

      this.blendParams = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.presentParams = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      return true;
    } catch {
      this.device = null;
      return false;
    }
  }

  beginComposite(
    width: number,
    height: number,
    background: MotionGpuCompositeBackground = { r: 0, g: 0, b: 0, a: 0 },
  ): void {
    const device = this.requireDevice();
    const physicalWidth = Math.max(1, Math.round(width));
    const physicalHeight = Math.max(1, Math.round(height));
    if (
      physicalWidth !== this.physicalWidth ||
      physicalHeight !== this.physicalHeight
    ) {
      this.releaseAccumTextures();
      this.accum = [
        this.createAccumTexture(physicalWidth, physicalHeight),
        this.createAccumTexture(physicalWidth, physicalHeight),
      ];
      this.physicalWidth = physicalWidth;
      this.physicalHeight = physicalHeight;
    }
    this.current = 0;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.accum[this.current]!.createView(),
          clearValue: background,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  addLayer(
    image: MotionGpuLayerImage,
    blendMode: BlendMode | undefined,
    opacity: number,
  ): void {
    const device = this.requireDevice();
    if (!this.blendPipeline || !this.blendParams || !this.pointSampler) {
      throw new Error("MotionGpuCompositor pipeline is not ready");
    }
    const source = this.accum[this.current];
    const target = this.accum[1 - this.current];
    if (!source || !target) {
      throw new Error("MotionGpuCompositor must beginComposite before addLayer");
    }

    const layerTexture = device.createTexture({
      size: { width: this.physicalWidth, height: this.physicalHeight },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: image, flipY: false },
      { texture: layerTexture, premultipliedAlpha: false },
      { width: this.physicalWidth, height: this.physicalHeight },
    );
    this.pendingTextures.push(layerTexture);

    const params = new ArrayBuffer(16);
    const view = new DataView(params);
    view.setUint32(0, motionBlendIndex(blendMode), true);
    view.setFloat32(4, clampOpacity(opacity), true);
    device.queue.writeBuffer(this.blendParams, 0, params);

    const bindGroup = device.createBindGroup({
      layout: this.blendPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.pointSampler },
        { binding: 1, resource: source.createView() },
        { binding: 2, resource: layerTexture.createView() },
        { binding: 3, resource: { buffer: this.blendParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.blendPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);

    this.current = 1 - this.current;
  }

  async finish(outputWidth: number, outputHeight: number): Promise<ImageBitmap> {
    const device = this.requireDevice();
    if (!this.presentPipeline || !this.presentParams || !this.linearSampler) {
      throw new Error("MotionGpuCompositor present pipeline is not ready");
    }
    const result = this.accum[this.current];
    if (!result) {
      throw new Error("MotionGpuCompositor has no composited result");
    }
    const width = Math.max(1, Math.round(outputWidth));
    const height = Math.max(1, Math.round(outputHeight));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("MotionGpuCompositor could not get a webgpu context");
    }
    const format = (navigator as Navigator & { gpu: GPU }).gpu
      .getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    const taps = Math.max(
      1,
      Math.round(this.physicalWidth / width),
      Math.round(this.physicalHeight / height),
    );
    const presentData = new ArrayBuffer(16);
    const presentView = new DataView(presentData);
    presentView.setFloat32(0, 1 / Math.max(1, this.physicalWidth), true);
    presentView.setFloat32(4, 1 / Math.max(1, this.physicalHeight), true);
    presentView.setFloat32(8, taps, true);
    device.queue.writeBuffer(this.presentParams, 0, presentData);

    const bindGroup = device.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.linearSampler },
        { binding: 1, resource: result.createView() },
        { binding: 2, resource: { buffer: this.presentParams } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    await (
      device.queue as GPUQueue & { onSubmittedWorkDone(): Promise<void> }
    ).onSubmittedWorkDone();

    this.flushPendingTextures();
    return createImageBitmap(canvas);
  }

  destroy(): void {
    this.flushPendingTextures();
    this.releaseAccumTextures();
    this.blendParams?.destroy();
    this.presentParams?.destroy();
    this.blendParams = null;
    this.presentParams = null;
    this.device = null;
    this.initialized = false;
  }

  private createAccumTexture(width: number, height: number): GPUTexture {
    return this.requireDevice().createTexture({
      size: { width, height },
      format: ACCUM_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC,
    });
  }

  private releaseAccumTextures(): void {
    this.accum[0]?.destroy();
    this.accum[1]?.destroy();
    this.accum = [null, null];
    this.physicalWidth = 0;
    this.physicalHeight = 0;
  }

  private flushPendingTextures(): void {
    for (const texture of this.pendingTextures) {
      texture.destroy();
    }
    this.pendingTextures = [];
  }

  private requireDevice(): GPUDevice {
    if (!this.device) {
      throw new Error("MotionGpuCompositor device is not available");
    }
    return this.device;
  }
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
