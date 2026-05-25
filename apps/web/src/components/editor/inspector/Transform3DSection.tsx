import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useProjectStore } from "../../../stores/project-store";
import {
  LabeledSlider as Slider,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@openreel/ui";

interface Transform3DSectionProps {
  clipId: string;
}

export const Transform3DSection: React.FC<Transform3DSectionProps> = ({
  clipId,
}) => {
  const { t } = useTranslation();
  const {
    getClip,
    getTextClip,
    getShapeClip,
    getSVGClip,
    getStickerClip,
    updateClipRotate3D,
    updateClipPerspective,
    updateClipTransformStyle,
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

  const rotate3d = clip?.transform.rotate3d ?? { x: 0, y: 0, z: 0 };
  const perspective = clip?.transform.perspective ?? 1000;
  const transformStyle = clip?.transform.transformStyle ?? "flat";

  const handleRotateXChange = useCallback(
    (x: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, x });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateYChange = useCallback(
    (y: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, y });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handleRotateZChange = useCallback(
    (z: number) => {
      updateClipRotate3D(clipId, { ...rotate3d, z });
    },
    [clipId, rotate3d, updateClipRotate3D],
  );

  const handlePerspectiveChange = useCallback(
    (value: number) => {
      updateClipPerspective(clipId, value);
    },
    [clipId, updateClipPerspective],
  );

  const handleTransformStyleChange = useCallback(
    (style: "flat" | "preserve-3d") => {
      updateClipTransformStyle(clipId, style);
    },
    [clipId, updateClipTransformStyle],
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
        <Slider
          label={t("inspector.rotationX")}
          value={rotate3d.x}
          onChange={handleRotateXChange}
          min={-360}
          max={360}
          step={1}
          unit="°"
        />

        <Slider
          label={t("inspector.rotationY")}
          value={rotate3d.y}
          onChange={handleRotateYChange}
          min={-360}
          max={360}
          step={1}
          unit="°"
        />

        <Slider
          label={t("inspector.rotationZ")}
          value={rotate3d.z}
          onChange={handleRotateZChange}
          min={-360}
          max={360}
          step={1}
          unit="°"
        />

        <Slider
          label={t("inspector.perspective")}
          value={perspective}
          onChange={handlePerspectiveChange}
          min={100}
          max={2000}
          step={10}
          unit="px"
        />

        <div className="space-y-1">
          <span className="text-[10px] text-text-secondary">
            {t("inspector.transformStyle")}
          </span>
          <Select
            value={transformStyle}
            onValueChange={(v) => handleTransformStyleChange(v as "flat" | "preserve-3d")}
          >
            <SelectTrigger className="w-full bg-background-tertiary border-border text-text-primary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background-secondary border-border">
              <SelectItem value="flat">{t("inspector.transformFlat")}</SelectItem>
              <SelectItem value="preserve-3d">{t("inspector.transformPreserve3D")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[9px] text-text-muted">
            {transformStyle === "flat"
              ? t("inspector.transformFlatDesc")
              : t("inspector.transformPreserve3DDesc")}
          </p>
        </div>

      {(rotate3d.x !== 0 || rotate3d.y !== 0 || rotate3d.z !== 0) && (
        <div className="p-2 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-[9px] text-text-muted">
            <span className="text-primary font-medium">{t("inspector.tip")}:</span>{" "}
            {t("inspector.transform3DTip")}
          </p>
        </div>
      )}
    </div>
  );
};
