import React, { useCallback, useMemo } from "react";
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
      <div className="text-center py-8 text-text-muted text-xs">
        No clip selected
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
          <span className="text-[10px] text-text-secondary">Blend Mode</span>
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
            {blendMode === "normal" && "Default blending, no special effect"}
            {blendMode === "multiply" && "Darkens by multiplying colors"}
            {blendMode === "screen" && "Lightens by screening colors"}
            {blendMode === "overlay" && "Combines multiply and screen"}
            {blendMode === "darken" && "Keeps darker pixels"}
            {blendMode === "lighten" && "Keeps lighter pixels"}
            {blendMode === "color-dodge" && "Brightens base color"}
            {blendMode === "color-burn" && "Darkens base color"}
            {blendMode === "hard-light" && "Strong contrast effect"}
            {blendMode === "soft-light" && "Subtle contrast effect"}
            {blendMode === "difference" && "Subtracts colors"}
            {blendMode === "exclusion" && "Similar to difference but softer"}
          </p>
        </div>

        <Slider
          label="Opacity"
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
            <span className="text-primary font-medium">Tip:</span> Blend modes
            affect how this layer combines with layers below it. Experiment with
            different modes for creative effects.
          </p>
        </div>
      )}
    </div>
  );
};
