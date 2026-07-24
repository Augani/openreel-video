import { afterEach, describe, expect, it } from "vitest";
import { registerProjectGeneratedShaders } from "./project-shaders";
import {
  clearGeneratedMotionShaders,
  listGeneratedMotionShaders,
} from "./registry";
import { getMotionShaderDef } from "./index";
import type { MotionShaderDef } from "./types";

const defA: MotionShaderDef = {
  id: "ai-a-1",
  name: "AI A",
  category: "fill",
  glsl: "x",
  params: [],
  origin: "generated",
};

const defB: MotionShaderDef = {
  id: "ai-b-1",
  name: "AI B",
  category: "effect",
  glsl: "y",
  params: [],
  origin: "generated",
};

describe("registerProjectGeneratedShaders", () => {
  afterEach(() => clearGeneratedMotionShaders());

  it("registers each generated shader so getMotionShaderDef resolves", () => {
    registerProjectGeneratedShaders({ generatedShaders: [defA] });
    expect(getMotionShaderDef("ai-a-1")?.name).toBe("AI A");
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual(["ai-a-1"]);
  });

  it("clears the previous set on a subsequent call", () => {
    registerProjectGeneratedShaders({ generatedShaders: [defA] });
    registerProjectGeneratedShaders({ generatedShaders: [defB] });
    expect(getMotionShaderDef("ai-a-1")).toBeUndefined();
    expect(getMotionShaderDef("ai-b-1")?.name).toBe("AI B");
  });

  it("skips shaders colliding with a built-in id", () => {
    registerProjectGeneratedShaders({
      generatedShaders: [{ ...defA, id: "liquid-metal" }, defB],
    });
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual(["ai-b-1"]);
  });

  it("clears all when the project has no generated shaders", () => {
    registerProjectGeneratedShaders({ generatedShaders: [defA] });
    registerProjectGeneratedShaders({ generatedShaders: undefined });
    expect(listGeneratedMotionShaders()).toEqual([]);
  });

  it("isolates the registry across a switch between two distinct projects", () => {
    const projectA = { generatedShaders: [defA] };
    const projectB = { generatedShaders: [defB] };

    registerProjectGeneratedShaders(projectA);
    expect(getMotionShaderDef(defA.id)?.id).toBe(defA.id);

    registerProjectGeneratedShaders(projectB);
    expect(getMotionShaderDef(defA.id)).toBeUndefined();
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual([defB.id]);

    registerProjectGeneratedShaders({ generatedShaders: [] });
    expect(getMotionShaderDef(defB.id)).toBeUndefined();
    expect(listGeneratedMotionShaders()).toEqual([]);
  });
});
