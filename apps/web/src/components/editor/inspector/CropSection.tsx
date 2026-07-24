import React from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Crop, RotateCcw } from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import type { Clip } from "@openreel/core";

interface CropSectionProps {
  clip: Clip;
}

export const CropSection: React.FC<CropSectionProps> = ({ clip }) => {
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const setCropMode = useUIStore((state) => state.setCropMode);

  const crop = clip.transform.crop || { x: 0, y: 0, width: 1, height: 1 };
  const isCropped =
    crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1;

  const handleReset = () => {
    updateClipTransform(clip.id, { crop: undefined });
  };

  const handleEnableCropMode = () => {
    setCropMode(true, clip.id);
  };

  return (
    <div className="space-y-3">
      <Button
        label={isCropped ? "Adjust Crop" : "Crop Video"}
        icon={<Crop size={14} />}
        variant="primary"
        size="sm"
        onClick={handleEnableCropMode}
        className="w-full justify-center"
      />

      {isCropped && (
        <>
          <Card variant="muted" padding={2} className="space-y-0.5 border border-border">
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" className="text-[9px]">
                Crop Region:
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </Text>
            </div>
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" className="text-[9px]">
                Position:
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                ({Math.round(crop.x * 100)}%, {Math.round(crop.y * 100)}%)
              </Text>
            </div>
          </Card>
          <Button
            label="Reset Crop"
            icon={<RotateCcw size={12} />}
            variant="secondary"
            size="sm"
            onClick={handleReset}
            className="w-full justify-center"
          />
        </>
      )}
    </div>
  );
};
