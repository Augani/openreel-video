import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionScene3DLayer,
  MotionSceneObject3D,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

function objectAlpha(): MotionSceneObject3D {
  return {
    id: "obj-alpha",
    name: "Alpha",
    object: { kind: "rounded-box", size: 0.5 },
    material: {
      kind: "physical",
      color: "#10b981",
      metalness: 0.1,
      roughness: 0.4,
    },
    transform3d: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function objectBeta(): MotionSceneObject3D {
  return {
    id: "obj-beta",
    name: "Beta",
    object: { kind: "sphere", size: 0.6 },
    material: {
      kind: "physical",
      color: "#3b82f6",
      metalness: 0.2,
      roughness: 0.5,
    },
    transform3d: {
      position: { x: 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
}

function projectWithScene3D(): Project {
  const scene3d: MotionScene3DLayer = {
    id: "layer-3d",
    type: "scene3d",
    name: "Hero 3D",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    object: { kind: "box" },
    objects: [objectAlpha(), objectBeta()],
    camera: { position: { x: 0, y: 3, z: 14 }, fov: 35 },
  };
  const nullLayer = {
    id: "layer-null",
    type: "null",
    name: "Null",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
  } as unknown as MotionLayer;
  const composition: MotionComposition = {
    id: "comp-3d",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [scene3d, nullLayer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return { ...makeEmptyProject(), motionCompositions: [composition] } as unknown as Project;
}

function scene3dLayer(host: HeadlessHost): MotionScene3DLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-3d")!;
  return comp.layers.find((layer) => layer.id === "layer-3d") as MotionScene3DLayer;
}

describe("set_motion_scene_object", () => {
  it("merges only the supplied material and transform fields", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-alpha",
        material: { color: "#ff0000" },
        transform: { position: { x: 5, y: 1, z: -2 } },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const object = (scene3dLayer(host).objects ?? []).find(
      (candidate) => candidate.id === "obj-alpha",
    )!;
    expect(object.material?.color).toBe("#ff0000");
    expect(object.material?.metalness).toBe(0.1);
    expect(object.material?.roughness).toBe(0.4);
    expect(object.transform3d?.position).toEqual({ x: 5, y: 1, z: -2 });
    expect(object.transform3d?.rotation).toEqual({ x: 0, y: 0, z: 0 });
    expect(object.transform3d?.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("clamps metalness/roughness/opacity into [0,1]", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-alpha",
        material: { metalness: 9, roughness: -3, opacity: 5 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const object = (scene3dLayer(host).objects ?? []).find(
      (candidate) => candidate.id === "obj-alpha",
    )!;
    expect(object.material?.metalness).toBe(1);
    expect(object.material?.roughness).toBe(0);
    expect(object.material?.opacity).toBe(1);
  });

  it("updates geometry kind/size and validates the kind", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const good = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-alpha",
        geometry: { kind: "torus", size: 0.9 },
      },
      host,
    );
    expect(good.ok).toBe(true);
    const object = (scene3dLayer(host).objects ?? []).find(
      (candidate) => candidate.id === "obj-alpha",
    )!;
    expect(object.object.kind).toBe("torus");
    expect(object.object.size).toBe(0.9);

    const bad = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-alpha",
        geometry: { kind: "not-a-kind" },
      },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");
  });

  it("merges a partial transform vector, leaving unspecified axes unchanged", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-beta",
        transform: { position: { x: 5 } },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const object = (scene3dLayer(host).objects ?? []).find(
      (candidate) => candidate.id === "obj-beta",
    )!;
    expect(object.transform3d?.position).toEqual({ x: 5, y: 0, z: 0 });
    expect(object.transform3d?.rotation).toEqual({ x: 0, y: 0, z: 0 });
    expect(object.transform3d?.scale).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("fails when the objectId is absent", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_object",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        objectId: "obj-missing",
        material: { color: "#ffffff" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("remove_motion_scene_object", () => {
  it("removes the matched object", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "remove_motion_scene_object",
      { compositionId: "comp-3d", layerId: "layer-3d", objectId: "obj-beta" },
      host,
    );
    expect(res.ok).toBe(true);
    const objects = scene3dLayer(host).objects ?? [];
    expect(objects.map((object) => object.id)).toEqual(["obj-alpha"]);
  });

  it("refuses to remove the last object", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    await executeTool(
      "remove_motion_scene_object",
      { compositionId: "comp-3d", layerId: "layer-3d", objectId: "obj-beta" },
      host,
    );
    const res = await executeTool(
      "remove_motion_scene_object",
      { compositionId: "comp-3d", layerId: "layer-3d", objectId: "obj-alpha" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect((scene3dLayer(host).objects ?? []).length).toBe(1);
  });

  it("fails when the objectId is absent", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "remove_motion_scene_object",
      { compositionId: "comp-3d", layerId: "layer-3d", objectId: "obj-missing" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("set_motion_scene_camera", () => {
  it("sets static camera position, target and fov immutably", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_camera",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        position: { x: 1, y: 2, z: 3 },
        target: { x: 0, y: 1, z: 0 },
        fov: 50,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const camera = scene3dLayer(host).camera;
    expect(camera?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(camera?.target).toEqual({ x: 0, y: 1, z: 0 });
    expect(camera?.fov).toBe(50);
  });

  it("only changes the fields that are passed", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_camera",
      { compositionId: "comp-3d", layerId: "layer-3d", fov: 60 },
      host,
    );
    expect(res.ok).toBe(true);
    const camera = scene3dLayer(host).camera;
    expect(camera?.fov).toBe(60);
    expect(camera?.position).toEqual({ x: 0, y: 3, z: 14 });
  });

  it("merges a partial camera position, leaving unspecified axes unchanged", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_camera",
      { compositionId: "comp-3d", layerId: "layer-3d", position: { x: 7 } },
      host,
    );
    expect(res.ok).toBe(true);
    const camera = scene3dLayer(host).camera;
    expect(camera?.position).toEqual({ x: 7, y: 3, z: 14 });
  });

  it("rejects a non-scene3d layer", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene_camera",
      { compositionId: "comp-3d", layerId: "layer-null", fov: 50 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
