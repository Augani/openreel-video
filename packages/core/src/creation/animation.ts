import type {
  CreationAnimationKeyframe,
  CreationAnimationTrack,
  CreationCamera,
  CreationScene,
  CreationSceneObject,
} from "./schema/types";
import type { Vec3 } from "./schema/common";

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function easedT(
  t: number,
  easing: CreationAnimationKeyframe["easing"] | undefined,
): number {
  const x = clamp01(t);
  switch (easing) {
    case "ease-in":
      return x * x;
    case "ease-out":
      return 1 - (1 - x) * (1 - x);
    case "ease":
    case "ease-in-out":
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case "linear":
    default:
      return x;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function orderedKeyframes(
  keyframes: readonly CreationAnimationKeyframe[],
): readonly CreationAnimationKeyframe[] {
  for (let index = 1; index < keyframes.length; index += 1) {
    if ((keyframes[index - 1]?.time ?? 0) > (keyframes[index]?.time ?? 0)) {
      return [...keyframes].sort((a, b) => a.time - b.time);
    }
  }
  return keyframes;
}

function isVec3(value: unknown): value is Vec3 {
  const candidate = value as Vec3 | undefined;
  return (
    typeof candidate?.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.z === "number" &&
    Number.isFinite(candidate.z)
  );
}

function sampleNumberKeyframes(
  keyframes: readonly CreationAnimationKeyframe[],
  time: number,
  fallback: number,
): number {
  const ordered = orderedKeyframes(keyframes);
  if (ordered.length === 0) return fallback;
  const first = ordered[0];
  if (!first || time < first.time) return fallback;
  if (time === first.time && typeof first.value === "number") return first.value;

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (!previous || !next) continue;
    if (time > next.time) continue;
    if (typeof previous.value !== "number" || typeof next.value !== "number") {
      return fallback;
    }
    const span = Math.max(1e-6, next.time - previous.time);
    const t = easedT((time - previous.time) / span, previous.easing);
    return lerp(previous.value, next.value, t);
  }

  const last = ordered[ordered.length - 1];
  return typeof last?.value === "number" ? last.value : fallback;
}

function sampleVec3Keyframes(
  keyframes: readonly CreationAnimationKeyframe[],
  time: number,
  fallback: Vec3,
): Vec3 {
  const ordered = orderedKeyframes(keyframes);
  if (ordered.length === 0) return fallback;
  const first = ordered[0];
  if (!first || time < first.time) return fallback;
  if (time === first.time && isVec3(first.value)) return first.value;

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (!previous || !next) continue;
    if (time > next.time) continue;
    if (!isVec3(previous.value) || !isVec3(next.value)) return fallback;
    const span = Math.max(1e-6, next.time - previous.time);
    const t = easedT((time - previous.time) / span, previous.easing);
    return {
      x: lerp(previous.value.x, next.value.x, t),
      y: lerp(previous.value.y, next.value.y, t),
      z: lerp(previous.value.z, next.value.z, t),
    };
  }

  const last = ordered[ordered.length - 1];
  return isVec3(last?.value) ? last.value : fallback;
}

function sampleObjectTrack(
  object: CreationSceneObject,
  track: CreationAnimationTrack,
  time: number,
): CreationSceneObject {
  switch (track.channel) {
    case "position":
    case "rotation":
    case "scale":
      return {
        ...object,
        transform: {
          ...object.transform,
          [track.channel]: sampleVec3Keyframes(
            track.keyframes,
            time,
            object.transform[track.channel],
          ),
        },
      };
    case "opacity": {
      const opacity = sampleNumberKeyframes(track.keyframes, time, object.visible ? 1 : 0);
      return { ...object, visible: object.visible && opacity > 0.01 };
    }
    default:
      return object;
  }
}

function sampleCameraTrack(
  camera: CreationCamera,
  track: CreationAnimationTrack,
  time: number,
): CreationCamera {
  switch (track.channel) {
    case "camera.position":
      return {
        ...camera,
        position: sampleVec3Keyframes(track.keyframes, time, camera.position),
      };
    case "camera.target":
      return {
        ...camera,
        target: sampleVec3Keyframes(track.keyframes, time, camera.target),
      };
    case "camera.fov":
      return {
        ...camera,
        fov: sampleNumberKeyframes(track.keyframes, time, camera.fov),
      };
    case "camera.focusDistance":
      return {
        ...camera,
        focusDistance: sampleNumberKeyframes(
          track.keyframes,
          time,
          camera.focusDistance ?? 1,
        ),
      };
    default:
      return camera;
  }
}

export function evaluateCreationSceneAtTime(
  scene: CreationScene,
  timeSeconds: number,
): CreationScene {
  const time = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0);
  if (scene.animations.length === 0) return scene;

  const objects = new Map(scene.objects.map((object) => [object.id, object]));
  const cameras = new Map(scene.cameras.map((camera) => [camera.id, camera]));

  for (const clip of scene.animations) {
    for (const track of clip.tracks) {
      if (track.channel.startsWith("camera.")) {
        const camera = cameras.get(track.targetId);
        if (!camera) continue;
        cameras.set(track.targetId, sampleCameraTrack(camera, track, time));
        continue;
      }
      const object = objects.get(track.targetId);
      if (!object) continue;
      objects.set(track.targetId, sampleObjectTrack(object, track, time));
    }
  }

  return {
    ...scene,
    objects: scene.objects.map((object) => objects.get(object.id) ?? object),
    cameras: scene.cameras.map((camera) => cameras.get(camera.id) ?? camera),
  };
}
