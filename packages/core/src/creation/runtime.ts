import { IDENTITY_TRANSFORM } from "./schema/common";
import type {
  CreationAnimationClip,
  CreationAssetRecipe,
  CreationCamera,
  CreationOperation,
  CreationProjectState,
  CreationScene,
  CreationSceneObject,
  CreationValidationIssue,
} from "./schema/types";

export const CREATION_STATE_VERSION = "0.1.0";

export interface CreateEmptyCreationStateOptions {
  readonly version?: string;
  readonly activeSceneId?: string;
}

export function createEmptyCreationState(
  options: CreateEmptyCreationStateOptions = {},
): CreationProjectState {
  return {
    version: options.version ?? CREATION_STATE_VERSION,
    assets: [],
    scenes: [],
    activeSceneId: options.activeSceneId,
    operationHistory: [],
  };
}

export function createCreationScene(
  options: {
    readonly id: string;
    readonly name: string;
    readonly duration?: number;
    readonly frameRate?: number;
    readonly now?: number;
  },
): CreationScene {
  const now = options.now ?? Date.now();
  return {
    id: options.id,
    name: options.name,
    duration: Math.max(0.1, options.duration ?? 6),
    frameRate: Math.max(1, options.frameRate ?? 30),
    objects: [],
    cameras: [],
    lights: [],
    animations: [],
    environment: { kind: "studio", backgroundColor: "#f8fafc", groundEnabled: true },
    renderBindings: [],
    createdAt: now,
    modifiedAt: now,
  };
}

export function createCreationSceneObject(
  options: {
    readonly id: string;
    readonly name: string;
    readonly assetId: string;
    readonly materialId?: string;
    readonly partId?: string;
    readonly parentId?: string;
    readonly transform?: CreationSceneObject["transform"];
    readonly visible?: boolean;
    readonly selectable?: boolean;
    readonly tags?: readonly string[];
  },
): CreationSceneObject {
  return {
    id: options.id,
    name: options.name,
    assetId: options.assetId,
    materialId: options.materialId,
    partId: options.partId,
    parentId: options.parentId,
    transform: options.transform ?? IDENTITY_TRANSFORM,
    visible: options.visible ?? true,
    selectable: options.selectable ?? true,
    tags: options.tags ?? [],
  };
}

function appendHistory(
  state: CreationProjectState,
  operation: CreationOperation,
  maxHistory: number,
): readonly CreationOperation[] {
  if (maxHistory <= 0) return state.operationHistory;
  return [...state.operationHistory, operation].slice(-maxHistory);
}

function touchScene(scene: CreationScene, timestamp: number): CreationScene {
  return { ...scene, modifiedAt: timestamp };
}

function requireScene(
  state: CreationProjectState,
  sceneId: string,
): CreationScene {
  const scene = state.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`Creation scene not found: ${sceneId}`);
  return scene;
}

function upsertById<T extends { readonly id: string }>(
  items: readonly T[],
  next: T,
): readonly T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  return items.map((item) => (item.id === next.id ? next : item));
}

function removeById<T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
): readonly T[] {
  return items.filter((item) => item.id !== id);
}

export function upsertCreationAsset(
  state: CreationProjectState,
  asset: CreationAssetRecipe,
): CreationProjectState {
  return {
    ...state,
    assets: upsertById(state.assets, asset),
  };
}

export function removeCreationAsset(
  state: CreationProjectState,
  assetId: string,
): CreationProjectState {
  return {
    ...state,
    assets: removeById(state.assets, assetId),
    scenes: state.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.filter((object) => object.assetId !== assetId),
    })),
  };
}

export function upsertCreationScene(
  state: CreationProjectState,
  scene: CreationScene,
): CreationProjectState {
  return {
    ...state,
    scenes: upsertById(state.scenes, scene),
    activeSceneId: state.activeSceneId ?? scene.id,
  };
}

export function setActiveCreationScene(
  state: CreationProjectState,
  sceneId: string,
): CreationProjectState {
  requireScene(state, sceneId);
  return { ...state, activeSceneId: sceneId };
}

export function upsertCreationCamera(
  state: CreationProjectState,
  sceneId: string,
  camera: CreationCamera,
  active = false,
  timestamp = Date.now(),
): CreationProjectState {
  requireScene(state, sceneId);
  return {
    ...state,
    scenes: state.scenes.map((scene) =>
      scene.id === sceneId
        ? touchScene(
            {
              ...scene,
              cameras: upsertById(scene.cameras, camera),
              activeCameraId: active || !scene.activeCameraId ? camera.id : scene.activeCameraId,
            },
            timestamp,
          )
        : scene,
    ),
  };
}

export function upsertCreationSceneObject(
  state: CreationProjectState,
  sceneId: string,
  object: CreationSceneObject,
  timestamp = Date.now(),
): CreationProjectState {
  requireScene(state, sceneId);
  return {
    ...state,
    scenes: state.scenes.map((scene) =>
      scene.id === sceneId
        ? touchScene({ ...scene, objects: upsertById(scene.objects, object) }, timestamp)
        : scene,
    ),
  };
}

export function updateCreationSceneObjectTransform(
  state: CreationProjectState,
  sceneId: string,
  objectId: string,
  transform: CreationSceneObject["transform"],
  timestamp = Date.now(),
): CreationProjectState {
  const scene = requireScene(state, sceneId);
  if (!scene.objects.some((object) => object.id === objectId)) {
    throw new Error(`Creation scene object not found: ${objectId}`);
  }
  return {
    ...state,
    scenes: state.scenes.map((candidate) =>
      candidate.id === sceneId
        ? touchScene(
            {
              ...candidate,
              objects: candidate.objects.map((object) =>
                object.id === objectId ? { ...object, transform } : object,
              ),
            },
            timestamp,
          )
        : candidate,
    ),
  };
}

export function updateCreationSceneObjectMaterial(
  state: CreationProjectState,
  sceneId: string,
  objectId: string,
  materialId: string | undefined,
  timestamp = Date.now(),
): CreationProjectState {
  const scene = requireScene(state, sceneId);
  if (!scene.objects.some((object) => object.id === objectId)) {
    throw new Error(`Creation scene object not found: ${objectId}`);
  }
  return {
    ...state,
    scenes: state.scenes.map((candidate) =>
      candidate.id === sceneId
        ? touchScene(
            {
              ...candidate,
              objects: candidate.objects.map((object) =>
                object.id === objectId ? { ...object, materialId } : object,
              ),
            },
            timestamp,
          )
        : candidate,
    ),
  };
}

export function removeCreationSceneObject(
  state: CreationProjectState,
  sceneId: string,
  objectId: string,
  timestamp = Date.now(),
): CreationProjectState {
  requireScene(state, sceneId);
  return {
    ...state,
    scenes: state.scenes.map((scene) =>
      scene.id === sceneId
        ? touchScene(
            {
              ...scene,
              objects: scene.objects
                .filter((object) => object.id !== objectId)
                .map((object) =>
                  object.parentId === objectId ? { ...object, parentId: undefined } : object,
                ),
              animations: scene.animations.map((clip) => ({
                ...clip,
                tracks: clip.tracks.filter((track) => track.targetId !== objectId),
              })),
            },
            timestamp,
          )
        : scene,
    ),
  };
}

export function upsertCreationAnimationClip(
  state: CreationProjectState,
  sceneId: string,
  clip: CreationAnimationClip,
  timestamp = Date.now(),
): CreationProjectState {
  requireScene(state, sceneId);
  return {
    ...state,
    scenes: state.scenes.map((scene) =>
      scene.id === sceneId
        ? touchScene({ ...scene, animations: upsertById(scene.animations, clip) }, timestamp)
        : scene,
    ),
  };
}

export function applyCreationOperation(
  state: CreationProjectState,
  operation: CreationOperation,
  options: { readonly maxHistory?: number } = {},
): CreationProjectState {
  const maxHistory = options.maxHistory ?? 200;
  let next: CreationProjectState;
  switch (operation.type) {
    case "asset/upsert":
      next = upsertCreationAsset(state, operation.asset);
      break;
    case "asset/remove":
      next = removeCreationAsset(state, operation.assetId);
      break;
    case "scene/upsert":
      next = upsertCreationScene(state, operation.scene);
      break;
    case "scene/set-active":
      next = setActiveCreationScene(state, operation.sceneId);
      break;
    case "camera/upsert":
      next = upsertCreationCamera(
        state,
        operation.sceneId,
        operation.camera,
        operation.active,
        operation.timestamp,
      );
      break;
    case "scene-object/upsert":
      next = upsertCreationSceneObject(
        state,
        operation.sceneId,
        operation.object,
        operation.timestamp,
      );
      break;
    case "scene-object/update-transform":
      next = updateCreationSceneObjectTransform(
        state,
        operation.sceneId,
        operation.objectId,
        operation.transform,
        operation.timestamp,
      );
      break;
    case "scene-object/update-material":
      next = updateCreationSceneObjectMaterial(
        state,
        operation.sceneId,
        operation.objectId,
        operation.materialId,
        operation.timestamp,
      );
      break;
    case "scene-object/remove":
      next = removeCreationSceneObject(
        state,
        operation.sceneId,
        operation.objectId,
        operation.timestamp,
      );
      break;
    case "animation/upsert-clip":
      next = upsertCreationAnimationClip(
        state,
        operation.sceneId,
        operation.clip,
        operation.timestamp,
      );
      break;
  }
  return {
    ...next,
    operationHistory: appendHistory(next, operation, maxHistory),
  };
}

export function getCreationAsset(
  state: CreationProjectState,
  assetId: string,
): CreationAssetRecipe | undefined {
  return state.assets.find((asset) => asset.id === assetId);
}

export function getCreationScene(
  state: CreationProjectState,
  sceneId: string,
): CreationScene | undefined {
  return state.scenes.find((scene) => scene.id === sceneId);
}

export function getActiveCreationScene(
  state: CreationProjectState,
): CreationScene | undefined {
  return state.activeSceneId ? getCreationScene(state, state.activeSceneId) : undefined;
}

export function normalizeCreationState(
  state: Partial<CreationProjectState> | null | undefined,
): CreationProjectState | undefined {
  if (!state) return undefined;
  return {
    version: typeof state.version === "string" ? state.version : CREATION_STATE_VERSION,
    assets: Array.isArray(state.assets) ? state.assets : [],
    scenes: Array.isArray(state.scenes)
      ? state.scenes.map((scene) => ({
          ...scene,
          objects: Array.isArray(scene.objects) ? scene.objects : [],
          cameras: Array.isArray(scene.cameras) ? scene.cameras : [],
          lights: Array.isArray(scene.lights) ? scene.lights : [],
          animations: Array.isArray(scene.animations) ? scene.animations : [],
          renderBindings: Array.isArray(scene.renderBindings) ? scene.renderBindings : [],
        }))
      : [],
    activeSceneId:
      typeof state.activeSceneId === "string" ? state.activeSceneId : undefined,
    operationHistory: Array.isArray(state.operationHistory)
      ? state.operationHistory
      : [],
  };
}

function pushIssue(
  issues: CreationValidationIssue[],
  code: string,
  message: string,
  severity: CreationValidationIssue["severity"],
  path?: string,
): void {
  issues.push({ code, message, severity, path });
}

function collectDuplicateIds<T extends { readonly id: string }>(
  items: readonly T[],
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates];
}

export function validateCreationState(
  state: CreationProjectState,
): readonly CreationValidationIssue[] {
  const issues: CreationValidationIssue[] = [];
  const assetIds = new Set(state.assets.map((asset) => asset.id));
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const sceneIds = new Set(state.scenes.map((scene) => scene.id));

  for (const duplicateId of collectDuplicateIds(state.assets)) {
    pushIssue(issues, "DUPLICATE_ASSET_ID", `Duplicate asset id: ${duplicateId}`, "error", "assets");
  }
  for (const duplicateId of collectDuplicateIds(state.scenes)) {
    pushIssue(issues, "DUPLICATE_SCENE_ID", `Duplicate scene id: ${duplicateId}`, "error", "scenes");
  }

  if (state.activeSceneId && !sceneIds.has(state.activeSceneId)) {
    pushIssue(
      issues,
      "ACTIVE_SCENE_NOT_FOUND",
      `Active creation scene does not exist: ${state.activeSceneId}`,
      "error",
      "activeSceneId",
    );
  }

  for (const [sceneIndex, scene] of state.scenes.entries()) {
    const path = `scenes[${sceneIndex}]`;
    const objectIds = new Set(scene.objects.map((object) => object.id));
    const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
    for (const duplicateId of collectDuplicateIds(scene.objects)) {
      pushIssue(
        issues,
        "DUPLICATE_OBJECT_ID",
        `Duplicate object id in scene ${scene.id}: ${duplicateId}`,
        "error",
        `${path}.objects`,
      );
    }
    for (const object of scene.objects) {
      const asset = assetsById.get(object.assetId);
      if (!assetIds.has(object.assetId)) {
        pushIssue(
          issues,
          "OBJECT_ASSET_NOT_FOUND",
          `Object ${object.id} references missing asset ${object.assetId}`,
          "error",
          `${path}.objects.${object.id}.assetId`,
        );
      }
      if (
        object.materialId &&
        asset &&
        !asset.materials.some((material) => material.id === object.materialId)
      ) {
        pushIssue(
          issues,
          "OBJECT_MATERIAL_NOT_FOUND",
          `Object ${object.id} references missing material ${object.materialId}`,
          "error",
          `${path}.objects.${object.id}.materialId`,
        );
      }
      if (object.parentId && !objectIds.has(object.parentId)) {
        pushIssue(
          issues,
          "OBJECT_PARENT_NOT_FOUND",
          `Object ${object.id} references missing parent ${object.parentId}`,
          "error",
          `${path}.objects.${object.id}.parentId`,
        );
      }
    }
    if (scene.activeCameraId && !cameraIds.has(scene.activeCameraId)) {
      pushIssue(
        issues,
        "ACTIVE_CAMERA_NOT_FOUND",
        `Scene ${scene.id} active camera does not exist: ${scene.activeCameraId}`,
        "error",
        `${path}.activeCameraId`,
      );
    }
    for (const binding of scene.renderBindings) {
      for (const objectBinding of binding.objectBindings) {
        if (!objectIds.has(objectBinding.sceneObjectId)) {
          pushIssue(
            issues,
            "RENDER_BINDING_OBJECT_NOT_FOUND",
            `Render binding ${binding.id} references missing scene object ${objectBinding.sceneObjectId}`,
            "error",
            `${path}.renderBindings.${binding.id}.objectBindings`,
          );
        }
      }
    }
    for (const clip of scene.animations) {
      for (const track of clip.tracks) {
        const isCameraTrack = track.channel.startsWith("camera.");
        const targetExists = isCameraTrack
          ? cameraIds.has(track.targetId)
          : objectIds.has(track.targetId);
        if (!targetExists) {
          pushIssue(
            issues,
            "ANIMATION_TARGET_NOT_FOUND",
            `Animation track ${track.id} references missing target ${track.targetId}`,
            "error",
            `${path}.animations.${clip.id}.${track.id}`,
          );
        }
        for (let i = 1; i < track.keyframes.length; i += 1) {
          const previous = track.keyframes[i - 1];
          const current = track.keyframes[i];
          if (previous && current && current.time < previous.time) {
            pushIssue(
              issues,
              "KEYFRAMES_NOT_SORTED",
              `Track ${track.id} keyframes must be sorted by time`,
              "warning",
              `${path}.animations.${clip.id}.${track.id}.keyframes`,
            );
            break;
          }
        }
      }
    }
  }

  return issues;
}

export function summarizeCreationState(state: CreationProjectState): string {
  const objectCount = state.scenes.reduce(
    (total, scene) => total + scene.objects.length,
    0,
  );
  const cacheCount = state.assets.reduce((total, asset) => total + asset.caches.length, 0);
  return `${state.assets.length} asset(s), ${state.scenes.length} scene(s), ${objectCount} object(s), ${cacheCount} cache ref(s)`;
}
