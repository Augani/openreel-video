import type { Vec3 } from "../schema/common";
import {
  createMeshBuilder,
  finalizeMesh,
  pushTriangle,
  pushVertex,
  type Mesh,
  type MeshBuilder,
} from "./mesh";

export interface ClipPlane {
  readonly normal: Vec3;
  readonly offset: number;
}

interface VertexRef {
  readonly position: [number, number, number];
  readonly normal: [number, number, number];
  readonly uv: [number, number];
}

function readVertex(mesh: Mesh, index: number): VertexRef {
  return {
    position: [
      mesh.positions[index * 3] ?? 0,
      mesh.positions[index * 3 + 1] ?? 0,
      mesh.positions[index * 3 + 2] ?? 0,
    ],
    normal: [
      mesh.normals[index * 3] ?? 0,
      mesh.normals[index * 3 + 1] ?? 0,
      mesh.normals[index * 3 + 2] ?? 0,
    ],
    uv: [mesh.uvs[index * 2] ?? 0, mesh.uvs[index * 2 + 1] ?? 0],
  };
}

function lerpVertex(a: VertexRef, b: VertexRef, t: number): VertexRef {
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return {
    position: [
      mix(a.position[0], b.position[0]),
      mix(a.position[1], b.position[1]),
      mix(a.position[2], b.position[2]),
    ],
    normal: [
      mix(a.normal[0], b.normal[0]),
      mix(a.normal[1], b.normal[1]),
      mix(a.normal[2], b.normal[2]),
    ],
    uv: [mix(a.uv[0], b.uv[0]), mix(a.uv[1], b.uv[1])],
  };
}

function emit(builder: MeshBuilder, vertex: VertexRef): number {
  return pushVertex(builder, vertex.position, vertex.normal, vertex.uv);
}

function signedDistance(vertex: VertexRef, plane: ClipPlane): number {
  return (
    vertex.position[0] * plane.normal.x +
    vertex.position[1] * plane.normal.y +
    vertex.position[2] * plane.normal.z -
    plane.offset
  );
}

export function sliceMeshByPlane(mesh: Mesh, plane: ClipPlane): Mesh {
  const builder = createMeshBuilder();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const verts = [
      readVertex(mesh, mesh.indices[t] ?? 0),
      readVertex(mesh, mesh.indices[t + 1] ?? 0),
      readVertex(mesh, mesh.indices[t + 2] ?? 0),
    ];
    const distances = verts.map((vertex) => signedDistance(vertex, plane));
    const inside = distances.map((d) => d >= 0);
    const insideCount = inside.filter(Boolean).length;

    if (insideCount === 3) {
      const a = emit(builder, verts[0]!);
      const b = emit(builder, verts[1]!);
      const c = emit(builder, verts[2]!);
      pushTriangle(builder, a, b, c);
      continue;
    }
    if (insideCount === 0) continue;

    const ordered = [0, 1, 2];
    if (insideCount === 1) {
      const inIndex = ordered.find((i) => inside[i])!;
      const out1 = ordered[(inIndex + 1) % 3]!;
      const out2 = ordered[(inIndex + 2) % 3]!;
      const a = verts[inIndex]!;
      const t1 = distances[inIndex]! / (distances[inIndex]! - distances[out1]!);
      const t2 = distances[inIndex]! / (distances[inIndex]! - distances[out2]!);
      const i1 = lerpVertex(a, verts[out1]!, t1);
      const i2 = lerpVertex(a, verts[out2]!, t2);
      const va = emit(builder, a);
      const vi1 = emit(builder, i1);
      const vi2 = emit(builder, i2);
      pushTriangle(builder, va, vi1, vi2);
    } else {
      const outIndex = ordered.find((i) => !inside[i])!;
      const in1 = ordered[(outIndex + 1) % 3]!;
      const in2 = ordered[(outIndex + 2) % 3]!;
      const c = verts[outIndex]!;
      const t1 = distances[in1]! / (distances[in1]! - distances[outIndex]!);
      const t2 = distances[in2]! / (distances[in2]! - distances[outIndex]!);
      const iBC = lerpVertex(verts[in1]!, c, t1);
      const iCA = lerpVertex(verts[in2]!, c, t2);
      const va = emit(builder, verts[in1]!);
      const vb = emit(builder, verts[in2]!);
      const vBC = emit(builder, iBC);
      const vCA = emit(builder, iCA);
      pushTriangle(builder, va, vb, vBC);
      pushTriangle(builder, va, vBC, vCA);
    }
  }
  return finalizeMesh(builder);
}
