import React, { useMemo } from "react";
import type { ColorGradingSettings } from "../../../../bridges/effects-bridge";
import type { PreviewEffectDef } from "../../panels/effect-previews/preview-engine";
import { LookCard } from "./LookCard";
import { CompareToggle, useLookCompare } from "./compare-context";
import { currentLookDef, effectsSignature, gradeSignature, memoLookDef, mergedPreviewGrading, type PreviewClipEffect } from "./look-defs";

export interface WhiteBalancePreset {
  label: string;
  temperature: number;
  tint: number;
}

/** The preview renders the grade applying the preset produces on this clip: its current grade plus temperature and tint. */
function previewDefFor(
  preset: WhiteBalancePreset,
  current: ColorGradingSettings | undefined,
  clipEffects: ReadonlyArray<PreviewClipEffect>,
): PreviewEffectDef {
  const id = `look-wb-${preset.label}-${preset.temperature}-${preset.tint}-${gradeSignature(current)}-${effectsSignature(clipEffects)}`;
  return memoLookDef(id, () => ({
    id,
    kind: "look",
    type: "white-balance",
    // Applying a white balance leaves the clip's effects alone: they render first, as they do on the monitor.
    ...(clipEffects.length > 0 ? { effects: clipEffects } : {}),
    grading: mergedPreviewGrading(current, { temperature: preset.temperature, tint: preset.tint }),
  }));
}

interface Props {
  presets: readonly WhiteBalancePreset[];
  /** The clip's grade today, so each card shows the result of applying on top of it. */
  currentGrading?: ColorGradingSettings;
  /** The clip's own effects, which render under the grade. */
  clipEffects?: ReadonlyArray<PreviewClipEffect>;
  isActive: (preset: WhiteBalancePreset) => boolean;
  onApply: (preset: WhiteBalancePreset) => void;
}

/** White balance presets as footage previews instead of text chips. */
export const WhiteBalancePresets: React.FC<Props> = ({ presets, currentGrading, clipEffects = [], isActive, onApply }) => {
  const { compare } = useLookCompare();
  const before = useMemo(() => (compare ? currentLookDef(clipEffects, currentGrading) : null), [compare, clipEffects, currentGrading]);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <CompareToggle testId="wb-compare" />
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="White balance presets">
        {presets.map((preset) => (
          <LookCard
            key={preset.label}
            def={previewDefFor(preset, currentGrading, clipEffects)}
            before={before}
            label={preset.label}
            ariaLabel={`Apply ${preset.label} white balance`}
            applied={isActive(preset)}
            onApply={() => onApply(preset)}
          />
        ))}
      </div>
    </div>
  );
};

export default WhiteBalancePresets;
