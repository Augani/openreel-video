import { describe, it, expect } from "vitest";
import { validateMotionShaderSource } from "./motion-shader-validator";

describe("validateMotionShaderSource", () => {
  it("passes a contract-valid fill shader (compile skipped in jsdom)", () => {
    const glsl =
      "#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(vUv, 0.0, 1.0); }";
    expect(validateMotionShaderSource(glsl, "fill").ok).toBe(true);
  });

  it("rejects a fill shader that samples u_input", () => {
    const glsl =
      "#version 300 es\nin vec2 vUv;\nuniform sampler2D u_input;\nout vec4 fragColor;\nvoid main(){ fragColor = texture(u_input, vUv); }";
    const r = validateMotionShaderSource(glsl, "fill");
    expect(r.ok).toBe(false);
  });

  it("rejects an effect shader missing u_input and a text shader missing u_progress", () => {
    const noInput =
      "#version 300 es\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(1.0); }";
    expect(validateMotionShaderSource(noInput, "effect").ok).toBe(false);
    const noProgress =
      "#version 300 es\nin vec2 vUv;\nuniform sampler2D u_input;\nout vec4 fragColor;\nvoid main(){ fragColor = texture(u_input, vUv); }";
    expect(validateMotionShaderSource(noProgress, "text").ok).toBe(false);
  });

  it("rejects a shader missing #version 300 es", () => {
    const glsl =
      "precision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nvoid main(){ fragColor = vec4(1.0); }";
    expect(validateMotionShaderSource(glsl, "fill").ok).toBe(false);
  });

  it("rejects a shader missing out vec4 fragColor", () => {
    const glsl = "#version 300 es\nin vec2 vUv;\nvoid main(){}";
    expect(validateMotionShaderSource(glsl, "fill").ok).toBe(false);
  });
});
