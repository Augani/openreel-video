import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationRenderBinding,
  CreationScene,
} from "./schema/types";

export interface CreationMotionSceneBindingResolution {
  readonly scene: CreationScene;
  readonly binding: CreationRenderBinding;
  readonly assets: readonly CreationAssetRecipe[];
}

export function resolveCreationMotionSceneBinding(
  creation: CreationProjectState | undefined,
  compositionId: string,
  layerId?: string,
): CreationMotionSceneBindingResolution | null {
  if (!creation) return null;
  for (const scene of creation.scenes) {
    const binding = scene.renderBindings.find(
      (candidate) =>
        candidate.kind === "motion-scene3d" &&
        candidate.compositionId === compositionId &&
        (layerId === undefined || candidate.layerId === layerId),
    );
    if (binding) {
      return {
        scene,
        binding,
        assets: creation.assets,
      };
    }
  }
  return null;
}
