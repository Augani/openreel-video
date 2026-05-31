import { useCallback, useMemo } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { keyframeEngine } from "@openreel/core";

export function useKeyframable(clipId: string, property: string, _displayScale: number) {
  const updateClipKeyframes = useProjectStore((s) => s.updateClipKeyframes);
  const getClip = useProjectStore((s) => s.getClip);
  const modifiedAt = useProjectStore((s) => s.project.modifiedAt);
  const playhead = useTimelineStore((s) => s.playheadPosition);

  const { keyframes, clipStart } = useMemo(() => {
    const clip = getClip(clipId);
    return { keyframes: clip?.keyframes ?? [], clipStart: clip?.startTime ?? 0 };
  }, [getClip, clipId, modifiedAt]);

  const propKfs = useMemo(
    () => keyframes.filter((k) => k.property === property).sort((a, b) => a.time - b.time),
    [keyframes, property],
  );
  const localTime = playhead - clipStart;
  const isAnimated = propKfs.length > 0;

  const valueAtPlayhead = useMemo(() => {
    if (!isAnimated) return undefined;
    const r = keyframeEngine.getValueAtTime(propKfs, localTime);
    return typeof r.value === "number" ? r.value : undefined;
  }, [isAnimated, propKfs, localTime]);

  const upsert = useCallback(
    (canonicalValue: number) => {
      const existing = propKfs.find((k) => Math.abs(k.time - localTime) < 0.001);
      let next;
      if (existing) {
        next = keyframes.map((k) => (k.id === existing.id ? { ...k, value: canonicalValue } : k));
      } else {
        const kf = keyframeEngine.addKeyframe(clipId, property, localTime, canonicalValue, "linear");
        next = [...keyframes, kf].sort((a, b) => a.time - b.time);
      }
      updateClipKeyframes(clipId, next);
    },
    [keyframes, propKfs, localTime, clipId, property, updateClipKeyframes],
  );

  const enable = useCallback((canonicalValue: number) => upsert(canonicalValue), [upsert]);
  const disable = useCallback(() => {
    updateClipKeyframes(clipId, keyframes.filter((k) => k.property !== property));
  }, [keyframes, clipId, property, updateClipKeyframes]);

  return { isAnimated, valueAtPlayhead, upsert, enable, disable };
}
