import type { Vec3 } from "../schema/common";
import { encodeBase64, encodePng, type Mesh } from "../geometry";
import { multiplyMat4, type Mat4 } from "../rig/mat4";

export interface RenderCamera {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up?: Vec3;
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export interface RenderLight {
  readonly direction: Vec3;
  readonly ambient?: number;
  readonly intensity?: number;
}

export interface RenderOptions {
  readonly width: number;
  readonly height: number;
  readonly camera: RenderCamera;
  readonly light?: RenderLight;
  readonly baseColor?: string;
  readonly background?: string;
}

export interface RenderedImage {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
}

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  if (!hex) return fallback;
  const normalized = hex.replace("#", "");
  if (normalized.length < 6) return fallback;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return fallback;
  return [r, g, b];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function vertexColor(mesh: Mesh, index: number, fallback: Rgb): Rgb {
  if (!mesh.colors || mesh.colors.length !== mesh.positions.length) return fallback;
  return [
    clampByte((mesh.colors[index * 3] ?? 0) * 255),
    clampByte((mesh.colors[index * 3 + 1] ?? 0) * 255),
    clampByte((mesh.colors[index * 3 + 2] ?? 0) * 255),
  ];
}

function mixColor(a: Rgb, b: Rgb, c: Rgb, w0: number, w1: number, w2: number): Rgb {
  return [
    w0 * a[0] + w1 * b[0] + w2 * c[0],
    w0 * a[1] + w1 * b[1] + w2 * c[1],
    w0 * a[2] + w1 * b[2] + w2 * c[2],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = normalize({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  const r = normalize(cross(f, up));
  const u = cross(r, f);
  return [
    r.x,
    r.y,
    r.z,
    -dot(r, eye),
    u.x,
    u.y,
    u.z,
    -dot(u, eye),
    -f.x,
    -f.y,
    -f.z,
    dot(f, eye),
    0,
    0,
    0,
    1,
  ];
}

function perspective(fovYRadians: number, aspect: number, near: number, far: number): Mat4 {
  const t = 1 / Math.tan(fovYRadians / 2);
  return [
    t / aspect,
    0,
    0,
    0,
    0,
    t,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    (2 * far * near) / (near - far),
    0,
    0,
    -1,
    0,
  ];
}

interface Projected {
  readonly sx: number;
  readonly sy: number;
  readonly depth: number;
  readonly w: number;
  readonly normal: Vec3;
  readonly color: Rgb;
}

export function renderMeshToImage(mesh: Mesh, options: RenderOptions): RenderedImage {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const camera = options.camera;
  const fov = ((camera.fov ?? 45) * Math.PI) / 180;
  const near = camera.near ?? 0.05;
  const far = camera.far ?? 100;
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const view = lookAt(camera.position, camera.target, up);
  const proj = perspective(fov, width / height, near, far);
  const mvp = multiplyMat4(proj, view);

  const light = options.light ?? { direction: { x: 0.4, y: 0.8, z: 0.6 } };
  const lightDir = normalize(light.direction);
  const ambient = light.ambient ?? 0.25;
  const intensity = light.intensity ?? 0.85;
  const baseColor = hexToRgb(options.baseColor, [148, 163, 184]);
  const background = hexToRgb(options.background, [15, 23, 42]);

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = background[0];
    rgba[i * 4 + 1] = background[1];
    rgba[i * 4 + 2] = background[2];
    rgba[i * 4 + 3] = 255;
  }
  const depthBuffer = new Float64Array(width * height).fill(Infinity);

  const project = (index: number): Projected => {
    const x = mesh.positions[index * 3] ?? 0;
    const y = mesh.positions[index * 3 + 1] ?? 0;
    const z = mesh.positions[index * 3 + 2] ?? 0;
    const cx = mvp[0]! * x + mvp[1]! * y + mvp[2]! * z + mvp[3]!;
    const cy = mvp[4]! * x + mvp[5]! * y + mvp[6]! * z + mvp[7]!;
    const cz = mvp[8]! * x + mvp[9]! * y + mvp[10]! * z + mvp[11]!;
    const cw = mvp[12]! * x + mvp[13]! * y + mvp[14]! * z + mvp[15]!;
    const invW = cw !== 0 ? 1 / cw : 0;
    return {
      sx: (cx * invW * 0.5 + 0.5) * width,
      sy: (1 - (cy * invW * 0.5 + 0.5)) * height,
      depth: cz * invW,
      w: cw,
      normal: {
        x: mesh.normals[index * 3] ?? 0,
        y: mesh.normals[index * 3 + 1] ?? 0,
        z: mesh.normals[index * 3 + 2] ?? 0,
      },
      color: vertexColor(mesh, index, baseColor),
    };
  };

  let coveredPixels = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = project(mesh.indices[t] ?? 0);
    const b = project(mesh.indices[t + 1] ?? 0);
    const c = project(mesh.indices[t + 2] ?? 0);
    if (a.w <= 0 || b.w <= 0 || c.w <= 0) continue;

    const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
    const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
    const area = (b.sx - a.sx) * (c.sy - a.sy) - (c.sx - a.sx) * (b.sy - a.sy);
    if (Math.abs(area) < 1e-9) continue;

    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const cxp = px + 0.5;
        const cyp = py + 0.5;
        const w0 = ((b.sx - cxp) * (c.sy - cyp) - (c.sx - cxp) * (b.sy - cyp)) / area;
        const w1 = ((c.sx - cxp) * (a.sy - cyp) - (a.sx - cxp) * (c.sy - cyp)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = w0 * a.depth + w1 * b.depth + w2 * c.depth;
        const bufferIndex = py * width + px;
        if (depth >= depthBuffer[bufferIndex]!) continue;
        depthBuffer[bufferIndex] = depth;
        const normal = normalize({
          x: w0 * a.normal.x + w1 * b.normal.x + w2 * c.normal.x,
          y: w0 * a.normal.y + w1 * b.normal.y + w2 * c.normal.y,
          z: w0 * a.normal.z + w1 * b.normal.z + w2 * c.normal.z,
        });
        const lambert = ambient + intensity * Math.max(0, dot(normal, lightDir));
        const shade = Math.max(0, Math.min(1, lambert));
        const color = mixColor(a.color, b.color, c.color, w0, w1, w2);
        rgba[bufferIndex * 4] = Math.round(color[0] * shade);
        rgba[bufferIndex * 4 + 1] = Math.round(color[1] * shade);
        rgba[bufferIndex * 4 + 2] = Math.round(color[2] * shade);
        rgba[bufferIndex * 4 + 3] = 255;
        coveredPixels += 1;
      }
    }
  }

  return { rgba, width, height, coveredPixels };
}

export interface RenderedPng {
  readonly pngBase64: string;
  readonly dataUri: string;
  readonly width: number;
  readonly height: number;
  readonly coveredPixels: number;
}

export function renderMeshToPng(mesh: Mesh, options: RenderOptions): RenderedPng {
  const image = renderMeshToImage(mesh, options);
  const png = encodePng(image.rgba, image.width, image.height);
  const base64 = encodeBase64(png);
  return {
    pngBase64: base64,
    dataUri: `data:image/png;base64,${base64}`,
    width: image.width,
    height: image.height,
    coveredPixels: image.coveredPixels,
  };
}
