import type { Action } from "../../types/actions";
import type { Clip, Effect } from "../../types/timeline";
import {
  SPECTRAL_REPAIR_EFFECT_TYPE,
  createSpectralRepairEffect,
  spectralRegionsVersion,
  sanitizeSpectralRegions,
  type SpectralRegion,
} from "./spectral-regions";

/** The clip's own spectral-repair effect (a clip carries at most one; its region list is the edit). */
export const findSpectralRepairEffect = (clip: Pick<Clip, "audioEffects"> | undefined): Effect | undefined =>
  (clip?.audioEffects ?? []).find((effect) => effect.type === SPECTRAL_REPAIR_EFFECT_TYPE);

/** The regions currently stored on the clip (enabled or not). */
export const clipSpectralRegions = (clip: Pick<Clip, "audioEffects"> | undefined): SpectralRegion[] =>
  sanitizeSpectralRegions(findSpectralRepairEffect(clip)?.params.regions);

export interface SpectralActionIds {
  readonly actionId: string;
  readonly effectId: string;
}

/**
 * The single undoable action that makes the clip's region list `regions`: add the effect when the clip has
 * none, replace it (the whole effect, so undo restores the previous list exactly) when it has one, remove it
 * when the list becomes empty. Null when nothing would change. Region edits are never merged into a neighbouring
 * undo step: each commit is its own step.
 */
export function planSpectralRegionsAction(
  clip: Pick<Clip, "id" | "audioEffects">,
  regions: readonly SpectralRegion[],
  ids: SpectralActionIds,
  timestamp = Date.now(),
): Action | null {
  const next = sanitizeSpectralRegions(regions);
  const existing = findSpectralRepairEffect(clip);
  if (!existing) {
    if (next.length === 0) return null;
    return { id: ids.actionId, timestamp, type: "audio/addEffect", params: { clipId: clip.id, effect: createSpectralRepairEffect(ids.effectId, next) } };
  }
  const current = sanitizeSpectralRegions(existing.params.regions);
  if (JSON.stringify(current) === JSON.stringify(next)) return null;
  const { version: _drop, ...rest } = existing.params;
  void _drop;
  const version = spectralRegionsVersion(next);
  const params = version ? { ...rest, version, regions: next } : { ...rest, regions: next };
  if (next.length === 0) {
    return { id: ids.actionId, timestamp, type: "audio/removeEffect", params: { clipId: clip.id, effectId: existing.id } };
  }
  return {
    id: ids.actionId,
    timestamp,
    type: "audio/replaceEffect",
    params: { clipId: clip.id, effectId: existing.id, effect: { ...existing, params } },
  };
}
