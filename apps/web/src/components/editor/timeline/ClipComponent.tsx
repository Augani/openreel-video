import React, { useRef, useState, useEffect } from "react";
import { Image } from "lucide-react";
import type { Clip, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { calculateSnap, generateWaveformPath, getClipStyle } from "./utils";
import { ClipContextMenu } from "./ClipContextMenu";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";

interface ClipComponentProps {
  clip: Clip;
  track: Track;
  allTracks: Track[];
  pixelsPerSecond: number;
  isSelected: boolean;
  trackHeights: Map<string, number>;
  timelineRef: React.RefObject<HTMLDivElement>;
  onSelect: (clipId: string, addToSelection: boolean) => void;
  onMoveClip: (
    clipId: string,
    newStartTime: number,
    targetTrackId?: string,
  ) => void;
  onSnapIndicator: (time: number | null) => void;
  onTrimClip?: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void;
}

export const ClipComponent: React.FC<ClipComponentProps> = ({
  clip,
  track,
  allTracks,
  pixelsPerSecond,
  isSelected,
  trackHeights,
  timelineRef,
  onSelect,
  onMoveClip,
  onSnapIndicator,
  onTrimClip,
}) => {
  const { getMediaItem } = useProjectStore();
  const { snapSettings } = useUIStore();
  const { playheadPosition } = useTimelineStore();
  const mediaItem = getMediaItem(clip.mediaId);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimEdge, setTrimEdge] = useState<"left" | "right" | null>(null);
  const trimStartRef = useRef<{
    mouseX: number;
    startTime: number;
    duration: number;
  }>({
    mouseX: 0,
    startTime: clip.startTime,
    duration: clip.duration,
  });
  const clipRef = useRef<HTMLDivElement>(null);

  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;

  const isVideo = track.type === "video";
  const isAudio = track.type === "audio";
  const isImage = track.type === "image";
  const clipStyle = getClipStyle(track.type);

  const handleClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    e.stopPropagation();
    onSelect(clip.id, e.shiftKey || e.metaKey);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (track.locked || isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clipStartX = clip.startTime * pixelsPerSecond;
    setDragOffset(clickX - clipStartX);
    setIsDragging(true);

    onSelect(clip.id, e.shiftKey || e.metaKey);
  };

  const handleTrimMouseDown =
    (edge: "left" | "right") => (e: React.MouseEvent) => {
      if (track.locked || !onTrimClip) return;
      e.stopPropagation();
      setIsTrimming(true);
      setTrimEdge(edge);
      trimStartRef.current = {
        mouseX: e.clientX,
        startTime: clip.startTime,
        duration: clip.duration,
      };
      document.body.style.cursor = "ew-resize";
    };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = clipRef.current?.parentElement?.getBoundingClientRect();
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      if (!rect || !timelineRect) return;

      const x = e.clientX - rect.left - dragOffset;
      const rawTime = Math.max(0, x / pixelsPerSecond);

      const snapResult = calculateSnap(
        rawTime,
        clip.id,
        allTracks,
        playheadPosition,
        snapSettings,
        pixelsPerSecond,
      );

      const scrollTop = timelineRef.current?.scrollTop || 0;
      const mouseY = e.clientY - timelineRect.top + scrollTop;
      let targetTrackId: string | undefined;
      let cumulativeY = 0;

      for (const t of allTracks) {
        const height = trackHeights.get(t.id) || 60;
        if (mouseY >= cumulativeY && mouseY < cumulativeY + height) {
          if (t.type === track.type && t.id !== track.id) {
            targetTrackId = t.id;
          }
          break;
        }
        cumulativeY += height;
      }

      onMoveClip(clip.id, snapResult.time, targetTrackId);
      onSnapIndicator(snapResult.snapped ? snapResult.time : null);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onSnapIndicator(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isDragging,
    dragOffset,
    pixelsPerSecond,
    clip.id,
    track.id,
    track.type,
    allTracks,
    trackHeights,
    timelineRef,
    playheadPosition,
    snapSettings,
    onMoveClip,
    onSnapIndicator,
  ]);

  useEffect(() => {
    if (!isTrimming || !trimEdge || !onTrimClip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - trimStartRef.current.mouseX;
      const deltaTime = deltaX / pixelsPerSecond;

      if (trimEdge === "left") {
        const newStartTime = Math.max(
          0,
          trimStartRef.current.startTime + deltaTime,
        );
        const maxStartTime =
          trimStartRef.current.startTime + trimStartRef.current.duration - 0.1;
        const clampedStartTime = Math.min(newStartTime, maxStartTime);
        onTrimClip(clip.id, "left", clampedStartTime);
      } else {
        const newEndTime =
          trimStartRef.current.startTime +
          trimStartRef.current.duration +
          deltaTime;
        const minEndTime = trimStartRef.current.startTime + 0.1;
        const clampedEndTime = Math.max(newEndTime, minEndTime);
        onTrimClip(clip.id, "right", clampedEndTime);
      }
    };

    const handleMouseUp = () => {
      setIsTrimming(false);
      setTrimEdge(null);
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isTrimming, trimEdge, clip.id, pixelsPerSecond, onTrimClip]);

  const thumbnailCount = Math.max(1, Math.floor(width / 60));
  const clipName = mediaItem?.name || clip.mediaId.slice(0, 8);

  const isInteracting = isDragging || isTrimming;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={clipRef}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          className={`group absolute top-1 bottom-1 rounded-lg overflow-hidden shadow-sm ${
            isDragging ? "cursor-grabbing opacity-80 z-20" : "cursor-grab"
          } ${
            isSelected
              ? "ring-2 ring-primary border-primary z-10"
              : "border-opacity-30 hover:border-opacity-60 hover:brightness-110"
          } ${clipStyle.bg} border ${clipStyle.border} ${
            track.locked ? "cursor-not-allowed opacity-60" : ""
          }`}
          style={{
            transform: `translateX(${left}px)`,
            width: `${width}px`,
            willChange: isInteracting ? 'transform, width' : 'auto',
            transition: isInteracting ? 'none' : 'opacity 150ms, box-shadow 150ms',
          }}
        >
      {isVideo &&
        (mediaItem?.filmstripThumbnails?.length || mediaItem?.thumbnailUrl) && (
          <div className="absolute inset-0 flex pointer-events-none">
            {mediaItem?.filmstripThumbnails &&
            mediaItem.filmstripThumbnails.length > 0
              ? Array.from({ length: thumbnailCount }).map((_, i) => {
                  const clipProgress = i / Math.max(1, thumbnailCount - 1);
                  const thumbIndex = Math.min(
                    Math.floor(
                      clipProgress * mediaItem.filmstripThumbnails!.length,
                    ),
                    mediaItem.filmstripThumbnails!.length - 1,
                  );
                  const thumb = mediaItem.filmstripThumbnails![thumbIndex];
                  return (
                    <div
                      key={i}
                      className="flex-1 h-full bg-cover bg-center opacity-70"
                      style={{
                        backgroundImage: `url(${thumb.url})`,
                        borderRight:
                          i < thumbnailCount - 1
                            ? "1px solid rgba(0,0,0,0.2)"
                            : "none",
                      }}
                    />
                  );
                })
              : Array.from({ length: thumbnailCount }).map((_, i) => (
                  <div
                    key={i}
                    className="flex-1 h-full bg-cover bg-center opacity-60"
                    style={{
                      backgroundImage: `url(${mediaItem.thumbnailUrl})`,
                      borderRight:
                        i < thumbnailCount - 1
                          ? "1px solid rgba(0,0,0,0.2)"
                          : "none",
                    }}
                  />
                ))}
          </div>
        )}

      {isVideo && !mediaItem?.thumbnailUrl && (
        <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/10 pointer-events-none" />
      )}

      {isImage && (
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-purple-500/10 flex items-center justify-center pointer-events-none">
          {mediaItem?.thumbnailUrl ? (
            <img
              src={mediaItem.thumbnailUrl}
              alt={clipName}
              className="h-full object-cover opacity-60"
            />
          ) : (
            <Image size={24} className="text-purple-400/50" />
          )}
        </div>
      )}

      <div className="w-full h-full flex flex-col justify-end px-2 pb-1 relative z-10 pointer-events-none">
        <span
          className={`text-[10px] font-medium truncate drop-shadow-md ${
            isSelected ? clipStyle.selectedText : clipStyle.text
          }`}
        >
          {clipName}
        </span>
      </div>

      {isAudio && (
        <>
          <div className="absolute inset-0 flex items-center opacity-50 px-1 pointer-events-none">
            {mediaItem?.waveformData ? (
              <svg
                className="w-full h-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 40"
              >
                <path
                  d={generateWaveformPath(mediaItem.waveformData, 100)}
                  stroke="currentColor"
                  className="text-blue-400"
                  fill="none"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : (
              <svg className="w-full h-full" preserveAspectRatio="none">
                <path
                  d="M0,20 Q10,5 20,20 T40,20 T60,20 T80,20 T100,20"
                  stroke="currentColor"
                  className="text-blue-400"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
          </div>
          <div className="absolute inset-x-0 top-1 flex justify-center opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
            <div className="flex gap-0.5">
              <div className="w-1 h-1 rounded-full bg-blue-300" />
              <div className="w-1 h-1 rounded-full bg-blue-300" />
              <div className="w-1 h-1 rounded-full bg-blue-300" />
            </div>
          </div>
        </>
      )}

      {clip.keyframes && clip.keyframes.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-3 flex items-center pointer-events-none">
          {clip.keyframes.map((kf) => {
            const relativeTime = kf.time - clip.startTime;
            if (relativeTime < 0 || relativeTime > clip.duration) return null;
            const posPercent = (relativeTime / clip.duration) * 100;
            return (
              <div
                key={kf.id}
                className="absolute w-2 h-2 bg-yellow-400 rotate-45 border border-yellow-600"
                style={{ left: `${posPercent}%`, marginLeft: "-4px" }}
                title={`${kf.property} @ ${kf.time.toFixed(2)}s`}
              />
            );
          })}
        </div>
      )}

      {isSelected && (
        <div className="absolute inset-0 border-2 border-primary rounded-lg pointer-events-none shadow-[inset_0_0_10px_rgba(34,197,94,0.2)]" />
      )}

      {(isVideo || isImage || isAudio) && onTrimClip && (
        <>
          <div
            onMouseDown={handleTrimMouseDown("left")}
            className={`absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 opacity-0 group-hover:opacity-100 transition-opacity ${
              isAudio ? "hover:bg-blue-400/50" : isVideo ? "hover:bg-green-400/50" : "hover:bg-purple-400/50"
            }`}
            onClick={(e) => e.stopPropagation()}
            title="Drag to adjust start"
          />
          <div
            onMouseDown={handleTrimMouseDown("right")}
            className={`absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-20 opacity-0 group-hover:opacity-100 transition-opacity ${
              isAudio ? "hover:bg-blue-400/50" : isVideo ? "hover:bg-green-400/50" : "hover:bg-purple-400/50"
            }`}
            onClick={(e) => e.stopPropagation()}
            title="Drag to adjust end"
          />
        </>
      )}

        </div>
      </ContextMenuTrigger>
      <ClipContextMenu clip={clip} track={track} />
    </ContextMenu>
  );
};
