import type { MotionComposition, Project } from "@openreel/core";

function hasComposition(
  compositions: readonly MotionComposition[],
  compositionId: string | null | undefined,
): compositionId is string {
  return !!compositionId && compositions.some((item) => item.id === compositionId);
}

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

function getBoundCreationCompositionIds(project: Project): string[] {
  const ids: string[] = [];
  const creation = project.creation;
  if (!creation) return ids;

  const activeScene = creation.scenes.find(
    (scene) => scene.id === creation.activeSceneId,
  );
  const scenes = activeScene
    ? [activeScene, ...creation.scenes.filter((scene) => scene.id !== activeScene.id)]
    : creation.scenes;

  for (const scene of scenes) {
    for (const binding of scene.renderBindings) {
      if (binding.kind === "motion-scene3d" && binding.compositionId) {
        ids.push(binding.compositionId);
      }
    }
  }
  return ids;
}

function firstExistingCompositionId(
  compositions: readonly MotionComposition[],
  ids: readonly string[],
): string | null {
  for (const id of ids) {
    if (hasComposition(compositions, id)) return id;
  }
  return null;
}

export function resolveMotionCreatorCompositionId({
  project,
  compositions,
  activeCompositionId,
  routeCompositionId,
}: {
  readonly project: Project;
  readonly compositions: readonly MotionComposition[];
  readonly activeCompositionId?: string | null;
  readonly routeCompositionId?: string | null;
}): string | null {
  if (compositions.length === 0) return null;
  if (hasComposition(compositions, routeCompositionId)) return routeCompositionId;
  if (hasComposition(compositions, activeCompositionId)) return activeCompositionId;

  const timelineCompositionId = firstExistingCompositionId(
    compositions,
    [...(project.motionInstances ?? [])]
      .sort((a, b) => a.startTime - b.startTime)
      .map((instance) => instance.compositionId),
  );
  if (timelineCompositionId) return timelineCompositionId;

  const creationCompositionId = firstExistingCompositionId(
    compositions,
    getBoundCreationCompositionIds(project),
  );
  if (creationCompositionId) return creationCompositionId;

  return compositions.find(hasScene3DLayer)?.id ?? compositions[0].id;
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
