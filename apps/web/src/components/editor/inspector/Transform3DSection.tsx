import React, { useCallback, useId } from "react";
import { Card, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openreel/ui";

import { PropertySlider } from "./shell/PropertySlider";
import { useProjectStore } from "../../../stores/project-store";

interface Transform3DSectionProps {
  clipId: string;
}

const flatRotation = { x: 0, y: 0, z: 0 };

export const Transform3DSection: React.FC<Transform3DSectionProps> = ({
  clipId,
}) => {
  const clip = useProjectStore(state => state.getClip(clipId) ?? state.getTextClip(clipId)
    ?? state.getShapeClip(clipId) ?? state.getSVGClip(clipId) ?? state.getStickerClip(clipId));
  const locked = useProjectStore(state => Boolean(state.project.timeline.tracks.find(track => track.id === clip?.trackId)?.locked));
  const updateClipRotate3D = useProjectStore(state => state.updateClipRotate3D);
  const updateClipPerspective = useProjectStore(state => state.updateClipPerspective);
  const updateClipTransformStyle = useProjectStore(state => state.updateClipTransformStyle);
  const styleId = useId();

  const rotate3d = clip?.transform.rotate3d ?? flatRotation;
  const perspective = clip?.transform.perspective ?? 1000;
  const transformStyle = clip?.transform.transformStyle ?? "flat";

  const handleRotateXChange = useCallback(
    (x: number) => {
      void updateClipRotate3D(clipId, { ...rotate3d, x });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateYChange = useCallback(
    (y: number) => {
      void updateClipRotate3D(clipId, { ...rotate3d, y });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateZChange = useCallback(
    (z: number) => {
      void updateClipRotate3D(clipId, { ...rotate3d, z });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handlePerspectiveChange = useCallback(
    (value: number) => {
      void updateClipPerspective(clipId, value);
    },
    [clipId, updateClipPerspective],
  );

  const handleTransformStyleChange = useCallback(
    (style: "flat" | "preserve-3d") => {
      void updateClipTransformStyle(clipId, style);
    },
    [clipId, updateClipTransformStyle],
  );

  if (!clip) {
    return (
      <span className="text-fg-2 font-normal py-8 text-center text-xs">
        No clip selected
      </span>
    );
  }

  return (
    <div className="space-y-3">
      <PropertySlider
        isDisabled={locked}
        label="Rotation X"
        value={rotate3d.x}
        onChange={handleRotateXChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        isDisabled={locked}
        label="Rotation Y"
        value={rotate3d.y}
        onChange={handleRotateYChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        isDisabled={locked}
        label="Rotation Z"
        value={rotate3d.z}
        onChange={handleRotateZChange}
        min={-360}
        max={360}
        step={1}
        formatValue={(value) => `${Math.round(value)}°`}
      />

      <PropertySlider
        isDisabled={locked}
        label="Perspective"
        value={perspective}
        onChange={handlePerspectiveChange}
        min={100}
        max={2000}
        step={10}
        formatValue={(value) => `${Math.round(value)}px`}
      />

      <div className="space-y-1">
        <div className="min-w-0 space-y-1.5">
        <Label htmlFor={styleId} className="block truncate text-[11px] font-medium leading-[1.5] text-text-secondary">Transform Style</Label>
        <Select value={transformStyle} disabled={locked} onValueChange={value => {
          if (value === "flat" || value === "preserve-3d") handleTransformStyleChange(value);
        }}>
          <SelectTrigger id={styleId} aria-describedby={`${styleId}-description`}
            className="flex h-7 w-full min-w-0 rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[12px] font-medium text-fg-2 outline-none transition-colors placeholder:text-fg-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="flat">Flat</SelectItem>
            <SelectItem value="preserve-3d">Preserve 3D</SelectItem>
          </SelectContent>
        </Select>
        </div>
        <span id={`${styleId}-description`} className="text-fg-2 font-normal text-[9px]">
          {transformStyle === "flat" &&
            "Flattens children into the plane of this element"}
          {transformStyle === "preserve-3d" && "Children positioned in 3D space"}
        </span>
      </div>

      {(rotate3d.x !== 0 || rotate3d.y !== 0 || rotate3d.z !== 0) && (
        <Card className="min-w-0 rounded-[7px] shadow-none text-fg p-2 border border-primary/20 bg-primary/5">
          <span className="text-fg-2 font-normal text-[9px]">
            Tip: 3D rotations
            allow you to rotate layers along X, Y, and Z axes for depth effects.
            Adjust perspective to control the 3D depth perception.
          </span>
        </Card>
      )}
    </div>
  );
};
