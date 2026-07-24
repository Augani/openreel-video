import { degToRad } from "../schema/common";
import {
  createMeshBuilder,
  finalizeMesh,
  pushTriangle,
  pushVertex,
  type Mesh,
} from "./mesh";

export interface Vec2Point {
  readonly x: number;
  readonly y: number;
}

export interface ExtrudeParams {
  readonly profile: readonly Vec2Point[];
  readonly depth: number;
}

export interface RevolveParams {
  readonly profile: readonly Vec2Point[];
  readonly segments: number;
  readonly arcDegrees?: number;
}

function polygonArea(profile: readonly Vec2Point[]): number {
  let area = 0;
  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i]!;
    const b = profile[(i + 1) % profile.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function extrudeProfile(params: ExtrudeParams): Mesh {
  const profile = params.profile;
  if (profile.length < 3) {
    throw new Error("extrudeProfile requires at least 3 profile points");
  }
  const halfDepth = Math.max(1e-4, params.depth) / 2;
  const builder = createMeshBuilder();
  const ccw = polygonArea(profile) >= 0;

  const frontStart = builder.positions.length / 3;
  for (const point of profile) {
    pushVertex(builder, [point.x, point.y, halfDepth], [0, 0, 1], [point.x, point.y]);
  }
  const backStart = builder.positions.length / 3;
  for (const point of profile) {
    pushVertex(builder, [point.x, point.y, -halfDepth], [0, 0, -1], [point.x, point.y]);
  }
  for (let i = 1; i < profile.length - 1; i += 1) {
    if (ccw) {
      pushTriangle(builder, frontStart, frontStart + i, frontStart + i + 1);
      pushTriangle(builder, backStart, backStart + i + 1, backStart + i);
    } else {
      pushTriangle(builder, frontStart, frontStart + i + 1, frontStart + i);
      pushTriangle(builder, backStart, backStart + i, backStart + i + 1);
    }
  }

  for (let i = 0; i < profile.length; i += 1) {
    const a = profile[i]!;
    const b = profile[(i + 1) % profile.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = (ey / len) * (ccw ? 1 : -1);
    const ny = (-ex / len) * (ccw ? 1 : -1);
    const normal: [number, number, number] = [nx, ny, 0];
    const v0 = pushVertex(builder, [a.x, a.y, halfDepth], normal, [0, 0]);
    const v1 = pushVertex(builder, [b.x, b.y, halfDepth], normal, [1, 0]);
    const v2 = pushVertex(builder, [b.x, b.y, -halfDepth], normal, [1, 1]);
    const v3 = pushVertex(builder, [a.x, a.y, -halfDepth], normal, [0, 1]);
    pushTriangle(builder, v0, v1, v2);
    pushTriangle(builder, v0, v2, v3);
  }

  return finalizeMesh(builder);
}

export function revolveProfile(params: RevolveParams): Mesh {
  const profile = params.profile;
  if (profile.length < 2) {
    throw new Error("revolveProfile requires at least 2 profile points");
  }
  const segments = Math.max(3, Math.floor(params.segments));
  const arc = degToRad(params.arcDegrees ?? 360);
  const closed = (params.arcDegrees ?? 360) >= 360;
  const ringCount = closed ? segments : segments + 1;
  const builder = createMeshBuilder();
  const grid: number[][] = [];

  for (let s = 0; s < ringCount; s += 1) {
    const angle = (arc * s) / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const row: number[] = [];
    for (let p = 0; p < profile.length; p += 1) {
      const point = profile[p]!;
      const radius = point.x;
      const x = radius * cos;
      const z = radius * sin;
      const y = point.y;
      const nx = cos;
      const nz = sin;
      const len = Math.hypot(nx, nz) || 1;
      row.push(
        pushVertex(builder, [x, y, z], [nx / len, 0, nz / len], [
          s / segments,
          p / (profile.length - 1),
        ]),
      );
    }
    grid.push(row);
  }

  for (let s = 0; s < segments; s += 1) {
    const next = closed ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < profile.length - 1; p += 1) {
      const a = grid[s]![p]!;
      const b = grid[next]![p]!;
      const c = grid[next]![p + 1]!;
      const d = grid[s]![p + 1]!;
      pushTriangle(builder, a, b, d);
      pushTriangle(builder, b, c, d);
    }
  }

  return finalizeMesh(builder);
}
