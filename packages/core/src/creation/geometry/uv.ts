import type { Mesh } from "./mesh";

export interface BoxUvOptions {
  readonly scale?: number;
}

export function generateBoxUvs(mesh: Mesh, options: BoxUvOptions = {}): Mesh {
  const scale = Math.max(1e-4, options.scale ?? 1);
  const vertexCount = mesh.positions.length / 3;
  const uvs = new Float32Array(vertexCount * 2);
  for (let i = 0; i < vertexCount; i += 1) {
    const px = mesh.positions[i * 3] ?? 0;
    const py = mesh.positions[i * 3 + 1] ?? 0;
    const pz = mesh.positions[i * 3 + 2] ?? 0;
    const nx = Math.abs(mesh.normals[i * 3] ?? 0);
    const ny = Math.abs(mesh.normals[i * 3 + 1] ?? 0);
    const nz = Math.abs(mesh.normals[i * 3 + 2] ?? 0);
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      u = pz / scale;
      v = py / scale;
    } else if (ny >= nx && ny >= nz) {
      u = px / scale;
      v = pz / scale;
    } else {
      u = px / scale;
      v = py / scale;
    }
    uvs[i * 2] = u - Math.floor(u);
    uvs[i * 2 + 1] = v - Math.floor(v);
  }
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    uvs,
    indices: mesh.indices,
  };
}
