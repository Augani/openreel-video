import type { Vec3 } from "../schema/common";
import type { Mesh } from "../geometry";
import {
  renderMeshToImage,
  type RenderOptions,
  type RenderedImage,
} from "./raster";

// Minimal, self-contained WebGPU type surface so this module typechecks in every
// consumer (browser, desktop, node) without relying on ambient global GPU types.
// Values match the WebGPU spec; the real GPU implementation runs in a WebGPU host.
const WGPU_BUFFER = {
  VERTEX: 0x0020,
  INDEX: 0x0010,
  UNIFORM: 0x0040,
  COPY_DST: 0x0008,
  COPY_SRC: 0x0004,
  MAP_READ: 0x0001,
} as const;
const WGPU_TEXTURE = { RENDER_ATTACHMENT: 0x10, COPY_SRC: 0x01 } as const;
const WGPU_MAP_READ = 0x0001;

interface WGpuBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}
interface WGpuTextureView {
  readonly __view?: never;
}
interface WGpuTexture {
  createView(): WGpuTextureView;
}
interface WGpuShaderModule {
  readonly __shader?: never;
}
interface WGpuBindGroupLayout {
  readonly __bgl?: never;
}
interface WGpuBindGroup {
  readonly __bg?: never;
}
interface WGpuRenderPipeline {
  getBindGroupLayout(index: number): WGpuBindGroupLayout;
}
interface WGpuCommandBuffer {
  readonly __cmd?: never;
}
interface WGpuRenderPassEncoder {
  setPipeline(pipeline: WGpuRenderPipeline): void;
  setBindGroup(index: number, group: WGpuBindGroup): void;
  setVertexBuffer(slot: number, buffer: WGpuBuffer): void;
  setIndexBuffer(buffer: WGpuBuffer, format: string): void;
  drawIndexed(indexCount: number): void;
  end(): void;
}
interface WGpuCommandEncoder {
  beginRenderPass(descriptor: Record<string, unknown>): WGpuRenderPassEncoder;
  copyTextureToBuffer(
    source: Record<string, unknown>,
    destination: Record<string, unknown>,
    copySize: Record<string, unknown>,
  ): void;
  finish(): WGpuCommandBuffer;
}
interface WGpuQueue {
  writeBuffer(buffer: WGpuBuffer, offset: number, data: ArrayBufferView): void;
  submit(buffers: WGpuCommandBuffer[]): void;
}
interface WGpuDevice {
  readonly queue: WGpuQueue;
  createBuffer(descriptor: { size: number; usage: number }): WGpuBuffer;
  createTexture(descriptor: Record<string, unknown>): WGpuTexture;
  createShaderModule(descriptor: { code: string }): WGpuShaderModule;
  createRenderPipeline(descriptor: Record<string, unknown>): WGpuRenderPipeline;
  createBindGroup(descriptor: Record<string, unknown>): WGpuBindGroup;
  createCommandEncoder(): WGpuCommandEncoder;
}
interface WGpuAdapter {
  requestDevice(): Promise<WGpuDevice>;
}
interface WGpu {
  requestAdapter(): Promise<WGpuAdapter | null>;
}

function getNavigatorGpu(): WGpu | undefined {
  const nav = (globalThis as { navigator?: { gpu?: WGpu } }).navigator;
  return nav?.gpu ?? undefined;
}

export const CREATION_WGSL = /* wgsl */ `
struct Uniforms {
  mvp : mat4x4<f32>,
  lightDir : vec4<f32>,
  baseColor : vec4<f32>,
  ambient : vec4<f32>,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) color : vec3<f32>,
) -> VSOut {
  var out : VSOut;
  out.pos = u.mvp * vec4<f32>(position, 1.0);
  out.normal = normal;
  out.color = color;
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(u.lightDir.xyz);
  let diffuse = max(dot(n, l), 0.0);
  let shade = clamp(u.ambient.x + u.lightDir.w * diffuse, 0.0, 1.0);
  return vec4<f32>(in.color * shade, 1.0);
}
`;

export function isWebGpuRenderAvailable(): boolean {
  return getNavigatorGpu() !== undefined;
}

type Mat4 = number[];

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const fz = norm(sub(target, eye));
  const rx = norm(cross(fz, up));
  const uy = cross(rx, fz);
  return [
    rx.x, rx.y, rx.z, -dot(rx, eye),
    uy.x, uy.y, uy.z, -dot(uy, eye),
    -fz.x, -fz.y, -fz.z, dot(fz, eye),
    0, 0, 0, 1,
  ];
}

function perspective(fovRadians: number, aspect: number, near: number, far: number): Mat4 {
  const t = 1 / Math.tan(fovRadians / 2);
  return [
    t / aspect, 0, 0, 0,
    0, t, 0, 0,
    0, 0, (far + near) / (near - far), (2 * far * near) / (near - far),
    0, 0, -1, 0,
  ];
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row * 4 + col] =
        a[row * 4]! * b[col]! +
        a[row * 4 + 1]! * b[col + 4]! +
        a[row * 4 + 2]! * b[col + 8]! +
        a[row * 4 + 3]! * b[col + 12]!;
    }
  }
  return out;
}

function transpose(m: Mat4): number[] {
  return [
    m[0]!, m[4]!, m[8]!, m[12]!,
    m[1]!, m[5]!, m[9]!, m[13]!,
    m[2]!, m[6]!, m[10]!, m[14]!,
    m[3]!, m[7]!, m[11]!, m[15]!,
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function norm(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

function hexToRgb01(
  hex: string | undefined,
  fallback: [number, number, number],
): [number, number, number] {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;
  return [r, g, b];
}

function buildUniforms(options: RenderOptions): Float32Array {
  const camera = options.camera;
  const fov = ((camera.fov ?? 45) * Math.PI) / 180;
  const view = lookAt(camera.position, camera.target, camera.up ?? { x: 0, y: 1, z: 0 });
  const proj = perspective(fov, options.width / options.height, camera.near ?? 0.05, camera.far ?? 100);
  const mvp = transpose(multiply(proj, view));
  const light = options.light ?? { direction: { x: 0.4, y: 0.8, z: 0.6 } };
  const dir = norm(light.direction);
  const baseColor = hexToRgb01(options.baseColor, [0.58, 0.64, 0.72]);
  const data = new Float32Array(28);
  data.set(mvp, 0);
  data.set([dir.x, dir.y, dir.z, light.intensity ?? 0.85], 16);
  data.set([baseColor[0], baseColor[1], baseColor[2], 1], 20);
  data.set([light.ambient ?? 0.25, 0, 0, 0], 24);
  return data;
}

export async function renderMeshWebGpu(
  mesh: Mesh,
  options: RenderOptions,
): Promise<RenderedImage> {
  const gpu = getNavigatorGpu();
  if (!gpu) throw new Error("WebGPU is not available in this environment");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");
  const device = await adapter.requestDevice();

  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));

  const vertexCount = mesh.positions.length / 3;
  const baseColor = hexToRgb01(options.baseColor, [0.58, 0.64, 0.72]);
  const interleaved = new Float32Array(vertexCount * 9);
  for (let i = 0; i < vertexCount; i += 1) {
    interleaved[i * 9] = mesh.positions[i * 3] ?? 0;
    interleaved[i * 9 + 1] = mesh.positions[i * 3 + 1] ?? 0;
    interleaved[i * 9 + 2] = mesh.positions[i * 3 + 2] ?? 0;
    interleaved[i * 9 + 3] = mesh.normals[i * 3] ?? 0;
    interleaved[i * 9 + 4] = mesh.normals[i * 3 + 1] ?? 0;
    interleaved[i * 9 + 5] = mesh.normals[i * 3 + 2] ?? 0;
    interleaved[i * 9 + 6] = mesh.colors?.[i * 3] ?? baseColor[0];
    interleaved[i * 9 + 7] = mesh.colors?.[i * 3 + 1] ?? baseColor[1];
    interleaved[i * 9 + 8] = mesh.colors?.[i * 3 + 2] ?? baseColor[2];
  }

  const vertexBuffer = device.createBuffer({
    size: interleaved.byteLength,
    usage: WGPU_BUFFER.VERTEX | WGPU_BUFFER.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, interleaved);

  const indices = new Uint32Array(mesh.indices);
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: WGPU_BUFFER.INDEX | WGPU_BUFFER.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const uniformData = buildUniforms(options);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: WGPU_BUFFER.UNIFORM | WGPU_BUFFER.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const shaderModule = device.createShaderModule({ code: CREATION_WGSL });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const colorTexture = device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage: WGPU_TEXTURE.RENDER_ATTACHMENT | WGPU_TEXTURE.COPY_SRC,
  });
  const depthTexture = device.createTexture({
    size: { width, height },
    format: "depth24plus",
    usage: WGPU_TEXTURE.RENDER_ATTACHMENT,
  });

  const background = hexToRgb01(options.background, [0.06, 0.09, 0.16]);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: colorTexture.createView(),
        clearValue: { r: background[0], g: background[1], b: background[2], a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  pass.drawIndexed(indices.length);
  pass.end();

  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const readBuffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: WGPU_BUFFER.COPY_DST | WGPU_BUFFER.MAP_READ,
  });
  encoder.copyTextureToBuffer(
    { texture: colorTexture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height },
  );
  device.queue.submit([encoder.finish()]);

  await readBuffer.mapAsync(WGPU_MAP_READ);
  const mapped = new Uint8Array(readBuffer.getMappedRange());
  const rgba = new Uint8Array(width * height * 4);
  const bg = [
    Math.round(background[0] * 255),
    Math.round(background[1] * 255),
    Math.round(background[2] * 255),
  ];
  let coveredPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = y * bytesPerRow + x * 4;
      const dst = (y * width + x) * 4;
      const r = mapped[src] ?? 0;
      const g = mapped[src + 1] ?? 0;
      const b = mapped[src + 2] ?? 0;
      rgba[dst] = r;
      rgba[dst + 1] = g;
      rgba[dst + 2] = b;
      rgba[dst + 3] = 255;
      if (r !== bg[0] || g !== bg[1] || b !== bg[2]) coveredPixels += 1;
    }
  }
  readBuffer.unmap();

  return { rgba, width, height, coveredPixels };
}

export async function renderMeshAuto(
  mesh: Mesh,
  options: RenderOptions,
): Promise<RenderedImage & { readonly backend: "webgpu" | "cpu" }> {
  if (isWebGpuRenderAvailable()) {
    try {
      const image = await renderMeshWebGpu(mesh, options);
      return { ...image, backend: "webgpu" };
    } catch {
      // Fall through to the CPU rasterizer below.
    }
  }
  return { ...renderMeshToImage(mesh, options), backend: "cpu" };
}
