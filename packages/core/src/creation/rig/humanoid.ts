import type { Transform3D, Vec3 } from "../schema/common";
import { buildTube, mergeMeshes, type Mesh } from "../geometry";
import { transformPoint } from "./mat4";
import {
  boneIndexByName,
  computeBoneWorldMatrices,
  makeBone,
  type Bone,
  type Pose,
  type Skeleton,
} from "./skeleton";
import { createSkinBinding, type SkinBinding } from "./skin";

interface BoneSpec {
  readonly name: string;
  readonly parent: string | null;
  readonly offset: Vec3;
  readonly radius: number;
}

export interface SkinnedHumanoidOptions {
  readonly height?: number;
  readonly radialSegments?: number;
}

export interface SkinnedHumanoid {
  readonly mesh: Mesh;
  readonly skeleton: Skeleton;
  readonly binding: SkinBinding;
  readonly boneNames: readonly string[];
}

function humanoidBoneSpecs(height: number): BoneSpec[] {
  const f = (fraction: number): number => height * fraction;
  return [
    { name: "pelvis", parent: null, offset: { x: 0, y: 0, z: 0 }, radius: f(0.06) },
    { name: "spine", parent: "pelvis", offset: { x: 0, y: f(0.15), z: 0 }, radius: f(0.06) },
    { name: "chest", parent: "spine", offset: { x: 0, y: f(0.15), z: 0 }, radius: f(0.07) },
    { name: "neck", parent: "chest", offset: { x: 0, y: f(0.1), z: 0 }, radius: f(0.03) },
    { name: "head", parent: "neck", offset: { x: 0, y: f(0.1), z: 0 }, radius: f(0.07) },
    { name: "shoulderL", parent: "chest", offset: { x: f(-0.08), y: f(0.05), z: 0 }, radius: f(0.035) },
    { name: "upperArmL", parent: "shoulderL", offset: { x: f(-0.14), y: 0, z: 0 }, radius: f(0.035) },
    { name: "foreArmL", parent: "upperArmL", offset: { x: f(-0.13), y: 0, z: 0 }, radius: f(0.028) },
    { name: "shoulderR", parent: "chest", offset: { x: f(0.08), y: f(0.05), z: 0 }, radius: f(0.035) },
    { name: "upperArmR", parent: "shoulderR", offset: { x: f(0.14), y: 0, z: 0 }, radius: f(0.035) },
    { name: "foreArmR", parent: "upperArmR", offset: { x: f(0.13), y: 0, z: 0 }, radius: f(0.028) },
    { name: "hipL", parent: "pelvis", offset: { x: f(-0.06), y: f(-0.02), z: 0 }, radius: f(0.05) },
    { name: "thighL", parent: "hipL", offset: { x: 0, y: f(-0.22), z: 0 }, radius: f(0.05) },
    { name: "shinL", parent: "thighL", offset: { x: 0, y: f(-0.22), z: 0 }, radius: f(0.04) },
    { name: "hipR", parent: "pelvis", offset: { x: f(0.06), y: f(-0.02), z: 0 }, radius: f(0.05) },
    { name: "thighR", parent: "hipR", offset: { x: 0, y: f(-0.22), z: 0 }, radius: f(0.05) },
    { name: "shinR", parent: "thighR", offset: { x: 0, y: f(-0.22), z: 0 }, radius: f(0.04) },
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function buildSkinnedHumanoid(options: SkinnedHumanoidOptions = {}): SkinnedHumanoid {
  const height = Math.max(0.4, options.height ?? 2);
  const radialSegments = Math.max(3, Math.min(16, Math.floor(options.radialSegments ?? 7)));
  const specs = humanoidBoneSpecs(height);

  const nameToIndex = new Map(specs.map((spec, index) => [spec.name, index] as const));
  const bones: Bone[] = specs.map((spec) =>
    makeBone(spec.name, spec.parent === null ? -1 : nameToIndex.get(spec.parent)!, {
      position: spec.offset,
    }),
  );
  const skeleton: Skeleton = { bones };
  const restWorld = computeBoneWorldMatrices(skeleton);
  const restPositions = restWorld.map((matrix) => transformPoint(matrix, { x: 0, y: 0, z: 0 }));

  const segmentMeshes: Mesh[] = [];
  const boneIndices: number[] = [];
  const weights: number[] = [];
  const boneIndex = boneIndexByName(skeleton);

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i]!;
    if (spec.parent === null) continue;
    const parentIndex = boneIndex.get(spec.parent)!;
    const thisIndex = i;
    const start = restPositions[parentIndex]!;
    const end = restPositions[i]!;
    const path: Vec3[] = [start, lerp(start, end, 0.5), end];
    const mesh = buildTube({ path, radius: spec.radius, radialSegments });

    const axis = sub(end, start);
    const lengthSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z || 1;
    const vertexCount = mesh.positions.length / 3;
    for (let v = 0; v < vertexCount; v += 1) {
      const px = mesh.positions[v * 3]! - start.x;
      const py = mesh.positions[v * 3 + 1]! - start.y;
      const pz = mesh.positions[v * 3 + 2]! - start.z;
      const t = Math.max(0, Math.min(1, (px * axis.x + py * axis.y + pz * axis.z) / lengthSq));
      boneIndices.push(parentIndex, thisIndex);
      weights.push(1 - t, t);
    }
    segmentMeshes.push(mesh);
  }

  const mesh = mergeMeshes(segmentMeshes);
  const binding = createSkinBinding(boneIndices, weights, 2);
  return { mesh, skeleton, binding, boneNames: specs.map((spec) => spec.name) };
}

export type HumanoidAnimation = "wave" | "walk" | "idle" | "point";

export interface HumanoidWaveOptions {
  readonly speed?: number;
  readonly idleSway?: number;
}

export function humanoidWavePose(time: number, options: HumanoidWaveOptions = {}): Pose {
  const speed = options.speed ?? 6;
  const idleSway = options.idleSway ?? 3;
  const wave = 22 * Math.sin(time * speed);
  const sway = idleSway * Math.sin(time * speed);
  const pose: Record<string, Partial<Transform3D>> = {
    spine: { rotation: { x: 0, y: 0, z: sway } },
    chest: { rotation: { x: 0, y: 0, z: sway * 0.5 } },
    shoulderR: { rotation: { x: 0, y: 0, z: 78 } },
    upperArmR: { rotation: { x: 0, y: 0, z: 18 } },
    foreArmR: { rotation: { x: 0, y: 0, z: wave } },
    shoulderL: { rotation: { x: 0, y: 0, z: -8 } },
    foreArmL: { rotation: { x: 0, y: 0, z: -6 + sway } },
  };
  return pose;
}

export function humanoidWalkPose(time: number, options: HumanoidWaveOptions = {}): Pose {
  const speed = options.speed ?? 6;
  const phase = time * speed;
  const legSwing = 28 * Math.sin(phase);
  const kneeBend = 24 * Math.max(0, Math.sin(phase));
  const kneeBendBack = 24 * Math.max(0, Math.sin(phase + Math.PI));
  const armSwing = 22 * Math.sin(phase);
  const bob = 2.5 * Math.sin(phase * 2);
  return {
    spine: { rotation: { x: 0, y: 0, z: 0 }, position: { x: 0, y: bob, z: 0 } },
    thighR: { rotation: { x: legSwing, y: 0, z: 0 } },
    shinR: { rotation: { x: -kneeBend, y: 0, z: 0 } },
    thighL: { rotation: { x: -legSwing, y: 0, z: 0 } },
    shinL: { rotation: { x: -kneeBendBack, y: 0, z: 0 } },
    upperArmR: { rotation: { x: -armSwing, y: 0, z: 0 } },
    upperArmL: { rotation: { x: armSwing, y: 0, z: 0 } },
  };
}

export function humanoidIdlePose(time: number, options: HumanoidWaveOptions = {}): Pose {
  const speed = (options.speed ?? 6) * 0.4;
  const sway = (options.idleSway ?? 3) * Math.sin(time * speed);
  const breathe = 1.5 * Math.sin(time * speed * 1.5);
  return {
    spine: { rotation: { x: breathe * 0.3, y: 0, z: sway } },
    chest: { rotation: { x: 0, y: 0, z: sway * 0.6 } },
    head: { rotation: { x: 0, y: 0, z: -sway * 0.4 } },
    upperArmR: { rotation: { x: 0, y: 0, z: 6 + sway } },
    upperArmL: { rotation: { x: 0, y: 0, z: -6 - sway } },
  };
}

export function humanoidPointPose(time: number, options: HumanoidWaveOptions = {}): Pose {
  const speed = options.speed ?? 6;
  const settle = Math.min(1, time * 2);
  const drift = 4 * Math.sin(time * speed * 0.5);
  return {
    spine: { rotation: { x: 0, y: 0, z: drift } },
    shoulderR: { rotation: { x: -90 * settle, y: 0, z: 0 } },
    upperArmR: { rotation: { x: 0, y: 0, z: 2 } },
    foreArmR: { rotation: { x: 0, y: 0, z: 0 } },
    upperArmL: { rotation: { x: 0, y: 0, z: -6 } },
  };
}

export function humanoidAnimationPose(
  animation: HumanoidAnimation,
  time: number,
  options: HumanoidWaveOptions = {},
): Pose {
  switch (animation) {
    case "walk":
      return humanoidWalkPose(time, options);
    case "idle":
      return humanoidIdlePose(time, options);
    case "point":
      return humanoidPointPose(time, options);
    default:
      return humanoidWavePose(time, options);
  }
}
