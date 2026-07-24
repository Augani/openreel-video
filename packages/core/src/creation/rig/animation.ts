import { ONE_VEC3, ZERO_VEC3, lerpVec3, type Vec3 } from "../schema/common";
import type { Pose } from "./skeleton";

export interface BoneKeyframe {
  readonly time: number;
  readonly position?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
}

export interface BoneTrack {
  readonly bone: string;
  readonly keyframes: readonly BoneKeyframe[];
}

export interface SkeletalClip {
  readonly name: string;
  readonly duration: number;
  readonly tracks: readonly BoneTrack[];
}

function evaluateChannel(
  keyframes: readonly BoneKeyframe[],
  time: number,
  select: (frame: BoneKeyframe) => Vec3 | undefined,
  fallback: Vec3,
): Vec3 {
  const defined = keyframes
    .filter((frame) => select(frame) !== undefined)
    .sort((a, b) => a.time - b.time);
  if (defined.length === 0) return fallback;
  if (time <= defined[0]!.time) return select(defined[0]!)!;
  const last = defined[defined.length - 1]!;
  if (time >= last.time) return select(last)!;
  for (let i = 0; i < defined.length - 1; i += 1) {
    const a = defined[i]!;
    const b = defined[i + 1]!;
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      const t = span <= 1e-9 ? 0 : (time - a.time) / span;
      return lerpVec3(select(a)!, select(b)!, t);
    }
  }
  return select(last)!;
}

export function evaluatePose(clip: SkeletalClip, time: number): Pose {
  const pose: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3 }> = {};
  for (const track of clip.tracks) {
    pose[track.bone] = {
      position: evaluateChannel(track.keyframes, time, (frame) => frame.position, ZERO_VEC3),
      rotation: evaluateChannel(track.keyframes, time, (frame) => frame.rotation, ZERO_VEC3),
      scale: evaluateChannel(track.keyframes, time, (frame) => frame.scale, ONE_VEC3),
    };
  }
  return pose;
}

export function sampleSkeletalAnimation(clip: SkeletalClip, fps: number): Pose[] {
  const frameRate = Math.max(1, Math.floor(fps));
  const frameCount = Math.max(1, Math.round(clip.duration * frameRate) + 1);
  const poses: Pose[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    poses.push(evaluatePose(clip, frame / frameRate));
  }
  return poses;
}

function channel(
  pose: Pose,
  bone: string,
  key: "position" | "rotation" | "scale",
  fallback: Vec3,
): Vec3 {
  return pose[bone]?.[key] ?? fallback;
}

export function blendPoses(a: Pose, b: Pose, weight: number): Pose {
  const w = Math.max(0, Math.min(1, weight));
  const bones = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3 }> = {};
  for (const bone of bones) {
    result[bone] = {
      position: lerpVec3(
        channel(a, bone, "position", ZERO_VEC3),
        channel(b, bone, "position", ZERO_VEC3),
        w,
      ),
      rotation: lerpVec3(
        channel(a, bone, "rotation", ZERO_VEC3),
        channel(b, bone, "rotation", ZERO_VEC3),
        w,
      ),
      scale: lerpVec3(
        channel(a, bone, "scale", ONE_VEC3),
        channel(b, bone, "scale", ONE_VEC3),
        w,
      ),
    };
  }
  return result;
}

export function additivePose(base: Pose, additive: Pose, weight = 1): Pose {
  const w = Math.max(0, weight);
  const bones = new Set([...Object.keys(base), ...Object.keys(additive)]);
  const result: Record<string, { position: Vec3; rotation: Vec3; scale: Vec3 }> = {};
  for (const bone of bones) {
    const basePos = channel(base, bone, "position", ZERO_VEC3);
    const baseRot = channel(base, bone, "rotation", ZERO_VEC3);
    const baseScale = channel(base, bone, "scale", ONE_VEC3);
    const addPos = channel(additive, bone, "position", ZERO_VEC3);
    const addRot = channel(additive, bone, "rotation", ZERO_VEC3);
    result[bone] = {
      position: {
        x: basePos.x + addPos.x * w,
        y: basePos.y + addPos.y * w,
        z: basePos.z + addPos.z * w,
      },
      rotation: {
        x: baseRot.x + addRot.x * w,
        y: baseRot.y + addRot.y * w,
        z: baseRot.z + addRot.z * w,
      },
      scale: baseScale,
    };
  }
  return result;
}
