import type { MotionShaderDef } from "./types";
import { EFFECT_SHADERS } from "./effect-shaders";
import { FILL_SHADERS } from "./fill-shaders";
import { TEXT_SHADERS } from "./text-shaders";

const BUILTIN_SHADER_IDS: ReadonlySet<string> = new Set(
  [...EFFECT_SHADERS, ...FILL_SHADERS, ...TEXT_SHADERS].map((def) => def.id),
);

const generatedShaders = new Map<string, MotionShaderDef>();

export function registerMotionShader(def: MotionShaderDef): void {
  if (BUILTIN_SHADER_IDS.has(def.id)) {
    throw new Error("Cannot overwrite built-in shader: " + def.id);
  }
  generatedShaders.set(def.id, def);
}

export function unregisterMotionShader(id: string): void {
  generatedShaders.delete(id);
}

export function clearGeneratedMotionShaders(): void {
  generatedShaders.clear();
}

export function listGeneratedMotionShaders(): readonly MotionShaderDef[] {
  return [...generatedShaders.values()];
}

export function generatedShaderById(id: string): MotionShaderDef | undefined {
  return generatedShaders.get(id);
}

export function isBuiltinMotionShaderId(id: string): boolean {
  return BUILTIN_SHADER_IDS.has(id);
}
