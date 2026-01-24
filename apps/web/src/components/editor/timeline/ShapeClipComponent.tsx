import React, { useRef, useState, useEffect } from "react";
import { Shapes, FileCode, Smile } from "lucide-react";
import type { ShapeClip, SVGClip, StickerClip } from "@openreel/core";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";
import { GraphicsClipContextMenu } from "./GraphicsClipContextMenu";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;

interface ShapeClipComponentProps {
  shapeClip: GraphicClipUnion;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  onTrim: (clipId: string, edge: "left" | "right", newTime: number) => void;
  onMoveClip: (clipId: string, newStartTime: number) => void;
}

export const ShapeClipComponent: React.FC<ShapeClipComponentProps> = ({
  shapeClip,
  pixelsPerSecond,
  isSelected,
  onSelect,
  onTrim,
  onMoveClip,
}) => {
  const clipRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isTrimming, setIsTrimming] = useState<"left" | "right" | null>(null);
  const trimStartRef = useRef<{
    mouseX: number;
    startTime: number;
    duration: number;
  }>({
    mouseX: 0,
    startTime: shapeClip.startTime,
    duration: shapeClip.duration,
  });

  const left = shapeClip.startTime * pixelsPerSecond;
  const width = shapeClip.duration * pixelsPerSecond;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.getBoundingClientRect();
    if (!rect) return;

    const offsetX = e.clientX - rect.left;
    setDragOffset(offsetX);
    setIsDragging(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isTrimming || isDragging) return;
    e.stopPropagation();
    onSelect(shapeClip.id, e.shiftKey || e.metaKey);
  };

  const handleTrimStart = (e: React.MouseEvent, edge: "left" | "right") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setIsTrimming(edge);
    trimStartRef.current = {
      mouseX: e.clientX,
      startTime: shapeClip.startTime,
      duration: shapeClip.duration,
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const timelineElement = clipRef.current?.parentElement;
      if (!timelineElement) return;

      const rect = timelineElement.getBoundingClientRect();
      const x = e.clientX - rect.left - dragOffset;
      const rawTime = x / pixelsPerSecond;
      const newStartTime = Math.max(0, rawTime);

      onMoveClip(shapeClip.id, newStartTime);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, pixelsPerSecond, shapeClip.id, onMoveClip]);

  useEffect(() => {
    if (!isTrimming) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - trimStartRef.current.mouseX;
      const deltaTime = deltaX / pixelsPerSecond;

      if (isTrimming === "left") {
        const newStartTime = Math.max(
          0,
          trimStartRef.current.startTime + deltaTime,
        );
        const maxStartTime =
          trimStartRef.current.startTime + trimStartRef.current.duration - 0.1;
        const clampedStartTime = Math.min(newStartTime, maxStartTime);
        onTrim(shapeClip.id, "left", clampedStartTime);
      } else {
        const newEndTime =
          trimStartRef.current.startTime +
          trimStartRef.current.duration +
          deltaTime;
        const minEndTime = trimStartRef.current.startTime + 0.1;
        const clampedEndTime = Math.max(newEndTime, minEndTime);
        onTrim(shapeClip.id, "right", clampedEndTime);
      }
    };

    const handleMouseUp = () => {
      setIsTrimming(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isTrimming, shapeClip.id, pixelsPerSecond, onTrim]);

  const isShape = shapeClip.type === "shape";
  const isSticker = shapeClip.type === "sticker" || shapeClip.type === "emoji";
  const shapeLabel =
    isShape && "shapeType" in shapeClip
      ? shapeClip.shapeType.charAt(0).toUpperCase() +
        shapeClip.shapeType.slice(1)
      : isSticker
        ? shapeClip.type === "emoji"
          ? "Emoji"
          : "Sticker"
        : "SVG";
  const IconComponent = isShape ? Shapes : isSticker ? Smile : FileCode;
  const colorClass = isShape ? "green" : isSticker ? "pink" : "purple";

  const isInteracting = isDragging || isTrimming;
  const clipType = isShape ? "shape" : isSticker ? (shapeClip.type === "emoji" ? "emoji" : "sticker") : "svg";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={clipRef}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          className={`absolute top-1 bottom-1 rounded-lg overflow-hidden cursor-grab group ${
            isDragging ? "cursor-grabbing opacity-75" : ""
          } ${
            isSelected
              ? `ring-2 ring-${colorClass}-400 border-${colorClass}-400 z-10`
              : `border-${colorClass}-500/30 hover:border-${colorClass}-500/60 hover:brightness-110`
          } bg-${colorClass}-500/20 border`}
          style={{
            transform: `translateX(${left}px)`,
            width: `${Math.max(width, 40)}px`,
            willChange: isInteracting ? 'transform, width' : 'auto',
            transition: isInteracting ? 'none' : 'opacity 150ms, box-shadow 150ms',
          }}
        >
          <div
            className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-${colorClass}-400/50 z-20 opacity-0 group-hover:opacity-100 transition-opacity`}
            onMouseDown={(e) => handleTrimStart(e, "left")}
            title="Drag to trim start"
          />
          <div
            className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-${colorClass}-400/50 z-20 opacity-0 group-hover:opacity-100 transition-opacity`}
            onMouseDown={(e) => handleTrimStart(e, "right")}
            title="Drag to trim end"
          />
          <div className="w-full h-full flex items-center gap-1 px-3">
            <IconComponent
              size={12}
              className={`text-${colorClass}-400 flex-shrink-0`}
            />
            <span
              className={`text-[10px] font-medium text-${colorClass}-200 truncate`}
            >
              {shapeLabel}
            </span>
          </div>
          {isSelected && (
            <>
              <div className="absolute inset-0 border-2 border-green-400 rounded-lg pointer-events-none" />
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-green-400 rounded-r cursor-ew-resize"
                onMouseDown={(e) => handleTrimStart(e, "left")}
              />
              <div
                className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-green-400 rounded-l cursor-ew-resize"
                onMouseDown={(e) => handleTrimStart(e, "right")}
              />
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <GraphicsClipContextMenu clip={shapeClip} clipType={clipType} />
    </ContextMenu>
  );
};
