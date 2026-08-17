import React, { useCallback, useMemo } from "react";
import { ToolcraftText as Text } from "@openreel/ui";
import { MockSlider } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import {
  getAvailableBlendModes,
  getBlendModeName,
  type BlendMode,
} from "@openreel/core";
import { useTranslation } from "react-i18next";

interface BlendingSectionProps {
  clipId: string;
}

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
      <Text
        type="supporting"
        color="secondary"
        className="py-8 text-center text-xs"
      >
        {t("No clip selected")}</Text>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <span className="w-[90px] flex-none text-[14px] font-semibold text-fg">
          {t("Blending")}</span>
        <div className="relative flex-1">
          <select
            aria-label={t("Blend mode")}
            value={blendMode}
            onChange={(event) =>
              handleBlendModeChange(event.target.value as BlendMode)
            }
            className="w-full appearance-none rounded-[7px] border border-border bg-transparent px-[10px] py-[8px] pr-7 text-[13px] font-medium text-fg-2 outline-none focus:border-accent"
          >
            {availableBlendModes.map((mode) => (
              <option key={mode} value={mode}>
                {getBlendModeName(mode)}
              </option>
            ))}
          </select>
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--fg-muted)"
            strokeWidth="2.2"
            aria-hidden
            className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {blendMode !== "normal" && (
        <div className="flex items-center">
          <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
            {t("Blend Opacity")}</span>
          <MockSlider
            className="flex-1"
            value={blendOpacity}
            min={0}
            max={100}
            step={1}
            onChange={handleOpacityChange}
            showValueBox
            formatValue={(value) => `${Math.round(value)}%`}
          />
        </div>
      )}
    </div>
  );
};
