import { describe, expect, it } from "vitest";
import { MotionShaderRenderer } from "./motion-shader-renderer";
import type { MotionShaderRenderInput } from "./motion-shader-renderer";
import { getMotionShaderDef } from "./shaders";

describe("MotionShaderRenderer", () => {
  it("returns null (safe fallback) when WebGL2 is unavailable, without throwing", () => {
    const r = new MotionShaderRenderer();
    const out = r.render(getMotionShaderDef("dither")!, {
      width: 64,
      height: 64,
      time: 0,
      params: { levels: 4, scale: 1 },
    });
    expect(out).toBeNull();
    r.dispose();
  });

  it("accepts a progress input and returns null without throwing when WebGL2 is unavailable", () => {
    const r = new MotionShaderRenderer();
    const input: MotionShaderRenderInput = {
      width: 4,
      height: 4,
      time: 0,
      progress: 0.5,
      params: {},
    };
    const out = r.render(getMotionShaderDef("dither")!, input);
    expect(out).toBeNull();
    r.dispose();
  });
});
