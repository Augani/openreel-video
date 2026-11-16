import type { MotionComposition } from "@openreel/core";

function hasScene3DLayer(composition: MotionComposition): boolean {
  return composition.layers.some((layer) => layer.type === "scene3d");
}

function clampTime(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(duration, Math.max(0, time));
}

function defaultPreviewTime(
  composition: MotionComposition,
  fraction: number,
): number {
  const duration = Math.max(0, composition.duration);
  return clampTime(Math.max(0.6, duration * fraction), duration);
}

function getFirstVisibleScene3DOpacityTime(
  composition: MotionComposition,
): number | null {
  const opacityTimes = composition.layers.flatMap((layer) => {
    if (layer.type !== "scene3d") return [];
    return layer.keyframes.flatMap((keyframe) => {
      if (!/\.opacity$/.test(keyframe.property)) return [];
      return typeof keyframe.value === "number" && keyframe.value > 0.05
        ? [keyframe.time]
        : [];
    });
  });
  if (opacityTimes.length === 0) return null;
  return Math.min(...opacityTimes);
}

export function resolveMotionCreatorPreviewTime(
  composition: MotionComposition,
): number {
  if (!hasScene3DLayer(composition)) {
    return defaultPreviewTime(composition, 0.5);
  }

  const visibleOpacityTime = getFirstVisibleScene3DOpacityTime(composition);
  if (visibleOpacityTime !== null) {
    return clampTime(Math.max(0.6, visibleOpacityTime + 1.5), composition.duration);
  }

  return defaultPreviewTime(composition, 0.85);
}
