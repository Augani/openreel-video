import type { MotionObject3D } from "./types";

export function sampleMotionObjectMeshFrame(
  object: MotionObject3D,
  timeSeconds: number,
): MotionObject3D {
  const frames = object.meshFrames;
  if (!frames || frames.frames.length === 0 || frames.fps <= 0) return object;
  const count = frames.frames.length;
  const raw = Math.floor(timeSeconds * frames.fps);
  const index = frames.loop
    ? ((raw % count) + count) % count
    : Math.max(0, Math.min(count - 1, raw));
  const positions = frames.frames[index] ?? frames.frames[count - 1]!;
  if (positions.length < 9 || frames.indices.length < 3) return object;
  const { meshFrames: _meshFrames, ...rest } = object;
  return {
    ...rest,
    mesh: { positions, indices: frames.indices, uvs: frames.uvs, preScaled: true },
  };
}
