import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Effect, Subtitle } from "../../types/timeline";
import type {
  MutableTimeline,
  MutableClip,
} from "../../utils/immutable-updates";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";
import { findClip, patchClip, makeClipFieldHandler } from "./clip-helpers";

const keyframeSetAll = makeClipFieldHandler({
  type: "keyframe/setAll",
  paramKey: "keyframes",
  field: "keyframes",
  validateValue: (v) =>
    v == null || Array.isArray(v) ? null : "keyframes must be an array",
});

const effectSetOrder: ActionHandler = {
  type: "effect/setOrder",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: string; effectIds?: unknown };
    const errors = [];
    const clip =
      typeof params.clipId === "string"
        ? findClip(project, params.clipId)
        : undefined;
    if (!clip) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip not found: ${String(params.clipId)}`,
      });
    } else if (!Array.isArray(params.effectIds)) {
      errors.push({ code: "INVALID_PARAMS", message: "effectIds must be an array" });
    } else {
      const ids = new Set(clip.effects.map((e) => e.id));
      const valid =
        params.effectIds.length === clip.effects.length &&
        params.effectIds.every((id) => typeof id === "string" && ids.has(id));
      if (!valid) {
        errors.push({
          code: "INVALID_PARAMS",
          message: "effectIds must be a permutation of the clip's effect ids",
        });
      }
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { clipId: string; effectIds: string[] };
    const clip = findClip(project, params.clipId);
    if (!clip) return;
    const byId = new Map<string, Effect>(clip.effects.map((e) => [e.id, e]));
    const reordered = params.effectIds
      .map((id) => byId.get(id))
      .filter((e): e is Effect => e !== undefined);
    patchClip(project, params.clipId, {
      effects: reordered as MutableClip["effects"],
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { clipId: string };
    const clip = findClip(projectBefore, params.clipId);
    if (!clip) return null;
    return {
      type: "effect/setOrder",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { clipId: params.clipId, effectIds: clip.effects.map((e) => e.id) },
    };
  },
};

const effectSetStack: ActionHandler = {
  type: "effect/setStack",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: string; effects?: unknown };
    const errors = [];
    if (
      typeof params.clipId !== "string" ||
      !findClip(project, params.clipId)
    ) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip not found: ${String(params.clipId)}`,
      });
    }
    if (!Array.isArray(params.effects)) {
      errors.push({
        code: "INVALID_PARAMS",
        message: "effects must be an array",
      });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { clipId: string; effects: Effect[] };
    patchClip(project, params.clipId, {
      effects: structuredClone(params.effects) as MutableClip["effects"],
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { clipId: string };
    const clip = findClip(projectBefore, params.clipId);
    if (!clip) return null;
    return {
      type: "effect/setStack",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        clipId: params.clipId,
        effects: structuredClone(clip.effects),
      },
    };
  },
};

function findSubtitle(project: Project, id: string): Subtitle | undefined {
  return project.timeline.subtitles.find((s) => s.id === id);
}

const subtitleReplace: ActionHandler = {
  type: "subtitle/replace",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { subtitleId?: string };
    const errors = [];
    if (
      typeof params.subtitleId !== "string" ||
      !findSubtitle(project, params.subtitleId)
    ) {
      errors.push({
        code: "INVALID_PARAMS",
        message: `Subtitle not found: ${String(params.subtitleId)}`,
      });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as {
      subtitleId: string;
      subtitle: Subtitle;
    };
    const timeline = project.timeline as MutableTimeline;
    timeline.subtitles = timeline.subtitles.map((s) =>
      s.id === params.subtitleId ? params.subtitle : s,
    );
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { subtitleId: string };
    const prior = findSubtitle(projectBefore, params.subtitleId);
    if (!prior) return null;
    return {
      type: "subtitle/replace",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { subtitleId: params.subtitleId, subtitle: { ...prior } },
    };
  },
};

const subtitleSetAll: ActionHandler = {
  type: "subtitle/setAll",
  validate(): ValidationResult {
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { subtitles: Subtitle[] };
    (project.timeline as MutableTimeline).subtitles = params.subtitles ?? [];
  },
  invert(action: Action, projectBefore: Project): Action | null {
    return {
      type: "subtitle/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        subtitles: projectBefore.timeline.subtitles.map((s) => ({ ...s })),
      },
    };
  },
};

const adjustmentSetAll: ActionHandler = {
  type: "adjustment/setAll",
  validate(): ValidationResult {
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { layers: unknown[] };
    (project as unknown as Record<string, unknown[]>).adjustmentLayers =
      params.layers ?? [];
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const prior =
      (projectBefore as unknown as Record<string, unknown[]>)
        .adjustmentLayers ?? [];
    return {
      type: "adjustment/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { layers: prior.map((l) => ({ ...(l as object) })) },
    };
  },
};

const maskSetAll: ActionHandler = {
  type: "mask/setAll",
  validate(): ValidationResult {
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { masks: unknown[] };
    (project as unknown as Record<string, unknown[]>).masks =
      params.masks ?? [];
    (project as unknown as { modifiedAt: number }).modifiedAt = Date.now();
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const prior =
      (projectBefore as unknown as Record<string, unknown[]>).masks ?? [];
    return {
      type: "mask/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { masks: prior.map((m) => ({ ...(m as object) })) },
    };
  },
};

const multicamSetAll: ActionHandler = {
  type: "multicam/setAll",
  validate(): ValidationResult {
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { groups: unknown[] };
    (project as unknown as Record<string, unknown[]>).multicamGroups =
      params.groups ?? [];
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const prior =
      (projectBefore as unknown as Record<string, unknown[]>).multicamGroups ??
      [];
    return {
      type: "multicam/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { groups: prior.map((g) => ({ ...(g as object) })) },
    };
  },
};

const nestedSetAll: ActionHandler = {
  type: "nested/setAll",
  validate(): ValidationResult {
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as {
      compoundClips: unknown[];
      instances: unknown[];
    };
    const target = project as unknown as Record<string, unknown[]>;
    target.compoundClips = params.compoundClips ?? [];
    target.nestedInstances = params.instances ?? [];
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const before = projectBefore as unknown as Record<string, unknown[]>;
    return {
      type: "nested/setAll",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        compoundClips: (before.compoundClips ?? []).map((c) => ({
          ...(c as object),
        })),
        instances: (before.nestedInstances ?? []).map((i) => ({
          ...(i as object),
        })),
      },
    };
  },
};

for (const handler of [
  keyframeSetAll,
  effectSetOrder,
  effectSetStack,
  subtitleReplace,
  subtitleSetAll,
  adjustmentSetAll,
  maskSetAll,
  multicamSetAll,
  nestedSetAll,
]) {
  registerActionHandler(handler);
}
