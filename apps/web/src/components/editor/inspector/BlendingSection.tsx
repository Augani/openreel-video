import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../../../stores/project-store";
import {
  getAvailableBlendModes,
  getBlendModeName,
  type BlendMode,
} from "@openreel/core";
import {
  LabeledSlider as Slider,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";

interface BlendingSectionProps {
  clipId: string;
}

const BLEND_MODE_DESC_KEYS: Record<string, string> = {
  normal: "inspector.blendNormalDesc",
  multiply: "inspector.blendMultiplyDesc",
  screen: "inspector.blendScreenDesc",
  overlay: "inspector.blendOverlayDesc",
  darken: "inspector.blendDarkenDesc",
  lighten: "inspector.blendLightenDesc",
  "color-dodge": "inspector.blendColorDodgeDesc",
  "color-burn": "inspector.blendColorBurnDesc",
  "hard-light": "inspector.blendHardLightDesc",
  "soft-light": "inspector.blendSoftLightDesc",
  difference: "inspector.blendDifferenceDesc",
  exclusion: "inspector.blendExclusionDesc",
};

export const BlendingSection: React.FC<BlendingSectionProps> = ({ clipId }) => {
  const { t } = useTranslation();
  const {
    getClip,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    updateClipBlendMode,
    updateClipBlendOpacity,
    project,
  } = useProjectStore();

  const clip = useMemo(() => {
    const regularClip = getClip(clipId);
    if (regularClip) return regularClip;
    const textClip = getTextClip(clipId);
    if (textClip) return textClip;
    const shapeClip = getShapeClip(clipId);
    if (shapeClip) return shapeClip;
    const svgClip = getSVGClip(clipId);
    if (svgClip) return svgClip;
    const stickerClip = getStickerClip(clipId);
    if (stickerClip) return stickerClip;
    return null;
  }, [
    clipId,
    getClip,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    project.modifiedAt,
  ]);

  const blendMode = clip?.blendMode || "normal";
  const blendOpacity = clip?.blendOpacity ?? 100;

  const availableBlendModes = useMemo(() => getAvailableBlendModes(), []);

  const handleBlendModeChange = useCallback(
    (mode: BlendMode) => {
      updateClipBlendMode(clipId, mode);
    },
    [clipId, updateClipBlendMode],
  );

  const handleOpacityChange = useCallback(
    (opacity: number) => {
      updateClipBlendOpacity(clipId, opacity);
    },
    [clipId, updateClipBlendOpacity],
  );

  if (!clip) {
    return (
      <div className="text-center py-8 text-text-muted text-xs">
        {t("inspector.noClipSelected")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
          <span className="text-[10px] text-text-secondary">{t("inspector.blendModeTitle")}</span>
          <Select
            value={blendMode}
            onValueChange={(v) => handleBlendModeChange(v as BlendMode)}
          >
            <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              {availableBlendModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {getBlendModeName(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[9px] text-text-muted">
            {t(BLEND_MODE_DESC_KEYS[blendMode] || "inspector.blendNormalDesc")}
          </p>
        </div>

        <Slider
          label={t("inspector.opacity")}
          value={blendOpacity}
          onChange={handleOpacityChange}
          min={0}
          max={100}
          step={1}
          unit="%"
        />

      {blendMode !== "normal" && (
        <div className="p-2 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-[9px] text-text-muted">
            <span className="text-primary font-medium">{t("inspector.tip")}:</span>{" "}
            {t("inspector.blendModeTip")}
          </p>
        </div>
      )}
    </div>
  );
};
