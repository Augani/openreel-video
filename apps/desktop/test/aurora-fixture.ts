import {
  createCreationScene,
  createCreationSceneObject,
  type CreationAssetRecipe,
  type CreationScene,
} from "../../../packages/core/src/creation/index";

export function createAuroraFixtureAsset(): CreationAssetRecipe {
  return {
    id: "asset-box",
    name: "Box",
    kind: "prop",
    seed: "box",
    parameters: { kind: "box", size: 1.4, depth: 1.4 },
    nodes: [
      {
        id: "node-box",
        type: "primitive",
        name: "Box",
        inputs: [],
        parameters: { kind: "box", size: 1.4, depth: 1.4 },
      },
    ],
    materials: [
      {
        id: "mat-box",
        name: "Box Blue",
        model: "pbr",
        baseColor: "#3b82f6",
        roughness: 0.35,
        metallic: 0.1,
      },
    ],
    dependencies: [],
    caches: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

export function createAuroraFixtureScene(asset: CreationAssetRecipe): CreationScene {
  const scene = createCreationScene({
    id: "scene-aurora",
    name: "Aurora Scene",
    duration: 3,
    frameRate: 24,
    now: 1,
  });
  const object = createCreationSceneObject({
    id: "object-box",
    name: "Box",
    assetId: asset.id,
    materialId: "mat-box",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });
  return {
    ...scene,
    objects: [object],
    cameras: [
      {
        id: "camera-main",
        name: "Main Camera",
        position: { x: 2.8, y: 2.1, z: 3.8 },
        target: { x: 0, y: 0, z: 0 },
        fov: 45,
      },
    ],
    activeCameraId: "camera-main",
    lights: [
      {
        id: "light-key",
        name: "Key",
        kind: "directional",
        color: "#ffffff",
        intensity: 0.9,
        target: { x: 0.4, y: 1, z: 0.5 },
      },
    ],
  };
}
