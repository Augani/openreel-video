import type { Project, MotionComposition } from "@openreel/core";
import type {
  MotionMaterial3D,
  MotionObject3DKind,
  MotionScene3DLayer,
  MotionSceneObject3D,
} from "@openreel/core/motion/types";
import type {
  CreationAssetKind,
  CreationAssetRecipe,
  CreationLight,
  CreationMaterial,
  CreationOperation,
  CreationParameters,
  CreationProjectState,
  CreationScene,
  CreationSceneEnvironment,
  CreationSceneObject,
  Transform3D,
} from "@openreel/core/creation/index";

export interface RecoverableScene3DLayerSummary {
  readonly compositionId: string;
  readonly compositionName: string;
  readonly layerId: string;
  readonly layerName: string;
  readonly objectCount: number;
  readonly duration: number;
}

export interface MotionScene3DRecoveryPlan {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly operations: readonly CreationOperation[];
  readonly modifiedAt: number;
}

interface DraftEntry {
  readonly objectKey: string;
  readonly asset: CreationAssetRecipe;
  readonly sceneObject: CreationSceneObject;
  readonly renderObjectId: string;
}

interface RecoveryDraft {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
}

export function findRecoverableScene3DLayers(
  creation: CreationProjectState | undefined,
  motionCompositions: readonly MotionComposition[],
): readonly RecoverableScene3DLayerSummary[] {
  const summaries: RecoverableScene3DLayerSummary[] = [];
  for (const composition of motionCompositions) {
    for (const layer of composition.layers) {
      if (layer.type !== "scene3d") continue;
      if (!layer.objects || layer.objects.length === 0) continue;
      if (hasCreationBinding(creation, composition.id, layer.id)) continue;
      summaries.push({
        compositionId: composition.id,
        compositionName: composition.name,
        layerId: layer.id,
        layerName: layer.name,
        objectCount: layer.objects.length,
        duration: layer.duration,
      });
    }
  }
  return summaries;
}

export function planRecoverMotionScene3DLayer(
  project: Project,
  compositionId: string,
  layerId: string,
  now = Date.now(),
): MotionScene3DRecoveryPlan | { readonly error: string } {
  const composition = (project.motionCompositions ?? []).find(
    (candidate) => candidate.id === compositionId,
  );
  if (!composition) return { error: `Motion composition not found: ${compositionId}` };

  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== "scene3d") {
    return { error: `Motion scene3d layer not found: ${layerId}` };
  }
  if (!layer.objects || layer.objects.length === 0) {
    return { error: "Scene3D layer has no recoverable scene objects" };
  }
  if (hasCreationBinding(project.creation, composition.id, layer.id)) {
    return { error: "Scene3D layer is already bound to a Creation scene" };
  }

  const draft = buildRecoveredCreationScene(composition, layer, now);
  const scene = draft.scene;
  const assets = draft.assets;
  const operations: CreationOperation[] = [
    ...assets.map((asset): CreationOperation => ({
      id: `ui-recover-asset-${now}-${asset.id}`,
      type: "asset/upsert",
      timestamp: now,
      source: "user",
      label: `Recover ${asset.name}`,
      asset,
    })),
    {
      id: `ui-recover-scene-${now}-${scene.id}`,
      type: "scene/upsert",
      timestamp: now,
      source: "user",
      label: `Recover ${scene.name}`,
      scene,
    },
    {
      id: `ui-recover-active-${now}-${scene.id}`,
      type: "scene/set-active",
      timestamp: now,
      source: "user",
      label: `Activate ${scene.name}`,
      sceneId: scene.id,
    },
  ];

  return { scene, assets, operations, modifiedAt: now };
}

function buildRecoveredCreationScene(
  composition: MotionComposition,
  layer: MotionScene3DLayer,
  now: number,
): RecoveryDraft {
  const sceneId = `scene-${idSegment(layer.name, "motion-3d")}-${idSegment(layer.id, "layer")}`;
  const sceneKey = idSegment(sceneId, "scene");
  const usedObjectKeys = new Set<string>();
  const entries = layer.objects!.map((object, index) =>
    buildDraftEntry({
      sceneKey,
      objectKey: uniqueIdSegment(object.name ?? object.id, `object-${index + 1}`, usedObjectKeys),
      motionObject: object,
      now,
    }),
  );
  const objectBindings = entries.map((entry) => ({
    sceneObjectId: entry.sceneObject.id,
    renderObjectId: entry.renderObjectId,
  }));
  const scene: CreationScene = {
    id: sceneId,
    name: layer.name || composition.name || "Recovered 3D Scene",
    duration: layer.duration || composition.duration,
    frameRate: composition.frameRate,
    objects: entries.map((entry) => entry.sceneObject),
    cameras: [
      {
        id: "camera-hero",
        name: "Hero camera",
        position: layer.camera?.position ?? { x: 0, y: 3, z: 12 },
        target: layer.camera?.target ?? { x: 0, y: 0, z: 0 },
        fov: layer.camera?.fov ?? layer.fov ?? 35,
      },
    ],
    activeCameraId: "camera-hero",
    lights: lightsFromLayer(layer),
    animations: [],
    environment: environmentFromLayer(layer, composition.backgroundColor),
    renderBindings: [
      {
        id: `binding-${sceneId}-${composition.id}`,
        kind: "motion-scene3d",
        compositionId: composition.id,
        layerId: layer.id,
        objectBindings,
        createdAt: now,
        modifiedAt: now,
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
  return { scene, assets: entries.map((entry) => entry.asset) };
}

function buildDraftEntry(options: {
  readonly sceneKey: string;
  readonly objectKey: string;
  readonly motionObject: MotionSceneObject3D;
  readonly now: number;
}): DraftEntry {
  const key = `${options.sceneKey}-${options.objectKey}`;
  const material = materialFromMotionObject(key, options.motionObject);
  const asset = assetFromMotionObject(key, options.motionObject, material, options.now);
  return {
    objectKey: options.objectKey,
    asset,
    sceneObject: {
      id: `object-${key}`,
      name: options.motionObject.name ?? options.objectKey,
      assetId: asset.id,
      materialId: material.id,
      partId: options.objectKey,
      transform: transformFromMotionObject(options.motionObject),
      visible: true,
      selectable: true,
      tags: [
        "user-recovered",
        "legacy-motion-3d",
        options.motionObject.object.kind,
      ],
    },
    renderObjectId: options.motionObject.id,
  };
}

function assetFromMotionObject(
  key: string,
  motionObject: MotionSceneObject3D,
  material: CreationMaterial,
  now: number,
): CreationAssetRecipe {
  const object = motionObject.object;
  const modelUrl = object.modelUrl;
  return {
    id: `asset-${key}`,
    name: motionObject.name ?? key,
    kind: assetKindFromMotionObject(object.kind),
    seed: `asset-${key}-seed`,
    parameters: compactCreationParameters({
      source: "ui-recovered-motion-scene3d",
      motionObjectKind: object.kind,
      size: object.size,
      depth: object.depth,
      aspect: object.aspect,
      cornerRadius: object.cornerRadius,
      text: object.text,
      extrude: object.extrude,
      panelTexts: object.panelTexts,
      lidAngle: motionObject.lidAngle,
      opacity: motionObject.opacity ?? motionObject.material?.opacity,
    }),
    nodes: [
      {
        id: `node-${key}-${modelUrl ? "model" : "primitive"}`,
        type: modelUrl ? "cache" : "primitive",
        name: motionObject.name ?? key,
        inputs: [],
        parameters: compactCreationParameters({
          kind: object.kind,
          size: object.size,
          depth: object.depth,
          aspect: object.aspect,
          cornerRadius: object.cornerRadius,
          modelUrl,
          text: object.text,
          extrude: object.extrude,
          panelTexts: object.panelTexts,
          materialId: material.id,
        }),
      },
      {
        id: `node-${key}-material`,
        type: "material",
        name: material.name,
        inputs: [`node-${key}-${modelUrl ? "model" : "primitive"}`],
        parameters: compactCreationParameters({
          materialId: material.id,
          model: material.model,
          baseColor: material.baseColor,
        }),
      },
    ],
    materials: [material],
    dependencies: modelUrl
      ? [
          {
            id: `dep-${key}-model`,
            kind: "mesh",
            uri: modelUrl,
            required: true,
          },
        ]
      : [],
    caches: [
      {
        id: `cache-${key}-preview`,
        kind: "preview-mesh",
        status: "dirty",
        generatorVersion: "ui-motion-scene3d-recovery-v1",
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

function materialFromMotionObject(
  key: string,
  motionObject: MotionSceneObject3D,
): CreationMaterial {
  const material = motionObject.material;
  return {
    id: `mat-${key}`,
    name: `${motionObject.name ?? key} material`,
    model: materialModelFromMotionMaterial(material),
    baseColor: material?.color ?? "#cbd5e1",
    metallic: material?.metalness,
    roughness: material?.roughness,
    opacity: motionObject.opacity ?? material?.opacity,
    emissive: material?.emissive,
    emissiveIntensity: material?.emissiveIntensity,
    textureCacheId: material?.mapAssetId,
    parameters: compactCreationParameters({
      materialKind: material?.kind,
      mapAssetId: material?.mapAssetId,
      normalMapAssetId: material?.normalMapAssetId,
      roughnessMapAssetId: material?.roughnessMapAssetId,
      metalnessMapAssetId: material?.metalnessMapAssetId,
    }),
  };
}

function materialModelFromMotionMaterial(
  material: MotionMaterial3D | undefined,
): CreationMaterial["model"] {
  if (material?.emissive) return "emissive";
  if ((material?.opacity ?? 1) < 0.92) return "glass";
  if ((material?.metalness ?? 0) > 0.55) return "metal";
  return material?.kind === "basic" ? "plastic" : "pbr";
}

function assetKindFromMotionObject(kind: MotionObject3DKind): CreationAssetKind {
  if (kind === "room") return "environment";
  if (kind === "phone") return "product";
  if (kind === "text3d") return "ui";
  return "prop";
}

function transformFromMotionObject(object: MotionSceneObject3D): Transform3D {
  return {
    position: {
      x: object.transform3d?.position?.x ?? 0,
      y: object.transform3d?.position?.y ?? 0,
      z: object.transform3d?.position?.z ?? 0,
    },
    rotation: {
      x: object.transform3d?.rotation?.x ?? 0,
      y: object.transform3d?.rotation?.y ?? 0,
      z: object.transform3d?.rotation?.z ?? 0,
    },
    scale: {
      x: object.transform3d?.scale?.x ?? 1,
      y: object.transform3d?.scale?.y ?? 1,
      z: object.transform3d?.scale?.z ?? 1,
    },
  };
}

function lightsFromLayer(layer: MotionScene3DLayer): readonly CreationLight[] {
  return [
    {
      id: "light-ambient",
      name: "Ambient fill",
      kind: "ambient",
      color: "#ffffff",
      intensity: layer.lighting?.ambient ?? 0.5,
    },
    {
      id: "light-key",
      name: "Key light",
      kind: "directional",
      color: layer.lighting?.keyColor ?? "#ffffff",
      intensity: layer.lighting?.keyIntensity ?? 1.8,
      position: { x: 4, y: 6, z: 5 },
      target: { x: 0, y: 0, z: 0 },
    },
  ];
}

function environmentFromLayer(
  layer: MotionScene3DLayer,
  backgroundColor: string,
): CreationSceneEnvironment {
  return {
    kind: layer.lighting?.environment === "dark" ? "space" : "studio",
    backgroundColor,
    groundEnabled: layer.lighting?.groundShadow === true,
    groundColor: layer.room?.floorColor,
  };
}

function hasCreationBinding(
  creation: CreationProjectState | undefined,
  compositionId: string,
  layerId: string,
): boolean {
  return (creation?.scenes ?? []).some((scene) =>
    scene.renderBindings.some(
      (binding) =>
        binding.kind === "motion-scene3d" &&
        binding.compositionId === compositionId &&
        binding.layerId === layerId,
    ),
  );
}

function idSegment(value: unknown, fallback: string): string {
  const source = typeof value === "string" && value.trim() ? value : fallback;
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function uniqueIdSegment(
  value: unknown,
  fallback: string,
  used: Set<string>,
): string {
  const base = idSegment(value, fallback);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function compactCreationParameters(entries: Record<string, unknown>): CreationParameters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (entry) =>
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean",
      );
    }
  }
  return out as CreationParameters;
}
