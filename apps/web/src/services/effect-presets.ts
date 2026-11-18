import { v4 as uuidv4 } from "uuid";
import type { Action, Clip } from "@openreel/core";
import {
  applyEffectPreset,
  createEffectPreset,
  mergeImportedPresets,
  parseEffectPresets,
  serializeEffectPresets,
  type EffectPreset,
  type EffectPresetTiming,
} from "@openreel/core/video/effect-presets";
import { useProjectStore } from "../stores/project-store";

export type EffectPresetOutcome = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly error: string };

const NO_PRESETS: readonly EffectPreset[] = [];

export function getEffectPresets(): readonly EffectPreset[] {
  return useProjectStore.getState().project.effectPresets ?? NO_PRESETS;
}

function findClip(clipId: string): Clip | undefined {
  return useProjectStore
    .getState()
    .project.timeline.tracks.flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId);
}

async function writeLibrary(presets: readonly EffectPreset[]): Promise<boolean> {
  const action: Action = {
    type: "effectPreset/setAll",
    id: uuidv4(),
    timestamp: Date.now(),
    params: { presets: [...presets] },
  };
  return (await useProjectStore.getState().executeAction(action)).success;
}

/** Saves the clip's effects (all, or `effectIds`) with their keyframes as a named preset. */
export async function saveEffectPresetFromClip(
  clipId: string,
  name: string,
  timing: EffectPresetTiming,
  effectIds?: readonly string[],
): Promise<EffectPresetOutcome> {
  const clip = findClip(clipId);
  if (!clip) return { ok: false, error: "Select a clip first" };
  const created = createEffectPreset(clip, {
    id: `preset-${uuidv4()}`,
    name,
    timing,
    ...(effectIds ? { effectIds } : {}),
  });
  if (!created.ok) return { ok: false, error: created.error };
  const saved = await writeLibrary([...getEffectPresets(), created.value]);
  return saved ? { ok: true, message: `Saved preset "${created.value.name}"` } : { ok: false, error: "The preset could not be saved" };
}

/** Applies a preset to a clip as fresh independent effect instances, in one undo step. */
export async function applyEffectPresetToClip(
  clipId: string,
  presetId: string,
  mode: "append" | "replace",
): Promise<EffectPresetOutcome> {
  const clip = findClip(clipId);
  const preset = getEffectPresets().find((candidate) => candidate.id === presetId);
  if (!clip) return { ok: false, error: "Select a clip first" };
  if (!preset) return { ok: false, error: "Preset not found" };
  const applied = applyEffectPreset(clip, preset, { mode, makeId: (prefix) => `${prefix}-${uuidv4()}` });
  const done = await useProjectStore.getState().setClipEffectState(clipId, applied.effects, applied.keyframes);
  return done ? { ok: true, message: `Applied "${preset.name}"` } : { ok: false, error: "The preset could not be applied" };
}

export async function deleteEffectPreset(presetId: string): Promise<EffectPresetOutcome> {
  const next = getEffectPresets().filter((preset) => preset.id !== presetId);
  const done = await writeLibrary(next);
  return done ? { ok: true, message: "Preset deleted" } : { ok: false, error: "The preset could not be deleted" };
}

/** JSON text for the whole library or the chosen presets. */
export function exportEffectPresetsJson(presetIds?: readonly string[]): string | null {
  const wanted = presetIds ? new Set(presetIds) : null;
  const presets = getEffectPresets().filter((preset) => !wanted || wanted.has(preset.id));
  return presets.length > 0 ? serializeEffectPresets(presets) : null;
}

/** Validates and merges an exported preset file; never overwrites existing presets. */
export async function importEffectPresetsJson(text: string): Promise<EffectPresetOutcome> {
  const parsed = parseEffectPresets(text, () => `preset-${uuidv4()}`);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const library = getEffectPresets();
  const merged = mergeImportedPresets(library, parsed.value, () => `preset-${uuidv4()}`);
  const done = await writeLibrary(merged);
  return done ? { ok: true, message: `Imported ${parsed.value.length} preset${parsed.value.length === 1 ? "" : "s"}` } : { ok: false, error: "The presets could not be imported" };
}
