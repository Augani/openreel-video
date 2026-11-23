import { v4 as uuidv4 } from "uuid";
import type { Action, Clip, Project, TransitionType } from "@openreel/core";
import { getDefaultTransitionParams } from "@openreel/core";
import {
  buildTransitionAtCut,
  createTransitionPreset,
  defaultFromPreset,
  resolveDefaultTransition,
  type DefaultTransition,
  type TransitionPreset,
} from "@openreel/core/video/transition-presets";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";

export type TransitionOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

export interface TransitionSource {
  readonly type: TransitionType;
  readonly duration: number;
  readonly params: Record<string, unknown>;
  readonly label?: string;
}

const NO_PRESETS: readonly TransitionPreset[] = [];

export function getTransitionPresets(): readonly TransitionPreset[] {
  return useProjectStore.getState().project.transitionPresets ?? NO_PRESETS;
}

export function getDefaultTransition(): DefaultTransition {
  return resolveDefaultTransition(useProjectStore.getState().project);
}

async function writeLibrary(update: { presets?: readonly TransitionPreset[]; defaultTransition?: DefaultTransition | null }): Promise<boolean> {
  const action: Action = {
    type: "transitionPreset/setLibrary",
    id: uuidv4(),
    timestamp: Date.now(),
    params: { ...(update.presets ? { presets: [...update.presets] } : {}), ...(update.defaultTransition !== undefined ? { defaultTransition: update.defaultTransition } : {}) },
  };
  return (await useProjectStore.getState().executeAction(action)).success;
}

/** Saves a transition (type, duration, parameters) as a named preset; one undo step. */
export async function saveTransitionPreset(name: string, source: TransitionSource): Promise<TransitionOutcome> {
  const created = createTransitionPreset({
    id: `tpreset-${uuidv4()}`,
    name,
    type: source.type,
    duration: source.duration,
    params: { ...getDefaultTransitionParams(source.type), ...source.params },
  });
  if (!created.ok) return { ok: false, error: created.error };
  const existing = getTransitionPresets();
  if (existing.some((preset) => preset.name.toLowerCase() === created.value.name.toLowerCase())) {
    return { ok: false, error: `A preset named "${created.value.name}" already exists` };
  }
  return (await writeLibrary({ presets: [...existing, created.value] }))
    ? { ok: true, message: `Saved preset "${created.value.name}"` }
    : { ok: false, error: "The preset could not be saved" };
}

export async function renameTransitionPreset(id: string, name: string): Promise<TransitionOutcome> {
  const trimmed = name.trim();
  const existing = getTransitionPresets();
  if (!trimmed) return { ok: false, error: "Give the preset a name" };
  if (existing.some((preset) => preset.id !== id && preset.name.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, error: `A preset named "${trimmed}" already exists` };
  }
  const next = existing.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset));
  const current = getDefaultTransition();
  return (await writeLibrary({ presets: next, ...(current.presetId === id ? { defaultTransition: { ...current, label: trimmed } } : {}) }))
    ? { ok: true, message: `Renamed to "${trimmed}"` }
    : { ok: false, error: "The preset could not be renamed" };
}

export async function deleteTransitionPreset(id: string): Promise<TransitionOutcome> {
  const existing = getTransitionPresets();
  const removed = existing.find((preset) => preset.id === id);
  if (!removed) return { ok: false, error: "That preset no longer exists" };
  const wasDefault = useProjectStore.getState().project.defaultTransition?.presetId === id;
  // A deleted default keeps working as a plain transition (its values stay), only its preset link goes.
  const { presetId: _unlinked, ...detached } = getDefaultTransition();
  return (await writeLibrary({ presets: existing.filter((preset) => preset.id !== id), ...(wasDefault ? { defaultTransition: detached } : {}) }))
    ? { ok: true, message: `Deleted preset "${removed.name}"` }
    : { ok: false, error: "The preset could not be deleted" };
}

/** Set as Default Transition: what Apply Default Transition (Cmd/Ctrl+D with the Premiere shortcut set) uses. */
export async function setDefaultTransition(source: TransitionSource | TransitionPreset | null, scope: "project" | "global" = "project"): Promise<TransitionOutcome> {
  if (source === null) {
    return (await writeLibrary({ defaultTransition: null })) ? { ok: true, message: "Default transition reset to Cross dissolve" } : { ok: false, error: "The default could not be reset" };
  }
  const next: DefaultTransition =
    "id" in source
      ? defaultFromPreset(source, scope)
      : { type: source.type, duration: source.duration, params: { ...getDefaultTransitionParams(source.type), ...source.params }, ...(source.label ? { label: source.label } : {}) };
  return (await writeLibrary({ defaultTransition: next }))
    ? { ok: true, message: `${next.label ?? next.type} is now the default transition` }
    : { ok: false, error: "The default could not be set" };
}

interface Cut {
  readonly clipA: Clip;
  readonly clipB?: Clip;
}

const frameTolerance = (project: Project) => 1 / Math.max(1, project.settings.frameRate) + 1e-6;

/** The cut a transition goes on: two selected adjacent clips, one selected clip (its next cut, else previous, else its outro), or the cut at the playhead. */
export function findTransitionCut(project: Project, selectedIds: ReadonlySet<string>, playhead: number): Cut | null {
  const tolerance = frameTolerance(project);
  for (const track of project.timeline.tracks) {
    if (track.locked || (track.type !== "video" && track.type !== "image")) continue;
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    if (selectedIds.size > 1) {
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const a = sorted[index]!;
        const b = sorted[index + 1]!;
        if (selectedIds.has(a.id) && selectedIds.has(b.id) && Math.abs(a.startTime + a.duration - b.startTime) <= tolerance) {
          return { clipA: a, clipB: b };
        }
      }
    } else if (selectedIds.size === 1) {
      const at = sorted.findIndex((clip) => selectedIds.has(clip.id));
      if (at < 0) continue;
      const selected = sorted[at]!;
      const next = sorted[at + 1];
      const previous = sorted[at - 1];
      if (next && Math.abs(selected.startTime + selected.duration - next.startTime) <= tolerance) return { clipA: selected, clipB: next };
      if (previous && Math.abs(previous.startTime + previous.duration - selected.startTime) <= tolerance) return { clipA: previous, clipB: selected };
      return { clipA: selected };
    }
  }
  if (selectedIds.size === 0) {
    for (const track of project.timeline.tracks) {
      if (track.locked || (track.type !== "video" && track.type !== "image")) continue;
      const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const a = sorted[index]!;
        const b = sorted[index + 1]!;
        if (Math.abs(a.startTime + a.duration - b.startTime) <= tolerance && Math.abs(b.startTime - playhead) <= tolerance) return { clipA: a, clipB: b };
      }
    }
  }
  return null;
}

/** Applies a transition (a built-in, a preset or the default) to the selected cut as one undo step. */
export async function applyTransitionToSelectedCut(source: TransitionSource, overrides: { duration?: number } = {}): Promise<TransitionOutcome> {
  const state = useProjectStore.getState();
  const selected = new Set(useUIStore.getState().getSelectedClipIds());
  const cut = findTransitionCut(state.project, selected, useTimelineStore.getState().playheadPosition);
  if (!cut) {
    return { ok: false, error: selected.size ? "The selected clips must be adjacent on an unlocked video track." : "Select a clip or two adjacent clips, or park the playhead on a cut." };
  }
  const transition = buildTransitionAtCut(
    { type: source.type, duration: source.duration, params: { ...getDefaultTransitionParams(source.type), ...source.params } },
    cut.clipA,
    cut.clipB,
    `transition-${uuidv4()}`,
    overrides,
  );
  const added = await state.addClipTransition(transition);
  return added ? { ok: true, message: `${source.label ?? source.type} added` } : { ok: false, error: "Could not save the transition." };
}

export async function applyDefaultTransition(): Promise<TransitionOutcome> {
  const fallback = getDefaultTransition();
  return applyTransitionToSelectedCut({ type: fallback.type, duration: fallback.duration, params: fallback.params, label: fallback.label ?? fallback.type });
}
