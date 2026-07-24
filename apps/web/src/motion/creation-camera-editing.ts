import type { Project, MotionComposition } from "@openreel/core";
import type { MotionScene3DLayer } from "@openreel/core/motion/types";
import type {
  CreationCamera,
  CreationOperation,
  CreationScene,
  Transform3D,
} from "@openreel/core/creation/index";

export interface CreationCameraEditPatch {
  readonly name?: string;
  readonly position?: Partial<Transform3D["position"]>;
  readonly target?: Partial<Transform3D["position"]>;
  readonly fov?: number;
  readonly focusDistance?: number;
  readonly depthOfField?: boolean;
  readonly active?: boolean;
}

export interface CreationCameraEditPlan {
  readonly scene: CreationScene;
  readonly camera: CreationCamera;
  readonly operations: readonly CreationOperation[];
  readonly composition?: MotionComposition;
  readonly modifiedAt: number;
}

export function planCreationCameraEdit(
  project: Project,
  sceneId: string,
  cameraId: string | undefined,
  patch: CreationCameraEditPatch,
  now = Date.now(),
): CreationCameraEditPlan | { readonly error: string } {
  const creation = project.creation;
  if (!creation) return { error: "No creation state is available" };
  const scene = creation.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) return { error: `Creation scene not found: ${sceneId}` };
  const resolvedCameraId = cameraId || scene.activeCameraId || scene.cameras[0]?.id;
  if (!resolvedCameraId) {
    return { error: "Creation scene has no camera to edit" };
  }
  const camera = scene.cameras.find((candidate) => candidate.id === resolvedCameraId);
  if (!camera) return { error: `Creation camera not found: ${resolvedCameraId}` };

  const nextCamera = editCreationCamera(camera, patch);
  const active = patch.active ?? (scene.activeCameraId === camera.id || !scene.activeCameraId);
  const nextScene: CreationScene = {
    ...scene,
    cameras: scene.cameras.map((candidate) =>
      candidate.id === camera.id ? nextCamera : candidate,
    ),
    activeCameraId: active ? nextCamera.id : scene.activeCameraId,
    modifiedAt: now,
  };
  const operations: CreationOperation[] = [
    {
      id: `ui-camera-${now}-${nextScene.id}-${nextCamera.id}`,
      type: "camera/upsert",
      timestamp: now,
      source: "user",
      label: `Edit ${nextCamera.name}`,
      sceneId: nextScene.id,
      camera: nextCamera,
      active,
    },
  ];

  const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
  const composition = binding
    ? updateBoundMotionSceneCamera(
        project,
        binding.compositionId,
        binding.layerId,
        camera,
        nextCamera,
        now,
      )
    : undefined;

  return { scene: nextScene, camera: nextCamera, operations, composition, modifiedAt: now };
}

function editCreationCamera(
  camera: CreationCamera,
  patch: CreationCameraEditPatch,
): CreationCamera {
  return {
    ...camera,
    name: patch.name?.trim() || camera.name,
    position: mergeVec3(camera.position, patch.position),
    target: mergeVec3(camera.target, patch.target),
    fov: finiteOr(patch.fov, camera.fov, 1, 179),
    focusDistance: optionalFiniteOr(patch.focusDistance, camera.focusDistance, 0),
    depthOfField:
      typeof patch.depthOfField === "boolean" ? patch.depthOfField : camera.depthOfField,
  };
}

function updateBoundMotionSceneCamera(
  project: Project,
  compositionId: string,
  layerId: string,
  previous: CreationCamera,
  next: CreationCamera,
  now: number,
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
      fov: next.fov,
      camera: {
        ...layer.camera,
        position: next.position,
        target: next.target,
        fov: next.fov,
      },
      keyframes: layer.keyframes.map((keyframe) =>
        shiftCameraKeyframeValue(keyframe, previous, next),
      ),
    };
    return updatedLayer;
  });
  return updatedLayer
    ? {
        ...composition,
        layers,
        modifiedAt: now,
      }
    : undefined;
}

function shiftCameraKeyframeValue(
  keyframe: MotionScene3DLayer["keyframes"][number],
  previous: CreationCamera,
  next: CreationCamera,
): MotionScene3DLayer["keyframes"][number] {
  if (!keyframe.property.startsWith("scene.camera.") || typeof keyframe.value !== "number") {
    return keyframe;
  }
  const property = keyframe.property.slice("scene.camera.".length);
  const deltas: Record<string, number> = {
    "position.x": next.position.x - previous.position.x,
    "position.y": next.position.y - previous.position.y,
    "position.z": next.position.z - previous.position.z,
    "target.x": next.target.x - previous.target.x,
    "target.y": next.target.y - previous.target.y,
    "target.z": next.target.z - previous.target.z,
    fov: next.fov - previous.fov,
  };
  return property in deltas
    ? { ...keyframe, value: keyframe.value + deltas[property] }
    : keyframe;
}

function mergeVec3<T extends { readonly x: number; readonly y: number; readonly z: number }>(
  current: T,
  patch: Partial<T> | undefined,
): T {
  return {
    x: finiteOr(patch?.x, current.x),
    y: finiteOr(patch?.y, current.y),
    z: finiteOr(patch?.z, current.z),
  } as T;
}

function finiteOr(
  value: number | undefined,
  fallback: number | undefined,
  min?: number,
  max?: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback ?? 0;
  const lowerBounded = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
}

function optionalFiniteOr(
  value: number | undefined,
  fallback: number | undefined,
  min?: number,
  max?: number,
): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const lowerBounded = min === undefined ? value : Math.max(min, value);
  return max === undefined ? lowerBounded : Math.min(max, lowerBounded);
}
