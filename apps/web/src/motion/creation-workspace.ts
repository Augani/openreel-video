import type { MotionComposition } from "@openreel/core";
import type {
  CreationProjectState,
  CreationAnimationTrack,
  CreationCamera,
  CreationScene,
  CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  findRecoverableScene3DLayers,
  type RecoverableScene3DLayerSummary,
} from "./creation-recovery";

export type CreationRenderStatus =
  | "ready"
  | "partial"
  | "unbound"
  | "missing-composition"
  | "missing-layer";

export interface CreationWorkspaceIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
}

export interface CreationWorkspaceObjectSummary {
  readonly objectId: string;
  readonly name: string;
  readonly assetId: string;
  readonly materialId?: string;
  readonly partId?: string;
  readonly transform: CreationSceneObject["transform"];
  readonly material?: {
    readonly baseColor: string;
    readonly metallic?: number;
    readonly roughness?: number;
    readonly opacity?: number;
  };
  readonly rendered: boolean;
  readonly missingAsset: boolean;
  readonly tags: readonly string[];
}

export interface CreationWorkspaceCameraSummary {
  readonly cameraId: string;
  readonly name: string;
  readonly active: boolean;
  readonly position: CreationCamera["position"];
  readonly target: CreationCamera["target"];
  readonly fov: number;
  readonly focusDistance?: number;
  readonly depthOfField?: boolean;
}

export interface CreationWorkspaceAnimationTrackSummary {
  readonly trackId: string;
  readonly targetId: string;
  readonly targetName?: string;
  readonly targetKind: "object" | "camera" | "missing";
  readonly channel: CreationAnimationTrack["channel"];
  readonly keyframeCount: number;
  readonly firstTime?: number;
  readonly lastTime?: number;
  readonly rendered: boolean;
  readonly valueType?: "number" | "string" | "vec3";
}

export interface CreationWorkspaceAnimationSummary {
  readonly clipId: string;
  readonly name: string;
  readonly duration: number;
  readonly trackCount: number;
  readonly keyframeCount: number;
  readonly firstTime?: number;
  readonly lastTime?: number;
  readonly objectTrackCount: number;
  readonly cameraTrackCount: number;
  readonly renderedTrackCount: number;
  readonly tracks: readonly CreationWorkspaceAnimationTrackSummary[];
}

export interface CreationWorkspaceRigSummary {
  readonly rigId: string;
  readonly name: string;
  readonly style?: string;
  readonly partCount: number;
  readonly renderedPartCount: number;
  readonly animatedTrackCount: number;
  readonly bones: readonly string[];
}

export interface CreationWorkspaceSceneSummary {
  readonly sceneId: string;
  readonly name: string;
  readonly active: boolean;
  readonly objectCount: number;
  readonly cameraCount: number;
  readonly lightCount: number;
  readonly animationCount: number;
  readonly renderStatus: CreationRenderStatus;
  readonly compositionId?: string;
  readonly layerId?: string;
  readonly boundObjectCount: number;
  readonly dirtyAssetCount: number;
  readonly missingAssetCount: number;
  readonly unassignedMaterialCount: number;
  readonly issues: readonly CreationWorkspaceIssue[];
  readonly cameras: readonly CreationWorkspaceCameraSummary[];
  readonly objects: readonly CreationWorkspaceObjectSummary[];
  readonly animations: readonly CreationWorkspaceAnimationSummary[];
  readonly rigs: readonly CreationWorkspaceRigSummary[];
}

export interface CreationWorkspaceSummary {
  readonly available: boolean;
  readonly assetCount: number;
  readonly sceneCount: number;
  readonly activeSceneId?: string;
  readonly scenes: readonly CreationWorkspaceSceneSummary[];
  readonly recoverableScene3DLayers: readonly RecoverableScene3DLayerSummary[];
}

export function summarizeCreationWorkspace(
  creation: CreationProjectState | undefined,
  motionCompositions: readonly MotionComposition[],
): CreationWorkspaceSummary {
  const recoverableScene3DLayers = findRecoverableScene3DLayers(
    creation,
    motionCompositions,
  );

  if (!creation) {
    return {
      available: false,
      assetCount: 0,
      sceneCount: 0,
      scenes: [],
      recoverableScene3DLayers,
    };
  }

  const assetsById = new Map(creation.assets.map((asset) => [asset.id, asset]));
  const compositionsById = new Map(motionCompositions.map((item) => [item.id, item]));
  const scenes = creation.scenes.map((scene) =>
    summarizeCreationScene(scene, {
      activeSceneId: creation.activeSceneId,
      assetsById,
      compositionsById,
    }),
  );

  return {
    available: true,
    assetCount: creation.assets.length,
    sceneCount: creation.scenes.length,
    activeSceneId: creation.activeSceneId,
    scenes,
    recoverableScene3DLayers,
  };
}

function summarizeCreationScene(
  scene: CreationScene,
  context: {
    readonly activeSceneId?: string;
    readonly assetsById: Map<string, CreationProjectState["assets"][number]>;
    readonly compositionsById: Map<string, MotionComposition>;
  },
): CreationWorkspaceSceneSummary {
  const issues: CreationWorkspaceIssue[] = [];
  const pushIssue = (
    severity: CreationWorkspaceIssue["severity"],
    code: string,
    message: string,
  ): void => {
    issues.push({ severity, code, message });
  };

  const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
  const composition = binding ? context.compositionsById.get(binding.compositionId) : undefined;
  const layer = composition?.layers.find((candidate) => candidate.id === binding?.layerId);
  const boundObjectIds = new Set(binding?.objectBindings.map((item) => item.sceneObjectId) ?? []);
  const renderStatus = getRenderStatus(scene, binding, composition, layer);

  const objects = scene.objects.map((object) =>
    summarizeCreationObject(object, context.assetsById, boundObjectIds),
  );
  const cameras = scene.cameras.map((camera) =>
    summarizeCreationCamera(camera, scene.activeCameraId),
  );
  const animations = summarizeCreationAnimations(
    scene,
    objects,
    cameras,
    boundObjectIds,
    renderStatus,
  );
  const rigs = summarizeCreationRigs(
    scene,
    context.assetsById,
    animations,
    boundObjectIds,
  );
  const missingAssetCount = objects.filter((object) => object.missingAsset).length;
  const unassignedMaterialCount = objects.filter((object) => !object.materialId).length;
  const dirtyAssetCount = new Set(
    scene.objects
      .map((object) => context.assetsById.get(object.assetId))
      .filter((asset) =>
        asset?.caches.some(
          (cache) =>
            (cache.kind === "preview-mesh" || cache.kind === "final-mesh") &&
            cache.status === "dirty",
        ),
      )
      .map((asset) => asset?.id),
  ).size;
  const unsyncedAnimationTrackCount = animations.reduce(
    (total, clip) =>
      total +
      clip.tracks.filter(
        (track) => track.targetKind !== "missing" && !track.rendered,
      ).length,
    0,
  );

  if (scene.objects.length === 0) {
    pushIssue("error", "EMPTY_SCENE", "Scene has no objects");
  }
  if (missingAssetCount > 0) {
    pushIssue("error", "MISSING_ASSET", `${missingAssetCount} object(s) reference missing assets`);
  }
  if (unassignedMaterialCount > 0) {
    pushIssue("warning", "NO_MATERIAL", `${unassignedMaterialCount} object(s) have no material`);
  }
  if (scene.cameras.length === 0) {
    pushIssue("warning", "NO_CAMERA", "Scene has no camera");
  }
  if (scene.lights.length === 0) {
    pushIssue("info", "NO_LIGHTS", "Scene is using renderer default lighting");
  }
  if (dirtyAssetCount > 0) {
    pushIssue("info", "DIRTY_MESH_CACHE", `${dirtyAssetCount} asset(s) need mesh baking`);
  }

  if (renderStatus === "unbound") {
    pushIssue("warning", "NO_RENDER_BINDING", "Scene is not bound to a Motion scene3d layer");
  } else if (renderStatus === "missing-composition") {
    pushIssue("error", "MISSING_COMPOSITION", "Bound Motion composition is missing");
  } else if (renderStatus === "missing-layer") {
    pushIssue("error", "MISSING_SCENE3D_LAYER", "Bound scene3d layer is missing");
  } else if (renderStatus === "partial") {
    pushIssue(
      "warning",
      "PARTIAL_RENDER_BINDING",
      `${binding?.objectBindings.length ?? 0}/${scene.objects.length} object(s) are render-bound`,
    );
  }
  if (unsyncedAnimationTrackCount > 0) {
    pushIssue(
      "warning",
      "UNSYNCED_ANIMATION_TRACK",
      `${unsyncedAnimationTrackCount} animation track(s) are not render-bound`,
    );
  }

  return {
    sceneId: scene.id,
    name: scene.name,
    active: scene.id === context.activeSceneId,
    objectCount: scene.objects.length,
    cameraCount: scene.cameras.length,
    lightCount: scene.lights.length,
    animationCount: scene.animations.length,
    renderStatus,
    compositionId: binding?.compositionId,
    layerId: binding?.layerId,
    boundObjectCount: binding?.objectBindings.length ?? 0,
    dirtyAssetCount,
    missingAssetCount,
    unassignedMaterialCount,
    issues,
    cameras,
    objects,
    animations,
    rigs,
  };
}

function summarizeCreationCamera(
  camera: CreationCamera,
  activeCameraId: string | undefined,
): CreationWorkspaceCameraSummary {
  return {
    cameraId: camera.id,
    name: camera.name,
    active: camera.id === activeCameraId,
    position: camera.position,
    target: camera.target,
    fov: camera.fov,
    focusDistance: camera.focusDistance,
    depthOfField: camera.depthOfField,
  };
}

function summarizeCreationObject(
  object: CreationSceneObject,
  assetsById: Map<string, CreationProjectState["assets"][number]>,
  boundObjectIds: ReadonlySet<string>,
): CreationWorkspaceObjectSummary {
  return {
    objectId: object.id,
    name: object.name,
    assetId: object.assetId,
    materialId: object.materialId,
    partId: object.partId,
    transform: object.transform,
    material: object.materialId
      ? (() => {
          const material = assetsById
            .get(object.assetId)
            ?.materials.find((candidate) => candidate.id === object.materialId);
          return material
            ? {
                baseColor: material.baseColor,
                metallic: material.metallic,
                roughness: material.roughness,
                opacity: material.opacity,
              }
            : undefined;
        })()
      : undefined,
    rendered: boundObjectIds.has(object.id),
    missingAsset: !assetsById.has(object.assetId),
    tags: object.tags,
  };
}

function summarizeCreationAnimations(
  scene: CreationScene,
  objects: readonly CreationWorkspaceObjectSummary[],
  cameras: readonly CreationWorkspaceCameraSummary[],
  boundObjectIds: ReadonlySet<string>,
  renderStatus: CreationRenderStatus,
): readonly CreationWorkspaceAnimationSummary[] {
  const objectsById = new Map(objects.map((object) => [object.objectId, object]));
  const camerasById = new Map(cameras.map((camera) => [camera.cameraId, camera]));
  const hasRenderableLayer = renderStatus === "ready" || renderStatus === "partial";

  return scene.animations.map((clip) => {
    const tracks = clip.tracks.map((track): CreationWorkspaceAnimationTrackSummary => {
      const keyframeTimes = track.keyframes.map((keyframe) => keyframe.time);
      const firstTime = keyframeTimes.length > 0 ? Math.min(...keyframeTimes) : undefined;
      const lastTime = keyframeTimes.length > 0 ? Math.max(...keyframeTimes) : undefined;
      const firstValue = track.keyframes[0]?.value;
      const object = objectsById.get(track.targetId);
      const camera = camerasById.get(track.targetId);
      const targetKind =
        track.channel.startsWith("camera.") || camera
          ? camera
            ? "camera"
            : "missing"
          : object
            ? "object"
            : "missing";
      const rendered =
        targetKind === "object"
          ? boundObjectIds.has(track.targetId)
          : targetKind === "camera"
            ? hasRenderableLayer
            : false;

      return {
        trackId: track.id,
        targetId: track.targetId,
        targetName: object?.name ?? camera?.name,
        targetKind,
        channel: track.channel,
        keyframeCount: track.keyframes.length,
        firstTime,
        lastTime,
        rendered,
        valueType: animationValueType(firstValue),
      };
    });

    const keyframeTimes = tracks.flatMap((track) =>
      [track.firstTime, track.lastTime].filter(
        (time): time is number => time !== undefined,
      ),
    );

    return {
      clipId: clip.id,
      name: clip.name,
      duration: clip.duration,
      trackCount: tracks.length,
      keyframeCount: tracks.reduce((total, track) => total + track.keyframeCount, 0),
      firstTime: keyframeTimes.length > 0 ? Math.min(...keyframeTimes) : undefined,
      lastTime: keyframeTimes.length > 0 ? Math.max(...keyframeTimes) : undefined,
      objectTrackCount: tracks.filter((track) => track.targetKind === "object").length,
      cameraTrackCount: tracks.filter((track) => track.targetKind === "camera").length,
      renderedTrackCount: tracks.filter((track) => track.rendered).length,
      tracks,
    };
  });
}

function summarizeCreationRigs(
  scene: CreationScene,
  assetsById: Map<string, CreationProjectState["assets"][number]>,
  animations: readonly CreationWorkspaceAnimationSummary[],
  boundObjectIds: ReadonlySet<string>,
): readonly CreationWorkspaceRigSummary[] {
  const animatedTrackCounts = new Map<string, number>();
  for (const clip of animations) {
    for (const track of clip.tracks) {
      if (track.targetKind !== "object") continue;
      animatedTrackCounts.set(
        track.targetId,
        (animatedTrackCounts.get(track.targetId) ?? 0) + 1,
      );
    }
  }

  const rigs = new Map<
    string,
    {
      readonly rigId: string;
      name: string;
      style?: string;
      partCount: number;
      renderedPartCount: number;
      animatedTrackCount: number;
      bones: Set<string>;
    }
  >();

  for (const object of scene.objects) {
    const asset = assetsById.get(object.assetId);
    if (!asset || (asset.kind !== "character" && !object.tags.includes("character"))) {
      continue;
    }
    const character = recordValue(asset.parameters.character);
    const rigId =
      stringValue(asset.parameters.characterId) ??
      stringValue(character?.characterId) ??
      object.tags.find((tag) => tag.startsWith("character-")) ??
      object.parentId ??
      object.id;
    const style =
      stringValue(asset.parameters.characterStyle) ??
      stringValue(character?.style);
    const bone =
      stringValue(asset.parameters.characterBone) ??
      stringValue(character?.bone) ??
      object.tags.find((tag) => tag.includes("."));
    const rig =
      rigs.get(rigId) ??
      {
        rigId,
        name: style ? `${style} character` : rigId,
        style,
        partCount: 0,
        renderedPartCount: 0,
        animatedTrackCount: 0,
        bones: new Set<string>(),
      };
    rig.partCount += 1;
    if (boundObjectIds.has(object.id)) rig.renderedPartCount += 1;
    rig.animatedTrackCount += animatedTrackCounts.get(object.id) ?? 0;
    if (bone) rig.bones.add(bone);
    rigs.set(rigId, rig);
  }

  return [...rigs.values()].map((rig) => ({
    rigId: rig.rigId,
    name: rig.name,
    style: rig.style,
    partCount: rig.partCount,
    renderedPartCount: rig.renderedPartCount,
    animatedTrackCount: rig.animatedTrackCount,
    bones: [...rig.bones].sort(),
  }));
}

function animationValueType(
  value: CreationAnimationTrack["keyframes"][number]["value"] | undefined,
): CreationWorkspaceAnimationTrackSummary["valueType"] {
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (
    value &&
    typeof value === "object" &&
    "x" in value &&
    "y" in value &&
    "z" in value
  ) {
    return "vec3";
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getRenderStatus(
  scene: CreationScene,
  binding: CreationScene["renderBindings"][number] | undefined,
  composition: MotionComposition | undefined,
  layer: MotionComposition["layers"][number] | undefined,
): CreationRenderStatus {
  if (!binding) return "unbound";
  if (!composition) return "missing-composition";
  if (!layer || layer.type !== "scene3d") return "missing-layer";
  return binding.objectBindings.length >= scene.objects.length ? "ready" : "partial";
}
