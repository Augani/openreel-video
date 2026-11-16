import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import {
  createMotionExpression,
  evaluateMotionPropertyValueAtTime,
} from "@openreel/core/motion/motion-expressions";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
  MotionExpression,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

interface AddControlData {
  readonly effectId?: string;
  readonly name?: string;
}

function asAddControlData(value: unknown): AddControlData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected add control data");
  }
  return value as AddControlData;
}

function projectWithShape(): Project {
  const shape: MotionShapeLayer = {
    id: "layer-shape",
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
    id: "comp-expr",
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

function shapeLayer(host: HeadlessHost): MotionShapeLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-expr")!;
  return comp.layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
}

function composition(host: HeadlessHost): MotionComposition {
  return host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-expr")!;
}

describe("add_motion_expression_control", () => {
  it("adds a slider control with default name and value", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_expression_control",
      { compositionId: "comp-expr", layerId: "layer-shape", controlType: "slider" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asAddControlData(res.data);
    expect(typeof data.effectId).toBe("string");
    expect(data.name).toBe("Slider Control");

    const layer = shapeLayer(host);
    const effect = (layer.effects ?? []).find((candidate) => candidate.id === data.effectId);
    expect(effect).toBeDefined();
    expect(effect!.type).toBe("slider-control");
  });

  it("drives an expression via effect(name)(\"value\") through the core engine", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_expression_control",
      {
        compositionId: "comp-expr",
        layerId: "layer-shape",
        controlType: "slider",
        name: "Opacity Driver",
        value: 0.5,
      },
      host,
    );
    expect(added.ok).toBe(true);

    const layer = shapeLayer(host);
    const comp = composition(host);
    const expression: MotionExpression = {
      ...createMotionExpression("expression", "transform.opacity", "expr-1"),
      code: 'effect("Opacity Driver")("value")',
    };
    const value = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [expression],
      property: "transform.opacity",
      localTime: 0,
      fallback: 1,
      duration: comp.duration,
      context: { composition: comp, layer },
    });
    expect(value).toBeCloseTo(0.5, 5);
  });

  it("auto-suffixes a duplicate control name and returns the resolved name", async () => {
    const host = new HeadlessHost(projectWithShape());
    const first = await executeTool(
      "add_motion_expression_control",
      { compositionId: "comp-expr", layerId: "layer-shape", controlType: "slider" },
      host,
    );
    expect(first.ok).toBe(true);
    expect(asAddControlData(first.data).name).toBe("Slider Control");

    const second = await executeTool(
      "add_motion_expression_control",
      { compositionId: "comp-expr", layerId: "layer-shape", controlType: "slider" },
      host,
    );
    expect(second.ok).toBe(true);
    expect(asAddControlData(second.data).name).toBe("Slider Control 2");

    const layer = shapeLayer(host);
    const names = (layer.effects ?? []).map((effect) => effect.name);
    expect(names).toContain("Slider Control");
    expect(names).toContain("Slider Control 2");
  });
});
