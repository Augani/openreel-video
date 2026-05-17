import type { FlowField, InterpolationConfig } from "./types";

const BLOCK_MATCH_SHADER = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  blockSize: u32,
  searchRadius: u32,
  blocksX: u32,
  blocksY: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> frame1: array<u32>;
@group(0) @binding(2) var<storage, read> frame2: array<u32>;
@group(0) @binding(3) var<storage, read_write> flowOutput: array<f32>;

fn getGray(frame: ptr<storage, array<u32>, read>, x: u32, y: u32) -> f32 {
  if (x >= params.width || y >= params.height) { return 0.0; }
  let pixel = (*frame)[y * params.width + x];
  let r = f32((pixel >> 0u) & 0xFFu);
  let g = f32((pixel >> 8u) & 0xFFu);
  let b = f32((pixel >> 16u) & 0xFFu);
  return r * 0.299 + g * 0.587 + b * 0.114;
}

fn computeSAD(bx: u32, by: u32, dx: i32, dy: i32) -> f32 {
  var sad: f32 = 0.0;
  for (var iy: u32 = 0u; iy < params.blockSize; iy++) {
    for (var ix: u32 = 0u; ix < params.blockSize; ix++) {
      let x1 = bx * params.blockSize + ix;
      let y1 = by * params.blockSize + iy;
      let x2 = i32(x1) + dx;
      let y2 = i32(y1) + dy;

      if (x2 < 0 || x2 >= i32(params.width) || y2 < 0 || y2 >= i32(params.height)) {
        sad += 128.0;
        continue;
      }

      let g1 = getGray(&frame1, x1, y1);
      let g2 = getGray(&frame2, u32(x2), u32(y2));
      sad += abs(g1 - g2);
    }
  }
  return sad;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let bx = gid.x;
  let by = gid.y;
  if (bx >= params.blocksX || by >= params.blocksY) { return; }

  var bestDx: i32 = 0;
  var bestDy: i32 = 0;
  var bestSAD: f32 = 1e20;
  let sr = i32(params.searchRadius);

  for (var sy: i32 = -sr; sy <= sr; sy += 2) {
    for (var sx: i32 = -sr; sx <= sr; sx += 2) {
      let sad = computeSAD(bx, by, sx, sy);
      if (sad < bestSAD) {
        bestSAD = sad;
        bestDx = sx;
        bestDy = sy;
      }
    }
  }

  for (var sy: i32 = -1; sy <= 1; sy++) {
    for (var sx: i32 = -1; sx <= 1; sx++) {
      if (sx == 0 && sy == 0) { continue; }
      let sad = computeSAD(bx, by, bestDx + sx, bestDy + sy);
      if (sad < bestSAD) {
        bestSAD = sad;
        bestDx = bestDx + sx;
        bestDy = bestDy + sy;
      }
    }
  }

  let idx = (by * params.blocksX + bx) * 2u;
  flowOutput[idx] = f32(bestDx);
  flowOutput[idx + 1u] = f32(bestDy);
}
`;

const WARP_BLEND_SHADER = /* wgsl */ `
struct WarpParams {
  width: u32,
  height: u32,
  blocksX: u32,
  blocksY: u32,
  blockSize: u32,
  t: f32,
}

@group(0) @binding(0) var<uniform> params: WarpParams;
@group(0) @binding(1) var<storage, read> frame1: array<u32>;
@group(0) @binding(2) var<storage, read> frame2: array<u32>;
@group(0) @binding(3) var<storage, read> flow: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<u32>;

fn sampleFrame(frame: ptr<storage, array<u32>, read>, fx: f32, fy: f32) -> vec4<f32> {
  let x0 = u32(clamp(floor(fx), 0.0, f32(params.width - 1u)));
  let y0 = u32(clamp(floor(fy), 0.0, f32(params.height - 1u)));
  let x1 = min(x0 + 1u, params.width - 1u);
  let y1 = min(y0 + 1u, params.height - 1u);
  let wx = fx - floor(fx);
  let wy = fy - floor(fy);

  let p00 = (*frame)[y0 * params.width + x0];
  let p10 = (*frame)[y0 * params.width + x1];
  let p01 = (*frame)[y1 * params.width + x0];
  let p11 = (*frame)[y1 * params.width + x1];

  let c00 = vec4<f32>(f32(p00 & 0xFFu), f32((p00 >> 8u) & 0xFFu), f32((p00 >> 16u) & 0xFFu), 255.0);
  let c10 = vec4<f32>(f32(p10 & 0xFFu), f32((p10 >> 8u) & 0xFFu), f32((p10 >> 16u) & 0xFFu), 255.0);
  let c01 = vec4<f32>(f32(p01 & 0xFFu), f32((p01 >> 8u) & 0xFFu), f32((p01 >> 16u) & 0xFFu), 255.0);
  let c11 = vec4<f32>(f32(p11 & 0xFFu), f32((p11 >> 8u) & 0xFFu), f32((p11 >> 16u) & 0xFFu), 255.0);

  return mix(mix(c00, c10, wx), mix(c01, c11, wx), wy);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }

  let bx = min(x / params.blockSize, params.blocksX - 1u);
  let by = min(y / params.blockSize, params.blocksY - 1u);
  let flowIdx = (by * params.blocksX + bx) * 2u;
  let dx = flow[flowIdx];
  let dy = flow[flowIdx + 1u];

  let src1X = f32(x) - dx * params.t;
  let src1Y = f32(y) - dy * params.t;
  let src2X = f32(x) + dx * (1.0 - params.t);
  let src2Y = f32(y) + dy * (1.0 - params.t);

  let color1 = sampleFrame(&frame1, src1X, src1Y);
  let color2 = sampleFrame(&frame2, src2X, src2Y);
  let blended = mix(color1, color2, params.t);

  let r = u32(clamp(blended.x, 0.0, 255.0));
  let g = u32(clamp(blended.y, 0.0, 255.0));
  let b = u32(clamp(blended.z, 0.0, 255.0));
  output[y * params.width + x] = r | (g << 8u) | (b << 16u) | (255u << 24u);
}
`;

export class OpticalFlowGPU {
  private device: GPUDevice | null = null;
  private blockMatchPipeline: GPUComputePipeline | null = null;
  private warpBlendPipeline: GPUComputePipeline | null = null;
  private config: InterpolationConfig;

  constructor(config: InterpolationConfig) {
    this.config = config;
  }

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) return false;

    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;

      this.device = await adapter.requestDevice();

      const blockMatchModule = this.device.createShaderModule({
        code: BLOCK_MATCH_SHADER,
      });
      this.blockMatchPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module: blockMatchModule, entryPoint: "main" },
      });

      const warpModule = this.device.createShaderModule({
        code: WARP_BLEND_SHADER,
      });
      this.warpBlendPipeline = this.device.createComputePipeline({
        layout: "auto",
        compute: { module: warpModule, entryPoint: "main" },
      });

      return true;
    } catch {
      return false;
    }
  }

  isReady(): boolean {
    return this.device !== null && this.blockMatchPipeline !== null;
  }

  async computeFlowField(
    frame1Data: Uint32Array,
    frame2Data: Uint32Array,
    width: number,
    height: number,
  ): Promise<FlowField> {
    if (!this.device || !this.blockMatchPipeline) {
      throw new Error("GPU not initialized");
    }

    const { blockSize, searchRadius } = this.config;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);

    const paramsBuffer = this.device.createBuffer({
      size: 24,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(
      paramsBuffer,
      0,
      new Uint32Array([width, height, blockSize, searchRadius, blocksX, blocksY]),
    );

    const frame1Buffer = this.device.createBuffer({
      size: frame1Data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(frame1Buffer, 0, frame1Data as unknown as Uint32Array<ArrayBuffer>);

    const frame2Buffer = this.device.createBuffer({
      size: frame2Data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(frame2Buffer, 0, frame2Data as unknown as Uint32Array<ArrayBuffer>);

    const flowSize = blocksX * blocksY * 2 * 4;
    const flowBuffer = this.device.createBuffer({
      size: flowSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.blockMatchPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: frame1Buffer } },
        { binding: 2, resource: { buffer: frame2Buffer } },
        { binding: 3, resource: { buffer: flowBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.blockMatchPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(blocksX / 8), Math.ceil(blocksY / 8));
    pass.end();

    const readBuffer = this.device.createBuffer({
      size: flowSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(flowBuffer, 0, readBuffer, 0, flowSize);

    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const flowData = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    paramsBuffer.destroy();
    frame1Buffer.destroy();
    frame2Buffer.destroy();
    flowBuffer.destroy();
    readBuffer.destroy();

    return { width: blocksX, height: blocksY, vectors: flowData };
  }

  async warpAndBlend(
    frame1Data: Uint32Array,
    frame2Data: Uint32Array,
    flowField: FlowField,
    width: number,
    height: number,
    t: number,
  ): Promise<Uint32Array> {
    if (!this.device || !this.warpBlendPipeline) {
      throw new Error("GPU not initialized");
    }

    const { blockSize } = this.config;
    const paramsData = new ArrayBuffer(24);
    const paramsView = new DataView(paramsData);
    paramsView.setUint32(0, width, true);
    paramsView.setUint32(4, height, true);
    paramsView.setUint32(8, flowField.width, true);
    paramsView.setUint32(12, flowField.height, true);
    paramsView.setUint32(16, blockSize, true);
    paramsView.setFloat32(20, t, true);

    const paramsBuffer = this.device.createBuffer({
      size: 24,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(paramsBuffer, 0, new Uint8Array(paramsData));

    const frame1Buffer = this.device.createBuffer({
      size: frame1Data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(frame1Buffer, 0, frame1Data as unknown as Uint32Array<ArrayBuffer>);

    const frame2Buffer = this.device.createBuffer({
      size: frame2Data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(frame2Buffer, 0, frame2Data as unknown as Uint32Array<ArrayBuffer>);

    const flowBuffer = this.device.createBuffer({
      size: flowField.vectors.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(flowBuffer, 0, flowField.vectors as unknown as Float32Array<ArrayBuffer>);

    const outputSize = width * height * 4;
    const outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const bindGroup = this.device.createBindGroup({
      layout: this.warpBlendPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: frame1Buffer } },
        { binding: 2, resource: { buffer: frame2Buffer } },
        { binding: 3, resource: { buffer: flowBuffer } },
        { binding: 4, resource: { buffer: outputBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.warpBlendPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
    pass.end();

    const readBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, outputSize);

    this.device.queue.submit([encoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = new Uint32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();

    paramsBuffer.destroy();
    frame1Buffer.destroy();
    frame2Buffer.destroy();
    flowBuffer.destroy();
    outputBuffer.destroy();
    readBuffer.destroy();

    return result;
  }

  dispose(): void {
    this.device?.destroy();
    this.device = null;
    this.blockMatchPipeline = null;
    this.warpBlendPipeline = null;
  }
}
