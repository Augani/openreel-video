import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { DEFAULT_MOTION_TRANSFORM } from "@openreel/core/motion/types";
import type {
  MotionComposition,
  MotionLayer,
  MotionShapeLayer,
  MotionTextLayer,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

interface ShaderParamInfo {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step: number;
}

interface ShaderInfo {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly params: readonly ShaderParamInfo[];
}

interface ListShadersData {
  readonly fills?: readonly ShaderInfo[];
  readonly effects?: readonly ShaderInfo[];
}

function asData(value: unknown): ListShadersData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected shader list data");
  }
  return value as ListShadersData;
}

function assertParamShape(param: ShaderParamInfo): void {
  expect(typeof param.name).toBe("string");
  expect(typeof param.label).toBe("string");
  expect(typeof param.min).toBe("number");
  expect(typeof param.max).toBe("number");
  expect(typeof param.default).toBe("number");
  expect(typeof param.step).toBe("number");
}

describe("list_motion_shaders", () => {
  it("returns fill and effect shaders with full param descriptors", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("list_motion_shaders", {}, host);
    expect(res.ok).toBe(true);
    const data = asData(res.data);

    const liquidMetal = data.fills?.find((fill) => fill.id === "liquid-metal");
    expect(liquidMetal).toBeDefined();
    expect(liquidMetal!.params.length).toBeGreaterThan(0);
    liquidMetal!.params.forEach(assertParamShape);

    const pixelate = data.effects?.find((effect) => effect.id === "pixelate");
    expect(pixelate).toBeDefined();
    pixelate!.params.forEach(assertParamShape);
  });

  it("filters by category='fill'", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("list_motion_shaders", { category: "fill" }, host);
    expect(res.ok).toBe(true);
    const data = asData(res.data);
    expect(data.fills).toBeDefined();
    expect(data.effects).toBeUndefined();
    expect(data.fills!.every((fill) => fill.category === "fill")).toBe(true);
  });

  it("filters by category='effect'", async () => {
    const host = new HeadlessHost(makeEmptyProject());
    const res = await executeTool("list_motion_shaders", { category: "effect" }, host);
    expect(res.ok).toBe(true);
    const data = asData(res.data);
    expect(data.effects).toBeDefined();
    expect(data.fills).toBeUndefined();
    expect(data.effects!.every((effect) => effect.category === "effect")).toBe(true);
  });
});

function projectWithShapeAndText(): Project {
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
  const text: MotionTextLayer = {
    id: "layer-text",
    type: "text",
    name: "Text",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    text: "Hello",
    style: {
      fontFamily: "Inter",
      fontSize: 64,
      color: "#ffffff",
    },
  };
  const composition: MotionComposition = {
    id: "comp-fill",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [shape as MotionLayer, text as MotionLayer],
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
    .motionCompositions!.find((candidate) => candidate.id === "comp-fill")!;
  return comp.layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
}

function textLayer(host: HeadlessHost): MotionTextLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-fill")!;
  return comp.layers.find((layer) => layer.id === "layer-text") as MotionTextLayer;
}

describe("set_motion_shader_fill", () => {
  it("applies a shader fill to a shape layer with clamped params and drops unknowns", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_shader_fill",
      {
        compositionId: "comp-fill",
        layerId: "layer-shape",
        shaderId: "liquid-metal",
        params: { contrast: 2.5, bogus: 9 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = shapeLayer(host);
    expect(layer.style.fill.type).toBe("shader");
    expect(layer.style.fill.shader?.shaderId).toBe("liquid-metal");
    expect(layer.style.fill.shader?.params.contrast).toBe(2.5);
    expect(layer.style.fill.shader?.params).not.toHaveProperty("bogus");
    expect(layer.style.fill.opacity).toBe(0.8);
  });

  it("applies a shader fill to a text layer via fillShader", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-fill", layerId: "layer-text", shaderId: "watercolor" },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = textLayer(host);
    expect(layer.style.fillShader?.shaderId).toBe("watercolor");
  });

  it("rejects an unknown shaderId with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-fill", layerId: "layer-shape", shaderId: "not-a-shader" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("surfaces fill-shader params in list_motion_animatable_properties for discovery", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-fill", layerId: "layer-shape", shaderId: "liquid-metal" },
      host,
    );
    const res = await executeTool(
      "list_motion_animatable_properties",
      { compositionId: "comp-fill", layerId: "layer-shape" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = res.data as { properties?: readonly { property: string }[] };
    const ids = (data.properties ?? []).map((entry) => entry.property);
    expect(ids).toContain("shape.fill.shader.scale");
  });
});

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

describe("add_motion_shader_effect", () => {
  it("adds a shader effect to a shape layer and clamps params", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_shader_effect",
      { compositionId: "comp-fill", layerId: "layer-shape", shaderId: "pixelate" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asAddEffectData(res.data);
    expect(typeof data.effectId).toBe("string");
    const layer = shapeLayer(host);
    const effect = (layer.effects ?? []).find((candidate) => candidate.id === data.effectId);
    expect(effect).toBeDefined();
    expect(effect!.type).toBe("shader");
    expect((effect as { shaderId?: string }).shaderId).toBe("pixelate");
  });

  it("lets update_motion_effect edit a shader effect param", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const added = await executeTool(
      "add_motion_shader_effect",
      { compositionId: "comp-fill", layerId: "layer-shape", shaderId: "pixelate" },
      host,
    );
    expect(added.ok).toBe(true);
    const effectId = asAddEffectData(added.data).effectId!;
    const layerBefore = shapeLayer(host);
    const effectBefore = (layerBefore.effects ?? []).find(
      (candidate) => candidate.id === effectId,
    ) as { params: Record<string, number> };
    const paramName = Object.keys(effectBefore.params)[0];
    expect(paramName).toBeDefined();
    const target = effectBefore.params[paramName] + 1;
    const updated = await executeTool(
      "update_motion_effect",
      {
        compositionId: "comp-fill",
        layerId: "layer-shape",
        effectId,
        parameter: paramName,
        value: target,
      },
      host,
    );
    expect(updated.ok).toBe(true);
    const layerAfter = shapeLayer(host);
    const effectAfter = (layerAfter.effects ?? []).find(
      (candidate) => candidate.id === effectId,
    ) as { params: Record<string, number> };
    expect(effectAfter.params[paramName]).toBe(target);
  });

  it("rejects an unknown shaderId with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_shader_effect",
      { compositionId: "comp-fill", layerId: "layer-shape", shaderId: "not-a-shader" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
