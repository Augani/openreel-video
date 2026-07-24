import type { Project, MotionComposition } from "@openreel/core";
import type { MotionScene3DLayer } from "@openreel/core/motion/types";
import type {
  CreationAssetRecipe,
  CreationMaterial,
  CreationOperation,
  CreationScene,
  CreationSceneObject,
  Transform3D,
} from "@openreel/core/creation/index";

export interface CreationObjectMaterialPatch {
  readonly baseColor?: string;
  readonly metallic?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
}

export interface CreationObjectEditPatch {
  readonly name?: string;
  readonly position?: Partial<Transform3D["position"]>;
  readonly rotation?: Partial<Transform3D["rotation"]>;
  readonly scale?: Partial<Transform3D["scale"]>;
  readonly material?: CreationObjectMaterialPatch;
}

export interface CreationObjectEditPlan {
  readonly scene: CreationScene;
  readonly operations: readonly CreationOperation[];
  readonly composition?: MotionComposition;
  readonly renderObjectId?: string;
  readonly modifiedAt: number;
}

export function planCreationObjectEdit(
  project: Project,
  sceneId: string,
  objectId: string,
  patch: CreationObjectEditPatch,
  now = Date.now(),
): CreationObjectEditPlan | { readonly error: string } {
  const creation = project.creation;
  if (!creation) return { error: "No creation state is available" };
  const scene = creation.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) return { error: `Creation scene not found: ${sceneId}` };
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  if (!object) return { error: `Creation object not found: ${objectId}` };

  const nextObject = editCreationSceneObject(object, patch);
  const asset = creation.assets.find((candidate) => candidate.id === object.assetId);
  const nextAsset =
    patch.material && asset
      ? editCreationAssetMaterial(asset, object.materialId, patch.material, now)
      : undefined;
  if (patch.material && !asset) {
    return { error: `Creation asset not found: ${object.assetId}` };
  }
  if (patch.material && nextAsset === asset) {
    return { error: `Creation material not found: ${object.materialId ?? "(none)"}` };
  }

  const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
  const renderObjectId = binding?.objectBindings.find(
    (candidate) => candidate.sceneObjectId === object.id,
  )?.renderObjectId;
  const nextScene: CreationScene = {
    ...scene,
    objects: scene.objects.map((candidate) =>
      candidate.id === object.id ? nextObject : candidate,
    ),
    modifiedAt: now,
  };

  const operations: CreationOperation[] = [];
  if (nextAsset && nextAsset !== asset) {
    operations.push({
      id: `ui-asset-${now}-${nextAsset.id}`,
      type: "asset/upsert",
      timestamp: now,
      source: "user",
      label: `Update ${nextAsset.name}`,
      asset: nextAsset,
    });
  }
  operations.push({
    id: `ui-scene-${now}-${nextScene.id}-${object.id}`,
    type: "scene/upsert",
    timestamp: now,
    source: "user",
    label: `Edit ${nextObject.name}`,
    scene: nextScene,
  });

  const composition =
    binding && renderObjectId
      ? updateBoundMotionSceneObject(project, binding.compositionId, binding.layerId, renderObjectId, {
          object: nextObject,
          material: nextAsset?.materials.find(
            (candidate) => candidate.id === nextObject.materialId,
          ),
          now,
        })
      : undefined;

  return { scene: nextScene, operations, composition, renderObjectId, modifiedAt: now };
}

function editCreationSceneObject(
  object: CreationSceneObject,
  patch: CreationObjectEditPatch,
): CreationSceneObject {
  return {
    ...object,
    name: patch.name?.trim() || object.name,
    transform: {
      position: mergeVec3(object.transform.position, patch.position),
      rotation: mergeVec3(object.transform.rotation, patch.rotation),
      scale: mergeVec3(object.transform.scale, patch.scale, { min: 0.001 }),
    },
  };
}

function editCreationAssetMaterial(
  asset: CreationAssetRecipe,
  materialId: string | undefined,
  patch: CreationObjectMaterialPatch,
  now: number,
): CreationAssetRecipe | undefined {
  if (!materialId) return asset;
  let changed = false;
  const materials = asset.materials.map((material) => {
    if (material.id !== materialId) return material;
    changed = true;
    return {
      ...material,
      baseColor: patch.baseColor?.trim() || material.baseColor,
      metallic: finiteOr(patch.metallic, material.metallic),
      roughness: finiteOr(patch.roughness, material.roughness),
      opacity: finiteOr(patch.opacity, material.opacity),
      emissive: patch.emissive?.trim() || material.emissive,
      emissiveIntensity: finiteOr(patch.emissiveIntensity, material.emissiveIntensity),
    };
  });
  return changed ? { ...asset, materials, modifiedAt: now } : asset;
}

function updateBoundMotionSceneObject(
  project: Project,
  compositionId: string,
  layerId: string,
  renderObjectId: string,
  patch: {
    readonly object: CreationSceneObject;
    readonly material?: CreationMaterial;
    readonly now: number;
  },
): MotionComposition | undefined {
  const composition = (project.motionCompositions ?? []).find(
    (candidate) => candidate.id === compositionId,
  );
  if (!composition) return undefined;
  let updatedLayer: MotionScene3DLayer | undefined;
  const layers = composition.layers.map((layer) => {
    if (layer.id !== layerId || layer.type !== "scene3d") return layer;
    updatedLayer = {
      ...layer,
      objects: (layer.objects ?? []).map((object) =>
        object.id === renderObjectId
          ? {
              ...object,
              name: patch.object.name,
              transform3d: patch.object.transform,
              material: patch.material
                ? {
                    ...object.material,
                    color: patch.material.baseColor,
                    metalness: patch.material.metallic,
                    roughness: patch.material.roughness,
                    opacity: patch.material.opacity,
                    emissive: patch.material.emissive,
                    emissiveIntensity: patch.material.emissiveIntensity,
                  }
                : object.material,
              opacity: patch.material?.opacity ?? object.opacity,
            }
          : object,
      ),
    };
    return updatedLayer;
  });
  return updatedLayer
    ? {
        ...composition,
        layers,
        modifiedAt: patch.now,
      }
    : undefined;
}

function mergeVec3<T extends { readonly x: number; readonly y: number; readonly z: number }>(
  current: T,
  patch: Partial<T> | undefined,
  options: { readonly min?: number } = {},
): T {
  return {
    x: finiteOr(patch?.x, current.x, options.min),
    y: finiteOr(patch?.y, current.y, options.min),
    z: finiteOr(patch?.z, current.z, options.min),
  } as T;
}

function finiteOr(
  value: number | undefined,
  fallback: number | undefined,
  min?: number,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return min === undefined ? value : Math.max(min, value);
}
