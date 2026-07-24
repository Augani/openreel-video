import { emptyBounds, expandBounds, type Bounds3 } from "../schema/common";

export interface Mesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  /** Optional normalized RGB color per vertex, parallel to positions/normals. */
  readonly colors?: Float32Array;
}

export interface MeshStats {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly bounds: Bounds3;
}

export interface MeshBuilder {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export function createMeshBuilder(): MeshBuilder {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function pushVertex(
  builder: MeshBuilder,
  position: readonly [number, number, number],
  normal: readonly [number, number, number],
  uv: readonly [number, number],
): number {
  const index = builder.positions.length / 3;
  builder.positions.push(position[0], position[1], position[2]);
  builder.normals.push(normal[0], normal[1], normal[2]);
  builder.uvs.push(uv[0], uv[1]);
  return index;
}

export function pushTriangle(builder: MeshBuilder, a: number, b: number, c: number): void {
  builder.indices.push(a, b, c);
}

export function pushQuad(builder: MeshBuilder, a: number, b: number, c: number, d: number): void {
  builder.indices.push(a, b, c, a, c, d);
}

export function finalizeMesh(builder: MeshBuilder): Mesh {
  return {
    positions: Float32Array.from(builder.positions),
    normals: Float32Array.from(builder.normals),
    uvs: Float32Array.from(builder.uvs),
    indices: Uint32Array.from(builder.indices),
  };
}

export function computeMeshBounds(positions: Float32Array): Bounds3 {
  let bounds = emptyBounds();
  for (let offset = 0; offset + 2 < positions.length; offset += 3) {
    bounds = expandBounds(bounds, {
      x: positions[offset] ?? 0,
      y: positions[offset + 1] ?? 0,
      z: positions[offset + 2] ?? 0,
    });
  }
  return bounds;
}

export function computeMeshStats(mesh: Mesh): MeshStats {
  return {
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    bounds:
      mesh.positions.length > 0
        ? computeMeshBounds(mesh.positions)
        : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
  };
}

export function isMeshValid(mesh: Mesh): boolean {
  if (mesh.positions.length === 0 || mesh.indices.length === 0) return false;
  if (mesh.positions.length % 3 !== 0) return false;
  if (mesh.indices.length % 3 !== 0) return false;
  if (mesh.normals.length !== mesh.positions.length) return false;
  if (mesh.uvs.length !== (mesh.positions.length / 3) * 2) return false;
  if (mesh.colors && mesh.colors.length !== mesh.positions.length) return false;
  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < mesh.indices.length; i += 1) {
    const index = mesh.indices[i] ?? -1;
    if (index < 0 || index >= vertexCount) return false;
  }
  return true;
}
