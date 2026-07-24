import { describe, expect, it } from "vitest";
import type { Project, MotionComposition } from "@openreel/core";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
} from "@openreel/core/creation/index";
import { planCreationCameraEdit } from "./creation-camera-editing";

function asset(): CreationAssetRecipe {
  return {
    id: "asset-body",
    name: "Body asset",
    kind: "prop",
    seed: "asset-body",
    parameters: {},
    nodes: [],
    materials: [],
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
    objects: [],
    cameras: [
      {
        id: "camera-hero",
        name: "Hero camera",
        position: { x: 0, y: 2, z: 12 },
        target: { x: 0, y: 0.8, z: 0 },
        fov: 35,
      },
    ],
    activeCameraId: "camera-hero",
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
            objectBindings: [],
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
        keyframes: [
          {
            id: "k-camera-z",
            time: 0,
            property: "scene.camera.position.z",
            value: 12,
            easing: "linear",
          },
          {
            id: "k-camera-fov",
            time: 0,
            property: "scene.camera.fov",
            value: 35,
            easing: "linear",
          },
          {
            id: "k-object-x",
            time: 0,
            property: "scene.object.render-body.position.x",
            value: 2,
            easing: "linear",
          },
        ],
        object: { kind: "box" },
        camera: {
          position: { x: 0, y: 2, z: 12 },
          target: { x: 0, y: 0.8, z: 0 },
          fov: 35,
        },
        objects: [],
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

describe("planCreationCameraEdit", () => {
  it("updates semantic camera state and bound scene3d camera keyframes", () => {
    const plan = planCreationCameraEdit(
      project(),
      "scene-1",
      "camera-hero",
      {
        name: "Push-in camera",
        position: { z: 8 },
        target: { x: 1 },
        fov: 42,
        focusDistance: 3.5,
        depthOfField: true,
      },
      100,
    );
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.operations.map((operation) => operation.type)).toEqual(["camera/upsert"]);
    expect(plan.camera).toMatchObject({
      id: "camera-hero",
      name: "Push-in camera",
      position: { x: 0, y: 2, z: 8 },
      target: { x: 1, y: 0.8, z: 0 },
      fov: 42,
      focusDistance: 3.5,
      depthOfField: true,
    });
    const layer = plan.composition?.layers[0];
    expect(layer?.type).toBe("scene3d");
    if (layer?.type !== "scene3d") return;
    expect(layer.camera).toMatchObject({
      position: { x: 0, y: 2, z: 8 },
      target: { x: 1, y: 0.8, z: 0 },
      fov: 42,
    });
    expect(layer.fov).toBe(42);
    expect(layer.keyframes.find((keyframe) => keyframe.id === "k-camera-z")?.value).toBe(8);
    expect(layer.keyframes.find((keyframe) => keyframe.id === "k-camera-fov")?.value).toBe(42);
    expect(layer.keyframes.find((keyframe) => keyframe.id === "k-object-x")?.value).toBe(2);
  });

  it("edits unbound creation cameras without requiring a render composition", () => {
    const plan = planCreationCameraEdit(
      project(false),
      "scene-1",
      undefined,
      { position: { x: 2 } },
      200,
    );
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.composition).toBeUndefined();
    expect(plan.camera.position).toEqual({ x: 2, y: 2, z: 12 });
  });

  it("activates the fallback camera when the scene has no active camera", () => {
    const fallbackProject = project(false);
    const creation = fallbackProject.creation!;
    const inactiveScene: CreationScene = {
      ...creation.scenes[0]!,
      activeCameraId: undefined,
    };
    const plan = planCreationCameraEdit(
      { ...fallbackProject, creation: { ...creation, scenes: [inactiveScene] } },
      "scene-1",
      undefined,
      { fov: 55 },
      250,
    );
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;

    expect(plan.scene.activeCameraId).toBe("camera-hero");
    expect(plan.operations[0]).toMatchObject({ type: "camera/upsert", active: true });
  });

  it("reports scenes with no editable camera", () => {
    const emptyCameraProject = project(false);
    const creation = emptyCameraProject.creation!;
    const noCameraScene: CreationScene = {
      ...creation.scenes[0]!,
      cameras: [],
      activeCameraId: undefined,
    };
    const plan = planCreationCameraEdit(
      { ...emptyCameraProject, creation: { ...creation, scenes: [noCameraScene] } },
      "scene-1",
      undefined,
      { fov: 50 },
      300,
    );

    expect(plan).toEqual({ error: "Creation scene has no camera to edit" });
  });
});
