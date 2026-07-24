import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { MotionShapePathPoint } from "@openreel/core/motion/motion-shape-path";
import { parseMotionPathSegments } from "@openreel/core/motion/motion-shape-path";
import type { Project } from "@openreel/core/types/project";

const COMP_ID = "comp-paths-kf";
const SHAPE_ID = "layer-shape";
const PATH_ID = "layer-path";

const trianglePath: readonly MotionShapePathPoint[] = [
  { x: -60, y: -40 },
  { x: 60, y: -40, inX: 30, inY: -80, outX: 90, outY: 0 },
  { x: 0, y: 50 },
];

function baseShape(): MotionShapeLayer {
  return {
    id: SHAPE_ID,
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
}

function pathShape(): MotionShapeLayer {
  return {
    ...baseShape(),
    id: PATH_ID,
    name: "Path Shape",
    shapeType: "path",
    pathData: "M -50 -50 L 50 -50 L 50 50 L -50 50 Z",
    pathClosed: true,
  };
}

function projectWith(...layers: MotionShapeLayer[]): Project {
  const composition: MotionComposition = {
    id: COMP_ID,
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: layers as unknown as MotionLayer[],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return {
    ...makeEmptyProject(),
    motionCompositions: [composition],
  } as unknown as Project;
}

function layerFrom(host: HeadlessHost, layerId: string): MotionLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === COMP_ID)!;
  return comp.layers.find((layer) => layer.id === layerId)!;
}

function shapeFrom(host: HeadlessHost, layerId: string): MotionShapeLayer {
  const layer = layerFrom(host, layerId);
  if (layer.type !== "shape") throw new Error("expected shape layer");
  return layer;
}

describe("set_motion_shape_path", () => {
  it("sets pathData + pathClosed from supplied points on a path shape", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "set_motion_shape_path",
      {
        compositionId: COMP_ID,
        layerId: PATH_ID,
        points: trianglePath,
        closed: false,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const shape = shapeFrom(host, PATH_ID);
    expect(shape.pathClosed).toBe(false);
    expect(typeof shape.pathData).toBe("string");
    const parsed = parseMotionPathSegments(shape.pathData);
    expect(parsed.length).toBe(3);
  });

  it("rejects fewer than 2 finite points with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "set_motion_shape_path",
      { compositionId: COMP_ID, layerId: PATH_ID, points: [{ x: 0, y: 0 }] },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects non-finite coordinates with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "set_motion_shape_path",
      {
        compositionId: COMP_ID,
        layerId: PATH_ID,
        points: [
          { x: 0, y: 0 },
          { x: Number.NaN, y: 5 },
        ],
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a non-path shape with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "set_motion_shape_path",
      { compositionId: COMP_ID, layerId: SHAPE_ID, points: trianglePath },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown layer", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "set_motion_shape_path",
      { compositionId: COMP_ID, layerId: "nope", points: trianglePath },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("edit_motion_shape_path_point", () => {
  it("moves a vertex", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "edit_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 0, x: 999, y: -999 },
      host,
    );
    expect(res.ok).toBe(true);
    const parsed = parseMotionPathSegments(shapeFrom(host, PATH_ID).pathData);
    expect(parsed[0]).toMatchObject({ x: 999, y: -999 });
  });

  it("sets an out handle when outX/outY supplied", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "edit_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 0, outX: 20, outY: 30 },
      host,
    );
    expect(res.ok).toBe(true);
    const parsed = parseMotionPathSegments(shapeFrom(host, PATH_ID).pathData);
    expect(parsed[0].outX).toBe(20);
    expect(parsed[0].outY).toBe(30);
  });

  it("requires at least one field to change", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "edit_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 0 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an out-of-range index with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "edit_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 42, x: 1, y: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("insert_motion_shape_path_point", () => {
  it("inserts a vertex after the given index", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "insert_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, afterIndex: 0 },
      host,
    );
    expect(res.ok).toBe(true);
    expect((res.data as { pointCount?: number }).pointCount).toBe(5);
  });

  it("inserts a supplied point", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "insert_motion_shape_path_point",
      {
        compositionId: COMP_ID,
        layerId: PATH_ID,
        afterIndex: 0,
        point: { x: 123, y: 456 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const parsed = parseMotionPathSegments(shapeFrom(host, PATH_ID).pathData);
    expect(parsed[1]).toMatchObject({ x: 123, y: 456 });
  });
});

describe("remove_motion_shape_path_point", () => {
  it("removes a vertex", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "remove_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 0 },
      host,
    );
    expect(res.ok).toBe(true);
    expect((res.data as { pointCount?: number }).pointCount).toBe(3);
  });

  it("refuses to drop below the minimum vertex count", async () => {
    const twoPoint: MotionShapeLayer = {
      ...pathShape(),
      pathData: "M 0 0 L 100 0",
      pathClosed: false,
    };
    const host = new HeadlessHost(projectWith(twoPoint));
    const res = await executeTool(
      "remove_motion_shape_path_point",
      { compositionId: COMP_ID, layerId: PATH_ID, index: 0 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("add_motion_layer shape:path", () => {
  it("creates a path shape from pathData + pathClosed", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "add_motion_layer",
      {
        compositionId: COMP_ID,
        layerType: "shape",
        shapeType: "path",
        name: "Pen Path",
        pathData: "M 0 0 L 100 0 L 100 100 Z",
        pathClosed: true,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { layerId?: string };
    const layer = layerFrom(host, data.layerId!);
    expect(layer.type).toBe("shape");
    const shape = layer as MotionShapeLayer;
    expect(shape.shapeType).toBe("path");
    expect(shape.pathClosed).toBe(true);
    expect((shape.pathData ?? "").length).toBeGreaterThan(0);
  });

  it("creates a path shape from pathPoints", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "add_motion_layer",
      {
        compositionId: COMP_ID,
        layerType: "shape",
        shapeType: "path",
        pathPoints: trianglePath,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { layerId?: string };
    const shape = layerFrom(host, data.layerId!) as MotionShapeLayer;
    expect(shape.shapeType).toBe("path");
    expect(parseMotionPathSegments(shape.pathData).length).toBe(3);
  });

  it("rejects shapeType path with no path input", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "add_motion_layer",
      { compositionId: COMP_ID, layerType: "shape", shapeType: "path" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("add_motion_shape_path_keyframe", () => {
  it("adds a shape.pathData keyframe from the current path", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "add_motion_shape_path_keyframe",
      { compositionId: COMP_ID, layerId: PATH_ID, time: 1 },
      host,
    );
    expect(res.ok).toBe(true);
    const shape = shapeFrom(host, PATH_ID);
    const kf = shape.keyframes.filter((k) => k.property === "shape.pathData");
    expect(kf.length).toBe(1);
    expect(kf[0].time).toBe(1);
  });

  it("adds a keyframe from supplied points", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "add_motion_shape_path_keyframe",
      { compositionId: COMP_ID, layerId: PATH_ID, time: 2, points: trianglePath },
      host,
    );
    expect(res.ok).toBe(true);
    const shape = shapeFrom(host, PATH_ID);
    const kf = shape.keyframes.filter((k) => k.property === "shape.pathData");
    expect(kf.length).toBe(1);
    expect(typeof kf[0].value).toBe("string");
  });

  it("adds a keyframe from supplied pathData string", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "add_motion_shape_path_keyframe",
      {
        compositionId: COMP_ID,
        layerId: PATH_ID,
        time: 0.5,
        pathData: "M 0 0 L 10 0 L 10 10 Z",
      },
      host,
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a non-path shape with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "add_motion_shape_path_keyframe",
      { compositionId: COMP_ID, layerId: SHAPE_ID, time: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown layer", async () => {
    const host = new HeadlessHost(projectWith(pathShape()));
    const res = await executeTool(
      "add_motion_shape_path_keyframe",
      { compositionId: COMP_ID, layerId: "nope", time: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

function animatedShape(): MotionShapeLayer {
  return {
    ...baseShape(),
    keyframes: [
      { id: "k1", property: "transform.opacity", time: 0, value: 0, easing: "ease" },
      { id: "k2", property: "transform.opacity", time: 1, value: 1, easing: "ease" },
      { id: "k3", property: "transform.opacity", time: 2, value: 0.5, easing: "ease" },
    ],
  };
}

function opacityKeyframes(host: HeadlessHost) {
  return shapeFrom(host, SHAPE_ID)
    .keyframes.filter((k) => k.property === "transform.opacity")
    .sort((a, b) => a.time - b.time);
}

describe("transform_motion_keyframes", () => {
  it("reverses keyframe values across the time span", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
        op: "reverse",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const kf = opacityKeyframes(host);
    expect(kf[0].value).toBe(0.5);
    expect(kf[kf.length - 1].value).toBe(0);
  });

  it("scales keyframe times", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
        op: "scale",
        scale: 2,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const kf = opacityKeyframes(host);
    expect(kf[kf.length - 1].time).toBeCloseTo(4, 5);
  });

  it("duplicates keyframes at an offset", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const before = opacityKeyframes(host).length;
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
        op: "duplicate",
        offset: 2,
      },
      host,
    );
    expect(res.ok).toBe(true);
    expect(opacityKeyframes(host).length).toBeGreaterThan(before);
  });

  it("rejects an unknown op with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
        op: "bogus",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("requires offset for duplicate", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
        op: "duplicate",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an unknown property with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "transform_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "totally.made.up",
        op: "reverse",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("copy_motion_keyframes / paste_motion_keyframes", () => {
  it("copies a property's keyframes into a clipboard payload", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "copy_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { entryCount?: number; sourceProperty?: string };
    expect(data.entryCount).toBe(3);
    expect(data.sourceProperty).toBe("transform.opacity");
  });

  it("pastes keyframes from one property to another with a time offset", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "paste_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        fromProperty: "transform.opacity",
        toProperty: "transform.scale.x",
        timeOffset: 1,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const scaleKf = shapeFrom(host, SHAPE_ID)
      .keyframes.filter((k) => k.property === "transform.scale.x")
      .sort((a, b) => a.time - b.time);
    expect(scaleKf.length).toBe(3);
    expect(scaleKf[0].time).toBeCloseTo(1, 5);
  });

  it("returns NOT_FOUND when the source property has no keyframes", async () => {
    const host = new HeadlessHost(projectWith(baseShape()));
    const res = await executeTool(
      "copy_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        property: "transform.opacity",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("rejects an unknown target property with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWith(animatedShape()));
    const res = await executeTool(
      "paste_motion_keyframes",
      {
        compositionId: COMP_ID,
        layerId: SHAPE_ID,
        fromProperty: "transform.opacity",
        toProperty: "not.a.prop",
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
