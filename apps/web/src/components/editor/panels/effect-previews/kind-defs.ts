import type {
  EmphasisAnimation,
  MotionShaderDef,
  ParticlePreset,
  TextAnimationParams,
  TextAnimationPreset,
  TextStyle,
  Transform,
} from "@openreel/core";
import type { MotionPresetTargetKind } from "../../../../services/motion-preset-application";
import type { MotionPreset } from "../../../../services/motion-presets";
import type { PreviewEffectDef, PreviewLoop } from "./preview-engine";

/**
 * Card definitions of the inspector previews (motion presets, text animation, emphasis, particles, shaders).
 * Pure data: the engines that draw them live in kind-renderers.ts, loaded on demand.
 */

/** Seconds the finished state is held at the end of a motion / text loop, so the restart reads as a restart. */
export const LOOP_HOLD_SECONDS = 0.5;

/** The text a text-driven card renders: the selected text clip's own string and style, or a stand-in title. */
export interface PreviewTextSource {
  readonly text: string;
  readonly style: TextStyle;
  /** The clip's own transform (position, scale, rotation); a stand-in title is centred. */
  readonly transform?: Transform;
}

/** The clip a motion preset would be applied to: the card keyframes it exactly as "apply" does. */
export interface MotionPreviewTarget {
  readonly transform: Transform;
  /** The clip's duration (bounds the preset and places exit / emphasis windows). */
  readonly clipDuration: number;
  readonly kind: MotionPresetTargetKind;
  /** The project canvas the relative slide offsets are computed against. */
  readonly canvas: { readonly width: number; readonly height: number };
}

export interface MotionPreviewPayload {
  readonly preset: MotionPreset;
  /** Seconds the preset runs (the duration slider). */
  readonly seconds: number;
  readonly target: MotionPreviewTarget;
}

export interface TextPreviewPayload {
  readonly source: PreviewTextSource;
  readonly preset: TextAnimationPreset;
  readonly side: "entry" | "exit";
  readonly inDuration: number;
  readonly outDuration: number;
  readonly params?: Partial<TextAnimationParams>;
}

export interface EmphasisPreviewPayload {
  readonly animation: EmphasisAnimation;
  /** Set when the selected clip is a text clip: the emphasis is drawn on that text, otherwise on the footage frame. */
  readonly source: PreviewTextSource | null;
}

export interface ParticlePreviewPayload {
  readonly preset: ParticlePreset;
}

export type ShaderPreviewSample = "text" | "effect";

export interface ShaderPreviewPayload {
  readonly def: MotionShaderDef;
  readonly sample: ShaderPreviewSample;
  readonly text: string;
  /** Text materials: the selected text clip's own string, style and transform, drawn by the title engine. */
  readonly source?: PreviewTextSource;
}

/** The progress "select a material" stores on style.shader, so the card shows what picking it produces. */
export const DEFAULT_TEXT_SHADER_PROGRESS = 0.5;

/** Stand-in title when no text clip is selected. */
export const DEFAULT_PREVIEW_TEXT = "Your Title";

/** Short stable fingerprint of a value, for card ids that must change with the user's text and style. */
export function fingerprint(value: unknown): string {
  const input = JSON.stringify(value) ?? "";
  let hash = 5381;
  for (let index = 0; index < input.length; index++) hash = (Math.imul(hash, 33) ^ input.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

const loop = (frames: number, seconds: number, posterSeconds: number): PreviewLoop => ({
  frames,
  seconds,
  posterProgress: Math.min(Math.max(posterSeconds / seconds, 0), 1),
});

/** Where inside a motion preset its poster is taken: mid-move for in/out and transitions, near the peak for emphasis. */
const MOTION_POSTER_SHARE: Record<MotionPreset["category"], number> = {
  entrance: 0.5,
  exit: 0.5,
  transition: 0.5,
  emphasis: 0.4,
};

export function motionPreviewDef(preset: MotionPreset, seconds: number, target: MotionPreviewTarget): PreviewEffectDef {
  const payload: MotionPreviewPayload = { preset, seconds, target };
  return {
    kind: "motion",
    type: "motion",
    id: `${preset.id}@${seconds.toFixed(2)}:${fingerprint(target)}`,
    payload,
    loop: loop(16, seconds + LOOP_HOLD_SECONDS, seconds * MOTION_POSTER_SHARE[preset.category]),
  };
}

export function textPreviewDef(
  source: PreviewTextSource,
  preset: TextAnimationPreset,
  side: "entry" | "exit",
  inDuration: number,
  outDuration: number,
): PreviewEffectDef {
  const payload: TextPreviewPayload = { source, preset, side, inDuration, outDuration };
  const seconds = (side === "entry" ? inDuration : outDuration) + LOOP_HOLD_SECONDS;
  const moving = side === "entry" ? inDuration * 0.55 : LOOP_HOLD_SECONDS + outDuration * 0.45;
  return {
    kind: "text",
    type: "text",
    id: `${side}:${preset}:${inDuration}:${outDuration}:${fingerprint(source)}`,
    payload,
    loop: loop(18, seconds, moving),
  };
}

export function emphasisPreviewDef(animation: EmphasisAnimation, source: PreviewTextSource | null): PreviewEffectDef {
  const payload: EmphasisPreviewPayload = { animation, source };
  return {
    kind: "emphasis",
    type: "emphasis",
    id: `${animation.type}:${animation.speed}:${animation.intensity}:${animation.loop}:${fingerprint(source)}`,
    payload,
    loop: loop(20, 2.4, 0.5),
  };
}

export function particlePreviewDef(preset: ParticlePreset): PreviewEffectDef {
  const payload: ParticlePreviewPayload = { preset };
  return { kind: "particles", type: "particles", id: preset.id, payload, loop: loop(20, 2, 0.9) };
}

export function shaderPreviewDef(
  def: MotionShaderDef,
  sample: ShaderPreviewSample,
  text: string,
  source?: PreviewTextSource,
): PreviewEffectDef {
  const payload: ShaderPreviewPayload = { def, sample, text, source };
  return {
    kind: "shader",
    type: "shader",
    id: `${def.id}:${sample}:${sample === "text" ? `${text}:${fingerprint(source)}` : ""}`,
    payload,
    loop: loop(12, 1.6, 0.72),
  };
}

/** The kinds drawn by kind-renderers.ts. */
export const isKindDef = (def: PreviewEffectDef): boolean =>
  def.kind === "motion" ||
  def.kind === "text" ||
  def.kind === "emphasis" ||
  def.kind === "particles" ||
  def.kind === "shader";
