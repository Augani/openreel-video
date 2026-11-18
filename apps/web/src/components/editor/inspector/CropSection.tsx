import React from "react";
import { Button } from "@openreel/ui";
import { Card } from "@openreel/ui";

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
      <Button onClick={handleEnableCropMode} type="button" aria-label={(isCropped ? "Adjust Crop" : "Crop Video").trim() || undefined} className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] bg-accent text-accent-fg hover:bg-accent/90 w-full justify-center">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<Crop size={14} />}</span>
        <span className="truncate">{isCropped ? "Adjust Crop" : "Crop Video"}</span>
      </Button>

      {isCropped && (
        <>
          <Card className="min-w-0 rounded-[7px] shadow-none bg-bg-2 text-fg p-2 space-y-0.5 border border-border">
            <div className="flex justify-between">
              <span className="text-fg-2 font-normal text-[9px]">
                Crop Region:
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-2 font-normal text-[9px]">
                Position:
              </span>
              <span className="text-fg-2 font-normal text-[9px]">
                ({Math.round(crop.x * 100)}%, {Math.round(crop.y * 100)}%)
              </span>
            </div>
          </Card>
          <Button onClick={handleReset} type="button" aria-label="Reset Crop" className="inline-flex min-w-0 items-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full justify-center">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{<RotateCcw size={12} />}</span>
            <span className="truncate">{"Reset Crop"}</span>
          </Button>
        </>
      )}
    </div>
  );
};
