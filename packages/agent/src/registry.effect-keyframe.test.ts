import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import { getMotionLayerPropertyKeyframes } from "@openreel/core/motion/motion-keyframes";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

interface AddShaderEffectData {
  readonly effectId?: string;
  readonly params?: Record<string, number>;
}

function asAddEffectData(value: unknown): AddShaderEffectData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected add shader effect data");
  }
  return value as AddShaderEffectData;
}

interface AnimatablePropertyEntry {
  readonly property: string;
}

interface ListAnimatableData {
  readonly properties?: readonly AnimatablePropertyEntry[];
}

function asListAnimatableData(value: unknown): ListAnimatableData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected animatable properties data");
  }
  return value as ListAnimatableData;
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
    id: "comp-effect-kf",
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
    .motionCompositions!.find((candidate) => candidate.id === "comp-effect-kf")!;
  return comp.layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
}

async function addPixelateEffect(host: HeadlessHost): Promise<string> {
  const added = await executeTool(
    "add_motion_shader_effect",
    { compositionId: "comp-effect-kf", layerId: "layer-shape", shaderId: "pixelate" },
    host,
  );
  expect(added.ok).toBe(true);
  const effectId = asAddEffectData(added.data).effectId;
  expect(typeof effectId).toBe("string");
  return effectId!;
}

function firstShaderParamName(host: HeadlessHost, effectId: string): string {
  const layer = shapeLayer(host);
  const effect = (layer.effects ?? []).find((candidate) => candidate.id === effectId) as {
    params: Record<string, number>;
  };
  const paramName = Object.keys(effect.params)[0];
  expect(paramName).toBeDefined();
  return paramName;
}

describe("shader effect param keyframing", () => {
  it("keyframes a shader effect param via add_motion_keyframe on effect.<id>.<param>", async () => {
    const host = new HeadlessHost(projectWithShape());
    const effectId = await addPixelateEffect(host);
    const paramName = firstShaderParamName(host, effectId);
    const property = `effect.${effectId}.${paramName}`;

    const first = await executeTool(
      "add_motion_keyframe",
      { compositionId: "comp-effect-kf", layerId: "layer-shape", property, time: 0, value: 4 },
      host,
    );
    expect(first.ok).toBe(true);

    const second = await executeTool(
      "add_motion_keyframe",
      { compositionId: "comp-effect-kf", layerId: "layer-shape", property, time: 1, value: 40 },
      host,
    );
    expect(second.ok).toBe(true);

    const layer = shapeLayer(host);
    const keyframes = getMotionLayerPropertyKeyframes(layer, property);
    expect(keyframes.length).toBe(2);
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0, 1]);
    expect(keyframes.map((keyframe) => keyframe.value)).toEqual([4, 40]);
  });

  it("surfaces shader effect params from list_motion_animatable_properties", async () => {
    const host = new HeadlessHost(projectWithShape());
    const effectId = await addPixelateEffect(host);
    const paramName = firstShaderParamName(host, effectId);
    const property = `effect.${effectId}.${paramName}`;

    const res = await executeTool(
      "list_motion_animatable_properties",
      { compositionId: "comp-effect-kf", layerId: "layer-shape" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asListAnimatableData(res.data);
    const propertyIds = (data.properties ?? []).map((entry) => entry.property);
    expect(propertyIds).toContain(property);
  });
});
