import { describe, it, expect } from "vitest";
import { IDENTITY_TRANSFORM } from "@openreel/core/creation/index";
import type {
  CreationAssetRecipe,
  CreationProjectState,
  CreationScene,
  CreationSceneObject,
} from "@openreel/core/creation/index";
import type {
  MotionComposition,
  MotionLayer,
  MotionScene3DLayer,
} from "@openreel/core/motion/types";
import { reviewCreationState } from "./creation-review";

function asset(id: string, dirtyCache = false): CreationAssetRecipe {
  return {
    id,
    name: id,
    kind: "prop",
    seed: `${id}-seed`,
    parameters: {},
    nodes: [],
    materials: [{ id: `${id}-mat`, name: "Mat", model: "pbr", baseColor: "#ffffff" }],
    dependencies: [],
    caches: dirtyCache
      ? [{ id: `${id}-cache`, kind: "preview-mesh", status: "dirty" }]
      : [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function object(id: string, assetId: string, materialId?: string): CreationSceneObject {
  return {
    id,
    name: id,
    assetId,
    materialId,
    transform: IDENTITY_TRANSFORM,
    visible: true,
    selectable: true,
    tags: [],
  };
}

function scene(partial: Partial<CreationScene> & { id: string }): CreationScene {
  return {
    name: partial.id,
    duration: 4,
    frameRate: 30,
    objects: [],
    cameras: [],
    lights: [],
    animations: [],
    environment: { kind: "studio" },
    renderBindings: [],
    createdAt: 0,
    modifiedAt: 0,
    ...partial,
  };
}

function state(scenes: CreationScene[], assets: CreationAssetRecipe[]): CreationProjectState {
  return {
    version: "0.1.0",
    assets,
    scenes,
    activeSceneId: scenes[0]?.id,
    operationHistory: [],
  };
}

function motionComposition(
  id: string,
  layers: MotionLayer[] = [scene3dLayer("layer")],
): MotionComposition {
  return {
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#000000",
    layers,
    assets: [],
    variables: [],
    markers: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function scene3dLayer(id: string): MotionScene3DLayer {
  return {
    id,
    type: "scene3d",
    name: id,
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
  };
}

function nonSceneLayer(id: string): MotionLayer {
  return {
    id,
    type: "null",
    name: id,
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
  };
}

describe("reviewCreationState", () => {
  it("reports unavailable when there is no creation state", () => {
    expect(reviewCreationState(undefined).available).toBe(false);
  });

  it("marks a well-formed scene as ok with no errors", () => {
    const review = reviewCreationState(healthyCreationState(), [
      motionComposition("comp"),
    ]);
    expect(review.available).toBe(true);
    expect(review.scenes[0]?.ok).toBe(true);
    expect(review.scenes[0]?.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("flags stale render bindings whose Motion composition or scene3d layer is missing", () => {
    const missingComposition = reviewCreationState(healthyCreationState(), []);
    expect(missingComposition.scenes[0]?.ok).toBe(false);
    expect(missingComposition.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_COMPOSITION", severity: "error" }),
    );

    const missingLayer = reviewCreationState(healthyCreationState(), [
      motionComposition("comp", []),
    ]);
    expect(missingLayer.scenes[0]?.ok).toBe(false);
    expect(missingLayer.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_LAYER", severity: "error" }),
    );

    const wrongLayerType = reviewCreationState(healthyCreationState(), [
      motionComposition("comp", [nonSceneLayer("layer")]),
    ]);
    expect(wrongLayerType.scenes[0]?.ok).toBe(false);
    expect(wrongLayerType.scenes[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_RENDER_LAYER", severity: "error" }),
    );
  });

  it("flags an empty scene as an error and a missing camera/unbaked mesh as warnings/info", () => {
    const review = reviewCreationState(
      state([scene({ id: "empty" })], []),
    );
    expect(review.scenes[0]?.ok).toBe(false);
    expect(review.scenes[0]?.issues.some((issue) => issue.code === "EMPTY_SCENE")).toBe(true);

    const warned = reviewCreationState(
      state([scene({ id: "s2", objects: [object("o1", "a1", "a1-mat")] })], [asset("a1", true)]),
    );
    const codes = warned.scenes[0]?.issues.map((issue) => issue.code) ?? [];
    expect(codes).toContain("NO_CAMERA");
    expect(codes).toContain("NO_RENDER_BINDING");
    expect(codes).toContain("UNBAKED_MESHES");
  });
});

function healthyCreationState(): CreationProjectState {
  return state(
    [
      scene({
        id: "s1",
        objects: [object("o1", "a1", "a1-mat")],
        cameras: [
          {
            id: "c1",
            name: "C",
            position: { x: 0, y: 0, z: 5 },
            target: { x: 0, y: 0, z: 0 },
            fov: 40,
          },
        ],
        lights: [{ id: "l1", name: "L", kind: "directional", color: "#fff", intensity: 1 }],
        renderBindings: [
          {
            id: "b1",
            kind: "motion-scene3d",
            compositionId: "comp",
            layerId: "layer",
            objectBindings: [{ sceneObjectId: "o1", renderObjectId: "r1" }],
            createdAt: 0,
            modifiedAt: 0,
          },
        ],
      }),
    ],
    [asset("a1")],
  );
}
