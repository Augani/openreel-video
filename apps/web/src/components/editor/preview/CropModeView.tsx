import React, { useState, useRef, useEffect } from "react";
import { Check, X, Maximize2 } from "lucide-react";
import type { Clip } from "@openreel/core";

interface CropModeViewProps {
  clip: Clip;
  videoSrc: string;
  currentTime: number;
  canvasWidth: number;
  canvasHeight: number;
  onCropChange: (crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onComplete: () => void;
  onCancel: () => void;
}

type DragHandle =
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "n"
  | "s"
  | "e"
  | "w"
  | "center"
  | null;

const ASPECT_RATIOS = [
  { label: "Free", value: null },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:4", value: 3 / 4 },
];

export const CropModeView: React.FC<CropModeViewProps> = ({
  clip,
  videoSrc,
  currentTime,
  canvasWidth,
  canvasHeight,
  onCropChange,
  onComplete,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoDisplayRef = useRef<HTMLVideoElement>(null);
  const initialCrop = clip.transform.crop || {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };

  const [crop, setCrop] = useState(initialCrop);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState(initialCrop);
  const [lockedAspect, setLockedAspect] = useState<number | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const video = videoDisplayRef.current;
    if (!video) return;

    setIsLoading(true);

    const handleLoadedMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoSize({
          width: video.videoWidth,
          height: video.videoHeight,
        });
        setIsLoading(false);
      }
    };

    const handleError = () => {
      console.error("[CropModeView] Video load error");
      setIsLoading(false);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);

    video.src = videoSrc;
    video.currentTime = currentTime;

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };
  }, [videoSrc, currentTime]);

  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setCropStart(crop);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragHandle || !containerRef.current) return;

    const deltaX = (e.clientX - dragStart.x) / (videoSize.width * scale);
    const deltaY = (e.clientY - dragStart.y) / (videoSize.height * scale);

    let newCrop = { ...cropStart };

    if (dragHandle === "center") {
      newCrop.x = Math.max(
        0,
        Math.min(1 - cropStart.width, cropStart.x + deltaX),
      );
      newCrop.y = Math.max(
        0,
        Math.min(1 - cropStart.height, cropStart.y + deltaY),
      );
    } else if (dragHandle === "nw") {
      const maxDeltaX = cropStart.x;
      const maxDeltaY = cropStart.y;
      const clampedDeltaX = Math.min(deltaX, maxDeltaX);
      const clampedDeltaY = Math.min(deltaY, maxDeltaY);

      if (lockedAspect) {
        const avgDelta = (clampedDeltaX + clampedDeltaY) / 2;
        newCrop.x = cropStart.x + avgDelta;
        newCrop.y = cropStart.y + avgDelta;
        newCrop.width = cropStart.width - avgDelta;
        newCrop.height = cropStart.height - avgDelta;
      } else {
        newCrop.x = cropStart.x + clampedDeltaX;
        newCrop.y = cropStart.y + clampedDeltaY;
        newCrop.width = cropStart.width - clampedDeltaX;
        newCrop.height = cropStart.height - clampedDeltaY;
      }
    } else if (dragHandle === "ne") {
      const maxDeltaY = cropStart.y;
      const clampedDeltaY = Math.min(deltaY, maxDeltaY);

      if (lockedAspect) {
        const avgDelta = (-deltaX + clampedDeltaY) / 2;
        newCrop.y = cropStart.y + avgDelta;
        newCrop.width = cropStart.width - avgDelta;
        newCrop.height = cropStart.height - avgDelta;
      } else {
        newCrop.y = cropStart.y + clampedDeltaY;
        newCrop.width = Math.min(1 - cropStart.x, cropStart.width + deltaX);
        newCrop.height = cropStart.height - clampedDeltaY;
      }
    } else if (dragHandle === "sw") {
      const maxDeltaX = cropStart.x;
      const clampedDeltaX = Math.min(deltaX, maxDeltaX);

      if (lockedAspect) {
        const avgDelta = (clampedDeltaX - deltaY) / 2;
        newCrop.x = cropStart.x + avgDelta;
        newCrop.width = cropStart.width - avgDelta;
        newCrop.height = cropStart.height - avgDelta;
      } else {
        newCrop.x = cropStart.x + clampedDeltaX;
        newCrop.width = cropStart.width - clampedDeltaX;
        newCrop.height = Math.min(1 - cropStart.y, cropStart.height + deltaY);
      }
    } else if (dragHandle === "se") {
      if (lockedAspect) {
        const avgDelta = (deltaX + deltaY) / 2;
        newCrop.width = Math.min(
          1 - cropStart.x,
          Math.max(0.1, cropStart.width + avgDelta),
        );
        newCrop.height = Math.min(
          1 - cropStart.y,
          Math.max(0.1, cropStart.height + avgDelta),
        );
      } else {
        newCrop.width = Math.min(
          1 - cropStart.x,
          Math.max(0.1, cropStart.width + deltaX),
        );
        newCrop.height = Math.min(
          1 - cropStart.y,
          Math.max(0.1, cropStart.height + deltaY),
        );
      }
    } else if (dragHandle === "n") {
      const maxDelta = cropStart.y;
      const clampedDelta = Math.min(deltaY, maxDelta);
      newCrop.y = cropStart.y + clampedDelta;
      newCrop.height = cropStart.height - clampedDelta;
    } else if (dragHandle === "s") {
      newCrop.height = Math.min(
        1 - cropStart.y,
        Math.max(0.1, cropStart.height + deltaY),
      );
    } else if (dragHandle === "w") {
      const maxDelta = cropStart.x;
      const clampedDelta = Math.min(deltaX, maxDelta);
      newCrop.x = cropStart.x + clampedDelta;
      newCrop.width = cropStart.width - clampedDelta;
    } else if (dragHandle === "e") {
      newCrop.width = Math.min(
        1 - cropStart.x,
        Math.max(0.1, cropStart.width + deltaX),
      );
    }

    newCrop.width = Math.max(0.05, Math.min(1, newCrop.width));
    newCrop.height = Math.max(0.05, Math.min(1, newCrop.height));
    newCrop.x = Math.max(0, Math.min(1 - newCrop.width, newCrop.x));
    newCrop.y = Math.max(0, Math.min(1 - newCrop.height, newCrop.y));

    setCrop(newCrop);
  };

  const displaySize =
    videoSize.width > 0 && canvasWidth > 0 && canvasHeight > 0
      ? (() => {
          const videoAspect = videoSize.width / videoSize.height;
          const canvasAspect = canvasWidth / canvasHeight;

          let width: number;
          let height: number;

          if (videoAspect > canvasAspect) {
            width = canvasWidth;
            height = canvasWidth / videoAspect;
          } else {
            height = canvasHeight;
            width = canvasHeight * videoAspect;
          }

          return { width, height };
        })()
      : { width: canvasWidth, height: canvasHeight };

  const scale = videoSize.width > 0 ? displaySize.width / videoSize.width : 1;

  const cropPixels =
    videoSize.width > 0
      ? {
          x: crop.x * videoSize.width * scale,
          y: crop.y * videoSize.height * scale,
          width: crop.width * videoSize.width * scale,
          height: crop.height * videoSize.height * scale,
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  const handleMouseUp = () => {
    if (isDragging && dragHandle) {
      onCropChange(crop);
    }
    setIsDragging(false);
    setDragHandle(null);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [
    isDragging,
    dragHandle,
    dragStart,
    cropStart,
    lockedAspect,
    videoSize,
    scale,
  ]);

  const handleAspectRatio = (ratio: number | null) => {
    setLockedAspect(ratio);
    if (ratio) {
      const currentAspect = crop.width / crop.height;
      let newCrop;
      if (currentAspect > ratio) {
        const newWidth = crop.height * ratio;
        newCrop = {
          ...crop,
          x: crop.x + (crop.width - newWidth) / 2,
          width: newWidth,
        };
      } else {
        const newHeight = crop.width / ratio;
        newCrop = {
          ...crop,
          y: crop.y + (crop.height - newHeight) / 2,
          height: newHeight,
        };
      }
      setCrop(newCrop);
      onCropChange(newCrop);
    }
  };

  const handleReset = () => {
    const resetCrop = { x: 0, y: 0, width: 1, height: 1 };
    setCrop(resetCrop);
    setLockedAspect(null);
    onCropChange(resetCrop);
  };

  return (
    <div className="absolute inset-0 z-10 bg-background-secondary flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center justify-between p-3 bg-background border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-text-primary">
            Crop Video
          </span>
          <div className="flex items-center gap-1">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio.label}
                onClick={() => handleAspectRatio(ratio.value)}
                disabled={isLoading}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  lockedAspect === ratio.value
                    ? "bg-primary text-white font-medium"
                    : "bg-background-tertiary text-text-secondary hover:bg-background-secondary"
                }`}
              >
                {ratio.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleReset}
            disabled={isLoading}
            className="p-1 text-text-muted hover:bg-background-secondary rounded transition-colors"
            title="Reset crop"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs bg-background-tertiary hover:bg-background-secondary text-text-primary rounded transition-colors flex items-center gap-1.5"
          >
            <X size={14} />
            Cancel
          </button>
          <button
            onClick={() => {
              onCropChange(crop);
              onComplete();
            }}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-black font-medium rounded transition-colors flex items-center gap-1.5"
          >
            <Check size={14} />
            Apply
          </button>
        </div>
      </div>

      {/* Video container */}
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background-secondary">
            <div className="text-text-muted text-sm">Loading video...</div>
          </div>
        )}

        <div
          ref={containerRef}
          className="relative"
          style={{
            width: displaySize.width,
            height: displaySize.height,
            opacity: isLoading ? 0 : 1,
          }}
        >
          <video
            ref={videoDisplayRef}
            className="w-full h-full"
            style={{ objectFit: "contain" }}
            muted
            playsInline
            preload="metadata"
          />

          {!isLoading && videoSize.width > 0 && (
            <>
              {/* Dark overlay outside crop area */}
              <svg
                className="absolute inset-0 pointer-events-none"
                width={displaySize.width}
                height={displaySize.height}
              >
                <defs>
                  <mask id="crop-mask">
                    <rect
                      x="0"
                      y="0"
                      width={displaySize.width}
                      height={displaySize.height}
                      fill="white"
                    />
                    <rect
                      x={cropPixels.x}
                      y={cropPixels.y}
                      width={cropPixels.width}
                      height={cropPixels.height}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width={displaySize.width}
                  height={displaySize.height}
                  fill="black"
                  opacity="0.6"
                  mask="url(#crop-mask)"
                />
              </svg>

              {/* Crop box */}
              <div
                className="absolute border-2 border-white pointer-events-auto cursor-move"
                style={{
                  left: cropPixels.x,
                  top: cropPixels.y,
                  width: cropPixels.width,
                  height: cropPixels.height,
                }}
                onMouseDown={(e) => handleMouseDown(e, "center")}
              >
                {/* Rule of thirds grid */}
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width="100%"
                  height="100%"
                >
                  <line
                    x1="33.33%"
                    y1="0"
                    x2="33.33%"
                    y2="100%"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  <line
                    x1="66.66%"
                    y1="0"
                    x2="66.66%"
                    y2="100%"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  <line
                    x1="0"
                    y1="33.33%"
                    x2="100%"
                    y2="33.33%"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                  <line
                    x1="0"
                    y1="66.66%"
                    x2="100%"
                    y2="66.66%"
                    stroke="white"
                    strokeWidth="1"
                    opacity="0.5"
                  />
                </svg>

                {/* Corner handles */}
                {["nw", "ne", "sw", "se"].map((handle) => (
                  <div
                    key={handle}
                    className="absolute w-4 h-4 bg-white border-2 border-gray-800 rounded-sm cursor-nwse-resize pointer-events-auto hover:bg-primary transition-colors"
                    style={{
                      top: handle.includes("n") ? -8 : undefined,
                      bottom: handle.includes("s") ? -8 : undefined,
                      left: handle.includes("w") ? -8 : undefined,
                      right: handle.includes("e") ? -8 : undefined,
                    }}
                    onMouseDown={(e) =>
                      handleMouseDown(e, handle as DragHandle)
                    }
                  />
                ))}

                {/* Edge handles */}
                <div
                  className="absolute w-16 h-4 bg-white border-2 border-gray-800 rounded-sm cursor-ns-resize pointer-events-auto hover:bg-primary transition-colors -top-2 left-1/2 -translate-x-1/2"
                  onMouseDown={(e) => handleMouseDown(e, "n")}
                />
                <div
                  className="absolute w-16 h-4 bg-white border-2 border-gray-800 rounded-sm cursor-ns-resize pointer-events-auto hover:bg-primary transition-colors -bottom-2 left-1/2 -translate-x-1/2"
                  onMouseDown={(e) => handleMouseDown(e, "s")}
                />
                <div
                  className="absolute w-4 h-16 bg-white border-2 border-gray-800 rounded-sm cursor-ew-resize pointer-events-auto hover:bg-primary transition-colors -left-2 top-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleMouseDown(e, "w")}
                />
                <div
                  className="absolute w-4 h-16 bg-white border-2 border-gray-800 rounded-sm cursor-ew-resize pointer-events-auto hover:bg-primary transition-colors -right-2 top-1/2 -translate-y-1/2"
                  onMouseDown={(e) => handleMouseDown(e, "e")}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
