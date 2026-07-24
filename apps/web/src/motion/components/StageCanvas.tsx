import type { JSX } from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Camera,
  Diamond,
  Grid2x2,
  Grid3x3,
  Loader2,
  Magnet,
  Maximize,
  MemoryStick,
  Monitor,
  Pause,
  Play,
  Repeat,
  Ruler,
  SkipBack,
  SkipForward,
  SquareDashed,
  StepBack,
  StepForward,
  type LucideIcon,
} from "@/icons/lucide-compat";
import type {
  MediaItem,
  MotionAsset,
  MotionComposition,
  MotionGuide,
  MotionLayer,
  MotionRendererAssetResolver,
  MotionTransform,
} from "@openreel/core";
import {
  addMotionCompositionGuide,
  addMotionLayerMask,
  applyMotionCameraToTransform,
  createMaskId,
  buildMotionCssFilter,
  evaluateMotionEffectsAtTime,
  evaluateMotionShapeModifiersAtTime,
  buildMotionCssClipPath,
  buildMotionCssBlendMode,
  buildMotionShapePolyline,
  buildMotionSvgPathData,
  buildMotionPathData,
  createMotionGuide,
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  duplicateMotionLayers,
  evaluateMotionShapeLayerStyleAtTime,
  evaluateMotionLayerMasksAtTime,
  evaluateMotionPuppetPinsAtTime,
  getMotionLinearGradientLine,
  getMotionRadialGradientSpec,
  hasAdvancedMotionShapeStyle,
  getMotionLayerPositionPath,
  getMotionLayerLayoutBounds,
  getMotionLayerSelectionBounds,
  getMotionLayerVisualBounds,
  getMotionRepeaterCopies,
  getMotionRepeaterModifier,
  getMotionLayerChildren,
  getMotionRootLayers,
  getEditableMotionShapePathPoints,
  getMotionPathDrawCommands,
  getMotionCameraWorldDelta,
  getMotionLayerPropertyValueAtTime,
  getMotionCompositionLayerLocalTime,
  getMotionCompositionLayerSource,
  getMotionRoundCornersModifier,
  getMotionMaskPathPoints,
  getMotionShapePathKeyframes,
  getMotionSoloLayerIds,
  getMotionTrimPathsModifier,
  getMotionTextAnimatorRuns,
  getMotionPuppetPinKeyframeProperty,
  getMotionWigglePathsModifier,
  getTrimmedMotionPathPoints,
  insertMotionShapePathPoint,
  normalizeMotionGradientStops,
  normalizeMotionStroke,
  isMotionAnimatableProperty,
  isMotionGuideLayer,
  isMotionLayerContentVisible,
  isMotionLayerTreeVisible,
  MotionRenderer,
  moveMotionCompositionGuide,
  nudgeMotionLayers,
  removeMotionLayers,
  removeMotionShapePathPoint,
  setMotionShapePathPoint,
  setMotionShapePathPointHandle,
  setMotionShapePathPoints,
  getMotionTransformAtTime,
  hasEnabledMotionTextAnimators,
  resizeMotionLayerByHandle,
  resizeMotionLayerSelectionByHandle,
  resolveMotionLayerVariableBindings,
  rotateMotionLayerByPointer,
  rotateMotionLayerSelectionByPointer,
  setMotionLayerPositionPathPoint,
  setMotionLayersLocked,
  snapMotionLayerPosition,
  updateMotionLayerMask,
  updateMotionPuppetPin,
  upsertMotionLayerKeyframe,
  upsertMotionMaskPathKeyframe,
  type MotionLayerLayoutBounds,
  type MotionMask,
  type MotionPositionPathPoint,
  type MotionLayerResizeHandle,
  type MotionPuppetPin,
  type MotionShapePathPoint,
  type MotionSnapGuide,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  useMotionStore,
  type MotionPreviewCameraView,
  type MotionToolId,
} from "../stores/motion-store";
import { createWebMotionAssetResolver } from "../motion-asset-resolver";
import {
  moveHandle,
  moveVertex,
  penAddCorner,
  penDragHandles,
  penShouldClose,
  shouldShowSelectionHandles,
  toggleVertexSmooth,
} from "../stage-path-editing";
import {
  renderCreationStagePreviewFallbackImage,
  previewPixelsHaveForeground,
  resolveCreationStagePreviewFallback,
  type CreationStagePreviewFallback,
} from "../creation-stage-preview";
import {
  getMotionStagePreviewCanvasSize,
  getMotionStagePlaybackPreviewSettings,
  getMotionStagePreviewRenderQuality,
  layerUsesRendererPreview,
  shouldUseRendererBackedStagePreview,
  type MotionStagePreviewMode,
  type MotionStagePreviewResolution,
} from "../stage-preview-mode";
import { formatMotionTimecode } from "../motion-timecode";
import { exportMotionCompositionFramePng } from "../export-motion-frame";
import {
  MotionFrameCache,
  resolvePreviewFrame,
  drawAndMaybeCache,
  shouldInvalidateFrameCache,
  type FrameCacheInvalidationKey,
} from "../frame-cache";
import {
  getFrameCacheState,
  setFrameCacheState,
  subscribeFrameCacheState,
} from "../frame-cache-state";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import { startNativeAuroraStagePreviewSession } from "../native-aurora-preview-session";
import { ColorInput, IconButton, NumberInput } from "./primitives";

interface StageCanvasProps {
  composition: MotionComposition;
}

type StageLayerRenderMode = "visual" | "hit-test";

const MASK_PATH_EDITABLE_LAYER_TYPES: ReadonlySet<MotionLayer["type"]> = new Set([
  "shape",
  "text",
  "image",
  "video",
]);

function supportsMaskPathEditing(layer: MotionLayer): boolean {
  return MASK_PATH_EDITABLE_LAYER_TYPES.has(layer.type);
}

export function StageCanvas({ composition }: StageCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    readonly layerId: string;
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly layers: readonly {
      readonly layerId: string;
      readonly startX: number;
      readonly startY: number;
      readonly localTime: number;
      readonly writesPositionKeyframes: boolean;
    }[];
  } | null>(null);
  const guideDragRef = useRef<{
    readonly guideId: string;
    readonly orientation: MotionGuide["orientation"];
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly startPosition: number;
    readonly createdGuide?: MotionGuide;
  } | null>(null);
  const resizeDragRef = useRef<{
    readonly handle: MotionLayerResizeHandle;
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly layers: readonly {
      readonly layerId: string;
      readonly localTime: number;
      readonly originalLayer: MotionLayer;
      readonly writesTransformKeyframes: boolean;
    }[];
  } | null>(null);
  const rotateDragRef = useRef<{
    readonly pointerId: number;
    readonly center: { readonly x: number; readonly y: number };
    readonly startPointer: { readonly x: number; readonly y: number };
    readonly layers: readonly {
      readonly layerId: string;
      readonly localTime: number;
      readonly originalLayer: MotionLayer;
      readonly writesTransformKeyframes: boolean;
    }[];
  } | null>(null);
  const anchorDragRef = useRef<{
    readonly layerId: string;
    readonly pointerId: number;
    readonly localTime: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly startAnchorX: number;
    readonly startAnchorY: number;
    readonly startPosX: number;
    readonly startPosY: number;
    readonly width: number;
    readonly height: number;
    readonly writesPositionKeyframes: boolean;
  } | null>(null);
  const panDragRef = useRef<{
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly startPanX: number;
    readonly startPanY: number;
  } | null>(null);
  const positionPathDragRef = useRef<{
    readonly layerId: string;
    readonly pointerId: number;
    readonly time: number;
    readonly easing: MotionPositionPathPoint["easing"];
  } | null>(null);
  const shapePathDragRef = useRef<{
    readonly layerId: string;
    readonly pointIndex: number;
    readonly pointerId: number;
    readonly localTime: number;
    readonly writesPathKeyframes: boolean;
    readonly handle: "in" | "out" | null;
    readonly createSymmetricHandle: boolean;
    readonly symmetricHandle: boolean;
  } | null>(null);
  const [selectedShapeVertex, setSelectedShapeVertex] = useState<{
    readonly layerId: string;
    readonly pointIndex: number;
  } | null>(null);
  const maskPathDragRef = useRef<{
    readonly layerId: string;
    readonly maskId: string;
    readonly pointIndex: number;
    readonly pointerId: number;
    readonly localTime: number;
    readonly handle: "in" | "out" | null;
    readonly symmetric: boolean;
  } | null>(null);
  const [selectedMaskVertex, setSelectedMaskVertex] = useState<{
    readonly layerId: string;
    readonly maskId: string;
    readonly pointIndex: number;
  } | null>(null);
  const puppetPinDragRef = useRef<{
    readonly layerId: string;
    readonly pinId: string;
    readonly pointerId: number;
    readonly localTime: number;
    readonly writesPuppetKeyframes: boolean;
  } | null>(null);
  const penDraftRef = useRef<{
    readonly layerId: string;
    readonly maskTargetLayerId: string | null;
  } | null>(null);
  const penDraftPointsRef = useRef<MotionShapePathPoint[]>([]);
  const [penDraftPoints, setPenDraftPoints] = useState<MotionShapePathPoint[]>(
    [],
  );
  const [penCursor, setPenCursor] = useState<{
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const penDragRef = useRef<{
    readonly pointerId: number;
    readonly anchorStage: { readonly x: number; readonly y: number };
    readonly anchorLocal: MotionShapePathPoint;
    dragging: boolean;
  } | null>(null);
  const shapeDraftRef = useRef<{
    readonly tool: "rectangle" | "ellipse";
    readonly start: { readonly x: number; readonly y: number };
  } | null>(null);
  const [shapeDraftRect, setShapeDraftRect] = useState<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 960, height: 540 });
  const [snapGuides, setSnapGuides] = useState<MotionSnapGuide[]>([]);
  const playhead = useMotionStore((state) => state.playhead);
  const zoom = useMotionStore((state) => state.zoom);
  const setZoom = useMotionStore((state) => state.setZoom);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setSelectedLayers = useMotionStore((state) => state.setSelectedLayers);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const setAutoKeyframe = useMotionStore((state) => state.setAutoKeyframe);
  const snapEnabled = useMotionStore((state) => state.snapEnabled);
  const setSnapEnabled = useMotionStore((state) => state.setSnapEnabled);
  const showStageGrid = useMotionStore((state) => state.showStageGrid);
  const setShowStageGrid = useMotionStore((state) => state.setShowStageGrid);
  const showStageGuides = useMotionStore((state) => state.showStageGuides);
  const setShowStageGuides = useMotionStore((state) => state.setShowStageGuides);
  const gridSize = useMotionStore((state) => state.gridSize);
  const previewMode = useMotionStore((state) => state.previewMode);
  const setPreviewMode = useMotionStore((state) => state.setPreviewMode);
  const previewResolution = useMotionStore((state) => state.previewResolution);
  const setPreviewResolution = useMotionStore((state) => state.setPreviewResolution);
  const isPlaying = useMotionStore((state) => state.isPlaying);
  const exportActive = useMotionStore((state) => state.exportActive);
  const togglePlayback = useMotionStore((state) => state.togglePlayback);
  const loopPlayback = useMotionStore((state) => state.loopPlayback);
  const setLoopPlayback = useMotionStore((state) => state.setLoopPlayback);
  const playbackRate = useMotionStore((state) => state.playbackRate);
  const setPlaybackRate = useMotionStore((state) => state.setPlaybackRate);
  const activeTool = useMotionStore((state) => state.activeTool);
  const setActiveTool = useMotionStore((state) => state.setActiveTool);
  const maskDrawMode = useMotionStore((state) => state.maskDrawMode);
  const setMaskDrawMode = useMotionStore((state) => state.setMaskDrawMode);
  const stagePanX = useMotionStore((state) => state.stagePanX);
  const stagePanY = useMotionStore((state) => state.stagePanY);
  const setStagePan = useMotionStore((state) => state.setStagePan);
  const resetStagePan = useMotionStore((state) => state.resetStagePan);
  const showSafeMargins = useMotionStore((state) => state.showSafeMargins);
  const setShowSafeMargins = useMotionStore((state) => state.setShowSafeMargins);
  const showTransparencyGrid = useMotionStore((state) => state.showTransparencyGrid);
  const setShowTransparencyGrid = useMotionStore(
    (state) => state.setShowTransparencyGrid,
  );
  const previewCameraView = useMotionStore((state) => state.previewCameraView);
  const setPreviewCameraView = useMotionStore(
    (state) => state.setPreviewCameraView,
  );
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const togglePropertyReveal = useMotionStore(
    (state) => state.togglePropertyReveal,
  );
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const updateMotionCompositionPreview = useProjectStore(
    (state) => state.updateMotionCompositionPreview,
  );
  const commitMotionCompositionGesture = useProjectStore(
    (state) => state.commitMotionCompositionGesture,
  );
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );
  const creation = useProjectStore((state) => state.project.creation);
  const mediaItems = useProjectStore((state) => state.project.mediaLibrary.items);
  const compositionLibrary = useMemo(
    () =>
      motionCompositions.some((candidate) => candidate.id === composition.id)
        ? motionCompositions
        : [composition, ...motionCompositions],
    [composition, motionCompositions],
  );
  const assetResolver = useMemo(
    () => createWebMotionAssetResolver(mediaItems, { creation }),
    [creation, mediaItems],
  );

  const pendingCompositionRef = useRef<MotionComposition | null>(null);
  const commitRafRef = useRef<number | null>(null);
  const gestureStartRef = useRef<MotionComposition | null>(null);
  const pointerActiveRef = useRef(false);
  const latestCompositionRef = useRef<MotionComposition>(composition);
  latestCompositionRef.current = composition;
  const getStageInteractionActive = useCallback(
    () => gestureStartRef.current !== null || pointerActiveRef.current,
    [],
  );

  const flushPendingComposition = useCallback(() => {
    if (commitRafRef.current !== null) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = null;
    }
    const pending = pendingCompositionRef.current;
    pendingCompositionRef.current = null;
    if (pending) updateMotionCompositionPreview(pending);
    const gestureStart = gestureStartRef.current;
    gestureStartRef.current = null;
    if (gestureStart) {
      const finalComposition = pending ?? latestCompositionRef.current;
      void commitMotionCompositionGesture(gestureStart, finalComposition);
    }
  }, [commitMotionCompositionGesture, updateMotionCompositionPreview]);

  const scheduleComposition = useCallback(
    (next: MotionComposition) => {
      if (gestureStartRef.current === null) {
        gestureStartRef.current = latestCompositionRef.current;
      }
      pendingCompositionRef.current = next;
      if (commitRafRef.current !== null) return;
      commitRafRef.current = requestAnimationFrame(() => {
        commitRafRef.current = null;
        const pending = pendingCompositionRef.current;
        pendingCompositionRef.current = null;
        if (pending) updateMotionCompositionPreview(pending);
      });
    },
    [updateMotionCompositionPreview],
  );

  useEffect(() => {
    const flush = (): void => {
      pointerActiveRef.current = false;
      flushPendingComposition();
    };
    window.addEventListener("pointerup", flush);
    window.addEventListener("pointercancel", flush);
    return () => {
      window.removeEventListener("pointerup", flush);
      window.removeEventListener("pointercancel", flush);
      flushPendingComposition();
    };
  }, [flushPendingComposition]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stageScale = Math.min(
    zoom,
    Math.max(0.1, (containerSize.width - 96) / composition.width),
    Math.max(0.1, (containerSize.height - 96) / composition.height),
  );

  const rootLayers = getMotionRootLayers(composition);
  const soloLayerIds = getMotionSoloLayerIds(composition);
  const usesRendererPreview =
    shouldUseRendererBackedStagePreview(composition, compositionLibrary, {
      mode: previewMode,
      resolution: previewResolution,
    }) || composition.layers.some(layerUsesRendererPreview);
  const activePreviewResolution = getMotionStagePlaybackPreviewSettings(
    { mode: previewMode, resolution: previewResolution },
    isPlaying && usesRendererPreview,
  ).resolution;
  const creationPreviewFallback = useMemo(
    () => resolveCreationStagePreviewFallback(creation, composition),
    [creation, composition],
  );
  const [rendererHasVisibleFrame, setRendererHasVisibleFrame] = useState(false);
  useEffect(() => {
    setRendererHasVisibleFrame(false);
  }, [
    composition.id,
    creationPreviewFallback?.scene.id,
    creationPreviewFallback?.scene.modifiedAt,
  ]);
  const showCreationCpuPreview =
    usesRendererPreview && creationPreviewFallback && !rendererHasVisibleFrame;
  const layerRenderMode: StageLayerRenderMode = usesRendererPreview
    ? "hit-test"
    : "visual";
  const previewComposition =
    previewCameraView === "default" && composition.camera?.enabled
      ? { ...composition, camera: { ...composition.camera, enabled: false } }
      : composition;

  const selectedStageLayers = selectedLayerIds.flatMap((layerId) => {
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (
      !layer ||
      !layer.visible ||
      !isMotionLayerTreeVisible(composition, layer, soloLayerIds) ||
      playhead < layer.startTime ||
      playhead > layer.startTime + layer.duration
    ) {
      return [];
    }
    const localTime = playhead - layer.startTime;
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        localTime,
        layer.expressions,
        layer.duration,
      ),
      playhead,
    );
    return [
      {
        layer,
        bounds: getMotionLayerLayoutBounds({ ...layer, transform }),
        transform,
        localTime,
      },
    ];
  });
  const editableSelectedStageLayers = selectedStageLayers.filter(
    ({ layer }) => !layer.locked,
  );
  const selectionBounds =
    editableSelectedStageLayers.length > 1
      ? getMotionLayerSelectionBounds(
          editableSelectedStageLayers.map(({ layer, transform }) => ({
            ...layer,
            transform,
          })),
          editableSelectedStageLayers.map(({ layer }) => layer.id),
        )
      : null;
  const selectedMotionPaths = selectedStageLayers.flatMap(({ layer }) => {
    const points = getMotionLayerPositionPath(layer);
    return points.length > 0 ? [{ layer, points }] : [];
  });
  const selectedShapePaths = selectedStageLayers.flatMap(
    ({ layer, transform, localTime }) => {
      if (layer.type !== "shape" || layer.shapeType !== "path") return [];
      if (layer.id === penDraftRef.current?.layerId) return [];
      const points = getEditableMotionShapePathPoints(layer, localTime);
      return points.length > 0 ? [{ layer, transform, localTime, points }] : [];
    },
  );
  const selectedMaskPaths = selectedStageLayers.flatMap(
    ({ layer, transform, localTime }) => {
      if (!supportsMaskPathEditing(layer)) return [];
      return (layer.masks ?? []).flatMap((mask) => {
        if (mask.shape !== "path") return [];
        const points = getMotionMaskPathPoints(mask, layer, localTime);
        return points && points.length >= 3
          ? [{ layer, mask, transform, localTime, points }]
          : [];
      });
    },
  );
  const selectedPuppetPinLayers = selectedStageLayers.flatMap(
    ({ layer, transform, localTime }) => {
      if (layer.type !== "shape") return [];
      const pins = evaluateMotionPuppetPinsAtTime(layer, localTime).puppetPins ?? [];
      return pins.length > 0 ? [{ layer, transform, localTime, pins }] : [];
    },
  );

  const penDraftRubberBand = (() => {
    const draft = penDraftRef.current;
    const lastPoint = penDraftPoints[penDraftPoints.length - 1];
    if (!draft || !lastPoint || !penCursor || activeTool !== "pen") return null;
    const layer = composition.layers.find(
      (candidate): candidate is Extract<MotionLayer, { type: "shape" }> =>
        candidate.id === draft.layerId &&
        candidate.type === "shape" &&
        candidate.shapeType === "path",
    );
    if (!layer) return null;
    const localTime = Math.max(
      0,
      Math.min(layer.duration, playhead - layer.startTime),
    );
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        localTime,
        layer.expressions,
        layer.duration,
      ),
      layer.startTime + localTime,
    );
    return {
      from: getShapePathStagePoint(layer, transform, lastPoint),
      to: penCursor,
    };
  })();

  const getStagePoint = (event: ReactPointerEvent<Element>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (event.clientX - rect.left) / stageScale,
      y: (event.clientY - rect.top) / stageScale,
    };
  };

  const focusStageKeyboardSurface = () => {
    containerRef.current?.focus();
  };

  const applyCompositionCommand = (
    nextComposition: MotionComposition,
    nextSelection?: readonly string[],
  ) => {
    if (nextComposition !== composition) {
      void upsertMotionComposition(nextComposition);
    }
    if (nextSelection) {
      setSelectedLayers(nextSelection);
    }
  };

  const handleStageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableKeyboardTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const usesCommandKey = event.metaKey || event.ctrlKey;

    if (usesCommandKey && !event.altKey && !event.shiftKey && key === "t") {
      event.preventDefault();
      setActiveTool("text");
      setRightTab("properties");
      return;
    }

    if (!usesCommandKey && !event.altKey && !event.shiftKey) {
      const nextTool = MOTION_TOOL_SHORTCUTS[key];
      if (nextTool) {
        event.preventDefault();
        setActiveTool(nextTool);
        return;
      }

      const revealProperties = resolveRevealProperties(key, selectedLayerIds, composition);
      if (revealProperties) {
        event.preventDefault();
        if (revealProperties.layerId) {
          togglePropertyReveal(revealProperties.layerId, revealProperties.properties);
        }
        return;
      }
    }

    if (usesCommandKey && key === "a") {
      event.preventDefault();
      setSelectedLayers(composition.layers.map((layer) => layer.id));
      return;
    }

    if (penDraftRef.current) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPenDraft();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        finalizePenDraft();
        return;
      }
      if (
        !event.shiftKey &&
        (event.key === "Backspace" || event.key === "Delete")
      ) {
        event.preventDefault();
        cancelPenDraft();
        return;
      }
    }

    if (
      !event.shiftKey &&
      selectedShapeVertex &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      const vertexLayer = composition.layers.find(
        (candidate): candidate is Extract<MotionLayer, { type: "shape" }> =>
          candidate.id === selectedShapeVertex.layerId &&
          candidate.type === "shape" &&
          candidate.shapeType === "path",
      );
      if (vertexLayer) {
        event.preventDefault();
        const localTime = Math.max(
          0,
          Math.min(vertexLayer.duration, playhead - vertexLayer.startTime),
        );
        removeShapePathPointAt(
          vertexLayer,
          selectedShapeVertex.pointIndex,
          localTime,
        );
        flushPendingComposition();
        setSelectedShapeVertex(null);
        return;
      }
    }

    if (
      !event.shiftKey &&
      selectedMaskVertex &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      const maskVertexLayer = composition.layers.find(
        (candidate) => candidate.id === selectedMaskVertex.layerId,
      );
      const maskVertexMask = (maskVertexLayer?.masks ?? []).find(
        (candidate) => candidate.id === selectedMaskVertex.maskId,
      );
      if (maskVertexLayer && maskVertexMask) {
        event.preventDefault();
        const localTime = Math.max(
          0,
          Math.min(
            maskVertexLayer.duration,
            playhead - maskVertexLayer.startTime,
          ),
        );
        const points = getMotionMaskPathPoints(
          maskVertexMask,
          maskVertexLayer,
          localTime,
        );
        if (points && points.length > 3) {
          const index = Math.min(
            points.length - 1,
            Math.max(0, selectedMaskVertex.pointIndex),
          );
          writeMaskPathPoints(
            maskVertexLayer.id,
            maskVertexMask.id,
            points.filter((_, candidateIndex) => candidateIndex !== index),
            localTime,
          );
          flushPendingComposition();
        }
        setSelectedMaskVertex(null);
        return;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedShapeVertex(null);
      setSelectedMaskVertex(null);
      selectLayer(null);
      return;
    }

    if (selectedLayerIds.length === 0) return;

    if (
      !event.shiftKey &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      applyCompositionCommand(removeMotionLayers(composition, selectedLayerIds), []);
      return;
    }

    if (usesCommandKey && !event.shiftKey && key === "d") {
      event.preventDefault();
      const result = duplicateMotionLayers(composition, selectedLayerIds);
      applyCompositionCommand(result.composition, result.duplicatedLayerIds);
      return;
    }

    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const amount = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const delta = getKeyboardNudgeDelta(event.key, amount);
      applyCompositionCommand(
        nudgeMotionLayers(composition, selectedLayerIds, delta, {
          time: playhead,
        }),
      );
      return;
    }

    if (!usesCommandKey && !event.altKey && key === "l") {
      event.preventDefault();
      const selectedLayers = composition.layers.filter((layer) =>
        selectedLayerIds.includes(layer.id),
      );
      const shouldLock = selectedLayers.some((layer) => !layer.locked);
      applyCompositionCommand(
        setMotionLayersLocked(composition, selectedLayerIds, shouldLock),
      );
    }
  };

  const resolveLayerForTransform = (layer: MotionLayer) => {
    const localTime = Math.min(
      layer.duration,
      Math.max(0, playhead - layer.startTime),
    );
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        localTime,
        layer.expressions,
        layer.duration,
      ),
      playhead,
    );
    return {
      localTime,
      transform,
      bounds: getMotionLayerLayoutBounds({ ...layer, transform }),
    };
  };

  const beginAnchorDrag = (
    layer: MotionLayer,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    focusStageKeyboardSurface();
    const { localTime, bounds } = resolveLayerForTransform(layer);
    const width = bounds.width > 0 ? bounds.width : 1;
    const height = bounds.height > 0 ? bounds.height : 1;
    anchorDragRef.current = {
      layerId: layer.id,
      pointerId: event.pointerId,
      localTime,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startAnchorX: layer.transform.anchor.x,
      startAnchorY: layer.transform.anchor.y,
      startPosX: getMotionLayerPropertyValueAtTime(
        layer,
        "transform.position.x",
        localTime,
        composition,
      ),
      startPosY: getMotionLayerPropertyValueAtTime(
        layer,
        "transform.position.y",
        localTime,
        composition,
      ),
      width,
      height,
      writesPositionKeyframes:
        autoKeyframe ||
        layer.keyframes.some(
          (keyframe) =>
            keyframe.property === "transform.position.x" ||
            keyframe.property === "transform.position.y",
        ),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveAnchorDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = anchorDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const worldDelta = getMotionCameraWorldDelta(
      previewComposition,
      {
        x: (event.clientX - drag.startClientX) / stageScale,
        y: (event.clientY - drag.startClientY) / stageScale,
      },
      playhead,
    );
    const nextAnchorX = drag.startAnchorX + worldDelta.x / drag.width;
    const nextAnchorY = drag.startAnchorY + worldDelta.y / drag.height;
    const nextPosX = drag.startPosX + worldDelta.x;
    const nextPosY = drag.startPosY + worldDelta.y;
    const nextLayers = composition.layers.map((candidate) => {
      if (candidate.id !== drag.layerId) return candidate;
      const anchored = {
        ...candidate,
        transform: {
          ...candidate.transform,
          anchor: { x: nextAnchorX, y: nextAnchorY },
        },
      } as MotionLayer;
      if (drag.writesPositionKeyframes) {
        return upsertMotionLayerKeyframe(
          upsertMotionLayerKeyframe(anchored, "transform.position.x", drag.localTime, {
            value: nextPosX,
            easing: "ease",
          }),
          "transform.position.y",
          drag.localTime,
          { value: nextPosY, easing: "ease" },
        );
      }
      return {
        ...anchored,
        transform: {
          ...anchored.transform,
          position: { x: nextPosX, y: nextPosY },
        },
      } as MotionLayer;
    });
    scheduleComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const endAnchorDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (anchorDragRef.current?.pointerId === event.pointerId) {
      anchorDragRef.current = null;
    }
  };

  const beginLayerDrag = (
    layer: MotionLayer,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (activeTool === "hand") {
      beginStagePan(event);
      return;
    }
    if (activeTool === "zoom") {
      zoomAtTool(event);
      return;
    }
    if (layer.locked) return;
    if (activeTool === "rotate") {
      const { bounds } = resolveLayerForTransform(layer);
      beginRotateHandleDrag(layer, bounds, event);
      return;
    }
    if (activeTool === "anchor") {
      beginAnchorDrag(layer, event);
      return;
    }
    focusStageKeyboardSurface();
    setSnapGuides([]);
    const draggedLayers = selectedLayerIds.includes(layer.id)
      ? editableSelectedStageLayers.map(({ layer: selected }) => selected)
      : [layer];
    dragRef.current = {
      layerId: layer.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      layers: draggedLayers.map((selected) => {
        const localTime = Math.min(
          selected.duration,
          Math.max(0, playhead - selected.startTime),
        );
        return {
          layerId: selected.id,
          startX: getMotionLayerPropertyValueAtTime(
            selected,
            "transform.position.x",
            localTime,
            composition,
          ),
          startY: getMotionLayerPropertyValueAtTime(
            selected,
            "transform.position.y",
            localTime,
            composition,
          ),
          localTime,
          writesPositionKeyframes:
            autoKeyframe ||
            selected.keyframes.some(
              (keyframe) =>
                keyframe.property === "transform.position.x" ||
                keyframe.property === "transform.position.y",
            ),
        };
      }),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveLayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (rotateDragRef.current) {
      moveRotateHandleDrag(event);
      return;
    }
    if (anchorDragRef.current) {
      moveAnchorDrag(event);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const layer = composition.layers.find((candidate) => candidate.id === drag.layerId);
    if (!layer) return;

    const worldDelta = getMotionCameraWorldDelta(
      previewComposition,
      {
        x: (event.clientX - drag.startClientX) / stageScale,
        y: (event.clientY - drag.startClientY) / stageScale,
      },
      playhead,
    );
    const primary = drag.layers.find((entry) => entry.layerId === drag.layerId);
    if (!primary) return;
    let deltaX = worldDelta.x;
    let deltaY = worldDelta.y;

    if (snapEnabled && !event.altKey) {
      const snapped = snapMotionLayerPosition(
        composition,
        layer.id,
        { x: primary.startX + deltaX, y: primary.startY + deltaY },
        {
          threshold: Math.max(4, 10 / stageScale),
          gridSize,
          snapToGrid: showStageGrid,
          ignoredLayerIds: drag.layers
            .filter((entry) => entry.layerId !== layer.id)
            .map((entry) => entry.layerId),
        },
      );
      deltaX = snapped.position.x - primary.startX;
      deltaY = snapped.position.y - primary.startY;
      setSnapGuides(snapped.guides);
    } else {
      setSnapGuides([]);
    }

    const entries = new Map(drag.layers.map((entry) => [entry.layerId, entry]));
    const nextLayers = composition.layers.map((candidate) => {
      const entry = entries.get(candidate.id);
      if (!entry) return candidate;
      const nextX = entry.startX + deltaX;
      const nextY = entry.startY + deltaY;
      if (entry.writesPositionKeyframes) {
        return upsertMotionLayerKeyframe(
          upsertMotionLayerKeyframe(candidate, "transform.position.x", entry.localTime, {
            value: nextX,
            easing: "ease",
          }),
          "transform.position.y",
          entry.localTime,
          { value: nextY, easing: "ease" },
        );
      }
      return {
        ...candidate,
        transform: {
          ...candidate.transform,
          position: { x: nextX, y: nextY },
        },
      };
    });

    scheduleComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const endLayerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (rotateDragRef.current) {
      endRotateHandleDrag(event);
      return;
    }
    if (anchorDragRef.current) {
      endAnchorDrag(event);
      return;
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setSnapGuides([]);
    }
  };

  const beginGuideDrag = (
    guide: MotionGuide,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (guide.locked) return;
    event.stopPropagation();
    focusStageKeyboardSurface();
    selectLayer(null);
    guideDragRef.current = {
      guideId: guide.id,
      orientation: guide.orientation,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: guide.position,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginRulerGuideDrag = (
    orientation: MotionGuide["orientation"],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    focusStageKeyboardSurface();
    selectLayer(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const position =
      orientation === "vertical"
        ? (event.clientX - rect.left) / stageScale
        : (event.clientY - rect.top) / stageScale;
    const guide = createMotionGuide(orientation, position);
    guideDragRef.current = {
      guideId: guide.id,
      orientation,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: guide.position,
      createdGuide: guide,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    void upsertMotionComposition(addMotionCompositionGuide(composition, guide));
  };

  const moveGuideDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = guideDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta =
      drag.orientation === "vertical"
        ? (event.clientX - drag.startClientX) / stageScale
        : (event.clientY - drag.startClientY) / stageScale;
    const baseComposition =
      drag.createdGuide &&
      !(composition.guides ?? []).some((guide) => guide.id === drag.guideId)
        ? addMotionCompositionGuide(composition, drag.createdGuide)
        : composition;
    const nextComposition = moveMotionCompositionGuide(
      baseComposition,
      drag.guideId,
      drag.startPosition + delta,
      {
        snapGridSize:
          snapEnabled && showStageGrid && !event.altKey ? gridSize : undefined,
      },
    );
    if (nextComposition !== composition) {
      scheduleComposition(nextComposition);
    }
  };

  const endGuideDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (guideDragRef.current?.pointerId === event.pointerId) {
      guideDragRef.current = null;
    }
  };

  const beginResizeHandleDrag = (
    layer: MotionLayer,
    handle: MotionLayerResizeHandle,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    event.stopPropagation();
    focusStageKeyboardSurface();
    const localTime = Math.min(
      layer.duration,
      Math.max(0, playhead - layer.startTime),
    );
    const transform = getMotionTransformAtTime(
      layer.transform,
      layer.keyframes,
      localTime,
      layer.expressions,
      layer.duration,
    );
    resizeDragRef.current = {
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      layers: [
        {
          layerId: layer.id,
          localTime,
          originalLayer: { ...layer, transform },
          writesTransformKeyframes:
            autoKeyframe ||
            layer.keyframes.some(
              (keyframe) =>
                keyframe.property === "transform.position.x" ||
                keyframe.property === "transform.position.y" ||
                keyframe.property === "transform.scale.x" ||
                keyframe.property === "transform.scale.y",
            ),
        },
      ],
    };
    setSnapGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginSelectionResizeHandleDrag = (
    handle: MotionLayerResizeHandle,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (!selectionBounds) return;
    event.stopPropagation();
    focusStageKeyboardSurface();
    resizeDragRef.current = {
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      layers: editableSelectedStageLayers.map(({ layer, localTime }) => {
        const transform = getMotionTransformAtTime(
          layer.transform,
          layer.keyframes,
          localTime,
          layer.expressions,
          layer.duration,
        );
        return {
          layerId: layer.id,
          localTime,
          originalLayer: { ...layer, transform },
          writesTransformKeyframes:
            autoKeyframe ||
            layer.keyframes.some(
              (keyframe) =>
                keyframe.property === "transform.position.x" ||
                keyframe.property === "transform.position.y" ||
                keyframe.property === "transform.scale.x" ||
                keyframe.property === "transform.scale.y",
            ),
        };
      }),
    };
    setSnapGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveResizeHandleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = {
        x: (event.clientX - drag.startClientX) / stageScale,
        y: (event.clientY - drag.startClientY) / stageScale,
      };
    const resizeOptions = {
        preserveAspect: event.shiftKey,
        resizeFromCenter: event.altKey,
      };
    const originalLayers = drag.layers.map((entry) => entry.originalLayer);
    const resizedLayers = drag.layers.length === 1
      ? [resizeMotionLayerByHandle(originalLayers[0]!, drag.handle, delta, resizeOptions)]
      : resizeMotionLayerSelectionByHandle(
          originalLayers,
          drag.handle,
          delta,
          resizeOptions,
        );
    const resizedById = new Map(resizedLayers.map((layer) => [layer.id, layer]));
    const entries = new Map(drag.layers.map((entry) => [entry.layerId, entry]));

    const nextLayers = composition.layers.map((layer) => {
      const entry = entries.get(layer.id);
      const resizedLayer = resizedById.get(layer.id);
      if (!entry || !resizedLayer) return layer;
      if (entry.writesTransformKeyframes) {
        return upsertMotionLayerKeyframe(
          upsertMotionLayerKeyframe(
            upsertMotionLayerKeyframe(
              upsertMotionLayerKeyframe(
                layer,
                "transform.position.x",
                entry.localTime,
                { value: resizedLayer.transform.position.x, easing: "ease" },
              ),
              "transform.position.y",
              entry.localTime,
              { value: resizedLayer.transform.position.y, easing: "ease" },
            ),
            "transform.scale.x",
            entry.localTime,
            { value: resizedLayer.transform.scale.x, easing: "ease" },
          ),
          "transform.scale.y",
          entry.localTime,
          { value: resizedLayer.transform.scale.y, easing: "ease" },
        );
      }
      return {
        ...layer,
        transform: {
          ...layer.transform,
          position: resizedLayer.transform.position,
          scale: resizedLayer.transform.scale,
        },
      };
    });

    scheduleComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const endResizeHandleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (resizeDragRef.current?.pointerId === event.pointerId) {
      resizeDragRef.current = null;
    }
  };

  const beginRotateHandleDrag = (
    layer: MotionLayer,
    bounds: MotionLayerLayoutBounds,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (layer.locked) return;
    event.stopPropagation();
    focusStageKeyboardSurface();
    const localTime = Math.min(
      layer.duration,
      Math.max(0, playhead - layer.startTime),
    );
    const transform = getMotionTransformAtTime(
      layer.transform,
      layer.keyframes,
      localTime,
      layer.expressions,
      layer.duration,
    );
    rotateDragRef.current = {
      pointerId: event.pointerId,
      center: { x: bounds.centerX, y: bounds.centerY },
      startPointer: getStagePoint(event),
      layers: [
        {
          layerId: layer.id,
          localTime,
          originalLayer: { ...layer, transform },
          writesTransformKeyframes:
            autoKeyframe ||
            layer.keyframes.some(
              (keyframe) => keyframe.property === "transform.rotation",
            ),
        },
      ],
    };
    setSnapGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginSelectionRotateHandleDrag = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (!selectionBounds) return;
    event.stopPropagation();
    focusStageKeyboardSurface();
    rotateDragRef.current = {
      pointerId: event.pointerId,
      center: { x: selectionBounds.centerX, y: selectionBounds.centerY },
      startPointer: getStagePoint(event),
      layers: editableSelectedStageLayers.map(({ layer, localTime }) => ({
        layerId: layer.id,
        localTime,
        originalLayer: {
          ...layer,
          transform: getMotionTransformAtTime(
            layer.transform,
            layer.keyframes,
            localTime,
            layer.expressions,
            layer.duration,
          ),
        },
        writesTransformKeyframes:
          autoKeyframe ||
          layer.keyframes.some(
            (keyframe) =>
              keyframe.property === "transform.position.x" ||
              keyframe.property === "transform.position.y" ||
              keyframe.property === "transform.rotation",
          ),
      })),
    };
    setSnapGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveRotateHandleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = rotateDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const originalLayers = drag.layers.map((entry) => entry.originalLayer);
    const rotateOptions = { snapDegrees: event.shiftKey ? 15 : undefined };
    const rotatedLayers = drag.layers.length === 1
      ? [
          rotateMotionLayerByPointer(
            originalLayers[0]!,
            drag.center,
            drag.startPointer,
            getStagePoint(event),
            rotateOptions,
          ),
        ]
      : rotateMotionLayerSelectionByPointer(
          originalLayers,
          drag.center,
          drag.startPointer,
          getStagePoint(event),
          rotateOptions,
        );
    const rotatedById = new Map(rotatedLayers.map((layer) => [layer.id, layer]));
    const entries = new Map(drag.layers.map((entry) => [entry.layerId, entry]));

    const nextLayers = composition.layers.map((layer) => {
      const entry = entries.get(layer.id);
      const rotatedLayer = rotatedById.get(layer.id);
      if (!entry || !rotatedLayer) return layer;
      if (entry.writesTransformKeyframes) {
        if (drag.layers.length === 1) {
          return upsertMotionLayerKeyframe(
            layer,
            "transform.rotation",
            entry.localTime,
            { value: rotatedLayer.transform.rotation, easing: "ease" },
          );
        }
        return upsertMotionLayerKeyframe(
          upsertMotionLayerKeyframe(
            upsertMotionLayerKeyframe(
              layer,
              "transform.position.x",
              entry.localTime,
              { value: rotatedLayer.transform.position.x, easing: "ease" },
            ),
            "transform.position.y",
            entry.localTime,
            { value: rotatedLayer.transform.position.y, easing: "ease" },
          ),
          "transform.rotation",
          entry.localTime,
          { value: rotatedLayer.transform.rotation, easing: "ease" },
        );
      }
      return {
        ...layer,
        transform: {
          ...layer.transform,
          position: rotatedLayer.transform.position,
          rotation: rotatedLayer.transform.rotation,
        },
      };
    });

    scheduleComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const endRotateHandleDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (rotateDragRef.current?.pointerId === event.pointerId) {
      rotateDragRef.current = null;
    }
  };

  const beginPositionPathPointDrag = (
    layer: MotionLayer,
    point: MotionPositionPathPoint,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    focusStageKeyboardSurface();
    setPlayhead(layer.startTime + point.time);
    positionPathDragRef.current = {
      layerId: layer.id,
      pointerId: event.pointerId,
      time: point.time,
      easing: point.easing,
    };
    setSnapGuides([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePositionPathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = positionPathDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = composition.layers.find((candidate) => candidate.id === drag.layerId);
    if (!layer) return;
    let nextPosition = getStagePoint(event);

    if (snapEnabled && !event.altKey) {
      const snapped = snapMotionLayerPosition(
        composition,
        layer.id,
        nextPosition,
        {
          threshold: Math.max(4, 10 / stageScale),
          gridSize,
          snapToGrid: showStageGrid,
        },
      );
      nextPosition = snapped.position;
      setSnapGuides(snapped.guides);
    } else {
      setSnapGuides([]);
    }

    const nextLayers = composition.layers.map((candidate) =>
      candidate.id === drag.layerId
        ? setMotionLayerPositionPathPoint(
            candidate,
            drag.time,
            nextPosition,
            drag.easing,
          )
        : candidate,
    );

    scheduleComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const endPositionPathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (positionPathDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      positionPathDragRef.current = null;
      setSnapGuides([]);
    }
  };

  const beginShapePathPointDrag = (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
    event: ReactPointerEvent<SVGElement>,
    handle: "in" | "out" | null = null,
  ) => {
    if (layer.type !== "shape" || layer.locked || layer.shapeType !== "path") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focusStageKeyboardSurface();
    if (handle === null) {
      setSelectedShapeVertex({ layerId: layer.id, pointIndex });
    }
    shapePathDragRef.current = {
      layerId: layer.id,
      pointIndex,
      pointerId: event.pointerId,
      localTime,
      writesPathKeyframes:
        autoKeyframe || getMotionShapePathKeyframes(layer).length > 0,
      handle,
      createSymmetricHandle: handle === null && event.altKey,
      symmetricHandle: handle !== null && !event.altKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveShapePathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = shapePathDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = composition.layers.find(
      (candidate): candidate is Extract<MotionLayer, { type: "shape" }> =>
        candidate.id === drag.layerId && candidate.type === "shape",
    );
    if (!layer || layer.shapeType !== "path") return;
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        drag.localTime,
        layer.expressions,
        layer.duration,
      ),
      layer.startTime + drag.localTime,
    );
    const nextPoint = getShapePathPointFromStagePoint(
      layer,
      transform,
      getStagePoint(event),
    );
    if (drag.createSymmetricHandle) {
      const anchor = getEditableMotionShapePathPoints(layer, drag.localTime)[
        drag.pointIndex
      ];
      if (anchor) {
        const mirror = {
          x: 2 * anchor.x - nextPoint.x,
          y: 2 * anchor.y - nextPoint.y,
        };
        const options = {
          keyframe: drag.writesPathKeyframes,
          localTime: drag.localTime,
          easing: "ease" as const,
        };
        replaceShapePathLayer(
          layer.id,
          setMotionShapePathPointHandle(
            setMotionShapePathPointHandle(
              layer,
              drag.pointIndex,
              "out",
              nextPoint,
              options,
            ),
            drag.pointIndex,
            "in",
            mirror,
            options,
          ),
        );
      }
      return;
    }
    if (drag.handle) {
      const options = {
        keyframe: drag.writesPathKeyframes,
        localTime: drag.localTime,
        easing: "ease" as const,
      };
      const moved = setMotionShapePathPointHandle(
        layer,
        drag.pointIndex,
        drag.handle,
        nextPoint,
        options,
      );
      if (drag.symmetricHandle) {
        const anchor = getEditableMotionShapePathPoints(layer, drag.localTime)[
          drag.pointIndex
        ];
        if (anchor) {
          const mirror = {
            x: 2 * anchor.x - nextPoint.x,
            y: 2 * anchor.y - nextPoint.y,
          };
          replaceShapePathLayer(
            layer.id,
            setMotionShapePathPointHandle(
              moved,
              drag.pointIndex,
              drag.handle === "out" ? "in" : "out",
              mirror,
              options,
            ),
          );
          return;
        }
      }
      replaceShapePathLayer(layer.id, moved);
      return;
    }
    replaceShapePathLayer(
      layer.id,
      setMotionShapePathPoint(layer, drag.pointIndex, nextPoint, {
        keyframe: drag.writesPathKeyframes,
        localTime: drag.localTime,
        easing: "ease",
      }),
    );
  };

  const endShapePathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (shapePathDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      shapePathDragRef.current = null;
    }
  };

  const insertShapePathPointAt = (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
  ) => {
    if (layer.type !== "shape" || layer.locked || layer.shapeType !== "path") {
      return;
    }
    replaceShapePathLayer(
      layer.id,
      insertMotionShapePathPoint(layer, pointIndex, undefined, {
        keyframe: autoKeyframe || getMotionShapePathKeyframes(layer).length > 0,
        localTime,
        easing: "ease",
      }),
    );
    flushPendingComposition();
  };

  const removeShapePathPointAt = (
    layer: Extract<MotionLayer, { type: "shape" }>,
    pointIndex: number,
    localTime: number,
  ) => {
    if (layer.locked || layer.shapeType !== "path") return;
    replaceShapePathLayer(
      layer.id,
      removeMotionShapePathPoint(layer, pointIndex, {
        keyframe: autoKeyframe || getMotionShapePathKeyframes(layer).length > 0,
        localTime,
        easing: "ease",
      }),
    );
  };

  const toggleShapePathPointSmoothAt = (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
  ) => {
    if (layer.type !== "shape" || layer.locked || layer.shapeType !== "path") {
      return;
    }
    const points = getEditableMotionShapePathPoints(layer, localTime);
    if (pointIndex < 0 || pointIndex >= points.length) return;
    const nextPoints = toggleVertexSmooth(points, pointIndex, layer.pathClosed ?? true);
    replaceShapePathLayer(
      layer.id,
      setMotionShapePathPoints(layer, nextPoints, {
        keyframe: autoKeyframe || getMotionShapePathKeyframes(layer).length > 0,
        localTime,
        easing: "ease",
      }),
    );
    flushPendingComposition();
  };

  const writeMaskPathPoints = (
    layerId: string,
    maskId: string,
    points: readonly MotionShapePathPoint[],
    localTime: number,
  ) => {
    const base = pendingCompositionRef.current ?? composition;
    const targetLayer = base.layers.find(
      (candidate) => candidate.id === layerId,
    );
    if (!targetLayer) return;
    const mask = (targetLayer.masks ?? []).find(
      (candidate) => candidate.id === maskId,
    );
    if (!mask) return;
    const pathData = buildMotionPathData(points);
    const writesKeyframe = (mask.pathKeyframes?.length ?? 0) > 0;
    const withPoints = updateMotionLayerMask(targetLayer, maskId, (current) => ({
      ...current,
      pathPoints: points.map((point) => ({ ...point })),
    }));
    const nextLayer = writesKeyframe
      ? upsertMotionMaskPathKeyframe(withPoints, maskId, localTime, pathData)
      : withPoints;
    scheduleComposition({
      ...base,
      layers: base.layers.map((candidate) =>
        candidate.id === layerId ? nextLayer : candidate,
      ),
      modifiedAt: Date.now(),
    });
  };

  const beginMaskPathPointDrag = (
    layer: MotionLayer,
    mask: MotionMask,
    pointIndex: number,
    localTime: number,
    event: ReactPointerEvent<SVGElement>,
    handle: "in" | "out" | null = null,
  ) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    focusStageKeyboardSurface();
    if (handle === null) {
      setSelectedMaskVertex({
        layerId: layer.id,
        maskId: mask.id,
        pointIndex,
      });
    }
    maskPathDragRef.current = {
      layerId: layer.id,
      maskId: mask.id,
      pointIndex,
      pointerId: event.pointerId,
      localTime,
      handle,
      symmetric: handle !== null && !event.altKey,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMaskPathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = maskPathDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const base = pendingCompositionRef.current ?? composition;
    const layer = base.layers.find(
      (candidate) => candidate.id === drag.layerId,
    );
    if (!layer) return;
    const mask = (layer.masks ?? []).find(
      (candidate) => candidate.id === drag.maskId,
    );
    if (!mask) return;
    const currentPoints = getMotionMaskPathPoints(mask, layer, drag.localTime);
    if (!currentPoints || currentPoints.length < 3) return;
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        drag.localTime,
        layer.expressions,
        layer.duration,
      ),
      layer.startTime + drag.localTime,
    );
    const nextLocal = getShapePathPointFromStagePoint(
      layer,
      transform,
      getStagePoint(event),
    );
    const anchor = currentPoints[drag.pointIndex];
    if (!anchor) return;
    const nextPoints = drag.handle
      ? moveHandle(
          currentPoints,
          drag.pointIndex,
          drag.handle,
          nextLocal,
          drag.symmetric,
        )
      : moveVertex(currentPoints, drag.pointIndex, {
          x: nextLocal.x - anchor.x,
          y: nextLocal.y - anchor.y,
        });
    writeMaskPathPoints(drag.layerId, drag.maskId, nextPoints, drag.localTime);
  };

  const endMaskPathPointDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (maskPathDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      maskPathDragRef.current = null;
    }
  };

  const insertMaskPathPointAt = (
    layer: MotionLayer,
    mask: MotionMask,
    pointIndex: number,
    localTime: number,
  ) => {
    if (layer.locked) return;
    const points = getMotionMaskPathPoints(mask, layer, localTime);
    if (!points || points.length < 3) return;
    const index = Math.min(points.length - 1, Math.max(0, pointIndex));
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) return;
    const inserted: MotionShapePathPoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    const nextPoints = [
      ...points.slice(0, index + 1),
      inserted,
      ...points.slice(index + 1),
    ];
    writeMaskPathPoints(layer.id, mask.id, nextPoints, localTime);
    flushPendingComposition();
  };

  const toggleMaskPathPointSmoothAt = (
    layer: MotionLayer,
    mask: MotionMask,
    pointIndex: number,
    localTime: number,
  ) => {
    if (layer.locked) return;
    const points = getMotionMaskPathPoints(mask, layer, localTime);
    if (!points || pointIndex < 0 || pointIndex >= points.length) return;
    writeMaskPathPoints(
      layer.id,
      mask.id,
      toggleVertexSmooth(points, pointIndex, true),
      localTime,
    );
    flushPendingComposition();
  };

  const beginPuppetPinDrag = (
    layer: Extract<MotionLayer, { type: "shape" }>,
    pin: MotionPuppetPin,
    localTime: number,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    focusStageKeyboardSurface();
    puppetPinDragRef.current = {
      layerId: layer.id,
      pinId: pin.id,
      pointerId: event.pointerId,
      localTime,
      writesPuppetKeyframes: shouldWritePuppetPinPositionKeyframes(
        layer,
        pin.id,
        autoKeyframe,
      ),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePuppetPinDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = puppetPinDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = composition.layers.find(
      (candidate): candidate is Extract<MotionLayer, { type: "shape" }> =>
        candidate.id === drag.layerId && candidate.type === "shape",
    );
    if (!layer || layer.locked) return;
    const transform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        drag.localTime,
        layer.expressions,
        layer.duration,
      ),
      layer.startTime + drag.localTime,
    );
    const nextPosition = getShapePathPointFromStagePoint(
      layer,
      transform,
      getStagePoint(event),
    );
    const nextLayer = drag.writesPuppetKeyframes
      ? upsertPuppetPinPositionKeyframes(
          layer,
          drag.pinId,
          nextPosition,
          drag.localTime,
        )
      : updateMotionPuppetPin(layer, drag.pinId, (pin) => ({
          ...pin,
          position: nextPosition,
        }));
    replaceShapePathLayer(layer.id, nextLayer);
  };

  const endPuppetPinDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (puppetPinDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      puppetPinDragRef.current = null;
    }
  };

  const replaceShapePathLayer = (
    layerId: string,
    nextLayer: Extract<MotionLayer, { type: "shape" }>,
  ) => {
    scheduleComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === layerId ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const beginStagePan = (event: ReactPointerEvent<HTMLElement>) => {
    const pointerId = event.pointerId;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startPanX = stagePanX;
    const startPanY = stagePanY;
    panDragRef.current = {
      pointerId,
      startClientX,
      startClientY,
      startPanX,
      startPanY,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      setStagePan(
        startPanX + (moveEvent.clientX - startClientX),
        startPanY + (moveEvent.clientY - startClientY),
      );
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      panDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const zoomAtTool = (event: { altKey: boolean }) => {
    setZoom(zoom * (event.altKey ? 1 / 1.25 : 1.25));
  };

  const createLayerAtClient = (
    type: CreatableMotionLayerType,
    clientX: number,
    clientY: number,
  ) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const point = rect
      ? {
          x: (clientX - rect.left) / stageScale,
          y: (clientY - rect.top) / stageScale,
        }
      : { x: composition.width / 2, y: composition.height / 2 };
    const position = {
      x: Math.max(0, Math.min(composition.width, point.x)),
      y: Math.max(0, Math.min(composition.height, point.y)),
    };
    const base = pendingCompositionRef.current ?? composition;
    const layer = createMotionLayerOfType(base, type, { position });
    pendingCompositionRef.current = null;
    if (commitRafRef.current !== null) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = null;
    }
    void upsertMotionComposition({
      ...base,
      layers: [...base.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    if (type === "text") setRightTab("properties");
    setActiveTool("select");
  };

  const getPenDraftLayer = (
    base: MotionComposition,
  ): Extract<MotionLayer, { type: "shape" }> | null => {
    const draft = penDraftRef.current;
    if (!draft) return null;
    const layer = base.layers.find(
      (candidate): candidate is Extract<MotionLayer, { type: "shape" }> =>
        candidate.id === draft.layerId &&
        candidate.type === "shape" &&
        candidate.shapeType === "path",
    );
    return layer ?? null;
  };

  const getPenDraftTransform = (
    layer: Extract<MotionLayer, { type: "shape" }>,
    localTime: number,
  ): MotionTransform =>
    applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        layer.transform,
        layer.keyframes,
        localTime,
        layer.expressions,
        layer.duration,
      ),
      layer.startTime + localTime,
    );

  const resetPenDraftState = () => {
    penDraftRef.current = null;
    penDraftPointsRef.current = [];
    penDragRef.current = null;
    setPenDraftPoints([]);
    setPenCursor(null);
  };

  const removePenDraftLayer = () => {
    const draft = penDraftRef.current;
    if (!draft) return;
    const base = pendingCompositionRef.current ?? composition;
    const removed = removeMotionLayers(base, [draft.layerId]);
    scheduleComposition(removed);
  };

  const commitPenDraftAsMask = (): boolean => {
    const draft = penDraftRef.current;
    if (!draft || !draft.maskTargetLayerId) return false;
    const base = pendingCompositionRef.current ?? composition;
    const draftLayer = getPenDraftLayer(base);
    const targetLayer = base.layers.find(
      (candidate) =>
        candidate.id === draft.maskTargetLayerId &&
        supportsMaskPathEditing(candidate),
    );
    if (!draftLayer || !targetLayer) return false;
    const draftPoints = penDraftPointsRef.current;
    if (draftPoints.length < 3) return false;

    const draftLocalTime = Math.max(
      0,
      Math.min(draftLayer.duration, playhead - draftLayer.startTime),
    );
    const draftTransform = getPenDraftTransform(draftLayer, draftLocalTime);
    const targetLocalTime = Math.max(
      0,
      Math.min(targetLayer.duration, playhead - targetLayer.startTime),
    );
    const targetTransform = applyMotionCameraToTransform(
      previewComposition,
      getMotionTransformAtTime(
        targetLayer.transform,
        targetLayer.keyframes,
        targetLocalTime,
        targetLayer.expressions,
        targetLayer.duration,
      ),
      targetLayer.startTime + targetLocalTime,
    );

    const maskPoints = draftPoints.map((point) => {
      const stagePoint = getShapePathStagePoint(
        draftLayer,
        draftTransform,
        point,
      );
      const localPoint = getShapePathPointFromStagePoint(
        targetLayer,
        targetTransform,
        stagePoint,
      );
      const result: MotionShapePathPoint = {
        x: localPoint.x,
        y: localPoint.y,
      };
      if (point.outX !== undefined && point.outY !== undefined) {
        const outLocal = getShapePathPointFromStagePoint(
          targetLayer,
          targetTransform,
          getShapePathStagePoint(draftLayer, draftTransform, {
            x: point.outX,
            y: point.outY,
          }),
        );
        Object.assign(result, { outX: outLocal.x, outY: outLocal.y });
      }
      if (point.inX !== undefined && point.inY !== undefined) {
        const inLocal = getShapePathPointFromStagePoint(
          targetLayer,
          targetTransform,
          getShapePathStagePoint(draftLayer, draftTransform, {
            x: point.inX,
            y: point.inY,
          }),
        );
        Object.assign(result, { inX: inLocal.x, inY: inLocal.y });
      }
      return result;
    });

    const withoutDraft = removeMotionLayers(base, [draftLayer.id]);
    const nextComposition: MotionComposition = {
      ...withoutDraft,
      layers: withoutDraft.layers.map((candidate) =>
        candidate.id === targetLayer.id
          ? addMotionLayerMask(candidate, buildMotionPathMask(maskPoints))
          : candidate,
      ),
      modifiedAt: Date.now(),
    };
    scheduleComposition(nextComposition);
    selectLayer(targetLayer.id);
    return true;
  };

  const finalizePenDraft = () => {
    const draft = penDraftRef.current;
    if (draft) {
      const committedMask = commitPenDraftAsMask();
      const targetsMask = draft.maskTargetLayerId !== null;
      if (
        !committedMask &&
        (targetsMask || penDraftPointsRef.current.length < 2)
      ) {
        removePenDraftLayer();
      }
      flushPendingComposition();
    }
    setMaskDrawMode(false);
    resetPenDraftState();
    setActiveTool("select");
  };

  const cancelPenDraft = () => {
    if (penDraftRef.current) {
      removePenDraftLayer();
      flushPendingComposition();
    }
    resetPenDraftState();
  };

  useEffect(() => {
    if (activeTool !== "pen" && penDraftRef.current) {
      finalizePenDraft();
    }
    if (
      activeTool !== "rectangle" &&
      activeTool !== "ellipse" &&
      shapeDraftRef.current
    ) {
      shapeDraftRef.current = null;
      setShapeDraftRect(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  useEffect(() => {
    setSelectedShapeVertex((current) =>
      current && current.layerId === selectedLayerId ? current : null,
    );
    setSelectedMaskVertex((current) =>
      current && current.layerId === selectedLayerId ? current : null,
    );
  }, [selectedLayerId]);

  const writePenDraftPoints = (
    layerId: string,
    points: readonly MotionShapePathPoint[],
  ) => {
    const base = pendingCompositionRef.current ?? composition;
    const nextComposition = {
      ...base,
      layers: base.layers.map((candidate) =>
        candidate.id === layerId
          ? { ...candidate, pathData: buildMotionPathData(points) }
          : candidate,
      ),
      modifiedAt: Date.now(),
    };
    scheduleComposition(nextComposition);
    penDraftPointsRef.current = [...points];
    setPenDraftPoints([...points]);
  };

  const closePenDraft = (layerId: string) => {
    const base = pendingCompositionRef.current ?? composition;
    const closedComposition = {
      ...base,
      layers: base.layers.map((candidate) =>
        candidate.id === layerId
          ? { ...candidate, pathClosed: true }
          : candidate,
      ),
      modifiedAt: Date.now(),
    };
    penDraftPointsRef.current = [...penDraftPointsRef.current];
    if (penDraftRef.current?.maskTargetLayerId) {
      const committedMask = commitPenDraftAsMask();
      if (!committedMask) {
        scheduleComposition(closedComposition);
      }
    } else {
      scheduleComposition(closedComposition);
    }
    flushPendingComposition();
    penDragRef.current = null;
    setMaskDrawMode(false);
    resetPenDraftState();
    setActiveTool("select");
  };

  const handlePenPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stagePoint = getStagePoint(event);
    if (!penDraftRef.current) {
      const position = {
        ...DEFAULT_MOTION_TRANSFORM.position,
        x: stagePoint.x,
        y: stagePoint.y,
      };
      const firstPoint: MotionShapePathPoint = { x: 0, y: 0 };
      const layer: Extract<MotionLayer, { type: "shape" }> = {
        id: `motion-layer-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        type: "shape",
        name: "Path Layer",
        startTime: 0,
        duration: composition.duration,
        visible: true,
        locked: false,
        transform: { ...DEFAULT_MOTION_TRANSFORM, position },
        keyframes: [],
        shapeType: "path",
        width: 4,
        height: 4,
        pathData: buildMotionPathData([firstPoint]),
        pathClosed: false,
        style: {
          ...DEFAULT_SHAPE_STYLE,
          fill: { type: "none", opacity: 0 },
          stroke: { color: "#14b8a6", width: 2, opacity: 1 },
        },
      };
      const base = pendingCompositionRef.current ?? composition;
      const nextComposition = {
        ...base,
        layers: [...base.layers, layer],
        modifiedAt: Date.now(),
      };
      const maskTargetLayerId =
        maskDrawMode &&
        selectedLayerId &&
        selectedLayerId !== layer.id &&
        base.layers.some((candidate) => candidate.id === selectedLayerId)
          ? selectedLayerId
          : null;
      scheduleComposition(nextComposition);
      selectLayer(layer.id);
      penDraftRef.current = { layerId: layer.id, maskTargetLayerId };
      penDraftPointsRef.current = [firstPoint];
      setPenDraftPoints([firstPoint]);
      setPenCursor(stagePoint);
      penDragRef.current = {
        pointerId: event.pointerId,
        anchorStage: stagePoint,
        anchorLocal: firstPoint,
        dragging: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const base = pendingCompositionRef.current ?? composition;
    const layer = getPenDraftLayer(base);
    if (!layer) {
      penDragRef.current = null;
      resetPenDraftState();
      return;
    }
    const draftPoints = penDraftPointsRef.current;
    const localTime = Math.max(
      0,
      Math.min(layer.duration, playhead - layer.startTime),
    );
    const transform = getPenDraftTransform(layer, localTime);
    const newPoint = getShapePathPointFromStagePoint(layer, transform, stagePoint);
    const layerScale = Math.max(
      0.0001,
      (Math.abs(transform.scale.x) + Math.abs(transform.scale.y)) / 2,
    );
    const closeTolerance = 8 / Math.max(0.0001, stageScale) / layerScale;
    if (penShouldClose(draftPoints, newPoint, closeTolerance)) {
      closePenDraft(layer.id);
      return;
    }
    const nextPoints = penAddCorner(draftPoints, newPoint);
    writePenDraftPoints(layer.id, nextPoints);
    setPenCursor(stagePoint);
    penDragRef.current = {
      pointerId: event.pointerId,
      anchorStage: stagePoint,
      anchorLocal: newPoint,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePenPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stagePoint = getStagePoint(event);
    setPenCursor(stagePoint);
    const drag = penDragRef.current;
    const draft = penDraftRef.current;
    if (!drag || !draft || drag.pointerId !== event.pointerId) return;
    if (
      !drag.dragging &&
      Math.hypot(
        stagePoint.x - drag.anchorStage.x,
        stagePoint.y - drag.anchorStage.y,
      ) <= 3
    ) {
      return;
    }
    drag.dragging = true;
    const base = pendingCompositionRef.current ?? composition;
    const layer = getPenDraftLayer(base);
    if (!layer) return;
    const localTime = Math.max(
      0,
      Math.min(layer.duration, playhead - layer.startTime),
    );
    const transform = getPenDraftTransform(layer, localTime);
    const currentLocal = getShapePathPointFromStagePoint(
      layer,
      transform,
      stagePoint,
    );
    const nextPoints = penDragHandles(penDraftPointsRef.current, {
      anchor: drag.anchorLocal,
      current: currentLocal,
    });
    writePenDraftPoints(layer.id, nextPoints);
  };

  const handlePenPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = penDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    penDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (shapeDraftRef.current) {
      const current = getStagePoint(event);
      const { start } = shapeDraftRef.current;
      setShapeDraftRect({
        left: Math.min(start.x, current.x),
        top: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
      });
      return;
    }
    if (activeTool !== "pen" || !penDraftRef.current) return;
    handlePenPointerMove(event);
  };

  const handleStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTool === "pen" && penDragRef.current) {
      handlePenPointerUp(event);
      return;
    }
    const draft = shapeDraftRef.current;
    if (!draft) return;
    shapeDraftRef.current = null;
    setShapeDraftRect(null);
    const current = getStagePoint(event);
    const rawW = Math.abs(current.x - draft.start.x);
    const rawH = Math.abs(current.y - draft.start.y);
    const tiny = rawW < 4 && rawH < 4;
    const width = tiny ? 200 : Math.max(4, rawW);
    const height = tiny ? 200 : Math.max(4, rawH);
    const center = tiny
      ? draft.start
      : {
          x: (draft.start.x + current.x) / 2,
          y: (draft.start.y + current.y) / 2,
        };
    const base = pendingCompositionRef.current ?? composition;
    const layer = createMotionLayerOfType(base, "shape", {
      position: center,
      width,
      height,
      shapeType: draft.tool,
    });
    pendingCompositionRef.current = null;
    void upsertMotionComposition({
      ...base,
      layers: [...base.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    setActiveTool("select");
    setRightTab("properties");
  };

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerActiveRef.current = true;
    focusStageKeyboardSurface();
    if (activeTool === "hand") {
      beginStagePan(event);
      return;
    }
    if (activeTool === "zoom") {
      zoomAtTool(event);
      return;
    }
    if (activeTool === "text") {
      createLayerAtClient("text", event.clientX, event.clientY);
      return;
    }
    if (activeTool === "pen") {
      handlePenPointerDown(event);
      return;
    }
    if (activeTool === "rectangle" || activeTool === "ellipse") {
      const start = getStagePoint(event);
      shapeDraftRef.current = { tool: activeTool, start };
      setShapeDraftRect({ left: start.x, top: start.y, width: 0, height: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    selectLayer(null);
  };

  const handleSnapshot = () => {
    void exportMotionCompositionFramePng({
      composition,
      time: playhead,
      compositionLibrary,
      mediaItems,
      creation,
    });
  };

  const handleContainerPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    pointerActiveRef.current = true;
    if (event.target !== event.currentTarget) return;
    if (activeTool === "hand") {
      beginStagePan(event);
      return;
    }
    if (activeTool === "zoom") {
      zoomAtTool(event);
    }
  };

  const stageCursor =
    activeTool === "hand"
      ? panDragRef.current
        ? "grabbing"
        : "grab"
      : activeTool === "zoom"
        ? "zoom-in"
        : activeTool === "text"
          ? "text"
          : activeTool === "pen" ||
              activeTool === "rectangle" ||
              activeTool === "ellipse"
            ? "crosshair"
            : activeTool === "anchor" || activeTool === "move"
              ? "move"
              : "default";
  const creationToolActive =
    activeTool === "rectangle" ||
    activeTool === "ellipse" ||
    activeTool === "pen" ||
    activeTool === "text";

  const updateShapeFill = (layerId: string, color: string) => {
    const base = pendingCompositionRef.current ?? composition;
    const layers = base.layers.map((candidate) => {
      if (candidate.id !== layerId || candidate.type !== "shape") return candidate;
      const fill = candidate.style.fill;
      // Preserve a gradient: recolor its first stop instead of flattening to solid.
      const nextFill =
        fill.type === "gradient" && fill.gradient
          ? {
              ...fill,
              gradient: {
                ...fill.gradient,
                stops: fill.gradient.stops.map((stop, index) =>
                  index === 0 ? { ...stop, color } : stop,
                ),
              },
            }
          : { type: "solid" as const, color, opacity: fill.opacity ?? 1 };
      return { ...candidate, style: { ...candidate.style, fill: nextFill } };
    });
    void upsertMotionComposition({ ...base, layers, modifiedAt: Date.now() });
  };

  const updateShapeStroke = (
    layerId: string,
    patch: { readonly color?: string; readonly width?: number },
  ) => {
    const base = pendingCompositionRef.current ?? composition;
    const layers = base.layers.map((candidate) =>
      candidate.id === layerId && candidate.type === "shape"
        ? {
            ...candidate,
            style: {
              ...candidate.style,
              stroke: {
                ...candidate.style.stroke,
                color: patch.color ?? candidate.style.stroke.color ?? "#0f766e",
                width: patch.width ?? Math.max(candidate.style.stroke.width, 2),
                opacity: candidate.style.stroke.opacity || 1,
              },
            },
          }
        : candidate,
    );
    void upsertMotionComposition({ ...base, layers, modifiedAt: Date.now() });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-stage-bg">
      <PreviewTopBar
        showGuides={showStageGuides}
        showGrid={showStageGrid}
        safeMargins={showSafeMargins}
        autoKeyframe={autoKeyframe}
        snapEnabled={snapEnabled}
        onToggleGuides={() => setShowStageGuides(!showStageGuides)}
        onToggleGrid={() => setShowStageGrid(!showStageGrid)}
        onToggleSafeMargins={() => setShowSafeMargins(!showSafeMargins)}
        onToggleAutoKeyframe={() => setAutoKeyframe(!autoKeyframe)}
        onToggleSnap={() => setSnapEnabled(!snapEnabled)}
        onFit={() => {
          setZoom(1);
          resetStagePan();
        }}
      />
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="Motion stage keyboard surface"
        onKeyDown={handleStageKeyDown}
        onPointerDown={handleContainerPointerDown}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-12 focus:outline-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          cursor: stageCursor,
        }}
      >
        <div className="pointer-events-none absolute bottom-3 left-3.5 z-20">
          <span className="rounded-lg border border-border bg-bg-1/90 px-2.5 py-1.5 text-[12px] font-medium tabular-nums text-fg-3 shadow-sm backdrop-blur">
            {composition.width} × {composition.height}
          </span>
        </div>
        <div className="absolute left-3.5 top-3 z-20">
          <ViewportChip>
            <ViewportSelect
              label="Active camera"
              value={previewCameraView}
              options={[
                {
                  value: "active",
                  label: composition.camera?.enabled ? "Active Camera" : "No Camera",
                },
                { value: "default", label: "Default View" },
              ]}
              onChange={(value) =>
                setPreviewCameraView(value as MotionPreviewCameraView)
              }
            />
          </ViewportChip>
        </div>
        <div className="absolute right-3.5 top-3 z-20 flex items-center gap-2">
          <ViewportChip>
            <ViewportSelect
              label="Preview quality"
              value={previewResolution}
              options={[
                { value: "full", label: "Adaptive" },
                { value: "half", label: "Balanced" },
                { value: "quarter", label: "Performance" },
              ]}
              onChange={(value) =>
                setPreviewResolution(value as MotionStagePreviewResolution)
              }
            />
          </ViewportChip>
          <span className="flex items-center gap-1.5 rounded-[7px] border border-white/[0.12] bg-white/[0.08] px-[11px] py-[6px] text-[12px] font-medium text-[#e8e8ee]">
            1 View
          </span>
        </div>
        <div
          ref={stageRef}
          data-testid="motion-composition-stage"
          className="relative shrink-0 origin-center overflow-hidden shadow-2xl ring-1 ring-white/10"
          style={{
            width: composition.width,
            height: composition.height,
            transform: `translate(${stagePanX}px, ${stagePanY}px) scale(${stageScale})`,
            background:
              showTransparencyGrid || composition.backgroundColor === "transparent"
                ? "repeating-conic-gradient(#1b1f2a 0% 25%, #14171f 0% 50%) 50% / 36px 36px"
                : composition.backgroundColor,
          }}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
        >
          {shapeDraftRect ? (
            <div
              className="pointer-events-none absolute z-[80] border border-accent bg-accent/10"
              style={{
                left: shapeDraftRect.left,
                top: shapeDraftRect.top,
                width: Math.max(1, shapeDraftRect.width),
                height: Math.max(1, shapeDraftRect.height),
                borderRadius:
                  shapeDraftRef.current?.tool === "ellipse" ? "50%" : undefined,
              }}
            />
          ) : null}
          {showStageGrid ? (
            <div
              className="pointer-events-none absolute inset-0 z-0 opacity-25"
              style={{
                backgroundImage:
                  "linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)",
                backgroundSize: `${gridSize}px ${gridSize}px`,
              }}
            />
          ) : null}
          {showSafeMargins ? (
            <div className="pointer-events-none absolute inset-0 z-[1]">
              <div
                className="absolute rounded-[2px] border border-accent/45"
                style={{ inset: "5%" }}
              />
              <div
                className="absolute rounded-[2px] border border-accent/30"
                style={{ inset: "10%" }}
              />
              <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 bg-accent/40" />
              <div className="absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 bg-accent/40" />
            </div>
          ) : null}
          {showStageGuides ? (
            <StageRulers
              composition={composition}
              gridSize={gridSize}
              onGuideStart={beginRulerGuideDrag}
              onGuideMove={moveGuideDrag}
              onGuideEnd={endGuideDrag}
            />
          ) : null}
          {usesRendererPreview ? (
            <RendererBackedStagePreview
              composition={previewComposition}
              compositionLibrary={compositionLibrary}
              assetResolver={assetResolver}
              time={playhead}
              resolution={activePreviewResolution}
              creationFallback={creationPreviewFallback}
              onVisibleFrameChange={setRendererHasVisibleFrame}
              isPlaying={isPlaying}
              getInteractionActive={getStageInteractionActive}
            />
          ) : null}
          {showCreationCpuPreview ? (
            <CreationCpuStagePreview
              fallback={creationPreviewFallback}
              width={composition.width}
              height={composition.height}
              resolution={activePreviewResolution}
              background={composition.backgroundColor}
              time={playhead}
              isPlaying={isPlaying}
            />
          ) : null}
          {rootLayers.map((layer) => (
            <StageLayerTree
              key={layer.id}
              composition={previewComposition}
              compositionLibrary={compositionLibrary}
              compositionStack={[]}
              mediaItems={mediaItems}
              layer={layer}
              renderMode={layerRenderMode}
              soloLayerIds={soloLayerIds}
              selectedLayerId={selectedLayerId}
              selectedLayerIds={selectedLayerIds}
              compositionTime={playhead}
              interactive
              creationToolActive={creationToolActive}
              onSelectLayer={(layerId, additive) => {
                if (
                  !additive &&
                  selectedLayerIds.length > 1 &&
                  selectedLayerIds.includes(layerId)
                ) {
                  return;
                }
                selectLayer(layerId, { additive });
              }}
              onDragStart={beginLayerDrag}
              onDragMove={moveLayerDrag}
              onDragEnd={endLayerDrag}
            />
          ))}
          {showStageGuides
            ? (composition.guides ?? []).map((guide) => (
                <AuthoredGuideLine
                  key={guide.id}
                  guide={guide}
                  onDragStart={beginGuideDrag}
                  onDragMove={moveGuideDrag}
                  onDragEnd={endGuideDrag}
                />
              ))
            : null}
          {snapGuides.map((guide, index) => (
            <SnapGuideLine key={`${guide.axis}-${guide.position}-${index}`} guide={guide} />
          ))}
          {selectedMotionPaths.map(({ layer, points }) => (
            <StageMotionPath
              key={layer.id}
              layer={layer}
              points={points}
              stageWidth={composition.width}
              stageHeight={composition.height}
              playhead={playhead}
              frameRate={composition.frameRate}
              onPointStart={beginPositionPathPointDrag}
              onPointMove={movePositionPathPointDrag}
              onPointEnd={endPositionPathPointDrag}
            />
          ))}
          {selectedShapePaths.map(({ layer, transform, localTime, points }) => (
            <StageShapePathEditor
              key={layer.id}
              layer={layer}
              points={points}
              transform={transform}
              stageWidth={composition.width}
              stageHeight={composition.height}
              localTime={localTime}
              onPointStart={beginShapePathPointDrag}
              onPointMove={moveShapePathPointDrag}
              onPointEnd={endShapePathPointDrag}
              onInsertPoint={insertShapePathPointAt}
              onToggleSmooth={toggleShapePathPointSmoothAt}
              selectedPointIndex={
                selectedShapeVertex && selectedShapeVertex.layerId === layer.id
                  ? selectedShapeVertex.pointIndex
                  : null
              }
            />
          ))}
          {selectedMaskPaths.map(({ layer, mask, transform, localTime, points }) => (
            <StageShapePathEditor
              key={`mask-${layer.id}-${mask.id}`}
              layer={{ ...layer, name: `${mask.name} path`, pathClosed: true }}
              points={points}
              transform={transform}
              stageWidth={composition.width}
              stageHeight={composition.height}
              localTime={localTime}
              onPointStart={(_layer, pointIndex, time, event, handle) =>
                beginMaskPathPointDrag(
                  layer,
                  mask,
                  pointIndex,
                  time,
                  event,
                  handle ?? null,
                )
              }
              onPointMove={moveMaskPathPointDrag}
              onPointEnd={endMaskPathPointDrag}
              onInsertPoint={(_layer, pointIndex, time) =>
                insertMaskPathPointAt(layer, mask, pointIndex, time)
              }
              onToggleSmooth={(_layer, pointIndex, time) =>
                toggleMaskPathPointSmoothAt(layer, mask, pointIndex, time)
              }
              selectedPointIndex={
                selectedMaskVertex &&
                selectedMaskVertex.layerId === layer.id &&
                selectedMaskVertex.maskId === mask.id
                  ? selectedMaskVertex.pointIndex
                  : null
              }
            />
          ))}
          {penDraftRubberBand ? (
            <svg
              className="pointer-events-none absolute inset-0 z-[69] overflow-visible"
              viewBox={`0 0 ${composition.width} ${composition.height}`}
              preserveAspectRatio="none"
              aria-hidden
              style={{ width: "100%", height: "100%" }}
            >
              <line
                x1={penDraftRubberBand.from.x}
                y1={penDraftRubberBand.from.y}
                x2={penDraftRubberBand.to.x}
                y2={penDraftRubberBand.to.y}
                vectorEffect="non-scaling-stroke"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeDasharray="6 5"
              />
            </svg>
          ) : null}
          {selectedPuppetPinLayers.map(({ layer, transform, localTime, pins }) => (
            <StagePuppetPinOverlay
              key={layer.id}
              layer={layer}
              pins={pins}
              transform={transform}
              stageWidth={composition.width}
              stageHeight={composition.height}
              localTime={localTime}
              onPinStart={beginPuppetPinDrag}
              onPinMove={movePuppetPinDrag}
              onPinEnd={endPuppetPinDrag}
            />
          ))}
          {selectedStageLayers.map(({ layer, bounds, transform }) => (
            <StageSelectionBox
              key={layer.id}
              bounds={bounds}
              rotation={transform.rotation}
              active={layer.id === selectedLayerId}
              locked={layer.locked}
              showHandles={shouldShowSelectionHandles({
                layerId: layer.id,
                selectedLayerId,
                selectionCount: selectedLayerIds.length,
                locked: layer.locked,
                penDraftLayerId: penDraftRef.current?.layerId ?? null,
              })}
              stageScale={stageScale}
              onResizeStart={(handle, event) =>
                beginResizeHandleDrag(layer, handle, event)
              }
              onResizeMove={moveResizeHandleDrag}
              onResizeEnd={endResizeHandleDrag}
              onRotateStart={(event) =>
                beginRotateHandleDrag(layer, bounds, event)
              }
              onRotateMove={moveRotateHandleDrag}
              onRotateEnd={endRotateHandleDrag}
            />
          ))}
          {selectionBounds ? (
            <StageSelectionBox
              bounds={selectionBounds}
              rotation={0}
              active
              locked={false}
              showHandles
              stageScale={stageScale}
              label={`${editableSelectedStageLayers.length} layers`}
              onResizeStart={beginSelectionResizeHandleDrag}
              onResizeMove={moveResizeHandleDrag}
              onResizeEnd={endResizeHandleDrag}
              onRotateStart={beginSelectionRotateHandleDrag}
              onRotateMove={moveRotateHandleDrag}
              onRotateEnd={endRotateHandleDrag}
            />
          ) : null}
          {(() => {
            if (selectedLayerIds.length !== 1 || selectedStageLayers.length !== 1) {
              return null;
            }
            const entry = selectedStageLayers[0];
            if (entry.layer.type !== "shape" || entry.layer.locked) return null;
            const shape = entry.layer;
            const fillColor =
              shape.style.fill.type === "solid"
                ? shape.style.fill.color ?? "#14b8a6"
                : shape.style.fill.gradient?.stops[0]?.color ?? "#14b8a6";
            const strokeColor = shape.style.stroke.color ?? "#0f766e";
            const hex = (color: string): string =>
              /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#14b8a6";
            const flipBelow = entry.bounds.top < 64 / stageScale;
            return (
              <div
                onPointerDown={(event) => event.stopPropagation()}
                className="pointer-events-auto absolute z-[75] flex items-center gap-1.5 rounded-lg border border-border bg-bg-1/95 px-1.5 py-1 shadow-lg backdrop-blur"
                style={{
                  left: entry.bounds.left,
                  top: flipBelow ? entry.bounds.top + entry.bounds.height : entry.bounds.top,
                  transform: flipBelow
                    ? `translateY(${12 / stageScale}px) scale(${1 / stageScale})`
                    : `translateY(-100%) translateY(${-12 / stageScale}px) scale(${1 / stageScale})`,
                  transformOrigin: flipBelow ? "left top" : "left bottom",
                }}
              >
                <div className="w-28" title="Fill color">
                  <ColorInput
                    value={hex(fillColor)}
                    onChange={(value) => updateShapeFill(shape.id, value)}
                  />
                </div>
                <span className="h-3 w-px bg-border" />
                <div className="w-28" title="Stroke color">
                  <ColorInput
                    value={hex(strokeColor)}
                    onChange={(color) => updateShapeStroke(shape.id, { color })}
                  />
                </div>
                <div className="w-16" title="Stroke width">
                  <NumberInput
                    value={Math.round(shape.style.stroke.width)}
                    onChange={(width) => updateShapeStroke(shape.id, { width })}
                    min={0}
                    max={40}
                    step={1}
                  />
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <PreviewBottomBar
        stageScale={stageScale}
        playhead={playhead}
        duration={composition.duration}
        frameRate={composition.frameRate}
        ramPreviewEnabled={usesRendererPreview}
        isPlaying={isPlaying}
        playbackDisabled={exportActive}
        loop={loopPlayback}
        transparencyGrid={showTransparencyGrid}
        previewMode={previewMode}
        playbackRate={playbackRate}
        onZoom={(value) => setZoom(value)}
        onSeek={(value) => setPlayhead(value)}
        onTogglePlay={togglePlayback}
        onToggleLoop={() => setLoopPlayback(!loopPlayback)}
        onToggleTransparency={() => setShowTransparencyGrid(!showTransparencyGrid)}
        onChangeMode={(value) => setPreviewMode(value)}
        onChangeRate={(value) => setPlaybackRate(value)}
        onSnapshot={handleSnapshot}
        onFullscreen={() => {
          void containerRef.current?.requestFullscreen?.();
        }}
      />
    </div>
  );
}

function PreviewToolButton({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={Icon}
      iconSize={15}
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
      className="h-7 w-7"
    />
  );
}

function PreviewSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="relative flex items-center">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-[15px] text-[12px] font-medium leading-none text-fg-2 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-0"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--fg-muted)"
        strokeWidth="2.4"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function ViewportChip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-[7px] border border-white/[0.12] bg-white/[0.08] px-[11px] py-[6px] text-[12px] font-medium text-[#e8e8ee] backdrop-blur-sm">
      {children}
    </div>
  );
}

function ViewportSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="relative flex items-center">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-[15px] text-[12px] font-medium leading-none text-[#e8e8ee] outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="text-fg">
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-0"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="2.4"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function BottomBarPill({
  startIcon,
  children,
}: {
  startIcon?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-[7px] bg-bg-2 px-[10px] py-[6px] text-[12px] font-medium text-fg-2">
      {startIcon}
      {children}
    </div>
  );
}

function BottomPillSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="relative flex items-center">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-[15px] text-[12px] font-medium leading-none text-fg-2 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-0"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--fg-muted)"
        strokeWidth="2.4"
        aria-hidden
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function PreviewTopBar({
  showGuides,
  showGrid,
  safeMargins,
  autoKeyframe,
  snapEnabled,
  onToggleGuides,
  onToggleGrid,
  onToggleSafeMargins,
  onToggleAutoKeyframe,
  onToggleSnap,
  onFit,
}: {
  showGuides: boolean;
  showGrid: boolean;
  safeMargins: boolean;
  autoKeyframe: boolean;
  snapEnabled: boolean;
  onToggleGuides: () => void;
  onToggleGrid: () => void;
  onToggleSafeMargins: () => void;
  onToggleAutoKeyframe: () => void;
  onToggleSnap: () => void;
  onFit: () => void;
}): JSX.Element {
  return (
    <div className="flex h-[42px] shrink-0 items-center gap-3 border-b border-border bg-bg-1 px-3.5 text-fg-3">
      <PreviewToolButton icon={Maximize} label="Fit to view" onClick={onFit} />
      <PreviewToolButton icon={Ruler} label="Guides" active={showGuides} onClick={onToggleGuides} />
      <PreviewToolButton icon={Grid3x3} label="Grid" active={showGrid} onClick={onToggleGrid} />
      <span className="h-[18px] w-px shrink-0 bg-border" />
      <button
        type="button"
        aria-pressed={snapEnabled}
        onClick={onToggleSnap}
        className={`flex shrink-0 items-center gap-[7px] rounded-md px-1.5 py-1 text-[12px] font-medium transition-colors ${
          snapEnabled ? "text-accent" : "text-fg-3 hover:text-fg-2"
        }`}
      >
        <Magnet size={15} strokeWidth={1.7} aria-hidden />
        <span>Snapping</span>
      </button>
      <div className="ml-auto flex items-center gap-3">
        <span className="h-[18px] w-px shrink-0 bg-border" />
        <PreviewToolButton
          icon={Diamond}
          label="Auto keyframe"
          active={autoKeyframe}
          onClick={onToggleAutoKeyframe}
        />
        <PreviewToolButton
          icon={SquareDashed}
          label="Title/action safe"
          active={safeMargins}
          onClick={onToggleSafeMargins}
        />
      </div>
    </div>
  );
}

function PreviewBottomBar({
  stageScale,
  playhead,
  duration,
  frameRate,
  ramPreviewEnabled,
  isPlaying,
  playbackDisabled,
  loop,
  transparencyGrid,
  previewMode,
  playbackRate,
  onZoom,
  onSeek,
  onTogglePlay,
  onToggleLoop,
  onToggleTransparency,
  onChangeMode,
  onChangeRate,
  onSnapshot,
  onFullscreen,
}: {
  stageScale: number;
  playhead: number;
  duration: number;
  frameRate: number;
  ramPreviewEnabled: boolean;
  isPlaying: boolean;
  playbackDisabled: boolean;
  loop: boolean;
  transparencyGrid: boolean;
  previewMode: string;
  playbackRate: number;
  onZoom: (value: number) => void;
  onSeek: (value: number) => void;
  onTogglePlay: () => void;
  onToggleLoop: () => void;
  onToggleTransparency: () => void;
  onChangeMode: (value: MotionStagePreviewMode) => void;
  onChangeRate: (value: number) => void;
  onSnapshot: () => void;
  onFullscreen: () => void;
}): JSX.Element {
  const fps = frameRate > 0 ? frameRate : 30;
  const frameStep = 1 / fps;
  const zoomPct = Math.round(stageScale * 100);
  return (
    <div className="flex h-[42px] shrink-0 items-center gap-3.5 border-t border-border bg-bg-1 px-3.5 text-fg-3">
      <BottomBarPill>
        <BottomPillSelect
          label="Zoom level"
          value={String(zoomPct)}
          options={(() => {
            const presets = [25, 50, 75, 100, 150, 200];
            const opts = presets.map((value) => ({
              value: String(value),
              label: `(${value}%)`,
            }));
            if (!presets.includes(zoomPct)) {
              opts.unshift({ value: String(zoomPct), label: `(${zoomPct}%)` });
            }
            return opts;
          })()}
          onChange={(value) => onZoom(Number(value) / 100)}
        />
      </BottomBarPill>
      <BottomBarPill startIcon={<Monitor size={13} strokeWidth={1.7} aria-hidden />}>
        <BottomPillSelect
          label="Playback speed"
          value={String(playbackRate)}
          options={[
            { value: "0.5", label: "0.5×" },
            { value: "1", label: "Full" },
            { value: "2", label: "2×" },
            { value: "4", label: "4×" },
          ]}
          onChange={(value) => onChangeRate(Number(value))}
        />
      </BottomBarPill>

      <div className="flex flex-1 items-center justify-center gap-2.5">
        <PreviewToolButton
          icon={Grid2x2}
          label="Transparency grid"
          active={transparencyGrid}
          onClick={onToggleTransparency}
        />
        <PreviewSelect
          label="Render mode"
          value={previewMode}
          options={[
            { value: "final", label: "3D" },
            { value: "draft", label: "Fast 2D" },
          ]}
          onChange={(value) => onChangeMode(value as MotionStagePreviewMode)}
        />
        <PreviewToolButton icon={Repeat} label="Loop" active={loop} onClick={onToggleLoop} />
        <span className="h-[18px] w-px shrink-0 bg-border" />
        <PreviewToolButton icon={SkipBack} label="To start" onClick={() => onSeek(0)} />
        <PreviewToolButton
          icon={StepBack}
          label="Previous frame"
          onClick={() => onSeek(Math.max(0, playhead - frameStep))}
        />
        <IconButton
          label={
            playbackDisabled
              ? "Playback paused during export"
              : isPlaying
                ? "Pause"
                : "Play"
          }
          icon={
            isPlaying ? (
              <Pause size={14} aria-hidden />
            ) : (
              <Play size={14} aria-hidden />
            )
          }
          size="sm"
          variant="primary"
          onClick={onTogglePlay}
          disabled={playbackDisabled}
          className="h-7 w-7"
        />
        <PreviewToolButton
          icon={StepForward}
          label="Next frame"
          onClick={() => onSeek(Math.min(duration, playhead + frameStep))}
        />
        <PreviewToolButton icon={SkipForward} label="To end" onClick={() => onSeek(duration)} />
      </div>

      <span className="font-mono text-[12px] font-semibold tabular-nums text-fg-2">
        {formatMotionTimecode(playhead, frameRate)}
      </span>
      {ramPreviewEnabled ? (
        <RamPreviewButton duration={duration} frameRate={frameRate} />
      ) : null}
      <PreviewToolButton icon={Camera} label="Save frame (PNG)" onClick={onSnapshot} />
      <PreviewToolButton icon={Maximize} label="Fullscreen" onClick={onFullscreen} />
    </div>
  );
}

function RamPreviewButton({
  duration,
  frameRate,
}: {
  duration: number;
  frameRate: number;
}): JSX.Element {
  const cacheState = useSyncExternalStore(
    subscribeFrameCacheState,
    getFrameCacheState,
    getFrameCacheState,
  );
  const requested = useSyncExternalStore(
    subscribeExplicitFill,
    getExplicitFillRequested,
    getExplicitFillRequested,
  );
  const fps = frameRate > 0 ? frameRate : 30;
  const totalFrames = Math.max(1, Math.floor(Math.max(0, duration) * fps) + 1);
  const cachedFrames = cacheState.ranges.reduce((sum, range) => {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.end < range.start
    ) {
      return sum;
    }
    return sum + (range.end - range.start + 1);
  }, 0);
  const percent = Math.min(100, Math.round((cachedFrames / totalFrames) * 100));
  const active = requested || cacheState.filling;
  return (
    <div className="flex items-center gap-1">
        <IconButton
          label="Fill RAM preview"
          icon={
          cacheState.filling ? (
            <Loader2 size={15} className="animate-spin" aria-hidden />
          ) : (
            <MemoryStick size={15} aria-hidden />
          )
        }
        size="sm"
        variant={active ? "secondary" : "ghost"}
        aria-pressed={active}
        data-fill-percent={percent}
        onClick={() => setExplicitFillRequested(!requested)}
        className="h-7 w-7"
      />
      {cacheState.filling ? (
        <span className="font-mono text-[10px] font-semibold tabular-nums text-fg-3">
          {percent}%
        </span>
      ) : null}
    </div>
  );
}

const MOTION_TOOL_SHORTCUTS: Readonly<Record<string, MotionToolId>> = {
  v: "select",
  h: "hand",
  z: "zoom",
  g: "pen",
  q: "rectangle",
};

const MOTION_REVEAL_PROPERTY_KEYS: Readonly<Record<string, readonly string[]>> = {
  p: ["transform.position.x", "transform.position.y"],
  s: ["transform.scale.x", "transform.scale.y"],
  r: ["transform.rotation"],
  t: ["transform.opacity"],
  a: ["transform.anchor.x", "transform.anchor.y"],
};

function resolveRevealProperties(
  key: string,
  selectedLayerIds: readonly string[],
  composition: MotionComposition,
): { readonly layerId: string | null; readonly properties: readonly string[] } | null {
  const isAnimatedKey = key === "u";
  const staticProperties = MOTION_REVEAL_PROPERTY_KEYS[key];
  if (!isAnimatedKey && !staticProperties) return null;
  const layerId = selectedLayerIds[selectedLayerIds.length - 1] ?? null;
  if (!layerId) return { layerId: null, properties: [] };
  if (staticProperties) {
    return { layerId, properties: staticProperties };
  }
  const layer = composition.layers.find((candidate) => candidate.id === layerId);
  if (!layer) return { layerId, properties: [] };
  const seen = new Set<string>();
  const properties: string[] = [];
  for (const keyframe of layer.keyframes) {
    if (!isMotionAnimatableProperty(keyframe.property)) continue;
    if (seen.has(keyframe.property)) continue;
    seen.add(keyframe.property);
    properties.push(keyframe.property);
  }
  return { layerId, properties };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function getKeyboardNudgeDelta(
  key: string,
  amount: number,
): { readonly x: number; readonly y: number } {
  switch (key) {
    case "ArrowLeft":
      return { x: -amount, y: 0 };
    case "ArrowRight":
      return { x: amount, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -amount };
    case "ArrowDown":
      return { x: 0, y: amount };
    default:
      return { x: 0, y: 0 };
  }
}

const RESIZE_HANDLES: Array<{
  readonly id: MotionLayerResizeHandle;
  readonly className: string;
  readonly cursor: string;
}> = [
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-nwse-resize" },
  { id: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-ns-resize" },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "cursor-nesw-resize" },
  { id: "e", className: "right-0 top-1/2 -translate-y-1/2 translate-x-1/2", cursor: "cursor-ew-resize" },
  { id: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2", cursor: "cursor-nwse-resize" },
  { id: "s", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2", cursor: "cursor-ns-resize" },
  { id: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2", cursor: "cursor-nesw-resize" },
  { id: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2", cursor: "cursor-ew-resize" },
];

function StageMotionPath({
  layer,
  points,
  stageWidth,
  stageHeight,
  playhead,
  frameRate,
  onPointStart,
  onPointMove,
  onPointEnd,
}: {
  layer: MotionLayer;
  points: readonly MotionPositionPathPoint[];
  stageWidth: number;
  stageHeight: number;
  playhead: number;
  frameRate: number;
  onPointStart: (
    layer: MotionLayer,
    point: MotionPositionPathPoint,
    event: ReactPointerEvent<SVGElement>,
  ) => void;
  onPointMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointEnd: (event: ReactPointerEvent<SVGElement>) => void;
}): JSX.Element | null {
  if (points.length === 0) return null;
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const activeTolerance = 1 / Math.max(1, frameRate);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[66] overflow-visible"
      viewBox={`0 0 ${stageWidth} ${stageHeight}`}
      preserveAspectRatio="none"
      aria-label={`${layer.name} motion path`}
      role="img"
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <path
        d={path}
        vectorEffect="non-scaling-stroke"
        fill="none"
        stroke="var(--accent)"
        strokeDasharray="7 5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        opacity="0.72"
      />
      {points.map((point) => {
        const active =
          Math.abs(layer.startTime + point.time - playhead) <= activeTolerance;
        return (
          <g
            key={`${point.time}-${point.x}-${point.y}`}
            role="button"
            tabIndex={0}
            className="pointer-events-auto cursor-grab outline-none active:cursor-grabbing"
            onPointerDown={(event) => onPointStart(layer, point, event)}
            onPointerMove={onPointMove}
            onPointerUp={onPointEnd}
            onPointerCancel={onPointEnd}
          >
            <title>{`${layer.name} · ${point.time.toFixed(2)}s`}</title>
            <circle
              cx={point.x}
              cy={point.y}
              r={active ? 7 : 5}
              vectorEffect="non-scaling-stroke"
              fill={active ? "var(--accent-strong)" : "var(--bg-1)"}
              stroke="var(--accent)"
              strokeWidth={active ? 3 : 2}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={12}
              fill="transparent"
            />
          </g>
        );
      })}
    </svg>
  );
}

function StageShapePathEditor({
  layer,
  points,
  transform,
  stageWidth,
  stageHeight,
  localTime,
  onPointStart,
  onPointMove,
  onPointEnd,
  onInsertPoint,
  onToggleSmooth,
  selectedPointIndex,
}: {
  layer: MotionLayer & { readonly pathClosed?: boolean };
  points: readonly MotionShapePathPoint[];
  transform: MotionTransform;
  stageWidth: number;
  stageHeight: number;
  localTime: number;
  onPointStart: (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
    event: ReactPointerEvent<SVGElement>,
    handle?: "in" | "out" | null,
  ) => void;
  onPointMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPointEnd: (event: ReactPointerEvent<SVGElement>) => void;
  onInsertPoint: (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
  ) => void;
  onToggleSmooth: (
    layer: MotionLayer,
    pointIndex: number,
    localTime: number,
  ) => void;
  selectedPointIndex: number | null;
}): JSX.Element | null {
  if (points.length === 0) return null;
  const stageHandledPoints = points.map((point) => {
    const anchor = getShapePathStagePoint(layer, transform, point);
    const result: MotionShapePathPoint = { x: anchor.x, y: anchor.y };
    if (point.outX !== undefined && point.outY !== undefined) {
      const out = getShapePathStagePoint(layer, transform, {
        x: point.outX,
        y: point.outY,
      });
      Object.assign(result, { outX: out.x, outY: out.y });
    }
    if (point.inX !== undefined && point.inY !== undefined) {
      const inHandle = getShapePathStagePoint(layer, transform, {
        x: point.inX,
        y: point.inY,
      });
      Object.assign(result, { inX: inHandle.x, inY: inHandle.y });
    }
    return result;
  });
  const stagePoints = stageHandledPoints.map((point) => ({
    x: point.x,
    y: point.y,
  }));
  const pathData = buildStageHandledPathData(
    stageHandledPoints,
    layer.pathClosed ?? false,
  );
  const midpoints = stagePoints.map((point, index) => {
    const next = stagePoints[index + 1] ?? (layer.pathClosed ? stagePoints[0] : null);
    return next
      ? {
          index,
          x: (point.x + next.x) / 2,
          y: (point.y + next.y) / 2,
        }
      : null;
  }).filter((point): point is { readonly index: number; readonly x: number; readonly y: number } =>
    Boolean(point),
  );

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[68] overflow-visible"
      viewBox={`0 0 ${stageWidth} ${stageHeight}`}
      preserveAspectRatio="none"
      aria-label={`${layer.name} path editor`}
      role="img"
      style={{ width: "100%", height: "100%" }}
    >
      <path
        d={pathData}
        vectorEffect="non-scaling-stroke"
        fill={layer.pathClosed ? "var(--accent-soft)" : "none"}
        fillOpacity={layer.pathClosed ? 0.1 : undefined}
        stroke="var(--accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        strokeDasharray="6 5"
      />
      {midpoints.map((point) => (
        <g
          key={`insert-${point.index}-${point.x}-${point.y}`}
          role="button"
          tabIndex={0}
          className="pointer-events-auto cursor-copy outline-none"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onInsertPoint(layer, point.index, localTime);
          }}
        >
          <title>Insert path point</title>
          <circle
            cx={point.x}
            cy={point.y}
            r={4}
            vectorEffect="non-scaling-stroke"
            fill="var(--bg-1)"
            stroke="var(--accent)"
            strokeDasharray="2 2"
            strokeWidth={1.5}
          />
          <circle cx={point.x} cy={point.y} r={10} fill="transparent" />
        </g>
      ))}
      {stageHandledPoints.flatMap((point, index) => {
        const handles: ("in" | "out")[] = [];
        if (point.outX !== undefined && point.outY !== undefined) {
          handles.push("out");
        }
        if (point.inX !== undefined && point.inY !== undefined) {
          handles.push("in");
        }
        return handles.map((handle) => {
          const handleX = handle === "out" ? point.outX ?? point.x : point.inX ?? point.x;
          const handleY = handle === "out" ? point.outY ?? point.y : point.inY ?? point.y;
          return (
            <g key={`handle-${handle}-${index}`}>
              <line
                x1={point.x}
                y1={point.y}
                x2={handleX}
                y2={handleY}
                stroke="var(--accent)"
                strokeOpacity={0.5}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <g
                role="button"
                tabIndex={0}
                className="pointer-events-auto cursor-grab outline-none active:cursor-grabbing"
                onPointerDown={(event) =>
                  onPointStart(layer, index, localTime, event, handle)
                }
                onPointerMove={onPointMove}
                onPointerUp={onPointEnd}
                onPointerCancel={onPointEnd}
              >
                <title>{`Drag ${handle} handle of point ${index + 1}`}</title>
                <circle
                  cx={handleX}
                  cy={handleY}
                  r={3.5}
                  fill="var(--accent)"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={handleX} cy={handleY} r={9} fill="transparent" />
              </g>
            </g>
          );
        });
      })}
      {stagePoints.map((point, index) => {
        const selected = selectedPointIndex === index;
        return (
          <g
            key={`point-${index}-${point.x}-${point.y}`}
            role="button"
            tabIndex={0}
            className="pointer-events-auto cursor-grab outline-none active:cursor-grabbing"
            onPointerDown={(event) => {
              if (event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                onToggleSmooth(layer, index, localTime);
                return;
              }
              onPointStart(layer, index, localTime, event);
            }}
            onPointerMove={onPointMove}
            onPointerUp={onPointEnd}
            onPointerCancel={onPointEnd}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleSmooth(layer, index, localTime);
            }}
          >
            <title>{`Drag point ${index + 1}; alt-drag handles asymmetric; double-click or alt-click toggles smooth; Delete removes`}</title>
            <rect
              x={point.x - 5}
              y={point.y - 5}
              width={10}
              height={10}
              vectorEffect="non-scaling-stroke"
              fill={selected ? "var(--accent)" : "var(--bg-1)"}
              stroke="var(--accent)"
              strokeWidth={2}
            />
            <rect
              x={point.x - 13}
              y={point.y - 13}
              width={26}
              height={26}
              fill="transparent"
            />
          </g>
        );
      })}
    </svg>
  );
}

function StagePuppetPinOverlay({
  layer,
  pins,
  transform,
  stageWidth,
  stageHeight,
  localTime,
  onPinStart,
  onPinMove,
  onPinEnd,
}: {
  layer: Extract<MotionLayer, { type: "shape" }>;
  pins: readonly MotionPuppetPin[];
  transform: MotionTransform;
  stageWidth: number;
  stageHeight: number;
  localTime: number;
  onPinStart: (
    layer: Extract<MotionLayer, { type: "shape" }>,
    pin: MotionPuppetPin,
    localTime: number,
    event: ReactPointerEvent<SVGElement>,
  ) => void;
  onPinMove: (event: ReactPointerEvent<SVGElement>) => void;
  onPinEnd: (event: ReactPointerEvent<SVGElement>) => void;
}): JSX.Element | null {
  if (pins.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[72] overflow-visible"
      viewBox={`0 0 ${stageWidth} ${stageHeight}`}
      preserveAspectRatio="none"
      aria-label={`${layer.name} puppet pins`}
      role="img"
      style={{ width: "100%", height: "100%" }}
    >
      {pins.map((pin) => {
        const color = pin.color ?? "var(--accent)";
        const bindPoint = getShapePathStagePoint(layer, transform, pin.bindPosition);
        const positionPoint = getShapePathStagePoint(layer, transform, pin.position);
        const isMoved =
          Math.hypot(positionPoint.x - bindPoint.x, positionPoint.y - bindPoint.y) >
          0.5;
        const active = pin.enabled && pin.radius > 0 && pin.strength > 0;
        return (
          <g key={pin.id} opacity={active ? 1 : 0.48}>
            {isMoved ? (
              <line
                x1={bindPoint.x}
                y1={bindPoint.y}
                x2={positionPoint.x}
                y2={positionPoint.y}
                vectorEffect="non-scaling-stroke"
                stroke={color}
                strokeDasharray="4 4"
                strokeLinecap="round"
                strokeWidth={1.5}
                opacity={0.8}
              />
            ) : null}
            <circle
              cx={bindPoint.x}
              cy={bindPoint.y}
              r={4}
              vectorEffect="non-scaling-stroke"
              fill="var(--bg-1)"
              stroke={color}
              strokeDasharray={isMoved ? "2 2" : undefined}
              strokeWidth={1.5}
            />
            <g
              role="button"
              tabIndex={0}
              className="pointer-events-auto cursor-grab outline-none active:cursor-grabbing"
              onPointerDown={(event) =>
                onPinStart(layer, pin, localTime, event)
              }
              onPointerMove={onPinMove}
              onPointerUp={onPinEnd}
              onPointerCancel={onPinEnd}
            >
              <title>{`Drag ${pin.name}`}</title>
              <circle
                cx={positionPoint.x}
                cy={positionPoint.y}
                r={7}
                vectorEffect="non-scaling-stroke"
                fill={active ? color : "var(--bg-1)"}
                stroke="var(--bg)"
                strokeWidth={2.5}
              />
              <circle
                cx={positionPoint.x}
                cy={positionPoint.y}
                r={14}
                fill="transparent"
              />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function buildStageHandledPathData(
  points: readonly MotionShapePathPoint[],
  closed: boolean,
): string {
  const commands = getMotionPathDrawCommands(points);
  if (commands.length === 0) return "";
  const parts = commands.map((command) => {
    if (command.type === "move") {
      return `M ${roundStagePoint(command.x)} ${roundStagePoint(command.y)}`;
    }
    if (command.type === "line") {
      return `L ${roundStagePoint(command.x)} ${roundStagePoint(command.y)}`;
    }
    return `C ${roundStagePoint(command.c1x)} ${roundStagePoint(
      command.c1y,
    )} ${roundStagePoint(command.c2x)} ${roundStagePoint(
      command.c2y,
    )} ${roundStagePoint(command.x)} ${roundStagePoint(command.y)}`;
  });
  const base = parts.join(" ");
  return closed ? `${base} Z` : base;
}

function getShapePathStagePoint(
  layer: MotionLayer,
  transform: MotionTransform,
  point: MotionShapePathPoint,
): { readonly x: number; readonly y: number } {
  const bounds = getMotionLayerVisualBounds(layer);
  const localX = point.x + (0.5 - transform.anchor.x) * bounds.width;
  const localY = point.y + (0.5 - transform.anchor.y) * bounds.height;
  const scaledX = localX * transform.scale.x;
  const scaledY = localY * transform.scale.y;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: transform.position.x + scaledX * cos - scaledY * sin,
    y: transform.position.y + scaledX * sin + scaledY * cos,
  };
}

function getShapePathPointFromStagePoint(
  layer: MotionLayer,
  transform: MotionTransform,
  point: { readonly x: number; readonly y: number },
): MotionShapePathPoint {
  const bounds = getMotionLayerVisualBounds(layer);
  const dx = point.x - transform.position.x;
  const dy = point.y - transform.position.y;
  const radians = (-transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const unrotatedX = dx * cos - dy * sin;
  const unrotatedY = dx * sin + dy * cos;
  return {
    x:
      unrotatedX / safeScale(transform.scale.x) -
      (0.5 - transform.anchor.x) * bounds.width,
    y:
      unrotatedY / safeScale(transform.scale.y) -
      (0.5 - transform.anchor.y) * bounds.height,
  };
}

export function buildMotionPathMask(
  points: readonly MotionShapePathPoint[],
  id?: string,
): MotionMask {
  const clonedPoints = points.map((point) => ({ ...point }));
  return {
    id: id ?? createMaskId(),
    name: "Path Mask",
    enabled: true,
    shape: "path",
    mode: "add",
    inverted: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    expansion: 0,
    feather: 0,
    opacity: 1,
    pathPoints: clonedPoints,
  };
}

function shouldWritePuppetPinPositionKeyframes(
  layer: Extract<MotionLayer, { type: "shape" }>,
  pinId: string,
  autoKeyframe: boolean,
): boolean {
  if (autoKeyframe) return true;
  const xProperty = getMotionPuppetPinKeyframeProperty(pinId, "position.x");
  const yProperty = getMotionPuppetPinKeyframeProperty(pinId, "position.y");
  return layer.keyframes.some(
    (keyframe) =>
      keyframe.property === xProperty || keyframe.property === yProperty,
  );
}

function upsertPuppetPinPositionKeyframes(
  layer: Extract<MotionLayer, { type: "shape" }>,
  pinId: string,
  position: MotionShapePathPoint,
  localTime: number,
): Extract<MotionLayer, { type: "shape" }> {
  return upsertMotionLayerKeyframe(
    upsertMotionLayerKeyframe(
      layer,
      getMotionPuppetPinKeyframeProperty(pinId, "position.x"),
      localTime,
      { value: position.x, easing: "ease" },
    ),
    getMotionPuppetPinKeyframeProperty(pinId, "position.y"),
    localTime,
    { value: position.y, easing: "ease" },
  );
}

function safeScale(value: number): number {
  return Math.abs(value) < 0.0001 ? 0.0001 : value;
}

function roundStagePoint(value: number): number {
  return Math.round(value * 100) / 100;
}

function StageSelectionBox({
  bounds,
  rotation,
  active,
  locked,
  showHandles,
  stageScale,
  label,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
}: {
  bounds: MotionLayerLayoutBounds;
  rotation: number;
  active: boolean;
  locked: boolean;
  showHandles: boolean;
  stageScale: number;
  label?: string;
  onResizeStart: (
    handle: MotionLayerResizeHandle,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onRotateStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onRotateMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onRotateEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}): JSX.Element {
  const handleSize = Math.max(6, 12 / Math.max(0.1, stageScale));
  const rotationOffset = Math.max(24, 30 / Math.max(0.1, stageScale));
  const rotationHandleSize = Math.max(9, 14 / Math.max(0.1, stageScale));
  return (
    <div
      className={`pointer-events-none absolute z-[70] border ${
        active ? "border-accent" : "border-accent/55"
      } ${locked ? "border-dashed" : ""}`}
      style={{
        left: bounds.left,
        top: bounds.top,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "center",
        boxShadow: active ? "0 0 0 1px var(--accent-soft)" : undefined,
      }}
    >
      {label ? (
        <span
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg shadow-sm"
          style={{
            transform: `translateY(calc(-100% - ${6 / Math.max(0.1, stageScale)}px)) scale(${1 / Math.max(0.1, stageScale)})`,
            transformOrigin: "left bottom",
          }}
        >
          {label}
        </span>
      ) : null}
      {showHandles ? (
        <>
          <span
            className="pointer-events-none absolute left-1/2 top-0 w-px -translate-x-1/2 bg-accent/80"
            style={{
              height: rotationOffset,
              transform: `translate(-50%, -${rotationOffset}px)`,
            }}
          />
          <div
            role="button"
            tabIndex={0}
            title="Rotate layer"
            aria-label="Rotate layer"
            onPointerDown={onRotateStart}
            onPointerMove={onRotateMove}
            onPointerUp={onRotateEnd}
            onPointerCancel={onRotateEnd}
            className="pointer-events-auto absolute left-1/2 top-0 rounded-full border border-accent bg-bg-1 shadow-sm transition-colors hover:bg-accent hover:text-accent-fg active:cursor-grabbing"
            style={{
              width: rotationHandleSize,
              height: rotationHandleSize,
              transform: `translate(-50%, calc(-${rotationOffset}px - 50%))`,
            }}
          />
          {RESIZE_HANDLES.map((handle) => (
            <div
              key={handle.id}
              role="button"
              tabIndex={0}
              title="Resize layer"
              aria-label={`Resize layer ${handle.id}`}
              onPointerDown={(event) => onResizeStart(handle.id, event)}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeEnd}
              className={`pointer-events-auto absolute rounded-[3px] border border-accent bg-bg-1 shadow-sm transition-colors hover:bg-accent hover:text-accent-fg ${handle.className} ${handle.cursor}`}
              style={{
                width: handleSize,
                height: handleSize,
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function StageRulers({
  composition,
  gridSize,
  onGuideStart,
  onGuideMove,
  onGuideEnd,
}: {
  composition: MotionComposition;
  gridSize: number;
  onGuideStart: (
    orientation: MotionGuide["orientation"],
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onGuideMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onGuideEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}): JSX.Element {
  const minorStep = getRulerStep(gridSize);
  const xTicks = buildRulerTicks(composition.width, minorStep);
  const yTicks = buildRulerTicks(composition.height, minorStep);

  return (
    <>
      <div
        className="absolute left-0 top-0 z-30 h-7 w-full cursor-crosshair border-b border-border bg-bg-1/85 text-fg-muted backdrop-blur"
        onPointerDown={(event) => onGuideStart("vertical", event)}
        onPointerMove={onGuideMove}
        onPointerUp={onGuideEnd}
        onPointerCancel={onGuideEnd}
      >
        {xTicks.map((tick) => (
          <RulerTick
            key={`x-${tick.position}`}
            axis="x"
            position={tick.position}
            major={tick.major}
          />
        ))}
      </div>
      <div
        className="absolute left-0 top-0 z-30 h-full w-8 cursor-crosshair border-r border-border bg-bg-1/85 text-fg-muted backdrop-blur"
        onPointerDown={(event) => onGuideStart("horizontal", event)}
        onPointerMove={onGuideMove}
        onPointerUp={onGuideEnd}
        onPointerCancel={onGuideEnd}
      >
        {yTicks.map((tick) => (
          <RulerTick
            key={`y-${tick.position}`}
            axis="y"
            position={tick.position}
            major={tick.major}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute left-0 top-0 z-40 h-7 w-8 border-b border-r border-border bg-bg-2/90" />
    </>
  );
}

function RulerTick({
  axis,
  position,
  major,
}: {
  axis: "x" | "y";
  position: number;
  major: boolean;
}): JSX.Element {
  if (axis === "x") {
    return (
      <span
        className={`pointer-events-none absolute bottom-0 w-px bg-fg-muted ${
          major ? "h-4 opacity-80" : "h-2 opacity-45"
        }`}
        style={{ left: position }}
      >
        {major && position > 0 ? (
          <span className="absolute bottom-3 left-1 text-[10px] tabular-nums">
            {position}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={`pointer-events-none absolute right-0 h-px bg-fg-muted ${
        major ? "w-4 opacity-80" : "w-2 opacity-45"
      }`}
      style={{ top: position }}
    >
      {major && position > 0 ? (
        <span className="absolute left-1 top-1 origin-left rotate-90 text-[10px] tabular-nums">
          {position}
        </span>
      ) : null}
    </span>
  );
}

function buildRulerTicks(
  length: number,
  step: number,
): Array<{ readonly position: number; readonly major: boolean }> {
  const ticks: Array<{ readonly position: number; readonly major: boolean }> = [];
  const safeLength = Math.max(0, Math.ceil(length));
  const safeStep = Math.max(1, step);
  for (let position = 0; position <= safeLength; position += safeStep) {
    ticks.push({
      position,
      major: Math.round(position / safeStep) % 4 === 0,
    });
  }
  return ticks;
}

function getRulerStep(gridSize: number): number {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return 40;
  return Math.max(40, Math.round(gridSize));
}

function AuthoredGuideLine({
  guide,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  guide: MotionGuide;
  onDragStart: (
    guide: MotionGuide,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}): JSX.Element {
  const isVertical = guide.orientation === "vertical";
  const color = guide.color ?? "var(--accent)";
  return (
    <span
      title={guide.locked ? "Locked guide" : "Drag guide"}
      className={`absolute z-40 opacity-70 transition-opacity hover:opacity-100 ${
        guide.locked
          ? "pointer-events-none"
          : isVertical
            ? "cursor-ew-resize"
            : "cursor-ns-resize"
      }`}
      onPointerDown={(event) => onDragStart(guide, event)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
      style={
        isVertical
          ? {
              left: guide.position,
              top: 0,
              width: 9,
              transform: "translateX(-4px)",
              height: "100%",
              background: `linear-gradient(to right, transparent 4px, ${color} 4px, ${color} 5px, transparent 5px)`,
              boxShadow: "0 0 0 1px transparent",
            }
          : {
              left: 0,
              top: guide.position,
              width: "100%",
              height: 9,
              transform: "translateY(-4px)",
              background: `linear-gradient(to bottom, transparent 4px, ${color} 4px, ${color} 5px, transparent 5px)`,
              boxShadow: "0 0 0 1px transparent",
            }
      }
    />
  );
}

function SnapGuideLine({ guide }: { guide: MotionSnapGuide }): JSX.Element {
  const isVertical = guide.axis === "x";
  return (
    <span
      className={`pointer-events-none absolute z-50 bg-accent ${
        guide.kind === "grid" ? "opacity-70" : "opacity-95"
      }`}
      style={
        isVertical
          ? {
              left: guide.position,
              top: 0,
              width: 1,
              height: "100%",
              boxShadow: "0 0 0 1px var(--accent-soft)",
            }
          : {
              left: 0,
              top: guide.position,
              width: "100%",
              height: 1,
              boxShadow: "0 0 0 1px var(--accent-soft)",
            }
      }
    />
  );
}

function StageLayerTree({
  composition,
  compositionLibrary,
  compositionStack,
  mediaItems,
  layer: sourceLayer,
  renderMode,
  soloLayerIds,
  selectedLayerId,
  selectedLayerIds,
  compositionTime,
  interactive,
  creationToolActive,
  onSelectLayer,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  composition: MotionComposition;
  compositionLibrary: readonly MotionComposition[];
  compositionStack: readonly string[];
  mediaItems: readonly MediaItem[];
  layer: MotionLayer;
  renderMode: StageLayerRenderMode;
  soloLayerIds: ReadonlySet<string>;
  selectedLayerId: string | null;
  selectedLayerIds: readonly string[];
  compositionTime: number;
  interactive: boolean;
  creationToolActive: boolean;
  onSelectLayer: (layerId: string, additive?: boolean) => void;
  onDragStart: (
    layer: MotionLayer,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}): JSX.Element | null {
  const layer = resolveMotionLayerVariableBindings(composition, sourceLayer);
  if (
    !layer.visible ||
    compositionTime < layer.startTime ||
    compositionTime > layer.startTime + layer.duration
  ) {
    return null;
  }
  if (!isMotionLayerTreeVisible(composition, layer, soloLayerIds)) {
    return null;
  }

  const localTime = compositionTime - layer.startTime;
  const transform = applyMotionCameraToTransform(
    composition,
    getMotionTransformAtTime(
      layer.transform,
      layer.keyframes,
      localTime,
      layer.expressions,
      layer.duration,
      layer.autoOrient,
      { composition, layer },
    ),
    compositionTime,
  );
  const selected =
    interactive &&
    (selectedLayerId === layer.id || selectedLayerIds.includes(layer.id));
  const evaluatedEffects = evaluateMotionEffectsAtTime(
    layer.effects,
    layer.keyframes,
    localTime,
    layer.expressions,
    layer.duration,
    composition,
    layer,
  );
  const effectFilter = buildMotionCssFilter(evaluatedEffects);
  const maskEvaluatedLayer = evaluateMotionLayerMasksAtTime(
    layer,
    localTime,
    composition,
  );
  const clipPath = buildMotionCssClipPath(maskEvaluatedLayer);
  const blendMode = buildMotionCssBlendMode(layer.blendMode);
  const isControllerLayer = layer.type === "group" || layer.type === "null";
  const isGuideLayer = isMotionGuideLayer(layer);
  const isHitTestOnly =
    renderMode === "hit-test" && !isGuideLayer && !isControllerLayer;
  const shouldShowLayerContent =
    isMotionLayerContentVisible(composition, layer, soloLayerIds) ||
    isGuideLayer ||
    isControllerLayer;
  const selectionShadow =
    selected && !isHitTestOnly ? "0 0 0 6px var(--accent-soft)" : undefined;
  const combinedShadow = selectionShadow;
  const children = getMotionLayerChildren(composition, layer.id);
  const rotationX = transform.rotation3d?.x ?? 0;
  const rotationY = transform.rotation3d?.y ?? 0;
  const perspective = Math.max(1, transform.perspective ?? 1000);
  const wrapperStyle: CSSProperties = {
    position: "absolute",
    left: transform.position.x,
    top: transform.position.y,
    transform: [
      `perspective(${perspective}px)`,
      `translateZ(${transform.position.z ?? 0}px)`,
      `rotateX(${rotationX}deg)`,
      `rotateY(${rotationY}deg)`,
      `rotateZ(${transform.rotation}deg)`,
      `scale(${transform.scale.x}, ${transform.scale.y})`,
    ].join(" "),
    transformStyle: transform.transformStyle ?? "flat",
    transformOrigin: "0 0",
    opacity: isControllerLayer && !isHitTestOnly ? transform.opacity : undefined,
  };
  const contentStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    opacity: isHitTestOnly
      ? 0
      : isControllerLayer
        ? undefined
        : transform.opacity,
    transform: `translate(${-transform.anchor.x * 100}%, ${-transform.anchor.y * 100}%)`,
    transformOrigin: `${transform.anchor.x * 100}% ${transform.anchor.y * 100}%`,
    transformStyle: transform.transformStyle ?? "flat",
    filter: isHitTestOnly ? undefined : effectFilter,
    clipPath,
    mixBlendMode: blendMode,
    outline:
      interactive && selected && !isHitTestOnly
        ? "2px solid var(--accent)"
        : "1px solid transparent",
    outlineOffset: interactive && selected && !isHitTestOnly ? 4 : 0,
    boxShadow: combinedShadow || undefined,
    cursor: layer.locked ? "not-allowed" : "pointer",
    pointerEvents: !interactive || layer.locked ? "none" : "auto",
  };
  const pointerHandlers = interactive
    ? {
        "data-motion-layer-id": layer.id,
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (creationToolActive) return;
          event.stopPropagation();
          onSelectLayer(layer.id, event.metaKey || event.ctrlKey || event.shiftKey);
          onDragStart(layer, event);
        },
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) =>
          onDragMove(event),
        onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) =>
          onDragEnd(event),
        onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
          onDragEnd(event),
      }
    : {};

  const childNodes = children.map((child) => (
    <StageLayerTree
      key={child.id}
      composition={composition}
      compositionLibrary={compositionLibrary}
      compositionStack={compositionStack}
      mediaItems={mediaItems}
      layer={child}
      renderMode={renderMode}
      soloLayerIds={soloLayerIds}
      selectedLayerId={selectedLayerId}
      selectedLayerIds={selectedLayerIds}
      compositionTime={compositionTime}
      interactive={interactive}
      creationToolActive={creationToolActive}
      onSelectLayer={onSelectLayer}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    />
  ));

  let content: JSX.Element | null = null;

  if (isControllerLayer) {
    const guideSize = layer.type === "null" ? (layer.guideSize ?? 48) : 16;
    const guideColor = layer.type === "null" ? (layer.guideColor ?? "#14b8a6") : "var(--accent)";
    content = (
      <div
        {...pointerHandlers}
        title={layer.name}
        style={{
          ...contentStyle,
          left: -guideSize / 2,
          top: -guideSize / 2,
          width: guideSize,
          height: guideSize,
          borderRadius: 999,
          background:
            layer.type === "null"
              ? "transparent"
              : selected
                ? "var(--accent)"
                : "var(--bg-2)",
          border: `1px solid ${guideColor}`,
          boxShadow: selected ? "0 0 0 6px var(--accent-soft)" : undefined,
        }}
      >
        <span
          className="absolute left-1/2 top-[-10px] h-[calc(100%+20px)] w-px -translate-x-1/2"
          style={{ backgroundColor: guideColor }}
        />
        <span
          className="absolute left-[-10px] top-1/2 h-px w-[calc(100%+20px)] -translate-y-1/2"
          style={{ backgroundColor: guideColor }}
        />
        {layer.type === "null" ? (
          <span
            className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ backgroundColor: selected ? guideColor : "transparent", border: `1px solid ${guideColor}` }}
          />
        ) : null}
      </div>
    );
  } else if (shouldShowLayerContent && layer.type === "text") {
    content = (
      <div
        {...pointerHandlers}
        style={{
          ...contentStyle,
          color: layer.style.color,
          fontFamily: layer.style.fontFamily,
          fontSize: layer.style.fontSize,
          fontWeight: layer.style.fontWeight ?? 700,
          lineHeight: layer.style.lineHeight ?? 1.1,
          letterSpacing: layer.style.letterSpacing,
          textAlign: layer.style.align ?? "center",
          whiteSpace: "pre",
        }}
      >
        {hasEnabledMotionTextAnimators(layer)
          ? renderStageTextAnimatorRuns(layer, localTime)
          : layer.text}
      </div>
    );
  } else if (shouldShowLayerContent && layer.type === "shape") {
    const trimPaths = getMotionTrimPathsModifier(layer);
    const repeater = getMotionRepeaterModifier(layer);
    const copies = getMotionRepeaterCopies(repeater);
    content = (
      <div
        {...pointerHandlers}
        style={{ ...contentStyle, width: layer.width, height: layer.height }}
      >
        {copies.map((copy) => (
          <div
            key={copy.index}
            style={{
              position: "absolute",
              left: copy.position.x,
              top: copy.position.y,
              opacity: copy.opacity,
              transform: [
                `rotate(${copy.rotation}deg)`,
                `scale(${copy.scale.x}, ${copy.scale.y})`,
              ].join(" "),
              transformOrigin: "0 0",
            }}
          >
            {renderStageShapeVisual(
              layer,
              trimPaths,
              localTime,
              copy.index,
              composition,
            )}
          </div>
        ))}
      </div>
    );
  } else if (shouldShowLayerContent && layer.type === "composition") {
    const nextStack = [...compositionStack, composition.id];
    const source = getMotionCompositionLayerSource(compositionLibrary, layer);
    const canRenderSource = source && !nextStack.includes(source.id);
    content = (
      <div
        {...pointerHandlers}
        className="overflow-hidden bg-black/20"
        style={{ ...contentStyle, width: layer.width, height: layer.height }}
      >
        {canRenderSource ? (
          <NestedCompositionPreview
            source={source}
            compositionLibrary={compositionLibrary}
            compositionStack={nextStack}
            mediaItems={mediaItems}
            localTime={getMotionCompositionLayerLocalTime(layer, localTime)}
            layerWidth={layer.width}
            layerHeight={layer.height}
            fit={layer.fit ?? "contain"}
            renderMode={renderMode}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center border border-dashed border-border bg-bg-2 text-[12px] font-medium text-fg-muted">
            Missing precomp
          </div>
        )}
      </div>
    );
  } else if (shouldShowLayerContent && layer.type === "adjustment") {
    content = (
      <div
        {...pointerHandlers}
        style={{
          ...contentStyle,
          width: layer.width,
          height: layer.height,
          filter: undefined,
          backdropFilter: effectFilter,
          WebkitBackdropFilter: effectFilter,
          background: "rgba(245, 158, 11, 0.08)",
          border:
            interactive && selected
              ? "1px solid var(--accent)"
              : "1px dashed rgba(245, 158, 11, 0.72)",
        }}
      />
    );
  } else if (shouldShowLayerContent && layer.type === "image") {
    const asset = composition.assets.find((candidate) => candidate.id === layer.assetId);
    content = (
      <StageImageLayerVisual
        asset={asset}
        layer={layer}
        mediaItems={mediaItems}
        pointerHandlers={pointerHandlers}
        contentStyle={contentStyle}
      />
    );
  } else if (shouldShowLayerContent && layer.type === "particle") {
    const size = Math.max(32, layer.emitter.size * 4);
    content = (
      <div
        {...pointerHandlers}
        style={{
          ...contentStyle,
          left: -size / 2,
          top: -size / 2,
          width: size,
          height: size,
          borderRadius: 999,
          border:
            interactive && selected
              ? "1px solid var(--accent)"
              : "1px dashed rgba(20, 184, 166, 0.72)",
          background:
            "radial-gradient(circle, rgba(20,184,166,0.35) 0 18%, rgba(20,184,166,0.08) 19% 52%, transparent 53%)",
        }}
      />
    );
  }

  return (
    <div style={wrapperStyle}>
      {content}
      {childNodes}
    </div>
  );
}

function NestedCompositionPreview({
  source,
  compositionLibrary,
  compositionStack,
  mediaItems,
  localTime,
  layerWidth,
  layerHeight,
  fit,
  renderMode,
}: {
  source: MotionComposition;
  compositionLibrary: readonly MotionComposition[];
  compositionStack: readonly string[];
  mediaItems: readonly MediaItem[];
  localTime: number;
  layerWidth: number;
  layerHeight: number;
  fit: "contain" | "cover" | "fill";
  renderMode: StageLayerRenderMode;
}): JSX.Element {
  const rootLayers = getMotionRootLayers(source);
  const soloLayerIds = getMotionSoloLayerIds(source);
  const rect = getNestedCompositionStageFit(
    source.width,
    source.height,
    layerWidth,
    layerHeight,
    fit,
  );
  const noopSelect = () => undefined;
  const noopDrag = () => undefined;

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: rect.left,
        top: rect.top,
        width: source.width,
        height: source.height,
        transform: `scale(${rect.scaleX}, ${rect.scaleY})`,
        transformOrigin: "0 0",
        background:
          source.backgroundColor === "transparent"
            ? "transparent"
            : source.backgroundColor,
      }}
    >
      {rootLayers.map((nestedLayer) => (
        <StageLayerTree
          key={nestedLayer.id}
          composition={source}
          compositionLibrary={compositionLibrary}
          compositionStack={compositionStack}
          mediaItems={mediaItems}
          layer={nestedLayer}
          renderMode={renderMode}
          soloLayerIds={soloLayerIds}
          selectedLayerId={null}
          selectedLayerIds={[]}
          compositionTime={localTime}
          interactive={false}
          creationToolActive={false}
          onSelectLayer={noopSelect}
          onDragStart={noopDrag}
          onDragMove={noopDrag}
          onDragEnd={noopDrag}
        />
      ))}
    </div>
  );
}

let explicitFillRequested = false;
const explicitFillListeners = new Set<() => void>();

function subscribeExplicitFill(listener: () => void): () => void {
  explicitFillListeners.add(listener);
  return () => {
    explicitFillListeners.delete(listener);
  };
}

function getExplicitFillRequested(): boolean {
  return explicitFillRequested;
}

function setExplicitFillRequested(next: boolean): void {
  if (explicitFillRequested === next) return;
  explicitFillRequested = next;
  for (const listener of explicitFillListeners) {
    listener();
  }
}

function RendererBackedStagePreview({
  composition,
  compositionLibrary,
  assetResolver,
  time,
  resolution,
  creationFallback,
  onVisibleFrameChange,
  isPlaying,
  getInteractionActive,
}: {
  composition: MotionComposition;
  compositionLibrary: readonly MotionComposition[];
  assetResolver: MotionRendererAssetResolver;
  time: number;
  resolution: MotionStagePreviewResolution;
  creationFallback: CreationStagePreviewFallback | null;
  onVisibleFrameChange?: (visible: boolean) => void;
  isPlaying: boolean;
  getInteractionActive: () => boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useMemo(() => new MotionRenderer(), []);
  useEffect(() => () => renderer.dispose(), [renderer]);
  const [renderError, setRenderError] = useState<string | null>(null);
  const hasReportedVisibleFrameRef = useRef(false);
  const inFlightRef = useRef(false);
  const pendingTimeRef = useRef<number | null>(null);
  const renderFnRef = useRef<((time: number) => void) | null>(null);
  const cacheRef = useRef<MotionFrameCache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = new MotionFrameCache();
  }
  const previewSizeRef = useRef<{ width: number; height: number } | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const renderQualityRef = useRef(getMotionStagePreviewRenderQuality(resolution));
  renderQualityRef.current = getMotionStagePreviewRenderQuality(resolution);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const getInteractionActiveRef = useRef(getInteractionActive);
  getInteractionActiveRef.current = getInteractionActive;
  const explicitFill = useSyncExternalStore(
    subscribeExplicitFill,
    getExplicitFillRequested,
    getExplicitFillRequested,
  );
  const explicitFillRef = useRef(explicitFill);
  explicitFillRef.current = explicitFill;
  const inputsRef = useRef({
    composition,
    compositionLibrary,
    assetResolver,
    creationFallback,
  });
  inputsRef.current = {
    composition,
    compositionLibrary,
    assetResolver,
    creationFallback,
  };

  const invalidationKeyRef = useRef<FrameCacheInvalidationKey | null>(null);

  const publishRanges = useCallback((): void => {
    const cache = cacheRef.current;
    if (!cache) return;
    setFrameCacheState({ ranges: cache.cachedRanges() });
  }, []);

  useEffect(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    const previewSize = getMotionStagePreviewCanvasSize(
      composition.width,
      composition.height,
      resolution,
    );
    const nextKey: FrameCacheInvalidationKey = {
      id: composition.id,
      modifiedAt: composition.modifiedAt,
      width: previewSize.width,
      height: previewSize.height,
      quality: resolution,
    };
    const prevKey = invalidationKeyRef.current;
    if (prevKey === null || shouldInvalidateFrameCache(prevKey, nextKey)) {
      invalidationKeyRef.current = nextKey;
      cache.invalidateAll();
      hasReportedVisibleFrameRef.current = false;
      setFrameCacheState({ ranges: [], filling: false });
      if (prevKey !== null) {
        setExplicitFillRequested(false);
      }
    }
  }, [
    composition.id,
    composition.modifiedAt,
    composition.width,
    composition.height,
    resolution,
  ]);

  useEffect(() => {
    return () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;
      setExplicitFillRequested(false);
      setFrameCacheState({ ranges: [], filling: false });
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const previewSize = getMotionStagePreviewCanvasSize(
      composition.width,
      composition.height,
      resolution,
    );
    canvas.width = previewSize.width;
    canvas.height = previewSize.height;
    previewSizeRef.current = previewSize;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      setRenderError("Canvas unavailable");
      return;
    }
    ctxRef.current = ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = resolution === "full" ? "high" : "medium";

    const drawBitmap = (bitmap: ImageBitmap): void => {
      ctx.clearRect(0, 0, previewSize.width, previewSize.height);
      ctx.drawImage(bitmap, 0, 0, previewSize.width, previewSize.height);
    };

    const renderAt = (rawTime: number): void => {
      if (disposed) return;
      const cache = cacheRef.current;
      const {
        composition: comp,
        compositionLibrary: lib,
        assetResolver: ar,
        creationFallback: fallback,
      } = inputsRef.current;
      const safeTime = Math.min(comp.duration, Math.max(0, rawTime));

      if (cache) {
        const resolved = resolvePreviewFrame(cache, safeTime, comp.frameRate);
        if (resolved.cached) {
          const cached = cache.getFrame(resolved.index);
          if (cached) {
            drawBitmap(cached);
            const foregroundIsLoadBearing =
              fallback !== null || !hasReportedVisibleFrameRef.current;
            if (foregroundIsLoadBearing) {
              const cachedForeground = readCanvasForeground(ctx, {
                width: previewSize.width,
                height: previewSize.height,
                background: comp.backgroundColor,
              });
              if (cachedForeground === true) {
                hasReportedVisibleFrameRef.current = true;
              }
              onVisibleFrameChange?.(cachedForeground === true);
              if (fallback && cachedForeground !== true) {
                drawCreationPreviewFallback(ctx, fallback, {
                  width: previewSize.width,
                  height: previewSize.height,
                  background: comp.backgroundColor,
                  timeSeconds: safeTime,
                });
              }
            }
            const next = pendingTimeRef.current;
            pendingTimeRef.current = null;
            if (next !== null) renderAt(next);
            return;
          }
        }
      }

      if (inFlightRef.current) {
        pendingTimeRef.current = rawTime;
        return;
      }
      inFlightRef.current = true;
      setRenderError(null);
      const drawCreationFallback = (timeSeconds: number): boolean =>
        drawCreationPreviewFallback(ctx, fallback, {
          width: previewSize.width,
          height: previewSize.height,
          background: comp.backgroundColor,
          timeSeconds,
        });
      void renderer
        .renderComposition(comp, safeTime, {
          compositionLibrary: lib,
          assetResolver: ar,
          quality: renderQualityRef.current,
        })
        .then((bitmap) => {
          inFlightRef.current = false;
          if (disposed) {
            bitmap.close();
            return;
          }
          const activeCache = cacheRef.current;
          const frameIndex = Math.floor(safeTime * comp.frameRate);
          if (activeCache) {
            drawAndMaybeCache(activeCache, frameIndex, bitmap, drawBitmap);
            publishRanges();
          } else {
            drawBitmap(bitmap);
            bitmap.close();
          }
          const rendererHasForeground = readCanvasForeground(ctx, {
            width: previewSize.width,
            height: previewSize.height,
            background: comp.backgroundColor,
          });
          if (rendererHasForeground === true) {
            hasReportedVisibleFrameRef.current = true;
            onVisibleFrameChange?.(true);
          } else {
            onVisibleFrameChange?.(false);
          }
          if (fallback && rendererHasForeground !== true) {
            drawCreationFallback(safeTime);
          }
          const next = pendingTimeRef.current;
          pendingTimeRef.current = null;
          if (next !== null) renderAt(next);
        })
        .catch((error: unknown) => {
          inFlightRef.current = false;
          if (disposed) return;
          onVisibleFrameChange?.(false);
          if (drawCreationFallback(safeTime)) {
            const next = pendingTimeRef.current;
            pendingTimeRef.current = null;
            if (next !== null) renderAt(next);
            return;
          }
          setRenderError(
            error instanceof Error ? error.message : "Renderer preview failed",
          );
        });
    };
    renderFnRef.current = renderAt;
    renderAt(time);

    return () => {
      disposed = true;
      renderFnRef.current = null;
    };
  }, [composition, onVisibleFrameChange, resolution, renderer, publishRanges]);

  useEffect(() => {
    renderFnRef.current?.(time);
  }, [time, compositionLibrary, assetResolver, creationFallback]);

  useEffect(() => {
    if (isPlaying && !explicitFill) return;
    let rafId: number | null = null;
    let stopped = false;

    const finishFill = (): void => {
      setFrameCacheState({ filling: false });
      if (explicitFillRef.current) {
        setExplicitFillRequested(false);
      }
    };

    const step = (): void => {
      rafId = null;
      if (stopped) return;
      const cache = cacheRef.current;
      const ctx = ctxRef.current;
      const previewSize = previewSizeRef.current;
      if (!cache || !ctx || !previewSize) return;
      const forced = explicitFillRef.current;
      if (!forced && (isPlayingRef.current || getInteractionActiveRef.current())) {
        return;
      }
      const {
        composition: comp,
        compositionLibrary: lib,
        assetResolver: ar,
      } = inputsRef.current;
      if (inFlightRef.current) {
        rafId = requestAnimationFrame(step);
        return;
      }
      const frameCount = Math.max(1, Math.floor(comp.duration * comp.frameRate) + 1);
      const startFrame = Math.min(
        frameCount - 1,
        Math.max(0, Math.floor(Math.min(comp.duration, Math.max(0, time)) * comp.frameRate)),
      );
      let target: number | null = null;
      for (let offset = 0; offset < frameCount; offset += 1) {
        const candidate = (startFrame + offset) % frameCount;
        if (!cache.has(candidate)) {
          target = candidate;
          break;
        }
      }
      if (target === null) {
        finishFill();
        return;
      }
      const targetFrame = target;
      const framesBefore = cache.frameCount;
      const frameTime = Math.min(comp.duration, targetFrame / comp.frameRate);
      inFlightRef.current = true;
      setFrameCacheState({ filling: true });
      void renderer
        .renderComposition(comp, frameTime, {
          compositionLibrary: lib,
          assetResolver: ar,
          quality: renderQualityRef.current,
        })
        .then((bitmap) => {
          inFlightRef.current = false;
          if (stopped || !cacheRef.current) {
            bitmap.close();
            return;
          }
          if (cacheRef.current.has(targetFrame)) {
            bitmap.close();
          } else {
            cacheRef.current.setFrame(targetFrame, bitmap);
          }
          publishRanges();
          if (cacheRef.current.frameCount <= framesBefore) {
            finishFill();
            return;
          }
          if (stopped) {
            return;
          }
          if (
            !explicitFillRef.current &&
            (isPlayingRef.current || getInteractionActiveRef.current())
          ) {
            setFrameCacheState({ filling: false });
            return;
          }
          rafId = requestAnimationFrame(step);
        })
        .catch(() => {
          inFlightRef.current = false;
          setFrameCacheState({ filling: false });
        });
    };

    rafId = requestAnimationFrame(step);
    return () => {
      stopped = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      setFrameCacheState({ filling: false });
    };
  }, [isPlaying, explicitFill, composition, resolution, renderer, publishRanges, time]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {renderError ? (
        <div className="pointer-events-none absolute right-3 top-3 z-[2] max-w-[260px] rounded-md border border-status-warning/40 bg-bg-elev/95 px-2.5 py-2 text-[11px] font-medium leading-snug text-status-warning shadow-lg">
          Preview render failed: {renderError}
        </div>
      ) : null}
    </>
  );
}

function CreationCpuStagePreview({
  fallback,
  width,
  height,
  resolution,
  background,
  time,
  isPlaying,
}: {
  fallback: CreationStagePreviewFallback;
  width: number;
  height: number;
  resolution: MotionStagePreviewResolution;
  background: string;
  time: number;
  isPlaying: boolean;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const previewSize = getMotionStagePreviewCanvasSize(width, height, resolution);
    canvas.width = previewSize.width;
    canvas.height = previewSize.height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, previewSize.width, previewSize.height);
    drawCreationPreviewFallback(ctx, fallback, {
      width: previewSize.width,
      height: previewSize.height,
      background,
      timeSeconds: time,
    });

    const disposePreviewSession = isPlaying
      ? null
      : startNativeAuroraStagePreviewSession({
          fallback,
          width: previewSize.width,
          height: previewSize.height,
          background,
          timeSeconds: time,
          onEvent: (event) => {
            if (event.kind !== "update") return;
            const image = new Image();
            image.decoding = "async";
            image.onload = () => {
              if (canvasRef.current !== canvas) return;
              ctx.clearRect(0, 0, previewSize.width, previewSize.height);
              ctx.drawImage(image, 0, 0, previewSize.width, previewSize.height);
            };
            image.src = event.result.dataUri;
          },
        });

    return () => {
      disposePreviewSession?.();
    };
  }, [background, fallback, height, isPlaying, resolution, time, width]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
    />
  );
}

function drawCreationPreviewFallback(
  ctx: CanvasRenderingContext2D,
  fallback: CreationStagePreviewFallback | null,
  options: {
    readonly width: number;
    readonly height: number;
    readonly background: string;
    readonly timeSeconds?: number;
  },
): boolean {
  if (!fallback) return false;
  const image = renderCreationStagePreviewFallbackImage({
    fallback,
    width: options.width,
    height: options.height,
    background: options.background,
    timeSeconds: options.timeSeconds,
  });
  if (!image || image.coveredPixels <= 0) return false;
  const imageData = ctx.createImageData(image.width, image.height);
  imageData.data.set(image.rgba);
  ctx.putImageData(imageData, 0, 0);
  return true;
}

function readCanvasForeground(
  ctx: CanvasRenderingContext2D,
  options: { readonly width: number; readonly height: number; readonly background: string },
): boolean | null {
  try {
    const data = ctx.getImageData(0, 0, options.width, options.height);
    return previewPixelsHaveForeground({
      rgba: data.data,
      width: options.width,
      height: options.height,
      background: options.background,
    });
  } catch {
    return null;
  }
}


function StageImageLayerVisual({
  asset,
  layer,
  mediaItems,
  pointerHandlers,
  contentStyle,
}: {
  asset: MotionAsset | undefined;
  layer: Extract<MotionLayer, { type: "image" }>;
  mediaItems: readonly MediaItem[];
  pointerHandlers: Partial<HTMLAttributes<HTMLDivElement>>;
  contentStyle: CSSProperties;
}): JSX.Element {
  const sourceUrl = useMotionAssetPreviewUrl(asset, mediaItems);
  const mediaItem = asset?.mediaId
    ? mediaItems.find((item) => item.id === asset.mediaId)
    : undefined;
  const width = layer.width ?? asset?.width ?? mediaItem?.metadata.width ?? 320;
  const height = layer.height ?? asset?.height ?? mediaItem?.metadata.height ?? 180;

  return (
    <div
      {...pointerHandlers}
      className="flex items-center justify-center overflow-hidden bg-white/10"
      style={{ ...contentStyle, width, height }}
    >
      {sourceUrl ? (
        <img
          src={sourceUrl}
          alt={asset?.name ?? layer.name}
          draggable={false}
          className="h-full w-full"
          style={{ objectFit: layer.fit ?? "contain" }}
        />
      ) : (
        <span className="px-3 text-center text-[12px] font-semibold text-white/50">
          Missing image
        </span>
      )}
    </div>
  );
}

function useMotionAssetPreviewUrl(
  asset: MotionAsset | undefined,
  mediaItems: readonly MediaItem[],
): string | null {
  const [url, setUrl] = useState<string | null>(asset?.url ?? null);

  useEffect(() => {
    if (!asset) {
      setUrl(null);
      return undefined;
    }

    if (asset.url) {
      setUrl(asset.url);
      return undefined;
    }

    const mediaItem = asset.mediaId
      ? mediaItems.find((item) => item.id === asset.mediaId)
      : undefined;
    if (mediaItem?.blob) {
      const objectUrl = URL.createObjectURL(mediaItem.blob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    setUrl(mediaItem?.thumbnailUrl ?? null);
    return undefined;
  }, [asset, mediaItems]);

  return url;
}

function renderStageShapeVisual(
  layer: Extract<MotionLayer, { type: "shape" }>,
  trimPaths: ReturnType<typeof getMotionTrimPathsModifier>,
  localTime = 0,
  instanceIndex = 0,
  composition?: MotionComposition,
): JSX.Element {
  const evaluatedLayer = evaluateMotionPuppetPinsAtTime(
    evaluateMotionShapeModifiersAtTime(
      evaluateMotionShapeLayerStyleAtTime(layer, localTime, composition),
      localTime,
      composition,
    ),
    localTime,
  );
  const usesPuppetPins =
    evaluatedLayer.puppetPins?.some(
      (pin) => pin.enabled && pin.radius > 0 && pin.strength > 0,
    ) ?? false;
  const usesZigZag =
    evaluatedLayer.modifiers?.some(
      (modifier) => modifier.type === "zig-zag" && modifier.enabled,
    ) ?? false;
  const roundCorners = getMotionRoundCornersModifier(evaluatedLayer);
  const usesRoundCorners = Boolean(
    roundCorners?.enabled && roundCorners.radius > 0,
  );
  const wigglePaths = getMotionWigglePathsModifier(evaluatedLayer);
  const usesWigglePaths = Boolean(wigglePaths?.enabled && wigglePaths.size > 0);
  const usesSvgVisual =
    usesPuppetPins ||
    usesZigZag ||
    usesRoundCorners ||
    usesWigglePaths ||
    Boolean(trimPaths?.enabled) ||
    hasAdvancedMotionShapeStyle(evaluatedLayer.style) ||
    evaluatedLayer.shapeType === "path" ||
    evaluatedLayer.shapeType === "triangle" ||
    evaluatedLayer.shapeType === "star" ||
    evaluatedLayer.shapeType === "line" ||
    evaluatedLayer.shapeType === "polygon";

  if (trimPaths?.enabled) {
    const pathData = buildMotionSvgPathData(
      getTrimmedMotionPathPoints(
        buildMotionShapePolyline(evaluatedLayer, 96, localTime),
        trimPaths,
      ),
    );
    const stroke = normalizeMotionStroke(evaluatedLayer.style.stroke);
    return (
      <svg
        className="block h-full w-full overflow-visible"
        viewBox={`${-evaluatedLayer.width / 2} ${-evaluatedLayer.height / 2} ${evaluatedLayer.width} ${evaluatedLayer.height}`}
        role="img"
        aria-label={`${evaluatedLayer.name} trim path`}
        style={{ width: evaluatedLayer.width, height: evaluatedLayer.height }}
      >
        <path
          d={pathData}
          fill="none"
          stroke={stroke.color}
          strokeWidth={Math.max(1, stroke.width)}
          strokeLinecap={stroke.lineCap}
          strokeLinejoin={stroke.lineJoin}
          strokeDasharray={stroke.dashArray.join(" ") || undefined}
          strokeDashoffset={stroke.dashOffset}
          strokeOpacity={stroke.opacity}
        />
      </svg>
    );
  }

  if (usesSvgVisual) {
    const gradientId = `motion-gradient-${sanitizeSvgId(evaluatedLayer.id)}-${instanceIndex}`;
    const fill = getStageSvgFill(evaluatedLayer, gradientId);
    const stroke = normalizeMotionStroke(evaluatedLayer.style.stroke);
    return (
      <svg
        className="block h-full w-full overflow-visible"
        viewBox={`${-evaluatedLayer.width / 2} ${-evaluatedLayer.height / 2} ${evaluatedLayer.width} ${evaluatedLayer.height}`}
        role="img"
        aria-label={evaluatedLayer.name}
        style={{ width: evaluatedLayer.width, height: evaluatedLayer.height }}
      >
        {renderStageGradientDefs(evaluatedLayer, gradientId)}
        {renderStageShapeSvgElement(evaluatedLayer, {
          fill: evaluatedLayer.pathClosed ?? true ? fill : "none",
          stroke,
          localTime,
        })}
      </svg>
    );
  }

  const isCircle =
    evaluatedLayer.shapeType === "circle" || evaluatedLayer.shapeType === "ellipse";
  const fill =
    evaluatedLayer.style.fill.type === "solid" && evaluatedLayer.style.fill.color
      ? evaluatedLayer.style.fill.color
      : "transparent";

  return (
    <div
      style={{
        width: evaluatedLayer.width,
        height: evaluatedLayer.height,
        background: withCssOpacity(fill, evaluatedLayer.style.fill.opacity),
        border:
          evaluatedLayer.style.stroke.width > 0
            ? `${evaluatedLayer.style.stroke.width}px solid ${withCssOpacity(
                evaluatedLayer.style.stroke.color,
                evaluatedLayer.style.stroke.opacity,
              )}`
            : undefined,
        borderRadius: isCircle ? "999px" : evaluatedLayer.style.cornerRadius ?? 0,
      }}
    />
  );
}

function renderStageShapeSvgElement(
  layer: Extract<MotionLayer, { type: "shape" }>,
  options: {
    readonly fill: string;
    readonly stroke: ReturnType<typeof normalizeMotionStroke>;
    readonly localTime: number;
  },
): JSX.Element {
  const strokeProps = {
    stroke: options.stroke.color,
    strokeWidth: options.stroke.width,
    strokeLinecap: options.stroke.lineCap,
    strokeLinejoin: options.stroke.lineJoin,
    strokeDasharray: options.stroke.dashArray.join(" ") || undefined,
    strokeDashoffset: options.stroke.dashOffset,
    strokeOpacity: options.stroke.opacity,
  };
  const commonProps = {
    fill: layer.style.fill.type === "none" ? "none" : options.fill,
    fillOpacity: layer.style.fill.opacity,
    ...strokeProps,
  };
  const roundCorners = getMotionRoundCornersModifier(layer);
  const wigglePaths = getMotionWigglePathsModifier(layer);

  if (
    layer.puppetPins?.some(
      (pin) => pin.enabled && pin.radius > 0 && pin.strength > 0,
    ) ||
    layer.modifiers?.some(
      (modifier) => modifier.type === "zig-zag" && modifier.enabled,
    ) ||
    Boolean(roundCorners?.enabled && roundCorners.radius > 0) ||
    Boolean(wigglePaths?.enabled && wigglePaths.size > 0)
  ) {
    return (
      <path
        d={buildMotionSvgPathData(
          buildMotionShapePolyline(layer, 96, options.localTime),
        )}
        {...commonProps}
      />
    );
  }

  if (layer.shapeType === "circle" || layer.shapeType === "ellipse") {
    return (
      <ellipse
        cx={0}
        cy={0}
        rx={layer.width / 2}
        ry={layer.height / 2}
        {...commonProps}
      />
    );
  }

  if (layer.shapeType === "rectangle") {
    const radius = layer.style.cornerRadius ?? 0;
    return (
      <rect
        x={-layer.width / 2}
        y={-layer.height / 2}
        width={layer.width}
        height={layer.height}
        rx={radius}
        ry={radius}
        {...commonProps}
      />
    );
  }

  return (
    <path
      d={buildMotionSvgPathData(
        buildMotionShapePolyline(layer, 96, options.localTime),
      )}
      {...commonProps}
    />
  );
}

function renderStageGradientDefs(
  layer: Extract<MotionLayer, { type: "shape" }>,
  gradientId: string,
): JSX.Element | null {
  const fill = layer.style.fill;
  if (fill.type !== "gradient" || !fill.gradient) return null;
  const stops = normalizeMotionGradientStops(fill.gradient.stops);

  if (fill.gradient.type === "radial") {
    const spec = getMotionRadialGradientSpec(layer.width, layer.height);
    return (
      <defs>
        <radialGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          cx={spec.x1}
          cy={spec.y1}
          r={spec.r1}
          fx={spec.x0}
          fy={spec.y0}
        >
          {stops.map((stop) => (
            <stop
              key={`${stop.offset}-${stop.color}`}
              offset={`${stop.offset * 100}%`}
              stopColor={stop.color}
            />
          ))}
        </radialGradient>
      </defs>
    );
  }

  const line = getMotionLinearGradientLine(
    layer.width,
    layer.height,
    fill.gradient.angle ?? 0,
  );
  return (
    <defs>
      <linearGradient
        id={gradientId}
        gradientUnits="userSpaceOnUse"
        x1={line.x0}
        y1={line.y0}
        x2={line.x1}
        y2={line.y1}
      >
        {stops.map((stop) => (
          <stop
            key={`${stop.offset}-${stop.color}`}
            offset={`${stop.offset * 100}%`}
            stopColor={stop.color}
          />
        ))}
      </linearGradient>
    </defs>
  );
}

function getStageSvgFill(
  layer: Extract<MotionLayer, { type: "shape" }>,
  gradientId: string,
): string {
  const fill = layer.style.fill;
  if (fill.type === "none") return "none";
  if (fill.type === "gradient" && fill.gradient) return `url(#${gradientId})`;
  return fill.color ?? "#ffffff";
}

function sanitizeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function withCssOpacity(color: string, opacity: number): string {
  const alpha = Math.min(1, Math.max(0, opacity));
  if (alpha >= 1 || color === "transparent") return color;

  const hex = color.replace("#", "").trim();
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    const [r, g, b] = hex.split("").map((part) => parseInt(part + part, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function getNestedCompositionStageFit(
  sourceWidth: number,
  sourceHeight: number,
  layerWidth: number,
  layerHeight: number,
  fit: "contain" | "cover" | "fill",
): { left: number; top: number; scaleX: number; scaleY: number } {
  if (fit === "fill") {
    return {
      left: 0,
      top: 0,
      scaleX: layerWidth / sourceWidth,
      scaleY: layerHeight / sourceHeight,
    };
  }

  const scale =
    fit === "cover"
      ? Math.max(layerWidth / sourceWidth, layerHeight / sourceHeight)
      : Math.min(layerWidth / sourceWidth, layerHeight / sourceHeight);
  return {
    left: (layerWidth - sourceWidth * scale) / 2,
    top: (layerHeight - sourceHeight * scale) / 2,
    scaleX: scale,
    scaleY: scale,
  };
}

function renderStageTextAnimatorRuns(
  layer: Extract<MotionLayer, { type: "text" }>,
  localTime: number,
): JSX.Element[] {
  return getMotionTextAnimatorRuns(layer, localTime).map((run) =>
    run.character === "\n" ? (
      <br key={run.characterIndex} />
    ) : (
      <span
        key={run.characterIndex}
        className="inline-block whitespace-pre"
        style={{
          opacity: run.opacity,
          transform: [
            `translate(${run.position.x}px, ${run.position.y}px)`,
            `rotate(${run.rotation}deg)`,
            `scale(${run.scale.x}, ${run.scale.y})`,
          ].join(" "),
          transformOrigin: "50% 50%",
          willChange: "transform, opacity",
        }}
      >
        {run.character === " " ? "\u00a0" : run.character}
      </span>
    ),
  );
}
