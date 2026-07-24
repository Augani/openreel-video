import type { JSX } from "react";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Clock3,
  ClipboardPaste,
  Clapperboard,
  Film,
  CornerDownLeft,
  CornerDownRight,
  Copy,
  Crosshair,
  Delete,
  Diamond,
  Eye,
  EyeOff,
  Flag,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Lock,
  MoveHorizontal,
  Music2,
  Play,
  Ruler,
  Search,
  Scissors,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Star,
  Trash2,
  Type,
  Unlock,
  Volume2,
  VolumeX,
  VenetianMask,
  Box,
  ZoomIn,
  ZoomOut,
  X,
} from "@/icons/lucide-compat";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  alignMotionLayersToTime,
  addMotionCompositionMarker,
  copyMotionLayersToClipboard,
  createDefaultMotionCamera,
  createMotionMarker,
  duplicateMotionLayers,
  duplicateMotionAudioClip,
  duplicateMotionKeyframes,
  findMotionLayerKeyframeAtTime,
  findMotionCameraKeyframeAtTime,
  findMotionLightKeyframeAtTime,
  fitMotionLayersToRange,
  getMotionCameraPropertyKeyframes,
  getMotionCameraPropertyValue,
  getMotionLightAtTime,
  getMotionLightPropertyDescriptor,
  getMotionLightPropertyKeyframes,
  getMotionLightPropertyValue,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerMaskPropertyDescriptors,
  getMotionLayerPuppetPropertyDescriptors,
  getMotionLayerShapeModifierPropertyDescriptors,
  getMotionLayerContentsPropertyDescriptors,
  getMotionLayerPropertyKeyframes,
  getMotionMaskPathKeyframeProperty,
  getMotionPropertyDescriptor,
  getMotionLayerPropertyValueAtTime,
  isMotionAnimatableProperty,
  parseMotionMaskPathKeyframeProperty,
  isMotionCameraProperty,
  isMotionLightProperty,
  moveMotionLayerInTime,
  moveMotionAudioClipInTime,
  normalizeMotionCamera,
  hasActiveMotionCamera,
  motionLayerMayUse3D,
  normalizeMotionLights,
  offsetMotionKeyframes,
  pasteMotionLayersFromClipboard,
  removeMotionCameraKeyframe,
  removeMotionLightKeyframe,
  removeMotionCompositionMarker,
  removeMotionLayers,
  removeMotionLayerKeyframe,
  rippleDeleteMotionLayer,
  rippleMotionLayers,
  sequenceMotionLayers,
  setMotionLayersLocked,
  snapMotionTimeToTimingPoint,
  splitMotionLayerAtTime,
  splitMotionAudioClipAtTime,
  staggerMotionLayers,
  trimMotionLayerInPoint,
  trimMotionLayerOutPoint,
  trimMotionAudioClipInPoint,
  trimMotionAudioClipOutPoint,
  upsertMotionCameraKeyframe,
  upsertMotionLightKeyframe,
  upsertMotionLayerKeyframe,
  updateMotionCompositionMarker,
  MOTION_BLEND_MODE_OPTIONS,
  type MotionBlendModeOption,
  type MotionCamera,
  type MotionAudioClip,
  type MotionCameraProperty,
  type MotionComposition,
  type MotionLight,
  type MotionLightProperty,
  type MotionLayer,
  type MotionLayerClipboard,
  type MotionLayerType,
} from "@openreel/core";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  formatMotionFps,
  formatMotionFrameLabel,
  formatMotionTimecode,
} from "../motion-timecode";
import {
  getFrameCacheState,
  subscribeFrameCacheState,
} from "../frame-cache-state";
import type { CachedRange } from "../frame-cache";
import { Button, ColorInput, IconButton, NumberInput } from "./primitives";

interface MotionTimelineProps {
  composition: MotionComposition;
}

type TimingDragMode = "move" | "trim-start" | "trim-end";

interface TimingDragState {
  readonly layerId: string;
  readonly pointerId: number;
  readonly mode: TimingDragMode;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalLayer: MotionLayer;
  readonly baseline: MotionComposition;
}

interface AudioTimingDragState {
  readonly clipId: string;
  readonly pointerId: number;
  readonly mode: TimingDragMode;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalClip: MotionAudioClip;
  readonly baseline: MotionComposition;
}

interface KeyframeTimingDragState {
  readonly layerId: string;
  readonly keyframeId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalLayer: MotionLayer;
  readonly originalTime: number;
  readonly baseline: MotionComposition;
  readonly selectedKeyframeIds: readonly string[];
  hasMoved: boolean;
}

interface MaskPathKeyframeTimingDragState {
  readonly layerId: string;
  readonly maskId: string;
  readonly keyframeId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalLayer: MotionLayer;
  readonly originalTime: number;
  readonly baseline: MotionComposition;
  readonly selectedKeyframeIds: readonly string[];
  hasMoved: boolean;
}

interface CameraKeyframeTimingDragState {
  readonly keyframeId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalCamera: MotionCamera;
  readonly originalTime: number;
  readonly baseline: MotionComposition;
  readonly selectedKeyframeIds: readonly string[];
  hasMoved: boolean;
}

interface LightKeyframeTimingDragState {
  readonly lightId: string;
  readonly keyframeId: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly laneWidth: number;
  readonly snapThreshold: number;
  readonly originalLight: MotionLight;
  readonly originalTime: number;
  readonly baseline: MotionComposition;
  readonly selectedKeyframeIds: readonly string[];
  hasMoved: boolean;
}

const RAIL_WIDTH = 380;
const TIMELINE_ROW_HEIGHT = 34;
const TIMELINE_RAIL_COLUMNS = "2rem minmax(8rem,1fr) 5rem 5.25rem 3.5rem";

type TimelineLayerFilter = "all" | "selected" | "animated";

const motionLayerMatchesQuery = (layer: MotionLayer, query: string): boolean => {
  if (!query) return true;
  const searchable = [
    layer.name,
    layer.type,
    ...(layer.effects ?? []).flatMap((effect) => [effect.name, effect.type]),
    ...(layer.expressions ?? []).flatMap((expression) => [
      expression.name,
      expression.property,
      expression.type,
    ]),
    ...(layer.type === "text" ? [layer.text] : []),
  ];
  return searchable.some((value) => value.toLowerCase().includes(query));
};

const motionLayerIsAnimated = (layer: MotionLayer): boolean =>
  layer.keyframes.length > 0 ||
  (layer.expressions ?? []).some((expression) => expression.enabled) ||
  (layer.type === "text" &&
    (layer.textAnimators ?? []).some((animator) => animator.enabled)) ||
  layer.type === "particle";

const TRACK_COLOR: Record<MotionLayerType, string> = {
  text: "bg-clip-text",
  shape: "bg-accent",
  image: "bg-clip-video",
  video: "bg-clip-video",
  group: "bg-clip-music",
  null: "bg-accent",
  composition: "bg-status-info",
  adjustment: "bg-status-warning",
  particle: "bg-status-info",
  scene3d: "bg-accent",
};

const BAR_COLOR: Record<MotionLayerType, string> = {
  text: "#34d399",
  shape: "#e8a44a",
  image: "#6a9bd8",
  video: "#6a9bd8",
  group: "#14b8a6",
  null: "#14b8a6",
  composition: "#6a9bd8",
  adjustment: "#e8a44a",
  particle: "#34d399",
  scene3d: "#6a9bd8",
};

const BAR_LABEL_COLOR: Record<MotionLayerType, string> = {
  text: "#065f46",
  shape: "#7a4a10",
  image: "#2a4a7a",
  video: "#2a4a7a",
  group: "#0f766e",
  null: "#0f766e",
  composition: "#2a4a7a",
  adjustment: "#7a4a10",
  particle: "#065f46",
  scene3d: "#2a4a7a",
};

const TRACK_ICON: Record<MotionLayerType, typeof Type> = {
  text: Type,
  shape: Square,
  image: ImageIcon,
  video: Film,
  group: Layers,
  null: Crosshair,
  composition: Clapperboard,
  adjustment: SlidersHorizontal,
  particle: Sparkles,
  scene3d: Box,
};

const PROPERTY_LANE_COLOR_FALLBACK = "#9aa0a6";

const motionPropertyLaneColor = (property: string): string => {
  if (property.includes("position")) return "#6a9bd8";
  if (property.includes("scale")) return "#e8a44a";
  if (property.includes("rotation")) return "#14b8a6";
  if (property.includes("opacity")) return "#34d399";
  if (property.includes("anchor")) return "#6a9bd8";
  return PROPERTY_LANE_COLOR_FALLBACK;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const TIMELINE_ZOOM_MIN = 1;
const TIMELINE_ZOOM_MAX = 8;
const TIMELINE_BASE_MIN_WIDTH = 1040;
const TIMELINE_BASE_LANE_WIDTH = 688;

const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frac = Math.floor((safe % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${frac.toString().padStart(2, "0")}`;
};

const CAMERA_PROPERTY_LABELS: Record<MotionCameraProperty, string> = {
  "camera.position.x": "Camera X",
  "camera.position.y": "Camera Y",
  "camera.position.z": "Camera Depth",
  "camera.zoom": "Camera Zoom",
  "camera.rotation": "Camera Roll",
  "camera.perspective": "Camera Perspective",
  "camera.focusDistance": "Focus Distance",
  "camera.aperture": "Camera Aperture",
  "camera.maxBlur": "Max Blur",
};

const formatCameraProperty = (
  property: MotionCameraProperty | null,
): string => (property ? CAMERA_PROPERTY_LABELS[property] : "Camera");

const formatLightProperty = (property: MotionLightProperty | null): string =>
  property ? getMotionLightPropertyDescriptor(property).label : "Light";

const tickStep = (duration: number) => {
  if (duration <= 6) return 0.5;
  if (duration <= 12) return 1;
  if (duration <= 30) return 2;
  return 5;
};

export function MotionTimeline({ composition }: MotionTimelineProps): JSX.Element {
  const [timingMenuOpen, setTimingMenuOpen] = useState(false);
  const [sequenceGap, setSequenceGap] = useState(0.1);
  const [staggerOffset, setStaggerOffset] = useState(0.12);
  const [railTab, setRailTab] = useState<"layers" | "composition">("layers");
  const [layerFilter, setLayerFilter] = useState<TimelineLayerFilter>("all");
  const [layerQuery, setLayerQuery] = useState("");
  const selectedAudioClipId = useMotionStore(
    (state) => state.selectedAudioClipId,
  );
  const setSelectedAudioClipId = useMotionStore(
    (state) => state.selectAudioClip,
  );
  const playhead = useMotionStore((state) => state.playhead);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const snapEnabled = useMotionStore((state) => state.snapEnabled);
  const workAreaStart = useMotionStore((state) => state.workAreaStart);
  const workAreaEnd = useMotionStore((state) => state.workAreaEnd);
  const setWorkArea = useMotionStore((state) => state.setWorkArea);
  const clearWorkArea = useMotionStore((state) => state.clearWorkArea);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const selectedKeyframeIds = useMotionStore(
    (state) => state.selectedKeyframeIds,
  );
  const selectedLightId = useMotionStore((state) => state.selectedLightId);
  const selectedProperty = useMotionStore((state) => state.selectedProperty);
  const revealedProperties = useMotionStore((state) => state.revealedProperties);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const toggleLayerSelection = useMotionStore(
    (state) => state.toggleLayerSelection,
  );
  const selectLight = useMotionStore((state) => state.selectLight);
  const setSelectedLayers = useMotionStore((state) => state.setSelectedLayers);
  const setSelectedKeyframes = useMotionStore(
    (state) => state.setSelectedKeyframes,
  );
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const timelineColumnMode = useMotionStore((state) => state.timelineColumnMode);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const updateMotionCompositionPreview = useProjectStore(
    (state) => state.updateMotionCompositionPreview,
  );
  const commitMotionCompositionGesture = useProjectStore(
    (state) => state.commitMotionCompositionGesture,
  );
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [rippleEnabled, setRippleEnabled] = useState(false);
  const [expandedLayerIds, setExpandedLayerIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const toggleLayerExpanded = (layerId: string) => {
    setExpandedLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };
  const laneRef = useRef<HTMLDivElement>(null);
  const timingDragRef = useRef<TimingDragState | null>(null);
  const audioTimingDragRef = useRef<AudioTimingDragState | null>(null);
  const keyframeTimingDragRef = useRef<KeyframeTimingDragState | null>(null);
  const maskPathKeyframeTimingDragRef =
    useRef<MaskPathKeyframeTimingDragState | null>(null);
  const cameraKeyframeTimingDragRef =
    useRef<CameraKeyframeTimingDragState | null>(null);
  const lightKeyframeTimingDragRef =
    useRef<LightKeyframeTimingDragState | null>(null);
  const suppressNextKeyframeClickRef = useRef(false);
  const gestureBaselineRef = useRef<MotionComposition | null>(null);
  const layerClipboardRef = useRef<MotionLayerClipboard | null>(null);
  const audioClipboardRef = useRef<MotionAudioClip | null>(null);
  const keyframeClipboardRef = useRef<string[]>([]);
  const [timelineClipboardKind, setTimelineClipboardKind] = useState<
    "layers" | "keyframes" | "audio" | null
  >(null);
  const latestCompositionRef = useRef<MotionComposition>(composition);
  latestCompositionRef.current = composition;

  const cacheRanges = useSyncExternalStore(
    subscribeFrameCacheState,
    () => getFrameCacheState().ranges,
    () => getFrameCacheState().ranges,
  );

  const duration = Math.max(composition.duration, 0.001);
  const selectedKeyframeIdSet = new Set(selectedKeyframeIds);

  const nextTimelineKeyframeSelection = (
    keyframeId: string,
    event: Pick<
      ReactPointerEvent<HTMLElement>,
      "metaKey" | "ctrlKey" | "shiftKey"
    >,
  ): string[] => {
    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    if (!additive) {
      return selectedKeyframeIdSet.has(keyframeId)
        ? selectedKeyframeIds
        : [keyframeId];
    }
    return selectedKeyframeIdSet.has(keyframeId)
      ? selectedKeyframeIds.filter((id) => id !== keyframeId)
      : [...selectedKeyframeIds, keyframeId];
  };

  const selectTimelineKeyframe = (
    keyframeId: string,
    event: Pick<
      ReactPointerEvent<HTMLElement>,
      "metaKey" | "ctrlKey" | "shiftKey"
    >,
  ) => {
    setSelectedKeyframes(nextTimelineKeyframeSelection(keyframeId, event));
  };

  const selectKeyboardActivatedKeyframe = (
    keyframeId: string,
    event: { detail: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => {
    if (event.detail === 0) selectTimelineKeyframe(keyframeId, event);
  };
  const activeWorkAreaStart = clamp(workAreaStart ?? 0, 0, duration);
  const activeWorkAreaEnd = clamp(workAreaEnd ?? duration, activeWorkAreaStart, duration);
  const hasCustomWorkArea = workAreaStart !== null || workAreaEnd !== null;

  const snapThresholdForWidth = (width: number): number =>
    Math.min(0.12, Math.max(0.025, (duration / width) * 10));

  const snapTime = (time: number, threshold: number): number => {
    const clamped = clamp(time, 0, duration);
    if (!snapEnabled) {
      return clamped;
    }
    return clamp(
      snapMotionTimeToTimingPoint(clamped, {
        markers: composition.markers,
        beatMarkers: composition.beatMarkers,
        threshold,
      }),
      0,
      duration,
    );
  };

  const updateComposition = (nextComposition: MotionComposition) => {
    latestCompositionRef.current = nextComposition;
    if (gestureBaselineRef.current) {
      updateMotionCompositionPreview(nextComposition);
      return;
    }
    void upsertMotionComposition(nextComposition);
  };

  const beginTimelineGesture = () => {
    if (gestureBaselineRef.current === null) {
      gestureBaselineRef.current = latestCompositionRef.current;
    }
  };

  const endTimelineGesture = () => {
    const baseline = gestureBaselineRef.current;
    gestureBaselineRef.current = null;
    if (baseline) {
      void commitMotionCompositionGesture(baseline, latestCompositionRef.current);
    }
  };

  const replaceLayer = (nextLayer: MotionLayer) => {
    updateComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const patchTimelineLayer = (
    layerId: string,
    updates: Partial<MotionLayer>,
  ) => {
    updateComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === layerId ? ({ ...layer, ...updates } as MotionLayer) : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const replaceCamera = (nextCamera: MotionCamera) => {
    updateComposition({
      ...composition,
      camera: nextCamera,
      modifiedAt: Date.now(),
    });
  };

  const replaceLight = (nextLight: MotionLight) => {
    updateComposition({
      ...composition,
      lights: normalizeMotionLights(composition).map((light) =>
        light.id === nextLight.id ? nextLight : light,
      ),
      modifiedAt: Date.now(),
    });
  };

  const selectTimelineLayer = (
    layerId: string,
    event?: Pick<ReactPointerEvent<HTMLElement>, "metaKey" | "ctrlKey" | "shiftKey">,
  ) => {
    if (event?.metaKey || event?.ctrlKey || event?.shiftKey) {
      toggleLayerSelection(layerId);
      return;
    }
    setSelectedAudioClipId(null);
    setSelectedLayers([layerId]);
    setRightTab("properties");
  };

  const seekToClientX = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const rawTime = ratio * duration;
    setPlayhead(snapTime(rawTime, snapThresholdForWidth(rect.width)));
  };

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToClientX(event.clientX);
  };

  const continueScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1) return;
    seekToClientX(event.clientX);
  };

  const beginTimingDrag = (
    layer: MotionLayer,
    mode: TimingDragMode,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!selectedLayerIds.includes(layer.id)) {
      selectLayer(layer.id);
    }
    timingDragRef.current = {
      layerId: layer.id,
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalLayer: layer,
      baseline: composition,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = timingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = ((event.clientX - drag.startClientX) / drag.laneWidth) * duration;
    const originalEnd =
      drag.originalLayer.startTime + drag.originalLayer.duration;
    const timingOptions = {
      compositionDuration: composition.duration,
      frameRate: composition.frameRate,
    };
    let nextLayer: MotionLayer;

    if (drag.mode === "trim-start") {
      nextLayer = trimMotionLayerInPoint(
        drag.originalLayer,
        snapTime(drag.originalLayer.startTime + delta, drag.snapThreshold),
        timingOptions,
      );
    } else if (drag.mode === "trim-end") {
      nextLayer = trimMotionLayerOutPoint(
        drag.originalLayer,
        snapTime(originalEnd + delta, drag.snapThreshold),
        timingOptions,
      );
    } else {
      nextLayer = moveMotionLayerInTime(
        drag.originalLayer,
        snapTime(drag.originalLayer.startTime + delta, drag.snapThreshold),
        timingOptions,
      );
    }

    if (rippleEnabled && (drag.mode === "move" || drag.mode === "trim-end")) {
      const originalEndTime =
        drag.originalLayer.startTime + drag.originalLayer.duration;
      const rippleDelta =
        drag.mode === "trim-end"
          ? nextLayer.startTime + nextLayer.duration - originalEndTime
          : nextLayer.startTime - drag.originalLayer.startTime;
      const withDraggedLayer: MotionComposition = {
        ...drag.baseline,
        layers: drag.baseline.layers.map((layer) =>
          layer.id === nextLayer.id ? nextLayer : layer,
        ),
        modifiedAt: Date.now(),
      };
      updateComposition(
        rippleMotionLayers(withDraggedLayer, {
          fromTime: originalEndTime,
          deltaSeconds: rippleDelta,
          excludeLayerIds: [nextLayer.id],
          frameRate: composition.frameRate,
          compositionDuration: composition.duration,
        }),
      );
      return;
    }

    replaceLayer(nextLayer);
  };

  const endTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (timingDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      timingDragRef.current = null;
      endTimelineGesture();
    }
  };

  const selectAudioClip = (clipId: string) => {
    setSelectedAudioClipId(clipId);
    setRightTab("sync");
  };

  const patchAudioClip = (
    clipId: string,
    updater: (clip: MotionAudioClip) => MotionAudioClip,
    baseline = composition,
  ) => {
    updateComposition({
      ...baseline,
      audioClips: (baseline.audioClips ?? []).map((clip) =>
        clip.id === clipId ? updater(clip) : clip,
      ),
      modifiedAt: Date.now(),
    });
  };

  const removeAudioClip = (clipId: string) => {
    updateComposition({
      ...composition,
      audioClips: (composition.audioClips ?? []).filter(
        (clip) => clip.id !== clipId,
      ),
      modifiedAt: Date.now(),
    });
    if (selectedAudioClipId === clipId) setSelectedAudioClipId(null);
  };

  const beginAudioTimingDrag = (
    clip: MotionAudioClip,
    mode: TimingDragMode,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectAudioClip(clip.id);
    audioTimingDragRef.current = {
      clipId: clip.id,
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalClip: clip,
      baseline: composition,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateAudioTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = audioTimingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = ((event.clientX - drag.startClientX) / drag.laneWidth) * duration;
    const timingOptions = {
      compositionDuration: composition.duration,
      frameRate: composition.frameRate,
    };
    const originalEnd =
      drag.originalClip.startTime + drag.originalClip.duration;
    const nextClip =
      drag.mode === "trim-start"
        ? trimMotionAudioClipInPoint(
            drag.originalClip,
            snapTime(
              drag.originalClip.startTime + delta,
              drag.snapThreshold,
            ),
            timingOptions,
          )
        : drag.mode === "trim-end"
          ? trimMotionAudioClipOutPoint(
              drag.originalClip,
              snapTime(originalEnd + delta, drag.snapThreshold),
              timingOptions,
            )
          : moveMotionAudioClipInTime(
              drag.originalClip,
              snapTime(
                drag.originalClip.startTime + delta,
                drag.snapThreshold,
              ),
              timingOptions,
            );
    patchAudioClip(drag.clipId, () => nextClip, drag.baseline);
  };

  const endAudioTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (audioTimingDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    audioTimingDragRef.current = null;
    endTimelineGesture();
  };

  const beginKeyframeTimingDrag = (
    layer: MotionLayer,
    keyframe: MotionLayer["keyframes"][number],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(layer.id);
    setSelectedProperty(keyframe.property);
    const dragSelection = nextTimelineKeyframeSelection(keyframe.id, event);
    setSelectedKeyframes(dragSelection);
    keyframeTimingDragRef.current = {
      layerId: layer.id,
      keyframeId: keyframe.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalLayer: layer,
      originalTime: keyframe.time,
      baseline: latestCompositionRef.current,
      selectedKeyframeIds: dragSelection.includes(keyframe.id)
        ? dragSelection
        : [keyframe.id],
      hasMoved: false,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateKeyframeTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = keyframeTimingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelDelta = event.clientX - drag.startClientX;
    if (Math.abs(pixelDelta) > 2) {
      drag.hasMoved = true;
    }
    const delta = (pixelDelta / drag.laneWidth) * duration;
    const snappedGlobalTime = snapTime(
      drag.originalLayer.startTime + drag.originalTime + delta,
      drag.snapThreshold,
    );
    const requestedDelta =
      snappedGlobalTime -
      (drag.originalLayer.startTime + drag.originalTime);
    const result = offsetMotionKeyframes(
      drag.baseline,
      drag.selectedKeyframeIds,
      requestedDelta,
    );
    updateComposition(result.composition);
    setPlayhead(
      clamp(
        drag.originalLayer.startTime + drag.originalTime + result.appliedDelta,
        0,
        duration,
      ),
    );
  };

  const endKeyframeTimingDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = keyframeTimingDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextKeyframeClickRef.current = drag.hasMoved;
      if (drag.hasMoved) {
        window.setTimeout(() => {
          suppressNextKeyframeClickRef.current = false;
        }, 0);
      }
      keyframeTimingDragRef.current = null;
      endTimelineGesture();
    }
  };

  const beginMaskPathKeyframeTimingDrag = (
    layer: MotionLayer,
    maskId: string,
    keyframe: MotionLayerKeyframe,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectLayer(layer.id);
    setSelectedProperty(getMotionMaskPathKeyframeProperty(maskId));
    const dragSelection = nextTimelineKeyframeSelection(keyframe.id, event);
    setSelectedKeyframes(dragSelection);
    maskPathKeyframeTimingDragRef.current = {
      layerId: layer.id,
      maskId,
      keyframeId: keyframe.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalLayer: layer,
      originalTime: keyframe.time,
      baseline: latestCompositionRef.current,
      selectedKeyframeIds: dragSelection.includes(keyframe.id)
        ? dragSelection
        : [keyframe.id],
      hasMoved: false,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateMaskPathKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = maskPathKeyframeTimingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelDelta = event.clientX - drag.startClientX;
    if (Math.abs(pixelDelta) > 2) {
      drag.hasMoved = true;
    }
    const delta = (pixelDelta / drag.laneWidth) * duration;
    const snappedGlobalTime = snapTime(
      drag.originalLayer.startTime + drag.originalTime + delta,
      drag.snapThreshold,
    );
    const requestedDelta =
      snappedGlobalTime -
      (drag.originalLayer.startTime + drag.originalTime);
    const result = offsetMotionKeyframes(
      drag.baseline,
      drag.selectedKeyframeIds,
      requestedDelta,
    );
    updateComposition(result.composition);
    setPlayhead(
      clamp(
        drag.originalLayer.startTime + drag.originalTime + result.appliedDelta,
        0,
        duration,
      ),
    );
  };

  const endMaskPathKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = maskPathKeyframeTimingDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextKeyframeClickRef.current = drag.hasMoved;
      if (drag.hasMoved) {
        window.setTimeout(() => {
          suppressNextKeyframeClickRef.current = false;
        }, 0);
      }
      maskPathKeyframeTimingDragRef.current = null;
      endTimelineGesture();
    }
  };

  const selectCameraProperty = (property: MotionCameraProperty = "camera.zoom") => {
    selectLayer(null);
    setSelectedProperty(property);
    setRightTab("properties");
  };

  const beginCameraKeyframeTimingDrag = (
    keyframe: NonNullable<MotionCamera["keyframes"]>[number],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (isMotionCameraProperty(keyframe.property)) {
      selectCameraProperty(keyframe.property);
    }
    const dragSelection = nextTimelineKeyframeSelection(keyframe.id, event);
    setSelectedKeyframes(dragSelection);
    cameraKeyframeTimingDragRef.current = {
      keyframeId: keyframe.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalCamera: camera,
      originalTime: keyframe.time,
      baseline: latestCompositionRef.current,
      selectedKeyframeIds: dragSelection.includes(keyframe.id)
        ? dragSelection
        : [keyframe.id],
      hasMoved: false,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateCameraKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = cameraKeyframeTimingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelDelta = event.clientX - drag.startClientX;
    if (Math.abs(pixelDelta) > 2) {
      drag.hasMoved = true;
    }
    const delta = (pixelDelta / drag.laneWidth) * duration;
    const nextTime = snapTime(drag.originalTime + delta, drag.snapThreshold);
    const result = offsetMotionKeyframes(
      drag.baseline,
      drag.selectedKeyframeIds,
      nextTime - drag.originalTime,
    );
    updateComposition(result.composition);
    setPlayhead(
      clamp(drag.originalTime + result.appliedDelta, 0, duration),
    );
  };

  const endCameraKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = cameraKeyframeTimingDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextKeyframeClickRef.current = drag.hasMoved;
      if (drag.hasMoved) {
        window.setTimeout(() => {
          suppressNextKeyframeClickRef.current = false;
        }, 0);
      }
      cameraKeyframeTimingDragRef.current = null;
      endTimelineGesture();
    }
  };

  const selectLightProperty = (
    lightId: string,
    property: MotionLightProperty = "light.intensity",
  ) => {
    selectLight(lightId, property);
    setRightTab("properties");
  };

  const beginLightKeyframeTimingDrag = (
    light: MotionLight,
    keyframe: NonNullable<MotionLight["keyframes"]>[number],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (isMotionLightProperty(keyframe.property)) {
      selectLightProperty(light.id, keyframe.property);
    }
    const dragSelection = nextTimelineKeyframeSelection(keyframe.id, event);
    setSelectedKeyframes(dragSelection);
    lightKeyframeTimingDragRef.current = {
      lightId: light.id,
      keyframeId: keyframe.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      laneWidth: rect.width,
      snapThreshold: snapThresholdForWidth(rect.width),
      originalLight: light,
      originalTime: keyframe.time,
      baseline: latestCompositionRef.current,
      selectedKeyframeIds: dragSelection.includes(keyframe.id)
        ? dragSelection
        : [keyframe.id],
      hasMoved: false,
    };
    beginTimelineGesture();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateLightKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = lightKeyframeTimingDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelDelta = event.clientX - drag.startClientX;
    if (Math.abs(pixelDelta) > 2) {
      drag.hasMoved = true;
    }
    const delta = (pixelDelta / drag.laneWidth) * duration;
    const nextTime = snapTime(drag.originalTime + delta, drag.snapThreshold);
    const result = offsetMotionKeyframes(
      drag.baseline,
      drag.selectedKeyframeIds,
      nextTime - drag.originalTime,
    );
    updateComposition(result.composition);
    setPlayhead(
      clamp(drag.originalTime + result.appliedDelta, 0, duration),
    );
  };

  const endLightKeyframeTimingDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    const drag = lightKeyframeTimingDragRef.current;
    if (drag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextKeyframeClickRef.current = drag.hasMoved;
      if (drag.hasMoved) {
        window.setTimeout(() => {
          suppressNextKeyframeClickRef.current = false;
        }, 0);
      }
      lightKeyframeTimingDragRef.current = null;
      endTimelineGesture();
    }
  };

  const step = tickStep(duration);
  const ticks: number[] = [];
  for (let value = 0; value <= duration + 1e-6; value += step) {
    ticks.push(Number(value.toFixed(3)));
  }

  const playheadPct = (playhead / duration) * 100;

  const cacheFrameRate = composition.frameRate > 0 ? composition.frameRate : 30;
  const cacheBarSegments = cacheRanges
    .filter(
      (range: CachedRange) =>
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end >= range.start,
    )
    .map((range: CachedRange) => {
      const startTime = range.start / cacheFrameRate;
      const endTime = range.end / cacheFrameRate;
      const leftPct = clamp((startTime / duration) * 100, 0, 100);
      const widthPct = clamp(((endTime - startTime) / duration) * 100, 0, 100 - leftPct);
      return { key: `${range.start}-${range.end}`, leftPct, widthPct };
    });
  const selectedLayerIdSet = new Set(selectedLayerIds);
  const orderedLayers = [...composition.layers].reverse();
  const normalizedLayerQuery = layerQuery.trim().toLowerCase();
  const editableTimelineLayers = composition.hideShyLayers
    ? orderedLayers.filter((layer) => !layer.shy)
    : orderedLayers;
  const displayedLayers = editableTimelineLayers.filter((layer) => {
    if (!motionLayerMatchesQuery(layer, normalizedLayerQuery)) return false;
    if (layerFilter === "selected") return selectedLayerIdSet.has(layer.id);
    if (layerFilter === "animated") return motionLayerIsAnimated(layer);
    return true;
  });
  const timelineIsFiltered =
    normalizedLayerQuery.length > 0 || layerFilter !== "all";
  const layerById = new Map(composition.layers.map((layer) => [layer.id, layer]));
  const timelineLayerDepth = (layer: MotionLayer): number => {
    let depth = 0;
    let currentParentId = layer.parentId;
    const visited = new Set<string>();
    while (currentParentId && !visited.has(currentParentId) && depth < 3) {
      visited.add(currentParentId);
      depth += 1;
      currentParentId = layerById.get(currentParentId)?.parentId;
    }
    return depth;
  };
  const timelineParentName = (layer: MotionLayer): string =>
    layer.parentId ? (layerById.get(layer.parentId)?.name ?? "Missing") : "-";
  const timelineBeatMarkers = (composition.beatMarkers ?? []).filter(
    (marker) => marker.time >= 0 && marker.time <= duration,
  );
  const timelineMarkers = composition.markers.filter(
    (marker) => marker.time >= 0 && marker.time <= duration,
  );
  const markerTolerance = 0.5 / Math.max(1, composition.frameRate);
  const activeTimelineMarker = timelineMarkers.find(
    (marker) => Math.abs(marker.time - playhead) <= markerTolerance,
  );
  const toggleMarkerAtPlayhead = () => {
    const currentComposition = latestCompositionRef.current;
    if (activeTimelineMarker) {
      updateComposition(
        removeMotionCompositionMarker(currentComposition, activeTimelineMarker.id),
      );
      return;
    }
    updateComposition(
      addMotionCompositionMarker(
        currentComposition,
        createMotionMarker({
          time: playhead,
          label: `Marker ${currentComposition.markers.length + 1}`,
        }),
      ),
    );
  };
  const updateTimelineMarker = (
    markerId: string,
    updates: Partial<MotionComposition["markers"][number]>,
  ) => {
    const currentComposition = latestCompositionRef.current;
    updateComposition(
      updateMotionCompositionMarker(currentComposition, markerId, (marker) => ({
        ...marker,
        ...updates,
      })),
    );
  };
  const deleteTimelineMarker = (markerId: string) => {
    updateComposition(
      removeMotionCompositionMarker(latestCompositionRef.current, markerId),
    );
  };
  const selectedLayer = selectedLayerId
    ? composition.layers.find((layer) => layer.id === selectedLayerId) ?? null
    : null;
  const selectedAudioClip = selectedAudioClipId
    ? (composition.audioClips ?? []).find(
        (clip) => clip.id === selectedAudioClipId,
      ) ?? null
    : null;
  const selectedTimingLayerIds = selectedLayerIds.filter((layerId) => {
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    return Boolean(layer && !layer.locked);
  });
  const lights = normalizeMotionLights(composition);
  const selectedLight =
    selectedLightId && !selectedLayer
      ? lights.find((light) => light.id === selectedLightId) ?? null
      : null;
  const activeProperty =
    selectedProperty ?? (selectedLight ? "light.intensity" : "transform.position.x");
  const activePropertyIsMotion = isMotionAnimatableProperty(activeProperty);
  const activeMotionProperty = activePropertyIsMotion ? activeProperty : null;
  const activeCameraProperty = isMotionCameraProperty(activeProperty)
    ? activeProperty
    : null;
  const activeLightProperty = isMotionLightProperty(activeProperty)
    ? activeProperty
    : null;
  const camera = normalizeMotionCamera(composition);
  const cameraKeyframes = camera.keyframes ?? [];
  const showCameraTrack =
    hasActiveMotionCamera(composition) ||
    composition.layers.some(
      (candidate) => candidate.type === "scene3d" || motionLayerMayUse3D(candidate),
    );
  const selectedCamera =
    !selectedLayer && !selectedLight && activeCameraProperty !== null;
  const selectedCameraPropertyKeyframes = activeCameraProperty
    ? getMotionCameraPropertyKeyframes(camera, activeCameraProperty)
    : [];
  const selectedLightPropertyKeyframes =
    selectedLight && activeLightProperty
      ? getMotionLightPropertyKeyframes(selectedLight, activeLightProperty)
      : [];
  const activePropertyDescriptor = activePropertyIsMotion
    ? selectedLayer
      ? getLayerSpecificMotionPropertyDescriptor(selectedLayer, activeProperty)
      : getMotionPropertyDescriptor(activeProperty)
    : undefined;
  const selectedLayerLocalPlayhead = selectedLayer
    ? clamp(playhead - selectedLayer.startTime, 0, selectedLayer.duration)
    : 0;
  const selectedPropertyKeyframes = selectedLayer
    ? getMotionLayerPropertyKeyframes(selectedLayer, activeProperty)
    : selectedLight
      ? selectedLightPropertyKeyframes
      : selectedCameraPropertyKeyframes;
  const activePropertyTime = selectedLayer ? selectedLayerLocalPlayhead : playhead;
  const activeKeyframe = selectedLayer
    ? findMotionLayerKeyframeAtTime(
        selectedLayer,
        activeProperty,
        selectedLayerLocalPlayhead,
      )
    : selectedLight && activeLightProperty
      ? findMotionLightKeyframeAtTime(selectedLight, activeLightProperty, playhead)
    : activeCameraProperty
      ? findMotionCameraKeyframeAtTime(camera, activeCameraProperty, playhead)
      : undefined;
  const canSeekPreviousKeyframe = selectedPropertyKeyframes.some(
    (keyframe) => keyframe.time < activePropertyTime - 0.001,
  );
  const canSeekNextKeyframe = selectedPropertyKeyframes.some(
    (keyframe) => keyframe.time > activePropertyTime + 0.001,
  );
  const canTimeSelection = selectedTimingLayerIds.length > 0;
  const canTimeMultipleLayers = selectedTimingLayerIds.length > 1;
  const canFitSelectionToWorkArea =
    canTimeSelection && activeWorkAreaEnd - activeWorkAreaStart > 1 / 1000;

  const toggleKeyframeAtPlayhead = () => {
    if (!selectedLayer) {
      if (selectedLight && activeLightProperty) {
        const animatedLight = getMotionLightAtTime(
          selectedLight,
          composition,
          playhead,
        );
        const nextLight = activeKeyframe
          ? removeMotionLightKeyframe(selectedLight, activeKeyframe.id)
          : upsertMotionLightKeyframe(
              selectedLight,
              activeLightProperty,
              playhead,
              {
                value: getMotionLightPropertyValue(
                  animatedLight,
                  activeLightProperty,
                ),
                easing: "ease",
              },
            );
        replaceLight(nextLight);
        selectLightProperty(selectedLight.id, activeLightProperty);
        return;
      }
      if (!activeCameraProperty) return;
      const enabledCamera = {
        ...(composition.camera ?? createDefaultMotionCamera(composition)),
        keyframes: camera.keyframes ?? [],
        enabled: true,
      };
      const nextCamera = activeKeyframe
        ? removeMotionCameraKeyframe(enabledCamera, activeKeyframe.id)
        : upsertMotionCameraKeyframe(enabledCamera, activeCameraProperty, playhead, {
            value: getMotionCameraPropertyValue(camera, activeCameraProperty),
            easing: "ease",
          });
      replaceCamera(nextCamera);
      setSelectedProperty(activeCameraProperty);
      return;
    }
    if (!activeMotionProperty) {
      if (activeKeyframe) {
        replaceLayer(removeMotionLayerKeyframe(selectedLayer, activeKeyframe.id));
      }
      return;
    }
    const nextLayer = activeKeyframe
      ? removeMotionLayerKeyframe(selectedLayer, activeKeyframe.id)
      : upsertMotionLayerKeyframe(
          selectedLayer,
          activeMotionProperty,
          selectedLayerLocalPlayhead,
          {
            value: getMotionLayerPropertyValueAtTime(
              selectedLayer,
              activeMotionProperty,
              selectedLayerLocalPlayhead,
              composition,
            ),
            easing: "ease",
          },
        );
    setSelectedProperty(activeProperty);
    replaceLayer(nextLayer);
  };

  const seekToAdjacentKeyframe = (direction: -1 | 1) => {
    if (!selectedLayer && selectedLight && activeLightProperty) {
      const keyframe =
        direction < 0
          ? [...selectedLightPropertyKeyframes]
              .reverse()
              .find((candidate) => candidate.time < playhead - 0.001)
          : selectedLightPropertyKeyframes.find(
              (candidate) => candidate.time > playhead + 0.001,
            );
      if (!keyframe) return;
      selectLightProperty(selectedLight.id, activeLightProperty);
      setPlayhead(clamp(keyframe.time, 0, duration));
      return;
    }
    if (!selectedLayer && activeCameraProperty) {
      const keyframe =
        direction < 0
          ? [...selectedCameraPropertyKeyframes]
              .reverse()
              .find((candidate) => candidate.time < playhead - 0.001)
          : selectedCameraPropertyKeyframes.find(
              (candidate) => candidate.time > playhead + 0.001,
            );
      if (!keyframe) return;
      setSelectedProperty(activeCameraProperty);
      setPlayhead(clamp(keyframe.time, 0, duration));
      return;
    }
    if (!selectedLayer) return;
    const keyframe =
      direction < 0
        ? [...selectedPropertyKeyframes]
            .reverse()
            .find(
              (candidate) =>
                candidate.time < selectedLayerLocalPlayhead - 0.001,
            )
        : selectedPropertyKeyframes.find(
            (candidate) =>
              candidate.time > selectedLayerLocalPlayhead + 0.001,
          );
    if (!keyframe) return;
    setSelectedProperty(activeProperty);
    setPlayhead(clamp(selectedLayer.startTime + keyframe.time, 0, duration));
  };

  const sequenceSelectedLayers = () => {
    const sequenced = sequenceMotionLayers(composition, {
      layerIds: selectedTimingLayerIds,
      startTime: playhead,
      gap: sequenceGap,
      frameRate: composition.frameRate,
      compositionDuration: composition.duration,
    });
    updateComposition(expandCompositionDurationToLayers(sequenced));
  };

  const staggerSelectedLayers = () => {
    const staggered = staggerMotionLayers(composition, {
      layerIds: selectedTimingLayerIds,
      startTime: playhead,
      offset: staggerOffset,
      frameRate: composition.frameRate,
      compositionDuration: composition.duration,
    });
    updateComposition(expandCompositionDurationToLayers(staggered));
  };

  const alignSelectedLayerIns = () => {
    updateComposition(
      alignMotionLayersToTime(composition, {
        layerIds: selectedTimingLayerIds,
        edge: "in",
        time: playhead,
        frameRate: composition.frameRate,
        compositionDuration: composition.duration,
      }),
    );
  };

  const alignSelectedLayerOuts = () => {
    updateComposition(
      alignMotionLayersToTime(composition, {
        layerIds: selectedTimingLayerIds,
        edge: "out",
        time: playhead,
        frameRate: composition.frameRate,
        compositionDuration: composition.duration,
      }),
    );
  };

  const fitSelectedLayersToWorkArea = () => {
    updateComposition(
      fitMotionLayersToRange(composition, {
        layerIds: selectedTimingLayerIds,
        startTime: activeWorkAreaStart,
        endTime: activeWorkAreaEnd,
        frameRate: composition.frameRate,
        compositionDuration: composition.duration,
      }),
    );
  };

  const setWorkAreaIn = () => {
    setWorkArea(playhead, activeWorkAreaEnd);
  };

  const setWorkAreaOut = () => {
    setWorkArea(activeWorkAreaStart, playhead);
  };

  const splittableLayerIds = selectedTimingLayerIds.filter((layerId) => {
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return false;
    return (
      playhead > layer.startTime &&
      playhead < layer.startTime + layer.duration
    );
  });
  const canSplitAudioAtPlayhead = Boolean(
    selectedAudioClip &&
      playhead > selectedAudioClip.startTime &&
      playhead < selectedAudioClip.startTime + selectedAudioClip.duration,
  );
  const canSplitAtPlayhead =
    splittableLayerIds.length > 0 || canSplitAudioAtPlayhead;

  const splitSelectedLayersAtPlayhead = () => {
    if (selectedAudioClip && canSplitAudioAtPlayhead) {
      const split = splitMotionAudioClipAtTime(
        selectedAudioClip,
        playhead,
        () => makeId("motion-audio"),
      );
      if (!split) return;
      const [first, second] = split;
      updateComposition({
        ...composition,
        audioClips: (composition.audioClips ?? []).flatMap((clip) =>
          clip.id === selectedAudioClip.id ? [first, second] : [clip],
        ),
        modifiedAt: Date.now(),
      });
      setSelectedAudioClipId(second.id);
      return;
    }
    if (splittableLayerIds.length === 0) return;
    let nextComposition = composition;
    let changed = false;
    for (const layerId of splittableLayerIds) {
      const result = splitMotionLayerAtTime(nextComposition, layerId, playhead, {
        frameRate: nextComposition.frameRate,
        idFactory: () => makeId("motion-layer"),
        keyframeIdFactory: () => makeId("motion-kf"),
      });
      if (result) {
        nextComposition = result;
        changed = true;
      }
    }
    if (changed) {
      updateComposition({ ...nextComposition, modifiedAt: Date.now() });
    }
  };

  const canRippleDeleteSelection = selectedTimingLayerIds.length > 0;

  const rippleDeleteSelectedLayers = () => {
    if (selectedTimingLayerIds.length === 0) return;
    const orderedLayerIds = [...selectedTimingLayerIds].sort((firstId, secondId) => {
      const firstStart =
        composition.layers.find((layer) => layer.id === firstId)?.startTime ?? 0;
      const secondStart =
        composition.layers.find((layer) => layer.id === secondId)?.startTime ?? 0;
      return secondStart - firstStart;
    });
    let nextComposition = composition;
    for (const layerId of orderedLayerIds) {
      nextComposition = rippleDeleteMotionLayer(nextComposition, layerId, {
        frameRate: nextComposition.frameRate,
        compositionDuration: nextComposition.duration,
      });
    }
    updateComposition(nextComposition);
    setSelectedLayers([]);
  };

  const deleteSelectedLayers = () => {
    if (selectedAudioClip) {
      removeAudioClip(selectedAudioClip.id);
      return;
    }
    if (selectedTimingLayerIds.length === 0) return;
    updateComposition(removeMotionLayers(composition, selectedTimingLayerIds));
    setSelectedLayers([]);
    setSelectedKeyframes([]);
  };

  const duplicateSelectedLayers = () => {
    if (selectedAudioClip) {
      const duplicate = duplicateMotionAudioClip(selectedAudioClip, {
        compositionDuration: composition.duration,
        frameRate: composition.frameRate,
        idFactory: () => makeId("motion-audio"),
      });
      updateComposition({
        ...composition,
        audioClips: [...(composition.audioClips ?? []), duplicate],
        modifiedAt: Date.now(),
      });
      setSelectedAudioClipId(duplicate.id);
      return;
    }
    if (selectedTimingLayerIds.length === 0) return;
    const result = duplicateMotionLayers(composition, selectedTimingLayerIds, {
      idFactory: () => makeId("motion-layer"),
      keyframeIdFactory: () => makeId("motion-kf"),
    });
    if (result.duplicatedLayerIds.length === 0) return;
    updateComposition(result.composition);
    setSelectedLayers(result.duplicatedLayerIds);
    setSelectedKeyframes([]);
  };

  const copyTimelineSelection = () => {
    if (selectedKeyframeIds.length > 0) {
      keyframeClipboardRef.current = [...selectedKeyframeIds];
      layerClipboardRef.current = null;
      setTimelineClipboardKind("keyframes");
      return;
    }
    if (selectedAudioClip) {
      audioClipboardRef.current = structuredClone(selectedAudioClip);
      layerClipboardRef.current = null;
      keyframeClipboardRef.current = [];
      setTimelineClipboardKind("audio");
      return;
    }
    const clipboard = copyMotionLayersToClipboard(
      composition,
      selectedLayerIds,
    );
    if (!clipboard) return;
    layerClipboardRef.current = clipboard;
    keyframeClipboardRef.current = [];
    setTimelineClipboardKind("layers");
  };

  const pasteTimelineClipboard = () => {
    if (
      timelineClipboardKind === "keyframes" &&
      keyframeClipboardRef.current.length > 0
    ) {
      const result = duplicateMotionKeyframes(
        composition,
        keyframeClipboardRef.current,
        playhead,
        () => makeId("motion-kf"),
      );
      if (result.duplicatedKeyframeIds.length === 0) return;
      updateComposition(result.composition);
      setSelectedKeyframes([...result.duplicatedKeyframeIds]);
      return;
    }
    if (
      timelineClipboardKind === "audio" &&
      audioClipboardRef.current
    ) {
      const duplicate = duplicateMotionAudioClip(audioClipboardRef.current, {
        compositionDuration: composition.duration,
        frameRate: composition.frameRate,
        startTime: playhead,
        idFactory: () => makeId("motion-audio"),
      });
      updateComposition({
        ...composition,
        audioClips: [...(composition.audioClips ?? []), duplicate],
        modifiedAt: Date.now(),
      });
      setSelectedAudioClipId(duplicate.id);
      selectLayer(null);
      setSelectedKeyframes([]);
      return;
    }
    if (timelineClipboardKind !== "layers" || !layerClipboardRef.current) {
      return;
    }
    const result = pasteMotionLayersFromClipboard(
      composition,
      layerClipboardRef.current,
      {
        targetTime: playhead,
        idFactory: () => makeId("motion-layer"),
        keyframeIdFactory: () => makeId("motion-kf"),
      },
    );
    if (result.duplicatedLayerIds.length === 0) return;
    updateComposition(result.composition);
    setSelectedLayers(result.duplicatedLayerIds);
    setSelectedKeyframes([]);
  };

  const trimSelectedLayersToPlayhead = (edge: "in" | "out") => {
    if (selectedTimingLayerIds.length === 0) return;
    const selectedIds = new Set(selectedTimingLayerIds);
    let changed = false;
    const layers = composition.layers.map((layer) => {
      if (!selectedIds.has(layer.id)) return layer;
      const layerEnd = layer.startTime + layer.duration;
      if (
        (edge === "in" && (playhead < layer.startTime || playhead >= layerEnd)) ||
        (edge === "out" && (playhead <= layer.startTime || playhead > layerEnd))
      ) {
        return layer;
      }
      changed = true;
      const options = {
        frameRate: composition.frameRate,
        compositionDuration: composition.duration,
      };
      return edge === "in"
        ? trimMotionLayerInPoint(layer, playhead, options)
        : trimMotionLayerOutPoint(layer, playhead, options);
    });
    if (changed) {
      updateComposition({ ...composition, layers, modifiedAt: Date.now() });
    }
  };

  const alignSelectedLayerEdgeToPlayhead = (edge: "in" | "out") => {
    if (selectedTimingLayerIds.length === 0) return;
    updateComposition(
      alignMotionLayersToTime(composition, {
        layerIds: selectedTimingLayerIds,
        time: playhead,
        edge,
        frameRate: composition.frameRate,
        compositionDuration: composition.duration,
      }),
    );
  };

  const toggleSelectedLayersLocked = () => {
    if (selectedLayerIds.length === 0) return;
    const selectedLayers = composition.layers.filter((layer) =>
      selectedLayerIds.includes(layer.id),
    );
    if (selectedLayers.length === 0) return;
    const shouldLock = selectedLayers.some((layer) => !layer.locked);
    updateComposition(
      setMotionLayersLocked(composition, selectedLayerIds, shouldLock),
    );
  };

  const deleteSelectedKeyframes = () => {
    if (selectedKeyframeIds.length === 0) return;
    const selectedIds = new Set(selectedKeyframeIds);
    let changed = false;
    const layers = composition.layers.map((layer) => {
      const keyframes = layer.keyframes.filter(
        (keyframe) => !selectedIds.has(keyframe.id),
      );
      const masks = layer.masks?.map((mask) => {
        if (!mask.pathKeyframes) return mask;
        const pathKeyframes = mask.pathKeyframes.filter(
          (keyframe) => !selectedIds.has(keyframe.id),
        );
        if (pathKeyframes.length === mask.pathKeyframes.length) return mask;
        changed = true;
        return { ...mask, pathKeyframes };
      });
      if (
        keyframes.length === layer.keyframes.length &&
        !masks?.some((mask, index) => mask !== layer.masks?.[index])
      ) {
        return layer;
      }
      changed = true;
      return { ...layer, keyframes, masks } as MotionLayer;
    });
    const camera = composition.camera
      ? {
          ...composition.camera,
          keyframes: (composition.camera.keyframes ?? []).filter((keyframe) => {
            const keep = !selectedIds.has(keyframe.id);
            if (!keep) changed = true;
            return keep;
          }),
        }
      : composition.camera;
    const nextLights = composition.lights?.map((light) => ({
      ...light,
      keyframes: (light.keyframes ?? []).filter((keyframe) => {
        const keep = !selectedIds.has(keyframe.id);
        if (!keep) changed = true;
        return keep;
      }),
    }));
    if (changed) {
      updateComposition({
        ...composition,
        layers,
        camera,
        lights: nextLights,
        modifiedAt: Date.now(),
      });
    }
    setSelectedKeyframes([]);
  };

  const duplicateSelectedKeyframesAtPlayhead = () => {
    if (selectedKeyframeIds.length === 0) return;
    const result = duplicateMotionKeyframes(
      composition,
      selectedKeyframeIds,
      playhead,
      () => makeId("motion-kf"),
    );
    if (result.duplicatedKeyframeIds.length === 0) return;
    updateComposition(result.composition);
    setSelectedKeyframes([...result.duplicatedKeyframeIds]);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "c" &&
        (selectedKeyframeIds.length > 0 ||
          selectedLayerIds.length > 0 ||
          selectedAudioClip !== null)
      ) {
        event.preventDefault();
        copyTimelineSelection();
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "v" &&
        timelineClipboardKind !== null
      ) {
        event.preventDefault();
        pasteTimelineClipboard();
        return;
      }

      if (
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        selectedKeyframeIds.length > 0 &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        deleteSelectedKeyframes();
        return;
      }

      if (event.key === "Escape" && selectedKeyframeIds.length > 0) {
        event.preventDefault();
        setSelectedKeyframes([]);
        return;
      }
      if (event.key === "Escape" && selectedAudioClip !== null) {
        event.preventDefault();
        setSelectedAudioClipId(null);
        return;
      }

      if (
        selectedKeyframeIds.length > 0 &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateSelectedKeyframesAtPlayhead();
        return;
      }

      if (
        selectedKeyframeIds.length === 0 &&
        (selectedTimingLayerIds.length > 0 || selectedAudioClip !== null) &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        duplicateSelectedLayers();
        return;
      }

      if (
        selectedKeyframeIds.length > 0 &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        const frameDuration = 1 / Math.max(1, composition.frameRate);
        const frameCount = event.shiftKey ? 10 : 1;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const result = offsetMotionKeyframes(
          composition,
          selectedKeyframeIds,
          direction * frameCount * frameDuration,
        );
        updateComposition(result.composition);
        setPlayhead(clamp(playhead + result.appliedDelta, 0, duration));
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "j" && canSeekPreviousKeyframe) {
          event.preventDefault();
          seekToAdjacentKeyframe(-1);
          return;
        }
        if (key === "k" && canSeekNextKeyframe) {
          event.preventDefault();
          seekToAdjacentKeyframe(1);
          return;
        }
        if (key === "m") {
          event.preventDefault();
          toggleMarkerAtPlayhead();
          return;
        }
        if (event.key === "PageUp" || event.key === "PageDown") {
          event.preventDefault();
          const direction = event.key === "PageDown" ? 1 : -1;
          const frameCount = event.shiftKey ? 10 : 1;
          const frameDuration = 1 / Math.max(1, composition.frameRate);
          setPlayhead(
            clamp(
              playhead + direction * frameCount * frameDuration,
              0,
              duration,
            ),
          );
          return;
        }
        if (
          selectedKeyframeIds.length === 0 &&
          selectedTimingLayerIds.length > 0 &&
          (event.key === "[" || event.key === "]")
        ) {
          event.preventDefault();
          alignSelectedLayerEdgeToPlayhead(event.key === "[" ? "in" : "out");
          return;
        }
        if (
          selectedKeyframeIds.length === 0 &&
          selectedLayerIds.length > 0 &&
          key === "l"
        ) {
          event.preventDefault();
          toggleSelectedLayersLocked();
          return;
        }
      }

      if (
        selectedKeyframeIds.length === 0 &&
        selectedTimingLayerIds.length > 0 &&
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        (event.key === "[" || event.key === "]")
      ) {
        event.preventDefault();
        trimSelectedLayersToPlayhead(event.key === "[" ? "in" : "out");
        return;
      }

      if (
        selectedKeyframeIds.length === 0 &&
        (selectedTimingLayerIds.length > 0 || selectedAudioClip !== null) &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        deleteSelectedLayers();
        return;
      }

      if (
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        if (!canRippleDeleteSelection) return;
        event.preventDefault();
        rippleDeleteSelectedLayers();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "d") return;
      if (!canSplitAtPlayhead) return;
      event.preventDefault();
      splitSelectedLayersAtPlayhead();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-tl-bg">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex h-7 items-center border-r border-border pr-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
            Timeline
          </span>
        </div>
        <div className="flex flex-col justify-center leading-none">
          <span className="font-mono text-[16px] font-bold tabular-nums tracking-[0.03em] text-accent">
            {formatMotionTimecode(playhead, composition.frameRate)}
          </span>
          <span className="mt-0.5 font-mono text-[10px] font-medium tabular-nums text-fg-muted">
            {formatMotionFrameLabel(playhead, composition.frameRate)} ({formatMotionFps(composition.frameRate)})
          </span>
        </div>
        <div className="ml-2 flex min-w-0 items-center gap-1 border-l border-border pl-2">
          <span
            className="max-w-28 truncate text-[11px] font-medium text-fg-3"
            title={
              selectedLayer
                ? activePropertyDescriptor?.label ?? activeProperty
                : selectedAudioClip
                  ? selectedAudioClip.name?.trim() || "Audio clip"
                : selectedLight
                  ? `${selectedLight.name}: ${formatLightProperty(activeLightProperty)}`
                : selectedCamera
                  ? formatCameraProperty(activeCameraProperty)
                : "Select a layer"
            }
          >
            {selectedLayer
              ? activePropertyDescriptor?.label ?? activeProperty
              : selectedAudioClip
                ? selectedAudioClip.name?.trim() || "Audio clip"
              : selectedLight
                ? formatLightProperty(activeLightProperty)
              : selectedCamera
                ? formatCameraProperty(activeCameraProperty)
              : "No layer"}
          </span>
          {selectedKeyframeIds.length > 0 ? (
            <span
              className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-accent"
              title="Alt+Left/Right nudges selected keyframes; add Shift for 10 frames"
            >
              {selectedKeyframeIds.length} KF
            </span>
          ) : null}
          <TransportButton
            icon={SkipBack}
            label="Previous keyframe (J)"
            disabled={!canSeekPreviousKeyframe}
            onClick={() => seekToAdjacentKeyframe(-1)}
          />
          <IconButton
            label={
              activeKeyframe
                ? "Remove keyframe at playhead"
                : "Add keyframe at playhead"
            }
            icon={
              <Diamond
                size={14}
                aria-hidden
                className={activeKeyframe ? "fill-current" : undefined}
              />
            }
            size="md"
            variant={activeKeyframe ? "primary" : "ghost"}
            isDisabled={
              (!selectedLayer && !activeCameraProperty && !activeLightProperty) ||
              Boolean(selectedLayer && !activePropertyIsMotion && !activeKeyframe)
            }
            onClick={toggleKeyframeAtPlayhead}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35 ${
              activeKeyframe
                ? "bg-accent text-accent-fg shadow-glow hover:bg-accent-strong"
                : "text-fg-3 hover:bg-hover hover:text-fg"
            }`}
          />
          <TransportButton
            icon={SkipForward}
            label="Next keyframe (K)"
            disabled={!canSeekNextKeyframe}
            onClick={() => seekToAdjacentKeyframe(1)}
          />
          {selectedKeyframeIds.length > 0 ? (
            <>
              <IconButton
                label="Duplicate selected keyframes at playhead (⌘D)"
                icon={<Copy size={13} aria-hidden />}
                size="sm"
                variant="ghost"
                onClick={duplicateSelectedKeyframesAtPlayhead}
              />
              <IconButton
                label={`Delete ${selectedKeyframeIds.length} selected keyframe${selectedKeyframeIds.length === 1 ? "" : "s"}`}
                icon={<Trash2 size={13} aria-hidden />}
                size="sm"
                variant="danger"
                onClick={deleteSelectedKeyframes}
              />
            </>
          ) : null}
          <IconButton
            label={
              activeTimelineMarker
                ? "Remove marker at playhead (M)"
                : "Add marker at playhead (M)"
            }
            icon={
              <Flag
                size={13}
                className={activeTimelineMarker ? "fill-current" : undefined}
                aria-hidden
              />
            }
            size="sm"
            variant={activeTimelineMarker ? "primary" : "ghost"}
            onClick={toggleMarkerAtPlayhead}
          />
          <Popover
            placement="below"
            alignment="end"
            width={320}
            label="Composition markers"
            content={
              <MarkerManager
                markers={timelineMarkers}
                frameRate={composition.frameRate}
                onSeek={setPlayhead}
                onUpdate={updateTimelineMarker}
                onDelete={deleteTimelineMarker}
              />
            }
          >
            <IconButton
              label="Manage composition markers"
              icon={<ChevronDown size={12} aria-hidden />}
              size="sm"
              variant="ghost"
            />
          </Popover>
        </div>
        <div className="ml-2 flex items-center gap-0.5 border-l border-border pl-2">
          <IconButton
            label="Copy timeline selection (⌘C)"
            icon={<Copy size={14} aria-hidden />}
            size="md"
            variant="ghost"
            isDisabled={
              selectedKeyframeIds.length === 0 &&
              selectedLayerIds.length === 0 &&
              selectedAudioClip === null
            }
            onClick={copyTimelineSelection}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          />
          <IconButton
            label="Paste at playhead (⌘V)"
            icon={<ClipboardPaste size={14} aria-hidden />}
            size="md"
            variant="ghost"
            isDisabled={timelineClipboardKind === null}
            onClick={pasteTimelineClipboard}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          />
          <IconButton
            label="Split selection at playhead"
            icon={<Scissors size={15} aria-hidden />}
            size="md"
            variant="ghost"
            isDisabled={!canSplitAtPlayhead}
            onClick={splitSelectedLayersAtPlayhead}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          />
          <IconButton
            label="Ripple delete selection"
            icon={<Delete size={15} aria-hidden />}
            size="md"
            variant="ghost"
            isDisabled={!canRippleDeleteSelection}
            onClick={rippleDeleteSelectedLayers}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
          />
          <IconButton
            label="Ripple edit"
            icon={<MoveHorizontal size={15} aria-hidden />}
            size="md"
            variant={rippleEnabled ? "primary" : "ghost"}
            aria-pressed={rippleEnabled}
            onClick={() => setRippleEnabled((value) => !value)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
              rippleEnabled
                ? "bg-accent text-accent-fg shadow-glow hover:bg-accent-strong"
                : "text-fg-3 hover:bg-hover hover:text-fg"
            }`}
          />
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-fg-muted">
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-bg-2 p-0.5">
            <IconButton
              label="Zoom out timeline"
              icon={<ZoomOut size={13} aria-hidden />}
              size="sm"
              variant="ghost"
              isDisabled={timelineZoom <= TIMELINE_ZOOM_MIN}
              onClick={() =>
                setTimelineZoom((value) =>
                  Math.max(TIMELINE_ZOOM_MIN, value - 1),
                )
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
            />
            <Button
              label="Fit"
              variant="ghost"
              size="sm"
              disabled={timelineZoom === TIMELINE_ZOOM_MIN}
              onClick={() => setTimelineZoom(TIMELINE_ZOOM_MIN)}
              className="inline-flex h-6 items-center rounded px-1.5 text-[10.5px] font-semibold text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
            />
            <input
              type="range"
              aria-label="Motion timeline zoom"
              aria-valuetext={`${timelineZoom.toFixed(2).replace(/\.00$/, "")}×`}
              min={TIMELINE_ZOOM_MIN}
              max={TIMELINE_ZOOM_MAX}
              step={0.25}
              value={timelineZoom}
              onChange={(event) =>
                setTimelineZoom(Number(event.currentTarget.value))
              }
              className="mx-1 h-6 w-20 cursor-ew-resize accent-accent"
            />
            <IconButton
              label="Zoom in timeline"
              icon={<ZoomIn size={13} aria-hidden />}
              size="sm"
              variant="ghost"
              isDisabled={timelineZoom >= TIMELINE_ZOOM_MAX}
              onClick={() =>
                setTimelineZoom((value) =>
                  Math.min(TIMELINE_ZOOM_MAX, value + 1),
                )
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
            />
          </div>
          <Button
            label="In"
            icon={CornerDownLeft}
            variant="outline"
            size="sm"
            disabled={playhead >= activeWorkAreaEnd}
            onClick={setWorkAreaIn}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg-2 px-2 text-[11px] font-medium text-fg-3 transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
          />
          <Button
            label="Out"
            icon={CornerDownRight}
            variant="outline"
            size="sm"
            disabled={playhead <= activeWorkAreaStart}
            onClick={setWorkAreaOut}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-bg-2 px-2 text-[11px] font-medium text-fg-3 transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
          />
          {hasCustomWorkArea ? (
            <Button
              label="Clear"
              variant="outline"
              size="sm"
              onClick={clearWorkArea}
              className="inline-flex h-7 items-center rounded-md border border-border bg-bg-2 px-2 text-[11px] font-medium text-fg-3 transition-colors hover:border-accent hover:text-accent"
            />
          ) : null}
          <div className="relative">
            <Button
              label="Timing"
              icon={Clock3}
              variant={timingMenuOpen ? "solid" : "outline"}
              size="sm"
              disabled={!canTimeSelection}
              onClick={() => setTimingMenuOpen((value) => !value)}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                timingMenuOpen
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-bg-2 text-fg-3 hover:border-accent hover:text-accent"
              }`}
            />
            {timingMenuOpen ? (
              <>
                <div
                  aria-hidden="true"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setTimingMenuOpen(false)}
                />
                <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 rounded-lg border border-border bg-bg-elev p-2.5 shadow-lg">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                      Timing Assistant
                    </span>
                    <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
                      {selectedTimingLayerIds.length} selected
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <NumberInput
                      value={sequenceGap}
                      min={0}
                      step={0.05}
                      unit="gap"
                      onChange={(value) => setSequenceGap(Math.max(0, value))}
                    />
                    <NumberInput
                      value={staggerOffset}
                      step={0.02}
                      unit="offset"
                      onChange={(value) => setStaggerOffset(value || 0)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <TimingMenuButton
                      label="Align In"
                      disabled={!canTimeSelection}
                      onClick={alignSelectedLayerIns}
                    />
                    <TimingMenuButton
                      label="Align Out"
                      disabled={!canTimeSelection}
                      onClick={alignSelectedLayerOuts}
                    />
                    <TimingMenuButton
                      label="Sequence"
                      disabled={!canTimeMultipleLayers}
                      onClick={sequenceSelectedLayers}
                    />
                    <TimingMenuButton
                      label="Stagger"
                      disabled={!canTimeMultipleLayers}
                      onClick={staggerSelectedLayers}
                    />
                  </div>
                  <Button
                    label="Fit selection to work area"
                    variant="outline"
                    size="sm"
                    disabled={!canFitSelectionToWorkArea}
                    onClick={fitSelectedLayersToWorkArea}
                    className="mt-1.5 h-7 w-full rounded-md border border-border bg-bg-2 px-2 text-[11px] font-semibold text-fg-3 transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
                  />
                </div>
              </>
            ) : null}
          </div>
          <span className="tabular-nums">{composition.frameRate} fps</span>
          <span className="rounded bg-bg-2 px-1.5 py-0.5 tabular-nums text-fg-3">
            {displayedLayers.length}
            {displayedLayers.length !== composition.layers.length
              ? ` / ${composition.layers.length}`
              : ""} layers
            {(composition.audioClips ?? []).length > 0
              ? ` · ${(composition.audioClips ?? []).length} audio`
              : ""}
          </span>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-bg-1 px-3">
        <div className="relative w-48 shrink-0">
          <Search
            size={13}
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            type="search"
            aria-label="Search timeline layers"
            placeholder="Search layers, effects…"
            value={layerQuery}
            onChange={(event) => setLayerQuery(event.target.value)}
            className="h-7 w-full rounded-md border border-border bg-bg-2 pl-7 pr-7 text-[11px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
          />
          {layerQuery ? (
            <button
              type="button"
              aria-label="Clear timeline search"
              onClick={() => setLayerQuery("")}
              className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X size={11} aria-hidden />
            </button>
          ) : null}
        </div>
        {(["all", "selected", "animated"] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            aria-pressed={layerFilter === filter}
            onClick={() => setLayerFilter(filter)}
            className={`h-7 rounded-md px-2 text-[10.5px] font-semibold capitalize transition-colors ${
              layerFilter === filter
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-hover hover:text-fg-2"
            }`}
          >
            {filter}
          </button>
        ))}
        <span
          className="ml-1 text-[10px] tabular-nums text-fg-muted"
          aria-live="polite"
        >
          {displayedLayers.length} of {composition.layers.length}
        </span>
        {timelineIsFiltered ? (
          <button
            type="button"
            onClick={() => {
              setLayerFilter("all");
              setLayerQuery("");
            }}
            className="ml-auto h-7 rounded-md px-2 text-[10.5px] font-medium text-fg-muted hover:bg-hover hover:text-fg-2"
          >
            Reset filters
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-tl-bg">
        <div
          className="relative"
          style={{ minWidth: `${TIMELINE_BASE_MIN_WIDTH * timelineZoom}px` }}
        >
          <div
            className="grid items-stretch"
            style={{
              gridTemplateColumns: `${RAIL_WIDTH}px minmax(${TIMELINE_BASE_LANE_WIDTH * timelineZoom}px, 1fr)`,
            }}
          >
            <div className="sticky left-0 top-0 z-30 border-r border-border bg-bg-1">
              <div className="flex h-[34px] items-center gap-5 border-b border-border px-3.5">
                <button
                  type="button"
                  onClick={() => setRailTab("layers")}
                  className={`box-border h-[34px] pt-[9px] text-[13px] ${
                    railTab === "layers"
                      ? "border-b-2 border-accent font-semibold text-fg"
                      : "font-medium text-fg-muted"
                  }`}
                >
                  Layers
                </button>
                <button
                  type="button"
                  onClick={() => setRailTab("composition")}
                  className={`box-border h-[34px] pt-[9px] text-[13px] ${
                    railTab === "composition"
                      ? "border-b-2 border-accent font-semibold text-fg"
                      : "font-medium text-fg-muted"
                  }`}
                >
                  Composition
                </button>
                <button
                  type="button"
                  aria-label={composition.hideShyLayers ? "Show shy layers" : "Hide shy layers"}
                  title={composition.hideShyLayers ? "Show shy layers" : "Hide shy layers"}
                  onClick={() =>
                    updateComposition({
                      ...composition,
                      hideShyLayers: !composition.hideShyLayers,
                      modifiedAt: Date.now(),
                    })
                  }
                  className={`ml-auto flex h-6 w-6 items-center justify-center rounded transition-colors ${
                    composition.hideShyLayers
                      ? "bg-accent-soft text-accent"
                      : "text-fg-muted hover:bg-hover hover:text-fg-2"
                  }`}
                >
                  <VenetianMask size={13} aria-hidden />
                </button>
              </div>
              <div
                className="grid h-8 items-center border-b border-border text-[10px] font-medium text-fg-muted"
                style={{ gridTemplateColumns: TIMELINE_RAIL_COLUMNS }}
              >
                <div className="px-2 text-center">#</div>
                <div className="px-2">Layer Name</div>
                <div className="px-2">
                  {timelineColumnMode === "modes" ? "Modes" : "Switches"}
                </div>
                <div className="px-2">Parent</div>
                <div className="px-2 text-right">Timing</div>
              </div>
            </div>
            <div
              ref={laneRef}
              className="sticky top-0 z-20 h-8 cursor-ew-resize select-none border-b border-border bg-bg-1"
              onPointerDown={beginScrub}
              onPointerMove={continueScrub}
            >
              <div className="relative h-full">
                {cacheBarSegments.map((segment) => (
                  <div
                    key={`cache-bar-${segment.key}`}
                    data-testid="cache-bar-segment"
                    className="pointer-events-none absolute bottom-0 h-[2px] rounded-full bg-status-success"
                    style={{
                      left: `${segment.leftPct}%`,
                      width: `${segment.widthPct}%`,
                    }}
                  />
                ))}
                {ticks.map((value) => {
                  const left = (value / duration) * 100;
                  return (
                    <div
                      key={value}
                      className="absolute bottom-0 top-0 flex flex-col justify-between"
                      style={{ left: `${left}%` }}
                    >
                      <span className="ml-1 mt-1 text-[10px] font-medium tabular-nums text-fg-muted">
                        {value % 1 === 0 ? `${String(value).padStart(2, "0")}s` : ""}
                      </span>
                      <span className={`w-px ${value % 1 === 0 ? "h-2 bg-border" : "h-1.5 bg-border/60"}`} />
                    </div>
                  );
                })}
                {timelineBeatMarkers.map((marker) => (
                  <Button
                    key={`beat-ruler-${marker.index}-${marker.time}`}
                    hideLabel
                    label={`Beat ${marker.index + 1}`}
                    variant="ghost"
                    size="sm"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPlayhead(marker.time);
                    }}
                    className={`absolute top-1 flex -translate-x-1/2 items-center justify-center rounded-full border border-bg-1 p-0 transition-transform hover:scale-125 ${
                      marker.isDownbeat
                        ? "h-4 w-4 bg-status-warning text-bg-1"
                        : "h-2.5 w-2.5 bg-status-warning/70 text-bg-1"
                    }`}
                    style={{ left: `${(marker.time / duration) * 100}%` }}
                  >
                    {marker.isDownbeat ? <Music2 size={9} /> : null}
                  </Button>
                ))}
                {timelineMarkers.map((marker) => (
                  <Button
                    key={`marker-ruler-${marker.id}`}
                    label={marker.label}
                    variant="ghost"
                    size="sm"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPlayhead(marker.time);
                    }}
                    className="absolute bottom-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-sm border border-bg-1 p-0 text-bg-1 transition-transform hover:scale-125"
                    style={{
                      left: `${(marker.time / duration) * 100}%`,
                      backgroundColor: marker.color,
                    }}
                  >
                    <Flag size={9} />
                  </Button>
                ))}
                {hasCustomWorkArea ? (
                  <div
                    className="pointer-events-none absolute bottom-0 top-0 border-x border-accent/60 bg-accent/10"
                    style={{
                      left: `${(activeWorkAreaStart / duration) * 100}%`,
                      width: `${((activeWorkAreaEnd - activeWorkAreaStart) / duration) * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>

            {showCameraTrack ? (
            <div className="contents">
              <div
                className={`sticky left-0 z-10 grid border-b border-r border-border bg-bg-1 transition-colors ${
                  selectedCamera ? "bg-accent-soft" : "hover:bg-hover"
                }`}
                style={{
                  gridTemplateColumns: TIMELINE_RAIL_COLUMNS,
                  height: TIMELINE_ROW_HEIGHT,
                }}
              >
                <div className="flex items-center justify-center px-2 text-[10px] font-semibold text-fg-muted">
                  CAM
                </div>
                <button
                  type="button"
                  aria-label="Select Camera"
                  onClick={() =>
                    selectCameraProperty(activeCameraProperty ?? "camera.zoom")
                  }
                  className="flex min-w-0 items-center gap-1.5 px-1.5 text-left"
                >
                  <Camera
                    size={13}
                    className={`shrink-0 ${selectedCamera ? "text-accent" : "text-fg-muted"}`}
                    aria-hidden
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] ${
                      selectedCamera ? "font-semibold text-accent" : "font-medium text-fg-2"
                    }`}
                  >
                    Camera
                  </span>
                </button>
                <div className="flex items-center px-2 text-[10.5px] text-fg-muted">
                  View
                </div>
                <div className="flex items-center px-2 text-[11px] text-fg-muted">
                  -
                </div>
                <div className="flex items-center justify-end px-2 font-mono text-[10.5px] tabular-nums text-fg-3">
                  {formatTime(0)}
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  selectCameraProperty(activeCameraProperty ?? "camera.zoom")
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectCameraProperty(activeCameraProperty ?? "camera.zoom");
                  }
                }}
                className={`relative border-b border-border transition-colors ${
                  selectedCamera ? "bg-accent-soft" : "hover:bg-hover"
                }`}
                style={{ height: TIMELINE_ROW_HEIGHT }}
              >
                <div
                  className="pointer-events-none absolute left-0 right-0 top-1/2 flex h-[18px] -translate-y-1/2 items-center rounded-[5px] pl-2 text-[10px] font-semibold leading-none"
                  style={{ backgroundColor: "#6a9bd8", color: "#2a4a7a" }}
                >
                  Camera
                </div>
                {cameraKeyframes.map((keyframe) => {
                  const propertyIsCamera = isMotionCameraProperty(keyframe.property);
                  const keyframeSelected = selectedKeyframeIdSet.has(keyframe.id);
                  if (selectedCamera && keyframe.property === activeCameraProperty) {
                    return null;
                  }
                  const active =
                    selectedCamera &&
                    propertyIsCamera &&
                    selectedProperty === keyframe.property;
                  return (
                    <Button
                      key={keyframe.id}
                      hideLabel
                      label={
                        propertyIsCamera
                          ? formatCameraProperty(keyframe.property)
                          : keyframe.property
                      }
                      variant="ghost"
                      size="sm"
                      aria-pressed={keyframeSelected}
                      onPointerDown={(event) => {
                        if (propertyIsCamera) {
                          selectCameraProperty(keyframe.property);
                        }
                        beginCameraKeyframeTimingDrag(keyframe, event);
                      }}
                      onPointerMove={updateCameraKeyframeTimingDrag}
                      onPointerUp={endCameraKeyframeTimingDrag}
                      onPointerCancel={endCameraKeyframeTimingDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (suppressNextKeyframeClickRef.current) {
                          suppressNextKeyframeClickRef.current = false;
                          return;
                        }
                        if (propertyIsCamera) {
                          selectCameraProperty(keyframe.property);
                        }
                        selectKeyboardActivatedKeyframe(keyframe.id, event);
                      }}
                      className={`absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                        keyframeSelected
                          ? "scale-125 bg-accent shadow-glow ring-2 ring-white/80"
                          : active
                            ? "bg-accent shadow-glow"
                            : "bg-white"
                      }`}
                      style={{
                        left: `${(keyframe.time / duration) * 100}%`,
                      }}
                    />
                  );
                })}
                {selectedCamera && activeCameraProperty
                  ? selectedCameraPropertyKeyframes.map((keyframe) => {
                      const atPlayhead =
                        Math.abs(keyframe.time - playhead) <= 0.001;
                      const keyframeSelected = selectedKeyframeIdSet.has(
                        keyframe.id,
                      );
                      return (
                        <Button
                          key={`camera-active-${keyframe.id}`}
                          hideLabel
                          label={`${formatCameraProperty(activeCameraProperty)} keyframe`}
                          variant="ghost"
                          size="sm"
                          aria-pressed={keyframeSelected}
                          onPointerDown={(event) =>
                            beginCameraKeyframeTimingDrag(keyframe, event)
                          }
                          onPointerMove={updateCameraKeyframeTimingDrag}
                          onPointerUp={endCameraKeyframeTimingDrag}
                          onPointerCancel={endCameraKeyframeTimingDrag}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressNextKeyframeClickRef.current) {
                              suppressNextKeyframeClickRef.current = false;
                              return;
                            }
                            selectCameraProperty(activeCameraProperty);
                            selectKeyboardActivatedKeyframe(keyframe.id, event);
                            setPlayhead(clamp(keyframe.time, 0, duration));
                          }}
                          className={`absolute top-1/2 z-20 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                            keyframeSelected
                              ? "scale-125 bg-accent text-accent-fg shadow-glow ring-2 ring-white/80"
                              : atPlayhead
                                ? "bg-accent text-accent-fg shadow-glow"
                                : "bg-accent"
                          }`}
                          style={{
                            left: `${(keyframe.time / duration) * 100}%`,
                          }}
                        >
                          <span className="sr-only">
                            {formatTime(keyframe.time)}
                          </span>
                        </Button>
                      );
                    })
                  : null}
              </div>
            </div>
            ) : null}

            {lights.map((light, lightIndex) => {
              const selected = selectedLight?.id === light.id;
              const lightProperty =
                selected && activeLightProperty
                  ? activeLightProperty
                  : "light.intensity";
              const propertyKeyframes = getMotionLightPropertyKeyframes(
                light,
                lightProperty,
              );
              return (
                <div key={light.id} className="contents">
                  <div
                    className={`sticky left-0 z-10 grid border-b border-r border-border bg-bg-1 transition-colors ${
                      selected ? "bg-accent-soft" : "hover:bg-hover"
                    }`}
                    style={{
                      gridTemplateColumns: TIMELINE_RAIL_COLUMNS,
                      height: TIMELINE_ROW_HEIGHT,
                    }}
                  >
                    <div className="flex items-center justify-center px-2 text-[10px] font-semibold text-fg-muted">
                      L{lightIndex + 1}
                    </div>
                    <button
                      type="button"
                      aria-label={`Select ${light.name}`}
                      onClick={() => selectLightProperty(light.id, lightProperty)}
                      className="flex min-w-0 items-center gap-1.5 px-1.5 text-left"
                    >
                      <Lightbulb
                        size={13}
                        className={`shrink-0 ${selected ? "text-accent" : "text-fg-muted"}`}
                        aria-hidden
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] ${
                          selected ? "font-semibold text-accent" : "font-medium text-fg-2"
                        }`}
                        title={light.name}
                      >
                        {light.name}
                      </span>
                    </button>
                    <div className="flex items-center px-2 text-[10.5px] text-fg-muted">
                      Light
                    </div>
                    <div className="flex items-center px-2 text-[11px] text-fg-muted">
                      -
                    </div>
                    <div className="flex items-center justify-end px-2 font-mono text-[10.5px] tabular-nums text-fg-3">
                      {formatTime(0)}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectLightProperty(light.id, lightProperty)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectLightProperty(light.id, lightProperty);
                      }
                    }}
                    className={`relative border-b border-border transition-colors ${
                      selected ? "bg-accent-soft" : "hover:bg-hover"
                    }`}
                    style={{ height: TIMELINE_ROW_HEIGHT }}
                  >
                    <div
                      className="pointer-events-none absolute left-0 right-0 top-1/2 flex h-[18px] -translate-y-1/2 items-center rounded-[5px] pl-2 text-[10px] font-semibold leading-none"
                      style={{ backgroundColor: "#e8a44a", color: "#7a4a10" }}
                    >
                      {light.name}
                    </div>
                    {(light.keyframes ?? []).map((keyframe) => {
                      const propertyIsLight = isMotionLightProperty(keyframe.property);
                      const keyframeSelected = selectedKeyframeIdSet.has(
                        keyframe.id,
                      );
                      if (selected && keyframe.property === activeLightProperty) {
                        return null;
                      }
                      const active =
                        selected &&
                        propertyIsLight &&
                        selectedProperty === keyframe.property;
                      return (
                        <Button
                          key={keyframe.id}
                          hideLabel
                          label={
                            propertyIsLight
                              ? formatLightProperty(keyframe.property)
                              : keyframe.property
                          }
                          variant="ghost"
                          size="sm"
                          aria-pressed={keyframeSelected}
                          onPointerDown={(event) => {
                            if (propertyIsLight) {
                              selectLightProperty(light.id, keyframe.property);
                            }
                            beginLightKeyframeTimingDrag(light, keyframe, event);
                          }}
                          onPointerMove={updateLightKeyframeTimingDrag}
                          onPointerUp={endLightKeyframeTimingDrag}
                          onPointerCancel={endLightKeyframeTimingDrag}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (suppressNextKeyframeClickRef.current) {
                              suppressNextKeyframeClickRef.current = false;
                              return;
                            }
                            if (propertyIsLight) {
                              selectLightProperty(light.id, keyframe.property);
                            }
                            selectKeyboardActivatedKeyframe(keyframe.id, event);
                          }}
                          className={`absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                            keyframeSelected
                              ? "scale-125 bg-accent shadow-glow ring-2 ring-white/80"
                              : active
                                ? "bg-accent shadow-glow"
                                : "bg-white"
                          }`}
                          style={{
                            left: `${(keyframe.time / duration) * 100}%`,
                          }}
                        />
                      );
                    })}
                    {selected && activeLightProperty
                      ? propertyKeyframes.map((keyframe) => {
                          const atPlayhead =
                            Math.abs(keyframe.time - playhead) <= 0.001;
                          const keyframeSelected = selectedKeyframeIdSet.has(
                            keyframe.id,
                          );
                          return (
                            <Button
                              key={`light-active-${keyframe.id}`}
                              hideLabel
                              label={`${formatLightProperty(activeLightProperty)} keyframe`}
                              variant="ghost"
                              size="sm"
                              aria-pressed={keyframeSelected}
                              onPointerDown={(event) =>
                                beginLightKeyframeTimingDrag(light, keyframe, event)
                              }
                              onPointerMove={updateLightKeyframeTimingDrag}
                              onPointerUp={endLightKeyframeTimingDrag}
                              onPointerCancel={endLightKeyframeTimingDrag}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (suppressNextKeyframeClickRef.current) {
                                  suppressNextKeyframeClickRef.current = false;
                                  return;
                                }
                                selectLightProperty(light.id, activeLightProperty);
                                selectKeyboardActivatedKeyframe(keyframe.id, event);
                                setPlayhead(clamp(keyframe.time, 0, duration));
                              }}
                              className={`absolute top-1/2 z-20 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                                keyframeSelected
                                  ? "scale-125 bg-accent text-accent-fg shadow-glow ring-2 ring-white/80"
                                  : atPlayhead
                                    ? "bg-accent text-accent-fg shadow-glow"
                                    : "bg-accent"
                              }`}
                              style={{
                                left: `${(keyframe.time / duration) * 100}%`,
                              }}
                            >
                              <span className="sr-only">
                                {formatTime(keyframe.time)}
                              </span>
                            </Button>
                          );
                        })
                      : null}
                  </div>
                </div>
              );
            })}

            {(composition.audioClips ?? []).map((audioClip, audioIndex) => {
              const selected = selectedAudioClipId === audioClip.id;
              const left = (audioClip.startTime / duration) * 100;
              const width = (audioClip.duration / duration) * 100;
              const clipName = audioClip.name?.trim() || `Audio ${audioIndex + 1}`;
              const fadeInWidth = Math.min(
                100,
                ((audioClip.fadeIn ?? 0) / Math.max(audioClip.duration, 0.001)) *
                  100,
              );
              const fadeOutWidth = Math.min(
                100,
                ((audioClip.fadeOut ?? 0) / Math.max(audioClip.duration, 0.001)) *
                  100,
              );
              return (
                <div key={audioClip.id} className="contents">
                  <div
                    className={`sticky left-0 z-10 grid border-b border-r border-border transition-colors ${
                      selected ? "bg-selected" : "bg-bg-1 hover:bg-hover"
                    }`}
                    style={{
                      gridTemplateColumns: TIMELINE_RAIL_COLUMNS,
                      height: TIMELINE_ROW_HEIGHT,
                    }}
                  >
                    <div className="flex items-center justify-center px-2 text-[10.5px] font-semibold tabular-nums text-status-success">
                      A{audioIndex + 1}
                    </div>
                    <button
                      type="button"
                      aria-label={`Select audio clip ${clipName}`}
                      onClick={() => selectAudioClip(audioClip.id)}
                      className="relative flex min-w-0 items-center gap-1.5 px-3 text-left"
                    >
                      <span className="absolute bottom-0 left-0 top-0 w-1 bg-status-success" />
                      <Music2
                        size={13}
                        className={`shrink-0 ${
                          selected ? "text-status-success" : "text-fg-muted"
                        }`}
                        aria-hidden
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-[12px] ${
                          selected ? "font-semibold text-fg" : "font-medium text-fg-2"
                        }`}
                        title={clipName}
                      >
                        {clipName}
                      </span>
                    </button>
                    <div className="flex items-center gap-0.5 px-1.5">
                      <TimelineLayerSwitch
                        icon={audioClip.muted ? VolumeX : Volume2}
                        label={audioClip.muted ? "Unmute audio clip" : "Mute audio clip"}
                        active={!audioClip.muted}
                        activeClassName="text-status-success"
                        onClick={() =>
                          patchAudioClip(audioClip.id, (clip) => ({
                            ...clip,
                            muted: !clip.muted,
                          }))
                        }
                      />
                      <TimelineLayerSwitch
                        icon={Trash2}
                        label="Delete audio clip"
                        active={false}
                        activeClassName="text-status-danger"
                        onClick={() => removeAudioClip(audioClip.id)}
                      />
                    </div>
                    <div className="flex min-w-0 items-center px-2 text-[10.5px] text-fg-muted">
                      Audio
                    </div>
                    <div className="flex items-center justify-end px-2 font-mono text-[10.5px] tabular-nums text-fg-3">
                      {formatTime(audioClip.startTime)}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Audio timeline clip ${clipName}`}
                    onClick={() => selectAudioClip(audioClip.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectAudioClip(audioClip.id);
                      }
                      if (
                        (event.key === "Delete" || event.key === "Backspace") &&
                        selected
                      ) {
                        event.preventDefault();
                        removeAudioClip(audioClip.id);
                      }
                    }}
                    className={`relative border-b border-border transition-colors ${
                      selected ? "bg-selected" : "bg-tl-bg hover:bg-hover"
                    }`}
                    style={{ height: TIMELINE_ROW_HEIGHT }}
                  >
                    <button
                      type="button"
                      aria-label={`Move audio clip ${clipName} in time`}
                      onPointerDown={(event) =>
                        beginAudioTimingDrag(audioClip, "move", event)
                      }
                      onPointerMove={updateAudioTimingDrag}
                      onPointerUp={endAudioTimingDrag}
                      onPointerCancel={endAudioTimingDrag}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectAudioClip(audioClip.id);
                      }}
                      className={`group/bar absolute top-1/2 z-10 flex h-[20px] min-w-[14px] -translate-y-1/2 items-center overflow-hidden rounded-[5px] text-left transition-opacity ${
                        selected
                          ? "ring-2 ring-status-success ring-offset-1 ring-offset-tl-bg"
                          : "opacity-90 hover:opacity-100"
                      } cursor-grab active:cursor-grabbing`}
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 1.5)}%`,
                        backgroundColor: "#14b8a6",
                        color: "#064e3b",
                      }}
                    >
                      {fadeInWidth > 0 ? (
                        <span
                          className="pointer-events-none absolute bottom-0 left-0 top-0 border-r border-white/40 bg-gradient-to-r from-black/35 to-transparent"
                          style={{ width: `${fadeInWidth}%` }}
                        />
                      ) : null}
                      {fadeOutWidth > 0 ? (
                        <span
                          className="pointer-events-none absolute bottom-0 right-0 top-0 border-l border-white/40 bg-gradient-to-l from-black/35 to-transparent"
                          style={{ width: `${fadeOutWidth}%` }}
                        />
                      ) : null}
                      <span
                        role="button"
                        tabIndex={-1}
                        title="Trim audio in"
                        aria-label={`Trim ${clipName} in point`}
                        onPointerDown={(event) =>
                          beginAudioTimingDrag(audioClip, "trim-start", event)
                        }
                        onPointerMove={updateAudioTimingDrag}
                        onPointerUp={endAudioTimingDrag}
                        onPointerCancel={endAudioTimingDrag}
                        className={`absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize rounded-l-[5px] bg-white/75 transition-opacity ${
                          selected
                            ? "opacity-100"
                            : "opacity-0 group-hover/bar:opacity-100"
                        }`}
                      />
                      <span className="pointer-events-none z-[1] flex min-w-0 flex-1 items-center gap-1 px-2 text-[10px] font-semibold leading-none">
                        <Music2 size={10} className="shrink-0" aria-hidden />
                        <span className="truncate">{clipName}</span>
                        <span className="ml-auto shrink-0 tabular-nums opacity-75">
                          {Math.round((audioClip.gain ?? 1) * 100)}%
                        </span>
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        title="Trim audio out"
                        aria-label={`Trim ${clipName} out point`}
                        onPointerDown={(event) =>
                          beginAudioTimingDrag(audioClip, "trim-end", event)
                        }
                        onPointerMove={updateAudioTimingDrag}
                        onPointerUp={endAudioTimingDrag}
                        onPointerCancel={endAudioTimingDrag}
                        className={`absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize rounded-r-[5px] bg-white/75 transition-opacity ${
                          selected
                            ? "opacity-100"
                            : "opacity-0 group-hover/bar:opacity-100"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}

            {displayedLayers.length === 0 &&
            (composition.audioClips ?? []).length === 0 ? (
              <div className="col-span-2 flex h-24 items-center justify-center text-[12px] text-fg-muted">
                {timelineIsFiltered
                  ? "No layers match the current timeline filters."
                  : composition.layers.length > 0
                    ? "All layers are hidden by the shy switch."
                  : "Layers you add will appear here as tracks."}
              </div>
            ) : (
              displayedLayers.map((layer, index) => {
                const Icon = TRACK_ICON[layer.type];
                const selected = selectedLayerIdSet.has(layer.id);
                const activeLayer = selectedLayerId === layer.id;
                const left = (layer.startTime / duration) * 100;
                const width = (layer.duration / duration) * 100;
                const depth = timelineLayerDepth(layer);
                const hasKeyframes = layer.keyframes.length > 0;
                const revealForLayer =
                  revealedProperties?.layerId === layer.id
                    ? revealedProperties.properties
                    : null;
                const expanded =
                  revealForLayer !== null || expandedLayerIds.has(layer.id);
                const maskPathGroups = buildMaskPathPropertyGroups(layer);
                const propertyGroups =
                  revealForLayer !== null
                    ? buildRevealedPropertyGroups(layer, revealForLayer)
                    : expanded
                      ? [...buildLayerPropertyGroups(layer), ...maskPathGroups]
                      : maskPathGroups;
                return (
                  <div key={layer.id} className="contents">
                    <div
                      className={`sticky left-0 z-10 grid border-b border-border transition-colors ${
                        selected ? "bg-selected" : "bg-bg-1 hover:bg-hover"
                      } ${layer.visible ? "" : "opacity-55"}`}
                      style={{
                        gridTemplateColumns: TIMELINE_RAIL_COLUMNS,
                        height: TIMELINE_ROW_HEIGHT,
                      }}
                    >
                      <div className="flex items-center justify-center px-2 text-[10.5px] tabular-nums text-fg-muted">
                        {orderedLayers.indexOf(layer) + 1}
                      </div>
                      <div
                        className="relative flex min-w-0 items-center"
                        style={{ paddingLeft: `${depth * 12 + 4}px` }}
                      >
                        <span
                          className={`absolute bottom-0 left-0 top-0 w-1 ${layer.labelColor ? "" : TRACK_COLOR[layer.type]}`}
                          style={layer.labelColor ? { backgroundColor: layer.labelColor } : undefined}
                        />
                        {hasKeyframes ? (
                          <button
                            type="button"
                            aria-label={
                              expanded
                                ? `Collapse ${layer.name} properties`
                                : `Expand ${layer.name} properties`
                            }
                            aria-expanded={expanded}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleLayerExpanded(layer.id);
                            }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg-muted hover:text-fg-2"
                          >
                            {expanded ? (
                              <ChevronDown size={11} />
                            ) : (
                              <ChevronRight size={11} />
                            )}
                          </button>
                        ) : (
                          <span className="h-4 w-4 shrink-0" />
                        )}
                        <button
                          type="button"
                          aria-label={`Select ${layer.name}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            selectTimelineLayer(layer.id, event);
                          }}
                          className="scroll-mt-[66px] flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left"
                        >
                          <Icon
                            size={13}
                            className={`shrink-0 ${selected ? "text-accent" : "text-fg-muted"}`}
                            aria-hidden
                          />
                          <span
                            className={`min-w-0 flex-1 truncate text-[12px] text-fg-2 ${
                              selected ? "font-semibold" : "font-medium"
                            }`}
                            title={layer.name}
                          >
                            {layer.name}
                          </span>
                        </button>
                      </div>
                      {timelineColumnMode === "modes" ? (
                        <div
                          className="flex items-center px-1.5"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <select
                            aria-label="Layer blend mode"
                            value={layer.blendMode ?? "normal"}
                            onChange={(event) =>
                              patchTimelineLayer(layer.id, {
                                blendMode: event.target
                                  .value as MotionLayer["blendMode"],
                              } as Partial<MotionLayer>)
                            }
                            className="w-full cursor-pointer truncate bg-transparent text-[10.5px] font-medium text-fg-2 outline-none"
                          >
                            {MOTION_BLEND_MODE_OPTIONS.map(
                              (option: MotionBlendModeOption) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 px-1.5">
                          <TimelineLayerSwitch
                            icon={layer.visible ? Eye : EyeOff}
                            label="Layer visibility"
                            active={layer.visible}
                            activeClassName="text-fg-2"
                            onClick={() =>
                              patchTimelineLayer(layer.id, {
                                visible: !layer.visible,
                              } as Partial<MotionLayer>)
                            }
                          />
                          <TimelineLayerSwitch
                            icon={Star}
                            label="Solo layer"
                            active={Boolean(layer.solo)}
                            activeClassName="text-status-warning"
                            fillWhenActive
                            onClick={() =>
                              patchTimelineLayer(layer.id, {
                                solo: !layer.solo,
                              } as Partial<MotionLayer>)
                            }
                          />
                          <TimelineLayerSwitch
                            icon={layer.locked ? Lock : Unlock}
                            label="Lock layer"
                            active={Boolean(layer.locked)}
                            activeClassName="text-status-warning"
                            onClick={() =>
                              patchTimelineLayer(layer.id, {
                                locked: !layer.locked,
                              } as Partial<MotionLayer>)
                            }
                          />
                          <TimelineLayerSwitch
                            icon={Ruler}
                            label="Guide layer"
                            active={Boolean(layer.guideLayer)}
                            activeClassName="text-accent"
                            onClick={() =>
                              patchTimelineLayer(layer.id, {
                                guideLayer: !layer.guideLayer,
                              } as Partial<MotionLayer>)
                            }
                          />
                          <TimelineLayerSwitch
                            icon={VenetianMask}
                            label="Shy layer"
                            active={Boolean(layer.shy)}
                            activeClassName="text-accent"
                            onClick={() =>
                              patchTimelineLayer(layer.id, {
                                shy: !layer.shy,
                              } as Partial<MotionLayer>)
                            }
                          />
                        </div>
                      )}
                      <div className="flex min-w-0 items-center px-2 text-[10.5px] text-fg-3">
                        <span
                          className={`truncate ${
                            layer.parentId ? "text-fg-2" : "text-fg-muted"
                          }`}
                          title={timelineParentName(layer)}
                        >
                          {timelineParentName(layer)}
                        </span>
                      </div>
                      <div className="flex items-center justify-end px-2 font-mono text-[10.5px] tabular-nums text-fg-3">
                        {formatTime(layer.startTime)}
                      </div>
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(event) => selectTimelineLayer(layer.id, event)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectTimelineLayer(layer.id, event);
                        }
                      }}
                      className={`relative border-b border-border transition-colors ${
                        selected
                          ? "bg-selected"
                          : `hover:bg-hover ${index % 2 === 0 ? "bg-bg" : "bg-tl-bg"}`
                      }`}
                      style={{ height: TIMELINE_ROW_HEIGHT }}
                    >
                      {depth > 0 ? (
                        <div
                          className="pointer-events-none absolute bottom-1.5 top-1.5 border-l border-fg-muted/25"
                          style={{ left: `${Math.max(8, depth * 12)}px` }}
                        />
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Move ${layer.name} in time`}
                        disabled={layer.locked}
                        onPointerDown={(event) =>
                          beginTimingDrag(layer, "move", event)
                        }
                        onPointerMove={updateTimingDrag}
                        onPointerUp={endTimingDrag}
                        onPointerCancel={endTimingDrag}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectTimelineLayer(layer.id, event);
                        }}
                        className={`group/bar absolute top-1/2 z-10 flex h-[18px] min-w-[14px] -translate-y-1/2 items-center overflow-hidden rounded-[5px] text-left ${
                          selected
                            ? "ring-2 ring-accent ring-offset-1 ring-offset-tl-bg"
                            : "opacity-90 hover:opacity-100"
                        } cursor-grab transition-opacity active:cursor-grabbing disabled:cursor-not-allowed`}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 1.5)}%`,
                          backgroundColor: layer.labelColor ?? BAR_COLOR[layer.type],
                        }}
                      >
                        <span
                          role="button"
                          tabIndex={-1}
                          title="Trim layer in"
                          aria-label={`Trim ${layer.name} in point`}
                          onPointerDown={(event) =>
                            beginTimingDrag(layer, "trim-start", event)
                          }
                          onPointerMove={updateTimingDrag}
                          onPointerUp={endTimingDrag}
                          onPointerCancel={endTimingDrag}
                          className={`absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-[5px] bg-white/70 transition-opacity ${
                            selected ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100"
                          }`}
                        />
                        <span
                          className="pointer-events-none flex min-w-0 flex-1 items-center px-2 text-[10px] font-semibold leading-none"
                          style={{ color: BAR_LABEL_COLOR[layer.type] }}
                        >
                          <span className="truncate">{layer.name}</span>
                        </span>
                        <span
                          role="button"
                          tabIndex={-1}
                          title="Trim layer out"
                          aria-label={`Trim ${layer.name} out point`}
                          onPointerDown={(event) =>
                            beginTimingDrag(layer, "trim-end", event)
                          }
                          onPointerMove={updateTimingDrag}
                          onPointerUp={endTimingDrag}
                          onPointerCancel={endTimingDrag}
                          className={`absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-[5px] bg-white/70 transition-opacity ${
                            selected ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100"
                          }`}
                        />
                      </button>
                      {layer.keyframes.map((keyframe) => {
                        const propertyIsMotion = isMotionAnimatableProperty(
                          keyframe.property,
                        );
                        const keyframeSelected = selectedKeyframeIdSet.has(
                          keyframe.id,
                        );
                        if (activeLayer && keyframe.property === activeProperty) {
                          return null;
                        }
                        const descriptor = propertyIsMotion
                          ? getLayerSpecificMotionPropertyDescriptor(
                              layer,
                              keyframe.property,
                            )
                          : undefined;
                        const active =
                          activeLayer &&
                          propertyIsMotion &&
                          selectedProperty === keyframe.property;
                        const absoluteTime = layer.startTime + keyframe.time;
                        return (
                          <Button
                            key={keyframe.id}
                            hideLabel
                            label={descriptor?.label ?? keyframe.property}
                            variant="ghost"
                            size="sm"
                            aria-pressed={keyframeSelected}
                            onPointerDown={(event) => {
                              setSelectedProperty(keyframe.property);
                              beginKeyframeTimingDrag(layer, keyframe, event);
                            }}
                            onPointerMove={updateKeyframeTimingDrag}
                            onPointerUp={endKeyframeTimingDrag}
                            onPointerCancel={endKeyframeTimingDrag}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (suppressNextKeyframeClickRef.current) {
                                suppressNextKeyframeClickRef.current = false;
                                return;
                              }
                              selectLayer(layer.id);
                              selectKeyboardActivatedKeyframe(keyframe.id, event);
                              if (propertyIsMotion) {
                                setSelectedProperty(keyframe.property);
                                setRightTab("graph");
                              }
                            }}
                            className={`absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                              keyframeSelected
                                ? "scale-125 bg-accent shadow-glow ring-2 ring-white/80"
                                : active
                                  ? "bg-accent shadow-glow"
                                  : "bg-white"
                            }`}
                            style={{
                              left: `${(absoluteTime / duration) * 100}%`,
                            }}
                          />
                        );
                      })}
                      {activeLayer
                        ? selectedPropertyKeyframes.map((keyframe) => {
                            const absoluteTime = layer.startTime + keyframe.time;
                            const atPlayhead =
                              Math.abs(
                                keyframe.time - selectedLayerLocalPlayhead,
                              ) <= 0.001;
                            const keyframeSelected = selectedKeyframeIdSet.has(
                              keyframe.id,
                            );
                            return (
                              <Button
                                key={`active-${keyframe.id}`}
                                hideLabel
                                label={`${activePropertyDescriptor?.label ?? activeProperty} keyframe`}
                                variant="ghost"
                                size="sm"
                                aria-pressed={keyframeSelected}
                                onPointerDown={(event) =>
                                  beginKeyframeTimingDrag(layer, keyframe, event)
                                }
                                onPointerMove={updateKeyframeTimingDrag}
                                onPointerUp={endKeyframeTimingDrag}
                                onPointerCancel={endKeyframeTimingDrag}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (suppressNextKeyframeClickRef.current) {
                                    suppressNextKeyframeClickRef.current = false;
                                    return;
                                  }
                                  selectLayer(layer.id);
                                  selectKeyboardActivatedKeyframe(keyframe.id, event);
                                  setSelectedProperty(activeProperty);
                                  setPlayhead(clamp(absoluteTime, 0, duration));
                                }}
                                className={`absolute top-1/2 z-20 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                                  keyframeSelected
                                    ? "scale-125 bg-accent text-accent-fg shadow-glow ring-2 ring-white/80"
                                    : atPlayhead
                                      ? "bg-accent text-accent-fg shadow-glow"
                                      : "bg-accent"
                                }`}
                                style={{
                                  left: `${(absoluteTime / duration) * 100}%`,
                                }}
                              >
                                <span className="sr-only">
                                  {formatTime(absoluteTime)}
                                </span>
                              </Button>
                            );
                          })
                        : null}
                    </div>
                    {propertyGroups.length > 0
                      ? propertyGroups.map((group) => {
                          const isMaskPathGroup =
                            parseMotionMaskPathKeyframeProperty(
                              group.property,
                            ) !== null;
                          const laneColor = motionPropertyLaneColor(
                            group.property,
                          );
                          const propertyLabel =
                            getLayerSpecificMotionPropertyDescriptor(
                              layer,
                              group.property,
                            )?.label ?? group.property;
                          const rangeStart = layer.startTime + group.minTime;
                          const rangeEnd = layer.startTime + group.maxTime;
                          const barLeft = (rangeStart / duration) * 100;
                          const barWidth = Math.max(
                            ((rangeEnd - rangeStart) / duration) * 100,
                            0,
                          );
                          return (
                            <div
                              key={`${layer.id}-prop-${group.property}`}
                              className="contents"
                            >
                              <div
                                className={`sticky left-0 z-10 grid border-b border-border ${
                                  selected ? "bg-selected" : "bg-bg-1"
                                }`}
                                style={{
                                  gridTemplateColumns: TIMELINE_RAIL_COLUMNS,
                                  height: TIMELINE_ROW_HEIGHT,
                                }}
                              >
                                <div />
                                <div
                                  className="flex min-w-0 items-center gap-1.5 pr-2"
                                  style={{
                                    paddingLeft: `${depth * 12 + 28}px`,
                                  }}
                                >
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: laneColor }}
                                  />
                                  <span
                                    className="min-w-0 truncate text-[11px] text-fg-3"
                                    title={propertyLabel}
                                  >
                                    {propertyLabel}
                                  </span>
                                </div>
                                <div />
                                <div />
                                <div />
                              </div>
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={(event) =>
                                  selectTimelineLayer(layer.id, event)
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    selectTimelineLayer(layer.id, event);
                                  }
                                }}
                                className={`relative border-b border-border transition-colors ${
                                  selected
                                    ? "bg-selected"
                                    : `hover:bg-hover ${
                                        index % 2 === 0 ? "bg-bg" : "bg-tl-bg"
                                      }`
                                }`}
                                style={{ height: TIMELINE_ROW_HEIGHT }}
                              >
                                <div
                                  className="pointer-events-none absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full opacity-70"
                                  style={{
                                    left: `${barLeft}%`,
                                    width: `${barWidth}%`,
                                    backgroundColor: laneColor,
                                  }}
                                />
                                {group.keyframes.map((keyframe) => {
                                  const absoluteTime =
                                    layer.startTime + keyframe.time;
                                  const active =
                                    activeLayer &&
                                    selectedProperty === group.property;
                                  const keyframeSelected = selectedKeyframeIdSet.has(
                                    keyframe.id,
                                  );
                                  const maskId = isMaskPathGroup
                                    ? parseMotionMaskPathKeyframeProperty(
                                        group.property,
                                      )?.maskId ?? null
                                    : null;
                                  return (
                                    <Button
                                      key={`prop-${group.property}-${keyframe.id}`}
                                      hideLabel
                                      label={`${propertyLabel} keyframe`}
                                      variant="ghost"
                                      size="sm"
                                      aria-pressed={keyframeSelected}
                                      onPointerDown={(event) => {
                                        setSelectedProperty(group.property);
                                        if (maskId) {
                                          beginMaskPathKeyframeTimingDrag(
                                            layer,
                                            maskId,
                                            keyframe,
                                            event,
                                          );
                                          return;
                                        }
                                        beginKeyframeTimingDrag(
                                          layer,
                                          keyframe,
                                          event,
                                        );
                                      }}
                                      onPointerMove={
                                        maskId
                                          ? updateMaskPathKeyframeTimingDrag
                                          : updateKeyframeTimingDrag
                                      }
                                      onPointerUp={
                                        maskId
                                          ? endMaskPathKeyframeTimingDrag
                                          : endKeyframeTimingDrag
                                      }
                                      onPointerCancel={
                                        maskId
                                          ? endMaskPathKeyframeTimingDrag
                                          : endKeyframeTimingDrag
                                      }
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (
                                          suppressNextKeyframeClickRef.current
                                        ) {
                                          suppressNextKeyframeClickRef.current =
                                            false;
                                          return;
                                        }
                                        selectLayer(layer.id);
                                        selectKeyboardActivatedKeyframe(
                                          keyframe.id,
                                          event,
                                        );
                                        setSelectedProperty(group.property);
                                        setRightTab("graph");
                                      }}
                                      className={`absolute top-1/2 z-20 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize p-0 transition-transform hover:scale-150 ${
                                        keyframeSelected
                                          ? "scale-125 bg-accent shadow-glow ring-2 ring-white/80"
                                          : active
                                            ? "bg-accent shadow-glow"
                                            : "bg-white"
                                      }`}
                                      style={{
                                        left: `${(absoluteTime / duration) * 100}%`,
                                        boxShadow: active
                                          ? undefined
                                          : `0 0 0 1px ${laneColor}`,
                                      }}
                                    >
                                      <span className="sr-only">
                                        {formatTime(absoluteTime)}
                                      </span>
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      : null}
                  </div>
                );
              })
            )}
          </div>

          <div
            className="pointer-events-none absolute inset-y-0 z-30"
            style={{ left: RAIL_WIDTH, right: 0 }}
          >
            {ticks.map((value) => (
              <div
                key={`grid-${value}`}
                className="absolute inset-y-0 w-px bg-border/55"
                style={{ left: `${(value / duration) * 100}%` }}
              />
            ))}
            {hasCustomWorkArea ? (
              <div
                className="absolute inset-y-0 border-x border-accent/50 bg-accent/5"
                style={{
                  left: `${(activeWorkAreaStart / duration) * 100}%`,
                  width: `${((activeWorkAreaEnd - activeWorkAreaStart) / duration) * 100}%`,
                }}
              />
            ) : null}
            {timelineBeatMarkers.map((marker) => (
              <div
                key={`beat-line-${marker.index}-${marker.time}`}
                className={`absolute inset-y-0 ${
                  marker.isDownbeat
                    ? "w-px bg-status-warning/45"
                    : "w-px bg-status-warning/20"
                }`}
                style={{ left: `${(marker.time / duration) * 100}%` }}
              />
            ))}
            {timelineMarkers.map((marker) => (
              <div
                key={`marker-line-${marker.id}`}
                className="absolute inset-y-0 w-px opacity-60"
                style={{
                  left: `${(marker.time / duration) * 100}%`,
                  backgroundColor: marker.color,
                }}
              />
            ))}
            <div
              className="absolute inset-y-0 w-px bg-fg"
              style={{ left: `${playheadPct}%` }}
            >
              <span
                className="absolute -left-[6px] -top-px h-3 w-[13px] bg-fg"
                style={{ clipPath: "polygon(0 0,100% 0,100% 60%,50% 100%,0 60%)" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkerManager({
  markers,
  frameRate,
  onSeek,
  onUpdate,
  onDelete,
}: {
  markers: readonly MotionComposition["markers"][number][];
  frameRate: number;
  onSeek: (time: number) => void;
  onUpdate: (
    markerId: string,
    updates: Partial<MotionComposition["markers"][number]>,
  ) => void;
  onDelete: (markerId: string) => void;
}): JSX.Element {
  return (
    <div className="max-h-[360px] w-[320px] overflow-y-auto p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[11px] font-semibold text-fg">Composition markers</span>
        <span className="text-[10px] tabular-nums text-fg-muted">{markers.length}</span>
      </div>
      {markers.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-fg-muted">
          Add a marker at the playhead with M.
        </div>
      ) : (
        <div className="space-y-2">
          {markers.map((marker) => (
            <MarkerManagerRow
              key={marker.id}
              marker={marker}
              frameRate={frameRate}
              onSeek={onSeek}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MarkerManagerRow({
  marker,
  frameRate,
  onSeek,
  onUpdate,
  onDelete,
}: {
  marker: MotionComposition["markers"][number];
  frameRate: number;
  onSeek: (time: number) => void;
  onUpdate: (
    markerId: string,
    updates: Partial<MotionComposition["markers"][number]>,
  ) => void;
  onDelete: (markerId: string) => void;
}): JSX.Element {
  const [label, setLabel] = useState(marker.label);
  useEffect(() => setLabel(marker.label), [marker.label]);
  const commitLabel = () => {
    const nextLabel = label.trim() || "Marker";
    setLabel(nextLabel);
    if (nextLabel !== marker.label) onUpdate(marker.id, { label: nextLabel });
  };

  return (
    <div className="rounded-md border border-border bg-bg-2 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Seek to ${marker.label}`}
          onClick={() => onSeek(marker.time)}
          className="h-7 shrink-0 rounded border border-border bg-bg-1 px-2 font-mono text-[10px] tabular-nums text-fg-3 hover:border-accent hover:text-accent"
        >
          {formatMotionTimecode(marker.time, frameRate)}
        </button>
        <input
          aria-label={`Marker label for ${marker.label}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-7 min-w-0 flex-1 rounded border border-border bg-bg-1 px-2 text-[11px] font-medium text-fg outline-none focus:border-accent"
        />
        <IconButton
          label={`Delete ${marker.label}`}
          icon={<Trash2 size={12} aria-hidden />}
          size="sm"
          variant="danger"
          onClick={() => onDelete(marker.id)}
        />
      </div>
      <ColorInput
        value={marker.color}
        onChange={(color) => onUpdate(marker.id, { color })}
      />
    </div>
  );
}

function TransportButton({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={<Icon size={15} aria-hidden />}
      size="md"
      variant="ghost"
      isDisabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
    />
  );
}

function TimingMenuButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      label={label}
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-md border border-border bg-bg-2 px-2 text-[11px] font-semibold text-fg-3 transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
    />
  );
}

function TimelineLayerSwitch({
  icon: Icon,
  label,
  active,
  activeClassName,
  fillWhenActive = false,
  onClick,
}: {
  icon: typeof Type;
  label: string;
  active: boolean;
  activeClassName: string;
  fillWhenActive?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={
        <Icon
          size={11}
          aria-hidden
          fill={fillWhenActive && active ? "currentColor" : "none"}
        />
      }
      size="sm"
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-5 w-5 items-center justify-center rounded-[4px] transition-colors hover:bg-hover hover:text-fg ${
        active ? `bg-bg-2 ${activeClassName}` : "text-fg-muted"
      }`}
    />
  );
}

type MotionLayerKeyframe = MotionLayer["keyframes"][number];

interface MotionLayerPropertyGroup {
  readonly property: string;
  readonly keyframes: readonly MotionLayerKeyframe[];
  readonly minTime: number;
  readonly maxTime: number;
}

function buildMaskPathPropertyGroups(
  layer: MotionLayer,
): readonly MotionLayerPropertyGroup[] {
  return (layer.masks ?? []).flatMap((mask) => {
    if (mask.shape !== "path") return [];
    const keyframes = (mask.pathKeyframes ?? [])
      .slice()
      .sort((a, b) => a.time - b.time);
    if (keyframes.length === 0) return [];
    const times = keyframes.map((keyframe) => keyframe.time);
    return [
      {
        property: getMotionMaskPathKeyframeProperty(mask.id),
        keyframes,
        minTime: Math.min(...times),
        maxTime: Math.max(...times),
      },
    ];
  });
}

function buildLayerPropertyGroups(
  layer: MotionLayer,
): readonly MotionLayerPropertyGroup[] {
  const order: string[] = [];
  const byProperty = new Map<string, MotionLayerKeyframe[]>();
  for (const keyframe of layer.keyframes) {
    if (!isMotionAnimatableProperty(keyframe.property)) continue;
    const existing = byProperty.get(keyframe.property);
    if (existing) {
      existing.push(keyframe);
    } else {
      byProperty.set(keyframe.property, [keyframe]);
      order.push(keyframe.property);
    }
  }
  return order.map((property) => {
    const keyframes = (byProperty.get(property) ?? [])
      .slice()
      .sort((a, b) => a.time - b.time);
    const times = keyframes.map((keyframe) => keyframe.time);
    return {
      property,
      keyframes,
      minTime: times.length > 0 ? Math.min(...times) : 0,
      maxTime: times.length > 0 ? Math.max(...times) : 0,
    };
  });
}

function buildRevealedPropertyGroups(
  layer: MotionLayer,
  revealedProperties: readonly string[],
): readonly MotionLayerPropertyGroup[] {
  const byProperty = new Map<string, MotionLayerKeyframe[]>();
  for (const keyframe of layer.keyframes) {
    const existing = byProperty.get(keyframe.property);
    if (existing) {
      existing.push(keyframe);
    } else {
      byProperty.set(keyframe.property, [keyframe]);
    }
  }
  const seen = new Set<string>();
  const groups: MotionLayerPropertyGroup[] = [];
  for (const property of revealedProperties) {
    if (seen.has(property)) continue;
    if (!isMotionAnimatableProperty(property)) continue;
    seen.add(property);
    const keyframes = (byProperty.get(property) ?? [])
      .slice()
      .sort((a, b) => a.time - b.time);
    const times = keyframes.map((keyframe) => keyframe.time);
    groups.push({
      property,
      keyframes,
      minTime: times.length > 0 ? Math.min(...times) : 0,
      maxTime: times.length > 0 ? Math.max(...times) : 0,
    });
  }
  return groups;
}

function getLayerSpecificMotionPropertyDescriptor(
  layer: MotionLayer,
  property: string,
) {
  return (
    [
      ...getMotionLayerEffectPropertyDescriptors(layer),
      ...getMotionLayerMaskPropertyDescriptors(layer),
      ...getMotionLayerPuppetPropertyDescriptors(layer),
      ...getMotionLayerShapeModifierPropertyDescriptors(layer),
      ...getMotionLayerContentsPropertyDescriptors(layer),
    ].find((descriptor) => descriptor.property === property) ??
    getMotionPropertyDescriptor(property)
  );
}

function expandCompositionDurationToLayers(
  composition: MotionComposition,
): MotionComposition {
  const layerEnd = composition.layers.reduce(
    (max, layer) => Math.max(max, layer.startTime + layer.duration),
    composition.duration,
  );
  if (layerEnd <= composition.duration) return composition;
  return {
    ...composition,
    duration: Number(layerEnd.toFixed(4)),
    modifiedAt: Date.now(),
  };
}
