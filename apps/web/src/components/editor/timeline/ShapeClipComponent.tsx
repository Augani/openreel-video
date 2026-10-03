import { useTimelineTouchGesture, listenTimelineGesture } from "./touch-gestures";
import { TimelineTouchMoveHandle } from "./TimelineTouchMoveHandle";
import React, { useRef, useState, useEffect, useCallback } from "react";
import { ToolcraftContextMenu as ContextMenu } from "@openreel/ui";
import { Shapes, FileCode, Smile } from "@/icons/lucide-compat";
import type { ShapeClip, SVGClip, StickerClip, Track } from "@openreel/core";
import { useGraphicsClipContextMenuItems } from "./GraphicsClipContextMenu";
import { calculateSnap } from "./utils";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;

interface ShapeClipComponentProps {
  shapeClip: GraphicClipUnion;
  pixelsPerSecond: number;
  isSelected: boolean;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  onTrim: (clipId: string, edge: "left" | "right", newTime: number) => void;
  onMoveClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void | Promise<void>;
  allTracks: Track[];
  trackHeights: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
}

export const ShapeClipComponent: React.FC<ShapeClipComponentProps> = ({
  shapeClip,
  pixelsPerSecond,
  isSelected,
  onSelect,
  onTrim,
  onMoveClip,
  allTracks,
  trackHeights,
  timelineRef,
}) => {
  const clipRef = useRef<HTMLDivElement>(null);
  const touchGesture = useTimelineTouchGesture();
  const locked = allTracks.find((track) => track.id === shapeClip.trackId)?.locked ?? false;
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isTrimming, setIsTrimming] = useState<"left" | "right" | null>(null);
  const historyGroupOpenRef = useRef(false);
  const pendingDropRef = useRef<{ time: number; targetTrackId?: string }>({
    time: shapeClip.startTime,
  });
  const snapSettings = useUIStore((state) => state.snapSettings);
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
    if (touchGesture.shouldIgnoreMouse(e) || locked) return false;
    if (e.button !== 0) return;
    if (isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.getBoundingClientRect();
    if (!rect) return;

    const offsetX = e.clientX - rect.left;
    setDragOffset(offsetX);
    setIsDragging(true);
    beginTimingGesture("Move graphic clip");
    onSelect(shapeClip.id, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (touchGesture.consumeTap()) onSelect(shapeClip.id, e.shiftKey || e.metaKey || e.ctrlKey);
    // Selection is committed on mouse-down so drag gestures feel immediate.
    // Keep the resulting click from reaching the lane and clearing it.
    e.stopPropagation();
  };

  const handleTrimStart = (e: React.MouseEvent, edge: "left" | "right") => {
    if (touchGesture.shouldIgnoreMouse(e) || locked || e.button !== 0) return false;
    e.stopPropagation();
    e.preventDefault();
    setIsTrimming(edge);
    beginTimingGesture("Trim graphic clip");
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
      const rawTime = Math.max(0, x / pixelsPerSecond);
      const dragSnapSettings = { ...snapSettings, snapToPlayhead: false };
      const snapResult = calculateSnap(
        rawTime,
        shapeClip.id,
        allTracks,
        useTimelineStore.getState().playheadPosition,
        dragSnapSettings,
        pixelsPerSecond,
        shapeClip.duration,
      );
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      const scrollTop = timelineRef.current?.scrollTop ?? 0;
      let targetTrackId: string | undefined;
      if (timelineRect) {
        const mouseY = e.clientY - timelineRect.top + scrollTop;
        let cumulativeY = 0;
        for (const track of allTracks) {
          const height = trackHeights.get(track.id) ?? 48;
          if (mouseY >= cumulativeY && mouseY < cumulativeY + height) {
            if (!track.locked && track.id !== shapeClip.trackId) {
              targetTrackId = track.id;
            }
            break;
          }
          cumulativeY += height;
        }
      }
      pendingDropRef.current = { time: snapResult.time, targetTrackId };
      onMoveClip(shapeClip.id, snapResult.time);
    };

    const handleMouseUp = async () => {
      const pending = pendingDropRef.current;
      await onMoveClip(
        shapeClip.id,
        pending.time,
        pending.targetTrackId ?? shapeClip.trackId,
      );
      setIsDragging(false);
      endTimingGesture();
    };

    const stopListening = listenTimelineGesture(touchGesture.pointerId, handleMouseMove, handleMouseUp, () => {
      setIsDragging(false);
      endTimingGesture();
    });

    return () => {
      stopListening();
    };
  }, [
    isDragging,
    touchGesture.pointerId,
    dragOffset,
    pixelsPerSecond,
    shapeClip.id,
    shapeClip.trackId,
    shapeClip.duration,
    onMoveClip,
    snapSettings,
    endTimingGesture,
    timelineRef,
    allTracks,
    trackHeights,
  ]);

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
      endTimingGesture();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const stopListening = listenTimelineGesture(touchGesture.pointerId, handleMouseMove, handleMouseUp);

    return () => {
      stopListening();
    };
  }, [isTrimming, shapeClip.id, pixelsPerSecond, onTrim, endTimingGesture, touchGesture.pointerId]);

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
  const colorClass = isShape ? "green" : isSticker ? "pink" : "green";

  const isInteracting = isDragging || isTrimming;
  const clipType = isShape ? "shape" : isSticker ? (shapeClip.type === "emoji" ? "emoji" : "sticker") : "svg";
  const contextMenuItems = useGraphicsClipContextMenuItems({
    clip: shapeClip,
    clipType,
  });

  return (
    <ContextMenu items={contextMenuItems} menuWidth={200} size="sm">
        <div
          ref={clipRef}
          role="button"
          tabIndex={0}
          aria-label={`Select ${shapeLabel} clip`}
          aria-pressed={isSelected}
          data-locked={locked}
          onClick={handleClick}
          data-timeline-clip
          onPointerDown={touchGesture.bodyPointerDown}
          onMouseDown={handleMouseDown}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(shapeClip.id, event.shiftKey || event.metaKey || event.ctrlKey);
          }}
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
          {isSelected && !locked && <TimelineTouchMoveHandle label="Move graphic" onPointerDown={(event) => touchGesture.start(event, handleMouseDown)} />}
          <div
            data-timeline-trim="left"
            aria-label="Trim start"
            onPointerDown={(event) => touchGesture.start(event, (e) => handleTrimStart(e, "left"))}
            className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-green-400" : `opacity-0 group-hover:opacity-100 hover:bg-${colorClass}-400/50`
            }`}
            style={{ borderRadius: "6px 0 0 6px" }}
            onMouseDown={(e) => handleTrimStart(e, "left")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-green-900/60 rounded-full" />}
          </div>
          <div
            data-timeline-trim="right"
            aria-label="Trim end"
            onPointerDown={(event) => touchGesture.start(event, (e) => handleTrimStart(e, "right"))}
            className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-green-400" : `opacity-0 group-hover:opacity-100 hover:bg-${colorClass}-400/50`
            }`}
            style={{ borderRadius: "0 6px 6px 0" }}
            onMouseDown={(e) => handleTrimStart(e, "right")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-green-900/60 rounded-full" />}
          </div>
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
            <div className="absolute inset-0 border-2 border-green-400 rounded-lg pointer-events-none" />
          )}
        </div>
    </ContextMenu>
  );
};
