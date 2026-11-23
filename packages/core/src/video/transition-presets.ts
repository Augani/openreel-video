import { TRANSITION_TYPES, type TransitionType } from "../types/effects";
import type { Transition, Clip } from "../types/timeline";

/**
 * Saved custom transition presets: a user-named transition type + duration + parameter set kept on the project
 * (`project.transitionPresets`) so it travels with the file, shows in the Transitions panel and can be applied to
 * any cut. `project.defaultTransition` is what Apply Default Transition (and the panel's default) uses.
 */

export interface TransitionPreset {
  readonly id: string;
  readonly name: string;
  readonly type: TransitionType;
  /** Seconds. */
  readonly duration: number;
  readonly params: Record<string, unknown>;
  readonly createdAt: number;
}

export interface DefaultTransition {
  readonly type: TransitionType;
  readonly duration: number;
  readonly params: Record<string, unknown>;
  /** The preset it came from, when it did (display only). */
  readonly presetId?: string;
  /** Where that preset lives: this project's library, or the app-wide one (which another install may not have). */
  readonly scope?: "project" | "global";
  readonly label?: string;
}

export const FALLBACK_DEFAULT_TRANSITION: DefaultTransition = {
  type: "crossfade",
  duration: 1,
  params: { curve: "ease" },
  label: "Cross dissolve",
};

export type PresetResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const MAX_PARAMS_BYTES = 70_000;

function isPlainParams(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_PARAMS_BYTES;
  } catch {
    return false;
  }
}

export function createTransitionPreset(input: {
  id: string;
  name: string;
  type: string;
  duration: number;
  params: unknown;
  createdAt?: number;
}): PresetResult<TransitionPreset> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give the preset a name" };
  if (name.length > 80) return { ok: false, error: "The preset name is too long (80 characters at most)" };
  if (!(TRANSITION_TYPES as readonly string[]).includes(input.type)) return { ok: false, error: `Unknown transition type "${input.type}"` };
  if (!Number.isFinite(input.duration) || input.duration <= 0 || input.duration > 30) {
    return { ok: false, error: "Duration must be between 0 and 30 seconds" };
  }
  if (!isPlainParams(input.params)) return { ok: false, error: "The transition parameters are not valid" };
  return {
    ok: true,
    value: {
      id: input.id,
      name,
      type: input.type as TransitionType,
      duration: input.duration,
      params: structuredClone(input.params),
      createdAt: input.createdAt ?? Date.now(),
    },
  };
}

export function isValidTransitionPreset(value: unknown): value is TransitionPreset {
  const preset = value as Partial<TransitionPreset> | null;
  return (
    !!preset &&
    typeof preset.id === "string" &&
    preset.id !== "" &&
    typeof preset.name === "string" &&
    preset.name.trim() !== "" &&
    typeof preset.type === "string" &&
    (TRANSITION_TYPES as readonly string[]).includes(preset.type) &&
    typeof preset.duration === "number" &&
    Number.isFinite(preset.duration) &&
    preset.duration > 0 &&
    isPlainParams(preset.params)
  );
}

export function isValidDefaultTransition(value: unknown): value is DefaultTransition {
  const d = value as Partial<DefaultTransition> | null;
  return (
    !!d &&
    typeof d.type === "string" &&
    (TRANSITION_TYPES as readonly string[]).includes(d.type) &&
    typeof d.duration === "number" &&
    Number.isFinite(d.duration) &&
    d.duration > 0 &&
    isPlainParams(d.params)
  );
}

export function defaultFromPreset(preset: TransitionPreset, scope: "project" | "global" = "project"): DefaultTransition {
  return { type: preset.type, duration: preset.duration, params: structuredClone(preset.params), presetId: preset.id, scope, label: preset.name };
}

/**
 * The preset a default transition came from, when it is still there. A default saved from an app-wide preset that this
 * install does not have (the project was opened elsewhere, or the preset was deleted) is not an error: the default keeps
 * the type, duration and parameters it stored, so it applies exactly as before; only the link is reported missing.
 */
export function resolveDefaultPreset(
  defaultTransition: DefaultTransition,
  projectPresets: readonly TransitionPreset[],
  globalPresets: readonly TransitionPreset[],
): { readonly preset: TransitionPreset | null; readonly missing: boolean } {
  if (!defaultTransition.presetId) return { preset: null, missing: false };
  const pool = defaultTransition.scope === "global" ? globalPresets : projectPresets;
  const preset = pool.find((candidate) => candidate.id === defaultTransition.presetId) ?? null;
  return { preset, missing: preset === null };
}

export function resolveDefaultTransition(project: { readonly defaultTransition?: DefaultTransition }): DefaultTransition {
  return project.defaultTransition && isValidDefaultTransition(project.defaultTransition)
    ? project.defaultTransition
    : FALLBACK_DEFAULT_TRANSITION;
}

/** Builds the transition a preset (or the default) makes at a cut, clamping its duration to what the clips allow. */
export function buildTransitionAtCut(
  source: { readonly type: TransitionType; readonly duration: number; readonly params: Record<string, unknown> },
  clipA: Clip,
  clipB: Clip | undefined,
  id: string,
  overrides: { duration?: number } = {},
): Transition {
  const alignment = source.params.alignment;
  const limit = !clipB
    ? clipA.duration
    : alignment === "start"
      ? clipB.duration
      : alignment === "end"
        ? clipA.duration
        : Math.min(clipA.duration, clipB.duration) * 2;
  const duration = Math.max(0.001, Math.min(overrides.duration ?? source.duration, limit));
  return {
    id,
    clipAId: clipA.id,
    ...(clipB ? { clipBId: clipB.id } : { edge: "out" as const }),
    type: source.type,
    duration,
    params: structuredClone(source.params),
  };
}
