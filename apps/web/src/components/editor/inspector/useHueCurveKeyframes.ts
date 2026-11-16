import { useCallback, useMemo } from "react";
import {
  HUE_CURVE_KINDS,
  createDefaultHueCurves,
  evaluateKeyframesAt,
  hueCurveHasKeyframes,
  hueCurvePointProperty,
  normalizeHueCurvePoints,
  type CurvePoint,
  type HueCurveKind,
  type HueCurvesValues,
  type Keyframe,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { EMPTY_KEYFRAMES } from "./PrimaryVideoProperties";
import { toast } from "../../../stores/notification-store";

export interface HueCurveKeyframing {
  keyframes: Keyframe[];
  localTime: number;
  inside: boolean;
  setKeys: (next: Keyframe[]) => void;
  isAnimated: (kind: HueCurveKind, index: number) => boolean;
}

/**
 * Keyframing for the hue-curve editor. A point's output (y) is animated with
 * the property `colorGrade.hueCurve.<kind>.<n>`:
 *  - `shown` is the stored curve set with every keyframed point sampled at the
 *    playhead, which is what the editor draws;
 *  - `apply` takes the editor's edit and routes it: a moved animated point
 *    writes a keyframe at the playhead, everything else edits the stored grade.
 */
export function useHueCurveKeyframes(
  clipId: string,
  stored: HueCurvesValues,
  commitStored: (values: HueCurvesValues) => void,
) {
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const keyframes = clip?.keyframes ?? EMPTY_KEYFRAMES;
  const localTime = Math.max(0, Math.min(clip?.duration ?? 0, playhead - (clip?.startTime ?? 0)));
  const inside = !!clip && playhead >= clip.startTime && playhead <= clip.startTime + clip.duration;
  const sampled = useMemo(() => evaluateKeyframesAt(keyframes, localTime), [keyframes, localTime]);

  const isAnimated = useCallback(
    (kind: HueCurveKind, index: number): boolean => {
      const property = hueCurvePointProperty(kind, index);
      return keyframes.some((keyframe) => keyframe.property === property);
    },
    [keyframes],
  );

  const shown = useMemo<HueCurvesValues>(() => {
    const out = createDefaultHueCurves();
    for (const kind of HUE_CURVE_KINDS) {
      const points = normalizeHueCurvePoints(stored[kind]);
      out[kind] = (points.length ? points : out[kind]).map((point, index) => {
        const value = sampled.get(hueCurvePointProperty(kind, index));
        return value === undefined ? point : { x: point.x, y: Math.max(0, Math.min(1, value)) };
      });
    }
    return out;
  }, [stored, sampled]);

  const setKeys = useCallback(
    (next: Keyframe[]): void => {
      useProjectStore.getState().updateClipKeyframes(clipId, next);
    },
    [clipId],
  );

  const setKeyValue = useCallback(
    (property: string, value: number): void => {
      const latest = useProjectStore.getState().getClip(clipId)?.keyframes ?? EMPTY_KEYFRAMES;
      let found = false;
      const next = latest.map((keyframe) => {
        if (keyframe.property !== property || Math.abs(keyframe.time - localTime) >= 0.01) return keyframe;
        found = true;
        return { ...keyframe, value };
      });
      if (!found) next.push({ id: crypto.randomUUID(), property, time: localTime, value, easing: "linear" });
      setKeys(next.sort((a, b) => a.time - b.time));
    },
    [clipId, localTime, setKeys],
  );

  const apply = useCallback(
    (next: HueCurvesValues): void => {
      const merged: HueCurvesValues = { ...stored };
      let storedChanged = false;
      for (const kind of HUE_CURVE_KINDS) {
        const before = shown[kind];
        const after = next[kind];
        if (after === before) continue;
        const animatedCurve = hueCurveHasKeyframes(keyframes, kind);
        if (animatedCurve && after.length !== before.length) {
          toast.warning("Hue curve is keyframed", "Remove this curve's keyframes before adding or removing points.");
          continue;
        }
        const storedPoints = normalizeHueCurvePoints(stored[kind]);
        const base: CurvePoint[] = storedPoints.length === before.length ? storedPoints : before;
        const result: CurvePoint[] = after.map((point, index) => {
          const previous = before[index];
          const yMoved = previous === undefined || Math.abs(point.y - previous.y) > 1e-9;
          if (previous && yMoved && isAnimated(kind, index)) {
            if (inside) setKeyValue(hueCurvePointProperty(kind, index), point.y);
            return { x: point.x, y: base[index]?.y ?? point.y };
          }
          return { x: point.x, y: point.y };
        });
        const same = result.length === base.length && result.every((p, i) => p.x === base[i].x && p.y === base[i].y);
        if (!same) {
          merged[kind] = result;
          storedChanged = true;
        }
      }
      if (storedChanged) commitStored(merged);
    },
    [commitStored, inside, isAnimated, keyframes, setKeyValue, shown, stored],
  );

  const keyframing: HueCurveKeyframing = { keyframes, localTime, inside, setKeys, isAnimated };
  return { shown, apply, keyframing };
}
