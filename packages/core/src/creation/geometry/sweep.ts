import { type Vec3 } from "../schema/common";
import {
  createMeshBuilder,
  finalizeMesh,
  pushQuad,
  pushVertex,
  type Mesh,
} from "./mesh";
import type { Vec2Point } from "./profiles";

interface Frame {
  readonly tangent: Vec3;
  readonly normal: Vec3;
  readonly binormal: Vec3;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
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

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalize(a: Vec3, fallback: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return fallback;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dotProduct = dot(axis, v);
  const crossProduct = cross(axis, v);
  return {
    x: v.x * cos + crossProduct.x * sin + axis.x * dotProduct * (1 - cos),
    y: v.y * cos + crossProduct.y * sin + axis.y * dotProduct * (1 - cos),
    z: v.z * cos + crossProduct.z * sin + axis.z * dotProduct * (1 - cos),
  };
}

function computeTangents(path: readonly Vec3[]): Vec3[] {
  const tangents: Vec3[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    tangents.push(normalize(sub(next, prev), { x: 0, y: 0, z: 1 }));
  }
  return tangents;
}

function parallelTransportFrames(path: readonly Vec3[]): Frame[] {
  const tangents = computeTangents(path);
  const frames: Frame[] = [];
  const firstTangent = tangents[0]!;
  const reference =
    Math.abs(firstTangent.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let normal = normalize(
    cross(cross(firstTangent, reference), firstTangent),
    { x: 1, y: 0, z: 0 },
  );
  for (let i = 0; i < path.length; i += 1) {
    const tangent = tangents[i]!;
    if (i > 0) {
      const prevTangent = tangents[i - 1]!;
      const axis = cross(prevTangent, tangent);
      const sinAngle = length(axis);
      if (sinAngle > 1e-6) {
        const unitAxis = normalize(axis, { x: 0, y: 1, z: 0 });
        const angle = Math.atan2(sinAngle, dot(prevTangent, tangent));
        normal = normalize(rotateAroundAxis(normal, unitAxis, angle), normal);
      }
    }
    const binormal = normalize(cross(tangent, normal), { x: 0, y: 0, z: 1 });
    normal = normalize(cross(binormal, tangent), normal);
    frames.push({ tangent, normal, binormal });
  }
  return frames;
}

export interface TubeParams {
  readonly path: readonly Vec3[];
  readonly radius: number;
  readonly radialSegments: number;
}

export function buildTube(params: TubeParams): Mesh {
  if (params.path.length < 2) {
    throw new Error("buildTube requires at least 2 path points");
  }
  const radius = Math.max(1e-4, params.radius);
  const radialSegments = Math.max(3, Math.floor(params.radialSegments));
  const frames = parallelTransportFrames(params.path);
  const builder = createMeshBuilder();
  const grid: number[][] = [];

  for (let i = 0; i < params.path.length; i += 1) {
    const center = params.path[i]!;
    const frame = frames[i]!;
    const row: number[] = [];
    for (let s = 0; s <= radialSegments; s += 1) {
      const angle = (s / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const offsetX = frame.normal.x * cos + frame.binormal.x * sin;
      const offsetY = frame.normal.y * cos + frame.binormal.y * sin;
      const offsetZ = frame.normal.z * cos + frame.binormal.z * sin;
      row.push(
        pushVertex(
          builder,
          [center.x + offsetX * radius, center.y + offsetY * radius, center.z + offsetZ * radius],
          [offsetX, offsetY, offsetZ],
          [i / (params.path.length - 1), s / radialSegments],
        ),
      );
    }
    grid.push(row);
  }

  for (let i = 0; i < params.path.length - 1; i += 1) {
    for (let s = 0; s < radialSegments; s += 1) {
      pushQuad(builder, grid[i]![s]!, grid[i]![s + 1]!, grid[i + 1]![s + 1]!, grid[i + 1]![s]!);
    }
  }

  return finalizeMesh(builder);
}

export interface SweepParams {
  readonly profile: readonly Vec2Point[];
  readonly path: readonly Vec3[];
  readonly closedProfile?: boolean;
}

export function sweepProfileAlongPath(params: SweepParams): Mesh {
  if (params.path.length < 2) {
    throw new Error("sweepProfileAlongPath requires at least 2 path points");
  }
  if (params.profile.length < 2) {
    throw new Error("sweepProfileAlongPath requires at least 2 profile points");
  }
  const frames = parallelTransportFrames(params.path);
  const builder = createMeshBuilder();
  const grid: number[][] = [];
  const closed = params.closedProfile ?? false;
  const profileEdges = closed ? params.profile.length : params.profile.length - 1;

  for (let i = 0; i < params.path.length; i += 1) {
    const center = params.path[i]!;
    const frame = frames[i]!;
    const row: number[] = [];
    for (let p = 0; p < params.profile.length; p += 1) {
      const point = params.profile[p]!;
      const offsetX = frame.normal.x * point.x + frame.binormal.x * point.y;
      const offsetY = frame.normal.y * point.x + frame.binormal.y * point.y;
      const offsetZ = frame.normal.z * point.x + frame.binormal.z * point.y;
      const len = Math.hypot(offsetX, offsetY, offsetZ) || 1;
      row.push(
        pushVertex(
          builder,
          [center.x + offsetX, center.y + offsetY, center.z + offsetZ],
          [offsetX / len, offsetY / len, offsetZ / len],
          [i / (params.path.length - 1), p / (params.profile.length - 1)],
        ),
      );
    }
    grid.push(row);
  }

  for (let i = 0; i < params.path.length - 1; i += 1) {
    for (let p = 0; p < profileEdges; p += 1) {
      const pNext = (p + 1) % params.profile.length;
      pushQuad(builder, grid[i]![p]!, grid[i]![pNext]!, grid[i + 1]![pNext]!, grid[i + 1]![p]!);
    }
  }

  return finalizeMesh(builder);
}
