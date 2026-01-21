import React from "react";
import { Crop, RotateCcw } from "lucide-react";
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
      <button
        onClick={handleEnableCropMode}
        className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-2"
      >
        <Crop size={14} />
        {isCropped ? "Adjust Crop" : "Crop Video"}
      </button>

      {isCropped && (
        <>
          <div className="text-[9px] text-text-muted space-y-0.5 p-2 bg-background-tertiary rounded border border-border">
            <div className="flex justify-between">
              <span>Crop Region:</span>
              <span>
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span>Position:</span>
              <span>
                ({Math.round(crop.x * 100)}%, {Math.round(crop.y * 100)}%)
              </span>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="w-full py-2 text-xs text-text-secondary hover:text-text-primary bg-background-tertiary hover:bg-background-elevated border border-border rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw size={12} />
            Reset Crop
          </button>
        </>
      )}
    </div>
  );
};
