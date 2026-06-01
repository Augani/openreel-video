import React, { useRef, useState, useEffect, useCallback } from "react";
import { Image } from "lucide-react";
import type { Clip, Track, TransitionType } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { calculateSnap, generateWaveformPath, getClipStyle } from "./utils";
import { ClipContextMenu } from "./ClipContextMenu";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { getTransitionBridge } from "../../../bridges/transition-bridge";
import type { VideoEffectType } from "../../../bridges/effects-bridge";
import {
  EFFECT_DRAG_MIME,
  TRANSITION_DRAG_MIME,
} from "../panels/EffectsTransitionsPanel";

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

const AUTO_SCROLL_THRESHOLD = 80;
const AUTO_SCROLL_SPEED = 10;
const DRAG_THRESHOLD = 5;

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
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const effectApplicationLabel = useUIStore(
    (state) => state.effectApplicationLabel,
  );
  const { playheadPosition } = useTimelineStore();
  const mediaItem = getMediaItem(clip.mediaId);
  const [isDragging, setIsDragging] = useState(false);
  const [isPendingDrag, setIsPendingDrag] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragYOffset, setDragYOffset] = useState(0);
  const [isInvalidDrop, setIsInvalidDrop] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimEdge, setTrimEdge] = useState<"left" | "right" | null>(null);
  // Snapshot of every additional selected clip at drag start. Multi-clip
  // drag applies the same time delta to each entry so they stay locked
  // together as the dragged clip moves.
  const multiDragSnapshotRef = useRef<
    Array<{ clipId: string; startTime: number; trackId: string }>
  >([]);
  const trimStartRef = useRef<{
    mouseX: number;
    startTime: number;
    duration: number;
  }>({
    mouseX: 0,
    startTime: clip.startTime,
    duration: clip.duration,
  });
  const dragStartRef = useRef<{ mouseY: number; clipY: number; scrollTop: number }>({
    mouseY: 0,
    clipY: 0,
    scrollTop: 0,
  });
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pendingDropRef = useRef<{ time: number; targetTrackId?: string }>({ time: 0 });
  const dragPendingRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0,
  });
  const clipRef = useRef<HTMLDivElement>(null);
  const moveCommitRafRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<(() => void) | null>(null);

  // Drag-drop highlight state: "effect" when an effect is hovered over
  // the clip body, "transition-left" / "transition-right" when a
  // transition is hovered over one of the clip's edges.
  const [dragHover, setDragHover] = useState<
    "effect" | "transition-left" | "transition-right" | null
  >(null);

  const left = clip.startTime * pixelsPerSecond;
  const width = clip.duration * pixelsPerSecond;

  const isVideo = track.type === "video";
  const isAudio = track.type === "audio";
  const isImage = track.type === "image";
  const clipStyle = getClipStyle(track.type);

  const handleClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isDragging || isPendingDrag) return;
    e.stopPropagation();
    onSelect(clip.id, e.shiftKey || e.metaKey);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (track.locked || isTrimming) return;
    e.stopPropagation();

    const rect = clipRef.current?.parentElement?.getBoundingClientRect();
    const clipRect = clipRef.current?.getBoundingClientRect();
    if (!rect || !clipRect) return;

    const clickX = e.clientX - rect.left;
    const clipStartX = clip.startTime * pixelsPerSecond;
    setDragOffset(clickX - clipStartX);

    dragStartRef.current = {
      mouseY: e.clientY,
      clipY: clipRect.top - rect.top,
      scrollTop: timelineRef.current?.scrollTop || 0,
    };
    mousePositionRef.current = { x: e.clientX, y: e.clientY };
    dragPendingRef.current = { active: true, startX: e.clientX, startY: e.clientY };
    setDragYOffset(0);
    setIsInvalidDrop(false);
    setIsPendingDrag(true);

    // If this clip is part of a multi-selection, snapshot the other
    // selected clips' start positions so we can drag them as a group.
    const selectedIds = useUIStore.getState().getSelectedClipIds();
    if (selectedIds.length > 1 && selectedIds.includes(clip.id)) {
      const snapshot: Array<{ clipId: string; startTime: number; trackId: string }> = [];
      for (const t of allTracks) {
        for (const c of t.clips) {
          if (c.id === clip.id) continue;
          if (!selectedIds.includes(c.id)) continue;
          if (t.locked) continue;
          snapshot.push({ clipId: c.id, startTime: c.startTime, trackId: t.id });
        }
      }
      multiDragSnapshotRef.current = snapshot;
    } else {
      multiDragSnapshotRef.current = [];
    }
  };

  // ── Drag-drop: effects & transitions from the assets panel ────
  // The asset cards set custom MIME types so we know which mode to use.
  // For effects the drop hits anywhere on the clip body. For transitions
  // we treat the outer ~25% of the clip's width as an "edge zone" — the
  // closer edge wins, and we map left edge → incoming, right edge →
  // outgoing transition.
  const readDragKind = (e: React.DragEvent): "effect" | "transition" | null => {
    const types = e.dataTransfer.types;
    if (types.includes(EFFECT_DRAG_MIME)) return "effect";
    if (types.includes(TRANSITION_DRAG_MIME)) return "transition";
    // text/plain fallback (some browsers don't preserve custom types)
    if (types.includes("text/plain")) {
      // Can't read data during dragover; trust the parsed kind by
      // payload sniffing on drop. We optimistically allow both here.
      return null;
    }
    return null;
  };

  const computeTransitionEdge = useCallback(
    (e: React.DragEvent): "transition-left" | "transition-right" => {
      const rect = clipRef.current?.getBoundingClientRect();
      if (!rect) return "transition-right";
      const ratio = (e.clientX - rect.left) / rect.width;
      return ratio < 0.5 ? "transition-left" : "transition-right";
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const kind = readDragKind(e);
      if (kind === null) {
        // Don't preventDefault — let other handlers (e.g. timeline file
        // drop) take over.
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (kind === "effect") {
        setDragHover("effect");
      } else {
        setDragHover(computeTransitionEdge(e));
      }
    },
    [computeTransitionEdge],
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when the pointer actually exits the clip — dragleave
    // fires on every child too.
    const related = e.relatedTarget as Node | null;
    if (!related || !clipRef.current?.contains(related)) {
      setDragHover(null);
    }
  }, []);

  const applyTransitionAt = useCallback(
    (transitionType: TransitionType, edge: "left" | "right") => {
      const projectState = useProjectStore.getState();
      const tracks = projectState.project.timeline.tracks;
      const owningTrack = tracks.find((t) =>
        t.clips.some((c) => c.id === clip.id),
      );
      if (!owningTrack) return;
      const sortedClips = [...owningTrack.clips].sort((a, b) => {
        if (a.startTime !== b.startTime) return a.startTime - b.startTime;
        return a.id.localeCompare(b.id);
      });
      const idx = sortedClips.findIndex((c) => c.id === clip.id);
      const previousClip = idx > 0 ? sortedClips[idx - 1] : undefined;
      const nextClip =
        idx < sortedClips.length - 1 ? sortedClips[idx + 1] : undefined;
      const clipA = edge === "left" ? previousClip : sortedClips[idx];
      const clipB = edge === "left" ? sortedClips[idx] : nextClip;

      if (!clipA || !clipB) {
        toast.warning(
          "No adjacent clip",
          edge === "left"
            ? "Drop on the right edge or add a clip before this one."
            : "Drop on the left edge or add a clip after this one.",
        );
        return;
      }

      const bridge = getTransitionBridge();
      if (!bridge.isInitialized()) {
        toast.error("Transition engine not ready", "Try again in a moment.");
        return;
      }
      const defaultParams = bridge.getDefaultParams(transitionType);
      const result = bridge.createTransition(
        clipA,
        clipB,
        transitionType,
        1.0,
        defaultParams,
      );
      if (result.success && result.transitionId) {
        const transition = bridge.getTransition(result.transitionId);
        if (transition) {
          projectState.addClipTransition(transition);
          toast.success(
            "Transition applied",
            `${transitionType} • 1.0s`,
          );
          return;
        }
      }
      toast.error(
        "Transition failed",
        result.error || "Could not create transition",
      );
    },
    [clip.id],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setDragHover(null);

      const tryParse = <T,>(s: string | null): T | null => {
        if (!s) return null;
        try {
          return JSON.parse(s) as T;
        } catch {
          return null;
        }
      };

      const effectPayload = tryParse<{ effectType: VideoEffectType }>(
        e.dataTransfer.getData(EFFECT_DRAG_MIME) || null,
      );
      const transitionPayload = tryParse<{ transitionType: TransitionType }>(
        e.dataTransfer.getData(TRANSITION_DRAG_MIME) || null,
      );
      const text = e.dataTransfer.getData("text/plain");
      const isEffectByText = text.startsWith("effect:");
      const isTransitionByText = text.startsWith("transition:");

      const effectType =
        effectPayload?.effectType ??
        (isEffectByText ? (text.slice(7) as VideoEffectType) : null);
      const transitionType =
        transitionPayload?.transitionType ??
        (isTransitionByText ? (text.slice(11) as TransitionType) : null);

      if (!effectType && !transitionType) {
        // Not for us — let the timeline's outer drop handler take it.
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (effectType) {
        const result = useProjectStore.getState().addVideoEffect(clip.id, effectType);
        if (result) {
          toast.success("Effect applied", `${effectType} added`);
          // Auto-select the clip so the user sees the new effect in
          // the inspector.
          useUIStore.getState().select({ id: clip.id, type: "clip" });
        } else {
          toast.error("Effect failed", "Could not apply effect");
        }
        return;
      }

      if (transitionType) {
        const edge = computeTransitionEdge(e).endsWith("left") ? "left" : "right";
        applyTransitionAt(transitionType, edge);
      }
    },
    [clip.id, applyTransitionAt, computeTransitionEdge],
  );

  const handleTrimMouseDown =
    (edge: "left" | "right") => (e: React.MouseEvent) => {
      if (e.button !== 0) return;
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
    if (!isPendingDrag) return;

    const handlePendingMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragPendingRef.current.startX;
      const dy = e.clientY - dragPendingRef.current.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance >= DRAG_THRESHOLD) {
        dragPendingRef.current.active = false;
        setIsPendingDrag(false);
        setIsDragging(true);
      }
    };

    const handlePendingMouseUp = (e: MouseEvent) => {
      dragPendingRef.current.active = false;
      setIsPendingDrag(false);
      onSelect(clip.id, e.shiftKey || e.metaKey);
    };

    window.addEventListener("mousemove", handlePendingMouseMove);
    window.addEventListener("mouseup", handlePendingMouseUp);

    return () => {
      window.removeEventListener("mousemove", handlePendingMouseMove);
      window.removeEventListener("mouseup", handlePendingMouseUp);
    };
  }, [isPendingDrag, clip.id, onSelect]);

  useEffect(() => {
    if (!isDragging) return;

    // Wrap the entire drag in a single history group so undo collapses
    // all the per-frame moves (and any companion clips) into one step.
    const projectStore = useProjectStore.getState();
    projectStore.beginHistoryGroup(
      multiDragSnapshotRef.current.length > 0 ? "Move clips" : "Move clip",
    );

    let animationFrameId: number | null = null;

    const scrollLoop = () => {
      if (!timelineRef.current) {
        animationFrameId = requestAnimationFrame(scrollLoop);
        return;
      }

      const timeline = timelineRef.current;
      const timelineRect = timeline.getBoundingClientRect();
      const mouseY = mousePositionRef.current.y;
      const timelineTop = timelineRect.top;
      const timelineBottom = timelineRect.bottom;
      const canScrollUp = timeline.scrollTop > 0;
      const canScrollDown = timeline.scrollTop < timeline.scrollHeight - timeline.clientHeight;

      const distanceFromTop = mouseY - timelineTop;
      const distanceFromBottom = timelineBottom - mouseY;

      if (distanceFromTop < AUTO_SCROLL_THRESHOLD && canScrollUp) {
        timeline.scrollTop -= AUTO_SCROLL_SPEED;
      } else if (distanceFromBottom < AUTO_SCROLL_THRESHOLD && canScrollDown) {
        timeline.scrollTop += AUTO_SCROLL_SPEED;
      }

      animationFrameId = requestAnimationFrame(scrollLoop);
    };

    animationFrameId = requestAnimationFrame(scrollLoop);

    const flushPendingCommit = () => {
      moveCommitRafRef.current = null;
      const commit = pendingCommitRef.current;
      pendingCommitRef.current = null;
      commit?.();
    };

    const handleMouseMove = (e: MouseEvent) => {
      mousePositionRef.current.x = e.clientX;
      mousePositionRef.current.y = e.clientY;

      const rect = clipRef.current?.parentElement?.getBoundingClientRect();
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      if (!rect || !timelineRect) return;

      const x = e.clientX - rect.left - dragOffset;
      const rawTime = Math.max(0, x / pixelsPerSecond);

      const dragSnapSettings = { ...snapSettings, snapToPlayhead: false };
      const snapResult = calculateSnap(
        rawTime,
        clip.id,
        allTracks,
        playheadPosition,
        dragSnapSettings,
        pixelsPerSecond,
        clip.duration,
      );
      const currentScrollTop = timelineRef.current?.scrollTop || 0;
      const scrollDelta = currentScrollTop - dragStartRef.current.scrollTop;
      const yDelta = (e.clientY - dragStartRef.current.mouseY) + scrollDelta;
      setDragYOffset(yDelta);

      const scrollTop = timelineRef.current?.scrollTop || 0;
      const mouseY = e.clientY - timelineRect.top + scrollTop;
      let targetTrackId: string | undefined;
      let hoveredTrackType: string | undefined;
      let cumulativeY = 0;

      for (const t of allTracks) {
        const height = trackHeights.get(t.id) || 60;
        if (mouseY >= cumulativeY && mouseY < cumulativeY + height) {
          hoveredTrackType = t.type;
          if (t.type === track.type && t.id !== track.id) {
            targetTrackId = t.id;
          }
          break;
        }
        cumulativeY += height;
      }

      const isOverDifferentTrackType = hoveredTrackType !== undefined && hoveredTrackType !== track.type;
      setIsInvalidDrop(isOverDifferentTrackType);

      pendingDropRef.current = { time: snapResult.time, targetTrackId };

      // Coalesce store commits to one per animation frame. A fast mouse
      // fires many mousemove events between frames; dispatching moveClip on
      // each one deep-clones the project and re-renders the whole editor
      // dozens of extra times per frame, which is what made sustained
      // dragging lag and eventually exhaust memory. We keep the latest move
      // in a ref and flush it once per frame.
      const moveTime = snapResult.time;
      const baseStartTime = clip.startTime;
      const companions = multiDragSnapshotRef.current;
      pendingCommitRef.current = () => {
        onMoveClip(clip.id, moveTime, undefined);
        // Move every companion clip in the multi-selection by the same
        // delta. Cross-track moves of the primary don't take any
        // companions along — that gets too lossy when they live on tracks
        // of a different type — but same-track drags stay locked.
        if (companions.length > 0) {
          const deltaTime = moveTime - baseStartTime;
          for (const snap of companions) {
            const newStart = Math.max(0, snap.startTime + deltaTime);
            onMoveClip(snap.clipId, newStart, undefined);
          }
        }
      };
      if (moveCommitRafRef.current === null) {
        moveCommitRafRef.current = requestAnimationFrame(flushPendingCommit);
      }

      onSnapIndicator(snapResult.snapped && snapResult.snapPoint ? snapResult.snapPoint.time : null);
    };

    let groupClosed = false;
    const closeGroup = () => {
      if (groupClosed) return;
      groupClosed = true;
      projectStore.endHistoryGroup();
    };

    const handleMouseUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }

      // Flush any move queued for the next frame so the clip settles at the
      // final dragged position instead of one frame behind.
      if (moveCommitRafRef.current !== null) {
        cancelAnimationFrame(moveCommitRafRef.current);
        moveCommitRafRef.current = null;
      }
      const pendingCommit = pendingCommitRef.current;
      pendingCommitRef.current = null;
      pendingCommit?.();

      const { time, targetTrackId } = pendingDropRef.current;
      if (targetTrackId) {
        onMoveClip(clip.id, time, targetTrackId);
      }

      setIsDragging(false);
      setDragYOffset(0);
      setIsInvalidDrop(false);
      onSnapIndicator(null);
      multiDragSnapshotRef.current = [];
      closeGroup();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (moveCommitRafRef.current !== null) {
        cancelAnimationFrame(moveCommitRafRef.current);
        moveCommitRafRef.current = null;
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      closeGroup();
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
  const isApplyingEffect = effectApplicationClipId === clip.id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={clipRef}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`group absolute top-1 bottom-1 rounded-lg overflow-hidden shadow-sm ${
            isDragging
              ? `cursor-grabbing z-50 ${isInvalidDrop ? "opacity-50 ring-2 ring-red-500 border-red-500" : "opacity-90 shadow-xl"}`
              : "cursor-grab"
          } ${
            isSelected && !isDragging
              ? isApplyingEffect
                ? "ring-2 ring-amber-400 border-amber-300 z-10"
                : "ring-2 ring-primary border-primary z-10"
              : !isDragging ? "border-opacity-30 hover:border-opacity-60 hover:brightness-110" : ""
          } ${clipStyle.bg} border ${clipStyle.border} ${
            track.locked ? "cursor-not-allowed opacity-60" : ""
          }`}
          style={{
            transform: isDragging
              ? `translate(${left}px, ${dragYOffset}px)`
              : `translateX(${left}px)`,
            width: `${width}px`,
            willChange: isInteracting ? 'transform, width' : 'auto',
            transition: isInteracting ? 'none' : 'opacity 150ms, box-shadow 150ms',
            pointerEvents: isDragging ? 'none' : 'auto',
          }}
        >
      {isApplyingEffect && (
        <>
          <div className="absolute -inset-px rounded-lg border border-amber-300/80 shadow-[0_0_18px_rgba(251,191,36,0.55)] pointer-events-none animate-pulse" />
          <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.08)_28%,rgba(251,191,36,0.28)_50%,rgba(255,255,255,0.08)_72%,transparent_100%)] pointer-events-none animate-pulse" />
          <div className="absolute top-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-amber-200 pointer-events-none">
            {effectApplicationLabel ?? "Applying effect"}
          </div>
        </>
      )}

      {/* Drag-drop hover indicators for effects/transitions */}
      {dragHover === "effect" && (
        <div className="absolute inset-0 ring-2 ring-accent ring-inset rounded-lg bg-accent/15 pointer-events-none z-20" />
      )}
      {dragHover === "transition-left" && (
        <div className="absolute inset-y-0 left-0 w-1/3 pointer-events-none z-20 bg-gradient-to-r from-accent/60 to-transparent">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
        </div>
      )}
      {dragHover === "transition-right" && (
        <div className="absolute inset-y-0 right-0 w-1/3 pointer-events-none z-20 bg-gradient-to-l from-accent/60 to-transparent">
          <div className="absolute right-0 top-0 bottom-0 w-1 bg-accent" />
        </div>
      )}

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

      {(isAudio || isVideo) && (
        <>
          <div className={`absolute inset-x-0 px-1 pointer-events-none ${isAudio ? "inset-y-0 flex items-center opacity-50" : "bottom-0 h-1/3 flex items-end opacity-30"}`}>
            {mediaItem?.waveformData ? (
              <svg
                className="w-full h-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 40"
              >
                <path
                  d={generateWaveformPath(mediaItem.waveformData, 100)}
                  stroke="currentColor"
                  className={isAudio ? "text-blue-400" : "text-green-300"}
                  fill="none"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : isAudio ? (
              <svg className="w-full h-full" preserveAspectRatio="none">
                <path
                  d="M0,20 Q10,5 20,20 T40,20 T60,20 T80,20 T100,20"
                  stroke="currentColor"
                  className="text-blue-400"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}
          </div>
          {isAudio && (
            <div className="absolute inset-x-0 top-1 flex justify-center opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
              <div className="flex gap-0.5">
                <div className="w-1 h-1 rounded-full bg-blue-300" />
                <div className="w-1 h-1 rounded-full bg-blue-300" />
                <div className="w-1 h-1 rounded-full bg-blue-300" />
              </div>
            </div>
          )}
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
        <div className="absolute inset-0 border-2 border-primary rounded-lg pointer-events-none" />
      )}

      {(isVideo || isImage || isAudio) && onTrimClip && (
        <>
          <div
            onMouseDown={handleTrimMouseDown("left")}
            className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } ${isSelected ? "bg-primary" : isAudio ? "hover:bg-blue-400/50" : isVideo ? "hover:bg-green-400/50" : "hover:bg-purple-400/50"}`}
            style={{ borderRadius: "6px 0 0 6px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {isSelected && (
              <div className="w-0.5 h-3 bg-primary-foreground/80 rounded-full" />
            )}
          </div>
          <div
            onMouseDown={handleTrimMouseDown("right")}
            className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 flex items-center justify-center transition-opacity ${
              isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            } ${isSelected ? "bg-primary" : isAudio ? "hover:bg-blue-400/50" : isVideo ? "hover:bg-green-400/50" : "hover:bg-purple-400/50"}`}
            style={{ borderRadius: "0 6px 6px 0" }}
            onClick={(e) => e.stopPropagation()}
          >
            {isSelected && (
              <div className="w-0.5 h-3 bg-primary-foreground/80 rounded-full" />
            )}
          </div>
        </>
      )}

        </div>
      </ContextMenuTrigger>
      <ClipContextMenu clip={clip} track={track} />
    </ContextMenu>
  );
};
