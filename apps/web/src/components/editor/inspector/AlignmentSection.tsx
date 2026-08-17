import React, { useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "@/icons/lucide-compat";
import type { Transform } from "@openreel/core";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
        <Text type="supporting" color="secondary" className="w-16">
          {t("Horizontal")}</Text>
        <div className="flex gap-1">
          <IconButton
            label={t("Align Left")}
            icon={<AlignHorizontalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0)}
          />
          <IconButton
            label={t("Center Horizontally")}
            icon={<AlignHorizontalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 0.5)}
          />
          <IconButton
            label={t("Align Right")}
            icon={<AlignHorizontalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("x", 1)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Text type="supporting" color="secondary" className="w-16">
          {t("Vertical")}</Text>
        <div className="flex gap-1">
          <IconButton
            label={t("Align Top")}
            icon={<AlignVerticalJustifyStart size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0)}
          />
          <IconButton
            label={t("Center Vertically")}
            icon={<AlignVerticalJustifyCenter size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 0.5)}
          />
          <IconButton
            label={t("Align Bottom")}
            icon={<AlignVerticalJustifyEnd size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => handleAlign("y", 1)}
          />
        </div>
      </div>
      <Button
        label={t("Center on Canvas")}
        variant="secondary"
        size="sm"
        onClick={handleCenterBoth}
        className="w-full"
      />
      <Text type="supporting" color="secondary" className="block text-center text-[9px] text-fg-muted">
        {usesNormalizedPosition
          ? "Aligns the overlay anchor in canvas space"
          : "Aligns the media anchor using pixel offsets from center"}
      </Text>
    </div>
  );
};
