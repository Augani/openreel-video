import React, { useCallback, useMemo } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";
import { InlineSlider } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import {
  getAvailableBlendModes,
  getBlendModeName,
  type BlendMode,
} from "@openreel/core";

interface BlendingSectionProps {
  clipId: string;
}

export const BlendingSection: React.FC<BlendingSectionProps> = ({ clipId }) => {
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
      <span className="text-fg-2 font-normal py-8 text-center text-xs"
      >
        No clip selected
      </span>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <span className="w-[90px] flex-none text-[14px] font-semibold text-fg">
          Blending
        </span>
        <div className="relative flex-1">
          <Select
            value={blendMode}
            onValueChange={(value) =>
              handleBlendModeChange(value as BlendMode)
            }
          >
            <SelectTrigger aria-label="Blend mode" className="h-auto w-full rounded-[7px] border border-border bg-transparent px-[10px] py-[8px] text-[13px] font-medium text-fg-2 outline-none focus:border-accent [&>svg]:size-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>{availableBlendModes.map((mode) => (
              <SelectItem key={mode} value={mode}>{getBlendModeName(mode)}</SelectItem>
            ))}</SelectContent>
          </Select>
        </div>
      </div>

      {blendMode !== "normal" && (
        <div className="flex items-center">
          <span className="w-[90px] flex-none text-[13px] font-medium text-fg-3">
            Blend Opacity
          </span>
          <InlineSlider
            ariaLabel="Blend opacity"
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
