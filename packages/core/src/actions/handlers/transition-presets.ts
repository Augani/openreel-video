import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import {
  isValidDefaultTransition,
  isValidTransitionPreset,
  type DefaultTransition,
  type TransitionPreset,
} from "../../video/transition-presets";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

interface LibraryParams {
  presets?: TransitionPreset[];
  /** Omit to leave the default as it is; null clears it back to Cross dissolve. */
  defaultTransition?: DefaultTransition | null;
}

/**
 * transitionPreset/setLibrary replaces the project's saved transition presets and / or its default transition in
 * one undo step (save, rename, delete, set as default).
 */
const transitionPresetSetLibrary: ActionHandler = {
  type: "transitionPreset/setLibrary",
  validate(action: Action): ValidationResult {
    const params = action.params as LibraryParams;
    const errors: { code: "INVALID_PARAMS"; message: string }[] = [];
    if (params.presets !== undefined) {
      const ok =
        Array.isArray(params.presets) &&
        params.presets.every(isValidTransitionPreset) &&
        new Set(params.presets.map((preset) => preset.id)).size === params.presets.length;
      if (!ok) errors.push({ code: "INVALID_PARAMS", message: "invalid presets" });
    }
    if (params.defaultTransition !== undefined && params.defaultTransition !== null && !isValidDefaultTransition(params.defaultTransition)) {
      errors.push({ code: "INVALID_PARAMS", message: "invalid defaultTransition" });
    }
    if (params.presets === undefined && params.defaultTransition === undefined) {
      errors.push({ code: "INVALID_PARAMS", message: "Nothing to update" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as LibraryParams;
    const target = project as { transitionPresets?: TransitionPreset[]; defaultTransition?: DefaultTransition; modifiedAt: number };
    if (params.presets !== undefined) target.transitionPresets = structuredClone(params.presets);
    if (params.defaultTransition === null) delete target.defaultTransition;
    else if (params.defaultTransition !== undefined) target.defaultTransition = structuredClone(params.defaultTransition);
    target.modifiedAt = Date.now();
  },
  invert(action: Action, projectBefore: Project): Action {
    return {
      type: "transitionPreset/setLibrary",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        presets: structuredClone(projectBefore.transitionPresets ?? []),
        defaultTransition: projectBefore.defaultTransition ? structuredClone(projectBefore.defaultTransition) : null,
      },
    };
  },
};

registerActionHandler(transitionPresetSetLibrary);
