/**
 * Pipelined GPU readback of finished frames for encoders that take raw RGBA (the native ffmpeg pipe).
 *
 * The Canvas2D path reads a frame with `drawImage` into a CPU canvas and `getImageData`: the GPU-backed bitmap is
 * read back synchronously on the renderer thread, so every frame stalls rendering for the whole GPU round trip.
 * Here the bitmap is copied GPU-to-GPU into a texture (`copyExternalImageToTexture`), copied to a MAP_READ buffer
 * and mapped with `mapAsync`: nothing blocks the thread, and a small ring of buffers keeps several frames in flight
 * so the GPU copy of frame N overlaps the render of frame N + 1 and the encoder write of frame N - 1.
 *
 * `begin()` submits the copy and releases the bitmap for the caller to close at once; `finish()` resolves to the
 * tightly packed RGBA bytes. For an opaque frame the bytes equal what `getImageData` returns (both are the canvas
 * pixels as 8-bit sRGB), which the unit and e2e checks assert.
 *
 * With `format: "i420"` the frame is converted on the GPU to planar 8-bit 4:2:0 YCbCr (BT.709, limited range, swscale's chroma
 * subsampling: the arithmetic of `rgbaToI420Bt709`) before the readback, so 1.5 instead of 4 bytes per pixel cross to the
 * CPU, over the IPC port and into ffmpeg, which then skips its own RGB to YUV conversion.
 */
import { I420_CHROMA_TAPS, I420_LUMA_FIXED } from "../export/yuv420-sdr";
import { getSharedGpuDevice } from "./gpu-grade-chain";

const FORMAT = "rgba8unorm";
const PLANE_FORMAT = "r8unorm";
const ROW_ALIGNMENT = 256;

/** The I420 conversion shader with the vertical chroma filter weights filled in. */
export function buildI420Wgsl(): string {
  return I420_WGSL.replaceAll("__TAPS__", I420_CHROMA_TAPS.map((tap) => tap.toFixed(9)).join(", "))
    .replaceAll("__YR__", String(I420_LUMA_FIXED.r))
    .replaceAll("__YG__", String(I420_LUMA_FIXED.g))
    .replaceAll("__YB__", String(I420_LUMA_FIXED.b))
    .replaceAll("__YO__", String(I420_LUMA_FIXED.offset));
}

export type GpuReadbackFormat = "rgba" | "i420";

const I420_WGSL = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn lumaOf(c : vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn code(v : f32, lo : f32, hi : f32) -> f32 { return clamp(floor(v + 0.5), lo, hi) / 255.0; }

@fragment fn fs_y(@builtin(position) pos : vec4f) -> @location(0) f32 {
  let c = textureLoad(src, vec2i(pos.xy), 0).rgb;
  let v = vec3i(round(c * 255.0));
  // Fixed-point luma (I420_LUMA_FIXED in export/yuv420-sdr.ts): within one code value of ffmpeg's own conversion.
  let y = (v.r * __YR__ + v.g * __YG__ + v.b * __YB__ + __YO__) >> 15u;
  return f32(y) / 255.0;
}

fn chromaOf(c : vec3f, blue : bool) -> f32 {
  let y = lumaOf(c);
  if (blue) { return 224.0 * (c.b - y) / 1.8556; }
  return 224.0 * (c.r - y) / 1.5748;
}

// Horizontal mean of a pixel pair on each source row (clamped), then the 8-tap vertical filter of swscale's bicubic
// downscale (see I420_CHROMA_TAPS in export/yuv420-sdr.ts).
fn chroma(cx : i32, cy : i32, blue : bool) -> f32 {
  var taps = array<f32, 8>(__TAPS__);
  let maxRow = i32(textureDimensions(src).y) - 1;
  var acc = 0.0;
  for (var k = 0; k < 8; k++) {
    let row = clamp(cy * 2 - 3 + k, 0, maxRow);
    let a = textureLoad(src, vec2i(cx * 2, row), 0).rgb;
    let b = textureLoad(src, vec2i(cx * 2 + 1, row), 0).rgb;
    acc += taps[k] * (chromaOf(a, blue) + chromaOf(b, blue)) * 0.5;
  }
  return 128.0 + acc;
}

@fragment fn fs_cb(@builtin(position) pos : vec4f) -> @location(0) f32 {
  return code(chroma(i32(pos.x), i32(pos.y), true), 16.0, 240.0);
}

@fragment fn fs_cr(@builtin(position) pos : vec4f) -> @location(0) f32 {
  return code(chroma(i32(pos.x), i32(pos.y), false), 16.0, 240.0);
}
`;

/** bytesPerRow WebGPU needs for a copy of `width` RGBA pixels. */
export function paddedRowBytes(width: number): number {
  return Math.ceil((width * 4) / ROW_ALIGNMENT) * ROW_ALIGNMENT;
}

/** Copies the mapped, row-padded bytes into one tightly packed RGBA buffer. */
export function unpadRows(mapped: ArrayBuffer | Uint8Array, width: number, height: number, target?: ArrayBuffer): ArrayBuffer {
  const source = mapped instanceof Uint8Array ? mapped : new Uint8Array(mapped);
  const rowBytes = width * 4;
  const stride = paddedRowBytes(width);
  const out = target && target.byteLength === rowBytes * height ? new Uint8Array(target) : new Uint8Array(rowBytes * height);
  if (stride === rowBytes) {
    out.set(source.subarray(0, rowBytes * height));
    return out.buffer;
  }
  for (let y = 0; y < height; y++) out.set(source.subarray(y * stride, y * stride + rowBytes), y * rowBytes);
  return out.buffer;
}

function alignUp(value: number): number {
  return Math.ceil(value / ROW_ALIGNMENT) * ROW_ALIGNMENT;
}

/** Where the three planes sit in one readback buffer (each region starts 256-byte aligned) and how big it is. */
export function i420Layout(width: number, height: number): { yOffset: number; uOffset: number; vOffset: number; yStride: number; cStride: number; size: number } {
  const yStride = alignUp(width);
  const cStride = alignUp(width / 2);
  const yBytes = yStride * height;
  const cBytes = cStride * (height / 2);
  const uOffset = alignUp(yBytes);
  const vOffset = uOffset + alignUp(cBytes);
  return { yOffset: 0, uOffset, vOffset, yStride, cStride, size: vOffset + cBytes };
}

/** Packs the mapped Y / Cb / Cr regions into one contiguous I420 frame (Y plane, Cb plane, Cr plane). */
export function unpackI420(mapped: ArrayBuffer | Uint8Array, width: number, height: number, target?: ArrayBuffer): ArrayBuffer {
  const source = mapped instanceof Uint8Array ? mapped : new Uint8Array(mapped);
  const layout = i420Layout(width, height);
  const cw = width / 2;
  const ch = height / 2;
  const total = width * height + 2 * cw * ch;
  const out = new Uint8Array(target && target.byteLength === total ? target : new ArrayBuffer(total));
  for (let y = 0; y < height; y++) out.set(source.subarray(layout.yOffset + y * layout.yStride, layout.yOffset + y * layout.yStride + width), y * width);
  const uBase = width * height;
  const vBase = uBase + cw * ch;
  for (let y = 0; y < ch; y++) {
    out.set(source.subarray(layout.uOffset + y * layout.cStride, layout.uOffset + y * layout.cStride + cw), uBase + y * cw);
    out.set(source.subarray(layout.vOffset + y * layout.cStride, layout.vOffset + y * layout.cStride + cw), vBase + y * cw);
  }
  return out.buffer;
}

export interface GpuReadbackTicket {
  /** Resolves to width * height * 4 bytes of RGBA. Rejects when the GPU path failed; the caller then uses its CPU path. */
  readonly bytes: Promise<ArrayBuffer>;
  /** Hands `bytes` back for reuse once the caller is done with it (it was posted, which copies). Optional. */
  recycle(bytes: ArrayBuffer): void;
}

interface Slot {
  buffer: GPUBuffer;
}

export interface GpuFrameReaderStats {
  frames: number;
  /** Most frames that were in flight (copy submitted, not yet read) at once. */
  maxInFlight: number;
  /** ms spent waiting for a free slot (the ring was full, the encoder is the bottleneck). */
  slotWaitMs: number;
}

interface I420Gpu {
  readonly planes: { y: GPUTexture; cb: GPUTexture; cr: GPUTexture };
  readonly pipelines: { y: GPURenderPipeline; cb: GPURenderPipeline; cr: GPURenderPipeline };
}

export class GpuFrameReader {
  readonly stats: GpuFrameReaderStats = { frames: 0, maxInFlight: 0, slotWaitMs: 0 };
  private texture: GPUTexture;
  private readonly slots: Slot[] = [];
  private readonly free: Slot[] = [];
  private readonly waiters: Array<(slot: Slot) => void> = [];
  private inFlight = 0;
  private disposed = false;
  /** Packed frame buffers handed back by callers, so a frame costs no 8-33 MB allocation and zero fill. */
  private readonly spare: ArrayBuffer[] = [];
  private readonly i420: I420Gpu | null;

  private constructor(
    private readonly device: GPUDevice,
    readonly width: number,
    readonly height: number,
    readonly depth: number,
    readonly format: GpuReadbackFormat,
    i420Pipelines: I420Gpu["pipelines"] | null,
  ) {
    this.texture = device.createTexture({
      size: [width, height],
      format: FORMAT,
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.i420 = i420Pipelines
      ? {
          pipelines: i420Pipelines,
          planes: {
            y: this.planeTexture(width, height),
            cb: this.planeTexture(width / 2, height / 2),
            cr: this.planeTexture(width / 2, height / 2),
          },
        }
      : null;
    const size = format === "i420" ? i420Layout(width, height).size : paddedRowBytes(width) * height;
    for (let i = 0; i < depth; i++) {
      const slot: Slot = { buffer: device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) };
      this.slots.push(slot);
      this.free.push(slot);
    }
  }

  private planeTexture(width: number, height: number): GPUTexture {
    return this.device.createTexture({
      size: [width, height],
      format: PLANE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  /** Bytes of one frame as the ticket returns it. */
  get frameBytes(): number {
    return this.format === "i420" ? this.width * this.height * 1.5 : this.width * this.height * 4;
  }

  /**
   * Null when WebGPU is missing, the frame does not fit the device, or the device cannot be created.
   * "i420" needs even dimensions.
   */
  static async create(width: number, height: number, depth = 3, format: GpuReadbackFormat = "rgba"): Promise<GpuFrameReader | null> {
    if (width <= 0 || height <= 0) return null;
    if (format === "i420" && (width % 2 !== 0 || height % 2 !== 0)) return null;
    try {
      const device = await getSharedGpuDevice();
      if (!device) return null;
      const limits = device.limits;
      const bytes = format === "i420" ? i420Layout(width, height).size : paddedRowBytes(width) * height;
      if (width > limits.maxTextureDimension2D || height > limits.maxTextureDimension2D || bytes > limits.maxBufferSize) return null;
      let pipelines: I420Gpu["pipelines"] | null = null;
      if (format === "i420") {
        // Errors of this shader must stay here: the device is shared with the grade chain, which disables itself on any
        // uncaptured error.
        device.pushErrorScope("validation");
        let built: I420Gpu["pipelines"] | null = null;
        try {
          const module = device.createShaderModule({ code: buildI420Wgsl() });
          const build = (entry: string): Promise<GPURenderPipeline> =>
            device.createRenderPipelineAsync({
              layout: "auto",
              vertex: { module, entryPoint: "vs" },
              fragment: { module, entryPoint: entry, targets: [{ format: PLANE_FORMAT }] },
              primitive: { topology: "triangle-list" },
            });
          const [y, cb, cr] = await Promise.all([build("fs_y"), build("fs_cb"), build("fs_cr")]);
          built = { y, cb, cr };
        } catch {
          built = null;
        }
        const failure = await device.popErrorScope();
        if (failure || !built) return null;
        pipelines = built;
      }
      return new GpuFrameReader(device, width, height, Math.max(1, depth), format, pipelines);
    } catch {
      return null;
    }
  }

  private acquire(): Promise<Slot> {
    const slot = this.free.pop();
    if (slot) return Promise.resolve(slot);
    const started = performance.now();
    return new Promise<Slot>((resolve) => {
      this.waiters.push((next) => {
        this.stats.slotWaitMs += performance.now() - started;
        resolve(next);
      });
    });
  }

  private release(slot: Slot): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(slot);
    else this.free.push(slot);
  }

  private encodeI420(encoder: GPUCommandEncoder, slot: Slot, i420: I420Gpu): void {
    const { device, width, height } = this;
    const source = this.texture.createView();
    const planes: Array<[GPUTexture, GPURenderPipeline]> = [
      [i420.planes.y, i420.pipelines.y],
      [i420.planes.cb, i420.pipelines.cb],
      [i420.planes.cr, i420.pipelines.cr],
    ];
    for (const [target, pipeline] of planes) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: target.createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store" }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source }] }));
      pass.draw(3);
      pass.end();
    }
    const layout = i420Layout(width, height);
    encoder.copyTextureToBuffer({ texture: i420.planes.y }, { buffer: slot.buffer, offset: layout.yOffset, bytesPerRow: layout.yStride, rowsPerImage: height }, [width, height]);
    encoder.copyTextureToBuffer({ texture: i420.planes.cb }, { buffer: slot.buffer, offset: layout.uOffset, bytesPerRow: layout.cStride, rowsPerImage: height / 2 }, [width / 2, height / 2]);
    encoder.copyTextureToBuffer({ texture: i420.planes.cr }, { buffer: slot.buffer, offset: layout.vOffset, bytesPerRow: layout.cStride, rowsPerImage: height / 2 }, [width / 2, height / 2]);
  }

  /**
   * Queues the readback of `image` (width x height). The copy is recorded before this returns its promise, so the
   * bitmap may be closed as soon as `begin` has resolved. Tickets must be finished in the order they were begun.
   */
  async begin(image: ImageBitmap): Promise<GpuReadbackTicket> {
    if (this.disposed) throw new Error("GpuFrameReader disposed");
    if (image.width !== this.width || image.height !== this.height) throw new Error("GpuFrameReader: frame size changed");
    const slot = await this.acquire();
    try {
      const { device } = this;
      device.queue.copyExternalImageToTexture({ source: image }, { texture: this.texture, premultipliedAlpha: false }, [this.width, this.height]);
      const encoder = device.createCommandEncoder();
      if (this.i420) {
        this.encodeI420(encoder, slot, this.i420);
      } else {
        encoder.copyTextureToBuffer(
          { texture: this.texture },
          { buffer: slot.buffer, bytesPerRow: paddedRowBytes(this.width), rowsPerImage: this.height },
          [this.width, this.height],
        );
      }
      device.queue.submit([encoder.finish()]);
    } catch (error) {
      this.release(slot);
      throw error;
    }
    this.inFlight++;
    this.stats.frames++;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.inFlight);
    const bytes = (async (): Promise<ArrayBuffer> => {
      try {
        await slot.buffer.mapAsync(GPUMapMode.READ);
        const mapped = slot.buffer.getMappedRange();
        const target = this.spare.pop();
        const out = this.format === "i420" ? unpackI420(mapped, this.width, this.height, target) : unpadRows(mapped, this.width, this.height, target);
        slot.buffer.unmap();
        return out;
      } finally {
        this.inFlight--;
        this.release(slot);
      }
    })();
    // An un-awaited ticket must not raise an unhandled rejection; the awaiting caller still sees the error.
    bytes.catch(() => undefined);
    return {
      bytes,
      recycle: (buffer) => {
        if (!this.disposed && buffer.byteLength === this.frameBytes && this.spare.length < this.depth) this.spare.push(buffer);
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.texture.destroy();
    if (this.i420) for (const plane of Object.values(this.i420.planes)) plane.destroy();
    for (const slot of this.slots) slot.buffer.destroy();
    this.free.length = 0;
    this.spare.length = 0;
  }
}
