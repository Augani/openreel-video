import { describe, it, expect, afterEach } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { makeEmptyProject } from "./test-fixtures";
import { clearGeneratedMotionShaders } from "@openreel/core/motion/shaders";
import type { Project } from "@openreel/core/types/project";

interface ShaderParamInfo {
  readonly name: string;
  readonly label: string;
}

interface ShaderInfo {
  readonly id: string;
  readonly category: string;
  readonly name: string;
  readonly params?: readonly ShaderParamInfo[];
}

interface ListAiShadersData {
  readonly shaders?: readonly ShaderInfo[];
}

interface ListMotionShadersData {
  readonly fills?: readonly ShaderInfo[];
  readonly effects?: readonly ShaderInfo[];
  readonly text?: readonly ShaderInfo[];
}

interface CreateAiShaderData {
  readonly shaderId?: string;
  readonly category?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Expected object data");
  }
  return value as Record<string, unknown>;
}

function project(): Project {
  return makeEmptyProject() as unknown as Project;
}

const VALID_FILL_GLSL = [
  "#version 300 es",
  "precision highp float;",
  "in vec2 vUv;",
  "out vec4 fragColor;",
  "void main(){ fragColor = vec4(vUv, 0.0, 1.0); }",
].join("\n");

const FILL_SAMPLING_INPUT = [
  "#version 300 es",
  "precision highp float;",
  "in vec2 vUv;",
  "uniform sampler2D u_input;",
  "out vec4 fragColor;",
  "void main(){ fragColor = texture(u_input, vUv); }",
].join("\n");

const VALID_EFFECT_GLSL = [
  "#version 300 es",
  "precision highp float;",
  "in vec2 vUv;",
  "uniform sampler2D u_input;",
  "out vec4 fragColor;",
  "void main(){ vec4 c = texture(u_input, vUv); fragColor = vec4(1.0 - c.rgb, c.a); }",
].join("\n");

const VALID_TEXT_GLSL = [
  "#version 300 es",
  "precision highp float;",
  "in vec2 vUv;",
  "uniform sampler2D u_input;",
  "uniform float u_progress;",
  "out vec4 fragColor;",
  "void main(){ vec4 c = texture(u_input, vUv); fragColor = vec4(c.rgb, c.a * u_progress); }",
].join("\n");

afterEach(() => clearGeneratedMotionShaders());

describe("create_ai_shader", () => {
  it("registers a contract-valid fill shader and lists it everywhere", async () => {
    const host = new HeadlessHost(project());
    const created = await executeTool(
      "create_ai_shader",
      { name: "Holographic Foil", category: "fill", glsl: VALID_FILL_GLSL, params: [] },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = asRecord(created.data) as CreateAiShaderData;
    expect(typeof createdData.shaderId).toBe("string");
    expect(createdData.shaderId!.startsWith("ai-")).toBe(true);
    expect(createdData.category).toBe("fill");

    const listAi = await executeTool("list_ai_shaders", {}, host);
    expect(listAi.ok).toBe(true);
    const aiData = asRecord(listAi.data) as ListAiShadersData;
    expect(aiData.shaders?.some((s) => s.id === createdData.shaderId)).toBe(true);

    const listMotion = await executeTool("list_motion_shaders", { category: "fill" }, host);
    expect(listMotion.ok).toBe(true);
    const motionData = asRecord(listMotion.data) as ListMotionShadersData;
    expect(motionData.fills?.some((s) => s.id === createdData.shaderId)).toBe(true);
  });

  it("registers a contract-valid effect shader and lists it under effects", async () => {
    const host = new HeadlessHost(project());
    const created = await executeTool(
      "create_ai_shader",
      { name: "Invert Pass", category: "effect", glsl: VALID_EFFECT_GLSL, params: [] },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = asRecord(created.data) as CreateAiShaderData;
    expect(createdData.category).toBe("effect");

    const listMotion = await executeTool("list_motion_shaders", { category: "effect" }, host);
    expect(listMotion.ok).toBe(true);
    const motionData = asRecord(listMotion.data) as ListMotionShadersData;
    expect(motionData.effects?.some((s) => s.id === createdData.shaderId)).toBe(true);
  });

  it("registers a contract-valid text shader and lists it under text", async () => {
    const host = new HeadlessHost(project());
    const created = await executeTool(
      "create_ai_shader",
      { name: "Fade Glyphs", category: "text", glsl: VALID_TEXT_GLSL, params: [] },
      host,
    );
    expect(created.ok).toBe(true);
    const createdData = asRecord(created.data) as CreateAiShaderData;
    expect(createdData.category).toBe("text");

    const listMotion = await executeTool("list_motion_shaders", { category: "text" }, host);
    expect(listMotion.ok).toBe(true);
    const motionData = asRecord(listMotion.data) as ListMotionShadersData;
    expect(motionData.text?.some((s) => s.id === createdData.shaderId)).toBe(true);
  });

  it("fails with INVALID_PARAMS when a fill shader samples u_input", async () => {
    const host = new HeadlessHost(project());
    const res = await executeTool(
      "create_ai_shader",
      { name: "Bad Fill", category: "fill", glsl: FILL_SAMPLING_INPUT, params: [] },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("fails with INVALID_PARAMS for an unknown category", async () => {
    const host = new HeadlessHost(project());
    const res = await executeTool(
      "create_ai_shader",
      { name: "X", category: "bogus", glsl: VALID_FILL_GLSL, params: [] },
      host,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("INVALID_PARAMS");
  });

  it("normalizes and clamps params, rejecting malformed entries", async () => {
    const host = new HeadlessHost(project());
    const bad = await executeTool(
      "create_ai_shader",
      {
        name: "Missing Label",
        category: "fill",
        glsl: VALID_FILL_GLSL,
        params: [{ name: "amount", min: 0, max: 1, default: 0.5 }],
      },
      host,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("INVALID_PARAMS");

    const good = await executeTool(
      "create_ai_shader",
      {
        name: "Good Params",
        category: "fill",
        glsl: VALID_FILL_GLSL,
        params: [{ name: "amount", label: "Amount", min: 0, max: 1, default: 5, step: 0.01 }],
      },
      host,
    );
    expect(good.ok).toBe(true);
  });

  it("strips a leading u_ from a param name so the uniform binds", async () => {
    const host = new HeadlessHost(project());
    const created = await executeTool(
      "create_ai_shader",
      {
        name: "Prefixed Params",
        category: "fill",
        glsl: VALID_FILL_GLSL,
        params: [{ name: "u_amount", label: "Amount", min: 0, max: 1, default: 0.5, step: 0.01 }],
      },
      host,
    );
    expect(created.ok).toBe(true);
    const shaderId = (asRecord(created.data) as CreateAiShaderData).shaderId!;

    const listAi = await executeTool("list_ai_shaders", {}, host);
    const aiData = asRecord(listAi.data) as ListAiShadersData;
    const entry = aiData.shaders?.find((s) => s.id === shaderId);
    expect(entry?.params?.map((p) => p.name)).toEqual(["amount"]);
  });
});

describe("remove_ai_shader", () => {
  it("removes a previously created shader", async () => {
    const host = new HeadlessHost(project());
    const created = await executeTool(
      "create_ai_shader",
      { name: "Temp", category: "fill", glsl: VALID_FILL_GLSL, params: [] },
      host,
    );
    expect(created.ok).toBe(true);
    const shaderId = (asRecord(created.data) as CreateAiShaderData).shaderId!;

    const removed = await executeTool("remove_ai_shader", { shaderId }, host);
    expect(removed.ok).toBe(true);

    const listAi = await executeTool("list_ai_shaders", {}, host);
    const aiData = asRecord(listAi.data) as ListAiShadersData;
    expect(aiData.shaders?.some((s) => s.id === shaderId)).toBe(false);
  });

  it("fails with NOT_FOUND for an unknown shaderId", async () => {
    const host = new HeadlessHost(project());
    const res = await executeTool("remove_ai_shader", { shaderId: "ai-does-not-exist-0000" }, host);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("NOT_FOUND");
  });
});
