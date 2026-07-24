import type { Mesh } from "../geometry";
import { multiplyMat4, transformDirection, transformPoint, type Mat4 } from "./mat4";
import {
  computeBoneWorldMatrices,
  computeInverseBindMatrices,
  type Pose,
  type Skeleton,
} from "./skeleton";

export interface SkinBinding {
  readonly boneIndices: Uint16Array;
  readonly weights: Float32Array;
  readonly influences: number;
}

export function createSkinBinding(
  boneIndices: readonly number[],
  weights: readonly number[],
  influences = 4,
): SkinBinding {
  return {
    boneIndices: Uint16Array.from(boneIndices),
    weights: Float32Array.from(weights),
    influences,
  };
}

function addScaledMatrix(target: number[], source: Mat4, weight: number): void {
  for (let i = 0; i < 16; i += 1) {
    target[i] = (target[i] ?? 0) + source[i]! * weight;
  }
}

export function skinMesh(
  mesh: Mesh,
  binding: SkinBinding,
  skeleton: Skeleton,
  pose?: Pose,
): Mesh {
  const vertexCount = mesh.positions.length / 3;
  if (binding.boneIndices.length !== vertexCount * binding.influences) {
    throw new Error("skinMesh: bone indices length mismatch");
  }
  const inverseBind = computeInverseBindMatrices(skeleton);
  const world = computeBoneWorldMatrices(skeleton, pose);
  const skinMatrices: Mat4[] = world.map((matrix, index) =>
    multiplyMat4(matrix, inverseBind[index]!),
  );

  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  for (let v = 0; v < vertexCount; v += 1) {
    const accum: number[] = new Array(16).fill(0);
    let totalWeight = 0;
    for (let i = 0; i < binding.influences; i += 1) {
      const weight = binding.weights[v * binding.influences + i] ?? 0;
      if (weight === 0) continue;
      const boneIndex = binding.boneIndices[v * binding.influences + i] ?? 0;
      const matrix = skinMatrices[boneIndex];
      if (!matrix) continue;
      addScaledMatrix(accum, matrix, weight);
      totalWeight += weight;
    }
    const matrix: Mat4 = totalWeight > 0 ? accum.map((value) => value / totalWeight) : skinMatrices[0] ?? accum;
    const position = {
      x: mesh.positions[v * 3] ?? 0,
      y: mesh.positions[v * 3 + 1] ?? 0,
      z: mesh.positions[v * 3 + 2] ?? 0,
    };
    const normal = {
      x: mesh.normals[v * 3] ?? 0,
      y: mesh.normals[v * 3 + 1] ?? 0,
      z: mesh.normals[v * 3 + 2] ?? 0,
    };
    const skinnedPosition = transformPoint(matrix, position);
    const skinnedNormal = transformDirection(matrix, normal);
    const len = Math.hypot(skinnedNormal.x, skinnedNormal.y, skinnedNormal.z) || 1;
    positions[v * 3] = skinnedPosition.x;
    positions[v * 3 + 1] = skinnedPosition.y;
    positions[v * 3 + 2] = skinnedPosition.z;
    normals[v * 3] = skinnedNormal.x / len;
    normals[v * 3 + 1] = skinnedNormal.y / len;
    normals[v * 3 + 2] = skinnedNormal.z / len;
  }

  return {
    positions,
    normals,
    uvs: mesh.uvs,
    indices: mesh.indices,
  };
}
