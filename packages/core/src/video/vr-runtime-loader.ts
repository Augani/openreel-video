/**
 * The lazy half of the VR / 360 effects. The specs (labels, ranges, defaults, neutral values) are small and live in
 * vr-effect-specs.ts / vr-image-effect-specs.ts, so the Effects panel, project load and the agent see the nine VR effects
 * without the heavy part. What is heavy (the CPU reference, the shader-uniform mapping and the GLSL, about 100 KB)
 * lives in vr-runtime.ts and is loaded here with one dynamic import the first time a VR effect is rendered.
 *
 * Contract for the render path: `await ensureVrRuntimeFor(effects)` before drawing a stack that may hold a VR effect
 * (the video effects engine does this inside its async pixel pass, so preview, scrub, render cache and export all wait
 * for the first load and none of them can draw a frame without the effect). The synchronous entry points
 * (`applyProEffect`, `proEffectGpuUniforms`, the shader def of a VR effect) throw `VrRuntimeNotLoadedError` instead
 * of silently returning the unprocessed picture. `preloadVrRuntimeForProject` loads it ahead of time when a project
 * already holds a VR effect, so the first frame does not wait.
 */
import type { ResolvedProParams } from "./pro-effects";
import { isVrProEffectType, type VrProEffectType } from "./vr-effect-specs";
import { isVrImageEffectType, type VrImageEffectType } from "./vr-image-effect-specs";

/** What vr-runtime.ts provides once loaded. */
export interface VrRuntime {
  readonly applyVrEffect: (type: string, resolved: ResolvedProParams, data: Uint8ClampedArray, width: number, height: number) => boolean;
  readonly applyVrImageEffect: (type: string, resolved: ResolvedProParams, data: Uint8ClampedArray, width: number, height: number) => boolean;
  readonly vrEffectGpuUniforms: (type: VrProEffectType, resolved: ResolvedProParams) => Record<string, number>;
  readonly vrImageEffectGpuUniforms: (type: VrImageEffectType, resolved: ResolvedProParams) => Record<string, number>;
  /** GLSL fragment source per VR effect type. */
  readonly glsl: Readonly<Record<string, string>>;
  /** Uniform names (without `u_`) per VR effect type. */
  readonly uniforms: Readonly<Record<string, readonly string[]>>;
}

export class VrRuntimeNotLoadedError extends Error {
  constructor(type: string) {
    super(`The VR effects runtime is not loaded (needed for "${type}"); await loadVrRuntime() first`);
    this.name = "VrRuntimeNotLoadedError";
  }
}

let runtime: VrRuntime | null = null;
let pending: Promise<VrRuntime> | null = null;
const listeners = new Set<(rt: VrRuntime) => void>();

/** Called by vr-runtime.ts when it is evaluated. */
export function registerVrRuntime(rt: VrRuntime): void {
  if (runtime === rt) return;
  runtime = rt;
  for (const listener of [...listeners]) listener(rt);
}

/** Calls `listener` once the runtime is registered (immediately when it already is). Returns an unsubscribe. */
export function onVrRuntime(listener: (rt: VrRuntime) => void): () => void {
  if (runtime) {
    listener(runtime);
    return () => undefined;
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVrRuntime(): VrRuntime | null {
  return runtime;
}

export function isVrRuntimeLoaded(): boolean {
  return runtime !== null;
}

/** The loaded runtime, or throws `VrRuntimeNotLoadedError`. */
export function requireVrRuntime(type: string): VrRuntime {
  if (!runtime) throw new VrRuntimeNotLoadedError(type);
  return runtime;
}

/** Loads the runtime (once; a failed load can be retried). */
export function loadVrRuntime(): Promise<VrRuntime> {
  if (runtime) return Promise.resolve(runtime);
  pending ??= import("./vr-runtime").then(
    () => {
      if (!runtime) throw new Error("The VR effects runtime did not register itself");
      return runtime;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/** True for any of the nine VR effect types. */
export function isVrEffectType(type: string): boolean {
  return isVrProEffectType(type) || isVrImageEffectType(type);
}

/** Resolves once the runtime is loaded when any of `effects` is a VR effect; resolves at once otherwise. */
export function ensureVrRuntimeFor(effects: readonly { readonly type: string }[]): Promise<void> | void {
  if (runtime) return;
  for (const effect of effects) {
    if (isVrEffectType(effect.type)) return loadVrRuntime().then(() => undefined);
  }
}

interface EffectHolder {
  readonly effects?: readonly { readonly type: string }[];
}

/**
 * Starts loading the runtime when a project already holds a VR effect on a clip (or a track-level effect list), so
 * the first frame does not wait for it. Cheap to call on every project change: one pass over the clips, and nothing
 * once the runtime is loaded.
 */
export function preloadVrRuntimeForProject(project: {
  readonly timeline?: { readonly tracks?: readonly (EffectHolder & { readonly clips?: readonly EffectHolder[] })[] };
}): void {
  if (runtime || pending) return;
  for (const track of project.timeline?.tracks ?? []) {
    if (track.effects?.some((e) => isVrEffectType(e.type))) {
      void loadVrRuntime().catch(() => undefined);
      return;
    }
    for (const clip of track.clips ?? []) {
      if (clip.effects?.some((e) => isVrEffectType(e.type))) {
        void loadVrRuntime().catch(() => undefined);
        return;
      }
    }
  }
}
