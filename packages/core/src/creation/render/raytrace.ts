import type { Vec3 } from "../schema/common";
import { encodeBase64, encodePng, type Mesh } from "../geometry";
import type { RenderCamera, RenderLight, RenderedImage, RenderedPng } from "./raster";

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

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
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

function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

interface Triangle {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly c: Vec3;
  readonly na: Vec3;
  readonly nb: Vec3;
  readonly nc: Vec3;
  readonly ca: Rgb;
  readonly cb: Rgb;
  readonly cc: Rgb;
}

function buildTriangles(mesh: Mesh, fallbackColor: Rgb): Triangle[] {
  const vertex = (index: number): Vec3 => ({
    x: mesh.positions[index * 3] ?? 0,
    y: mesh.positions[index * 3 + 1] ?? 0,
    z: mesh.positions[index * 3 + 2] ?? 0,
  });
  const normalAt = (index: number): Vec3 => ({
    x: mesh.normals[index * 3] ?? 0,
    y: mesh.normals[index * 3 + 1] ?? 0,
    z: mesh.normals[index * 3 + 2] ?? 0,
  });
  const triangles: Triangle[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t] ?? 0;
    const ib = mesh.indices[t + 1] ?? 0;
    const ic = mesh.indices[t + 2] ?? 0;
    triangles.push({
      a: vertex(ia),
      b: vertex(ib),
      c: vertex(ic),
      na: normalAt(ia),
      nb: normalAt(ib),
      nc: normalAt(ic),
      ca: vertexColor(mesh, ia, fallbackColor),
      cb: vertexColor(mesh, ib, fallbackColor),
      cc: vertexColor(mesh, ic, fallbackColor),
    });
  }
  return triangles;
}

interface Hit {
  readonly t: number;
  readonly u: number;
  readonly v: number;
  readonly triangle: Triangle;
}

const EPSILON = 1e-7;

function intersect(origin: Vec3, dir: Vec3, triangle: Triangle): Hit | undefined {
  const edge1 = sub(triangle.b, triangle.a);
  const edge2 = sub(triangle.c, triangle.a);
  const pvec = cross(dir, edge2);
  const det = dot(edge1, pvec);
  if (Math.abs(det) < EPSILON) return undefined;
  const invDet = 1 / det;
  const tvec = sub(origin, triangle.a);
  const u = dot(tvec, pvec) * invDet;
  if (u < 0 || u > 1) return undefined;
  const qvec = cross(tvec, edge1);
  const v = dot(dir, qvec) * invDet;
  if (v < 0 || u + v > 1) return undefined;
  const t = dot(edge2, qvec) * invDet;
  if (t < EPSILON) return undefined;
  return { t, u, v, triangle };
}

function closestHit(origin: Vec3, dir: Vec3, triangles: readonly Triangle[]): Hit | undefined {
  let best: Hit | undefined;
  for (const triangle of triangles) {
    const hit = intersect(origin, dir, triangle);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

function anyHit(origin: Vec3, dir: Vec3, triangles: readonly Triangle[], maxT: number): boolean {
  for (const triangle of triangles) {
    const hit = intersect(origin, dir, triangle);
    if (hit && hit.t < maxT) return true;
  }
  return false;
}

export interface RayTraceOptions {
  readonly width: number;
  readonly height: number;
  readonly camera: RenderCamera;
  readonly light?: RenderLight;
  readonly baseColor?: string;
  readonly background?: string;
  readonly shadows?: boolean;
}

export interface RayTracedImage extends RenderedImage {
  readonly shadowedPixels: number;
}

export function rayTraceMeshToImage(mesh: Mesh, options: RayTraceOptions): RayTracedImage {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const baseColor = hexToRgb(options.baseColor, [148, 163, 184]);
  const triangles = buildTriangles(mesh, baseColor);
  const camera = options.camera;
  const eye = camera.position;
  const up = camera.up ?? { x: 0, y: 1, z: 0 };
  const forward = normalize(sub(camera.target, eye));
  const right = normalize(cross(forward, up));
  const trueUp = cross(right, forward);
  const fov = ((camera.fov ?? 45) * Math.PI) / 180;
  const halfHeight = Math.tan(fov / 2);
  const halfWidth = halfHeight * (width / height);

  const light = options.light ?? { direction: { x: 0.4, y: 0.9, z: 0.5 } };
  const lightDir = normalize(light.direction);
  const ambient = light.ambient ?? 0.2;
  const intensity = light.intensity ?? 0.9;
  const background = hexToRgb(options.background, [15, 23, 42]);
  const shadows = options.shadows !== false;

  const rgba = new Uint8Array(width * height * 4);
  let coveredPixels = 0;
  let shadowedPixels = 0;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const ndcX = (((px + 0.5) / width) * 2 - 1) * halfWidth;
      const ndcY = (1 - ((py + 0.5) / height) * 2) * halfHeight;
      const dir = normalize(
        add(add(forward, scale(right, ndcX)), scale(trueUp, ndcY)),
      );
      const hit = closestHit(eye, dir, triangles);
      const offset = (py * width + px) * 4;
      if (!hit) {
        rgba[offset] = background[0];
        rgba[offset + 1] = background[1];
        rgba[offset + 2] = background[2];
        rgba[offset + 3] = 255;
        continue;
      }
      coveredPixels += 1;
      const w = 1 - hit.u - hit.v;
      const normal = normalize({
        x: w * hit.triangle.na.x + hit.u * hit.triangle.nb.x + hit.v * hit.triangle.nc.x,
        y: w * hit.triangle.na.y + hit.u * hit.triangle.nb.y + hit.v * hit.triangle.nc.y,
        z: w * hit.triangle.na.z + hit.u * hit.triangle.nb.z + hit.v * hit.triangle.nc.z,
      });
      const point = add(eye, scale(dir, hit.t));
      let diffuse = Math.max(0, dot(normal, lightDir));
      if (shadows && diffuse > 0) {
        const shadowOrigin = add(point, scale(normal, 1e-4));
        if (anyHit(shadowOrigin, lightDir, triangles, 1e6)) {
          diffuse = 0;
          shadowedPixels += 1;
        }
      }
      const shade = Math.max(0, Math.min(1, ambient + intensity * diffuse));
      const color = [
        w * hit.triangle.ca[0] + hit.u * hit.triangle.cb[0] + hit.v * hit.triangle.cc[0],
        w * hit.triangle.ca[1] + hit.u * hit.triangle.cb[1] + hit.v * hit.triangle.cc[1],
        w * hit.triangle.ca[2] + hit.u * hit.triangle.cb[2] + hit.v * hit.triangle.cc[2],
      ];
      rgba[offset] = Math.round(color[0] * shade);
      rgba[offset + 1] = Math.round(color[1] * shade);
      rgba[offset + 2] = Math.round(color[2] * shade);
      rgba[offset + 3] = 255;
    }
  }

  return { rgba, width, height, coveredPixels, shadowedPixels };
}

export function rayTraceMeshToPng(mesh: Mesh, options: RayTraceOptions): RenderedPng {
  const image = rayTraceMeshToImage(mesh, options);
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
