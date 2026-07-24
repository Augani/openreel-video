import { describe, expect, it } from "vitest";
import type { MotionComposition, Project } from "@openreel/core";
import type { CreationProjectState, CreationScene } from "@openreel/core/creation/index";
import {
  findRecoverableScene3DLayers,
  planRecoverMotionScene3DLayer,
} from "./creation-recovery";

function composition(): MotionComposition {
  return {
    id: "comp-moon",
    name: "Moon Scene",
    width: 1920,
    height: 1080,
    duration: 5,
    frameRate: 30,
    backgroundColor: "#020617",
    layers: [
      {
        id: "layer-astronaut",
        type: "scene3d",
        name: "Astronaut Render",
        startTime: 0,
        duration: 5,
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
        lighting: { environment: "dark", ambient: 0.4, keyIntensity: 2 },
        camera: {
          position: { x: 0, y: 2.5, z: 8 },
          target: { x: 0, y: 1, z: 0 },
          fov: 32,
        },
        objects: [
          {
            id: "render-astronaut",
            name: "Astronaut",
            object: { kind: "model", modelUrl: "file:///astronaut.glb", size: 0.8 },
            material: { color: "#f8fafc", roughness: 0.5 },
            transform3d: {
              position: { x: 0, y: 0.85, z: 0 },
              rotation: { x: 0, y: 18, z: 0 },
              scale: { x: 1.2, y: 1.2, z: 1.2 },
            },
          },
          {
            id: "render-flag",
            name: "Ghana Flag",
            object: { kind: "text3d", text: "GHANA", extrude: 0.08 },
            material: { color: "#22c55e", metalness: 0.1, roughness: 0.35 },
            transform3d: {
              position: { x: 1.2, y: 1.4, z: 0 },
              rotation: { x: 0, y: -12, z: 0 },
              scale: { x: 0.8, y: 0.8, z: 0.8 },
            },
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

function project(creation?: CreationProjectState): Project {
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: 0 } as unknown as Project["timeline"],
    motionCompositions: [composition()],
    motionInstances: [],
    creation,
  };
}

function boundCreation(scene: CreationScene): CreationProjectState {
  return {
    version: "0.1.0",
    assets: [],
    scenes: [scene],
    activeSceneId: scene.id,
    operationHistory: [],
  };
}

describe("creation scene3d recovery", () => {
  it("finds render-only multi-object scene3d layers", () => {
    const recoverable = findRecoverableScene3DLayers(undefined, [composition()]);

    expect(recoverable).toEqual([
      {
        compositionId: "comp-moon",
        compositionName: "Moon Scene",
        layerId: "layer-astronaut",
        layerName: "Astronaut Render",
        objectCount: 2,
        duration: 5,
      },
    ]);
  });

  it("plans creation assets, scene objects, and render bindings from a scene3d layer", () => {
    const plan = planRecoverMotionScene3DLayer(
      project(),
      "comp-moon",
      "layer-astronaut",
      123,
    );

    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.operations.map((operation) => operation.type)).toEqual([
      "asset/upsert",
      "asset/upsert",
      "scene/upsert",
      "scene/set-active",
    ]);
    expect(plan.assets).toHaveLength(2);
    expect(plan.scene.objects).toHaveLength(2);
    expect(plan.scene.cameras[0]).toMatchObject({
      position: { x: 0, y: 2.5, z: 8 },
      target: { x: 0, y: 1, z: 0 },
      fov: 32,
    });
    expect(plan.scene.environment.kind).toBe("space");

    const astronaut = plan.scene.objects.find((object) => object.name === "Astronaut");
    expect(astronaut?.transform).toEqual({
      position: { x: 0, y: 0.85, z: 0 },
      rotation: { x: 0, y: 18, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
    });

    expect(plan.scene.renderBindings[0]?.objectBindings).toEqual([
      {
        sceneObjectId: astronaut?.id,
        renderObjectId: "render-astronaut",
      },
      {
        sceneObjectId: plan.scene.objects[1]?.id,
        renderObjectId: "render-flag",
      },
    ]);
    expect(plan.assets[0]?.dependencies[0]).toMatchObject({
      kind: "mesh",
      uri: "file:///astronaut.glb",
    });
  });

  it("does not offer recovery after the layer has a creation binding", () => {
    const plan = planRecoverMotionScene3DLayer(
      project(),
      "comp-moon",
      "layer-astronaut",
      123,
    );
    if ("error" in plan) throw new Error(plan.error);

    const creation = boundCreation(plan.scene);
    expect(findRecoverableScene3DLayers(creation, [composition()])).toHaveLength(0);
    expect(
      planRecoverMotionScene3DLayer(
        project(creation),
        "comp-moon",
        "layer-astronaut",
        124,
      ),
    ).toEqual({ error: "Scene3D layer is already bound to a Creation scene" });
  });
});
