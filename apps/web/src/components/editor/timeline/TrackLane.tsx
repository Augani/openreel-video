import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import type {
  Track,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
} from "@openreel/core";
import {
  getMediaItemCapabilities,
  resolveTimelinePlacement,
} from "@openreel/core";
import { ClipComponent } from "./ClipComponent";
import { TextClipComponent } from "./TextClipComponent";
import { ShapeClipComponent } from "./ShapeClipComponent";
import { KeyframeTrack } from "./KeyframeTrack";
import { TransitionHandle } from "./TransitionHandle";
import { AdjustmentLayerTimelineItem } from "./AdjustmentLayerTimelineItem";
import { resolveTransitionHandles } from "./transition-handles";
import { calculateSnap } from "./utils";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;

interface TrackLaneProps {
  track: Track;
  allTracks: Track[];
  pixelsPerSecond: number;
  selectedClipIds: string[];
  textClips: TextClip[];
  shapeClips: GraphicClipUnion[];
  trackHeights: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  onSelectClip: (clipId: string, addToSelection: boolean) => void;
  onDropMedia: (trackId: string, mediaId: string, startTime: number) => void;
  onMoveClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void | Promise<void>;
  onMoveTextClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void | Promise<void>;
  onSnapIndicator: (time: number | null) => void;
  onTrimClip?: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  onTrimTextClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  onTrimShapeClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
  scrollX: number;
  trackHeight: number;
  onResizeTrack: (trackId: string, newHeight: number) => void;
  onKeyframeSelect?: (keyframeId: string, addToSelection: boolean) => void;
  onKeyframeMove?: (keyframeId: string, newTime: number) => void;
  onKeyframeDelete?: (keyframeId: string) => void;
  selectedKeyframeIds?: string[];
  onSelectTransition: (transitionId: string, trackId: string) => void;
  selectedTransitionId?: string | null;
}

export const TrackLane: React.FC<TrackLaneProps> = React.memo(function TrackLane({
  track,
  allTracks,
  pixelsPerSecond,
  selectedClipIds,
  textClips,
  shapeClips,
  trackHeights,
  timelineRef,
  onSelectClip,
  onDropMedia,
  onMoveClip,
  onMoveTextClip,
  onSnapIndicator,
  onTrimClip,
  onTrimTextClip,
  onTrimShapeClip,
  scrollX,
  trackHeight,
  onResizeTrack,
  onKeyframeSelect,
  onKeyframeMove,
  onKeyframeDelete,
  selectedKeyframeIds = [],
  onSelectTransition,
  selectedTransitionId = null,
}) {
  const isExpanded = useTimelineStore((state) => state.expandedTracks.has(track.id));
  const viewportWidth = useTimelineStore((state) => state.viewportWidth);
  const snapSettings = useUIStore((state) => state.snapSettings);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropHint, setDropHint] = useState("Drop to add clip");
  const [isResizing, setIsResizing] = useState(false);
  const laneRef = useRef<HTMLDivElement>(null);
  const resizeStartY = useRef<number>(0);
  const resizeStartHeight = useRef<number>(0);
  const projectAdjustmentLayers = useProjectStore((state) => state.project.adjustmentLayers);
  const adjustmentLayers = useMemo(
    () => (projectAdjustmentLayers ?? []).filter((layer) => layer.trackId === track.id),
    [projectAdjustmentLayers, track.id],
  );
  const frameRate = useProjectStore((state) => state.project.settings.frameRate);
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);

  const clipsWithKeyframes = useMemo(() => {
    return track.clips.filter((clip) => clip.keyframes && clip.keyframes.length > 0);
  }, [track.clips]);

  const transitionHandles = useMemo(
    () =>
      resolveTransitionHandles(track, pixelsPerSecond, (clip) =>
        getMediaItemCapabilities(
          mediaItems.find((item) => item.id === clip.mediaId),
        ).visual,
      ),
    [track, pixelsPerSecond, mediaItems],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
      try {
        const payload = JSON.parse(e.dataTransfer.getData("application/json"));
        const mediaId = typeof payload?.mediaId === "string" ? payload.mediaId : "";
        const mediaItem = mediaItems.find((item) => item.id === mediaId);
        const rect = laneRef.current?.getBoundingClientRect();
        if (!mediaItem || !rect) {
          setDropHint("Drop to add clip");
          return;
        }
        const startTime = Math.max(
          0,
          (e.clientX - rect.left + scrollX) / pixelsPerSecond,
        );
        const duration =
          mediaItem.metadata.duration > 0 ? mediaItem.metadata.duration : 5;
        const project = useProjectStore.getState().project;
        const placement = resolveTimelinePlacement(project, {
          targetTrackId: track.id,
          startTime,
          duration,
          policy: "stack-above",
          newTrackId: "placement-preview",
        });
        setDropHint(
          placement.ok && placement.trackId !== track.id
            ? "Place above"
            : "Drop to add clip",
        );
      } catch {
        setDropHint("Drop to add clip");
      }
    },
    [mediaItems, pixelsPerSecond, scrollX, track.id],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
    setDropHint("Drop to add clip");
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setDropHint("Drop to add clip");

      // External OS file drop (e.g. from Windows Explorer)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const rect = laneRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left + scrollX;
        const rawTime = Math.max(0, x / pixelsPerSecond);
        const snapResult = calculateSnap(
          rawTime,
          "",
          allTracks,
          useTimelineStore.getState().playheadPosition,
          snapSettings,
          pixelsPerSecond,
        );
        const { importMedia, placeMediaClip } = useProjectStore.getState();
        for (const file of Array.from(e.dataTransfer.files)) {
          try {
            const beforeIds = new Set(
              useProjectStore.getState().project.mediaLibrary.items.map(i => i.id)
            );
            const result = await importMedia(file);
            if (result.success) {
              const newItem = useProjectStore
                .getState()
                .project.mediaLibrary.items.find(i => !beforeIds.has(i.id));
              if (newItem) {
                await placeMediaClip(newItem.id, track.id, snapResult.time);
                toast.success(`Added to ${track.name}`, file.name);
              }
            }
          } catch (err) {
            console.error("[TrackLane] External file drop failed:", err);
          }
        }
        return;
      }

      // Internal drag from assets panel
      try {
        const rawData = e.dataTransfer.getData("application/json");
        if (!rawData) return;

        const data = JSON.parse(rawData);
        if (
          !data ||
          typeof data !== "object" ||
          typeof data.mediaId !== "string" ||
          !data.mediaId.trim()
        ) {
          return;
        }

        const rect = laneRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left + scrollX;
          const rawTime = Math.max(0, x / pixelsPerSecond);
          const snapResult = calculateSnap(
            rawTime,
            "",
            allTracks,
            useTimelineStore.getState().playheadPosition,
            snapSettings,
            pixelsPerSecond,
          );
          onDropMedia(track.id, data.mediaId, snapResult.time);
        }
      } catch {
        // Silently ignore parse errors
      }
    },
    [
      allTracks,
      onDropMedia,
      pixelsPerSecond,
      scrollX,
      snapSettings,
      track.id,
      track.name,
    ],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStartY.current = e.clientY;
      resizeStartHeight.current = trackHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [trackHeight],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY.current;
      const newHeight = resizeStartHeight.current + deltaY;
      onResizeTrack(track.id, newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, track.id, onResizeTrack]);

  return (
    <div className="relative">
      <div
        ref={laneRef}
        style={{ height: trackHeight }}
        className={`border-b border-border/50 relative transition-colors ${
          isDragOver
            ? "bg-primary/10 border-primary/30"
            : "bg-background-secondary/20"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {track.clips
          .filter((clip) => !textClips.some((tc) => tc.id === clip.id))
          .filter((clip) => !shapeClips.some((sc) => sc.id === clip.id))
          .map((clip) => (
            <ClipComponent
              key={clip.id}
              clip={clip}
              track={track}
              allTracks={allTracks}
              pixelsPerSecond={pixelsPerSecond}
              scrollX={scrollX}
              viewportWidth={viewportWidth}
              isSelected={selectedClipIds.includes(clip.id)}
              trackHeights={trackHeights}
              timelineRef={timelineRef}
              onSelect={onSelectClip}
              onMoveClip={onMoveClip}
              onSnapIndicator={onSnapIndicator}
              onTrimClip={onTrimClip}
            />
          ))}
        {textClips.map((textClip) => (
          <TextClipComponent
            key={textClip.id}
            textClip={textClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(textClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimTextClip}
            onMoveClip={onMoveTextClip}
            allTracks={allTracks}
            trackHeights={trackHeights}
            timelineRef={timelineRef}
          />
        ))}
        {shapeClips.map((shapeClip) => (
          <ShapeClipComponent
            key={shapeClip.id}
            shapeClip={shapeClip}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(shapeClip.id)}
            onSelect={onSelectClip}
            onTrim={onTrimShapeClip}
            onMoveClip={onMoveClip}
            allTracks={allTracks}
            trackHeights={trackHeights}
            timelineRef={timelineRef}
          />
        ))}
        {adjustmentLayers.map((layer) => {
          const ownerClip = track.clips.find(
            (clip) =>
              layer.startTime < clip.startTime + clip.duration &&
              layer.startTime + layer.duration > clip.startTime,
          ) ?? track.clips[0];
          return (
            <AdjustmentLayerTimelineItem
              key={layer.id}
              layer={layer}
              pixelsPerSecond={pixelsPerSecond}
              frameRate={frameRate}
              isSelected={Boolean(ownerClip && selectedClipIds.includes(ownerClip.id))}
              onSelectOwner={() => ownerClip && onSelectClip(ownerClip.id, false)}
            />
          );
        })}
        {transitionHandles.map((handle) => (
            <TransitionHandle
              key={
                handle.clipB
                  ? `${handle.clipA.id}-${handle.clipB.id}`
                  : `${handle.clipA.id}-${handle.edge ?? "out"}`
              }
              handle={handle}
              trackId={track.id}
              isSelected={
                handle.transition
                  ? selectedTransitionId === handle.transition.id
                  : false
              }
              onSelect={onSelectTransition}
            />
          ))}
        {isDragOver && (
          <div className="absolute inset-0 border-2 border-dashed border-primary/50 rounded pointer-events-none flex items-center justify-center">
            <span className="text-xs text-primary bg-background/80 px-2 py-1 rounded">
              {dropHint}
            </span>
          </div>
        )}
      </div>
      <div
        data-timeline-height-resize
        className={`absolute bottom-0 left-0 right-0 h-1 cursor-row-resize hover:bg-primary/50 transition-colors z-10 ${
          isResizing ? "bg-primary" : ""
        }`}
        onMouseDown={handleResizeStart}
      />
      {isExpanded && clipsWithKeyframes.length > 0 && (
        <div className="absolute left-0 right-0" style={{ top: trackHeight }}>
          {clipsWithKeyframes.map((clip) => (
            <div
              key={`keyframes-${clip.id}`}
              className="relative"
              style={{ left: clip.startTime * pixelsPerSecond }}
            >
              <KeyframeTrack
                clip={clip}
                pixelsPerSecond={pixelsPerSecond}
                onKeyframeSelect={onKeyframeSelect ?? (() => {})}
                onKeyframeMove={onKeyframeMove ?? (() => {})}
                onKeyframeDelete={onKeyframeDelete ?? (() => {})}
                selectedKeyframeIds={selectedKeyframeIds}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
