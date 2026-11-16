import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Effect, Keyframe } from "../../types/timeline";
import type { MutableClip } from "../../utils/immutable-updates";
import type { EffectPreset } from "../../video/effect-presets";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";
import { findClip, patchClip } from "./clip-helpers";

/**
 * effect/setStackState replaces a clip's effect stack AND keyframes in one
 * undo step. Applying a preset or duplicating an animated effect must touch
 * both, and two separate actions would leave a half-applied state in history.
 */
const effectSetStackState: ActionHandler = {
  type: "effect/setStackState",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: unknown; effects?: unknown; keyframes?: unknown };
    const errors = [];
    if (typeof params.clipId !== "string" || !findClip(project, params.clipId)) {
      errors.push({ code: "CLIP_NOT_FOUND", message: `Clip not found: ${String(params.clipId)}` });
    }
    if (!Array.isArray(params.effects)) {
      errors.push({ code: "INVALID_PARAMS", message: "effects must be an array" });
    } else {
      const ids = params.effects.map((effect) => (effect as { id?: unknown }).id);
      if (!ids.every((id) => typeof id === "string" && id) || new Set(ids).size !== ids.length) {
        errors.push({ code: "INVALID_PARAMS", message: "effects need unique string ids" });
      }
    }
    if (!Array.isArray(params.keyframes)) {
      errors.push({ code: "INVALID_PARAMS", message: "keyframes must be an array" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { clipId: string; effects: Effect[]; keyframes: Keyframe[] };
    patchClip(project, params.clipId, {
      effects: structuredClone(params.effects) as MutableClip["effects"],
      keyframes: structuredClone(params.keyframes) as MutableClip["keyframes"],
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { clipId: string };
    const clip = findClip(projectBefore, params.clipId);
    if (!clip) return null;
    return {
      type: "effect/setStackState",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        clipId: params.clipId,
        effects: structuredClone(clip.effects),
        keyframes: structuredClone(clip.keyframes),
      },
    };
  },
};

/** effectPreset/setAll replaces the project's preset library (save, rename, delete, import). */
const effectPresetSetAll: ActionHandler = {
  type: "effectPreset/setAll",
  validate(action: Action): ValidationResult {
    const presets = (action.params as { presets?: unknown }).presets;
    const valid =
      Array.isArray(presets) &&
      presets.every((preset) => typeof (preset as EffectPreset)?.id === "string" && (preset as EffectPreset).id) &&
      new Set(presets.map((preset) => (preset as EffectPreset).id)).size === presets.length;
    return {
      valid,
      errors: valid ? [] : [{ code: "INVALID_PARAMS", message: "presets must be an array with unique ids" }],
    };
  },
  apply(action: Action, project: Project): void {
    const presets = (action.params as { presets: EffectPreset[] }).presets;
    (project as { effectPresets?: EffectPreset[] }).effectPresets = structuredClone(presets);
    (project as { modifiedAt: number }).modifiedAt = Date.now();
  },
  invert(action: Action, projectBefore: Project): Action {
    return {
      type: "effectPreset/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { presets: structuredClone(projectBefore.effectPresets ?? []) },
    };
  },
};

registerActionHandler(effectSetStackState);
registerActionHandler(effectPresetSetAll);
