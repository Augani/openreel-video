import {
  createPhoneProductCinematicScene,
  validateCreationScene,
  type AnimationClip as GeneratedAnimationClip,
  type AssetRecipe as GeneratedAssetRecipe,
  type CreationScene as GeneratedCreationScene,
  type MaterialRecipe,
  type ProductPart,
  type ProductPartRole,
  type SceneObject as GeneratedSceneObject,
} from "@openreel/creation-schema";
import { createMotionScene3DLayer } from "@openreel/core/motion/motion-scene3d";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionLayer,
  type MotionMaterial3D,
  type MotionObject3DKind,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
  type MotionTextLayer,
} from "@openreel/core/motion/types";
import type { Keyframe } from "@openreel/core/types/timeline";
import type {
  CreationAnimationClip,
  CreationAnimationKeyframe,
  CreationAnimationTrack,
  CreationAssetDependency,
  CreationAssetRecipe,
  CreationCacheRef,
  CreationLight,
  CreationMaterial,
  CreationOperation,
  CreationParameters,
  CreationRecipeNode,
  CreationScene,
  CreationSceneObject,
} from "@openreel/core/creation/schema/types";

export interface CreateProductCinematicMotionOptions {
  readonly compositionId: string;
  readonly layerId: string;
  readonly keyframeId: () => string;
  readonly operationId?: () => string;
  readonly sceneId?: string;
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly duration: number;
  readonly style?: string;
  readonly seed?: number;
  readonly includeInternals?: boolean;
  readonly includeCallouts?: boolean;
}

export interface ProductCinematicMotionResult {
  readonly creationScene: GeneratedCreationScene;
  readonly coreCreationAsset: CreationAssetRecipe;
  readonly coreCreationScene: CreationScene;
  readonly creationOperations: readonly CreationOperation[];
  readonly composition: MotionComposition;
  readonly layer: MotionScene3DLayer;
  readonly objectIdsByPartId: Record<string, string>;
  readonly calloutLayerIds: readonly string[];
}

const ROLE_GEOMETRY: Record<ProductPartRole, MotionObject3DKind> = {
  shell: "rounded-box",
  screen: "rounded-box",
  lens: "cylinder",
  "camera-module": "rounded-box",
  board: "rounded-box",
  battery: "rounded-box",
  chip: "rounded-box",
  thermal: "plane",
  screw: "cylinder",
  connector: "rounded-box",
  decorative: "box",
  callout: "text3d",
};

const ROLE_SIZE: Record<ProductPartRole, number> = {
  shell: 1.8,
  screen: 1.68,
  lens: 0.42,
  "camera-module": 0.72,
  board: 0.86,
  battery: 1,
  chip: 0.38,
  thermal: 1.18,
  screw: 0.12,
  connector: 0.58,
  decorative: 0.3,
  callout: 0.24,
};

function materialFor(material: MaterialRecipe | undefined): MotionMaterial3D {
  if (!material) return { kind: "physical", color: "#cbd5e1", roughness: 0.42 };
  return {
    kind: material.kind === "screen" || material.kind === "emissive" ? "basic" : "physical",
    color: material.baseColor,
    metalness: material.metallic,
    roughness: material.roughness,
    opacity: material.opacity,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
  };
}

function objectForPart(
  part: ProductPart,
  material: MaterialRecipe | undefined,
): MotionSceneObject3D {
  const kind = ROLE_GEOMETRY[part.role] ?? "box";
  const size = ROLE_SIZE[part.role] ?? 0.5;
  const depth =
    part.role === "screen" || part.role === "thermal"
      ? 0.035
      : part.role === "lens"
        ? 0.18
        : part.role === "shell"
          ? 0.11
          : 0.08;
  return {
    id: `obj-${part.id}`,
    name: part.name,
    object: {
      kind,
      size,
      depth,
      aspect: part.role === "screen" || part.role === "shell" ? 1.92 : undefined,
      cornerRadius: part.role === "screen" || part.role === "shell" ? 0.14 : 0.04,
      extrude: part.role === "callout" ? 0.06 : undefined,
      text: part.role === "callout" ? part.name : undefined,
    },
    material: materialFor(material),
    transform3d: {
      position: part.transform.position,
      rotation: part.transform.rotation,
      scale: part.transform.scale,
    },
    opacity: material?.opacity,
  };
}

function sceneObjectKeyframes(
  part: ProductPart,
  keyframeId: () => string,
  duration: number,
  index: number,
): Keyframe[] {
  const start = 0.9 + index * 0.035;
  const end = Math.min(duration - 1.2, start + 1.15);
  const target = part.explodedTransform?.position ?? part.transform.position;
  return [
    { id: keyframeId(), time: 0, property: `scene.object.obj-${part.id}.position.x`, value: part.transform.position.x, easing: "ease" },
    { id: keyframeId(), time: 0, property: `scene.object.obj-${part.id}.position.y`, value: part.transform.position.y, easing: "ease" },
    { id: keyframeId(), time: 0, property: `scene.object.obj-${part.id}.position.z`, value: part.transform.position.z, easing: "ease" },
    { id: keyframeId(), time: start, property: `scene.object.obj-${part.id}.position.x`, value: part.transform.position.x, easing: "ease-in-out" },
    { id: keyframeId(), time: start, property: `scene.object.obj-${part.id}.position.y`, value: part.transform.position.y, easing: "ease-in-out" },
    { id: keyframeId(), time: start, property: `scene.object.obj-${part.id}.position.z`, value: part.transform.position.z, easing: "ease-in-out" },
    { id: keyframeId(), time: end, property: `scene.object.obj-${part.id}.position.x`, value: target.x, easing: "ease-out" },
    { id: keyframeId(), time: end, property: `scene.object.obj-${part.id}.position.y`, value: target.y, easing: "ease-out" },
    { id: keyframeId(), time: end, property: `scene.object.obj-${part.id}.position.z`, value: target.z, easing: "ease-out" },
    { id: keyframeId(), time: duration - 0.7, property: `scene.object.obj-${part.id}.position.x`, value: part.transform.position.x, easing: "ease-in-out" },
    { id: keyframeId(), time: duration - 0.7, property: `scene.object.obj-${part.id}.position.y`, value: part.transform.position.y, easing: "ease-in-out" },
    { id: keyframeId(), time: duration - 0.7, property: `scene.object.obj-${part.id}.position.z`, value: part.transform.position.z, easing: "ease-in-out" },
  ];
}

function cameraKeyframes(scene: GeneratedCreationScene, keyframeId: () => string): Keyframe[] {
  const cameraClip = scene.animations.find((clip) => clip.id === "anim-camera-orbit");
  const tracks = cameraClip?.tracks ?? [];
  const out: Keyframe[] = [];
  for (const track of tracks) {
    const propertyPrefix =
      track.channel === "position"
        ? "scene.camera.position"
        : track.channel === "camera.fov"
          ? "scene.camera.fov"
          : null;
    if (!propertyPrefix) continue;
    for (const keyframe of track.keyframes) {
      if (track.channel === "position" && typeof keyframe.value === "object") {
        const value = keyframe.value as { x: number; y: number; z: number };
        out.push(
          { id: keyframeId(), time: keyframe.time, property: `${propertyPrefix}.x`, value: value.x, easing: keyframe.easing ?? "ease" },
          { id: keyframeId(), time: keyframe.time, property: `${propertyPrefix}.y`, value: value.y, easing: keyframe.easing ?? "ease" },
          { id: keyframeId(), time: keyframe.time, property: `${propertyPrefix}.z`, value: value.z, easing: keyframe.easing ?? "ease" },
        );
      }
      if (track.channel === "camera.fov" && typeof keyframe.value === "number") {
        out.push({
          id: keyframeId(),
          time: keyframe.time,
          property: propertyPrefix,
          value: keyframe.value,
          easing: keyframe.easing ?? "ease",
        });
      }
    }
  }
  return out;
}

function toCreationParameters(parameters: Record<string, unknown> | undefined): CreationParameters {
  return { ...(parameters ?? {}) } as CreationParameters;
}

function toCoreMaterial(material: MaterialRecipe): CreationMaterial {
  return {
    id: material.id,
    name: material.name,
    model: material.kind,
    baseColor: material.baseColor,
    metallic: material.metallic,
    roughness: material.roughness,
    opacity: material.opacity,
    transmission: material.transmission,
    clearcoat: material.clearcoat,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    parameters: material.procedural
      ? { procedural: [...material.procedural] }
      : undefined,
  };
}

function toCoreCacheKind(kind: string): CreationCacheRef["kind"] {
  if (kind === "mesh") return "final-mesh";
  if (kind === "texture") return "texture-atlas";
  if (
    kind === "preview-mesh" ||
    kind === "final-mesh" ||
    kind === "collision-mesh" ||
    kind === "texture-atlas" ||
    kind === "animation" ||
    kind === "thumbnail" ||
    kind === "render-preview"
  ) {
    return kind;
  }
  return "final-mesh";
}

function toCoreAssetRecipe(asset: GeneratedAssetRecipe, now: number): CreationAssetRecipe {
  const outputCaches: CreationCacheRef[] = asset.outputs.map((output) => ({
    id: `cache-${output.id}`,
    kind: toCoreCacheKind(output.kind),
    status: "dirty",
    generatorVersion: "creation-schema/product-cinematic-v1",
  }));
  const bakedCaches: CreationCacheRef[] = asset.bakedCaches.map((cache) => ({
    id: cache.id,
    kind: toCoreCacheKind(cache.kind),
    status: "ready",
    uri: cache.uri,
    generatedAt: cache.generatedAt,
    generatorVersion: "creation-schema/product-cinematic-v1",
  }));

  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    seed: asset.seed,
    parameters: toCreationParameters(asset.parameters),
    nodes: asset.nodes.map(
      (node): CreationRecipeNode => ({
        id: node.id,
        type: node.type,
        name: node.name,
        inputs: node.inputs ?? [],
        parameters: toCreationParameters(node.parameters),
      }),
    ),
    materials: asset.materials.map(toCoreMaterial),
    dependencies: asset.dependencies.map(
      (dependency): CreationAssetDependency => ({
        id: dependency.id,
        kind: dependency.kind,
        uri: dependency.uri,
        required: dependency.required,
      }),
    ),
    caches: [...outputCaches, ...bakedCaches],
    createdAt: now,
    modifiedAt: now,
  };
}

function toCoreSceneObject(object: GeneratedSceneObject): CreationSceneObject {
  return {
    id: object.id,
    name: object.name,
    assetId: object.assetId,
    transform: object.transform,
    visible: object.visible,
    selectable: true,
    tags: ["assembly"],
  };
}

function toCorePartObject(
  part: ProductPart,
  assetId: string,
  parentId: string | undefined,
): CreationSceneObject {
  return {
    id: `object-${part.id}`,
    name: part.name,
    assetId,
    materialId: part.materialId,
    partId: part.id,
    parentId,
    transform: part.transform,
    visible: part.visible ?? true,
    selectable: true,
    tags: ["product-part", part.role],
  };
}

function mapCoreAnimationTarget(
  targetId: string,
  partObjectIds: ReadonlyMap<string, string>,
): string {
  return partObjectIds.get(targetId) ?? targetId;
}

function toCoreAnimationKeyframe<T extends number | string | { x: number; y: number; z: number }>(
  keyframe: { readonly time: number; readonly value: T; readonly easing?: CreationAnimationKeyframe<T>["easing"] },
): CreationAnimationKeyframe<T> {
  return {
    time: keyframe.time,
    value: keyframe.value,
    easing: keyframe.easing ?? "ease",
  };
}

function toCoreAnimationClip(
  clip: GeneratedAnimationClip,
  cameraIds: ReadonlySet<string>,
  partObjectIds: ReadonlyMap<string, string>,
): CreationAnimationClip {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map((track): CreationAnimationTrack => {
      const cameraTarget = cameraIds.has(track.targetId);
      const channel =
        cameraTarget && track.channel === "position"
          ? "camera.position"
          : track.channel;
      return {
        id: track.id,
        targetId: mapCoreAnimationTarget(track.targetId, partObjectIds),
        channel: channel as CreationAnimationTrack["channel"],
        keyframes: track.keyframes.map((keyframe) =>
          toCoreAnimationKeyframe(
            keyframe as {
              readonly time: number;
              readonly value: number | string | { x: number; y: number; z: number };
              readonly easing?: CreationAnimationKeyframe["easing"];
            },
          ),
        ),
      };
    }),
  };
}

function toCoreCreationScene(
  scene: GeneratedCreationScene,
  asset: GeneratedAssetRecipe,
  binding: {
    readonly compositionId: string;
    readonly layerId: string;
    readonly calloutLayerIds: readonly string[];
  },
  now: number,
): CreationScene {
  const assemblyObjects = scene.objects.map(toCoreSceneObject);
  const parentId = assemblyObjects[0]?.id;
  const parts = asset.productParts ?? [];
  const partObjectIds = new Map(parts.map((part) => [part.id, `object-${part.id}`]));
  const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
  return {
    id: scene.id,
    name: scene.name,
    duration: scene.duration,
    frameRate: scene.frameRate,
    objects: [
      ...assemblyObjects,
      ...parts.map((part) => toCorePartObject(part, asset.id, parentId)),
    ],
    cameras: scene.cameras,
    activeCameraId: scene.activeCameraId,
    lights: scene.lights.map(
      (light): CreationLight => ({
        id: light.id,
        name: light.name,
        kind: light.kind,
        color: light.color,
        intensity: light.intensity,
        position: light.position,
        target: light.target,
        size: light.size,
      }),
    ),
    animations: scene.animations.map((clip) =>
      toCoreAnimationClip(clip, cameraIds, partObjectIds),
    ),
    environment: {
      kind: "studio",
      backgroundColor: "#f5f7fb",
      groundEnabled: true,
      groundColor: "#e5e7eb",
    },
    renderBindings: [
      {
        id: `binding-${scene.id}-${binding.compositionId}`,
        kind: "motion-scene3d",
        compositionId: binding.compositionId,
        layerId: binding.layerId,
        objectBindings: parts.map((part) => ({
          sceneObjectId: `object-${part.id}`,
          renderObjectId: `obj-${part.id}`,
        })),
        calloutLayerIds: binding.calloutLayerIds,
        createdAt: now,
        modifiedAt: now,
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

function createCoreCreationOperations(
  asset: CreationAssetRecipe,
  scene: CreationScene,
  operationId: () => string,
  now: number,
): CreationOperation[] {
  return [
    {
      id: operationId(),
      type: "asset/upsert",
      timestamp: now,
      source: "agent",
      label: `Create ${asset.name}`,
      asset,
    },
    {
      id: operationId(),
      type: "scene/upsert",
      timestamp: now,
      source: "agent",
      label: `Create ${scene.name}`,
      scene,
    },
    {
      id: operationId(),
      type: "scene/set-active",
      timestamp: now,
      source: "agent",
      label: `Activate ${scene.name}`,
      sceneId: scene.id,
    },
  ];
}

function createCalloutLayers(
  scene: GeneratedCreationScene,
  keyframeId: () => string,
  width: number,
  height: number,
): MotionTextLayer[] {
  return scene.callouts.map((callout, index) => {
    const id = `layer-${callout.id}`;
    const x = width / 2 + callout.screenOffset.x;
    const y = height / 2 + callout.screenOffset.y;
    const revealIn = Math.max(0, callout.revealTime - 0.16);
    return {
      id,
      type: "text",
      name: callout.label,
      startTime: 0,
      duration: scene.duration,
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x, y },
        scale: { x: 0.98, y: 0.98 },
        opacity: 0,
      },
      keyframes: [
        { id: keyframeId(), time: 0, property: "transform.opacity", value: 0, easing: "linear" },
        { id: keyframeId(), time: revealIn, property: "transform.opacity", value: 0, easing: "ease-out" },
        { id: keyframeId(), time: callout.revealTime, property: "transform.opacity", value: 1, easing: "ease-out" },
        { id: keyframeId(), time: Math.max(callout.revealTime, scene.duration - 0.55), property: "transform.opacity", value: 1, easing: "ease-in" },
        { id: keyframeId(), time: scene.duration, property: "transform.opacity", value: 0, easing: "ease-in" },
        { id: keyframeId(), time: revealIn, property: "transform.position.y", value: y + 18, easing: "ease-out" },
        { id: keyframeId(), time: callout.revealTime, property: "transform.position.y", value: y, easing: "ease-out" },
      ],
      text: callout.label,
      style: {
        fontFamily: "Inter",
        fontSize: Math.max(22, Math.min(34, width * 0.017)),
        fontWeight: 760,
        color: "#0f172a",
        align: index % 2 === 0 ? "left" : "right",
        lineHeight: 1.05,
        maxWidth: Math.min(360, width * 0.22),
        verticalAlign: "middle",
        backgroundColor: "rgba(255,255,255,0.86)",
        backgroundPadding: 14,
        backgroundRadius: 18,
        shadow: {
          color: "#64748b",
          blur: 18,
          offsetX: 0,
          offsetY: 8,
          spread: 0,
        },
      },
    };
  });
}

export function createProductCinematicMotionComposition(
  options: CreateProductCinematicMotionOptions,
): ProductCinematicMotionResult {
  const creationScene = createPhoneProductCinematicScene({
    id: options.sceneId,
    name: options.name,
    duration: options.duration,
    frameRate: options.frameRate,
    style: options.style,
    seed: options.seed,
    includeInternals: options.includeInternals,
    includeCallouts: options.includeCallouts,
  });
  const issues = validateCreationScene(creationScene);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join("; "));
  }

  const asset = creationScene.assets[0];
  if (!asset?.productParts) throw new Error("Product cinematic scene has no product asset");
  const materialsById = new Map(asset.materials.map((material) => [material.id, material]));
  const objects = asset.productParts.map((part) =>
    objectForPart(part, materialsById.get(part.materialId)),
  );
  const keyframes = [
    ...asset.productParts.flatMap((part, index) =>
      sceneObjectKeyframes(part, options.keyframeId, creationScene.duration, index),
    ),
    ...cameraKeyframes(creationScene, options.keyframeId),
  ];

  const camera = creationScene.cameras.find((candidate) => candidate.id === creationScene.activeCameraId);
  const layer = {
    ...createMotionScene3DLayer({
      id: options.layerId,
      name: "Editable product cinematic scene",
      duration: creationScene.duration,
      compositionWidth: options.width,
      compositionHeight: options.height,
      object: { kind: "box" },
      objects,
      camera: camera
        ? { position: camera.position, target: camera.target, fov: camera.fov, near: 0.05, far: 120 }
        : undefined,
      lighting: { environment: "studio", groundShadow: true, ambient: 0.45, keyIntensity: 2.8, rimIntensity: 1.4 },
      room: { enabled: true, size: 12, wallColor: "#f8fafc", floorColor: "#e5e7eb" },
      width: options.width,
      height: options.height,
    }),
    keyframes,
  };
  const calloutLayers = createCalloutLayers(
    creationScene,
    options.keyframeId,
    options.width,
    options.height,
  );
  const layers: MotionLayer[] = [layer, ...calloutLayers];

  const now = Date.now();
  const operationId = options.operationId ?? options.keyframeId;
  const coreCreationAsset = toCoreAssetRecipe(asset, now);
  const coreCreationScene = toCoreCreationScene(
    creationScene,
    asset,
    {
      compositionId: options.compositionId,
      layerId: options.layerId,
      calloutLayerIds: calloutLayers.map((calloutLayer) => calloutLayer.id),
    },
    now,
  );
  const creationOperations = createCoreCreationOperations(
    coreCreationAsset,
    coreCreationScene,
    operationId,
    now,
  );
  const composition: MotionComposition = {
    id: options.compositionId,
    name: options.name ?? creationScene.name,
    width: options.width,
    height: options.height,
    frameRate: options.frameRate,
    duration: creationScene.duration,
    backgroundColor: "#f5f7fb",
    layers,
    assets: [],
    variables: [],
    markers: [],
    guides: [],
    createdAt: now,
    modifiedAt: now,
  };

  return {
    creationScene,
    coreCreationAsset,
    coreCreationScene,
    creationOperations,
    composition,
    layer,
    objectIdsByPartId: Object.fromEntries(asset.productParts.map((part) => [part.id, `obj-${part.id}`])),
    calloutLayerIds: calloutLayers.map((calloutLayer) => calloutLayer.id),
  };
}
