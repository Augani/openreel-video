import { trackIdAtOffset } from "./track-hit-test";
import { useTimelineTouchGesture, listenTimelineGesture } from "./touch-gestures";
import { TimelineTouchMoveHandle } from "./TimelineTouchMoveHandle";
import React, { useRef, useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";
import type { TextClip, Track } from "@openreel/core";
import { GraphicsClipContextMenu } from "./GraphicsClipContextMenu";
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
  onMoveClip?: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void | Promise<void>;
  allTracks: Track[];
  trackHeights: Map<string, number>;
  rowHeights?: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  trackTopInset?: number;
}

const TextClipComponentImpl: React.FC<TextClipComponentProps> = ({
  textClip,
  pixelsPerSecond,
  isSelected,
  onSelect,
  onTrim,
  onMoveClip,
  allTracks,
  trackHeights,
  rowHeights,
  timelineRef,
  trackTopInset = 0,
}) => {
  const clipRef = useRef<HTMLDivElement>(null);
  const touchGesture = useTimelineTouchGesture();
  const locked = allTracks.find((track) => track.id === textClip.trackId)?.locked ?? false;
  const [isTrimming, setIsTrimming] = useState<"left" | "right" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const historyGroupOpenRef = useRef(false);
  const moveGestureRef = useRef({ x: 0, y: 0, moved: false });
  const pendingDropRef = useRef<{ time: number; targetTrackId?: string }>({
    time: textClip.startTime,
  });
  const snapSettings = useUIStore((state) => state.snapSettings);
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
    if (touchGesture.shouldIgnoreMouse(e) || locked) return false;
    if (e.button !== 0) return;
    if (isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return false;

    const clickX = e.clientX - rect.left;
    const clipStartX = textClip.startTime * pixelsPerSecond;
    setDragOffset(clickX - clipStartX);
    moveGestureRef.current = { x: e.clientX, y: e.clientY, moved: false };
    pendingDropRef.current = { time: textClip.startTime };
    // Native input may deliver the entire gesture before React's next paint.
    flushSync(() => setIsDragging(true));
    beginTimingGesture("Move text clip");

    onSelect(textClip.id, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (touchGesture.consumeTap()) onSelect(textClip.id, e.shiftKey || e.metaKey || e.ctrlKey);
    // Selection is committed on mouse-down so drag gestures feel immediate.
    // Keep the resulting click from reaching the lane and clearing it.
    e.stopPropagation();
  };

  useEffect(() => {
    if (!isDragging || !onMoveClip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const gesture = moveGestureRef.current;
      if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) < 3) return;
      gesture.moved = true;
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
        useTimelineStore.getState().playheadPosition,
        dragSnapSettings,
        pixelsPerSecond,
        textClip.duration,
      );
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      const scrollTop = timelineRef.current?.scrollTop ?? 0;
      let targetTrackId: string | undefined;
      if (timelineRect) {
        const mouseY = e.clientY - timelineRect.top + scrollTop - trackTopInset;
        const hit = trackIdAtOffset(allTracks, rowHeights ?? trackHeights, mouseY);
        const hovered = allTracks.find((track) => track.id === hit);
        if (hovered && !hovered.locked && hovered.id !== textClip.trackId) targetTrackId = hovered.id;
      }
      pendingDropRef.current = { time: snapResult.time, targetTrackId };
      onMoveClip(textClip.id, snapResult.time);
    };

    const handleMouseUp = async () => {
      if (!moveGestureRef.current.moved) {
        setIsDragging(false);
        endTimingGesture();
        return;
      }
      const pending = pendingDropRef.current;
      await onMoveClip(
        textClip.id,
        pending.time,
        pending.targetTrackId ?? textClip.trackId,
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
    textClip.id,
    textClip.trackId,
    textClip.duration,
    pixelsPerSecond,
    dragOffset,
    onMoveClip,
    snapSettings,
    endTimingGesture,
    timelineRef,
    trackTopInset,
    allTracks,
    trackHeights,
    rowHeights,
  ]);

  const handleTrimStart = (e: React.MouseEvent, edge: "left" | "right") => {
    if (touchGesture.shouldIgnoreMouse(e) || locked || e.button !== 0) return false;
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

    const stopListening = listenTimelineGesture(touchGesture.pointerId, handleMouseMove, handleMouseUp);

    return () => {
      stopListening();
    };
  }, [isTrimming, textClip.id, pixelsPerSecond, onTrim, endTimingGesture, touchGesture.pointerId]);

  const isInteracting = isDragging || isTrimming;
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  return (
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={clipRef}
          role="button"
          tabIndex={0}
          aria-label={`Select text clip ${textClip.text || "Text"}`}
          aria-pressed={isSelected}
          data-locked={locked}
          onClick={handleClick}
          data-timeline-clip
          data-timeline-item-id={textClip.id}
          data-clip-kind="text"
          data-timeline-interacting={Boolean(isInteracting)}
          onPointerDown={touchGesture.bodyPointerDown}
          onMouseDown={handleMouseDown}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onSelect(textClip.id, event.shiftKey || event.metaKey || event.ctrlKey);
          }}
          className={`absolute top-1 bottom-1 rounded-[4px] overflow-hidden cursor-grab group ${
            isDragging ? "cursor-grabbing opacity-75" : ""
          } ${
            isSelected
              ? "ring-1 ring-accent border-accent z-10"
              : "border-purple-400/50 hover:border-purple-300/70 hover:brightness-110"
          } border`}
          style={{
            backgroundColor: "var(--c-text)",
            transform: `translateX(${left}px)`,
            width: `max(1px, calc(${Math.max(width, 40)}px - var(--timeline-clip-inset, 0px) * 2))`,
            marginLeft: "var(--timeline-clip-inset, 0px)",
            willChange: isInteracting ? 'transform, width' : 'auto',
            transition: isInteracting ? 'none' : 'opacity 150ms, box-shadow 150ms',
          }}
        >
          {isSelected && !locked && <TimelineTouchMoveHandle label={`Move ${textClip.text || "Text"}`} onPointerDown={(event) => touchGesture.start(event, handleMouseDown)} />}
          <div
            data-timeline-trim="left"
            aria-label="Trim start"
            onPointerDown={(event) => touchGesture.start(event, (e) => handleTrimStart(e, "left"))}
            className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-accent" : "opacity-0 group-hover:opacity-100 hover:bg-accent/50"
            }`}
            style={{ borderRadius: "6px 0 0 6px" }}
            onMouseDown={(e) => handleTrimStart(e, "left")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-accent-fg/60 rounded-full" />}
          </div>
          <div
            data-timeline-trim="right"
            aria-label="Trim end"
            onPointerDown={(event) => touchGesture.start(event, (e) => handleTrimStart(e, "right"))}
            className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100 bg-accent" : "opacity-0 group-hover:opacity-100 hover:bg-accent/50"
            }`}
            style={{ borderRadius: "0 6px 6px 0" }}
            onMouseDown={(e) => handleTrimStart(e, "right")}
          >
            {isSelected && <div className="w-0.5 h-3 bg-accent-fg/60 rounded-full" />}
          </div>
          <div className="workspace-timeline-text-label w-full h-full flex items-center gap-1 px-3">
            <span className="text-[10px] font-semibold text-fg truncate">
              {textClip.text || "Text"}
            </span>
          </div>
        </div>
      </ContextMenuTrigger>
      {contextMenuOpen && <GraphicsClipContextMenu clip={textClip} clipType="text" />}
    </ContextMenu>
  );
};

export const TextClipComponent = React.memo(TextClipComponentImpl);
