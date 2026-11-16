import React, { useMemo } from "react";
import {
  DEFAULT_TONE,
  DEFAULT_VIGNETTE,
  evaluateKeyframesAt,
  type Keyframe,
  type ToneValues,
  type VignetteValues,
} from "@openreel/core";
import { PropertySlider } from "./shell/PropertySlider";
import { EMPTY_KEYFRAMES, KeyframeButton } from "./PrimaryVideoProperties";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import type { ColorGradingSettings } from "../../../bridges/effects-bridge";

interface SliderSpec<K extends string> {
  key: K;
  label: string;
  min: number;
  max: number;
}

const TONE_SLIDERS: ReadonlyArray<SliderSpec<keyof ToneValues>> = [
  { key: "exposure", label: "Exposure", min: -1, max: 1 },
  { key: "contrast", label: "Contrast", min: -1, max: 1 },
  { key: "highlights", label: "Highlights", min: -1, max: 1 },
  { key: "shadows", label: "Shadows", min: -1, max: 1 },
  { key: "whites", label: "Whites", min: -1, max: 1 },
  { key: "blacks", label: "Blacks", min: -1, max: 1 },
];

const VIGNETTE_SLIDERS: ReadonlyArray<SliderSpec<keyof VignetteValues>> = [
  { key: "amount", label: "Amount", min: -1, max: 1 },
  { key: "midpoint", label: "Midpoint", min: 0, max: 1 },
  { key: "roundness", label: "Roundness", min: -1, max: 1 },
  { key: "feather", label: "Feather", min: 0, max: 1 },
];

const formatSigned = (value: number): string =>
  `${value > 0 ? "+" : ""}${value.toFixed(2).replace(/\.?0+$/u, "") || "0"}`;
const formatPlain = (value: number): string => value.toFixed(2).replace(/\.?0+$/u, "") || "0";

type Group = "tone" | "vignette";

/**
 * Sliders for one parameter group (Basic Correction tone or Vignette). Every
 * slider is keyframable: with a keyframe track on the parameter the slider
 * edits the keyframe at the playhead, otherwise it edits the stored grade.
 */
export function useGradeParameters(clipId: string, grade: ColorGradingSettings) {
  const updateColorGrading = useProjectStore((state) => state.updateColorGrading);
  const clip = useProjectStore((state) =>
    state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId),
  );
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const keyframes = clip?.keyframes ?? EMPTY_KEYFRAMES;
  const localTime = Math.max(0, Math.min(clip?.duration ?? 0, playhead - (clip?.startTime ?? 0)));
  const inside = !!clip && playhead >= clip.startTime && playhead <= clip.startTime + clip.duration;
  const sampled = useMemo(() => evaluateKeyframesAt(keyframes, localTime), [keyframes, localTime]);

  const setKeys = (next: Keyframe[]): void => {
    useProjectStore.getState().updateClipKeyframes(clipId, next);
  };
  const isAnimated = (property: string): boolean => keyframes.some((key) => key.property === property);

  const setKeyValue = (property: string, value: number): void => {
    const latest = useProjectStore.getState().getClip(clipId)?.keyframes ?? EMPTY_KEYFRAMES;
    let found = false;
    const next = latest.map((keyframe) => {
      if (keyframe.property !== property || Math.abs(keyframe.time - localTime) >= 0.01) return keyframe;
      found = true;
      return { ...keyframe, value };
    });
    if (!found) next.push({ id: crypto.randomUUID(), property, time: localTime, value, easing: "linear" });
    setKeys(next.sort((a, b) => a.time - b.time));
  };

  const read = (group: Group, key: string): number => {
    const defaults: Record<string, number> = group === "tone" ? { ...DEFAULT_TONE } : { ...DEFAULT_VIGNETTE };
    const stored = ((group === "tone" ? grade.tone : grade.vignette) as Record<string, number> | undefined)?.[key];
    return sampled.get(`colorGrade.${group}.${key}`) ?? stored ?? defaults[key];
  };

  const write = (group: Group, key: string, value: number): void => {
    const property = `colorGrade.${group}.${key}`;
    if (isAnimated(property)) {
      if (inside) setKeyValue(property, value);
      return;
    }
    if (group === "tone") {
      void updateColorGrading(clipId, { tone: { ...DEFAULT_TONE, ...grade.tone, [key]: value } });
    } else {
      void updateColorGrading(clipId, { vignette: { ...DEFAULT_VIGNETTE, ...grade.vignette, [key]: value } });
    }
  };

  return { keyframes, localTime, inside, setKeys, isAnimated, read, write };
}

export const GradeSliders: React.FC<{
  clipId: string;
  grade: ColorGradingSettings;
  group: Group;
  idPrefix: string;
}> = ({ clipId, grade, group, idPrefix }) => {
  const parameters = useGradeParameters(clipId, grade);
  const specs = group === "tone" ? TONE_SLIDERS : VIGNETTE_SLIDERS;
  const defaults: Record<string, number> = group === "tone" ? { ...DEFAULT_TONE } : { ...DEFAULT_VIGNETTE };
  return (
    <div className="space-y-2.5" data-testid={`${idPrefix}-sliders`}>
      {specs.map((spec) => {
        const property = `colorGrade.${group}.${spec.key}`;
        const value = parameters.read(group, spec.key);
        const signed = spec.min < 0;
        return (
          <div key={spec.key} className="flex items-end gap-1.5">
            <PropertySlider
              label={spec.label}
              ariaLabel={group === "tone" ? spec.label : `Vignette ${spec.label}`}
              value={value}
              onChange={(next) => parameters.write(group, spec.key, next)}
              defaultValue={defaults[spec.key]}
              min={spec.min}
              max={spec.max}
              step={0.01}
              isDisabled={!parameters.inside && parameters.isAnimated(property)}
              formatValue={signed ? formatSigned : formatPlain}
              className="flex-1"
            />
            <KeyframeButton
              keyframes={parameters.keyframes}
              time={parameters.localTime}
              disabled={!parameters.inside}
              onChange={parameters.setKeys}
              properties={{ [property]: value }}
            />
          </div>
        );
      })}
    </div>
  );
};
