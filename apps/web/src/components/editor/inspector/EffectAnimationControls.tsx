import React, { useCallback, useMemo } from "react";
import { Button, cn } from "@openreel/ui";
import { ChevronLeft, ChevronRight, Diamond, Timer } from "@/icons/lucide-compat";
import type { Effect, Keyframe } from "@openreel/core";
import { keyframeEngine } from "@openreel/core/video/keyframe-engine";
import {
  adjacentEffectParamKeyframe,
  clearEffectParamKeyframes,
  findEffectParamKeyframeAt,
  getAnimatableEffectParams,
  getEffectParamKeyframes,
  removeEffectParamKeyframe,
  upsertEffectParamKeyframe,
  type AnimatableEffectParam,
} from "@openreel/core/video/effect-instance-keyframes";
import { v4 as uuidv4 } from "uuid";
import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";

const NO_KEYFRAMES: readonly Keyframe[] = [];

function formatValue(value: number, step: number): string {
  return String(step < 1 ? Number(value.toFixed(2)) : Math.round(value));
}

/** Value of a param at clip-local time: interpolated when animated, else the stored value. */
export function effectParamValueAt(
  keyframes: readonly Keyframe[],
  effect: Pick<Effect, "id" | "params">,
  param: AnimatableEffectParam,
  localTime: number,
): number {
  const group = getEffectParamKeyframes(keyframes, effect.id, param.key);
  if (group.length > 0) {
    const sampled = keyframeEngine.getValueAtTime(group, localTime).value;
    if (typeof sampled === "number" && Number.isFinite(sampled)) return sampled;
  }
  const stored = effect.params[param.key];
  return typeof stored === "number" && Number.isFinite(stored) ? stored : param.defaultValue;
}

interface RowProps {
  readonly clipId: string;
  readonly effect: Pick<Effect, "id" | "type" | "params">;
  readonly param: AnimatableEffectParam;
  readonly keyframes: readonly Keyframe[];
  readonly localTime: number;
  readonly insideClip: boolean;
  readonly disabled: boolean;
}

const EffectParamAnimationRow: React.FC<RowProps> = ({
  clipId, effect, param, keyframes, localTime, insideClip, disabled,
}) => {
  const own = useMemo(() => getEffectParamKeyframes(keyframes, effect.id, param.key), [keyframes, effect.id, param.key]);
  const animated = own.length > 0;
  const atPlayhead = findEffectParamKeyframeAt(keyframes, effect.id, param.key, localTime);
  const value = effectParamValueAt(keyframes, effect, param, localTime);

  /** Always edits the latest keyframes so rapid clicks never act on a stale list. */
  const commit = useCallback((next: (current: readonly Keyframe[]) => Keyframe[]) => {
    const state = useProjectStore.getState();
    const clip = state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip) return;
    state.updateClipKeyframes(clipId, next(clip.keyframes));
  }, [clipId]);

  const makeId = () => `keyframe-${uuidv4()}`;
  const toggleAnimation = () => {
    if (animated) {
      commit((current) => clearEffectParamKeyframes(current, effect.id, param.key));
    } else if (insideClip) {
      commit((current) => upsertEffectParamKeyframe(current, effect.id, param.key, { time: localTime, value }, makeId));
    }
  };
  const toggleKeyframe = () => {
    if (atPlayhead) commit((current) => removeEffectParamKeyframe(current, effect.id, param.key, atPlayhead.time));
    else if (insideClip) commit((current) => upsertEffectParamKeyframe(current, effect.id, param.key, { time: localTime, value }, makeId));
  };
  const jump = (direction: "prev" | "next") => {
    const target = adjacentEffectParamKeyframe(keyframes, effect.id, param.key, localTime, direction);
    if (!target) return;
    const clip = useProjectStore.getState().project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (clip) useTimelineStore.getState().seekTo(clip.startTime + target.time);
  };

  const iconButton = "h-6 w-6 shrink-0";
  return (
    <div className="space-y-1" role="group" aria-label={`${param.label} animation`}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(iconButton, animated && "bg-primary/15 text-primary")}
          aria-label={`Animate ${param.label}`}
          aria-pressed={animated}
          title={animated ? "Stopwatch on: click to remove all keyframes" : "Stopwatch off: click to start animating"}
          disabled={disabled || (!animated && !insideClip)}
          onClick={toggleAnimation}
        >
          <Timer size={12} aria-hidden />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[10px] text-fg-2">{param.label}</span>
        {animated ? (
          <>
            <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Previous ${param.label} keyframe`}
              disabled={!adjacentEffectParamKeyframe(keyframes, effect.id, param.key, localTime, "prev")} onClick={() => jump("prev")}>
              <ChevronLeft size={12} aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className={cn(iconButton, atPlayhead && "text-primary")}
              aria-label={atPlayhead ? `Remove ${param.label} keyframe` : `Add ${param.label} keyframe`} aria-pressed={Boolean(atPlayhead)}
              disabled={disabled || (!atPlayhead && !insideClip)} onClick={toggleKeyframe}>
              <Diamond size={12} fill={atPlayhead ? "currentColor" : "none"} aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Next ${param.label} keyframe`}
              disabled={!adjacentEffectParamKeyframe(keyframes, effect.id, param.key, localTime, "next")} onClick={() => jump("next")}>
              <ChevronRight size={12} aria-hidden />
            </Button>
          </>
        ) : (
          <span className="text-[10px] tabular-nums text-fg-3">{formatValue(value, param.step)}</span>
        )}
      </div>
      {animated && (
        <PropertySlider
          ariaLabel={`${param.label} at playhead`}
          label={`${param.label} (${own.length} keyframe${own.length === 1 ? "" : "s"})`}
          value={Math.min(Math.max(value, param.min), param.max)}
          min={param.min}
          max={param.max}
          step={param.step}
          isDisabled={disabled || !insideClip}
          formatValue={(next) => formatValue(next, param.step)}
          onChange={(next) =>
            commit((current) => upsertEffectParamKeyframe(current, effect.id, param.key, { time: localTime, value: next }, makeId))}
        />
      )}
    </div>
  );
};

/**
 * Per-parameter stopwatch for one effect instance: toggle animation, add or
 * remove a keyframe at the playhead, jump to the previous or next keyframe.
 * Keyframes belong to the instance, so two copies of one effect animate
 * independently. Covers every numeric parameter of every classic effect.
 */
export const EffectAnimationControls: React.FC<{
  clipId: string;
  effect: Pick<Effect, "id" | "type" | "params">;
  disabled: boolean;
}> = ({ clipId, effect, disabled }) => {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const params = useMemo(() => getAnimatableEffectParams(effect), [effect]);
  if (!clip || params.length === 0) return null;
  const keyframes = clip.keyframes ?? NO_KEYFRAMES;
  const localTime = playhead - clip.startTime;
  const insideClip = localTime >= 0 && localTime <= clip.duration;
  const animatedCount = params.filter((param) => getEffectParamKeyframes(keyframes, effect.id, param.key).length > 0).length;
  return (
    <details className="rounded-md border border-border bg-bg-1 px-2 py-1" open={animatedCount > 0}>
      <summary className="cursor-pointer select-none text-[10px] text-fg-2">
        Animation{animatedCount > 0 ? ` (${animatedCount} animated)` : ""}
      </summary>
      <div className="mt-1.5 space-y-1.5">
        {params.map((param) => (
          <EffectParamAnimationRow key={param.key} clipId={clipId} effect={effect} param={param}
            keyframes={keyframes} localTime={localTime} insideClip={insideClip} disabled={disabled} />
        ))}
      </div>
    </details>
  );
};
