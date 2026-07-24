import React, { useRef, useState, useEffect, useCallback } from "react";
import { ToolcraftContextMenu as ContextMenu } from "@openreel/ui";
import { Type } from "@/icons/lucide-compat";
import type { TextClip } from "@openreel/core";
import { useGraphicsClipContextMenuItems } from "./GraphicsClipContextMenu";
import { calculateSnap } from "./utils";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";

interface TextClipComponentProps {
  textClip: TextClip;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  onTrim: (clipId: string, edge: "left" | "right", newTime: number) => void;
  onMoveClip?: (clipId: string, newStartTime: number) => void;
}

export const TextClipComponent: React.FC<TextClipComponentProps> = ({
  textClip,
  pixelsPerSecond,
  isSelected,
  onSelect,
  onTrim,
  onMoveClip,
}) => {
  const clipRef = useRef<HTMLDivElement>(null);
  const [isTrimming, setIsTrimming] = useState<"left" | "right" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const historyGroupOpenRef = useRef(false);
  const { snapSettings } = useUIStore();
  const { playheadPosition } = useTimelineStore();
  const trimStartRef = useRef<{
    mouseX: number;
    startTime: number;
    duration: number;
  }>({
    mouseX: 0,
    startTime: textClip.startTime,
    duration: textClip.duration,
  });

  const left = textClip.startTime * pixelsPerSecond;
  const width = textClip.duration * pixelsPerSecond;

  const beginTimingGesture = useCallback((description: string) => {
    if (historyGroupOpenRef.current) return;
    useProjectStore.getState().beginHistoryGroup(description);
    historyGroupOpenRef.current = true;
  }, []);

  const endTimingGesture = useCallback(() => {
    if (!historyGroupOpenRef.current) return;
    useProjectStore.getState().endHistoryGroup();
    historyGroupOpenRef.current = false;
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clipStartX = textClip.startTime * pixelsPerSecond;
    setDragOffset(clickX - clipStartX);
    setIsDragging(true);
    beginTimingGesture("Move text clip");

    onSelect(textClip.id, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Selection is committed on mouse-down so drag gestures feel immediate.
    // Keep the resulting click from reaching the lane and clearing it.
    e.stopPropagation();
  };

  useEffect(() => {
    if (!isDragging || !onMoveClip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = clipRef.current?.parentElement?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left - dragOffset;
      const rawTime = Math.max(0, x / pixelsPerSecond);
      const allTracks = useProjectStore.getState().project.timeline.tracks;
      const dragSnapSettings = { ...snapSettings, snapToPlayhead: false };
      const snapResult = calculateSnap(
        rawTime,
        textClip.id,
        allTracks,
        playheadPosition,
        dragSnapSettings,
        pixelsPerSecond,
        textClip.duration,
      );
      onMoveClip(textClip.id, snapResult.time);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      endTimingGesture();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, textClip.id, textClip.duration, pixelsPerSecond, dragOffset, onMoveClip, snapSettings, playheadPosition, endTimingGesture]);

  const handleTrimStart = (e: React.MouseEvent, edge: "left" | "right") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setIsTrimming(edge);
    beginTimingGesture("Trim text clip");
    trimStartRef.current = {
      mouseX: e.clientX,
      startTime: textClip.startTime,
      duration: textClip.duration,
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

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
        onTrim(textClip.id, "left", clampedStartTime);
      } else {
        const newEndTime =
          trimStartRef.current.startTime +
          trimStartRef.current.duration +
          deltaTime;
        const minEndTime = trimStartRef.current.startTime + 0.1;
        const clampedEndTime = Math.max(newEndTime, minEndTime);
        onTrim(textClip.id, "right", clampedEndTime);
      }
    };

    const handleMouseUp = () => {
      setIsTrimming(null);
      endTimingGesture();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isTrimming, textClip.id, pixelsPerSecond, onTrim, endTimingGesture]);

  const isInteracting = isDragging || isTrimming;
  const contextMenuItems = useGraphicsClipContextMenuItems({
    clip: textClip,
    clipType: "text",
  });

  return (
    <ContextMenu items={contextMenuItems} menuWidth={200} size="sm">
        <div
          ref={clipRef}
          role="button"
          tabIndex={0}
          aria-label={`Select text clip ${textClip.text || "Text"}`}
          aria-pressed={isSelected}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(textClip.id, event.shiftKey || event.metaKey || event.ctrlKey);
          }}
          className={`absolute top-1 bottom-1 rounded-lg overflow-hidden cursor-grab group ${
            isDragging ? "cursor-grabbing opacity-75" : ""
          } ${
            isSelected
              ? "ring-2 ring-amber-400 border-amber-400 z-10"
              : "border-amber-500/30 hover:border-amber-500/60 hover:brightness-110"
          } bg-amber-500/20 border`}
          style={{
            transform: `translateX(${left}px)`,
            width: `${Math.max(width, 40)}px`,
            willChange: isInteracting ? 'transform, width' : 'auto',
            transition: isInteracting ? 'none' : 'opacity 150ms, box-shadow 150ms',
          }}
        >
          <div
            className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-amber-400" : "opacity-0 group-hover:opacity-100 hover:bg-amber-400/50"
            }`}
            style={{ borderRadius: "6px 0 0 6px" }}
            onMouseDown={(e) => handleTrimStart(e, "left")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-amber-900/60 rounded-full" />}
          </div>
          <div
            className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-amber-400" : "opacity-0 group-hover:opacity-100 hover:bg-amber-400/50"
            }`}
            style={{ borderRadius: "0 6px 6px 0" }}
            onMouseDown={(e) => handleTrimStart(e, "right")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-amber-900/60 rounded-full" />}
          </div>
          <div className="w-full h-full flex items-center gap-1 px-3">
            <Type size={12} className="text-fg-2 flex-shrink-0" />
            <span className="text-[10px] font-semibold text-fg truncate">
              {textClip.text || "Text"}
            </span>
          </div>
          {isSelected && (
            <div className="absolute inset-0 border-2 border-amber-400 rounded-lg pointer-events-none" />
          )}
        </div>
    </ContextMenu>
  );
};
