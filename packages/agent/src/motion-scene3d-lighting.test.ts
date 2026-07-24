import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionScene3DLayer,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

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

describe("set_motion_scene3d_lighting", () => {
  it("patches environment, HDRI url, backdrop and intensities", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene3d_lighting",
      {
        compositionId: "comp-3d",
        layerId: "layer-3d",
        environment: "sunset",
        environmentUrl: "https://cdn.example/studio.hdr",
        environmentBackground: true,
        groundShadow: true,
        keyIntensity: 3,
        ambient: 0.4,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const lighting = scene3dLayer(host).lighting;
    expect(lighting?.environment).toBe("sunset");
    expect(lighting?.environmentUrl).toBe("https://cdn.example/studio.hdr");
    expect(lighting?.environmentBackground).toBe(true);
    expect(lighting?.groundShadow).toBe(true);
    expect(lighting?.keyIntensity).toBe(3);
    expect(lighting?.ambient).toBe(0.4);
  });

  it("only changes the fields that are passed", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    await executeTool(
      "set_motion_scene3d_lighting",
      { compositionId: "comp-3d", layerId: "layer-3d", environment: "city" },
      host,
    );
    await executeTool(
      "set_motion_scene3d_lighting",
      { compositionId: "comp-3d", layerId: "layer-3d", keyIntensity: 5 },
      host,
    );
    const lighting = scene3dLayer(host).lighting;
    expect(lighting?.environment).toBe("city");
    expect(lighting?.keyIntensity).toBe(5);
  });

  it("clamps intensities into range", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    await executeTool(
      "set_motion_scene3d_lighting",
      { compositionId: "comp-3d", layerId: "layer-3d", keyIntensity: 999 },
      host,
    );
    expect(scene3dLayer(host).lighting?.keyIntensity).toBe(10);
  });

  it("rejects an unknown environment preset", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene3d_lighting",
      { compositionId: "comp-3d", layerId: "layer-3d", environment: "disco" },
      host,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a non-scene3d layer", async () => {
    const host = new HeadlessHost(projectWithScene3D());
    const res = await executeTool(
      "set_motion_scene3d_lighting",
      { compositionId: "comp-3d", layerId: "layer-null", environment: "studio" },
      host,
    );
    expect(res.ok).toBe(false);
  });
});
