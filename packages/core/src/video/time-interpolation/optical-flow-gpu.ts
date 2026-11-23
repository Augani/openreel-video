import type { RGBAFrame } from "./frame-blend";
import { flowFactor, pyramidLevels } from "./optical-flow-cpu";
import {
  CONSISTENCY_WGSL,
  HALVE_WGSL,
  LUMA_DOWN_WGSL,
  MATCH_CONF_WGSL,
  MATCH_ERR_WGSL,
  MEDIAN_WGSL,
  NORMALIZE_WGSL,
  PRODUCTS_WGSL,
  SOLVE_WGSL,
  SYNTH_WGSL,
  UPSAMPLE_WGSL,
} from "./optical-flow-wgsl";
import { FLOW_CONSTANTS, type FlowParams } from "./types";

/**
 * WebGPU compute implementation of the dense optical-flow interpolator (see optical-flow-cpu.ts for the algorithm;
 * the kernels in optical-flow-wgsl.ts mirror it stage for stage). A `GpuFlowPair` keeps the two uploaded frames and
 * the bidirectional flow on the GPU so every intermediate instant between them is one synthesis dispatch.
 */
export type FlowFrameSource = ImageBitmap | RGBAFrame;

export interface GpuFlowPair {
  readonly width: number;
  readonly height: number;
  destroy(): void;
}

interface PairInternals extends GpuFlowPair {
  fw: number;
  fh: number;
  factor: number;
  texA: GPUTexture;
  texB: GPUTexture;
  flowAB: GPUBuffer;
  flowBA: GPUBuffer;
  confAB: GPUBuffer;
  confBA: GPUBuffer;
}

type Binding = GPUBuffer | GPUTexture;

/** Displacement fields uploaded to the GPU (see GpuOpticalFlow.uploadFields). */
export interface GpuFieldSet {
  readonly fw: number;
  readonly fh: number;
  readonly factor: number;
  destroy(): void;
}


function isBitmap(source: FlowFrameSource): source is ImageBitmap {
  return typeof (source as RGBAFrame).data === "undefined";
}

export class GpuOpticalFlow {
  private readonly pipelines = new Map<string, GPUComputePipeline>();
  private lost = false;

  private constructor(private readonly device: GPUDevice) {
    void device.lost.then(() => {
      this.lost = true;
    });
  }

  /** null when WebGPU (or a compute-capable adapter) is unavailable. */
  static async create(): Promise<GpuOpticalFlow | null> {
    try {
      if (typeof navigator === "undefined" || !navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      return new GpuOpticalFlow(device);
    } catch {
      return null;
    }
  }

  get isLost(): boolean {
    return this.lost;
  }

  dispose(): void {
    this.lost = true;
    this.pipelines.clear();
    this.device.destroy();
  }

  private buffer(bytes: number): GPUBuffer {
    return this.device.createBuffer({ size: Math.max(16, bytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  }

  private pipeline(key: string, code: string): GPUComputePipeline {
    let p = this.pipelines.get(key);
    if (!p) {
      p = this.device.createComputePipeline({ layout: "auto", compute: { module: this.device.createShaderModule({ code }), entryPoint: "main" } });
      this.pipelines.set(key, p);
    }
    return p;
  }

  private uniform(spec: string, values: number[], scratch: GPUBuffer[]): GPUBuffer {
    const data = new ArrayBuffer(Math.max(16, spec.length * 4));
    const dv = new DataView(data);
    for (let i = 0; i < spec.length; i++) {
      const v = values[i] ?? 0;
      if (spec[i] === "f") dv.setFloat32(i * 4, v, true);
      else if (spec[i] === "u") dv.setUint32(i * 4, v >>> 0, true);
      else dv.setInt32(i * 4, v, true);
    }
    const buf = this.device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buf, 0, data);
    scratch.push(buf);
    return buf;
  }

  private dispatch(
    enc: GPUCommandEncoder,
    key: string,
    code: string,
    spec: string,
    values: number[],
    bindings: Binding[],
    w: number,
    h: number,
    scratch: GPUBuffer[],
  ): void {
    const pipeline = this.pipeline(key, code);
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.uniform(spec, values, scratch) } }];
    bindings.forEach((b, i) => {
      entries.push({ binding: i + 1, resource: "createView" in b ? b.createView() : { buffer: b } });
    });
    const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
  }

  private upload(source: FlowFrameSource, width: number, height: number): GPUTexture {
    const texture = this.device.createTexture({
      size: { width, height },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (isBitmap(source)) {
      this.device.queue.copyExternalImageToTexture({ source }, { texture }, { width, height });
    } else {
      const bytes = new Uint8Array(source.data.buffer as ArrayBuffer, source.data.byteOffset, source.data.byteLength);
      this.device.queue.writeTexture({ texture }, bytes, { bytesPerRow: width * 4, rowsPerImage: height }, { width, height });
    }
    return texture;
  }

  /** Upload both frames and compute the bidirectional flow with consistency confidence. */
  prepare(a: FlowFrameSource, b: FlowFrameSource, width: number, height: number, params: FlowParams): GpuFlowPair {
    const factor = flowFactor(width, height, params);
    const fw = Math.ceil(width / factor);
    const fh = Math.ceil(height / factor);
    const levels = pyramidLevels(fw, fh, params.levels);
    const texA = this.upload(a, width, height);
    const texB = this.upload(b, width, height);
    const scratch: GPUBuffer[] = [];
    const temp: GPUBuffer[] = [];
    const enc = this.device.createCommandEncoder();

    const dims: Array<[number, number]> = [[fw, fh]];
    for (let i = 1; i < levels; i++) dims.push([Math.max(1, Math.ceil(dims[i - 1][0] / 2)), Math.max(1, Math.ceil(dims[i - 1][1] / 2))]);
    const plane = (i: number): GPUBuffer => {
      const buf = this.buffer(dims[i][0] * dims[i][1] * 4);
      temp.push(buf);
      return buf;
    };
    const pyramid = (tex: GPUTexture): GPUBuffer[] => {
      const raw: GPUBuffer[] = [plane(0)];
      this.dispatch(enc, "luma", LUMA_DOWN_WGSL, "uuuuuuuu", [fw, fh, factor, width, height], [tex, raw[0]], fw, fh, scratch);
      for (let i = 1; i < levels; i++) {
        raw.push(plane(i));
        this.dispatch(enc, "halve", HALVE_WGSL, "uuuu", [dims[i - 1][0], dims[i - 1][1], dims[i][0], dims[i][1]], [raw[i - 1], raw[i]], dims[i][0], dims[i][1], scratch);
      }
      return raw.map((src, i) => {
        const dst = plane(i);
        this.dispatch(enc, "norm", NORMALIZE_WGSL, "iiii", [dims[i][0], dims[i][1], FLOW_CONSTANTS.normRadius], [src, dst], dims[i][0], dims[i][1], scratch);
        return dst;
      });
    };
    const pa = pyramid(texA);
    const pb = pyramid(texB);

    const oneWay = (A: GPUBuffer[], B: GPUBuffer[]): GPUBuffer => {
      const [cw, ch] = dims[levels - 1];
      let flow = this.buffer(cw * ch * 8);
      temp.push(flow);
      for (let level = levels - 1; level >= 0; level--) {
        const [w, h] = dims[level];
        if (level < levels - 1) {
          const up = this.buffer(w * h * 8);
          temp.push(up);
          const [pw, ph] = dims[level + 1];
          this.dispatch(enc, "up", UPSAMPLE_WGSL, "iiii", [pw, ph, w, h], [flow, up], w, h, scratch);
          flow = up;
        }
        const prod = this.buffer(w * h * 20);
        temp.push(prod);
        for (let it = 0; it < params.iterations; it++) {
          this.dispatch(enc, "prod", PRODUCTS_WGSL, "iiii", [w, h], [A[level], B[level], flow, prod], w, h, scratch);
          this.dispatch(enc, "solve", SOLVE_WGSL, "iiii", [w, h, params.radius], [prod, flow], w, h, scratch);
        }
        const med = this.buffer(w * h * 8);
        temp.push(med);
        this.dispatch(enc, "median", MEDIAN_WGSL, "iiii", [w, h], [flow, med], w, h, scratch);
        flow = med;
      }
      return flow;
    };
    const flowAB = oneWay(pa, pb);
    const flowBA = oneWay(pb, pa);

    const confidence = (A: GPUBuffer, B: GPUBuffer, own: GPUBuffer, other: GPUBuffer): GPUBuffer => {
      const err = this.buffer(fw * fh * 4);
      const match = this.buffer(fw * fh * 4);
      temp.push(err, match);
      this.dispatch(enc, "merr", MATCH_ERR_WGSL, "iiii", [fw, fh], [A, B, own, err], fw, fh, scratch);
      this.dispatch(enc, "mconf", MATCH_CONF_WGSL, "iiii", [fw, fh, FLOW_CONSTANTS.matchRadius], [err, match], fw, fh, scratch);
      const conf = this.buffer(fw * fh * 4);
      this.dispatch(enc, "cons", CONSISTENCY_WGSL, "iiii", [fw, fh], [own, other, match, conf], fw, fh, scratch);
      return conf;
    };
    const confAB = confidence(pa[0], pb[0], flowAB, flowBA);
    const confBA = confidence(pb[0], pa[0], flowBA, flowAB);

    this.device.queue.submit([enc.finish()]);
    // The intermediates and uniforms are released once the submitted work has consumed them.
    for (const buf of [...temp.filter((b) => b !== flowAB && b !== flowBA), ...scratch]) buf.destroy();

    const pair: PairInternals = {
      width,
      height,
      fw,
      fh,
      factor,
      texA,
      texB,
      flowAB,
      flowBA,
      confAB,
      confBA,
      destroy: () => {
        texA.destroy();
        texB.destroy();
        flowAB.destroy();
        flowBA.destroy();
        confAB.destroy();
        confBA.destroy();
      },
    };
    return pair;
  }

  /** The bidirectional flow and confidences of a prepared pair, read back to the CPU (flow-resolution grid). */
  async readFlow(pair: GpuFlowPair): Promise<{ width: number; height: number; ab: Float32Array; ba: Float32Array; confAB: Float32Array; confBA: Float32Array }> {
    const p = pair as PairInternals;
    const cells = p.fw * p.fh;
    const sources: Array<[GPUBuffer, number]> = [
      [p.flowAB, cells * 8],
      [p.flowBA, cells * 8],
      [p.confAB, cells * 4],
      [p.confBA, cells * 4],
    ];
    const reads = sources.map(([, bytes]) => this.device.createBuffer({ size: Math.max(16, bytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    const enc = this.device.createCommandEncoder();
    sources.forEach(([buf, bytes], i) => enc.copyBufferToBuffer(buf, 0, reads[i], 0, bytes));
    this.device.queue.submit([enc.finish()]);
    const out: Float32Array[] = [];
    for (let i = 0; i < reads.length; i++) {
      await reads[i].mapAsync(GPUMapMode.READ);
      out.push(new Float32Array(reads[i].getMappedRange().slice(0, sources[i][1])));
      reads[i].unmap();
      reads[i].destroy();
    }
    return { width: p.fw, height: p.fh, ab: out[0], ba: out[1], confAB: out[2], confBA: out[3] };
  }

  /**
   * Upload finished displacement fields once (a Morph Cut analysis); `synthesizeWith` then renders any two live
   * frames through them. `factor` is render pixels per field cell (may be fractional).
   */
  uploadFields(fw: number, fh: number, factor: number, fields: { ab: Float32Array; ba: Float32Array; confAB: Float32Array; confBA: Float32Array }): GpuFieldSet {
    const make = (data: Float32Array): GPUBuffer => {
      const buf = this.buffer(data.byteLength);
      this.device.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      return buf;
    };
    const flowAB = make(fields.ab);
    const flowBA = make(fields.ba);
    const confAB = make(fields.confAB);
    const confBA = make(fields.confBA);
    return {
      fw,
      fh,
      factor,
      flowAB,
      flowBA,
      confAB,
      confBA,
      destroy: () => {
        flowAB.destroy();
        flowBA.destroy();
        confAB.destroy();
        confBA.destroy();
      },
    } as GpuFieldSet;
  }

  /** RGBA bytes of the instant t between two live frames, warped through uploaded fields. */
  async synthesizeWith(fields: GpuFieldSet, a: FlowFrameSource, b: FlowFrameSource, width: number, height: number, t: number): Promise<Uint8ClampedArray> {
    const f = fields as unknown as { fw: number; fh: number; factor: number; flowAB: GPUBuffer; flowBA: GPUBuffer; confAB: GPUBuffer; confBA: GPUBuffer };
    const texA = this.upload(a, width, height);
    const texB = this.upload(b, width, height);
    const bytes = width * height * 4;
    const out = this.buffer(bytes);
    const read = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const scratch: GPUBuffer[] = [];
    const enc = this.device.createCommandEncoder();
    this.dispatch(enc, "synth", SYNTH_WGSL, "iiiiffff", [width, height, f.fw, f.fh, f.factor, t], [texA, texB, f.flowAB, f.flowBA, f.confAB, f.confBA, out], width, height, scratch);
    enc.copyBufferToBuffer(out, 0, read, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = new Uint8ClampedArray(bytes);
    result.set(new Uint8Array(read.getMappedRange()));
    read.unmap();
    read.destroy();
    out.destroy();
    texA.destroy();
    texB.destroy();
    for (const buf of scratch) buf.destroy();
    return result;
  }

  /** RGBA bytes of the frame at instant t between the pair's two frames. */
  async synthesize(pair: GpuFlowPair, t: number): Promise<Uint8ClampedArray> {
    const p = pair as PairInternals;
    const bytes = p.width * p.height * 4;
    const out = this.buffer(bytes);
    const read = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const scratch: GPUBuffer[] = [];
    const enc = this.device.createCommandEncoder();
    this.dispatch(
      enc,
      "synth",
      SYNTH_WGSL,
      "iiiiffff",
      [p.width, p.height, p.fw, p.fh, p.factor, t],
      [p.texA, p.texB, p.flowAB, p.flowBA, p.confAB, p.confBA, out],
      p.width,
      p.height,
      scratch,
    );
    enc.copyBufferToBuffer(out, 0, read, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const result = new Uint8ClampedArray(bytes);
    result.set(new Uint8Array(read.getMappedRange()));
    read.unmap();
    read.destroy();
    out.destroy();
    for (const buf of scratch) buf.destroy();
    return result;
  }
}

