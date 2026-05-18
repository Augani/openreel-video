import React, {
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Undo2,
  Redo2,
  Layers,
  Maximize2,
  Film,
  Music,
  Image,
  Type,
  Shapes,
  Scissors,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  ChevronDown as ChevronDownIcon,
  Magnet,
  Rows3,
  Rows2,
  FlipHorizontal,
  FlipVertical,
  Gauge,
  Droplet,
} from "lucide-react";
import { getSpeedEngine } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import type { SelectionItem } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { useEngineStore } from "../../stores/engine-store";
import { getPlaybackBridge } from "../../bridges/playback-bridge";
import {
  IconButton,
  Popover,
  PopoverTrigger,
  PopoverContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@openreel/ui";
import {
  Playhead,
  TimeRuler,
  TrackHeader,
  TrackLane,
  BeatMarkerOverlay,
  MarkerIndicator,
  formatTimecode,
  getTrackInfo,
} from "./timeline/index";

export const Timeline: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);

  const {
    project,
    undo,
    redo,
    canUndo,
    canRedo,
    splitClip,
    removeClip,
    addTrack,
    reorderTrack,
    deleteShapeClip,
    deleteSVGClip,
    deleteTextClip,
    removeMarker,
    updateMarker,
    updateClipKeyframes,
    updateClipTransform,
    addVideoEffect,
    updateVideoEffect,
    removeVideoEffect,
  } = useProjectStore();
  const tracks = project.timeline.tracks;

  const [draggedTrackId, setDraggedTrackId] = React.useState<string | null>(
    null,
  );

  const {
    playheadPosition,
    playbackState,
    pixelsPerSecond,
    scrollX,
    scrollY,
    viewportWidth,
    setScrollX,
    setScrollY,
    setViewportDimensions,
    zoomIn,
    zoomOut,
    trackHeight,
    setTrackHeight,
    setTrackHeightById,
    getTrackHeight,
  } = useTimelineStore();

  const [showLayersPanel, setShowLayersPanel] = useState(false);

  const { select, selectMultiple, clearSelection, getSelectedClipIds, snapSettings, toggleSnap } =
    useUIStore();
  const selectedClipIds = getSelectedClipIds();

  const { getTitleEngine, getGraphicsEngine } = useEngineStore();
  const titleEngine = getTitleEngine();
  const allTextClips = useMemo(() => {
    return titleEngine?.getAllTextClips() ?? [];
  }, [titleEngine, project.modifiedAt]);

  const getTextClipsForTrack = useCallback(
    (trackId: string) => {
      return allTextClips.filter((tc) => tc.trackId === trackId);
    },
    [allTextClips],
  );

  const graphicsEngine = getGraphicsEngine();
  const allShapeClips = useMemo(() => {
    const shapes = graphicsEngine?.getAllShapeClips() ?? [];
    const svgs = graphicsEngine?.getAllSVGClips() ?? [];
    const stickers = graphicsEngine?.getAllStickerClips() ?? [];
    return [...shapes, ...svgs, ...stickers];
  }, [graphicsEngine, project.modifiedAt]);

  const getShapeClipsForTrack = useCallback(
    (trackId: string) => {
      return allShapeClips.filter((sc) => sc.trackId === trackId);
    },
    [allShapeClips],
  );
  const [isBoxSelecting, setIsBoxSelecting] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    return Math.max(maxEnd, 60); // Minimum 60 seconds
  }, [tracks]);

  const playheadSnapPoints = useMemo(() => {
    const points = new Set<number>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        points.add(clip.startTime);
        points.add(clip.startTime + clip.duration);
      }
    }
    return Array.from(points).sort((a, b) => a - b);
  }, [tracks]);

  const totalTracksHeight = useMemo(() => {
    let height = 0;
    for (const track of tracks) {
      height += getTrackHeight(track.id);
    }
    return height;
  }, [tracks, getTrackHeight]);

  const trackHeightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) {
      map.set(track.id, getTrackHeight(track.id));
    }
    return map;
  }, [tracks, getTrackHeight]);

  const handleTrackDragStart = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.dataTransfer.setData("trackId", trackId);
      e.dataTransfer.effectAllowed = "move";
      setDraggedTrackId(trackId);
    },
    [],
  );

  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, targetTrackId: string) => {
      e.preventDefault();
      const sourceTrackId = e.dataTransfer.getData("trackId");
      setDraggedTrackId(null);

      if (sourceTrackId && sourceTrackId !== targetTrackId) {
        const targetIndex = tracks.findIndex((t) => t.id === targetTrackId);
        if (targetIndex !== -1) {
          await reorderTrack(sourceTrackId, targetIndex);
        }
      }
    },
    [tracks, reorderTrack],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportDimensions(
          entry.contentRect.width,
          entry.contentRect.height,
        );
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [setViewportDimensions]);

  useEffect(() => {
    if (playbackState !== "playing") return;

    const playheadPixels = playheadPosition * pixelsPerSecond;
    const visibleEnd = scrollX + viewportWidth - 150;

    if (playheadPixels > visibleEnd && tracksRef.current) {
      const newScrollX = playheadPixels - viewportWidth + 200;
      tracksRef.current.scrollLeft = Math.max(0, newScrollX);
    }
  }, [playheadPosition, playbackState, pixelsPerSecond, scrollX, viewportWidth]);

  const handleSelectClip = useCallback(
    (clipId: string, addToSelection: boolean) => {
      const isTextClip = allTextClips.some((tc) => tc.id === clipId);
      if (isTextClip) {
        const textClip = allTextClips.find((tc) => tc.id === clipId);
        select(
          { type: "text-clip", id: clipId, trackId: textClip?.trackId },
          addToSelection,
        );
        return;
      }
      const isShapeClip = allShapeClips.some((sc) => sc.id === clipId);
      if (isShapeClip) {
        const shapeClip = allShapeClips.find((sc) => sc.id === clipId);
        select(
          { type: "shape-clip", id: clipId, trackId: shapeClip?.trackId },
          addToSelection,
        );
        return;
      }

      let trackId: string | undefined;
      for (const track of tracks) {
        if (track.clips.some((c) => c.id === clipId)) {
          trackId = track.id;
          break;
        }
      }
      select({ type: "clip", id: clipId, trackId }, addToSelection);
    },
    [tracks, select, allTextClips, allShapeClips],
  );

  const [selectedKeyframeIds, setSelectedKeyframeIds] = useState<string[]>([]);

  const handleKeyframeSelect = useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId]
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    []
  );

  const handleKeyframeMove = useCallback(
    (keyframeId: string, newTime: number) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          const keyframe = clip.keyframes?.find((kf) => kf.id === keyframeId);
          if (keyframe) {
            const updatedKeyframes = clip.keyframes?.map((kf) =>
              kf.id === keyframeId ? { ...kf, time: Math.max(0, newTime) } : kf
            );
            if (updatedKeyframes) {
              updateClipKeyframes(clip.id, updatedKeyframes);
            }
            return;
          }
        }
      }
    },
    [tracks, updateClipKeyframes]
  );

  const handleKeyframeDelete = useCallback(
    (keyframeId: string) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          const keyframe = clip.keyframes?.find((kf) => kf.id === keyframeId);
          if (keyframe) {
            const updatedKeyframes = clip.keyframes?.filter(
              (kf) => kf.id !== keyframeId
            );
            if (updatedKeyframes) {
              updateClipKeyframes(clip.id, updatedKeyframes);
            }
            setSelectedKeyframeIds((prev) =>
              prev.filter((id) => id !== keyframeId)
            );
            return;
          }
        }
      }
    },
    [tracks, updateClipKeyframes]
  );

  const handleSplit = useCallback(async () => {
    if (selectedClipIds.length === 1) {
      await splitClip(selectedClipIds[0], playheadPosition);
    }
  }, [selectedClipIds, playheadPosition, splitClip]);

  const handleDelete = useCallback(async () => {
    if (selectedClipIds.length === 0) return;

    for (const id of selectedClipIds) {
      const textClip = allTextClips.find((tc) => tc.id === id);
      if (textClip) {
        deleteTextClip(id);
        continue;
      }

      const graphicClip = allShapeClips.find((gc) => gc.id === id);
      if (graphicClip) {
        if (graphicClip.type === "svg") {
          deleteSVGClip(id);
        } else {
          deleteShapeClip(id);
        }
        continue;
      }

      removeClip(id);
    }
    clearSelection();
  }, [
    selectedClipIds,
    removeClip,
    clearSelection,
    allTextClips,
    allShapeClips,
    deleteTextClip,
    deleteShapeClip,
    deleteSVGClip,
  ]);

  const selectedClip = useMemo<any>(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { ...clip, type: track.type };
    }
    return null;
  }, [selectedClipIds, tracks]);

  const handleFlipHorizontal = useCallback((clipId: string, currentScaleX: number) => {
    const newScaleX = (currentScaleX < 0 ? 1 : -1) * (Math.abs(currentScaleX) || 1);
    updateClipTransform(clipId, {
      scale: {
        x: newScaleX,
      } as any
    });
    toast.success("Đã lật ngang clip");
  }, [updateClipTransform]);

  const handleFlipVertical = useCallback((clipId: string, currentScaleY: number) => {
    const newScaleY = (currentScaleY < 0 ? 1 : -1) * (Math.abs(currentScaleY) || 1);
    updateClipTransform(clipId, {
      scale: {
        y: newScaleY,
      } as any
    });
    toast.success("Đã lật dọc clip");
  }, [updateClipTransform]);

  const handleUpdateBlur = useCallback((clipId: string, radius: number) => {
    // Find the clip
    let targetClip: any = null;
    for (const track of project.timeline.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) return;

    const blurEffect = targetClip.effects?.find((e: any) => e.type === "blur");

    if (radius === 0) {
      if (blurEffect) {
        removeVideoEffect(clipId, blurEffect.id);
        toast.success("Đã xóa hiệu ứng Blur");
      }
    } else {
      if (blurEffect) {
        updateVideoEffect(clipId, blurEffect.id, { radius });
      } else {
        addVideoEffect(clipId, "blur", { radius });
      }
    }
  }, [project, addVideoEffect, updateVideoEffect, removeVideoEffect]);

  const currentBlurRadius = useMemo(() => {
    if (!selectedClip || !selectedClip.effects) return 0;
    const blurEffect = selectedClip.effects.find((e: any) => e.type === "blur");
    return blurEffect && blurEffect.enabled ? (blurEffect.params.radius as number) ?? 0 : 0;
  }, [selectedClip]);

  const handleUpdateSpeed = useCallback((clipId: string, speed: number) => {
    const speedEngine = getSpeedEngine();
    
    // Find the clip to get its duration
    let targetClip: any = null;
    for (const track of project.timeline.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) return;

    // Set speed in engine
    speedEngine.setClipSpeed(clipId, speed, targetClip.duration);

    // Calculate new duration
    const originalDuration = targetClip.outPoint - targetClip.inPoint;
    const newDuration = originalDuration / speed;

    const tracks = project.timeline.tracks.map((track) => {
      const clipIndex = track.clips.findIndex((c) => c.id === clipId);
      if (clipIndex === -1) {
        // Also check if we affect corresponding audio clip
        if (track.type === "audio") {
          const audioClipIndex = track.clips.findIndex(
            (c) => c.mediaId === targetClip.mediaId,
          );
          if (audioClipIndex !== -1) {
            const audioClip = track.clips[audioClipIndex];
            const updatedAudioClip = {
              ...audioClip,
              duration: newDuration,
              speed,
            };
            const newClips = [...track.clips];
            newClips[audioClipIndex] = updatedAudioClip;
            speedEngine.setClipSpeed(audioClip.id, speed, audioClip.duration);
            return { ...track, clips: newClips };
          }
        }
        return track;
      }

      const updatedClip = {
        ...track.clips[clipIndex],
        duration: newDuration,
        speed,
      };
      const newClips = [...track.clips];
      newClips[clipIndex] = updatedClip;

      return { ...track, clips: newClips };
    });

    useProjectStore.setState({
      project: {
        ...project,
        timeline: { ...project.timeline, tracks },
        modifiedAt: Date.now(),
      },
    });
    
    toast.success(`Đã thay đổi tốc độ thành ${speed}x`);
  }, [project]);

  const handleBackgroundClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleBoxSelectionStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".clip-component")) return;

      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Convert viewport coordinates to timeline coordinates by accounting for scroll position
      const x = e.clientX - rect.left + scrollX;
      const y = e.clientY - rect.top + scrollY;

      setIsBoxSelecting(true);
      setSelectionBox({
        startX: x,
        startY: y,
        currentX: x,
        currentY: y,
      });
    },
    [scrollX, scrollY],
  );

  const handleBoxSelectionMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isBoxSelecting || !selectionBox) return;

      const rect = tracksRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + scrollX;
      const y = e.clientY - rect.top + scrollY;

      setSelectionBox({
        ...selectionBox,
        currentX: x,
        currentY: y,
      });
    },
    [isBoxSelecting, selectionBox, scrollX, scrollY],
  );

  const handleBoxSelectionEnd = useCallback(() => {
    if (!isBoxSelecting || !selectionBox) {
      setIsBoxSelecting(false);
      setSelectionBox(null);
      return;
    }

    // Convert pixel coordinates to timeline time using current zoom level
    const minX = Math.min(selectionBox.startX, selectionBox.currentX);
    const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
    const minTime = minX / pixelsPerSecond;
    const maxTime = maxX / pixelsPerSecond;

    let currentY = 0;
    const selectedItems: SelectionItem[] = [];
    const textClipIds = new Set(allTextClips.map((clip) => clip.id));
    const shapeClipIds = new Set(allShapeClips.map((clip) => clip.id));

    // Iterate through tracks to find which are overlapped by selection box
    for (const track of visualOrderTracks) {
      const trackH = getTrackHeight(track.id);
      const trackMinY = currentY;
      const trackMaxY = currentY + trackH;

      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      // Check if selection box vertically overlaps this track
      const trackOverlaps = minY < trackMaxY && maxY > trackMinY;

      if (trackOverlaps) {
        const selectableItems: SelectionItem[] = [
          ...track.clips
            .filter((clip) => !textClipIds.has(clip.id))
            .filter((clip) => !shapeClipIds.has(clip.id))
            .map((clip) => ({
              type: "clip" as const,
              id: clip.id,
              trackId: track.id,
            })),
          ...allTextClips
            .filter((clip) => clip.trackId === track.id)
            .map((clip) => ({
              type: "text-clip" as const,
              id: clip.id,
            trackId: track.id,
            })),
          ...allShapeClips
            .filter((clip) => clip.trackId === track.id)
            .map((clip) => ({
              type: "shape-clip" as const,
              id: clip.id,
            trackId: track.id,
            })),
        ];

        for (const item of selectableItems) {
          const clip =
            allTextClips.find((textClip) => textClip.id === item.id) ||
            allShapeClips.find((shapeClip) => shapeClip.id === item.id) ||
            track.clips.find((trackClip) => trackClip.id === item.id);
          if (!clip) continue;

          const clipStart = clip.startTime;
          const clipEnd = clip.startTime + clip.duration;

          // Check if selection box time range overlaps clip time range
          const clipOverlaps = minTime < clipEnd && maxTime > clipStart;

          if (clipOverlaps) {
            selectedItems.push(item);
          }
        }
      }

      currentY += trackH;
    }

    selectMultiple(selectedItems);



    setIsBoxSelecting(false);
    setSelectionBox(null);
  }, [
    isBoxSelecting,
    selectionBox,
    pixelsPerSecond,
    tracks,
    getTrackHeight,
    selectMultiple,
    allTextClips,
    allShapeClips,
  ]);

  useEffect(() => {
    if (!isBoxSelecting) return;

    const handleMouseUp = () => handleBoxSelectionEnd();
    const onMouseMove = (e: MouseEvent) => handleBoxSelectionMove(e as unknown as React.MouseEvent);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [isBoxSelecting, handleBoxSelectionEnd, handleBoxSelectionMove]);

  const handleDropMedia = useCallback(
    async (trackId: string, mediaId: string, startTime: number) => {
      const { addClip, addClipToNewTrack } = useProjectStore.getState();
      if (trackId) {
        await addClip(trackId, mediaId, startTime);
      } else {
        await addClipToNewTrack(mediaId, startTime);
      }
    },
    [],
  );

  const { moveClip } = useProjectStore();
  const handleMoveClip = useCallback(
    async (clipId: string, newStartTime: number, targetTrackId?: string) => {
      const graphicClip = allShapeClips.find((sc) => sc.id === clipId);
      if (graphicClip && graphicsEngine) {
        if (graphicClip.type === "sticker" || graphicClip.type === "emoji") {
          graphicsEngine.updateStickerClip(clipId, { startTime: newStartTime });
        } else if (graphicClip.type === "svg") {
          graphicsEngine.updateSVGClip(clipId, { startTime: newStartTime });
        } else {
          graphicsEngine.updateShapeClip(clipId, { startTime: newStartTime });
        }
        useProjectStore.setState((state) => ({
          project: { ...state.project, modifiedAt: Date.now() },
        }));
      } else {
        await moveClip(clipId, newStartTime, targetTrackId);
      }
    },
    [moveClip, allShapeClips, graphicsEngine],
  );

  const [snapIndicatorTime, setSnapIndicatorTime] = React.useState<
    number | null
  >(null);

  const handleSnapIndicator = useCallback((time: number | null) => {
    setSnapIndicatorTime(time);
  }, []);

  const handleTrimTextClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      if (!titleEngine) return;

      const textClip = allTextClips.find((tc) => tc.id === clipId);
      if (!textClip) return;

      const oldDuration = textClip.duration;
      const newDuration =
        edge === "left"
          ? Math.max(0.1, textClip.startTime + textClip.duration - newTime)
          : Math.max(0.1, newTime - textClip.startTime);

      const adjustedKeyframes = textClip.keyframes.map((kf) => {
        if (kf.id.startsWith("kf-exit-")) {
          const relativeTime = kf.time - oldDuration;
          return { ...kf, time: newDuration + relativeTime };
        }
        return kf;
      });

      if (edge === "left") {
        titleEngine.updateTextClip(clipId, {
          startTime: newTime,
          duration: newDuration,
        });
      } else {
        titleEngine.updateTextClip(clipId, {
          duration: newDuration,
        });
      }

      useProjectStore
        .getState()
        .updateTextClipKeyframes(clipId, adjustedKeyframes);

      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [titleEngine, allTextClips],
  );

  const handleMoveTextClip = useCallback(
    (clipId: string, newStartTime: number) => {
      if (!titleEngine) return;

      const textClip = allTextClips.find((tc) => tc.id === clipId);
      if (!textClip) return;

      titleEngine.updateTextClip(clipId, {
        startTime: Math.max(0, newStartTime),
      });

      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [titleEngine, allTextClips],
  );

  const handleTrimShapeClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      if (!graphicsEngine) return;

      const graphicClip = allShapeClips.find((sc) => sc.id === clipId);
      if (!graphicClip) return;

      const oldDuration = graphicClip.duration;
      const newDuration =
        edge === "left"
          ? Math.max(
              0.1,
              graphicClip.startTime + graphicClip.duration - newTime,
            )
          : Math.max(0.1, newTime - graphicClip.startTime);

      const updates =
        edge === "left"
          ? {
              startTime: newTime,
              duration: newDuration,
            }
          : {
              duration: newDuration,
            };

      const adjustedKeyframes = graphicClip.keyframes.map((kf) => {
        if (kf.id.startsWith("kf-exit-")) {
          const relativeTime = kf.time - oldDuration;
          return { ...kf, time: newDuration + relativeTime };
        }
        return kf;
      });

      if (graphicClip.type === "sticker" || graphicClip.type === "emoji") {
        graphicsEngine.updateStickerClip(clipId, updates);
      } else if (graphicClip.type === "svg") {
        graphicsEngine.updateSVGClip(clipId, updates);
      } else {
        graphicsEngine.updateShapeClip(clipId, updates);
      }

      useProjectStore.getState().updateClipKeyframes(clipId, adjustedKeyframes);

      useProjectStore.setState((state) => ({
        project: { ...state.project, modifiedAt: Date.now() },
      }));
    },
    [graphicsEngine, allShapeClips],
  );

  const handleTrimClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      const clip = tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
      if (!clip) return;

      const oldDuration = clip.duration;
      const newDuration =
        edge === "left"
          ? Math.max(0.1, clip.startTime + clip.duration - newTime)
          : Math.max(0.1, newTime - clip.startTime);

      const updates =
        edge === "left"
          ? {
              startTime: newTime,
              duration: newDuration,
            }
          : {
              duration: newDuration,
            };

      const adjustedKeyframes = clip.keyframes.map((kf) => {
        if (kf.id.startsWith("kf-exit-")) {
          const relativeTime = kf.time - oldDuration;
          return { ...kf, time: newDuration + relativeTime };
        }
        return kf;
      });

      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            tracks: state.project.timeline.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((c) =>
                c.id === clipId
                  ? { ...c, ...updates, keyframes: adjustedKeyframes }
                  : c,
              ),
            })),
          },
          modifiedAt: Date.now(),
        },
      }));
    },
    [tracks],
  );

  const visualOrderTracks = useMemo(() => tracks, [tracks]);

  return (
    <div
      data-tour="timeline"
      className="h-full bg-background border-t border-border flex flex-col"
    >
      <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-background-secondary relative z-[100]">
        <div className="flex items-center gap-2">
          <div className="flex bg-background-tertiary rounded-lg p-1 border border-border">
            <IconButton
              icon={Undo2}
              onClick={undo}
              disabled={!canUndo()}
              title="Undo (Cmd+Z)"
            />
            <IconButton
              icon={Redo2}
              onClick={redo}
              disabled={!canRedo()}
              title="Redo (Cmd+Shift+Z)"
            />
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          <div className="flex bg-background-tertiary rounded-lg p-1 border border-border gap-1">
            <button
              onClick={handleSplit}
              disabled={selectedClipIds.length !== 1}
              title="Split clip at playhead (S)"
              className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                selectedClipIds.length === 1
                  ? "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30"
                  : "text-text-muted opacity-50 cursor-not-allowed"
              }`}
            >
              <Scissors size={14} />
              <span className="text-[10px] font-medium">SPLIT</span>
            </button>
            <IconButton
              icon={Trash2}
              onClick={handleDelete}
              disabled={selectedClipIds.length === 0}
              title="Delete clip (Del)"
              className="hover:text-red-500"
            />
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Clip actions group (always visible) */}
          <div className="flex bg-background-tertiary rounded-lg p-1 border border-border gap-1 items-center">
            <span className="text-[9px] font-bold text-text-tertiary px-1 uppercase tracking-wider select-none">Clip</span>
            
            {/* Lật Ngang Video/Hình ảnh */}
            <button
              onClick={() => selectedClip && handleFlipHorizontal(selectedClip.id, selectedClip.transform?.scale?.x ?? 1)}
              disabled={!selectedClip || (selectedClip.type !== "video" && selectedClip.type !== "image")}
              title="Lật Ngang Video"
              className={`p-1 rounded transition-colors ${
                selectedClip && (selectedClip.type === "video" || selectedClip.type === "image")
                  ? "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                  : "text-text-muted opacity-40 cursor-not-allowed"
              }`}
            >
              <FlipHorizontal size={14} />
            </button>

            {/* Lật Dọc Video/Hình ảnh */}
            <button
              onClick={() => selectedClip && handleFlipVertical(selectedClip.id, selectedClip.transform?.scale?.y ?? 1)}
              disabled={!selectedClip || (selectedClip.type !== "video" && selectedClip.type !== "image")}
              title="Lật Dọc Video"
              className={`p-1 rounded transition-colors ${
                selectedClip && (selectedClip.type === "video" || selectedClip.type === "image")
                  ? "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                  : "text-text-muted opacity-40 cursor-not-allowed"
              }`}
            >
              <FlipVertical size={14} />
            </button>

            {/* Làm Chậm / Tốc Độ Video/Audio */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  disabled={!selectedClip || (selectedClip.type !== "video" && selectedClip.type !== "audio")}
                  title="Tốc độ clip (Slow down / Speed up)"
                  className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                    selectedClip && (selectedClip.type === "video" || selectedClip.type === "audio")
                      ? "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                      : "text-text-muted opacity-40 cursor-not-allowed border border-transparent"
                  }`}
                >
                  <Gauge size={12} />
                  <span className="text-[10px] font-semibold">
                    {selectedClip && (selectedClip.type === "video" || selectedClip.type === "audio")
                      ? `${getSpeedEngine().getClipSpeed(selectedClip.id) || 1}x`
                      : "1x"}
                  </span>
                </button>
              </PopoverTrigger>
              {selectedClip && (selectedClip.type === "video" || selectedClip.type === "audio") && (
                <PopoverContent side="top" align="center" className="p-3 w-48 bg-background-secondary border border-border rounded-lg shadow-xl z-[200]">
                  <div className="text-[10px] font-bold text-text-secondary mb-2 uppercase tracking-wide select-none">Tốc Độ Clip</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5].map((speed) => {
                      const currentSpeed = getSpeedEngine().getClipSpeed(selectedClip.id) || 1;
                      return (
                        <button
                          key={speed}
                          onClick={() => handleUpdateSpeed(selectedClip.id, speed)}
                          className={`px-1.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                            currentSpeed === speed
                              ? "bg-primary text-white"
                              : "bg-background-tertiary text-text-secondary hover:bg-background-elevated hover:text-text-primary border border-border"
                          }`}
                        >
                          {speed}x
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              )}
            </Popover>

            {/* Độ Mờ (Blur) Video/Hình ảnh */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  disabled={!selectedClip || (selectedClip.type !== "video" && selectedClip.type !== "image")}
                  title="Độ mờ (Blur)"
                  className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                    selectedClip && (selectedClip.type === "video" || selectedClip.type === "image")
                      ? currentBlurRadius > 0
                        ? "bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/30"
                        : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                      : "text-text-muted opacity-40 cursor-not-allowed border border-transparent"
                  }`}
                >
                  <Droplet size={14} className={currentBlurRadius > 0 ? "fill-purple-400" : ""} />
                  {currentBlurRadius > 0 && (
                    <span className="text-[10px] font-semibold">
                      {currentBlurRadius}px
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              {selectedClip && (selectedClip.type === "video" || selectedClip.type === "image") && (
                <PopoverContent side="top" align="center" className="p-3 w-48 bg-background-secondary border border-border rounded-lg shadow-xl z-[200]">
                  <div className="flex justify-between items-center mb-2 select-none">
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wide">Độ Mờ (Blur)</span>
                    <span className="text-[10px] font-semibold text-purple-400">{currentBlurRadius}px</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={currentBlurRadius}
                      onChange={(e) => handleUpdateBlur(selectedClip.id, parseInt(e.target.value))}
                      className="w-full h-1 bg-background-tertiary rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-[8px] text-text-muted select-none">
                      <span>0px (Tắt)</span>
                      <span>20px</span>
                    </div>
                  </div>
                </PopoverContent>
              )}
            </Popover>
          </div>
          <div className="w-px h-6 bg-border mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors"
                title="Add new track"
              >
                <Plus size={14} />
                <span className="text-[11px] font-semibold">Add Track</span>
                <ChevronDownIcon size={12} className="ml-0.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-48">
              <DropdownMenuItem onClick={() => addTrack("video")}>
                <Film size={16} className="text-green-400" />
                <span>Video Track</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addTrack("audio")}>
                <Music size={16} className="text-blue-400" />
                <span>Audio Track</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => addTrack("image")}>
                <Image size={16} className="text-purple-400" />
                <span>Image Track</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addTrack("text")}>
                <Type size={16} className="text-yellow-400" />
                <span>Text Track</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addTrack("graphics")}>
                <Shapes size={16} className="text-pink-400" />
                <span>Graphics Track</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-6 bg-border mx-1" />

          <Popover open={showLayersPanel} onOpenChange={setShowLayersPanel}>
            <PopoverTrigger asChild>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors ${
                  showLayersPanel
                    ? "bg-primary/20 text-primary"
                    : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
                }`}
                title="Manage track layers"
              >
                <Layers size={14} />
                <span className="text-[10px] font-medium tracking-wide">LAYERS</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-64 p-0 bg-background-secondary border-border"
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-background-tertiary">
                <span className="text-xs font-semibold text-text-primary">
                  Track Layers
                </span>
              </div>
              <div className="p-2 max-h-60 overflow-y-auto">
                {tracks.length === 0 ? (
                  <p className="text-xs text-text-muted text-center py-6">
                    No tracks yet
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {tracks.map((track, index) => {
                      const info = getTrackInfo(track, index);
                      return (
                        <div
                          key={track.id}
                          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-background-tertiary group transition-colors cursor-default"
                        >
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center ${info.bgLight}`}
                          >
                            <info.icon size={14} className={info.textColor} />
                          </div>
                          <span className="text-[11px] font-medium text-text-primary flex-1 truncate">
                            {track.name || info.label}
                          </span>
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() =>
                                index > 0 && reorderTrack(track.id, index - 1)
                              }
                              disabled={index === 0}
                              className="p-1.5 rounded-md hover:bg-background-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Move up"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              onClick={() =>
                                index < tracks.length - 1 &&
                                reorderTrack(track.id, index + 1)
                              }
                              disabled={index === tracks.length - 1}
                              className="p-1.5 rounded-md hover:bg-background-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Move down"
                            >
                              <ChevronDown size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <div className="w-px h-6 bg-border mx-1" />

          <button
            onClick={toggleSnap}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors ${
              snapSettings.enabled
                ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                : "hover:bg-background-elevated text-text-muted hover:text-text-secondary"
            }`}
            title={snapSettings.enabled ? "Disable snapping" : "Enable snapping"}
          >
            <Magnet size={14} />
            <span className="text-[10px] font-medium tracking-wide">SNAP</span>
          </button>
        </div>

        <div className="font-mono text-primary text-sm font-bold tracking-wider bg-background-tertiary px-4 py-1.5 rounded-lg border border-primary/20 shadow-[0_0_12px_rgba(34,197,94,0.15)]">
          {formatTimecode(playheadPosition)}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-background-tertiary rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => { setTrackHeight(80); useTimelineStore.setState({ trackHeights: {} }); }}
              className={`w-8 h-8 flex items-center justify-center transition-colors border-r border-border ${
                trackHeight >= 60
                  ? "text-primary bg-primary/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
              }`}
              title="Large tracks"
            >
              <Rows3 size={14} />
            </button>
            <button
              onClick={() => { setTrackHeight(50); useTimelineStore.setState({ trackHeights: {} }); }}
              className={`w-8 h-8 flex items-center justify-center transition-colors ${
                trackHeight < 60
                  ? "text-primary bg-primary/10"
                  : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
              }`}
              title="Small tracks"
            >
              <Rows2 size={14} />
            </button>
          </div>
          <div className="flex items-center bg-background-tertiary rounded-lg border border-border overflow-hidden">
            <button
              onClick={zoomOut}
              className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors border-r border-border"
              title="Zoom out"
            >
              <span className="text-base font-medium">−</span>
            </button>
            <span className="text-[11px] w-14 text-center font-mono text-text-secondary tabular-nums">
              {Math.round(pixelsPerSecond)}px/s
            </span>
            <button
              onClick={zoomIn}
              className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors border-l border-border"
              title="Zoom in"
            >
              <span className="text-base font-medium">+</span>
            </button>
          </div>
          <IconButton icon={Maximize2} title="Maximize timeline" />
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-hidden relative"
        onClick={handleBackgroundClick}
      >
        <div className="flex shrink-0">
          <div className="w-32 h-8 bg-background-tertiary border-b border-r border-border shrink-0" />
          <div className="flex-1 overflow-hidden relative">
            <div
              style={{
                width: `${timelineDuration * pixelsPerSecond}px`,
                transform: `translateX(-${scrollX}px)`,
              }}
            >
              <TimeRuler
                duration={timelineDuration}
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                viewportWidth={viewportWidth}
                snapPoints={playheadSnapPoints}
                onSeek={(time) => {
                  const bridge = getPlaybackBridge();
                  bridge.scrubTo(time);
                }}
                onScrubStart={() => {
                  const bridge = getPlaybackBridge();
                  bridge.startScrubbing();
                }}
                onScrubEnd={() => {
                  const bridge = getPlaybackBridge();
                  bridge.endScrubbing();
                }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-32 bg-background-secondary border-r border-border shrink-0 z-20 shadow-lg overflow-hidden">
            <div
              className="flex flex-col"
              style={{ transform: `translateY(-${scrollY}px)` }}
            >
              {visualOrderTracks.map((track, i) => {
                const keyframeCount = track.clips.reduce(
                  (sum, clip) => sum + (clip.keyframes?.length || 0),
                  0
                );
                return (
                  <div
                    key={track.id}
                    className={draggedTrackId === track.id ? "opacity-50" : ""}
                  >
                    <TrackHeader
                      track={track}
                      index={i}
                      onDragStart={handleTrackDragStart}
                      onDragOver={handleTrackDragOver}
                      onDrop={handleTrackDrop}
                      keyframeCount={keyframeCount}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div
            ref={tracksRef}
            className="flex-1 bg-background relative overflow-auto custom-scrollbar"
            onScroll={(e) => {
              setScrollX(e.currentTarget.scrollLeft);
              setScrollY(e.currentTarget.scrollTop);
            }}
            onMouseDown={handleBoxSelectionStart}
            onMouseMove={handleBoxSelectionMove}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={async (e) => {
              e.preventDefault();

              const rect = tracksRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left + (tracksRef.current?.scrollLeft ?? 0);
              const rawTime = Math.max(0, x / pixelsPerSecond);

              const allClips = project.timeline.tracks.flatMap(t => t.clips);
              let snappedTime = rawTime;
              if (snapSettings.enabled) {
                const threshold = snapSettings.snapThreshold / pixelsPerSecond;
                let bestDist = Infinity;
                for (const clip of allClips) {
                  const clipEnd = clip.startTime + clip.duration;
                  const distToEnd = Math.abs(rawTime - clipEnd);
                  const distToStart = Math.abs(rawTime - clip.startTime);
                  if (distToEnd < threshold && distToEnd < bestDist) {
                    bestDist = distToEnd;
                    snappedTime = clipEnd;
                  }
                  if (distToStart < threshold && distToStart < bestDist) {
                    bestDist = distToStart;
                    snappedTime = clip.startTime;
                  }
                }
                if (snapSettings.snapToPlayhead) {
                  const distToPlayhead = Math.abs(rawTime - playheadPosition);
                  if (distToPlayhead < threshold && distToPlayhead < bestDist) {
                    snappedTime = playheadPosition;
                  }
                }
              }

              // External OS file drop (e.g. from Windows Explorer)
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const { importMedia, addClipToNewTrack } = useProjectStore.getState();
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
                        await addClipToNewTrack(newItem.id, snappedTime);
                        const track = useProjectStore
                          .getState()
                          .project.timeline.tracks.find(t =>
                            t.clips.some(c => c.mediaId === newItem.id)
                          );
                        if (track) {
                          toast.success(`Added to ${track.name}`, file.name);
                        }
                      }
                    }
                  } catch (err) {
                    console.error("[Timeline] External file drop failed:", err);
                  }
                }
                return;
              }

              // Internal drag from assets panel
              try {
                const rawData = e.dataTransfer.getData("application/json");
                if (!rawData) return;
                const data = JSON.parse(rawData);
                if (!data?.mediaId) return;
                handleDropMedia("", data.mediaId, snappedTime);
              } catch {
                // ignore
              }
            }}
          >
            <div
              style={{ width: `${timelineDuration * pixelsPerSecond}px` }}
              className="min-w-full"
            >
              {visualOrderTracks.map((track) => (
                <TrackLane
                  key={track.id}
                  track={track}
                  allTracks={visualOrderTracks}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedClipIds={selectedClipIds}
                  textClips={getTextClipsForTrack(track.id)}
                  shapeClips={getShapeClipsForTrack(track.id)}
                  trackHeights={trackHeightsMap}
                  timelineRef={tracksRef}
                  onSelectClip={handleSelectClip}
                  onDropMedia={handleDropMedia}
                  onMoveClip={handleMoveClip}
                  onSnapIndicator={handleSnapIndicator}
                  onTrimClip={
                    track.type === "video" ||
                    track.type === "image" ||
                    track.type === "audio"
                      ? handleTrimClip
                      : undefined
                  }
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                  onKeyframeSelect={handleKeyframeSelect}
                  onKeyframeMove={handleKeyframeMove}
                  onKeyframeDelete={handleKeyframeDelete}
                  selectedKeyframeIds={selectedKeyframeIds}
                />
              ))}

              <BeatMarkerOverlay
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                viewportWidth={viewportWidth}
                totalHeight={totalTracksHeight}
              />

              {project.timeline.markers.map((marker) => (
                <MarkerIndicator
                  key={marker.id}
                  marker={marker}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollX={scrollX}
                  onSeek={(time) => {
                    const bridge = getPlaybackBridge();
                    bridge.scrubTo(time);
                  }}
                  onRemove={removeMarker}
                  onUpdate={updateMarker}
                />
              ))}

              {snapIndicatorTime !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-yellow-400 z-30 pointer-events-none"
                  style={{ left: `${snapIndicatorTime * pixelsPerSecond}px` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-400 rounded-full" />
                </div>
              )}

              {isBoxSelecting && selectionBox && (
                <div
                  className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-40"
                  style={{
                    left:
                      Math.min(selectionBox.startX, selectionBox.currentX) -
                      scrollX,
                    top:
                      Math.min(selectionBox.startY, selectionBox.currentY) -
                      scrollY,
                    width: Math.abs(
                      selectionBox.currentX - selectionBox.startX,
                    ),
                    height: Math.abs(
                      selectionBox.currentY - selectionBox.startY,
                    ),
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <Playhead
          position={playheadPosition}
          pixelsPerSecond={pixelsPerSecond}
          scrollX={scrollX}
          headerOffset={128}
        />
      </div>
    </div>
  );
};

export default Timeline;
