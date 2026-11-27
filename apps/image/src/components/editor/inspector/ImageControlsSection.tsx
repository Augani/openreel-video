import { Crop, ImageIcon } from 'lucide-react';
import type { ImageLayer } from '../../../types/project';
import { useT } from "@openreel/i18n/react";

interface Props {
  layer: ImageLayer;
}

export function ImageControlsSection({ layer }: Props) {
  const t = useT();
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t("Image")}
      </h4>

      <div className="p-3 bg-secondary/30 rounded-lg">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ImageIcon size={14} />
          <span className="text-[11px]">{t("Source:")} {layer.sourceId ? t("Linked") : t("None")}</span>
        </div>
        {layer.cropRect && (
          <div className="flex items-center gap-2 text-muted-foreground mt-2">
            <Crop size={14} />
            <span className="text-[11px]">
              {t("Cropped:")} {Math.round(layer.cropRect.width)} × {Math.round(layer.cropRect.height)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
