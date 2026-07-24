import { degToRad, type Transform3D } from "../schema/common";
import { createMeshBuilder, finalizeMesh, type Mesh } from "./mesh";

export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

export function eulerDegreesToMat3(x: number, y: number, z: number): Mat3 {
  const rx = degToRad(x);
  const ry = degToRad(y);
  const rz = degToRad(z);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const matX: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const matY: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const matZ: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return multiplyMat3(multiplyMat3(matZ, matY), matX);
}

function applyMat3(
  matrix: Mat3,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

export function transformMesh(mesh: Mesh, transform: Transform3D): Mesh {
  const rotation = eulerDegreesToMat3(
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
  );
  const builder = createMeshBuilder();
  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < vertexCount; i += 1) {
    const px = (mesh.positions[i * 3] ?? 0) * transform.scale.x;
    const py = (mesh.positions[i * 3 + 1] ?? 0) * transform.scale.y;
    const pz = (mesh.positions[i * 3 + 2] ?? 0) * transform.scale.z;
    const [rx, ry, rz] = applyMat3(rotation, px, py, pz);
    const [nx, ny, nz] = applyMat3(
      rotation,
      mesh.normals[i * 3] ?? 0,
      mesh.normals[i * 3 + 1] ?? 0,
      mesh.normals[i * 3 + 2] ?? 0,
    );
    const len = Math.hypot(nx, ny, nz) || 1;
    builder.positions.push(
      rx + transform.position.x,
      ry + transform.position.y,
      rz + transform.position.z,
    );
    builder.normals.push(nx / len, ny / len, nz / len);
    builder.uvs.push(mesh.uvs[i * 2] ?? 0, mesh.uvs[i * 2 + 1] ?? 0);
  }
  builder.indices.push(...mesh.indices);
  const transformed = finalizeMesh(builder);
  return mesh.colors ? { ...transformed, colors: Float32Array.from(mesh.colors) } : transformed;
}

export function mergeMeshes(meshes: readonly Mesh[]): Mesh {
  const builder = createMeshBuilder();
  const colors: number[] = [];
  const hasColors = meshes.some(
    (mesh) => mesh.colors && mesh.colors.length === mesh.positions.length,
  );
  let vertexOffset = 0;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 1) {
      builder.positions.push(mesh.positions[i] ?? 0);
    }
    for (let i = 0; i < mesh.normals.length; i += 1) {
      builder.normals.push(mesh.normals[i] ?? 0);
    }
    for (let i = 0; i < mesh.uvs.length; i += 1) {
      builder.uvs.push(mesh.uvs[i] ?? 0);
    }
    if (hasColors) {
      const vertexCount = mesh.positions.length / 3;
      const meshColors = mesh.colors;
      for (let i = 0; i < vertexCount; i += 1) {
        colors.push(
          meshColors?.[i * 3] ?? 1,
          meshColors?.[i * 3 + 1] ?? 1,
          meshColors?.[i * 3 + 2] ?? 1,
        );
      }
    }
    for (let i = 0; i < mesh.indices.length; i += 1) {
      builder.indices.push((mesh.indices[i] ?? 0) + vertexOffset);
    }
    vertexOffset += mesh.positions.length / 3;
  }
  const merged = finalizeMesh(builder);
  return hasColors ? { ...merged, colors: Float32Array.from(colors) } : merged;
}
