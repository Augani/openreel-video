import { useTimelineToolGesture } from "./useTimelineToolGesture";
import { TimelineToolGhost } from "./TimelineToolGhost";
import React, { useRef, useCallback, useEffect, useState, useMemo } from "react";
import type {
  Clip,
  GraphicInstance,
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
import { getVisibleClips } from "./visible-clips";
import { computeLaneInfos, type ClipLaneInfo } from "./clip-lane-info";
import { TextClipComponent } from "./TextClipComponent";
import { ShapeClipComponent } from "./ShapeClipComponent";
import { GraphicClipComponent } from "./GraphicClipComponent";
import { KeyframeTrack } from "./KeyframeTrack";
import { TransitionHandle } from "./TransitionHandle";
import { AdjustmentLayerTimelineItem } from "./AdjustmentLayerTimelineItem";
import { resolveTransitionHandles } from "./transition-handles";
import { calculateSnap } from "./utils";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";
import { useEditPointStore } from "../../../stores/edit-point-store";
import { selectGapAt } from "../../../services/edit-point-commands";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";
import { dropSourceRange } from "../../../services/source-monitor-commands";
import { mediaDisplayDuration } from "@openreel/core";
import { phoneTrackLayout } from "../mobile/mobile-timeline-layout";
import { placeSequenceOnTimeline } from "../../../services/sequence-commands";

const CLIP_SCROLL_BUCKET = 96;
/** Must match the Timeline, which quantises the scroll position it hands to each lane. */
export const LANE_SCROLL_BUCKET = 256;
const HANDLE_MARGIN = 48;

type GraphicClipUnion = ShapeClip | SVGClip | StickerClip;

interface TrackLaneProps {
  track: Track;
  phone?: boolean;
  audioDivider?: boolean;
  phoneTrackScale?: number;
  trackTopInset?: number;
  allTracks: Track[];
  pixelsPerSecond: number;
  selectedClipIds: string[];
  textClips: TextClip[];
  shapeClips: GraphicClipUnion[];
  /** Essential Graphics on this lane: one bar each; their member layers are not in textClips/shapeClips. */
  graphics?: Array<{ instance: GraphicInstance; anchorId: string }>;
  trackHeights: Map<string, number>;
  rowHeights?: Map<string, number>;
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
  ) => void | Promise<void>;
  onTrimTextClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void | Promise<void>;
  onTrimShapeClip: (
    clipId: string,
    edge: "left" | "right",
    newTime: number,
  ) => void | Promise<void>;
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
  phone = false,
  audioDivider = false,
  phoneTrackScale = 1,
  trackTopInset = 0,
  allTracks,
  pixelsPerSecond,
  selectedClipIds,
  textClips,
  shapeClips,
  graphics,
  trackHeights,
  rowHeights,
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
  // Empty-space click selects the gap under it (Trim mode). Clips stop their
  // own mouse events, so a mousedown that reaches the lane is on empty space.
  const gapDownXRef = useRef<number | null>(null);
  const selectedGap = useEditPointStore((s) =>
    s.selection?.type === "gap" && s.selection.trackId === track.id
      ? `${s.selection.start}:${s.selection.end}`
      : "",
  );
  const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const downX = gapDownXRef.current;
    gapDownXRef.current = null;
    if (e.button !== 0 || e.target !== e.currentTarget || downX === null) return;
    if (Math.abs(e.clientX - downX) > 3) return;
    if (useEditorWorkspaceStore.getState().timelineTool !== "select") return;
    const rect = e.currentTarget.getBoundingClientRect();
    selectGapAt(track.id, (e.clientX - rect.left) / pixelsPerSecond);
  };
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
          (e.clientX - rect.left) / pixelsPerSecond,
        );
        const mediaLength = mediaDisplayDuration(mediaItem);
        const duration = mediaLength > 0 ? mediaLength : 5;
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
    [mediaItems, pixelsPerSecond, track.id],
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
        const x = e.clientX - rect.left;
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
          ((typeof data.mediaId !== "string" || !data.mediaId.trim()) &&
            (typeof data.sequenceId !== "string" || !data.sequenceId.trim()))
        ) {
          return;
        }

        const rect = laneRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left;
          const rawTime = Math.max(0, x / pixelsPerSecond);
          const snapResult = calculateSnap(
            rawTime,
            "",
            allTracks,
            useTimelineStore.getState().playheadPosition,
            snapSettings,
            pixelsPerSecond,
          );
          if (typeof data.sequenceId === "string") {
            // A sequence dragged from the Project panel is nested at the drop point.
            void placeSequenceOnTimeline(data.sequenceId, track.id, snapResult.time);
            return;
          }
          if (data.sourceMonitor === true) {
            // Dragged from the Source monitor: its marked range, one stream
            // or both, overwritten at the drop point.
            const component =
              data.component === "video" || data.component === "audio" ? data.component : "both";
            const outcome = dropSourceRange(data.mediaId, track.id, snapResult.time, component);
            if (!outcome.success) toast.warning("Source drop", outcome.message);
            return;
          }
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

  // Offscreen clips (and their waveform/filmstrip canvases) are not mounted:
  // a zoomed-out 400-clip project otherwise re-renders every clip per scroll.
  // `scrollX` arrives quantised to LANE_SCROLL_BUCKET by the Timeline (so the lane only re-renders when the
  // culled window can change); the window is widened by one bucket so it stays a superset of the real viewport.
  // The overscan shrinks by half a bucket per side in exchange, so the mounted width stays 2 x viewport.
  const cullViewportWidth = viewportWidth > 0 ? viewportWidth + LANE_SCROLL_BUCKET : viewportWidth;
  const cullOverscan = Math.max(0, viewportWidth / 2 - LANE_SCROLL_BUCKET / 2);
  const previousVisible = useRef<Clip[]>([]);
  const visibleClips = useMemo(() => {
    const overlayIds = new Set<string>();
    for (const tc of textClips) overlayIds.add(tc.id);
    for (const sc of shapeClips) overlayIds.add(sc.id);
    const media = overlayIds.size === 0
      ? track.clips
      : track.clips.filter((clip) => !overlayIds.has(clip.id));
    const next = getVisibleClips(media, scrollX, cullViewportWidth, pixelsPerSecond, selectedClipIds, cullOverscan);
    // Same clips as before: hand back the same array so everything derived from it (lane infos, props) is reused.
    const prev = previousVisible.current;
    return prev.length === next.length && next.every((clip, i) => clip === prev[i]) ? prev : next;
  }, [track.clips, textClips, shapeClips, scrollX, cullViewportWidth, cullOverscan, pixelsPerSecond, selectedClipIds]);
  previousVisible.current = visibleClips;

  // Clips only use the scroll position to cull thumbnails/waveform bars (120px lookahead).
  // Quantising it (and widening the viewport by the same amount) keeps that cull a superset
  // of the real viewport while letting memoised clips skip renders for most scroll ticks.
  const clipScrollX = Math.floor(scrollX / CLIP_SCROLL_BUCKET) * CLIP_SCROLL_BUCKET;
  const clipViewportWidth = Math.ceil(viewportWidth / CLIP_SCROLL_BUCKET) * CLIP_SCROLL_BUCKET + CLIP_SCROLL_BUCKET;

  // Cross-clip derived state (linked audio, J/L offsets, neighbour transitions, lane badge) is
  // folded into primitives once per commit, with identity preserved per clip when unchanged, so
  // a one-clip move re-renders O(changed) clips rather than every mounted clip.
  const laneInfoCache = useRef<{
    inputs: readonly unknown[];
    infos: ReadonlyMap<string, ClipLaneInfo>;
  }>({ inputs: [], infos: new Map() });
  const laneInfos = useMemo(() => {
    const inputs = [track, allTracks, frameRate, mediaItems] as const;
    const cached = laneInfoCache.current;
    const sameInputs = cached.inputs.length === inputs.length && inputs.every((x, i) => x === cached.inputs[i]);
    const mediaById = new Map(mediaItems.map((item) => [item.id, item] as const));
    const input = {
      track,
      allTracks,
      frameRate,
      mediaTypeOf: (clip: Clip) => (track.type === "audio" ? "audio" : mediaById.get(clip.mediaId)?.type ?? track.type),
    };
    // Scrolling changes only which clips are visible: reuse the infos of clips that were already computed for
    // the same tracks and compute just the ones that scrolled into view (each is an O(clips) partner search).
    const missing = sameInputs ? visibleClips.filter((clip) => !cached.infos.has(clip.id)) : visibleClips;
    const computed = computeLaneInfos(missing, input, sameInputs ? undefined : cached.infos);
    const next = new Map<string, ClipLaneInfo>();
    for (const clip of visibleClips) {
      const info = computed.get(clip.id) ?? cached.infos.get(clip.id);
      if (info) next.set(clip.id, info);
    }
    laneInfoCache.current = { inputs, infos: next };
    return next;
  }, [visibleClips, track, allTracks, frameRate, mediaItems]);

  // Gesture-time reads (drag snapping, target lane) get the latest tracks through a stable getter.
  const allTracksRef = useRef(allTracks);
  allTracksRef.current = allTracks;
  const getAllTracks = useCallback(() => allTracksRef.current, []);

  // Transition handles are virtualised like clips: a 1000-clip lane has ~1000 adjacent-pair handles, each a
  // Radix tooltip/popover tree, and only the ones near the viewport (or the selected one) need to exist.
  const previousHandles = useRef<typeof transitionHandles>([]);
  const visibleHandles = useMemo(() => {
    const overscan = cullOverscan;
    const from = scrollX - overscan - HANDLE_MARGIN;
    const to = scrollX + cullViewportWidth + overscan + HANDLE_MARGIN;
    const next = cullViewportWidth <= 0
      ? transitionHandles
      : transitionHandles.filter(
          (handle) =>
            (handle.centerX >= from && handle.centerX <= to) ||
            (selectedTransitionId !== null && handle.transition?.id === selectedTransitionId),
        );
    const prev = previousHandles.current;
    return prev.length === next.length && next.every((h, i) => h === prev[i]) ? prev : next;
  }, [transitionHandles, scrollX, cullViewportWidth, cullOverscan, selectedTransitionId]);
  previousHandles.current = visibleHandles;

  const selectedClipSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const toolGesture = useTimelineToolGesture(laneRef, pixelsPerSecond, onSelectClip);

  return (
    <div className="relative" data-phone-track={phone ? track.type : undefined} style={phone ? { height: trackHeight } : undefined}>
      <div
        ref={laneRef}
        data-track-lane={track.id}
        data-audio-divider={audioDivider ? "true" : undefined}
        {...toolGesture}
        style={{ height: phone ? phoneTrackLayout(track, phoneTrackScale).lane : trackHeight }}
        className={`border-b border-border/50 relative transition-colors ${
          isDragOver
            ? "bg-primary/10 border-primary/30"
            : "bg-background-secondary/20"
        }`}
        onMouseDown={(e) => { gapDownXRef.current = e.target === e.currentTarget ? e.clientX : null; }}
        onClick={handleLaneClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {selectedGap && (() => {
          const [start, end] = selectedGap.split(":").map(Number);
          return (
            <div
              data-gap-selected={track.id}
              aria-label="Selected gap"
              className="absolute top-0 bottom-0 z-10 pointer-events-none border-x border-amber-400 bg-amber-400/20"
              style={{ left: start * pixelsPerSecond, width: (end - start) * pixelsPerSecond }}
            />
          );
        })()}
        <TimelineToolGhost trackId={track.id} pixelsPerSecond={pixelsPerSecond} />
        {visibleClips
          .map((clip) => (
            <ClipComponent
              key={clip.id}
              clip={clip}
              track={track}
              getAllTracks={getAllTracks}
              laneInfo={laneInfos.get(clip.id)}
              pixelsPerSecond={pixelsPerSecond}
              scrollX={clipScrollX}
              viewportWidth={clipViewportWidth}
              isSelected={selectedClipSet.has(clip.id)}
              trackHeights={trackHeights}
              rowHeights={rowHeights}
              timelineRef={timelineRef}
              trackTopInset={trackTopInset}
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
              rowHeights={rowHeights}
            timelineRef={timelineRef}
            trackTopInset={trackTopInset}
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
              rowHeights={rowHeights}
            timelineRef={timelineRef}
            trackTopInset={trackTopInset}
          />
        ))}
        {graphics?.map(({ instance, anchorId }) => (
          <GraphicClipComponent
            key={instance.id}
            instance={instance}
            anchorId={anchorId}
            pixelsPerSecond={pixelsPerSecond}
            isSelected={selectedClipIds.includes(anchorId)}
            onSelect={onSelectClip}
            allTracks={allTracks}
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
        {visibleHandles.map((handle) => (
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
        <div className="absolute left-0 right-0" style={{ top: phone ? phoneTrackLayout(track, phoneTrackScale).row : trackHeight }}>
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
