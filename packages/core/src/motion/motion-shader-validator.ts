import { MotionShaderRenderer } from "./motion-shader-renderer";
import type { MotionShaderCategory } from "./shaders";

export type MotionShaderValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

let validationRenderer: MotionShaderRenderer | null = null;
let supportedCache: boolean | null = null;

function getValidationRenderer(): MotionShaderRenderer {
  if (!validationRenderer) validationRenderer = new MotionShaderRenderer();
  return validationRenderer;
}

function isWebglSupported(): boolean {
  if (supportedCache === null) {
    supportedCache = MotionShaderRenderer.isSupported();
  }
  return supportedCache;
}

function checkContract(
  glsl: string,
  category: MotionShaderCategory,
): MotionShaderValidationResult {
  if (typeof glsl !== "string" || glsl.trim().length === 0) {
    return { ok: false, error: "shader source is empty" };
  }
  if (!glsl.includes("#version 300 es")) {
    return { ok: false, error: "shader must declare #version 300 es" };
  }
  if (!/out\s+vec4\s+fragColor\b/.test(glsl)) {
    return { ok: false, error: "shader must declare out vec4 fragColor" };
  }
  const declaresInput = /uniform\s+sampler2D\s+u_input\b/.test(glsl);
  const referencesInput = /\bu_input\b/.test(glsl);
  if (category !== "fill" && !declaresInput) {
    return {
      ok: false,
      error: "shader must declare uniform sampler2D u_input",
    };
  }
  if (category === "text" && !/uniform\s+float\s+u_progress\b/.test(glsl)) {
    return { ok: false, error: "text shader must declare uniform float u_progress" };
  }
  if (category === "fill" && referencesInput) {
    return { ok: false, error: "fill shader must not reference u_input" };
  }
  return { ok: true };
}

export function validateMotionShaderSource(
  glsl: string,
  category: MotionShaderCategory,
): MotionShaderValidationResult {
  const contract = checkContract(glsl, category);
  if (!contract.ok) return contract;
  if (!isWebglSupported()) return { ok: true };
  return getValidationRenderer().validateFragmentSource(glsl);
}
