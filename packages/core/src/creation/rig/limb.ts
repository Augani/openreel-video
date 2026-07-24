import type { Transform3D, Vec3 } from "../schema/common";
import { buildTube, type Mesh } from "../geometry";
import { makeBone, type Pose, type Skeleton } from "./skeleton";
import { createSkinBinding, type SkinBinding } from "./skin";

export interface SkinnedLimbOptions {
  readonly length?: number;
  readonly radius?: number;
  readonly segments?: number;
  readonly radialSegments?: number;
}

export interface SkinnedLimb {
  readonly mesh: Mesh;
  readonly skeleton: Skeleton;
  readonly binding: SkinBinding;
  readonly segments: number;
  readonly length: number;
}

export function buildSkinnedLimb(options: SkinnedLimbOptions = {}): SkinnedLimb {
  const length = Math.max(0.2, options.length ?? 2);
  const segments = Math.max(2, Math.min(24, Math.floor(options.segments ?? 8)));
  const radius = Math.max(0.02, options.radius ?? 0.15);
  const radialSegments = Math.max(3, Math.min(24, Math.floor(options.radialSegments ?? 10)));

  const path: Vec3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    path.push({ x: 0, y: (i / segments) * length, z: 0 });
  }
  const mesh = buildTube({ path, radius, radialSegments });

  const bones = [makeBone("limb0", -1)];
  const segmentLength = length / segments;
  for (let i = 1; i <= segments; i += 1) {
    bones.push(makeBone(`limb${i}`, i - 1, { position: { x: 0, y: segmentLength, z: 0 } }));
  }
  const skeleton: Skeleton = { bones };

  const vertexCount = mesh.positions.length / 3;
  const boneIndices: number[] = [];
  const weights: number[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    const y = mesh.positions[v * 3 + 1] ?? 0;
    const t = Math.max(0, Math.min(segments, (y / length) * segments));
    const lower = Math.max(0, Math.min(segments, Math.floor(t)));
    const upper = Math.min(segments, lower + 1);
    const frac = t - lower;
    boneIndices.push(lower, upper);
    weights.push(1 - frac, frac);
  }
  const binding = createSkinBinding(boneIndices, weights, 2);
  return { mesh, skeleton, binding, segments, length };
}

export interface LimbWaveOptions {
  readonly amplitudeDegrees?: number;
  readonly frequency?: number;
  readonly speed?: number;
  readonly axis?: "x" | "z";
}

export function limbWavePose(
  segments: number,
  time: number,
  options: LimbWaveOptions = {},
): Pose {
  const amplitude = options.amplitudeDegrees ?? 12;
  const frequency = options.frequency ?? 2.2;
  const speed = options.speed ?? 3;
  const axis = options.axis ?? "z";
  const pose: Record<string, Partial<Transform3D>> = {};
  for (let i = 1; i <= segments; i += 1) {
    const phase = (i / segments) * Math.PI * frequency - time * speed;
    const angle = amplitude * Math.sin(phase);
    pose[`limb${i}`] = {
      rotation: axis === "x" ? { x: angle, y: 0, z: 0 } : { x: 0, y: 0, z: angle },
    };
  }
  return pose;
}
