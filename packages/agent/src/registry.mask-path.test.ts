import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionMask,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { MotionShapePathPoint } from "@openreel/core/motion/motion-shape-path";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-mask-path";
const LAYER_ID = "layer-shape";

function projectWithShape(): Project {
  const shape: MotionShapeLayer = {
    id: LAYER_ID,
    type: "shape",
    name: "Shape",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    shapeType: "rectangle",
    width: 200,
    height: 120,
    style: {
      fill: { type: "solid", color: "#14b8a6", opacity: 0.8 },
      stroke: { color: "#ffffff", width: 0, opacity: 1 },
    },
  };
  const composition: MotionComposition = {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [shape as MotionLayer],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return { ...makeEmptyProject(), motionCompositions: [composition] } as unknown as Project;
}

function layerFrom(host: HeadlessHost): MotionLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === COMP_ID)!;
  return comp.layers.find((layer) => layer.id === LAYER_ID)!;
}

function masksFrom(host: HeadlessHost): readonly MotionMask[] {
  return layerFrom(host).masks ?? [];
}

const triangle: readonly MotionShapePathPoint[] = [
  { x: -60, y: -40 },
  { x: 60, y: -40, inX: 30, inY: -80, outX: 90, outY: 0 },
  { x: 0, y: 50 },
];

function asMaskData(value: unknown): { readonly maskId?: string; readonly keyframeId?: string } {
  if (!value || typeof value !== "object") throw new Error("Expected mask data");
  return value as { readonly maskId?: string; readonly keyframeId?: string };
}

describe("add_motion_mask shape:path", () => {
  it("creates a path mask storing shape:path and the supplied pathPoints with handles", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    expect(res.ok).toBe(true);
    const masks = masksFrom(host);
    expect(masks.length).toBe(1);
    expect(masks[0].shape).toBe("path");
    expect(masks[0].pathPoints?.length).toBe(3);
    const withHandle = masks[0].pathPoints![1];
    expect(withHandle.inX).toBe(30);
    expect(withHandle.outY).toBe(0);
  });

  it("rejects fewer than 3 points with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_mask",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        shape: "path",
        pathPoints: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
    expect(masksFrom(host).length).toBe(0);
  });

  it("rejects non-finite coordinates with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_mask",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        shape: "path",
        pathPoints: [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("set_motion_mask_path", () => {
  it("replaces a path mask's pathPoints", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const nextPoints: readonly MotionShapePathPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const res = await executeTool(
      "set_motion_mask_path",
      { compositionId: COMP_ID, layerId: LAYER_ID, maskId, pathPoints: nextPoints },
      host,
    );
    expect(res.ok).toBe(true);
    const mask = masksFrom(host)[0];
    expect(mask.pathPoints?.length).toBe(4);
    expect(mask.pathPoints![2]).toMatchObject({ x: 100, y: 100 });
  });

  it("returns NOT_FOUND for an unknown mask id", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "set_motion_mask_path",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        maskId: "nope",
        pathPoints: triangle,
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("rejects fewer than 3 points with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const res = await executeTool(
      "set_motion_mask_path",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        maskId,
        pathPoints: [{ x: 0, y: 0 }],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("add_motion_mask_path_keyframe", () => {
  it("adds a pathKeyframes entry and returns a keyframe id", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const res = await executeTool(
      "add_motion_mask_path_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, maskId, time: 1 },
      host,
    );
    expect(res.ok).toBe(true);
    const keyframeId = asMaskData(res.data).keyframeId;
    expect(typeof keyframeId).toBe("string");
    const mask = masksFrom(host)[0];
    expect(mask.pathKeyframes?.length).toBe(1);
    expect(mask.pathKeyframes![0].id).toBe(keyframeId);
    expect(mask.pathKeyframes![0].time).toBe(1);
  });

  it("uses supplied pathPoints when provided", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const custom: readonly MotionShapePathPoint[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 0, y: 20 },
    ];
    const res = await executeTool(
      "add_motion_mask_path_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, maskId, time: 2, pathPoints: custom },
      host,
    );
    expect(res.ok).toBe(true);
    const mask = masksFrom(host)[0];
    expect(mask.pathKeyframes?.length).toBe(1);
    expect(typeof mask.pathKeyframes![0].value).toBe("string");
    expect((mask.pathKeyframes![0].value as string).length).toBeGreaterThan(0);
  });

  it("rejects a non-path mask with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "rectangle" },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const res = await executeTool(
      "add_motion_mask_path_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, maskId, time: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown mask id", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_mask_path_keyframe",
      { compositionId: COMP_ID, layerId: LAYER_ID, maskId: "nope", time: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("rejects non-finite supplied pathPoints with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShape());
    await executeTool(
      "add_motion_mask",
      { compositionId: COMP_ID, layerId: LAYER_ID, shape: "path", pathPoints: triangle },
      host,
    );
    const maskId = masksFrom(host)[0].id;
    const res = await executeTool(
      "add_motion_mask_path_keyframe",
      {
        compositionId: COMP_ID,
        layerId: LAYER_ID,
        maskId,
        time: 1,
        pathPoints: [
          { x: 0, y: 0 },
          { x: Infinity, y: 0 },
          { x: 5, y: 5 },
        ],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
