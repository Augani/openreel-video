import { describe, expect, it } from "vitest";
import { buildLayerBlendShader, resolveLayerBlendMode, withoutBlendEffects } from "./webgpu-layer-blend";
import { MOTION_GPU_BLEND_INDEX } from "../motion/motion-gpu-blend";
import { BLEND_MODES } from "./types";

const effect = (type: string, params: Record<string, unknown> = {}, enabled = true) => ({ id: type, type, enabled, params });

describe("WebGPU layer blend handler", () => {
  it("resolves an explicit blend mode and a `blend` effect to the same mode", () => {
    expect(resolveLayerBlendMode({ blendMode: "linear-burn", effects: [] })).toBe("linear-burn");
    expect(resolveLayerBlendMode({ effects: [effect("blend", { mode: "dissolve" })] })).toBe("dissolve");
    expect(resolveLayerBlendMode({ effects: [effect("blend", { mode: "divide" }, false)] })).toBe("normal");
    expect(resolveLayerBlendMode({ effects: [effect("blend", { mode: "nonsense" })] })).toBe("normal");
    expect(resolveLayerBlendMode({ effects: [] })).toBe("normal");
  });

  it("keeps the blend marker out of the per-layer effect chain (the renderer composites it)", () => {
    const kept = withoutBlendEffects([effect("blur"), effect("blend", { mode: "subtract" }), effect("brightness")]);
    expect(kept.map((e) => e.type)).toEqual(["blur", "brightness"]);
  });

  it("the shader uses the shared WGSL blend and every mode has a GPU index", () => {
    const wgsl = buildLayerBlendShader();
    expect(wgsl).toContain("fn motionComposite");
    expect(wgsl).toContain("textureLoad(backdropTex");
    for (const mode of BLEND_MODES) expect(MOTION_GPU_BLEND_INDEX[mode]).toBeTypeOf("number");
  });
});
