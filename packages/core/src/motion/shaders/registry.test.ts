import { afterEach, describe, expect, it } from "vitest";
import {
  registerMotionShader,
  unregisterMotionShader,
  clearGeneratedMotionShaders,
  listGeneratedMotionShaders,
} from "./registry";
import { getMotionShaderDef, getMotionShaderFillDefs } from "./index";

const def = {
  id: "ai-test-1",
  name: "AI Test",
  category: "fill" as const,
  glsl: "x",
  params: [],
  origin: "generated" as const,
};

describe("motion shader registry", () => {
  afterEach(() => clearGeneratedMotionShaders());

  it("registers a runtime shader resolvable via getMotionShaderDef + category getters", () => {
    registerMotionShader(def);
    expect(getMotionShaderDef("ai-test-1")?.name).toBe("AI Test");
    expect(getMotionShaderFillDefs().some((d) => d.id === "ai-test-1")).toBe(true);
    expect(listGeneratedMotionShaders().map((d) => d.id)).toEqual(["ai-test-1"]);
    unregisterMotionShader("ai-test-1");
    expect(getMotionShaderDef("ai-test-1")).toBeUndefined();
  });

  it("refuses to overwrite a built-in id", () => {
    expect(() => registerMotionShader({ ...def, id: "liquid-metal" })).toThrow();
  });
});
