import {
  resolveTextAnimationPhase,
  textAnimationEngine,
  TEXT_ANIMATION_PRESETS,
  type TextAnimation,
  type TextAnimationParams,
  type TextAnimationPhase,
  type TextAnimationPreset,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";

export type TextAnimationSide = "entry" | "exit";

function phaseOnly(animation: TextAnimation): TextAnimationPhase {
  return { preset: animation.preset, params: animation.params,
    ...(animation.unit ? { unit: animation.unit } : {}),
    ...(animation.stagger !== undefined ? { stagger: animation.stagger } : {}),
  };
}

/** Edit one phase as one ordinary overlay-history operation. */
export function updateTextAnimationPhase(
  clipId: string,
  side: TextAnimationSide,
  preset: TextAnimationPreset,
  inDuration: number,
  outDuration: number,
  params?: Partial<TextAnimationParams>,
) {
  const state = useProjectStore.getState();
  const clip = state.getTextClip(clipId);
  const ui = useUIStore.getState();
  const timeline = useTimelineStore.getState();
  if (!clip || ui.exportState.isExporting || ui.effectApplicationClipId !== null || timeline.playbackLockedReason
    || !state.project.timeline.tracks.some(track => track.id === clip.trackId && !track.locked)
    || !Number.isFinite(inDuration) || !Number.isFinite(outDuration) || inDuration < 0 || outDuration < 0) return null;
  const before = clip.animation ?? textAnimationEngine.createAnimationPreset("none", 0, 0);
  const selected = resolveTextAnimationPhase(before, side === "entry");
  if (selected.preset === preset && before.inDuration === inDuration && before.outDuration === outDuration
    && JSON.stringify({ ...selected.params, ...params }) === JSON.stringify(selected.params)) return clip;
  const created = textAnimationEngine.createAnimationPreset(preset, inDuration, outDuration, params);
  const next = selected.preset === preset
    ? { ...selected, ...created, params: { ...created.params, ...selected.params, ...params } }
    : created;
  const animation: TextAnimation = side === "entry"
    ? { ...next, out: before.out ?? phaseOnly(before) }
    : { ...before, inDuration, outDuration, out: phaseOnly(next) };
  timeline.pause();
  return state.updateTextAnimation(clipId, animation);
}

export function setTextAnimationPhasePreset(clipId: string, side: TextAnimationSide, preset: TextAnimationPreset) {
  const clip = useProjectStore.getState().getTextClip(clipId);
  if (!clip) return null;
  const before = clip.animation ?? textAnimationEngine.createAnimationPreset("none", 0, 0);
  const selected = resolveTextAnimationPhase(before, side === "entry");
  const defaults = TEXT_ANIMATION_PRESETS.find(item => item.id === preset);
  const inDuration = side === "entry" && selected.preset === "none" && before.inDuration === 0
    ? defaults?.defaultInDuration ?? 0.5 : before.inDuration;
  const outDuration = side === "exit" && selected.preset === "none" && before.outDuration === 0
    ? defaults?.defaultOutDuration ?? 0.5 : before.outDuration;
  return updateTextAnimationPhase(clipId, side, preset, inDuration, outDuration);
}
