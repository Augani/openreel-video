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
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

interface ShaderInfo {
  readonly id: string;
  readonly category: string;
  readonly params: readonly ShaderParamInfo[];
}

interface ListShadersData {
  readonly fills?: readonly ShaderInfo[];
  readonly effects?: readonly ShaderInfo[];
  readonly text?: readonly ShaderInfo[];
}

interface AddTextShaderData {
  readonly animatorId?: string;
  readonly shaderId?: string;
  readonly params?: Record<string, number>;
}

function asListData(value: unknown): ListShadersData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected shader list data");
  }
  return value as ListShadersData;
}

function asAddData(value: unknown): AddTextShaderData {
  if (!value || typeof value !== "object") {
    throw new Error("Expected add text shader data");
  }
  return value as AddTextShaderData;
}

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
    id: "comp-text",
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

function textLayer(host: HeadlessHost): MotionTextLayer {
  const comp = host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-text")!;
  return comp.layers.find((layer) => layer.id === "layer-text") as MotionTextLayer;
}

describe("list_motion_shaders text category", () => {
  it("includes text shaders in the default listing", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool("list_motion_shaders", {}, host);
    expect(res.ok).toBe(true);
    const data = asListData(res.data);
    const dissolve = data.text?.find((shader) => shader.id === "glyph-dissolve");
    expect(dissolve).toBeDefined();
    expect(dissolve!.category).toBe("text");
    expect(dissolve!.params.length).toBeGreaterThan(0);
  });

  it("filters by category='text'", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool("list_motion_shaders", { category: "text" }, host);
    expect(res.ok).toBe(true);
    const data = asListData(res.data);
    expect(data.text).toBeDefined();
    expect(data.fills).toBeUndefined();
    expect(data.effects).toBeUndefined();
    expect(data.text!.every((shader) => shader.category === "text")).toBe(true);
  });
});

describe("add_motion_text_shader_animator", () => {
  it("adds a text shader animator to a text layer with clamped params", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_shader_animator",
      {
        compositionId: "comp-text",
        layerId: "layer-text",
        shaderId: "glyph-dissolve",
        params: { edgeWidth: 0.2, bogus: 9 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asAddData(res.data);
    expect(typeof data.animatorId).toBe("string");
    expect(data.shaderId).toBe("glyph-dissolve");
    const layer = textLayer(host);
    const animator = (layer.textAnimators ?? []).find(
      (candidate) => candidate.id === data.animatorId,
    );
    expect(animator).toBeDefined();
    expect(animator!.shader?.shaderId).toBe("glyph-dissolve");
    expect(animator!.shader?.params.edgeWidth).toBe(0.2);
    expect(animator!.shader?.params).not.toHaveProperty("bogus");
  });

  it("applies optional stagger and duration onto the animator timing", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_shader_animator",
      {
        compositionId: "comp-text",
        layerId: "layer-text",
        shaderId: "glyph-glow-wave",
        stagger: 0.08,
        duration: 0.9,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const layer = textLayer(host);
    const animator = (layer.textAnimators ?? []).find(
      (candidate) => candidate.id === asAddData(res.data).animatorId,
    );
    expect(animator).toBeDefined();
    expect(animator!.timing.stagger).toBe(0.08);
    expect(animator!.timing.duration).toBe(0.9);
  });

  it("updates the existing shader animator instead of appending when called twice", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const first = await executeTool(
      "add_motion_text_shader_animator",
      {
        compositionId: "comp-text",
        layerId: "layer-text",
        shaderId: "glyph-dissolve",
        params: { edgeWidth: 0.2 },
      },
      host,
    );
    expect(first.ok).toBe(true);
    const firstId = asAddData(first.data).animatorId;

    const second = await executeTool(
      "add_motion_text_shader_animator",
      {
        compositionId: "comp-text",
        layerId: "layer-text",
        shaderId: "glyph-glow-wave",
        params: { intensity: 0.5 },
      },
      host,
    );
    expect(second.ok).toBe(true);
    expect(asAddData(second.data).animatorId).toBe(firstId);
    expect(asAddData(second.data).shaderId).toBe("glyph-glow-wave");

    const layer = textLayer(host);
    const shaderAnimators = (layer.textAnimators ?? []).filter(
      (candidate) => candidate.enabled && candidate.shader !== undefined,
    );
    expect(shaderAnimators).toHaveLength(1);
    expect(shaderAnimators[0]!.id).toBe(firstId);
    expect(shaderAnimators[0]!.shader?.shaderId).toBe("glyph-glow-wave");
  });

  it("rejects a non-text layer with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_shader_animator",
      { compositionId: "comp-text", layerId: "layer-shape", shaderId: "glyph-dissolve" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an unknown shaderId with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_shader_animator",
      { compositionId: "comp-text", layerId: "layer-text", shaderId: "not-a-shader" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a non-text-category shaderId with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_shader_animator",
      { compositionId: "comp-text", layerId: "layer-text", shaderId: "liquid-metal" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});
