/**
 * The heavy half of the VR / 360 effects: the CPU reference, the stored-params -> shader-uniforms mapping and the GLSL
 * of all nine effects. Never imported statically by app code: vr-runtime-loader.ts loads it with a dynamic import the
 * first time a VR effect is rendered, and it registers itself there when evaluated.
 */
import { VR_GLSL } from "./vr-effect-shaders";
import { VR_IMAGE_GLSL } from "./vr-image-effect-shaders";
import { VR_UNIFORMS, applyVrEffect, vrEffectGpuUniforms } from "./vr-effects";
import { VR_IMAGE_UNIFORMS, applyVrImageEffect, vrImageEffectGpuUniforms } from "./vr-image-effects";
import { registerVrRuntime, type VrRuntime } from "./vr-runtime-loader";

export const vrRuntime: VrRuntime = {
  applyVrEffect,
  applyVrImageEffect,
  vrEffectGpuUniforms,
  vrImageEffectGpuUniforms,
  glsl: { ...VR_GLSL, ...VR_IMAGE_GLSL },
  uniforms: { ...VR_UNIFORMS, ...VR_IMAGE_UNIFORMS },
};

registerVrRuntime(vrRuntime);
