import { ONE_VEC3, ZERO_VEC3, type Transform3D } from "../schema/common";
import { composeTRS, identityMat4, invertMat4, multiplyMat4, type Mat4 } from "./mat4";

export interface Bone {
  readonly name: string;
  readonly parent: number;
  readonly local: Transform3D;
}

export interface Skeleton {
  readonly bones: readonly Bone[];
}

export type Pose = Readonly<Record<string, Partial<Transform3D>>>;

function resolveLocal(bone: Bone, pose: Pose | undefined): Transform3D {
  const override = pose?.[bone.name];
  if (!override) return bone.local;
  return {
    position: override.position ?? bone.local.position,
    rotation: override.rotation ?? bone.local.rotation,
    scale: override.scale ?? bone.local.scale,
  };
}

export function computeBoneWorldMatrices(skeleton: Skeleton, pose?: Pose): Mat4[] {
  const world: Mat4[] = [];
  for (let i = 0; i < skeleton.bones.length; i += 1) {
    const bone = skeleton.bones[i]!;
    if (bone.parent >= 0 && bone.parent >= i) {
      throw new Error(`Bone ${bone.name} must come after its parent`);
    }
    const local = resolveLocal(bone, pose);
    const localMatrix = composeTRS(local.position, local.rotation, local.scale);
    world[i] = bone.parent >= 0 ? multiplyMat4(world[bone.parent]!, localMatrix) : localMatrix;
  }
  return world;
}

export function computeInverseBindMatrices(skeleton: Skeleton): Mat4[] {
  return computeBoneWorldMatrices(skeleton).map((matrix) => invertMat4(matrix));
}

export function boneIndexByName(skeleton: Skeleton): Map<string, number> {
  const map = new Map<string, number>();
  skeleton.bones.forEach((bone, index) => map.set(bone.name, index));
  return map;
}

export function makeBone(
  name: string,
  parent: number,
  local: Partial<Transform3D> = {},
): Bone {
  return {
    name,
    parent,
    local: {
      position: local.position ?? ZERO_VEC3,
      rotation: local.rotation ?? ZERO_VEC3,
      scale: local.scale ?? ONE_VEC3,
    },
  };
}

export function identitySkinMatrix(): Mat4 {
  return identityMat4();
}
