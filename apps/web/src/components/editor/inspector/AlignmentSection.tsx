import React, { useCallback } from "react";
import { Button } from "@openreel/ui";


import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "@/icons/lucide-compat";
import type { Transform } from "@openreel/core";
import { useT } from "@openreel/i18n/react";

interface AlignmentSectionProps {
  clipType: string | null;
  transform: Transform;
  canvasWidth: number;
  canvasHeight: number;
  onTransformChange: (changes: Partial<Transform>) => void;
}

export const AlignmentSection: React.FC<AlignmentSectionProps> = ({
  clipType,
  transform,
  canvasWidth,
  canvasHeight,
  onTransformChange,
}) => {
  const t = useT();
  const usesNormalizedPosition =
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const handleAlign = useCallback(
    (axis: "x" | "y", normalizedValue: 0 | 0.5 | 1) => {
      const dimension = axis === "x" ? canvasWidth : canvasHeight;
      const value = usesNormalizedPosition
        ? normalizedValue
        : (normalizedValue - 0.5) * dimension;
      onTransformChange({
        position: { ...transform.position, [axis]: value },
      });
    },
    [
      canvasHeight,
      canvasWidth,
      onTransformChange,
      transform.position,
      usesNormalizedPosition,
    ],
  );

  const handleCenterBoth = useCallback(() => {
    onTransformChange({
      position: usesNormalizedPosition ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 },
    });
  }, [onTransformChange, usesNormalizedPosition]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[12px] leading-5 text-fg-2 font-normal w-16">
          {t("Horizontal")}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("x", 0)} type="button" aria-label={t("Align Left")} title={t("Align Left")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignHorizontalJustifyStart size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("x", 0.5)} type="button" aria-label={t("Center Horizontally")} title={t("Center Horizontally")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignHorizontalJustifyCenter size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("x", 1)} type="button" aria-label={t("Align Right")} title={t("Align Right")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignHorizontalJustifyEnd size={14} aria-hidden />}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] leading-5 text-fg-2 font-normal w-16">
          {t("Vertical")}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("y", 0)} type="button" aria-label={t("Align Top")} title={t("Align Top")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignVerticalJustifyStart size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("y", 0.5)} type="button" aria-label={t("Center Vertically")} title={t("Center Vertically")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignVerticalJustifyCenter size={14} aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => handleAlign("y", 1)} type="button" aria-label={t("Align Bottom")} title={t("Align Bottom")} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
            {<AlignVerticalJustifyEnd size={14} aria-hidden />}
          </Button>
        </div>
      </div>
      <Button onClick={handleCenterBoth} type="button" aria-label={t("Center on Canvas")} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5 text-[12px] border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg w-full">
        <span className="truncate">{t("Center on Canvas")}</span>
      </Button>
      <span className="font-normal block text-center text-[9px] text-fg-muted">
        {usesNormalizedPosition
          ? t("Aligns the overlay anchor in canvas space")
          : t("Aligns the media anchor using pixel offsets from center")}
      </span>
    </div>
  );
};
