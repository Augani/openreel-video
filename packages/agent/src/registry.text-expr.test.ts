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
  MotionTextAnimator,
  MotionExpression,
} from "@openreel/core/motion/types";
import type { Project } from "@openreel/core/types/project";

interface AddAnimatorData {
  readonly animatorId?: string;
}

interface AttachExpressionData {
  readonly expressionId?: string;
}

interface ExpressionErrorEntry {
  readonly layerId: string;
  readonly property: string;
  readonly expressionId: string;
  readonly error: string;
}

interface ListExpressionErrorsData {
  readonly errors?: readonly ExpressionErrorEntry[];
}

function asAddAnimatorData(value: unknown): AddAnimatorData {
  if (!value || typeof value !== "object") throw new Error("Expected animator data");
  return value as AddAnimatorData;
}

function asAttachExpressionData(value: unknown): AttachExpressionData {
  if (!value || typeof value !== "object") throw new Error("Expected expression data");
  return value as AttachExpressionData;
}

function asListExpressionErrorsData(value: unknown): ListExpressionErrorsData {
  if (!value || typeof value !== "object") throw new Error("Expected errors data");
  return value as ListExpressionErrorsData;
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
  const group: MotionLayer = {
    id: "layer-group",
    type: "group",
    name: "Group",
    startTime: 0,
    duration: 4,
    visible: true,
    locked: false,
    transform: DEFAULT_MOTION_TRANSFORM,
    keyframes: [],
    children: [],
  } as MotionLayer;
  const composition: MotionComposition = {
    id: "comp-tx",
    name: "Comp",
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 4,
    backgroundColor: "#101820",
    layers: [shape as MotionLayer, text as MotionLayer, group],
    assets: [],
    variables: [],
    markers: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  return { ...makeEmptyProject(), motionCompositions: [composition] } as unknown as Project;
}

function comp(host: HeadlessHost): MotionComposition {
  return host
    .getProject()
    .motionCompositions!.find((candidate) => candidate.id === "comp-tx")!;
}

function textLayer(host: HeadlessHost): MotionTextLayer {
  return comp(host).layers.find((layer) => layer.id === "layer-text") as MotionTextLayer;
}

function shapeLayer(host: HeadlessHost): MotionShapeLayer {
  return comp(host).layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
}

describe("set_motion_text_content", () => {
  it("replaces the source text string of a text layer", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_text_content",
      { compositionId: "comp-tx", layerId: "layer-text", text: "Goodbye world" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(textLayer(host).text).toBe("Goodbye world");
  });

  it("accepts an empty string", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_text_content",
      { compositionId: "comp-tx", layerId: "layer-text", text: "" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(textLayer(host).text).toBe("");
  });

  it("rejects a non-text layer with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_text_content",
      { compositionId: "comp-tx", layerId: "layer-shape", text: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects a missing text arg with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_text_content",
      { compositionId: "comp-tx", layerId: "layer-text" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown layer", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "set_motion_text_content",
      { compositionId: "comp-tx", layerId: "nope", text: "x" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

async function addAnimator(host: HeadlessHost): Promise<string> {
  const res = await executeTool(
    "add_motion_text_animator",
    { compositionId: "comp-tx", layerId: "layer-text", presetId: "text-reveal-up" },
    host,
  );
  expect(res.ok).toBe(true);
  return asAddAnimatorData(res.data).animatorId!;
}

function animatorById(host: HeadlessHost, id: string): MotionTextAnimator {
  const layer = textLayer(host);
  const found = (layer.textAnimators ?? []).find((animator) => animator.id === id);
  if (!found) throw new Error("animator not found");
  return found;
}

describe("update_motion_text_animator", () => {
  it("merges name, selector, timing, and properties", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const animatorId = await addAnimator(host);
    const res = await executeTool(
      "update_motion_text_animator",
      {
        compositionId: "comp-tx",
        layerId: "layer-text",
        animatorId,
        name: "Custom Reveal",
        selector: { basedOn: "words", start: 10, end: 80, offset: 5 },
        timing: {
          startTime: 0.2,
          duration: 0.6,
          stagger: 0.08,
          direction: "center",
          easing: "ease-in",
        },
        properties: {
          position: { x: 12, y: 48 },
          scale: { x: 0.5, y: 0.5 },
          rotation: 30,
          opacity: 0,
        },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const animator = animatorById(host, animatorId);
    expect(animator.name).toBe("Custom Reveal");
    expect(animator.selector.basedOn).toBe("words");
    expect(animator.selector.start).toBe(10);
    expect(animator.selector.end).toBe(80);
    expect(animator.selector.offset).toBe(5);
    expect(animator.timing.startTime).toBeCloseTo(0.2, 5);
    expect(animator.timing.duration).toBeCloseTo(0.6, 5);
    expect(animator.timing.stagger).toBeCloseTo(0.08, 5);
    expect(animator.timing.direction).toBe("center");
    expect(animator.timing.easing).toBe("ease-in");
    expect(animator.properties.position.x).toBe(12);
    expect(animator.properties.position.y).toBe(48);
    expect(animator.properties.scale.x).toBeCloseTo(0.5, 5);
    expect(animator.properties.rotation).toBe(30);
  });

  it("does partial merges leaving unspecified fields intact", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const animatorId = await addAnimator(host);
    const before = animatorById(host, animatorId);
    const res = await executeTool(
      "update_motion_text_animator",
      {
        compositionId: "comp-tx",
        layerId: "layer-text",
        animatorId,
        timing: { duration: 1.2 },
      },
      host,
    );
    expect(res.ok).toBe(true);
    const after = animatorById(host, animatorId);
    expect(after.timing.duration).toBeCloseTo(1.2, 5);
    expect(after.timing.stagger).toBeCloseTo(before.timing.stagger, 5);
    expect(after.timing.direction).toBe(before.timing.direction);
    expect(after.name).toBe(before.name);
  });

  it("routes enabled=false through the toggle path", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const animatorId = await addAnimator(host);
    const res = await executeTool(
      "update_motion_text_animator",
      { compositionId: "comp-tx", layerId: "layer-text", animatorId, enabled: false },
      host,
    );
    expect(res.ok).toBe(true);
    expect(animatorById(host, animatorId).enabled).toBe(false);
  });

  it("rejects an invalid selector.basedOn", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const animatorId = await addAnimator(host);
    const res = await executeTool(
      "update_motion_text_animator",
      {
        compositionId: "comp-tx",
        layerId: "layer-text",
        animatorId,
        selector: { basedOn: "syllables" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("rejects an invalid timing.easing", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const animatorId = await addAnimator(host);
    const res = await executeTool(
      "update_motion_text_animator",
      {
        compositionId: "comp-tx",
        layerId: "layer-text",
        animatorId,
        timing: { easing: "bounce" },
      },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown animatorId", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    await addAnimator(host);
    const res = await executeTool(
      "update_motion_text_animator",
      { compositionId: "comp-tx", layerId: "layer-text", animatorId: "nope", name: "X" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("rejects a non-text layer", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "update_motion_text_animator",
      { compositionId: "comp-tx", layerId: "layer-shape", animatorId: "x", name: "Y" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

describe("add_motion_text_animator overrides", () => {
  it("applies name, selector, timing, and properties overrides at creation", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "add_motion_text_animator",
      {
        compositionId: "comp-tx",
        layerId: "layer-text",
        presetId: "text-reveal-up",
        name: "Init Custom",
        selector: { basedOn: "words", start: 5, end: 90, offset: 2 },
        timing: { startTime: 0.1, duration: 0.8, stagger: 0.05, direction: "reverse", easing: "ease" },
        properties: { position: { x: 5, y: 100 }, scale: { x: 0.2, y: 0.2 }, rotation: 45, opacity: 0 },
        enabled: false,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const animatorId = asAddAnimatorData(res.data).animatorId!;
    const animator = animatorById(host, animatorId);
    expect(animator.name).toBe("Init Custom");
    expect(animator.selector.basedOn).toBe("words");
    expect(animator.timing.direction).toBe("reverse");
    expect(animator.properties.rotation).toBe(45);
    expect(animator.enabled).toBe(false);
  });
});

describe("clear_motion_shader_fill", () => {
  it("strips fillShader from a text layer", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const fillDefs = await executeTool("list_motion_shaders", { category: "fill" }, host);
    const fills = (fillDefs.data as { fills?: readonly { id: string }[] }).fills ?? [];
    const shaderId = fills[0]!.id;
    await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-text", shaderId },
      host,
    );
    expect(textLayer(host).style.fillShader).toBeDefined();
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-text" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(textLayer(host).style.fillShader).toBeUndefined();
  });

  it("resets a shape fill to solid keeping color", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const fillDefs = await executeTool("list_motion_shaders", { category: "fill" }, host);
    const fills = (fillDefs.data as { fills?: readonly { id: string }[] }).fills ?? [];
    const shaderId = fills[0]!.id;
    await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-shape", shaderId },
      host,
    );
    expect(shapeLayer(host).style.fill.type).toBe("shader");
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-shape" },
      host,
    );
    expect(res.ok).toBe(true);
    const fill = shapeLayer(host).style.fill;
    expect(fill.type).toBe("solid");
    expect(typeof fill.color).toBe("string");
    expect(fill.shader).toBeUndefined();
  });

  it("keeps an existing fill color when clearing the shader", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const fillDefs = await executeTool("list_motion_shaders", { category: "fill" }, host);
    const fills = (fillDefs.data as { fills?: readonly { id: string }[] }).fills ?? [];
    const shaderId = fills[0]!.id;
    await executeTool(
      "set_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-shape", shaderId },
      host,
    );
    const comp = host
      .getProject()
      .motionCompositions!.find((candidate) => candidate.id === "comp-tx")!;
    const shape = comp.layers.find((layer) => layer.id === "layer-shape") as MotionShapeLayer;
    const withColor: MotionShapeLayer = {
      ...shape,
      style: {
        ...shape.style,
        fill: { ...shape.style.fill, color: "#ff0000" },
      },
    };
    host.setProject({
      ...host.getProject(),
      motionCompositions: [
        { ...comp, layers: comp.layers.map((l) => (l.id === "layer-shape" ? withColor : l)) },
      ],
    } as unknown as Project);
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-shape" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(shapeLayer(host).style.fill.color).toBe("#ff0000");
  });

  it("is a no-op that succeeds when there is no shader fill", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-text" },
      host,
    );
    expect(res.ok).toBe(true);
    expect(textLayer(host).style.fillShader).toBeUndefined();
  });

  it("returns NOT_FOUND for a missing layer", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });

  it("rejects a layer that is neither shape nor text with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "clear_motion_shader_fill",
      { compositionId: "comp-tx", layerId: "layer-group" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });
});

async function attachWiggle(host: HeadlessHost): Promise<string> {
  const res = await executeTool(
    "attach_motion_expression",
    {
      compositionId: "comp-tx",
      layerId: "layer-shape",
      property: "transform.position.x",
      expressionType: "wiggle",
    },
    host,
  );
  expect(res.ok).toBe(true);
  return asAttachExpressionData(res.data).expressionId!;
}

function expressionById(host: HeadlessHost, id: string): MotionExpression {
  const layer = shapeLayer(host);
  const found = (layer.expressions ?? []).find((expression) => expression.id === id);
  if (!found) throw new Error("expression not found");
  return found;
}

describe("update_motion_expression", () => {
  it("patches amplitude, frequency, phase, seed, and decay", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const expressionId = await attachWiggle(host);
    const res = await executeTool(
      "update_motion_expression",
      {
        compositionId: "comp-tx",
        layerId: "layer-shape",
        expressionId,
        amplitude: 60,
        frequency: 0.5,
        phase: 1.5,
        seed: 7,
        decay: 0.9,
      },
      host,
    );
    expect(res.ok).toBe(true);
    const expression = expressionById(host, expressionId);
    expect(expression.amplitude).toBe(60);
    expect(expression.frequency).toBeCloseTo(0.5, 5);
    expect(expression.phase).toBeCloseTo(1.5, 5);
    expect(expression.seed).toBe(7);
    expect(expression.decay).toBeCloseTo(0.9, 5);
    expect(expression.id).toBe(expressionId);
  });

  it("patches code without changing the id or other params", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const expressionId = await attachWiggle(host);
    const before = expressionById(host, expressionId);
    const res = await executeTool(
      "update_motion_expression",
      {
        compositionId: "comp-tx",
        layerId: "layer-shape",
        expressionId,
        code: "value + 10",
      },
      host,
    );
    expect(res.ok).toBe(true);
    const after = expressionById(host, expressionId);
    expect(after.code).toBe("value + 10");
    expect(after.amplitude).toBe(before.amplitude);
    expect(after.id).toBe(expressionId);
  });

  it("returns NOT_FOUND for an unknown expressionId", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    await attachWiggle(host);
    const res = await executeTool(
      "update_motion_expression",
      { compositionId: "comp-tx", layerId: "layer-shape", expressionId: "nope", amplitude: 1 },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("toggle_motion_expression", () => {
  it("disables and re-enables an expression", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const expressionId = await attachWiggle(host);
    const off = await executeTool(
      "toggle_motion_expression",
      { compositionId: "comp-tx", layerId: "layer-shape", expressionId, enabled: false },
      host,
    );
    expect(off.ok).toBe(true);
    expect(expressionById(host, expressionId).enabled).toBe(false);

    const on = await executeTool(
      "toggle_motion_expression",
      { compositionId: "comp-tx", layerId: "layer-shape", expressionId, enabled: true },
      host,
    );
    expect(on.ok).toBe(true);
    expect(expressionById(host, expressionId).enabled).toBe(true);
  });

  it("rejects a non-boolean enabled with INVALID_PARAMS", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const expressionId = await attachWiggle(host);
    const res = await executeTool(
      "toggle_motion_expression",
      { compositionId: "comp-tx", layerId: "layer-shape", expressionId },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("returns NOT_FOUND for an unknown expressionId", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    await attachWiggle(host);
    const res = await executeTool(
      "toggle_motion_expression",
      { compositionId: "comp-tx", layerId: "layer-shape", expressionId: "nope", enabled: false },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});

describe("list_motion_expression_errors", () => {
  it("reports a compile error for a broken custom expression", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const attach = await executeTool(
      "attach_motion_expression",
      {
        compositionId: "comp-tx",
        layerId: "layer-shape",
        property: "transform.opacity",
        expressionType: "expression",
        code: "this is (not valid javascript",
      },
      host,
    );
    expect(attach.ok).toBe(true);
    const expressionId = asAttachExpressionData(attach.data).expressionId!;

    const res = await executeTool(
      "list_motion_expression_errors",
      { compositionId: "comp-tx" },
      host,
    );
    expect(res.ok).toBe(true);
    const data = asListExpressionErrorsData(res.data);
    const entry = (data.errors ?? []).find((item) => item.expressionId === expressionId);
    expect(entry).toBeDefined();
    expect(entry!.layerId).toBe("layer-shape");
    expect(entry!.property).toBe("transform.opacity");
    expect(typeof entry!.error).toBe("string");
    expect(entry!.error.length).toBeGreaterThan(0);
  });

  it("returns an empty list when no expressions have errors", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    await attachWiggle(host);
    const res = await executeTool(
      "list_motion_expression_errors",
      { compositionId: "comp-tx" },
      host,
    );
    expect(res.ok).toBe(true);
    expect((asListExpressionErrorsData(res.data).errors ?? []).length).toBe(0);
  });

  it("returns NOT_FOUND for an unknown composition", async () => {
    const host = new HeadlessHost(projectWithShapeAndText());
    const res = await executeTool(
      "list_motion_expression_errors",
      { compositionId: "nope" },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});
