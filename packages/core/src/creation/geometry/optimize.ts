import { finalizeMesh, type Mesh } from "./mesh";

export interface WeldOptions {
  readonly epsilon?: number;
  readonly smoothNormals?: boolean;
}

function quantize(value: number, epsilon: number): number {
  return Math.round(value / epsilon);
}

export function weldVertices(mesh: Mesh, options: WeldOptions = {}): Mesh {
  const epsilon = options.epsilon ?? 1e-5;
  const smoothNormals = options.smoothNormals ?? false;
  const keyToIndex = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertexCount = mesh.positions.length / 3;
  const remap = new Int32Array(vertexCount);

  for (let i = 0; i < vertexCount; i += 1) {
    const px = mesh.positions[i * 3] ?? 0;
    const py = mesh.positions[i * 3 + 1] ?? 0;
    const pz = mesh.positions[i * 3 + 2] ?? 0;
    const nx = mesh.normals[i * 3] ?? 0;
    const ny = mesh.normals[i * 3 + 1] ?? 0;
    const nz = mesh.normals[i * 3 + 2] ?? 0;
    const u = mesh.uvs[i * 2] ?? 0;
    const v = mesh.uvs[i * 2 + 1] ?? 0;
    const key = smoothNormals
      ? `${quantize(px, epsilon)},${quantize(py, epsilon)},${quantize(pz, epsilon)}`
      : `${quantize(px, epsilon)},${quantize(py, epsilon)},${quantize(pz, epsilon)}|` +
        `${quantize(nx, epsilon)},${quantize(ny, epsilon)},${quantize(nz, epsilon)}|` +
        `${quantize(u, epsilon)},${quantize(v, epsilon)}`;
    let index = keyToIndex.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      keyToIndex.set(key, index);
      positions.push(px, py, pz);
      normals.push(nx, ny, nz);
      uvs.push(u, v);
    }
    remap[i] = index;
  }

  for (let i = 0; i < mesh.indices.length; i += 1) {
    indices.push(remap[mesh.indices[i] ?? 0] ?? 0);
  }

  const welded = finalizeMesh({ positions, normals, uvs, indices });
  return smoothNormals ? recomputeNormals(welded) : welded;
}

export function recomputeNormals(mesh: Mesh): Mesh {
  const vertexCount = mesh.positions.length / 3;
  const accum = new Float64Array(vertexCount * 3);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t] ?? 0;
    const ib = mesh.indices[t + 1] ?? 0;
    const ic = mesh.indices[t + 2] ?? 0;
    const ax = mesh.positions[ia * 3] ?? 0;
    const ay = mesh.positions[ia * 3 + 1] ?? 0;
    const az = mesh.positions[ia * 3 + 2] ?? 0;
    const bx = mesh.positions[ib * 3] ?? 0;
    const by = mesh.positions[ib * 3 + 1] ?? 0;
    const bz = mesh.positions[ib * 3 + 2] ?? 0;
    const cx = mesh.positions[ic * 3] ?? 0;
    const cy = mesh.positions[ic * 3 + 1] ?? 0;
    const cz = mesh.positions[ic * 3 + 2] ?? 0;
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const fnx = uy * vz - uz * vy;
    const fny = uz * vx - ux * vz;
    const fnz = ux * vy - uy * vx;
    for (const index of [ia, ib, ic]) {
      accum[index * 3] += fnx;
      accum[index * 3 + 1] += fny;
      accum[index * 3 + 2] += fnz;
    }
  }
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i += 1) {
    const nx = accum[i * 3] ?? 0;
    const ny = accum[i * 3 + 1] ?? 0;
    const nz = accum[i * 3 + 2] ?? 0;
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }
  return {
    positions: mesh.positions,
    normals,
    uvs: mesh.uvs,
    indices: mesh.indices,
  };
}

export interface OptimizeResult {
  readonly mesh: Mesh;
  readonly beforeVertexCount: number;
  readonly afterVertexCount: number;
}

export function optimizeMesh(mesh: Mesh, options: WeldOptions = {}): OptimizeResult {
  const before = mesh.positions.length / 3;
  const welded = weldVertices(mesh, options);
  return {
    mesh: welded,
    beforeVertexCount: before,
    afterVertexCount: welded.positions.length / 3,
  };
}
