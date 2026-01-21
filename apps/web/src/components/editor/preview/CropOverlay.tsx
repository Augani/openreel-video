import React, { useState, useRef, useEffect } from "react";
import { Check, X, Maximize2 } from "lucide-react";
import type { Clip } from "@openreel/core";

interface CropOverlayProps {
  clip: Clip;
  canvasWidth: number;
  canvasHeight: number;
  videoWidth: number;
  videoHeight: number;
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

export const CropOverlay: React.FC<CropOverlayProps> = ({
  clip,
  canvasWidth,
  canvasHeight,
  videoWidth,
  videoHeight,
  onCropChange,
  onComplete,
  onCancel,
}) => {
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

  const overlayRef = useRef<HTMLDivElement>(null);

  // Calculate video frame bounds on canvas (cover fit mode)
  const videoAspect = videoWidth / videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let frameWidth: number;
  let frameHeight: number;
  let frameX: number;
  let frameY: number;

  if (videoAspect > canvasAspect) {
    // Video is wider - fit to canvas height
    frameHeight = canvasHeight;
    frameWidth = canvasHeight * videoAspect;
    frameX = (canvasWidth - frameWidth) / 2;
    frameY = 0;
  } else {
    // Video is taller - fit to canvas width
    frameWidth = canvasWidth;
    frameHeight = canvasWidth / videoAspect;
    frameX = 0;
    frameY = (canvasHeight - frameHeight) / 2;
  }

  // Apply transform position and scale
  const transform = clip.transform;
  const scaleX = transform.scale?.x ?? 1;
  const scaleY = transform.scale?.y ?? 1;
  const posX = transform.position?.x ?? 0;
  const posY = transform.position?.y ?? 0;

  frameWidth *= scaleX;
  frameHeight *= scaleY;
  frameX += posX + canvasWidth / 2 - frameWidth / 2;
  frameY += posY + canvasHeight / 2 - frameHeight / 2;

  const cropPixels = {
    x: frameX + crop.x * frameWidth,
    y: frameY + crop.y * frameHeight,
    width: crop.width * frameWidth,
    height: crop.height * frameHeight,
  };

  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    setDragHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setCropStart(crop);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragHandle || !overlayRef.current) return;

    // Calculate delta relative to frame size, not canvas size
    const deltaX = (e.clientX - dragStart.x) / frameWidth;
    const deltaY = (e.clientY - dragStart.y) / frameHeight;

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
  }, [isDragging, dragHandle, dragStart, cropStart, lockedAspect]);

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
    <>
      {/* Full canvas overlay for darkening */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={canvasWidth}
        height={canvasHeight}
        style={{ left: 0, top: 0 }}
      >
        <defs>
          <mask id="crop-mask">
            <rect
              x="0"
              y="0"
              width={canvasWidth}
              height={canvasHeight}
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
          width={canvasWidth}
          height={canvasHeight}
          fill="black"
          opacity="0.5"
          mask="url(#crop-mask)"
        />
      </svg>

      {/* Video frame overlay for crop handles */}
      <div
        ref={overlayRef}
        className="absolute cursor-move"
        style={{
          left: frameX,
          top: frameY,
          width: frameWidth,
          height: frameHeight,
        }}
      >
        <div
          className="absolute border-2 border-white pointer-events-auto"
          style={{
            left: crop.x * frameWidth,
            top: crop.y * frameHeight,
            width: crop.width * frameWidth,
            height: crop.height * frameHeight,
          }}
          onMouseDown={(e) => handleMouseDown(e, "center")}
        >
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

          {/* Corner Handles */}
          {["nw", "ne", "sw", "se"].map((handle) => (
            <div
              key={handle}
              className="absolute w-3 h-3 bg-white border border-gray-800 rounded-sm cursor-nwse-resize pointer-events-auto"
              style={{
                top: handle.includes("n") ? -6 : undefined,
                bottom: handle.includes("s") ? -6 : undefined,
                left: handle.includes("w") ? -6 : undefined,
                right: handle.includes("e") ? -6 : undefined,
              }}
              onMouseDown={(e) => handleMouseDown(e, handle as DragHandle)}
            />
          ))}

          {/* Edge Handles */}
          <div
            className="absolute w-12 h-3 bg-white border border-gray-800 rounded-sm cursor-ns-resize pointer-events-auto -top-1.5 left-1/2 -translate-x-1/2"
            onMouseDown={(e) => handleMouseDown(e, "n")}
          />
          <div
            className="absolute w-12 h-3 bg-white border border-gray-800 rounded-sm cursor-ns-resize pointer-events-auto -bottom-1.5 left-1/2 -translate-x-1/2"
            onMouseDown={(e) => handleMouseDown(e, "s")}
          />
          <div
            className="absolute w-3 h-12 bg-white border border-gray-800 rounded-sm cursor-ew-resize pointer-events-auto -left-1.5 top-1/2 -translate-y-1/2"
            onMouseDown={(e) => handleMouseDown(e, "w")}
          />
          <div
            className="absolute w-3 h-12 bg-white border border-gray-800 rounded-sm cursor-ew-resize pointer-events-auto -right-1.5 top-1/2 -translate-y-1/2"
            onMouseDown={(e) => handleMouseDown(e, "e")}
          />
        </div>
      </div>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-white/20">
        <div className="flex items-center gap-1">
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio.label}
              onClick={() => handleAspectRatio(ratio.value)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                lockedAspect === ratio.value
                  ? "bg-primary text-white font-medium"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {ratio.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/20" />

        <button
          onClick={handleReset}
          className="p-1.5 text-white hover:bg-white/20 rounded transition-colors"
          title="Reset crop"
        >
          <Maximize2 size={16} />
        </button>

        <div className="w-px h-6 bg-white/20" />

        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 text-white rounded transition-colors flex items-center gap-1.5"
        >
          <X size={14} />
          Cancel
        </button>

        <button
          onClick={onComplete}
          className="px-3 py-1.5 text-xs bg-primary hover:bg-primary/80 text-black font-medium rounded transition-colors flex items-center gap-1.5"
        >
          <Check size={14} />
          Apply
        </button>
      </div>
    </>
  );
};
