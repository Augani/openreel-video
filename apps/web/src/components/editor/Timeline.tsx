import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { getPrimarySelectedTrackId } from "./timeline/primary-track";
import { keyboardShortcuts } from "../../services/keyboard-shortcuts";
import { Button as ShadcnButton, Input, Slider, Popover as ShadcnPopover, PopoverContent, PopoverTrigger } from "@openreel/ui";
import { MousePointer2, Bookmark, MoreHorizontal, Columns2, Link2, Hand } from "lucide-react";
import React, {
  Fragment,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { TimelineRangeActions } from "./timeline/TimelineRange";
import { EditPointTrimEntry } from "./timeline/EditPointTrimEntry";
import { RenderCacheControls, RenderStatusBar, RENDER_STATUS_BAR_HEIGHT } from "./timeline/RenderStatusBar";
import {
  Undo2,
  Redo2,
  Layers,
  Maximize2,
  Minimize2,
  Music,
  Type,
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
import { cn } from "@openreel/ui";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore, ZOOM_PRESETS } from "../../stores/timeline-store";
import { useCompactEditor } from "../../hooks/useCompactEditor";
import { usePhoneEditor } from "../../hooks/usePhoneEditor";
import { usePhoneTimeline } from "./mobile/usePhoneTimeline";
import { phoneTrackLayout, phoneKeyframesHeight, phoneDecorationScroll } from "./mobile/mobile-timeline-layout";
import "./mobile/mobile-timeline.css";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { useEngineStore } from "../../stores/engine-store";
import { getPlaybackBridge } from "../../bridges/playback-bridge";
import { reconcileGroupSelection, trackHasAudioItems, trackHasVisualItems, graphicMemberClipIds, expectedMemberIds, type GraphicInstance, type Project } from "@openreel/core";
import {

  getTimelineItemRanges,
  getSplittableTimelineItemIds,
  getTimelineMarqueeSelection,
} from "../../utils/timeline-item-actions";
import {
  Playhead,
  TimeRuler,
  TrackHeader,
  TrackLane,
  LANE_SCROLL_BUCKET,
  BeatMarkerOverlay,
  MarkerIndicator,
  getTrackInfo,
} from "./timeline/index";
import {
  filterTrackLayerEntries,
  type TrackLayerFilter,
} from "./timeline/track-layer-filter";
import { getTrackDragAutoScrollDelta } from "./timeline/track-drag-auto-scroll";
import {
  moveLinkedCaptions,
} from "../../utils/linked-caption-edit";
import { CaptionBatchSelectButton } from "./timeline/CaptionBatchSelectButton";
import { applyTrackSelect, trackSelectDirection, useTimelineNavTools } from "./timeline/useTimelineNavTools";
import { editTimelineSelection, moveLinkedTimelineClips, trimLinkedTimelineClips } from "../../services/linked-timeline-edit";
import { getEditableTimelineSelection, getLinkedTimelineSelection } from "../../utils/linked-timeline-selection";
import { StereoOutputMeters } from "./timeline/StereoOutputMeters";
import { MediaLibraryIcon } from "../../icons/media-library";
import { SequenceTabs } from "./timeline/SequenceTabs";
import { useScrubAudioStore } from "../../stores/scrub-audio-store";
import { TrackAutomationHeaderRows, TrackAutomationRows } from "./timeline/TrackAutomationLanes";
import { AUTOMATION_LANES_HEIGHT } from "./timeline/track-automation-geometry";
import { RemotePlayheads } from "./timeline/RemotePresence";
import { placeSequenceOnTimeline } from "../../services/sequence-commands";
import { addMarkerAtPlayhead, addRangeMarker, editMarker } from "../../services/marker-commands";

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
const NO_SELECTED_CLIPS: string[] = [];
const NO_GRAPHICS: Array<{ instance: GraphicInstance; anchorId: string }> = [];
const TIMELINE_SCROLLBAR_SIZE = 10;

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
  <ShadcnButton
    type="button" variant="ghost" size="icon-sm"
    aria-label={title ?? "Timeline tool"}
    aria-pressed={active}
    onClick={onClick}
    disabled={disabled}
    data-tip-bottom={title}
    className={`relative grid place-items-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? "text-accent" : "text-fg-muted hover:text-fg-2"
    }`}
  >
    {children}
    {extra}
  </ShadcnButton>
);

export const Timeline: React.FC<{ onOpenMedia?: () => void }> = ({ onOpenMedia }) => {
  const compact = useCompactEditor();
  const phone = usePhoneEditor();
  const headerWidth = phone ? 0 : compact ? 108 : 169;
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
    hideTrack,
    lockTrack,
    muteTrack,
    soloTrack,
    setTrackSoloSafe,
    renameTrack,
    removeTrack,
  } = useProjectStore(useShallow((state) => ({
    project: state.project,
    undo: state.undo,
    redo: state.redo,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    addTrack: state.addTrack,
    duplicateTrack: state.duplicateTrack,
    reorderTrack: state.reorderTrack,
    removeMarker: state.removeMarker,
    updateMarker: state.updateMarker,
    updateClipKeyframes: state.updateClipKeyframes,
    hideTrack: state.hideTrack,
    lockTrack: state.lockTrack,
    muteTrack: state.muteTrack,
    soloTrack: state.soloTrack,
    setTrackSoloSafe: state.setTrackSoloSafe,
    renameTrack: state.renameTrack,
    removeTrack: state.removeTrack,
  })));
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
    pixelsPerSecond,
    scrollX: viewportScrollX,
    scrollY,
    viewportWidth,
    setScrollX,
    setScrollY,
    setViewportDimensions,
    zoomIn,
    zoomOut,
    setZoom,
    trackHeight,
    trackHeights,
    setTrackHeight,
    setTrackHeightById,
    getTrackHeight: getStoredTrackHeight,
    expandedTracks,
    automationLaneTracks,
  } = useTimelineStore(useShallow(state => ({
    pixelsPerSecond: state.pixelsPerSecond,
    scrollX: state.scrollX,
    scrollY: state.scrollY,
    viewportWidth: state.viewportWidth,
    setScrollX: state.setScrollX,
    setScrollY: state.setScrollY,
    setViewportDimensions: state.setViewportDimensions,
    zoomIn: state.zoomIn,
    zoomOut: state.zoomOut,
    setZoom: state.setZoom,
    trackHeight: state.trackHeight,
    trackHeights: state.trackHeights,
    setTrackHeight: state.setTrackHeight,
    setTrackHeightById: state.setTrackHeightById,
    getTrackHeight: state.getTrackHeight,
    expandedTracks: state.expandedTracks,
    automationLaneTracks: state.automationLaneTracks,
  })));

  const timelineInset = phone ? viewportWidth / 2 : 0;
  const scrollX = viewportScrollX - timelineInset;
  const onPhoneScroll = usePhoneTimeline(phone, tracksRef, pixelsPerSecond, viewportWidth);
  const [phoneTrackScale, setPhoneTrackScale] = useState(1);

  const getTrackHeight = useCallback((id: string, type?: string, name?: string) => {
    if (phone) {
      const track = tracks.find(track => track.id === id);
      return phoneTrackLayout({ type: type as typeof tracks[number]["type"], name: name ?? "" }, phoneTrackScale).row
        + (track && expandedTracks.has(id) ? phoneKeyframesHeight(track) : 0);
    }
    const height = getStoredTrackHeight(id,type,name);
    return compact ? Math.max(48,height) : height;
  }, [phone,compact,getStoredTrackHeight,tracks,expandedTracks,phoneTrackScale]);

  // A track with its automation lanes expanded occupies extra rows below its clip lane (not on phones).
  const getRowHeight = useCallback((id: string, type?: string, name?: string) =>
    getTrackHeight(id, type, name) + (!phone && automationLaneTracks[id] ? AUTOMATION_LANES_HEIGHT : 0),
  [getTrackHeight, phone, automationLaneTracks]);

  const scrubAudio = useScrubAudioStore((s) => s.enabled);
  const toggleScrubAudio = useScrubAudioStore((s) => s.toggle);
  const tool = useEditorWorkspaceStore(s => s.timelineTool);
  const navTools = useTimelineNavTools(tracksRef, !phone);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [phoneOptionsOpen, setPhoneOptionsOpen] = useState(false);
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
    selectedItems,
    snapSettings,
    toggleSnap,
    timelineMaximized,
    toggleTimelineMaximized,
  } = useUIStore(useShallow(state => ({
    select: state.select,
    selectMultiple: state.selectMultiple,
    clearSelection: state.clearSelection,
    selectedItems: state.selectedItems,
    snapSettings: state.snapSettings,
    toggleSnap: state.toggleSnap,
    timelineMaximized: state.timelineMaximized,
    toggleTimelineMaximized: state.toggleTimelineMaximized,
  })));
  const linkedSelection = useEditorWorkspaceStore((state) => state.linkedSelection);
  const selectedMarkerId = useEditorWorkspaceStore((state) => state.selectedMarkerId);
  const setSelectedMarkerId = useEditorWorkspaceStore((state) => state.setSelectedMarkerId);
  const primarySelectedTrackId = useMemo(
    () => getPrimarySelectedTrackId(project, selectedItems),
    [project, selectedItems],
  );
  const explicitClipIds = useMemo(() => selectedItems
    .filter((item) => item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip")
    .map((item) => item.id), [selectedItems]);
  // Grouped clips select and deselect together: a clip newly (de)selected brings its whole group along.
  const lastClipSelection = useRef<string[]>([]);
  useEffect(() => {
    const reconciled = reconcileGroupSelection(project.timeline.tracks, lastClipSelection.current, explicitClipIds);
    lastClipSelection.current = reconciled;
    if (reconciled.length === explicitClipIds.length && reconciled.every((id) => explicitClipIds.includes(id))) return;
    const keep = new Set(reconciled);
    const have = new Set<string>();
    const items = useUIStore.getState().selectedItems.filter((item) => {
      const isClip = item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip";
      if (isClip && keep.has(item.id)) have.add(item.id);
      return !isClip || keep.has(item.id);
    });
    useUIStore.getState().selectMultiple([...items, ...reconciled.filter((id) => !have.has(id)).map((id) => ({ type: "clip" as const, id }))]);
  }, [project, explicitClipIds]);
  const selectedClipIds = useMemo(
    () => getLinkedTimelineSelection(project, explicitClipIds, linkedSelection),
    [project, explicitClipIds, linkedSelection],
  );
  const editableSelection = useMemo(
    () => getEditableTimelineSelection(project, explicitClipIds, linkedSelection),
    [project, explicitClipIds, linkedSelection],
  );
  const editableClipIds = editableSelection.ids;
  const splittableSelectedClipIds = useTimelineStore(useShallow(state =>
    getSplittableTimelineItemIds(project, editableClipIds, state.playheadPosition),
  ));
  const selectedMediaClipIds = useMemo(() => {
    const mediaClipIds = new Set<string>();
    for (const track of tracks) for (const clip of track.clips) mediaClipIds.add(clip.id);
    return selectedClipIds.filter((clipId) => mediaClipIds.has(clipId));
  }, [selectedClipIds, tracks]);
  const canRippleDelete =
    selectedMediaClipIds.length > 0 &&
    selectedMediaClipIds.length === selectedClipIds.length && !editableSelection.blocked;

  const { getTitleEngine, getGraphicsEngine } = useEngineStore();
  const titleEngine = getTitleEngine();
  const allTextClips = useMemo(() => {
    return titleEngine?.getAllTextClips() ?? [];
  }, [titleEngine, project.modifiedAt]);

  // Essential Graphics: a graphic's member layers are drawn as ONE bar per graphic.
  const graphicInstances = project.graphicInstances;
  const graphicMemberIds = useMemo(
    () => graphicMemberClipIds({ graphicInstances, settings: project.settings } as Project),
    [graphicInstances, project.settings],
  );
  const graphicsByTrack = useMemo(() => {
    const byTrack = new Map<string, Array<{ instance: GraphicInstance; anchorId: string }>>();
    for (const instance of graphicInstances ?? []) {
      const [anchorId] = expectedMemberIds(instance, project.settings);
      if (!anchorId) continue;
      const list = byTrack.get(instance.trackId);
      if (list) list.push({ instance, anchorId });
      else byTrack.set(instance.trackId, [{ instance, anchorId }]);
    }
    return byTrack;
  }, [graphicInstances, project.settings]);

  const textClipsByTrack = useMemo(
    () =>
      new Map(tracks.map((track) => [
        track.id,
        allTextClips.filter((clip) => clip.trackId === track.id && !graphicMemberIds.has(clip.id)),
      ])),
    [allTextClips, tracks, graphicMemberIds],
  );

  const graphicsEngine = getGraphicsEngine();
  const allShapeClips = useMemo(() => {
    const shapes = graphicsEngine?.getAllShapeClips() ?? [];
    const svgs = graphicsEngine?.getAllSVGClips() ?? [];
    const stickers = graphicsEngine?.getAllStickerClips() ?? [];
    return [...shapes, ...svgs, ...stickers];
  }, [graphicsEngine, project.modifiedAt]);

  const shapeClipsByTrack = useMemo(
    () =>
      new Map(tracks.map((track) => [
        track.id,
        allShapeClips.filter((clip) => clip.trackId === track.id && !graphicMemberIds.has(clip.id)),
      ])),
    [allShapeClips, tracks, graphicMemberIds],
  );
  const [isBoxSelecting, setIsBoxSelecting] = React.useState(false);
  const [selectionBox, setSelectionBox] = React.useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    additive: boolean;
  } | null>(null);

  // Per-lane selection with stable identities: selecting a clip must only
  // re-render the lane(s) whose selected set changed, not every TrackLane.
  const laneSelectionRef = useRef(new Map<string, string[]>());
  const laneSelectedIds = useMemo(() => {
    const owner = new Map<string, string>();
    for (const track of tracks) for (const clip of track.clips) owner.set(clip.id, track.id);
    for (const clip of allTextClips) owner.set(clip.id, clip.trackId);
    for (const clip of allShapeClips) owner.set(clip.id, clip.trackId);
    const next = new Map<string, string[]>();
    for (const id of selectedClipIds) {
      const trackId = owner.get(id);
      if (!trackId) continue;
      const ids = next.get(trackId);
      if (ids) ids.push(id);
      else next.set(trackId, [id]);
    }
    const previous = laneSelectionRef.current;
    for (const [trackId, ids] of next) {
      const before = previous.get(trackId);
      if (before && before.length === ids.length && before.every((id, i) => id === ids[i])) {
        next.set(trackId, before);
      }
    }
    laneSelectionRef.current = next;
    return next;
  }, [selectedClipIds, tracks, allTextClips, allShapeClips]);
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
      height += getRowHeight(track.id, track.type, track.name);
    }
    return height;
  }, [tracks, getRowHeight, trackHeight, trackHeights]);

  // A commit replaces `tracks`, but the heights rarely change: keep the previous Map when every
  // entry is equal so memoised clips (which receive it as a prop) do not all re-render.
  const previousTrackHeightsRef = useRef<Map<string, number>>(new Map());
  const trackHeightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) {
      map.set(track.id, getTrackHeight(track.id, track.type, track.name));
    }
    const previous = previousTrackHeightsRef.current;
    if (previous.size === map.size && [...map].every(([id, height]) => previous.get(id) === height)) {
      return previous;
    }
    previousTrackHeightsRef.current = map;
    return map;
  }, [tracks, getTrackHeight, trackHeight, trackHeights]);

  // Row heights include expanded automation lanes; clip drag maps the pointer to a track with these.
  // Kept stable across commits like trackHeightsMap, or every memoised clip re-renders on each edit.
  const previousRowHeightsRef = useRef<Map<string, number>>(new Map());
  const rowHeightsMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const track of tracks) map.set(track.id, getRowHeight(track.id, track.type, track.name));
    const previous = previousRowHeightsRef.current;
    if (previous.size === map.size && [...map].every(([id, height]) => previous.get(id) === height)) {
      return previous;
    }
    previousRowHeightsRef.current = map;
    return map;
  }, [tracks, getRowHeight, trackHeight, trackHeights]);

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
        const inset = phone ? el.clientWidth / 2 : 0;
        const timeAtCursor = (pointerX + el.scrollLeft - inset) / pps;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = Math.max(
          ZOOM_PRESETS.MIN,
          Math.min(ZOOM_PRESETS.MAX, pps * factor),
        );
        if (next === pps) return;
        applyZoom(next);
        requestAnimationFrame(() => {
          el.scrollLeft = phone
            ? useTimelineStore.getState().playheadPosition * next
            : Math.max(0, timeAtCursor * next - pointerX);
        });
      } else if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [phone]);

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

  // Read at drop time so the callback (a prop of every TrackHeader) keeps one identity across edits.
  const tracksRef2 = useRef(tracks);
  tracksRef2.current = tracks;
  const handleTrackDrop = useCallback(
    async (e: React.DragEvent, targetTrackId: string) => {
      e.preventDefault();
      const sourceTrackId = e.dataTransfer.getData("trackId");
      stopTrackDrag();

      if (sourceTrackId && sourceTrackId !== targetTrackId) {
        const targetIndex = tracksRef2.current.findIndex((t) => t.id === targetTrackId);
        if (targetIndex !== -1) {
          await reorderTrack(sourceTrackId, targetIndex);
        }
      }
    },
    [reorderTrack, stopTrackDrag],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const measure = () => {
      const element = containerRef.current;
      if (element && element.clientWidth > 0) setViewportDimensions(Math.max(1,element.clientWidth - headerWidth),element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [setViewportDimensions,headerWidth]);

  // Latest sources for the selection handler, read at click time: depending on `tracks` here would
  // hand every memoised clip a new `onSelect` on each commit and re-render them all.
  const selectionSourcesRef = useRef({ tracks, allTextClips, allShapeClips });
  selectionSourcesRef.current = { tracks, allTextClips, allShapeClips };
  const handleSelectClip = useCallback(
    (clipId: string, addToSelection: boolean) => {
      // Track Select tools: a click selects a range of the timeline, and
      // Shift limits it to the clicked track instead of extending the selection.
      const direction = trackSelectDirection(useEditorWorkspaceStore.getState().timelineTool);
      if (direction) {
        applyTrackSelect(clipId, direction, addToSelection);
        return;
      }
      const { tracks, allTextClips, allShapeClips } = selectionSourcesRef.current;
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
    [select],
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
    await editTimelineSelection(explicitClipIds, "split", useTimelineStore.getState().playheadPosition);
  }, [explicitClipIds]);

  const handleDelete = useCallback(async () => {
    if (await editTimelineSelection(explicitClipIds, "delete")) clearSelection();
  }, [explicitClipIds, clearSelection]);

  const handleDuplicate = useCallback(async () => {
    await editTimelineSelection(explicitClipIds, "duplicate");
  }, [explicitClipIds]);

  const handleRippleDelete = useCallback(async () => {
    if (canRippleDelete && await editTimelineSelection(explicitClipIds, "ripple")) clearSelection();
  }, [canRippleDelete, clearSelection, explicitClipIds]);

  const handleTrimToPlayhead = useCallback(async (trimStart: boolean) => {
    await editTimelineSelection(explicitClipIds, trimStart ? "trim-start" : "trim-end", useTimelineStore.getState().playheadPosition);
  }, [explicitClipIds]);

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
      if (phone || (e.target as HTMLElement).closest("[data-timeline-clip]")) return;

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
    [phone, scrollX, scrollY],
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
      getRowHeight,
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
    getRowHeight,
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
      await useProjectStore
        .getState()
        .placeMediaClip(mediaId, trackId || undefined, startTime);
    },
    [],
  );

  const moveQueue = useRef(Promise.resolve());
  const handleMoveClip = useCallback(
    (clipId: string, newStartTime: number, targetTrackId?: string) => {
      moveQueue.current = moveQueue.current.then(async () => {
        if (await moveLinkedTimelineClips(clipId, newStartTime, targetTrackId)) return;
        const store = useProjectStore.getState();
        const sourceClip = store.getClip(clipId);
        const isOverlay = Boolean(
          store.getTextClip(clipId) || store.getShapeClip(clipId) ||
          store.getSVGClip(clipId) || store.getStickerClip(clipId),
        );
        const result = targetTrackId
          ? await store.moveTimelineItem(clipId, newStartTime, targetTrackId)
          : isOverlay
            ? { success: !!store.updateOverlayClipTiming(clipId, { startTime: newStartTime }) }
            : await store.moveClip(clipId, newStartTime);
        if (result.success && sourceClip) {
          moveLinkedCaptions(useProjectStore.getState(), sourceClip, newStartTime);
        }
      }).catch((error: unknown) => {
        toast.error("Move failed", error instanceof Error ? error.message : "Please try again.");
      });
      return moveQueue.current;
    },
    [],
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
    async (clipId: string, newStartTime: number, targetTrackId?: string) => {
      await handleMoveClip(clipId, Math.max(0, newStartTime), targetTrackId);
    },
    [handleMoveClip],
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

  const trimQueue = useRef(Promise.resolve());
  const handleTrimClip = useCallback((clipId: string, edge: "left" | "right", newTime: number) => {
    trimQueue.current = trimQueue.current.then(() => trimLinkedTimelineClips(clipId, edge, newTime))
      .catch((error: unknown) => { toast.error("Trim failed", error instanceof Error ? error.message : "Please try again."); });
    return trimQueue.current;
  }, []);

  const visualOrderTracks = useMemo(() => tracks, [tracks]);
  // Keep each stored row height intact; its last two pixels form the authored
  // boundary between visual and audio sections in both synchronized columns.
  const audioDividerTrackIds = useMemo(() => new Set(tracks.filter((track, index) => track.type !== "audio" && tracks[index + 1]?.type === "audio").map(track => track.id)), [tracks]);
  const addTrackItems = useMemo(
    () => [
      {
        label: "Track",
        icon: <Layers size={16} className="text-foreground" aria-hidden />,
        onClick: () => addTrack("video", undefined, { mode: "standard" }),
      },
      {
        label: "Dialogue",
        icon: <Music size={16} className="text-clip-audio" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "dialogue",
            name: "Dialogue",
          }),
      },
      {
        label: "Music",
        icon: <Music size={16} className="text-clip-audio" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "music",
            name: "Music",
          }),
      },
      {
        label: "Captions",
        icon: <Type size={16} className="text-clip-text" aria-hidden />,
        onClick: () =>
          addTrack("video", undefined, {
            mode: "standard",
            role: "captions",
            name: "Captions",
          }),
      },
    ],
    [addTrack],
  );

  const addTrackMenu = addTrackItems.map(item =>
    <DropdownMenuItem key={item.label} onSelect={() => void item.onClick()}>{item.icon}{item.label}</DropdownMenuItem>,
  );

  const timelineToolbar = (
      <div className="workspace-timeline-toolbar">
        <TLTool title="Selection tool (V)" active={tool === "select"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("select")}><MousePointer2 size={17} /></TLTool>
        <TLTool title="Blade tool (B)" active={tool === "blade"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("blade")}><Scissors size={16} /></TLTool>
        <TLTool title="Ripple trim (R)" active={tool === "ripple"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("ripple")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg></TLTool>
        <TLTool title="Slip (Y)" active={tool === "slip"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("slip")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6zM2 12h3M19 12h3" /></svg></TLTool>
        <TLTool title="Rolling edit (Shift+N)" active={tool === "roll"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("roll")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v16M8 9l-4 3 4 3M16 9l4 3-4 3M4 12h16" /></svg></TLTool>
        <TLTool title="Slide (U)" active={tool === "slide"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("slide")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 7h6v10H9zM3 12h3M18 12h3M4.5 10.5 3 12l1.5 1.5M19.5 10.5 21 12l-1.5 1.5" /></svg></TLTool>
        <TLTool title="Rate stretch (Shift+R)" active={tool === "stretch"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("stretch")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5v14M20 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" /></svg></TLTool>
        <span className="workspace-toolbar-divider" />
        <TLTool title="Track select forward (A)" active={tool === "trackSelectForward"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("trackSelectForward")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 5v14M8 12h12M16 8l4 4-4 4" /></svg></TLTool>
        <TLTool title="Track select backward (Shift+A)" active={tool === "trackSelectBackward"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("trackSelectBackward")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 5v14M16 12H4M8 8l-4 4 4 4" /></svg></TLTool>
        <TLTool title="Hand tool (H)" active={tool === "hand"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("hand")}><Hand size={16} /></TLTool>
        <TLTool title="Zoom tool (Z)" active={tool === "zoom"} onClick={() => useEditorWorkspaceStore.getState().setTimelineTool("zoom")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M20.5 20.5 16 16M11 8.5v5M8.5 11h5" /></svg></TLTool>
        <span className="workspace-toolbar-divider" />
        <TLTool title={snapSettings.enabled ? "Snap on (N)" : "Snap off (N)"} active={snapSettings.enabled} onClick={toggleSnap}><Magnet size={16} /></TLTool>
        <TLTool title={scrubAudio ? "Audio scrubbing on" : "Audio scrubbing off"} active={scrubAudio} onClick={toggleScrubAudio}>{scrubAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}</TLTool>
        <TLTool title="Linked selection" active={linkedSelection} onClick={() => useEditorWorkspaceStore.getState().setLinkedSelection(!linkedSelection)}><Link2 size={16} /></TLTool>
        <TLTool title="Add marker (M)" onClick={() => { void addMarkerAtPlayhead(); }}><Bookmark size={16} /></TLTool>
        <TLTool title="Split (S)" onClick={handleSplit} disabled={splittableSelectedClipIds.length === 0}><Columns2 size={16} /></TLTool>
        <TLTool title="Delete (Del)" onClick={handleDelete} disabled={editableClipIds.length===0}><Trash2 size={16} /></TLTool>
        <EditPointTrimEntry />
        <span className="workspace-toolbar-divider" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><ShadcnButton variant="ghost" size="sm" className="workspace-timeline-track-trigger"><Plus size={14} aria-hidden />Track</ShadcnButton></DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">{addTrackMenu}</DropdownMenuContent>
        </DropdownMenu>
        <ShadcnPopover>
          <PopoverTrigger asChild><ShadcnButton variant="ghost" size="icon-sm" aria-label="More timeline tools"><MoreHorizontal size={16} /></ShadcnButton></PopoverTrigger>
          <PopoverContent side="top" align="start" aria-label="More timeline tools" className={cn("w-[720px] max-w-[calc(100vw-24px)] p-0", phone && "mobile-timeline-advanced-popover")}>
          <div className="workspace-timeline-advanced">      <div className="flex items-center h-12 px-4 gap-4 bg-bg-1 border-b border-border shrink-0 relative z-50">
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
          disabled={editableClipIds.length === 0}
          title="Delete (Del)"
        >
          <Trash2 size={16} aria-hidden />
        </TLTool>
        <TLTool
          onClick={handleDuplicate}
          disabled={editableClipIds.length === 0}
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild><ShadcnButton variant="ghost" size="sm"><Plus size={16} aria-hidden />Add track<ChevronDownIcon size={9} className="text-fg-muted" aria-hidden /></ShadcnButton></DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">{addTrackMenu}</DropdownMenuContent>
        </DropdownMenu>

        <ShadcnPopover
          open={showLayersPanel}
          onOpenChange={(open) => {
            setShowLayersPanel(open);
            if (!open) {
              finishTrackRename(false);
              setPendingTrackDeleteId(null);
            }
          }}
        >
          <PopoverTrigger asChild>
            <ShadcnButton variant="ghost" size="icon-sm" data-tip-bottom="Track layers" aria-label="Manage track layers" title="Manage track layers" className={showLayersPanel ? "bg-bg-2 text-fg-2" : "text-fg-muted"}><Layers size={16} aria-hidden /></ShadcnButton>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" aria-label="Track layers" className={cn("w-[340px] max-w-[calc(100vw-24px)] p-0", phone && "mobile-track-layers-popover")}>
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
                    <ShadcnButton variant="ghost" size="sm"
                      type="button"
                      onClick={() => setPendingTrackDeleteId(null)}
                      className="h-7 rounded-md border border-border bg-bg-1 px-2.5 text-[10px] font-semibold text-fg-2 hover:bg-hover"
                    >
                      Cancel
                    </ShadcnButton>
                    <ShadcnButton variant="ghost" size="sm"
                      type="button"
                      onClick={() => {
                        void removeTrack(pendingTrackDelete.id);
                        setPendingTrackDeleteId(null);
                      }}
                      className="h-7 rounded-md bg-danger px-2.5 text-[10px] font-semibold text-white hover:opacity-90"
                    >
                      Delete track
                    </ShadcnButton>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 border-b border-border px-3 py-2.5">
                <Input
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
                      <ShadcnButton variant="ghost" size="sm"
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
                      </ShadcnButton>
                    );
                  })}
                </div>
              </div>
              <div className="p-2 max-h-60 overflow-y-auto">
                {tracks.length === 0 ? (
                  <span className="font-normal text-xs text-fg-muted text-center py-6">
                    No tracks yet
                  </span>
                ) : filteredTrackEntries.length === 0 ? (
                  <span className="font-normal block py-6 text-center text-xs text-fg-muted"
                  >
                    No tracks match your filters
                  </span>
                ) : (
                  <div className="space-y-0.5">
                    {filteredTrackEntries.map(({ track, index }) => {
                      const info = getTrackInfo(track, index);
                      const name = track.name || info.label;
                      const isVisual = trackHasVisualItems(project, track.id);
                      const isAudio = trackHasAudioItems(project, track.id);
                      return (
                        <div data-track-layer
                          key={track.id}
                          className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-hover group transition-colors cursor-default"
                        >
                          <div
                            className={`w-7 h-7 rounded-md flex items-center justify-center ${info.bgLight}`}
                          >
                            <info.icon size={14} className={info.textColor} aria-hidden />
                          </div>
                          {renamingTrackId === track.id ? (
                            <Input
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
                          <div data-track-layer-actions className="flex gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            {phone && track.clips.some(clip => clip.keyframes?.length) && <ShadcnButton variant="ghost" size="icon-sm" aria-pressed={expandedTracks.has(track.id)} onClick={() => useTimelineStore.getState().toggleTrackExpanded(track.id)} type="button" aria-label={`${expandedTracks.has(track.id) ? "Collapse" : "Expand"} keyframes for ${name}`} title={`${expandedTracks.has(track.id) ? "Collapse" : "Expand"} keyframes for ${name}`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<ChevronDown size={12} aria-hidden />}
                            </ShadcnButton>}
                            <ShadcnButton variant="ghost" size="icon-sm" onClick={() => startTrackRename(track.id, name)} type="button" aria-label={`Rename ${name}`} title={`Rename ${name}`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<Pencil size={12} aria-hidden />}
                            </ShadcnButton>
                            <ShadcnButton variant="ghost" size="icon-sm" onClick={() => void duplicateTrack(track.id)} type="button" aria-label={`Duplicate ${name}`} title={`Duplicate ${name}`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<Copy size={12} aria-hidden />}
                            </ShadcnButton>
                            <ShadcnButton variant="ghost" size="icon-sm" onClick={() => setPendingTrackDeleteId(track.id)} type="button" aria-label={`Delete ${name}`} title={`Delete ${name}`} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<Trash2 size={12} aria-hidden />}
                            </ShadcnButton>
                            {isVisual ? (
                              <ShadcnButton variant="ghost" size="icon-sm" aria-pressed={track.hidden} onClick={() => void hideTrack(track.id, !track.hidden)} type="button" aria-label={`Hide ${name}`} title={`Hide ${name}`} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", (track.hidden ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg"))}>
                                {track.hidden ? (
                                    <EyeOff size={12} aria-hidden />
                                  ) : (
                                    <Eye size={12} aria-hidden />
                                  )}
                              </ShadcnButton>
                            ) : null}
                            {isAudio ? (
                              <>
                                <ShadcnButton variant="ghost" size="icon-sm" aria-pressed={track.muted} onClick={() => void muteTrack(track.id, !track.muted)} type="button" aria-label={`Mute ${name}`} title={`Mute ${name}`} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", (track.muted ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg"))}>
                                  {track.muted ? (
                                      <VolumeX size={12} aria-hidden />
                                    ) : (
                                      <Volume2 size={12} aria-hidden />
                                    )}
                                </ShadcnButton>
                                <ShadcnButton variant="ghost" size="sm"
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
                                </ShadcnButton>
                                <ShadcnButton variant="ghost" size="sm"
                                  type="button"
                                  aria-label={`Solo safe ${name}`}
                                  title="Solo safe: stays audible when other tracks are soloed"
                                  aria-pressed={!!track.soloSafe}
                                  onClick={() => void setTrackSoloSafe(track.id, !track.soloSafe)}
                                  className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[10px] font-black transition-colors ${
                                    track.soloSafe
                                      ? "bg-accent text-bg hover:bg-accent/90"
                                      : "text-fg-muted hover:bg-hover hover:text-fg"
                                  }`}
                                >
                                  SF
                                </ShadcnButton>
                              </>
                            ) : null}
                            <ShadcnButton variant="ghost" size="icon-sm" aria-pressed={track.locked} onClick={() => void lockTrack(track.id, !track.locked)} type="button" aria-label={`Lock ${name}`} title={`Lock ${name}`} className={cn("inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", "h-7 w-7", (track.locked ? "border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg" : "bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg"))}>
                              {track.locked ? (
                                  <Unlock size={12} aria-hidden />
                                ) : (
                                  <Lock size={12} aria-hidden />
                                )}
                            </ShadcnButton>
                            <ShadcnButton variant="ghost" size="icon-sm" onClick={() =>
                                index > 0 && reorderTrack(track.id, index - 1)
                              } type="button" aria-label={`Move ${name} up`} title={`Move ${name} up`} disabled={(index === 0)} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<ChevronUp size={12} aria-hidden />}
                            </ShadcnButton>
                            <ShadcnButton variant="ghost" size="icon-sm" onClick={() =>
                                index < tracks.length - 1 &&
                                reorderTrack(track.id, index + 1)
                              } type="button" aria-label={`Move ${name} down`} title={`Move ${name} down`} disabled={(index === tracks.length - 1)} className="inline-flex shrink-0 items-center justify-center rounded-[7px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-7 w-7 bg-transparent text-fg-muted hover:bg-bg-2 hover:text-fg">
                              {<ChevronDown size={12} aria-hidden />}
                            </ShadcnButton>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
          </PopoverContent>
        </ShadcnPopover>

        <CaptionBatchSelectButton />

        <div className="ml-auto flex items-center gap-3">
          {/* Zoom control (mock: minus / emerald slider track + knob / plus) */}
          <div className="flex items-center gap-2.5">
            <TLTool onClick={zoomOut} title="Zoom out">
              <ZoomOut size={16} aria-hidden />
            </TLTool>
            <Slider
              aria-label="Advanced timeline zoom"
              aria-valuetext={`${Math.round(pixelsPerSecond)} pixels per second`}
              min={ZOOM_PRESETS.MIN}
              max={ZOOM_PRESETS.MAX}
              step={1}
              value={[pixelsPerSecond]}
              onValueChange={([value]) => setZoom(value)}
              className="workspace-timeline-advanced-zoom"
            />
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
              onClick={toggleScrubAudio}
              active={scrubAudio}
              title={scrubAudio ? "Audio scrubbing on" : "Audio scrubbing off"}
            >
              {scrubAudio ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </TLTool>

            <TLTool
              onClick={() => {
                if (phone) { setPhoneTrackScale(1.35); return; }
                setTrackHeight(64);
                useTimelineStore.setState({ trackHeights: {} });
              }}
              active={phone ? phoneTrackScale > 1 : trackHeight >= 52}
              title="Large tracks"
            >
              <Rows3 size={16} />
            </TLTool>
            <TLTool
              onClick={() => {
                if (phone) { setPhoneTrackScale(1); return; }
                setTrackHeight(40);
                useTimelineStore.setState({ trackHeights: {} });
              }}
              active={phone ? phoneTrackScale === 1 : trackHeight < 52}
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
      </div></div>
          </PopoverContent>
        </ShadcnPopover>
        <RenderCacheControls />
        <div className="workspace-timeline-summary">{tracks.length} tracks · {project.timeline.duration > 0 ? `${tracks.reduce((sum,track) => sum+track.clips.length,0)+(project.textClips?.length??0)+(project.shapeClips?.length??0)+(project.svgClips?.length??0)+(project.stickerClips?.length??0)} clips` : "empty"}</div>
        <Slider aria-label="Timeline zoom" className="workspace-timeline-zoom" min={ZOOM_PRESETS.MIN} max={ZOOM_PRESETS.MAX} value={[pixelsPerSecond]} onValueChange={([value]) => setZoom(value)} />
      </div>
  );

  return (
    <div
      data-tour="timeline"
      data-phone-timeline={phone || undefined}
      className="h-full bg-tl-bg flex flex-col min-h-0 relative overflow-hidden"
    >
      {!phone && <SequenceTabs />}
      {/* ── Timeline toolbar (mock: 48px line-icon tools + emerald zoom slider) ── */}
      {phone ? <ShadcnPopover open={phoneOptionsOpen} onOpenChange={setPhoneOptionsOpen}>
        <PopoverTrigger asChild><ShadcnButton type="button" variant="ghost" size="icon" className="mobile-timeline-add" aria-label="Add media or open timeline tools"><Plus size={20} aria-hidden /></ShadcnButton></PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="mobile-timeline-options">
          {onOpenMedia && <ShadcnButton type="button" variant="secondary" className="mobile-timeline-import" onClick={() => { setPhoneOptionsOpen(false); useEditorWorkspaceStore.getState().setSection("media"); onOpenMedia(); }}><Plus size={16} aria-hidden />Add media</ShadcnButton>}
          <TimelineRangeActions duration={project.timeline.duration} frameRate={project.settings.frameRate} />
          {timelineToolbar}
        </PopoverContent>
      </ShadcnPopover> : timelineToolbar}

      <div
        ref={containerRef}
        className="workspace-timeline-content flex-1 flex flex-col overflow-hidden relative"
        onClick={handleBackgroundClick}
      >
        <div className="workspace-timeline-ruler-row flex shrink-0">
          <div hidden={phone} style={{ width: headerWidth, height: (compact ? 44 : 26) + RENDER_STATUS_BAR_HEIGHT, paddingTop: RENDER_STATUS_BAR_HEIGHT }} className="bg-bg-1 border-b border-r border-border shrink-0">
            <TimelineRangeActions duration={project.timeline.duration} frameRate={project.settings.frameRate} />
          </div>
          <div className="flex-1 overflow-hidden relative bg-bg-1">
            <div
              style={{
                width: `${timelineDuration * pixelsPerSecond}px`,
                transform: `translateX(${-scrollX}px)`,
              }}
            >
              <RenderStatusBar pixelsPerSecond={pixelsPerSecond} width={timelineDuration * pixelsPerSecond} />
              <TimeRuler
                duration={timelineDuration}
                phone={phone}
                rangeDuration={project.timeline.duration}
                frameRate={project.settings.frameRate}
                pixelsPerSecond={pixelsPerSecond}
                scrollX={scrollX}
                viewportWidth={viewportWidth}
                snapPoints={playheadSnapPoints}
                markers={project.timeline.markers}
                selectedMarkerId={selectedMarkerId}
                onCreateRangeMarker={(start, end) => { void addRangeMarker(start, end); }}
                onMarkerSelect={setSelectedMarkerId}
                onMarkerEdit={editMarker}
                onMarkerRemove={removeMarker}
                onMarkerUpdate={updateMarker}
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
            hidden={phone}
            style={{ width: headerWidth }}
            className="bg-bg-1 border-r border-border shrink-0 z-20 overflow-y-auto overflow-x-hidden scrollbar-none overscroll-contain"
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
                      active={track.id === primarySelectedTrackId}
                      audioDivider={audioDividerTrackIds.has(track.id)}
                      index={i}
                      onDragStart={handleTrackDragStart}
                      onDragOver={handleTrackDragOver}
                      onDrop={handleTrackDrop}
                      onDragEnd={stopTrackDrag}
                      keyframeCount={keyframeCount}
                    />
                    {!phone && automationLaneTracks[track.id] ? <TrackAutomationHeaderRows track={track} /> : null}
                  </div>
                );
              })}
              <ShadcnButton variant="ghost" size="sm"
                type="button"
                onClick={() =>
                  addTrack("video", undefined, { mode: "standard" })
                }
                className="mx-3 my-1 h-7 flex items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong text-fg-muted hover:text-fg-2 hover:border-fg-3 transition-colors"
                aria-label="Add track"
              >
                <Plus size={16} aria-hidden />
              </ShadcnButton>
              <div
                aria-hidden="true"
                style={{ height: TIMELINE_SCROLLBAR_SIZE }}
              />
            </div>
          </div>

          <div
            ref={tracksRef}
            data-testid="timeline-tracks-scroll"
            data-timeline-tool={tool}
            {...navTools.handlers}
            className="workspace-timeline-scroll flex-1 bg-background relative overflow-auto custom-scrollbar"
            onScroll={(e) => {
              setScrollX(e.currentTarget.scrollLeft);
              onPhoneScroll(e.currentTarget.scrollLeft);
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
              const x = e.clientX - rect.left + (tracksRef.current?.scrollLeft ?? 0) - timelineInset;
              const playheadPosition = useTimelineStore.getState().playheadPosition;
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
                        await placeMediaClip(newItem.id, undefined, snappedTime);
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
                if (typeof data?.sequenceId === "string") {
                  void placeSequenceOnTimeline(data.sequenceId, undefined, snappedTime);
                  return;
                }
                if (!data?.mediaId) return;
                // Source-monitor drags only land on a track lane.
                if (data.sourceMonitor === true) return;
                handleDropMedia("", data.mediaId, snappedTime);
              } catch {
                // ignore
              }
            }}
          >
            {project.timeline.duration === 0 && <div className="workspace-timeline-empty" aria-hidden="true"><MediaLibraryIcon name="stock-start" /><strong>Drag clips here to start your sequence</strong><span>Or use + on anything in the media bin · Press {keyboardShortcuts.formatShortcut("playback.markLoopStart") || keyboardShortcuts.formatShortcut("file.import")} to import</span></div>}
            <div
              style={{ width: `${timelineDuration * pixelsPerSecond + timelineInset * 2}px`, paddingLeft: timelineInset, paddingRight: timelineInset }}
              className="workspace-timeline-lanes min-w-full min-h-full relative"
            >

              {navTools.zoomBand ? (
                <div
                  data-testid="timeline-zoom-band"
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 bottom-0 z-40 border-x border-accent bg-accent/15"
                  style={{ left: navTools.zoomBand.left + timelineInset, width: navTools.zoomBand.width }}
                />
              ) : null}
              {visualOrderTracks.map((track) => (
                <Fragment key={track.id}>
                <TrackLane
                  track={track}
                  phone={phone}
                  audioDivider={audioDividerTrackIds.has(track.id)}
                  phoneTrackScale={phoneTrackScale}
                  trackTopInset={phone ? 6 : 0}
                  allTracks={visualOrderTracks}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedClipIds={laneSelectedIds.get(track.id) ?? NO_SELECTED_CLIPS}
                  textClips={textClipsByTrack.get(track.id)!}
                  shapeClips={shapeClipsByTrack.get(track.id)!}
                  graphics={graphicsByTrack.get(track.id) ?? NO_GRAPHICS}
                  trackHeights={trackHeightsMap}
                  rowHeights={rowHeightsMap}
                  timelineRef={tracksRef}
                  onSelectClip={handleSelectClip}
                  onDropMedia={handleDropMedia}
                  onMoveClip={handleMoveClip}
                  onSnapIndicator={handleSnapIndicator}
                  onTrimClip={handleTrimClip}
                  onTrimTextClip={handleTrimTextClip}
                  onMoveTextClip={handleMoveTextClip}
                  onTrimShapeClip={handleTrimShapeClip}
                  scrollX={Math.floor((phone ? phoneDecorationScroll(scrollX) : scrollX) / LANE_SCROLL_BUCKET) * LANE_SCROLL_BUCKET}
                  trackHeight={getTrackHeight(track.id, track.type, track.name)}
                  onResizeTrack={setTrackHeightById}
                  onKeyframeSelect={handleKeyframeSelect}
                  onKeyframeMove={handleKeyframeMove}
                  onKeyframeDelete={handleKeyframeDelete}
                  selectedKeyframeIds={selectedKeyframeIds}
                  onSelectTransition={handleSelectTransition}
                  selectedTransitionId={selectedTransitionId}
                />
                {!phone && automationLaneTracks[track.id] ? (
                  <TrackAutomationRows track={track} pixelsPerSecond={pixelsPerSecond} width={Math.max(1, timelineDuration * pixelsPerSecond)} />
                ) : null}
                </Fragment>
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
                originX={timelineInset}
              />

              {project.timeline.markers.map((marker) => (
                <MarkerIndicator
                  key={marker.id}
                  marker={marker}
                  pixelsPerSecond={pixelsPerSecond}
                  scrollX={-timelineInset}
                  selected={selectedMarkerId === marker.id}
                  frameRate={project.settings.frameRate}
                  onSeek={(time) => {
                    const bridge = getPlaybackBridge();
                    bridge.scrubTo(time);
                  }}
                  onSelect={setSelectedMarkerId}
                  onEdit={editMarker}
                  onRemove={removeMarker}
                  onUpdate={updateMarker}
                />
              ))}

              {snapIndicatorTime !== null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-yellow-400 z-30 pointer-events-none"
                  style={{ left: `${snapIndicatorTime * pixelsPerSecond + timelineInset}px` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-400 rounded-full" />
                </div>
              )}

              {isBoxSelecting && selectionBox && (
                <div
                  className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-40"
                  style={{
                    left:
                      Math.min(selectionBox.startX, selectionBox.currentX) + timelineInset,
                    top:
                      Math.min(selectionBox.startY, selectionBox.currentY),
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

        {!phone && <RemotePlayheads pixelsPerSecond={pixelsPerSecond} scrollX={scrollX} headerOffset={headerWidth} />}
        <Playhead
          pixelsPerSecond={pixelsPerSecond}
          scrollX={scrollX}
          headerOffset={headerWidth}
          phone={phone}
          phoneHeight={Math.max(166, totalTracksHeight + 6)}
        />
      </div>
      {phone && project.timeline.duration > 0 && selectedClipIds.length === 0 && <div className="mobile-timeline-hint" style={{ top: Math.max(200, totalTracksHeight + 40) }}>Tap a clip to edit it · Pinch to zoom</div>}
      {!compact && <StereoOutputMeters />}
    </div>
  );
};
