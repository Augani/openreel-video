import { describe, expect, it } from "vitest";
import { MotionShaderRenderer } from "./motion-shader-renderer";
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

});
