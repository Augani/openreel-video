import { describe, expect, it } from "vitest";
import type { Project, MotionComposition } from "@openreel/core";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
} from "@openreel/core/creation/index";
import { planCreationObjectEdit } from "./creation-object-editing";

function asset(): CreationAssetRecipe {
  return {
    id: "asset-body",
    name: "Body asset",
    kind: "prop",
    seed: "asset-body",
    parameters: {},
    nodes: [],
    materials: [
      {
        id: "mat-body",
        name: "Body material",
        model: "pbr",
        baseColor: "#94a3b8",
        metallic: 0.1,
        roughness: 0.4,
        opacity: 1,
      },
    ],
    dependencies: [],
    caches: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function scene(bound = true): CreationScene {
  return {
    id: "scene-1",
    name: "Editable Scene",
    duration: 4,
    frameRate: 30,
    objects: [
      {
        id: "object-body",
        name: "Body",
        assetId: "asset-body",
        materialId: "mat-body",
        transform: IDENTITY_TRANSFORM,
        visible: true,
        selectable: true,
        tags: ["agent-created"],
      },
    ],
    cameras: [],
    activeCameraId: undefined,
    lights: [],
    animations: [],
    environment: { kind: "studio" },
    renderBindings: bound
      ? [
          {
            id: "binding-1",
            kind: "motion-scene3d",
            compositionId: "comp-1",
            layerId: "layer-1",
            objectBindings: [
              { sceneObjectId: "object-body", renderObjectId: "render-body" },
            ],
            createdAt: 1,
            modifiedAt: 1,
          },
        ]
      : [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function composition(): MotionComposition {
  return {
    id: "comp-1",
    name: "Render Scene",
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#000",
    layers: [
      {
        id: "layer-1",
        type: "scene3d",
        name: "3D",
        startTime: 0,
        duration: 4,
        visible: true,
        locked: false,
        transform: {
          position: { x: 960, y: 540 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        keyframes: [],
        object: { kind: "box" },
        objects: [
          {
            id: "render-body",
            name: "Body",
            object: { kind: "rounded-box" },
            material: { kind: "physical", color: "#94a3b8", metalness: 0.1 },
            transform3d: IDENTITY_TRANSFORM,
          },
        ],
      },
    ],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function project(bound = true): Project {
  const creation: CreationProjectState = {
    version: "0.1.0",
    assets: [asset()],
    scenes: [scene(bound)],
    activeSceneId: "scene-1",
    operationHistory: [],
  };
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
    },
    timeline: { duration: 0, tracks: [], subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
    creation,
    motionCompositions: bound ? [composition()] : [],
  } as Project;
}

describe("planCreationObjectEdit", () => {
  it("updates semantic object/material state and bound scene3d render object", () => {
    const plan = planCreationObjectEdit(
      project(),
      "scene-1",
      "object-body",
      {
        name: "Hero body",
        position: { x: 1.2, y: 0.4 },
        rotation: { z: 12 },
        scale: { x: 1.4 },
        material: {
          baseColor: "#facc15",
          metallic: 0.7,
          roughness: 0.22,
          opacity: 0.8,
        },
      },
      100,
    );
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "asset/upsert",
      "scene/upsert",
    ]);
    expect(plan.scene.objects[0]).toMatchObject({
      id: "object-body",
      name: "Hero body",
      transform: {
        position: { x: 1.2, y: 0.4, z: 0 },
        rotation: { x: 0, y: 0, z: 12 },
        scale: { x: 1.4, y: 1, z: 1 },
      },
    });
    const renderObject = plan.composition?.layers[0]?.type === "scene3d"
      ? plan.composition.layers[0].objects?.[0]
      : undefined;
    expect(renderObject).toMatchObject({
      id: "render-body",
      name: "Hero body",
      transform3d: {
        position: { x: 1.2, y: 0.4, z: 0 },
        rotation: { x: 0, y: 0, z: 12 },
        scale: { x: 1.4, y: 1, z: 1 },
      },
      material: {
        color: "#facc15",
        metalness: 0.7,
        roughness: 0.22,
        opacity: 0.8,
      },
      opacity: 0.8,
    });
  });

  it("edits unbound creation objects without requiring a render composition", () => {
    const plan = planCreationObjectEdit(
      project(false),
      "scene-1",
      "object-body",
      { position: { z: 2 } },
      200,
    );
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.composition).toBeUndefined();
    expect(plan.scene.objects[0]?.transform.position).toEqual({ x: 0, y: 0, z: 2 });
    expect(plan.operations.map((operation) => operation.type)).toEqual(["scene/upsert"]);
  });
});
