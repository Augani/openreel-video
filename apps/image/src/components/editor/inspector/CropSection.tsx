import { useCallback, useMemo } from 'react';
import { useProjectStore } from '../../../stores/project-store';
import { useUIStore, CropAspectRatio } from '../../../stores/ui-store';
import type { ImageLayer } from '../../../types/project';
import { Crop, Check, X, RotateCcw, Lock, Unlock } from 'lucide-react';

const imageCache = new Map<string, HTMLImageElement>();
function getCachedImage(src: string): HTMLImageElement | null {
  if (!src) return null;
  if (imageCache.has(src)) return imageCache.get(src)!;
  const img = new Image();
  img.src = src;
  imageCache.set(src, img);
  return img;
}

interface Props {
  layer: ImageLayer;
}

const ASPECT_RATIOS: { value: CropAspectRatio; label: string; ratio?: number }[] = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
];

export function CropSection({ layer }: Props) {
  const { updateLayer, project } = useProjectStore();
  const { crop, startCrop, cancelCrop, applyCrop, setCropAspectRatio, updateCropRect, setCropLockAspect } = useUIStore();

  const lockAspect = crop.lockAspect;
  const setLockAspect = setCropLockAspect;

  const isCropping = crop.isActive && crop.layerId === layer.id;

  const imageDimensions = useMemo(() => {
    if (!project) return null;
    const asset = project.assets[layer.sourceId];
    if (!asset) return null;
    const src = asset.blobUrl ?? asset.dataUrl;
    if (!src) return null;
    const img = getCachedImage(src);
    if (img && img.complete && img.naturalWidth > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    return asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
  }, [project, layer.sourceId]);

  const handleStartCrop = useCallback(() => {
    const initialRect = layer.cropRect ?? {
      x: 0,
      y: 0,
      width: layer.transform.width,
      height: layer.transform.height,
    };
    startCrop(layer.id, initialRect);
  }, [layer, startCrop]);

  const handleApplyCrop = useCallback(() => {
    const result = applyCrop();
    if (result && result.cropRect) {
      const existingCropRect = layer.cropRect;
      let finalCropRect: { x: number; y: number; width: number; height: number };

      if (existingCropRect) {
        const scaleX = existingCropRect.width / layer.transform.width;
        const scaleY = existingCropRect.height / layer.transform.height;
        finalCropRect = {
          x: existingCropRect.x + result.cropRect.x * scaleX,
          y: existingCropRect.y + result.cropRect.y * scaleY,
          width: result.cropRect.width * scaleX,
          height: result.cropRect.height * scaleY,
        };
      } else if (imageDimensions) {
        const scaleX = imageDimensions.width / layer.transform.width;
        const scaleY = imageDimensions.height / layer.transform.height;
        finalCropRect = {
          x: result.cropRect.x * scaleX,
          y: result.cropRect.y * scaleY,
          width: result.cropRect.width * scaleX,
          height: result.cropRect.height * scaleY,
        };
      } else {
        finalCropRect = result.cropRect;
      }

      updateLayer<ImageLayer>(result.layerId, {
        cropRect: finalCropRect,
        transform: {
          ...layer.transform,
          x: layer.transform.x + result.cropRect.x,
          y: layer.transform.y + result.cropRect.y,
          width: result.cropRect.width,
          height: result.cropRect.height,
        },
      });
    }
  }, [applyCrop, updateLayer, layer, imageDimensions]);

  const handleResetCrop = useCallback(() => {
    if (isCropping) {
      updateCropRect({
        x: 0,
        y: 0,
        width: layer.transform.width,
        height: layer.transform.height,
      });
    } else {
      updateLayer<ImageLayer>(layer.id, { cropRect: null });
    }
  }, [isCropping, layer, updateCropRect, updateLayer]);

  const handleAspectRatioChange = useCallback(
    (ratio: CropAspectRatio) => {
      setCropAspectRatio(ratio);

      if (!crop.cropRect) return;

      const aspectConfig = ASPECT_RATIOS.find((r) => r.value === ratio);
      if (!aspectConfig?.ratio) return;

      const currentWidth = crop.cropRect.width;
      const currentHeight = crop.cropRect.height;
      const currentCenterX = crop.cropRect.x + currentWidth / 2;
      const currentCenterY = crop.cropRect.y + currentHeight / 2;

      let newWidth = currentWidth;
      let newHeight = currentWidth / aspectConfig.ratio;

      if (newHeight > layer.transform.height) {
        newHeight = layer.transform.height;
        newWidth = newHeight * aspectConfig.ratio;
      }

      if (newWidth > layer.transform.width) {
        newWidth = layer.transform.width;
        newHeight = newWidth / aspectConfig.ratio;
      }

      let newX = currentCenterX - newWidth / 2;
      let newY = currentCenterY - newHeight / 2;

      newX = Math.max(0, Math.min(newX, layer.transform.width - newWidth));
      newY = Math.max(0, Math.min(newY, layer.transform.height - newHeight));

      updateCropRect({
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
    },
    [crop.cropRect, layer.transform, setCropAspectRatio, updateCropRect]
  );

  const hasCrop = layer.cropRect !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Crop</h4>
        {hasCrop && !isCropping && (
          <button
            onClick={handleResetCrop}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {!isCropping ? (
        <button
          onClick={handleStartCrop}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <Crop size={16} />
          {hasCrop ? 'Adjust Crop' : 'Crop Image'}
        </button>
      ) : (
        <div className="space-y-3 p-3 bg-secondary/30 rounded-lg border border-border/50">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-foreground">Aspect Ratio</label>
              <button
                onClick={() => setLockAspect(!lockAspect)}
                className={`p-1 rounded transition-colors ${
                  lockAspect ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {lockAspect ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar.value}
                  onClick={() => handleAspectRatioChange(ar.value)}
                  className={`px-2 py-1.5 text-[10px] font-medium rounded transition-colors ${
                    crop.aspectRatio === ar.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
                  }`}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          </div>

          {crop.cropRect && (
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-foreground">Crop Area</label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[9px] text-muted-foreground">X</label>
                  <input
                    type="number"
                    value={Math.round(crop.cropRect.x)}
                    onChange={(e) =>
                      updateCropRect({
                        ...crop.cropRect!,
                        x: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2 py-1 text-[11px] bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-muted-foreground">Y</label>
                  <input
                    type="number"
                    value={Math.round(crop.cropRect.y)}
                    onChange={(e) =>
                      updateCropRect({
                        ...crop.cropRect!,
                        y: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2 py-1 text-[11px] bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-muted-foreground">Width</label>
                  <input
                    type="number"
                    value={Math.round(crop.cropRect.width)}
                    onChange={(e) =>
                      updateCropRect({
                        ...crop.cropRect!,
                        width: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2 py-1 text-[11px] bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-muted-foreground">Height</label>
                  <input
                    type="number"
                    value={Math.round(crop.cropRect.height)}
                    onChange={(e) =>
                      updateCropRect({
                        ...crop.cropRect!,
                        height: Math.max(1, Number(e.target.value)),
                      })
                    }
                    className="w-full px-2 py-1 text-[11px] bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleResetCrop}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-secondary text-foreground rounded-lg font-medium text-[11px] hover:bg-secondary/80 transition-colors"
            >
              <RotateCcw size={12} />
              Reset
            </button>
            <button
              onClick={cancelCrop}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-secondary text-foreground rounded-lg font-medium text-[11px] hover:bg-secondary/80 transition-colors"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              onClick={handleApplyCrop}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg font-medium text-[11px] hover:bg-primary/90 transition-colors"
            >
              <Check size={12} />
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
