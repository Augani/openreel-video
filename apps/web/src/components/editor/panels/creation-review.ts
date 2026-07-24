import type { CreationProjectState } from "@openreel/core/creation/index";
import type { MotionComposition } from "@openreel/core/motion/types";

export type CreationIssueSeverity = "error" | "warning" | "info";

export interface CreationSceneIssue {
  readonly severity: CreationIssueSeverity;
  readonly code: string;
  readonly message: string;
}

export interface CreationSceneReview {
  readonly sceneId: string;
  readonly name: string;
  readonly objectCount: number;
  readonly cameraCount: number;
  readonly animationCount: number;
  readonly ok: boolean;
  readonly issues: readonly CreationSceneIssue[];
}

export interface CreationReview {
  readonly available: boolean;
  readonly assetCount: number;
  readonly sceneCount: number;
  readonly activeSceneId?: string;
  readonly scenes: readonly CreationSceneReview[];
}

export function reviewCreationState(
  creation: CreationProjectState | undefined,
  motionCompositions: readonly MotionComposition[] = [],
): CreationReview {
  if (!creation) {
    return { available: false, assetCount: 0, sceneCount: 0, scenes: [] };
  }
  const assetsById = new Map(creation.assets.map((asset) => [asset.id, asset]));
  const compositionsById = new Map(
    motionCompositions.map((composition) => [composition.id, composition]),
  );
  const scenes = creation.scenes.map((scene) => {
    const issues: CreationSceneIssue[] = [];
    const add = (severity: CreationIssueSeverity, code: string, message: string): void => {
      issues.push({ severity, code, message });
    };

    if (scene.objects.length === 0) {
      add("error", "EMPTY_SCENE", "Scene has no objects");
    }
    for (const object of scene.objects) {
      if (!assetsById.has(object.assetId)) {
        add("error", "MISSING_ASSET", `Object ${object.name} references a missing asset`);
      }
      if (!object.materialId) {
        add("warning", "NO_MATERIAL", `Object ${object.name} has no material`);
      }
    }
    const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
    if (!binding) {
      add("warning", "NO_RENDER_BINDING", "Scene has no render binding");
    } else {
      const composition = compositionsById.get(binding.compositionId);
      const layer = composition?.layers.find((candidate) => candidate.id === binding.layerId);
      if (!composition) {
        add(
          "error",
          "MISSING_RENDER_COMPOSITION",
          `Bound Motion composition is missing: ${binding.compositionId}`,
        );
      } else if (!layer || layer.type !== "scene3d") {
        add(
          "error",
          "MISSING_RENDER_LAYER",
          `Bound Motion scene3d layer is missing: ${binding.layerId}`,
        );
      } else if (binding.objectBindings.length < scene.objects.length) {
        add(
          "warning",
          "PARTIAL_RENDER_BINDING",
          `${binding.objectBindings.length}/${scene.objects.length} objects are rendered`,
        );
      }
    }
    if (scene.cameras.length === 0) {
      add("warning", "NO_CAMERA", "Scene has no camera");
    }
    if (scene.lights.length === 0) {
      add("info", "NO_LIGHTS", "Using default lighting");
    }

    let dirtyMeshAssets = 0;
    for (const assetId of new Set(scene.objects.map((object) => object.assetId))) {
      const asset = assetsById.get(assetId);
      if (!asset) continue;
      if (
        asset.caches.some(
          (cache) =>
            (cache.kind === "preview-mesh" || cache.kind === "final-mesh") &&
            cache.status === "dirty",
        )
      ) {
        dirtyMeshAssets += 1;
      }
    }
    if (dirtyMeshAssets > 0) {
      add("info", "UNBAKED_MESHES", `${dirtyMeshAssets} asset(s) need baking`);
    }

    const objectIds = new Set(scene.objects.map((object) => object.id));
    const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
    let orphanTracks = 0;
    for (const clip of scene.animations) {
      for (const track of clip.tracks) {
        const isCameraTrack = track.channel.startsWith("camera.");
        const exists = isCameraTrack
          ? cameraIds.has(track.targetId)
          : objectIds.has(track.targetId);
        if (!exists) orphanTracks += 1;
      }
    }
    if (orphanTracks > 0) {
      add("warning", "ORPHAN_ANIMATION", `${orphanTracks} animation track(s) are orphaned`);
    }

    return {
      sceneId: scene.id,
      name: scene.name,
      objectCount: scene.objects.length,
      cameraCount: scene.cameras.length,
      animationCount: scene.animations.length,
      ok: issues.every((issue) => issue.severity !== "error"),
      issues,
    };
  });

  return {
    available: true,
    assetCount: creation.assets.length,
    sceneCount: creation.scenes.length,
    activeSceneId: creation.activeSceneId,
    scenes,
  };
}
