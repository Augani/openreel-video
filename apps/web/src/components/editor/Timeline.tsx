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
  Minimize2,
  Film,
  Music,
  Image,
  Type,
  Shapes,
  Scissors,
  Copy,
  Delete,
  CornerDownLeft,
  CornerDownRight,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  ChevronDown as ChevronDownIcon,
  Magnet,
  Rows3,
  Rows2,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Pencil,
} from "@/icons/lucide-compat";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  type ToolcraftDropdownMenuOption as DropdownMenuOption,
  ToolcraftPopover as Popover,
  ToolcraftText as Text,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore, ZOOM_PRESETS } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { useEngineStore } from "../../stores/engine-store";
import { getPlaybackBridge } from "../../bridges/playback-bridge";
import {
  deleteTimelineItem,
  duplicateTimelineItem,
  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineMarqueeSelection,
  splitTimelineItem,
  trimTimelineItemToPlayhead,
} from "../../utils/timeline-item-actions";
import {
  Playhead,
  TimeRuler,
  TrackHeader,
  TrackLane,
  BeatMarkerOverlay,
  MarkerIndicator,
  getTrackInfo,
} from "./timeline/index";
import {
  filterTrackLayerEntries,
  type TrackLayerFilter,
} from "./timeline/track-layer-filter";
import { getTrackDragAutoScrollDelta } from "./timeline/track-drag-auto-scroll";

const TRACK_LAYER_FILTERS: readonly {
  id: TrackLayerFilter;
  label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
  { id: "audio", label: "Audio" },
  { id: "text", label: "Text" },
  { id: "graphics", label: "Graphics" },
];

const ADD_TRACK_ROW_HEIGHT = 36;
const TIMELINE_SCROLLBAR_SIZE = 10;

export const Timeline: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const suppressNextBackgroundClickRef = useRef(false);
  const trackDragPointerYRef = useRef<number | null>(null);
  const trackDragAutoScrollFrameRef = useRef<number | null>(null);

  const {
    project,
    undo,
    redo,
    canUndo,
    canRedo,
    addTrack,
    duplicateTrack,
    reorderTrack,
    removeMarker,
    updateMarker,
    updateClipKeyframes,
    rippleDeleteClip,
    hideTrack,
    lockTrack,
    muteTrack,
    soloTrack,
    renameTrack,
    removeTrack,
  } = useProjectStore();
  const tracks = project.timeline.tracks;

  const [draggedTrackId, setDraggedTrackId] = React.useState<string | null>(
    null,
  );

  const stopTrackDrag = useCallback(() => {
    if (trackDragAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
      trackDragAutoScrollFrameRef.current = null;
    }
    trackDragPointerYRef.current = null;
    setDraggedTrackId(null);
  }, []);

  const startTrackDragAutoScroll = useCallback(() => {
    if (trackDragAutoScrollFrameRef.current !== null) {
      cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
    }

    const scrollFrame = () => {
      const viewport = tracksRef.current;
      const pointerY = trackDragPointerYRef.current;

      if (viewport && pointerY !== null) {
        const rect = viewport.getBoundingClientRect();
        const maxScrollTop = Math.max(
          0,
          viewport.scrollHeight - viewport.clientHeight,
        );
        const delta = getTrackDragAutoScrollDelta(
          pointerY,
          rect.top,
          rect.bottom,
          viewport.scrollTop,
          maxScrollTop,
        );

        if (delta !== 0) {
          viewport.scrollTop = Math.max(
            0,
            Math.min(maxScrollTop, viewport.scrollTop + delta),
          );
        }
      }

      trackDragAutoScrollFrameRef.current = requestAnimationFrame(scrollFrame);
    };

    trackDragAutoScrollFrameRef.current = requestAnimationFrame(scrollFrame);
  }, []);

  useEffect(
    () => () => {
      if (trackDragAutoScrollFrameRef.current !== null) {
        cancelAnimationFrame(trackDragAutoScrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!draggedTrackId) return;

    const trackPointerAcrossEditor = (event: DragEvent) => {
      trackDragPointerYRef.current = event.clientY;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    };

    // Capture the native drag event before child controls or the context-menu
    // wrapper can consume it. This makes the entire header column participate
    // in edge scrolling, including gaps exposed as the list moves underneath
    // a stationary pointer.
    window.addEventListener("dragover", trackPointerAcrossEditor, true);
    return () => {
      window.removeEventListener("dragover", trackPointerAcrossEditor, true);
    };
  }, [draggedTrackId]);

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
    setZoom,
    trackHeight,
    setTrackHeight,
    setTrackHeightById,
    getTrackHeight,
  } = useTimelineStore();

  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [trackLayerQuery, setTrackLayerQuery] = useState("");
  const [trackLayerFilter, setTrackLayerFilter] =
    useState<TrackLayerFilter>("all");
  const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
  const [trackNameDraft, setTrackNameDraft] = useState("");
  const [pendingTrackDeleteId, setPendingTrackDeleteId] = useState<string | null>(
    null,
  );

  const startTrackRename = useCallback((trackId: string, name: string) => {
    setRenamingTrackId(trackId);
    setTrackNameDraft(name);
  }, []);

  const finishTrackRename = useCallback(
    (commit: boolean) => {
      if (commit && renamingTrackId && trackNameDraft.trim()) {
        void renameTrack(renamingTrackId, trackNameDraft.trim());
      }
      setRenamingTrackId(null);
      setTrackNameDraft("");
    },
    [renameTrack, renamingTrackId, trackNameDraft],
  );
  const pendingTrackDelete = tracks.find(
    (track) => track.id === pendingTrackDeleteId,
  );
  const filteredTrackEntries = useMemo(
    () => filterTrackLayerEntries(tracks, trackLayerQuery, trackLayerFilter),
    [trackLayerFilter, trackLayerQuery, tracks],
  );

  const {
    select,
    selectMultiple,
    clearSelection,
    getSelectedClipIds,
    selectedItems,
    snapSettings,
    toggleSnap,
    timelineMaximized,
    toggleTimelineMaximized,
  } = useUIStore();
  const selectedClipIds = getSelectedClipIds();
  const splittableSelectedClipIds = useMemo(
    () =>
      getSplittableTimelineItemIds(project, selectedClipIds, playheadPosition),
    [playheadPosition, project, selectedClipIds],
  );
  const selectedMediaClipIds = useMemo(
    () =>
      selectedClipIds.filter((clipId) =>
        tracks.some((track) => track.clips.some((clip) => clip.id === clipId)),
      ),
    [selectedClipIds, tracks],
  );
  const canRippleDelete =
    selectedMediaClipIds.length > 0 &&
    selectedMediaClipIds.length === selectedClipIds.length;

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
    additive: boolean;
  } | null>(null);

  const timelineDuration = useMemo(() => {
    let maxEnd = 0;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    for (const clip of [...allTextClips, ...allShapeClips]) {
      maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
    }
    return Math.max(maxEnd, 60); // Minimum 60 seconds
  }, [tracks, allTextClips, allShapeClips]);

  const playheadSnapPoints = useMemo(() => {
    const points = new Set<number>();
    for (const track of tracks) {
      for (const clip of track.clips) {
        points.add(clip.startTime);
        points.add(clip.startTime + clip.duration);
      }
    }
    for (const clip of [...allTextClips, ...allShapeClips]) {
      points.add(clip.startTime);
      points.add(clip.startTime + clip.duration);
    }
    return Array.from(points).sort((a, b) => a - b);
  }, [tracks, allTextClips, allShapeClips]);

  const totalTracksHeight = useMemo(() => {
    let height = 0;
    for (const track of tracks) {
      height += getTrackHeight(track.id, track.type);
    }
    return height;
  }, [tracks, getTrackHeight]);

  const trackHeightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) {
      map.set(track.id, getTrackHeight(track.id, track.type));
    }
    return map;
  }, [tracks, getTrackHeight]);

  useEffect(() => {
    const el = tracksRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const { pixelsPerSecond: pps, setZoom: applyZoom } =
          useTimelineStore.getState();
        const timeAtCursor = (pointerX + el.scrollLeft) / pps;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.max(
          ZOOM_PRESETS.MIN,
          Math.min(ZOOM_PRESETS.MAX, pps * factor),
        );
        if (next === pps) return;
        applyZoom(next);
        requestAnimationFrame(() => {
          el.scrollLeft = Math.max(0, timeAtCursor * next - pointerX);
        });
      } else if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handleTrackDragStart = useCallback(
    (e: React.DragEvent, trackId: string) => {
      e.dataTransfer.setData("trackId", trackId);
      e.dataTransfer.effectAllowed = "move";
      trackDragPointerYRef.current = e.clientY;
      setDraggedTrackId(trackId);
      startTrackDragAutoScroll();
    },
    [startTrackDragAutoScroll],
  );

  const handleTrackDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    trackDragPointerYRef.current = e.clientY;
  }, []);

  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, targetTrackId: string) => {
      e.preventDefault();
      const sourceTrackId = e.dataTransfer.getData("trackId");
      stopTrackDrag();

      if (sourceTrackId && sourceTrackId !== targetTrackId) {
        const targetIndex = tracks.findIndex((t) => t.id === targetTrackId);
        if (targetIndex !== -1) {
          await reorderTrack(sourceTrackId, targetIndex);
        }
      }
    },
    [tracks, reorderTrack, stopTrackDrag],
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
    const el = tracksRef.current;
    if (!el) return;

    const playheadPixels = playheadPosition * pixelsPerSecond;
    // Keep the playhead in the left portion of the viewport during playback so
    // most of the upcoming timeline stays visible. When it crosses near the
    // right edge (or jumps out of view via a seek/loop), page the view so the
    // playhead lands back near the left with the rest as lookahead — instead of
    // pinning it at the end on a long timeline.
    const leftMargin = Math.min(Math.max(viewportWidth * 0.12, 60), 220);
    const followThreshold = scrollX + viewportWidth - leftMargin;

    if (playheadPixels > followThreshold || playheadPixels < scrollX) {
      el.scrollLeft = Math.max(0, playheadPixels - leftMargin);
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

  const handleSelectTransition = useCallback(
    (transitionId: string, trackId: string) => {
      select({ type: "transition", id: transitionId, trackId });
    },
    [select],
  );

  const selectedTransitionId =
    selectedItems.find((item) => item.type === "transition")?.id ?? null;

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
    const store = useProjectStore.getState();
    for (const clipId of splittableSelectedClipIds) {
      await splitTimelineItem(
        store,
        clipId,
        playheadPosition,
      );
    }
  }, [playheadPosition, splittableSelectedClipIds]);

  const handleDelete = useCallback(async () => {
    if (selectedClipIds.length === 0) return;

    const store = useProjectStore.getState();
    for (const id of selectedClipIds) {
      await deleteTimelineItem(store, id);
    }
    clearSelection();
  }, [selectedClipIds, clearSelection]);

  const handleDuplicate = useCallback(async () => {
    if (selectedClipIds.length === 0) return;

    const store = useProjectStore.getState();
    for (const id of selectedClipIds) {
      await duplicateTimelineItem(store, id);
    }
  }, [selectedClipIds]);

  const handleRippleDelete = useCallback(async () => {
    if (!canRippleDelete) return;
    for (const id of selectedMediaClipIds) {
      await rippleDeleteClip(id);
    }
    clearSelection();
  }, [canRippleDelete, clearSelection, rippleDeleteClip, selectedMediaClipIds]);

  const handleTrimToPlayhead = useCallback(
    async (trimStart: boolean) => {
      const store = useProjectStore.getState();
      for (const id of splittableSelectedClipIds) {
        await trimTimelineItemToPlayhead(
          store,
          id,
          playheadPosition,
          trimStart,
        );
      }
    },
    [playheadPosition, splittableSelectedClipIds],
  );

  const handleBackgroundClick = useCallback(() => {
    if (suppressNextBackgroundClickRef.current) {
      suppressNextBackgroundClickRef.current = false;
      return;
    }
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
        additive: e.shiftKey || e.metaKey || e.ctrlKey,
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
    const isMarqueeGesture =
      Math.abs(selectionBox.currentX - selectionBox.startX) > 3 ||
      Math.abs(selectionBox.currentY - selectionBox.startY) > 3;
    if (isMarqueeGesture) {
      suppressNextBackgroundClickRef.current = true;
    }

    const marqueeItems = getTimelineMarqueeSelection(
      project,
      {
        minTime,
        maxTime,
        minY: Math.min(selectionBox.startY, selectionBox.currentY),
        maxY: Math.max(selectionBox.startY, selectionBox.currentY),
      },
      getTrackHeight,
    );

    if (selectionBox.additive) {
      const merged = [...selectedItems];
      for (const item of marqueeItems) {
        if (!merged.some((selected) => selected.id === item.id)) {
          merged.push(item);
        }
      }
      selectMultiple(merged);
    } else if (marqueeItems.length > 0) {
      selectMultiple(marqueeItems);
    } else {
      clearSelection();
    }

    setIsBoxSelecting(false);
    setSelectionBox(null);
  }, [
    isBoxSelecting,
    selectionBox,
    pixelsPerSecond,
    project,
    getTrackHeight,
    selectMultiple,
    selectedItems,
    clearSelection,
  ]);

  useEffect(() => {
    if (!isBoxSelecting) return;

    const handleMouseUp = () => handleBoxSelectionEnd();
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isBoxSelecting, handleBoxSelectionEnd]);

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
      const store = useProjectStore.getState();
      const isGraphic = Boolean(
        store.getShapeClip(clipId) ||
          store.getSVGClip(clipId) ||
          store.getStickerClip(clipId),
      );
      if (isGraphic) {
        store.updateOverlayClipTiming(clipId, {
          startTime: newStartTime,
        });
      } else {
        await moveClip(clipId, newStartTime, targetTrackId);
      }
    },
    [moveClip],
  );

  const [snapIndicatorTime, setSnapIndicatorTime] = React.useState<
    number | null
  >(null);

  const handleSnapIndicator = useCallback((time: number | null) => {
    setSnapIndicatorTime(time);
  }, []);

  const handleTrimTextClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      const store = useProjectStore.getState();
      const textClip = store.getTextClip(clipId);
      if (!textClip) return;
      const newDuration =
        edge === "left"
          ? Math.max(0.1, textClip.startTime + textClip.duration - newTime)
          : Math.max(0.1, newTime - textClip.startTime);
      store.updateOverlayClipTiming(clipId, {
        ...(edge === "left" ? { startTime: newTime } : {}),
        duration: newDuration,
      });
    },
    [],
  );

  const handleMoveTextClip = useCallback(
    (clipId: string, newStartTime: number) => {
      useProjectStore.getState().updateOverlayClipTiming(clipId, {
        startTime: Math.max(0, newStartTime),
      });
    },
    [],
  );

  const handleTrimShapeClip = useCallback(
    (clipId: string, edge: "left" | "right", newTime: number) => {
      const store = useProjectStore.getState();
      const graphicClip =
        store.getShapeClip(clipId) ||
        store.getSVGClip(clipId) ||
        store.getStickerClip(clipId);
      if (!graphicClip) return;
      const newDuration =
        edge === "left"
          ? Math.max(
              0.1,
              graphicClip.startTime + graphicClip.duration - newTime,
            )
          : Math.max(0.1, newTime - graphicClip.startTime);

      store.updateOverlayClipTiming(clipId, {
        ...(edge === "left" ? { startTime: newTime } : {}),
        duration: newDuration,
      });
    },
    [],
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
  const addTrackItems: DropdownMenuOption[] = useMemo(
    () => [
      {
        label: "Video Track",
        icon: <Film size={16} className="text-clip-video" aria-hidden />,
        onClick: () => addTrack("video"),
      },
      {
        label: "Audio Track",
        icon: <Music size={16} className="text-clip-audio" aria-hidden />,
        onClick: () => addTrack("audio"),
      },
      { type: "divider" },
      {
        label: "Image Track",
        icon: <Image size={16} className="text-clip-music" aria-hidden />,
        onClick: () => addTrack("image"),
      },
      {
        label: "Text Track",
        icon: <Type size={16} className="text-clip-text" aria-hidden />,
        onClick: () => addTrack("text"),
      },
      {
        label: "Graphics Track",
        icon: <Shapes size={16} className="text-clip-music" aria-hidden />,
        onClick: () => addTrack("graphics"),
      },
    ],
    [addTrack],
  );

  // Small, mockup-styled timeline tool button
  const TLTool = ({
    onClick,
    disabled,
    active,
    title,
    children,
    extra,
  }: {
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    title?: string;
    children: React.ReactNode;
    extra?: React.ReactNode;
  }) => (
    <button
      type="button"
      aria-label={title ?? "Timeline tool"}
      onClick={onClick}
      disabled={disabled}
      data-tip-bottom={title}
      className={`relative grid place-items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? "text-accent" : "text-fg-muted hover:text-fg-2"
      }`}
    >
      {children}
      {extra}
    </button>
  );

  return (
    <div
      data-tour="timeline"
      className="h-full bg-tl-bg flex flex-col min-h-0 relative overflow-hidden"
    >
      {/* ── Timeline toolbar (mock: 48px line-icon tools + emerald zoom slider) ── */}
      <div className="flex items-center h-12 px-4 gap-4 bg-bg-1 border-b border-border shrink-0 relative z-50">
        <TLTool onClick={undo} disabled={!canUndo()} title="Undo (⌘Z)">
          <Undo2 size={16} aria-hidden />
        </TLTool>
        <TLTool onClick={redo} disabled={!canRedo()} title="Redo (⇧⌘Z)">
          <Redo2 size={16} aria-hidden />
        </TLTool>

        <div className="w-px h-[18px] bg-border" />

        <TLTool
          onClick={handleSplit}
          disabled={splittableSelectedClipIds.length === 0}
          title="Split (S)"
        >
          <Scissors size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={() => handleTrimToPlayhead(true)}
          disabled={splittableSelectedClipIds.length === 0}
          title="Trim start to playhead (Q)"
        >
          <CornerDownLeft size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={() => handleTrimToPlayhead(false)}
          disabled={splittableSelectedClipIds.length === 0}
          title="Trim end to playhead (W)"
        >
          <CornerDownRight size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={handleDelete}
          disabled={selectedClipIds.length === 0}
          title="Delete (Del)"
        >
          <Trash2 size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={handleDuplicate}
          disabled={selectedClipIds.length === 0}
          title="Duplicate (⌘D)"
        >
          <Copy size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={handleRippleDelete}
          disabled={!canRippleDelete}
          title="Ripple delete (⇧Del)"
        >
          <Delete size={16} aria-hidden />
        </TLTool>

        <div className="w-px h-[18px] bg-border" />

        <DropdownMenu
          items={addTrackItems}
          placement="above"
          menuWidth={192}
          hasChevron
          button={{
            label: "Add track",
            size: "sm",
            variant: "ghost",
            icon: <Plus size={16} aria-hidden />,
            endContent: (
              <ChevronDownIcon size={9} className="text-fg-muted" aria-hidden />
            ),
          }}
        />

        <Popover
          isOpen={showLayersPanel}
          onOpenChange={(open) => {
            setShowLayersPanel(open);
            if (!open) {
              finishTrackRename(false);
              setPendingTrackDeleteId(null);
            }
          }}
          placement="above"
          alignment="start"
          width={340}
          label="Track layers"
          content={
            <>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-bg-2">
                <span className="text-xs font-semibold text-fg">Track Layers</span>
                <span className="text-[10px] tabular-nums text-fg-3">
                  {filteredTrackEntries.length}/{tracks.length}
                </span>
              </div>
              {pendingTrackDelete ? (
                <div
                  role="alertdialog"
                  aria-label={`Delete ${pendingTrackDelete.name}`}
                  className="border-b border-danger/30 bg-danger/10 px-3 py-2.5"
                >
                  <p className="text-[11px] font-semibold text-danger">
                    Delete “{pendingTrackDelete.name}”?
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-fg-3">
                    Its clips will be removed. You can undo this action.
                  </p>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPendingTrackDeleteId(null)}
                      className="h-7 rounded-md border border-border bg-bg-1 px-2.5 text-[10px] font-semibold text-fg-2 hover:bg-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void removeTrack(pendingTrackDelete.id);
                        setPendingTrackDeleteId(null);
                      }}
                      className="h-7 rounded-md bg-danger px-2.5 text-[10px] font-semibold text-white hover:opacity-90"
                    >
                      Delete track
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 border-b border-border px-3 py-2.5">
                <input
                  type="search"
                  value={trackLayerQuery}
                  onChange={(event) => setTrackLayerQuery(event.currentTarget.value)}
                  placeholder="Search tracks"
                  aria-label="Search track layers"
                  className="h-8 w-full rounded-md border border-border bg-bg-1 px-2.5 text-[11px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
                />
                <div
                  className="flex gap-1 overflow-x-auto pb-0.5"
                  role="group"
                  aria-label="Track layer types"
                >
                  {TRACK_LAYER_FILTERS.map((filter) => {
                    const count =
                      filter.id === "all"
                        ? tracks.length
                        : tracks.filter((track) => track.type === filter.id).length;
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={trackLayerFilter === filter.id}
                        onClick={() => setTrackLayerFilter(filter.id)}
                        className={`h-6 shrink-0 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
                          trackLayerFilter === filter.id
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-border bg-bg-2 text-fg-3 hover:border-accent/50 hover:text-fg"
                        }`}
                      >
                        {filter.label} {count}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="p-2 max-h-60 overflow-y-auto">
                {tracks.length === 0 ? (
                  <Text type="supporting" color="secondary" className="text-xs text-fg-muted text-center py-6">
                    No tracks yet
                  </Text>
                ) : filteredTrackEntries.length === 0 ? (
                  <Text
                    type="supporting"
                    color="secondary"
                    className="block py-6 text-center text-xs text-fg-muted"
                  >
                    No tracks match your filters
                  </Text>
                ) : (
                  <div className="space-y-0.5">
                    {filteredTrackEntries.map(({ track, index }) => {
                      const info = getTrackInfo(track, index);
                      const name = track.name || info.label;
                      const isVisual =
                        track.type === "video" ||
                        track.type === "image" ||
                        track.type === "text" ||
                        track.type === "graphics";
                      return (
                        <div
                          key={track.id}
                          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-hover group transition-colors cursor-default"
                        >
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center ${info.bgLight}`}
                          >
                            <info.icon size={14} className={info.textColor} aria-hidden />
                          </div>
                          {renamingTrackId === track.id ? (
                            <input
                              autoFocus
                              aria-label={`Rename ${name}`}
                              value={trackNameDraft}
                              onChange={(event) =>
                                setTrackNameDraft(event.currentTarget.value)
                              }
                              onBlur={() => finishTrackRename(true)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  finishTrackRename(true);
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  finishTrackRename(false);
                                }
                              }}
                              className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-bg-1 px-2 text-[11px] font-medium text-fg outline-none"
                            />
                          ) : (
                            <span
                              className="flex-1 truncate text-[11px] font-medium text-fg"
                              onDoubleClick={() => startTrackRename(track.id, name)}
                            >
                              {name}
                            </span>
                          )}
                          <div className="flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <IconButton
                              label={`Rename ${name}`}
                              icon={<Pencil size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() => startTrackRename(track.id, name)}
                            />
                            {track.type !== "text" &&
                            track.type !== "graphics" ? (
                              <IconButton
                                label={`Duplicate ${name}`}
                                icon={<Copy size={12} aria-hidden />}
                                size="sm"
                                variant="ghost"
                                onClick={() => void duplicateTrack(track.id)}
                              />
                            ) : null}
                            <IconButton
                              label={`Delete ${name}`}
                              icon={<Trash2 size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() => setPendingTrackDeleteId(track.id)}
                            />
                            {isVisual ? (
                              <IconButton
                                label={`Hide ${name}`}
                                icon={
                                  track.hidden ? (
                                    <EyeOff size={12} aria-hidden />
                                  ) : (
                                    <Eye size={12} aria-hidden />
                                  )
                                }
                                size="sm"
                                variant={track.hidden ? "secondary" : "ghost"}
                                aria-pressed={track.hidden}
                                onClick={() => void hideTrack(track.id, !track.hidden)}
                              />
                            ) : null}
                            {track.type === "audio" ? (
                              <>
                                <IconButton
                                  label={`Mute ${name}`}
                                  icon={
                                    track.muted ? (
                                      <VolumeX size={12} aria-hidden />
                                    ) : (
                                      <Volume2 size={12} aria-hidden />
                                    )
                                  }
                                  size="sm"
                                  variant={track.muted ? "secondary" : "ghost"}
                                  aria-pressed={track.muted}
                                  onClick={() => void muteTrack(track.id, !track.muted)}
                                />
                                <button
                                  type="button"
                                  aria-label={`Solo ${name}`}
                                  aria-pressed={track.solo}
                                  onClick={() => void soloTrack(track.id, !track.solo)}
                                  className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[10px] font-black transition-colors ${
                                    track.solo
                                      ? "bg-status-warning text-black"
                                      : "text-fg-muted hover:bg-hover hover:text-fg"
                                  }`}
                                >
                                  S
                                </button>
                              </>
                            ) : null}
                            <IconButton
                              label={`Lock ${name}`}
                              icon={
                                track.locked ? (
                                  <Unlock size={12} aria-hidden />
                                ) : (
                                  <Lock size={12} aria-hidden />
                                )
                              }
                              size="sm"
                              variant={track.locked ? "secondary" : "ghost"}
                              aria-pressed={track.locked}
                              onClick={() => void lockTrack(track.id, !track.locked)}
                            />
                            <IconButton
                              label={`Move ${name} up`}
                              icon={<ChevronUp size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                index > 0 && reorderTrack(track.id, index - 1)
                              }
                              isDisabled={index === 0}
                            />
                            <IconButton
                              label={`Move ${name} down`}
                              icon={<ChevronDown size={12} aria-hidden />}
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                index < tracks.length - 1 &&
                                reorderTrack(track.id, index + 1)
                              }
                              isDisabled={index === tracks.length - 1}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          }
        >
          <IconButton
            label="Manage track layers"
            icon={<Layers size={16} aria-hidden />}
            size="sm"
            variant={showLayersPanel ? "secondary" : "ghost"}
            data-tip-bottom="Track layers"
          />
        </Popover>

        <div className="ml-auto flex items-center gap-3">
          {/* Zoom control (mock: minus / emerald slider track + knob / plus) */}
          <div className="flex items-center gap-2.5">
            <TLTool onClick={zoomOut} title="Zoom out">
              <ZoomOut size={16} aria-hidden />
            </TLTool>
            <div className="relative h-5 w-[150px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-bg-2"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      ((pixelsPerSecond - ZOOM_PRESETS.MIN) /
                        (ZOOM_PRESETS.MAX - ZOOM_PRESETS.MIN)) *
                        100,
                    ),
                  )}%`,
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-sm"
                style={{
                  left: `${Math.max(
                    0,
                    Math.min(
                      100,
                      ((pixelsPerSecond - ZOOM_PRESETS.MIN) /
                        (ZOOM_PRESETS.MAX - ZOOM_PRESETS.MIN)) *
                        100,
                    ),
                  )}%`,
                }}
              />
              <input
                type="range"
                aria-label="Timeline zoom"
                aria-valuetext={`${Math.round(pixelsPerSecond)} pixels per second`}
                min={ZOOM_PRESETS.MIN}
                max={ZOOM_PRESETS.MAX}
                step={1}
                value={pixelsPerSecond}
                onChange={(event) => setZoom(Number(event.currentTarget.value))}
                className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
              />
            </div>
            <TLTool onClick={zoomIn} title="Zoom in">
              <ZoomIn size={16} aria-hidden />
            </TLTool>
          </div>

          <div className="w-px h-[18px] bg-border" />

          <div className="flex items-center gap-1">
            <TLTool
              onClick={toggleSnap}
              active={snapSettings.enabled}
              title={snapSettings.enabled ? "Snap on (N)" : "Snap off (N)"}
            >
              <Magnet size={16} />
            </TLTool>

            <TLTool
              onClick={() => {
                setTrackHeight(64);
                useTimelineStore.setState({ trackHeights: {} });
              }}
              active={trackHeight >= 52}
              title="Large tracks"
            >
              <Rows3 size={16} />
            </TLTool>
            <TLTool
              onClick={() => {
                setTrackHeight(40);
                useTimelineStore.setState({ trackHeights: {} });
              }}
              active={trackHeight < 52}
              title="Compact tracks"
            >
              <Rows2 size={16} />
            </TLTool>

            <TLTool
              onClick={toggleTimelineMaximized}
              active={timelineMaximized}
              title={
                timelineMaximized
                  ? "Restore layout"
                  : "Maximize timeline (more room)"
              }
            >
              {timelineMaximized ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </TLTool>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-hidden relative"
        onClick={handleBackgroundClick}
      >
        <div className="flex shrink-0">
          <div className="w-[170px] h-[34px] bg-bg-1 border-b border-r border-border shrink-0" />
          <div className="flex-1 overflow-hidden relative bg-bg-1 border-b border-border">
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
          <div
            ref={trackHeadersRef}
            data-testid="timeline-track-headers-scroll"
            className="w-[170px] bg-bg-1 border-r border-border shrink-0 z-20 overflow-y-auto overflow-x-hidden scrollbar-none overscroll-contain"
            onDragOverCapture={handleTrackDragOver}
            onScroll={(e) => {
              const nextScrollTop = e.currentTarget.scrollTop;
              const timeline = tracksRef.current;
              if (timeline && Math.abs(timeline.scrollTop - nextScrollTop) > 0.5) {
                timeline.scrollTop = nextScrollTop;
              }
              setScrollY(nextScrollTop);
            }}
          >
            <div className="flex flex-col">
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
                      onDragEnd={stopTrackDrag}
                      keyframeCount={keyframeCount}
                    />
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => addTrack("video")}
                className="mx-3 my-1 h-7 flex items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong text-fg-muted hover:text-fg-2 hover:border-fg-3 transition-colors"
                aria-label="Add track"
              >
                <Plus size={16} aria-hidden />
              </button>
              <div
                aria-hidden="true"
                style={{ height: TIMELINE_SCROLLBAR_SIZE }}
              />
            </div>
          </div>

          <div
            ref={tracksRef}
            data-testid="timeline-tracks-scroll"
            className="flex-1 bg-background relative overflow-auto custom-scrollbar"
            onScroll={(e) => {
              setScrollX(e.currentTarget.scrollLeft);
              const nextScrollTop = e.currentTarget.scrollTop;
              const headers = trackHeadersRef.current;
              if (headers && Math.abs(headers.scrollTop - nextScrollTop) > 0.5) {
                headers.scrollTop = nextScrollTop;
              }
              setScrollY(nextScrollTop);
            }}
            onMouseDown={handleBoxSelectionStart}
            onMouseMove={handleBoxSelectionMove}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedTrackId) {
                e.dataTransfer.dropEffect = "move";
                trackDragPointerYRef.current = e.clientY;
                return;
              }
              e.dataTransfer.dropEffect = "copy";
              const element = tracksRef.current;
              if (!element) return;
              const rect = element.getBoundingClientRect();
              const edgeSize = 56;
              const maxStep = 24;
              const horizontal =
                e.clientX < rect.left + edgeSize
                  ? -maxStep * (1 - (e.clientX - rect.left) / edgeSize)
                  : e.clientX > rect.right - edgeSize
                    ? maxStep * (1 - (rect.right - e.clientX) / edgeSize)
                    : 0;
              const vertical =
                e.clientY < rect.top + edgeSize
                  ? -maxStep * (1 - (e.clientY - rect.top) / edgeSize)
                  : e.clientY > rect.bottom - edgeSize
                    ? maxStep * (1 - (rect.bottom - e.clientY) / edgeSize)
                    : 0;
              if (horizontal || vertical) {
                element.scrollBy({ left: horizontal, top: vertical });
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();

              const rect = tracksRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left + (tracksRef.current?.scrollLeft ?? 0);
              const rawTime = Math.max(0, x / pixelsPerSecond);

              const allClips = getTimelineItemRanges(project);
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
                  trackHeight={getTrackHeight(track.id, track.type)}
                  onResizeTrack={setTrackHeightById}
                  onKeyframeSelect={handleKeyframeSelect}
                  onKeyframeMove={handleKeyframeMove}
                  onKeyframeDelete={handleKeyframeDelete}
                  selectedKeyframeIds={selectedKeyframeIds}
                  onSelectTransition={handleSelectTransition}
                  selectedTransitionId={selectedTransitionId}
                />
              ))}

              <div
                aria-hidden="true"
                style={{ height: ADD_TRACK_ROW_HEIGHT }}
              />

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
          headerOffset={170}
        />
      </div>
    </div>
  );
};

export default Timeline;
