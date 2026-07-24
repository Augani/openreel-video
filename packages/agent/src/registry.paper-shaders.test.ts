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

interface ShaderInfo {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly collection: string | null;
  readonly params: readonly { readonly name: string; readonly type?: string }[];
}

interface ListShadersData {
  readonly fills?: readonly ShaderInfo[];
  readonly effects?: readonly ShaderInfo[];
  readonly text?: readonly ShaderInfo[];
}

function asListData(value: unknown): ListShadersData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected shader list data");
  }
  return value as ListShadersData;
}

interface AddShaderEffectData {
  readonly effectId?: string;
  readonly shaderId?: string;
  readonly params?: Record<string, number>;
}

function asAddEffectData(value: unknown): AddShaderEffectData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected add shader effect data");
  }
  return value as AddShaderEffectData;
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
    id: "comp-paper",
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
    .motionCompositions!.find((candidate) => candidate.id === "comp-paper")!;
  return comp.layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
}

describe("list_motion_shaders (Paper collection)", () => {
  it("returns paper fill defs carrying the Paper collection field", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("list_motion_shaders", {}, host);
    expect(res.ok).toBe(true);
    const data = asListData(res.data);

    const mesh = data.fills?.find((fill) => fill.id === "paper-mesh-gradient");
    expect(mesh).toBeDefined();
    expect(mesh!.category).toBe("fill");
    expect(mesh!.collection).toBe("Paper");

    const halftone = data.effects?.find((effect) => effect.id === "paper-halftone-dots");
    expect(halftone).toBeDefined();
    expect(halftone!.collection).toBe("Paper");
  });

  it("filters to only the Paper collection with collection='Paper'", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("list_motion_shaders", { collection: "Paper" }, host);
    expect(res.ok).toBe(true);
    const data = asListData(res.data);

    const allReturned = [
      ...(data.fills ?? []),
      ...(data.effects ?? []),
      ...(data.text ?? []),
    ];
    expect(allReturned.length).toBeGreaterThan(0);
    expect(allReturned.every((entry) => entry.collection === "Paper")).toBe(true);
    expect(data.fills?.some((fill) => fill.id === "liquid-metal")).toBeFalsy();
    expect(data.fills?.some((fill) => fill.id === "paper-mesh-gradient")).toBe(true);
  });

  it("returns an empty list (not an error) for an unknown collection", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool(
      "list_motion_shaders",
      { collection: "Nonexistent" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asListData(res.data);
    expect(data.fills ?? []).toEqual([]);
    expect(data.effects ?? []).toEqual([]);
    expect(data.text ?? []).toEqual([]);
  });

  it("combines category and collection filters", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool(
      "list_motion_shaders",
      { category: "fill", collection: "Paper" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asListData(res.data);
    expect(data.effects).toBeUndefined();
    expect(data.text).toBeUndefined();
    expect(data.fills!.length).toBeGreaterThan(0);
    expect(
      data.fills!.every((fill) => fill.category === "fill" && fill.collection === "Paper"),
    ).toBe(true);
  });
});

describe("paper shader fills + effects via MCP", () => {
  it("set_motion_shader_fill stores a paper fill with resolved defaults", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "set_motion_shader_fill",
      {
        compositionId: "comp-paper",
        layerId: "layer-shape",
        shaderId: "paper-mesh-gradient",
        params: { distortion: 0.4 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = shapeLayer(host);
    expect(layer.style.fill.type).toBe("shader");
    expect(layer.style.fill.shader?.shaderId).toBe("paper-mesh-gradient");
    expect(layer.style.fill.shader?.params.distortion).toBe(0.4);
    expect(layer.style.fill.shader?.params.swirl).toBe(0.6);
  });

  it("add_motion_shader_effect adds a paper effect shader", async () => {
    const host = new HeadlessHost(projectWithShape());
    const res = await executeTool(
      "add_motion_shader_effect",
      { compositionId: "comp-paper", layerId: "layer-shape", shaderId: "paper-halftone-dots" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asAddEffectData(res.data);
    expect(typeof data.effectId).toBe("string");
    const layer = shapeLayer(host);
    const effect = (layer.effects ?? []).find((candidate) => candidate.id === data.effectId);
    expect(effect).toBeDefined();
    expect(effect!.type).toBe("shader");
    expect((effect as { shaderId?: string }).shaderId).toBe("paper-halftone-dots");
    expect((effect as { params: Record<string, number> }).params.size).toBe(0.5);
  });

  it("keyframes a paper effect param via effect.<id>.<param>", async () => {
    const host = new HeadlessHost(projectWithShape());
    const added = await executeTool(
      "add_motion_shader_effect",
      { compositionId: "comp-paper", layerId: "layer-shape", shaderId: "paper-halftone-dots" },
      host,
    );
    expect(added.ok).toBe(true);
    const effectId = asAddEffectData(added.data).effectId!;
    const property = `effect.${effectId}.radius`;

    const first = await executeTool(
      "add_motion_keyframe",
      { compositionId: "comp-paper", layerId: "layer-shape", property, time: 0, value: 0.2 },
      host,
    );
    expect(first.ok).toBe(true);
    const second = await executeTool(
      "add_motion_keyframe",
      { compositionId: "comp-paper", layerId: "layer-shape", property, time: 1, value: 0.9 },
      host,
    );
    expect(second.ok).toBe(true);

    const layer = shapeLayer(host);
    const keyframes = getMotionLayerPropertyKeyframes(layer, property);
    expect(keyframes.length).toBe(2);
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([0, 1]);
    expect(keyframes.map((keyframe) => keyframe.value)).toEqual([0.2, 0.9]);
  });
});
