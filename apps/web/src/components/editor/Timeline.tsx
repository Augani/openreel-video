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
  X,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import { getPlaybackBridge } from "../../bridges/playback-bridge";
import { IconButton } from "@openreel/ui";
import {
  Playhead,
  TimeRuler,
  TrackHeader,
  TrackLane,
  SubtitleTrackLane,
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
    addClip,
    addTrack,
    reorderTrack,
    deleteShapeClip,
    deleteSVGClip,
    deleteTextClip,
    removeMarker,
    updateMarker,
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
    setTrackHeightById,
    getTrackHeight,
  } = useTimelineStore();

  const [showLayersPanel, setShowLayersPanel] = useState(false);

  const { select, selectMultiple, clearSelection, getSelectedClipIds } =
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

  const [selectedSubtitleIds, setSelectedSubtitleIds] = React.useState<
    string[]
  >([]);
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

  const totalTracksHeight = useMemo(() => {
    let height = 0;
    for (const track of tracks) {
      height += getTrackHeight(track.id);
    }
    height += 40;
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

  const handleBackgroundClick = useCallback(() => {
    clearSelection();
    setSelectedSubtitleIds([]);
  }, [clearSelection]);

  const handleSelectSubtitle = useCallback(
    (subtitleId: string, addToSelection: boolean) => {
      setSelectedSubtitleIds((prev) =>
        addToSelection
          ? prev.includes(subtitleId)
            ? prev.filter((id) => id !== subtitleId)
            : [...prev, subtitleId]
          : [subtitleId],
      );
      select({ id: subtitleId, type: "subtitle" }, addToSelection);
    },
    [select],
  );

  const { addSubtitle } = useProjectStore();
  const handleAddSubtitle = useCallback(
    (startTime: number) => {
      addSubtitle({
        id: `subtitle-${Date.now()}`,
        text: "New subtitle",
        startTime,
        endTime: startTime + 2,
        style: {
          fontFamily: "Inter",
          fontSize: 24,
          color: "#ffffff",
          backgroundColor: "transparent",
          position: "bottom",
        },
      });
    },
    [addSubtitle],
  );

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
    const selectedItems: { type: "clip"; id: string; trackId: string }[] = [];

    // Iterate through tracks to find which are overlapped by selection box
    for (const track of tracks) {
      const trackH = getTrackHeight(track.id);
      const trackMinY = currentY;
      const trackMaxY = currentY + trackH;

      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      // Check if selection box vertically overlaps this track
      const trackOverlaps = minY < trackMaxY && maxY > trackMinY;

      if (trackOverlaps) {
        for (const clip of track.clips) {
          const clipStart = clip.startTime;
          const clipEnd = clip.startTime + clip.duration;

          // Check if selection box time range overlaps clip time range
          const clipOverlaps = minTime < clipEnd && maxTime > clipStart;

          if (clipOverlaps) {
            selectedItems.push({
              type: "clip",
              id: clip.id,
              trackId: track.id,
            });
          }
        }
      }

      currentY += trackH;
    }

    if (selectedItems.length > 0) {
      selectMultiple(selectedItems);
    }

    setIsBoxSelecting(false);
    setSelectionBox(null);
  }, [
    isBoxSelecting,
    selectionBox,
    pixelsPerSecond,
    tracks,
    getTrackHeight,
    selectMultiple,
  ]);

  useEffect(() => {
    if (!isBoxSelecting) return;

    const handleMouseUp = () => handleBoxSelectionEnd();
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isBoxSelecting, handleBoxSelectionEnd]);

  const handleDropMedia = useCallback(
    async (trackId: string, mediaId: string, startTime: number) => {
      await addClip(trackId, mediaId, startTime);
    },
    [addClip],
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

  const textTracks = tracks.filter((t) => t.type === "text");
  const graphicsTracks = tracks.filter((t) => t.type === "graphics");
  const videoTracks = tracks.filter((t) => t.type === "video");
  const imageTracks = tracks.filter((t) => t.type === "image");
  const audioTracks = tracks.filter((t) => t.type === "audio");

  const visualOrderTracks = useMemo(
    () => [
      ...textTracks,
      ...graphicsTracks,
      ...videoTracks,
      ...imageTracks,
      ...audioTracks,
    ],
    [textTracks, graphicsTracks, videoTracks, imageTracks, audioTracks],
  );

  return (
    <div className="h-full bg-background border-t border-border flex flex-col">
      <div className="h-12 border-b border-border flex items-center justify-between px-4 bg-background-secondary">
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

          <div className="flex bg-background-tertiary rounded-lg p-1 border border-border">
            <IconButton
              icon={Film}
              onClick={() => addTrack("video")}
              title="Add Video Track"
            />
            <IconButton
              icon={Music}
              onClick={() => addTrack("audio")}
              title="Add Audio Track"
            />
            <IconButton
              icon={Image}
              onClick={() => addTrack("image")}
              title="Add Image Track"
            />
            <IconButton
              icon={Type}
              onClick={() => addTrack("text")}
              title="Add Text Track"
            />
            <IconButton
              icon={Shapes}
              onClick={() => addTrack("graphics")}
              title="Add Graphics Track"
            />
          </div>

          <div className="w-px h-6 bg-border mx-1" />

          <div className="relative">
            <button
              onClick={() => setShowLayersPanel(!showLayersPanel)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors ${
                showLayersPanel
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-background-elevated text-text-secondary hover:text-text-primary"
              }`}
              title="Manage track layers"
            >
              <Layers size={14} />
              <span className="text-[10px] font-medium">LAYERS</span>
            </button>
            {showLayersPanel && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-background-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background-tertiary">
                  <span className="text-xs font-medium text-text-primary">
                    Track Layers
                  </span>
                  <button
                    onClick={() => setShowLayersPanel(false)}
                    className="p-1 rounded hover:bg-background-elevated text-text-muted hover:text-text-primary"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="p-2 max-h-60 overflow-y-auto">
                  {tracks.length === 0 ? (
                    <p className="text-xs text-text-muted text-center py-4">
                      No tracks yet
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {tracks.map((track, index) => {
                        const info = getTrackInfo(track, index);
                        return (
                          <div
                            key={track.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-background-tertiary group"
                          >
                            <div
                              className={`w-6 h-6 rounded flex items-center justify-center ${info.bgLight}`}
                            >
                              <info.icon size={12} className={info.textColor} />
                            </div>
                            <span className="text-xs text-text-primary flex-1">
                              {track.name || info.label}
                            </span>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() =>
                                  index > 0 && reorderTrack(track.id, index - 1)
                                }
                                disabled={index === 0}
                                className="p-1 rounded hover:bg-background-elevated disabled:opacity-30"
                                title="Move up"
                              >
                                <ChevronUp size={10} />
                              </button>
                              <button
                                onClick={() =>
                                  index < tracks.length - 1 &&
                                  reorderTrack(track.id, index + 1)
                                }
                                disabled={index === tracks.length - 1}
                                className="p-1 rounded hover:bg-background-elevated disabled:opacity-30"
                                title="Move down"
                              >
                                <ChevronDown size={10} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="font-mono text-primary text-sm font-bold tracking-widest bg-background-tertiary px-3 py-1 rounded border border-primary/20 shadow-[0_0_10px_rgba(34,197,94,0.1)]">
          {formatTimecode(playheadPosition)}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-text-secondary bg-background-tertiary rounded-lg px-2 py-1 border border-border">
            <button onClick={zoomOut} className="hover:text-text-primary px-1">
              -
            </button>
            <span className="text-xs w-12 text-center font-mono">
              {Math.round(pixelsPerSecond)}px/s
            </span>
            <button onClick={zoomIn} className="hover:text-text-primary px-1">
              +
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
          <div className="w-24 h-8 bg-background-tertiary border-b border-r border-border shrink-0" />
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
          <div className="w-24 bg-background-secondary border-r border-border shrink-0 z-20 shadow-lg overflow-hidden">
            <div
              className="flex flex-col"
              style={{ transform: `translateY(-${scrollY}px)` }}
            >
              {textTracks.map((track, i) => (
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
                  />
                </div>
              ))}
              {graphicsTracks.map((track, i) => (
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
                  />
                </div>
              ))}
              {videoTracks.map((track, i) => (
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
                  />
                </div>
              ))}
              {imageTracks.map((track, i) => (
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
                  />
                </div>
              ))}
              {audioTracks.map((track, i) => (
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
                  />
                </div>
              ))}
              <div className="h-10 px-2 flex items-center bg-purple-500/10 border-b border-border/50">
                <span className="text-[10px] font-bold text-purple-400">
                  Subtitles
                </span>
              </div>
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
          >
            <div
              style={{ width: `${timelineDuration * pixelsPerSecond}px` }}
              className="min-w-full"
            >
              {textTracks.map((track) => (
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
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                />
              ))}

              {graphicsTracks.map((track) => (
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
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                />
              ))}

              {videoTracks.map((track) => (
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
                  onTrimClip={handleTrimClip}
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                />
              ))}

              {imageTracks.map((track) => (
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
                  onTrimClip={handleTrimClip}
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                />
              ))}

              {audioTracks.map((track) => (
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
                  onTrimClip={handleTrimClip}
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={scrollX}
                  trackHeight={getTrackHeight(track.id)}
                  onResizeTrack={setTrackHeightById}
                />
              ))}

              <SubtitleTrackLane
                subtitles={project.timeline.subtitles}
                pixelsPerSecond={pixelsPerSecond}
                selectedSubtitleIds={selectedSubtitleIds}
                onSelectSubtitle={handleSelectSubtitle}
                onAddSubtitle={handleAddSubtitle}
                scrollX={scrollX}
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
          headerOffset={96}
        />
      </div>
    </div>
  );
};

export default Timeline;
