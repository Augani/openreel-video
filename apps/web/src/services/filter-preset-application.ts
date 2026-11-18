import { FILTER_PRESETS, toRuntimeVideoEffectParams, type FilterPreset } from "@openreel/core";
import type { VideoEffect } from "../bridges/effects-bridge";
import { useProjectStore } from "../stores/project-store";

export interface FilterPresetSelection {
  presetId: string;
  effectIds: readonly string[];
}

const primaryParameter = (type: string) =>
  type === "hue" ? "rotation" : type === "blur" ? "radius"
    : type === "brightness" || type === "contrast" || type === "saturation" ? "value" : "amount";
const neutralValue = (type: string) => type === "contrast" || type === "saturation" ? 1 : 0;

function runtimeParams(preset: FilterPreset, intensity: number): Record<string, unknown>[] {
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) throw new Error("Choose a filter intensity from 0 to 100%.");
  return preset.effects.map(effect => {
    const params = toRuntimeVideoEffectParams(effect.type, { ...effect.params });
    const key = primaryParameter(effect.type);
    const value = params[key] as number;
    const neutral = neutralValue(effect.type);
    return { ...params, [key]: intensity === 100 ? value
      : Number((neutral + (value - neutral) * intensity / 100).toPrecision(12)) };
  });
}

/** The effects `applyFilterPreset` writes to a clip (same units, same order). Look previews render exactly these. */
export function filterPresetEffectsForPreview(preset: FilterPreset): Array<{ type: string; params: Record<string, unknown> }> {
  const params = runtimeParams(preset, 100);
  return preset.effects.map((effect, index) => ({ type: effect.type, params: params[index] }));
}

/** Read the intensity from authored effects so history/reload never leaves a
 * stale local percentage. Secondary parameters retain their original units. */
function measureIntensity(preset: FilterPreset, effects: readonly VideoEffect[]): number | null {
  if (effects.length !== preset.effects.length) return null;
  const base = runtimeParams(preset, 100);
  let ratio: number | undefined;
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (effect.type !== preset.effects[index].type) return null;
    const key = primaryParameter(effect.type), neutral = neutralValue(effect.type);
    const value = effect.params[key], authored = base[index][key] as number;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (authored !== neutral) { ratio = (value - neutral) / (authored - neutral); break; }
  }
  if (ratio === undefined || ratio < -1e-8 || ratio > 1 + 1e-8) return null;
  const intensity = Number((Math.max(0, Math.min(1, ratio)) * 100).toPrecision(10));
  const expected = runtimeParams(preset, intensity);
  return effects.every((effect, index) => effect.type === preset.effects[index].type
    && Object.keys(effect.params).length === Object.keys(expected[index]).length
    && Object.entries(expected[index]).every(([key, value]) => typeof value === "number"
      ? typeof effect.params[key] === "number" && Math.abs((effect.params[key] as number) - value) < 1e-8
      : effect.params[key] === value)) ? intensity : null;
}

export function resolveFilterPreset(effects: readonly VideoEffect[], preferred?: FilterPresetSelection | null):
  (FilterPresetSelection & { preset: FilterPreset; intensity: number }) | null {
  const selected = FILTER_PRESETS.find(preset => preset.id === preferred?.presetId);
  if (selected && preferred) {
    const byId = new Map(effects.map(effect => [effect.id, effect]));
    const owned = preferred.effectIds.map(id => byId.get(id));
    if (owned.every((effect): effect is VideoEffect => !!effect)) {
      const intensity = measureIntensity(selected, owned);
      if (intensity !== null) return { ...preferred, preset: selected, intensity };
    }
  }
  const origins = new Map<string, { presetId: string; effects: Map<number, VideoEffect>; duplicate: boolean }>();
  for (const effect of effects) {
    const source = effect.metadata?.filterPreset;
    if (!source || typeof source.presetId !== "string" || typeof source.applicationId !== "string" || !Number.isInteger(source.index)) continue;
    const key = `${source.presetId}:${source.applicationId}`;
    const group = origins.get(key) ?? { presetId: source.presetId, effects: new Map(), duplicate: false };
    if (group.effects.has(source.index)) group.duplicate = true;
    group.effects.set(source.index, effect);
    origins.set(key, group);
  }
  const matches = [];
  for (const group of origins.values()) {
    const preset = FILTER_PRESETS.find(item => item.id === group.presetId);
    if (!preset || group.duplicate || group.effects.size !== preset.effects.length) continue;
    const owned = preset.effects.map((_, index) => group.effects.get(index));
    if (!owned.every((effect): effect is VideoEffect => !!effect)) continue;
    const intensity = measureIntensity(preset, owned);
    if (intensity !== null) matches.push({ presetId: preset.id, preset, intensity, effectIds: owned.map(effect => effect.id) });
  }
  if (matches.length) return matches.length === 1 ? matches[0] : null;
  for (const preset of FILTER_PRESETS) {
    const intensity = measureIntensity(preset, effects);
    if (intensity !== null) matches.push({ presetId: preset.id, preset, intensity, effectIds: effects.map(effect => effect.id) });
  }
  return matches.length === 1 ? matches[0] : null;
}

function editableTarget(projectId: string, clipId: string) {
  const state = useProjectStore.getState();
  const track = state.project.timeline.tracks.find(item => item.clips.some(clip => clip.id === clipId));
  const clip = track?.clips.find(item => item.id === clipId);
  const media = state.project.mediaLibrary.items.find(item => item.id === clip?.mediaId);
  if (!state.hasOpenProject || state.project.id !== projectId || !clip || (media?.type !== "video" && media?.type !== "image"))
    throw new Error("Select a video or image clip to apply filters.");
  if (track?.locked) throw new Error("Unlock the selected track to change its filters.");
  return { state, clip };
}

export async function applyFilterPreset(projectId: string, clipId: string, preset: FilterPreset): Promise<FilterPresetSelection> {
  const { state } = editableTarget(projectId, clipId);
  const params = runtimeParams(preset, 100);
  const applicationId = crypto.randomUUID();
  const effects = preset.effects.map((effect, index): VideoEffect => ({
    id: `effect-${crypto.randomUUID()}`, type: effect.type, enabled: true, params: params[index], order: index,
    metadata: { filterPreset: { presetId: preset.id, applicationId, index } },
  }));
  if (!await state.replaceVideoEffects(clipId, effects)) throw new Error("The filter could not be applied.");
  return { presetId: preset.id, effectIds: effects.map(effect => effect.id) };
}

export async function setFilterPresetIntensity(projectId: string, clipId: string, selection: FilterPresetSelection, intensity: number): Promise<void> {
  const { state, clip } = editableTarget(projectId, clipId);
  const effects = clip.effects.map((effect, order): VideoEffect => ({ ...effect, type: effect.type as VideoEffect["type"], order }));
  const current = resolveFilterPreset(effects, selection);
  if (!current || current.presetId !== selection.presetId || current.effectIds.some((id, index) => id !== selection.effectIds[index]))
    throw new Error("This filter has changed. Apply a preset again to adjust its intensity.");
  if (current.intensity === intensity) return;
  const params = runtimeParams(current.preset, intensity);
  const byId = new Map(current.effectIds.map((id, index) => [id, params[index]]));
  if (!await state.replaceVideoEffects(clipId, effects.map(effect => byId.has(effect.id) ? { ...effect, params: byId.get(effect.id)! } : effect)))
    throw new Error("The filter intensity could not be changed.");
}

export async function clearFilterEffects(projectId: string, clipId: string): Promise<void> {
  const { state, clip } = editableTarget(projectId, clipId);
  if (!clip.effects.length) return;
  if (!await state.replaceVideoEffects(clipId, [])) throw new Error("The effects could not be removed.");
}
