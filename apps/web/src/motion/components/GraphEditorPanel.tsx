import type { JSX } from "react";
import {
  Activity,
  Camera,
  ClipboardPaste,
  Copy,
  Diamond,
  ListTree,
  Plus,
  Trash2,
} from "@/icons/lucide-compat";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  EASING_CATEGORIES,
  EASING_FUNCTIONS,
  MOTION_EXPRESSION_PRESETS,
  MOTION_ANIMATABLE_PROPERTIES,
  MOTION_CAMERA_PROPERTY_DESCRIPTORS,
  MOTION_LIGHT_PROPERTY_DESCRIPTORS,
  addMotionLayerExpression,
  copyMotionPropertyKeyframes,
  createMotionExpression,
  duplicateMotionPropertyKeyframes,
  getMotionCameraAtTime,
  getMotionCameraPropertyDescriptor,
  getMotionCameraPropertyKeyframes,
  getMotionCameraPropertyValue,
  getMotionLightAtTime,
  getMotionLightPropertyDescriptor,
  getMotionLightPropertyKeyframes,
  getMotionLightPropertyValue,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValue,
  getMotionLayerPropertyValueAtTime,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerMaskPropertyDescriptors,
  getMotionLayerPuppetPropertyDescriptors,
  getMotionLayerShapeModifierPropertyDescriptors,
  getMotionLayerContentsPropertyDescriptors,
  getMotionLayerShaderFillPropertyDescriptors,
  getMotionLayerExpression,
  getMotionExpressionError,
  getMotionPropertyDescriptor,
  isMotionAnimatableProperty,
  isMotionCameraProperty,
  isMotionLightProperty,
  normalizeMotionCamera,
  normalizeMotionLights,
  parseMotionMaskPathKeyframeProperty,
  pasteMotionPropertyKeyframes,
  redistributeRovingKeyframeTimes,
  removeMotionCameraKeyframe,
  removeMotionCameraPropertyKeyframes,
  removeMotionLightKeyframe,
  removeMotionLightPropertyKeyframes,
  removeMotionLayerKeyframe,
  removeMotionLayerExpression,
  removeMotionLayerPropertyKeyframes,
  reverseMotionPropertyKeyframes,
  scaleMotionPropertyKeyframeTimes,
  setMotionKeyframeRoving,
  setMotionLayerPropertyValue,
  setMotionCameraPropertyValue,
  setMotionLightPropertyValue,
  sortMotionKeyframes,
  toggleMotionLayerExpression,
  updateMotionLayerExpression,
  upsertMotionLayerKeyframe,
  upsertMotionCameraKeyframe,
  upsertMotionLightKeyframe,
  type EasingType,
  type Keyframe,
  type MotionAnimatablePropertyDescriptor,
  type MotionCamera,
  type MotionCameraProperty,
  type MotionAnimatableProperty,
  type MotionComposition,
  type MotionExpression,
  type MotionExpressionType,
  type MotionKeyframeClipboard,
  type MotionLight,
  type MotionLightProperty,
  type MotionLayer,
} from "@openreel/core";
import { ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  graphPointToNormalizedHandle,
  isFlatSegment,
  normalizedHandleToGraphPoint,
  sampleSegmentSpeed,
  seedBezierHandlesFromEasing,
  type BezierHandlePair,
  type GraphSegmentFrame,
  type SpeedSample,
} from "../graph-editor-curves";
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  SegmentedControl,
  SelectInput,
  SwitchInput,
} from "./primitives";

interface GraphEditorPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 148;
const GRAPH_PADDING = 18;
const EASING_OPTIONS = EASING_CATEGORIES.flatMap((category) =>
  category.easings.map((easing) => ({
    value: easing,
    label: `${category.name} · ${formatEasingName(easing)}`,
  })),
);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function capturePointer(event: ReactPointerEvent<SVGElement>): void {
  const target = event.currentTarget;
  if (typeof target.setPointerCapture === "function") {
    target.setPointerCapture(event.pointerId);
  }
}

export function getGraphEditorAvailableProperties(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return [
    ...MOTION_ANIMATABLE_PROPERTIES.filter(
      (item) =>
        item.group === "Transform" ||
        (item.group === "Shape" && layer.type === "shape") ||
        (item.group === "Precomp" && layer.type === "composition") ||
        (item.group === "Particles" && layer.type === "particle"),
    ),
    ...getMotionLayerEffectPropertyDescriptors(layer),
    ...getMotionLayerMaskPropertyDescriptors(layer).filter(
      (descriptor) =>
        parseMotionMaskPathKeyframeProperty(descriptor.property) === null,
    ),
    ...getMotionLayerPuppetPropertyDescriptors(layer),
    ...getMotionLayerShapeModifierPropertyDescriptors(layer),
    ...getMotionLayerContentsPropertyDescriptors(layer),
    ...getMotionLayerShaderFillPropertyDescriptors(layer),
  ];
}

function escapeExpressionString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildLayerReferenceExpression(
  referenceLayer: MotionLayer,
  ownLayer: MotionLayer,
  propertyId: string,
): string {
  if (referenceLayer.id === ownLayer.id) {
    return `thisLayer.value("${escapeExpressionString(propertyId)}")`;
  }
  return `thisComp.layer("${escapeExpressionString(
    referenceLayer.name,
  )}").value("${escapeExpressionString(propertyId)}")`;
}

function prettyPropertyLabel(label: string): string {
  if (!label.includes(".")) return label;
  return label
    .split(".")
    .slice(-2)
    .join(" ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const EXPRESSION_TYPES_WITH_AMPLITUDE = new Set<MotionExpressionType>([
  "sine",
  "wiggle",
  "drift",
  "spring",
  "random",
]);

const EXPRESSION_TYPES_WITH_FREQUENCY = new Set<MotionExpressionType>([
  "sine",
  "wiggle",
  "drift",
  "spring",
  "random",
  "posterize",
]);

const EXPRESSION_TYPES_WITH_PHASE = new Set<MotionExpressionType>([
  "sine",
  "spring",
  "random",
]);

const EXPRESSION_TYPES_WITH_SEED = new Set<MotionExpressionType>([
  "wiggle",
  "random",
]);

interface GraphPoint {
  readonly id: string;
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly roving: boolean;
}

type GraphMode = "value" | "speed";

const SPEED_SAMPLES_PER_SEGMENT = 24;

interface SpeedGraphModel {
  readonly path: string;
  readonly zeroY: number;
  readonly points: GraphPoint[];
}

function buildSpeedGraphModel(
  segments: readonly NumericSegment[],
  duration: number,
): SpeedGraphModel | null {
  if (segments.length === 0) return null;
  const safeDuration = Math.max(duration, 0.001);
  const graphWidth = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const graphHeight = GRAPH_HEIGHT - GRAPH_PADDING * 2;
  const samples: Array<SpeedSample & { readonly x: number }> = [];
  for (const segment of segments) {
    const segmentSamples = sampleSegmentSpeed(
      {
        t0: segment.from.time,
        t1: segment.to.time,
        v0: segment.from.value,
        v1: segment.to.value,
        easing: segment.from.easing,
        bezierHandles: segment.from.bezierHandles,
      },
      SPEED_SAMPLES_PER_SEGMENT,
    );
    for (const sample of segmentSamples) {
      samples.push({
        time: sample.time,
        speed: sample.speed,
        x:
          GRAPH_PADDING +
          (clamp(sample.time, 0, safeDuration) / safeDuration) * graphWidth,
      });
    }
  }
  if (samples.length === 0) return null;
  const speeds = samples.map((sample) => sample.speed).concat(0);
  const rawMin = Math.min(...speeds);
  const rawMax = Math.max(...speeds);
  const span = Math.max(rawMax - rawMin, 1e-6);
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;
  const range = Math.max(max - min, 1e-6);
  const speedToY = (speed: number) =>
    GRAPH_PADDING + (1 - (speed - min) / range) * graphHeight;
  const path = samples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"} ${roundGraphCoordinate(
          sample.x,
        )} ${roundGraphCoordinate(speedToY(sample.speed))}`,
    )
    .join(" ");
  const points = segments
    .map((segment) => segment.to)
    .concat(segments[0]!.from)
    .reduce<GraphPoint[]>((accumulator, keyframe) => {
      if (accumulator.some((existing) => existing.id === keyframe.id)) {
        return accumulator;
      }
      const speedAt =
        samples.reduce<SpeedSample & { readonly x: number }>(
          (closest, sample) =>
            Math.abs(sample.time - keyframe.time) <
            Math.abs(closest.time - keyframe.time)
              ? sample
              : closest,
          samples[0]!,
        ).speed;
      accumulator.push({
        id: keyframe.id,
        time: keyframe.time,
        x:
          GRAPH_PADDING +
          (clamp(keyframe.time, 0, safeDuration) / safeDuration) * graphWidth,
        y: speedToY(speedAt),
        roving: keyframe.roving === true,
      });
      return accumulator;
    }, []);
  return { path, zeroY: speedToY(0), points };
}

export function GraphEditorPanel({
  composition,
  embedded = false,
}: GraphEditorPanelProps): JSX.Element | null {
  const [keyframeClipboard, setKeyframeClipboard] =
    useState<MotionKeyframeClipboard | null>(null);
  const [referenceLayerId, setReferenceLayerId] = useState<string>("");
  const [referenceProperty, setReferenceProperty] = useState<string>("");
  const [graphMode, setGraphMode] = useState<GraphMode>("value");
  const svgRef = useRef<SVGSVGElement>(null);
  const keyframeDragRef = useRef<{
    readonly pointerId: number;
    readonly keyframeId: string;
  } | null>(null);
  const pendingLayerRef = useRef<MotionLayer | null>(null);
  const handleDragRef = useRef<{
    readonly pointerId: number;
    readonly keyframeId: string;
    readonly grip: "in" | "out";
  } | null>(null);
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLightId = useMotionStore((state) => state.selectedLightId);
  const selectedProperty = useMotionStore((state) => state.selectedProperty);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const playhead = useMotionStore((state) => state.playhead);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const updateMotionCompositionPreview = useProjectStore(
    (state) => state.updateMotionCompositionPreview,
  );
  const commitMotionCompositionGesture = useProjectStore(
    (state) => state.commitMotionCompositionGesture,
  );
  const gestureStartRef = useRef<MotionComposition | null>(null);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const lights = normalizeMotionLights(composition);
  const selectedLight =
    selectedLightId && !selectedLayer
      ? lights.find((light) => light.id === selectedLightId) ?? null
      : null;
  const selectedCameraProperty =
    selectedProperty && isMotionCameraProperty(selectedProperty)
      ? selectedProperty
      : null;

  const replaceLayer = (nextLayer: MotionLayer) => {
    const nextLayers = composition.layers.map((layer) =>
      layer.id === nextLayer.id ? nextLayer : layer,
    );
    void upsertMotionComposition({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    });
  };

  const compositionWithLayer = (nextLayer: MotionLayer): MotionComposition => ({
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === nextLayer.id ? nextLayer : layer,
    ),
    modifiedAt: Date.now(),
  });

  const beginLayerGesture = () => {
    if (gestureStartRef.current === null) {
      gestureStartRef.current = composition;
    }
  };

  const flushActiveGesture = useCallback(() => {
    const hasDrag =
      keyframeDragRef.current !== null || handleDragRef.current !== null;
    if (!hasDrag) return;
    keyframeDragRef.current = null;
    handleDragRef.current = null;
    const pending = pendingLayerRef.current;
    pendingLayerRef.current = null;
    const gestureStart = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!gestureStart) return;
    const finalComposition = pending
      ? {
          ...composition,
          layers: composition.layers.map((layer) =>
            layer.id === pending.id ? pending : layer,
          ),
          modifiedAt: Date.now(),
        }
      : composition;
    void commitMotionCompositionGesture(gestureStart, finalComposition);
  }, [commitMotionCompositionGesture, composition]);

  useEffect(() => {
    const flush = (): void => flushActiveGesture();
    window.addEventListener("pointerup", flush);
    window.addEventListener("pointercancel", flush);
    return () => {
      window.removeEventListener("pointerup", flush);
      window.removeEventListener("pointercancel", flush);
    };
  }, [flushActiveGesture]);

  const previewLayer = (nextLayer: MotionLayer) => {
    beginLayerGesture();
    updateMotionCompositionPreview(compositionWithLayer(nextLayer));
  };

  const commitLayerGesture = (nextLayer: MotionLayer | null) => {
    const gestureStart = gestureStartRef.current;
    gestureStartRef.current = null;
    if (!gestureStart) return;
    const finalComposition = nextLayer
      ? compositionWithLayer(nextLayer)
      : composition;
    void commitMotionCompositionGesture(gestureStart, finalComposition);
  };

  const replaceLight = (nextLight: MotionLight) => {
    void upsertMotionComposition({
      ...composition,
      lights: lights.map((light) =>
        light.id === nextLight.id ? nextLight : light,
      ),
      modifiedAt: Date.now(),
    });
  };

  const replaceCamera = (nextCamera: MotionCamera) => {
    void upsertMotionComposition({
      ...composition,
      camera: nextCamera,
      modifiedAt: Date.now(),
    });
  };

  if (!selectedLayer && selectedLight) {
    return (
      <LightGraphEditor
        composition={composition}
        light={selectedLight}
        selectedProperty={selectedProperty}
        setSelectedProperty={setSelectedProperty}
        playhead={playhead}
        setPlayhead={setPlayhead}
        replaceLight={replaceLight}
        keyframeClipboard={keyframeClipboard}
        setKeyframeClipboard={setKeyframeClipboard}
        embedded={embedded}
      />
    );
  }

  if (!selectedLayer && selectedCameraProperty) {
    return (
      <CameraGraphEditor
        composition={composition}
        camera={normalizeMotionCamera(composition)}
        selectedProperty={selectedCameraProperty}
        setSelectedProperty={setSelectedProperty}
        playhead={playhead}
        setPlayhead={setPlayhead}
        replaceCamera={replaceCamera}
        keyframeClipboard={keyframeClipboard}
        setKeyframeClipboard={setKeyframeClipboard}
        embedded={embedded}
      />
    );
  }

  if (!selectedLayer) {
    if (embedded) {
      return null;
    }
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title="Graph Editor" icon={Activity} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={ListTree}
            title="Select an object"
            description="Choose a layer, camera, or light to edit timing curves and keyframes."
          />
        </div>
      </div>
    );
  }

  const availableProperties =
    getGraphEditorAvailableProperties(selectedLayer);
  const property: MotionAnimatableProperty =
    selectedProperty &&
    isMotionAnimatableProperty(selectedProperty) &&
    availableProperties.some((item) => item.property === selectedProperty)
      ? selectedProperty
      : (availableProperties[0]?.property ?? "transform.position.x");
  const descriptor =
    availableProperties.find((item) => item.property === property) ??
    getMotionPropertyDescriptor(property);
  const propertyKeyframes = getMotionLayerPropertyKeyframes(
    selectedLayer,
    property,
  );
  const layerDuration = Math.max(selectedLayer.duration, 0.001);
  const localPlayhead = clamp(playhead - selectedLayer.startTime, 0, layerDuration);
  const currentValue = getMotionLayerPropertyValueAtTime(
    selectedLayer,
    property,
    localPlayhead,
    composition,
  );
  const baseValue = getMotionLayerPropertyValue(selectedLayer, property);
  const keyframeAtPlayhead = propertyKeyframes.find(
    (keyframe) => Math.abs(keyframe.time - localPlayhead) <= 1 / 1000,
  );
  const propertyExpression = getMotionLayerExpression(selectedLayer, property);

  const addOrUpdateKeyframe = () => {
    replaceLayer(
      upsertMotionLayerKeyframe(selectedLayer, property, localPlayhead, {
        value: currentValue,
        easing: keyframeAtPlayhead?.easing ?? "ease",
      }),
    );
  };

  const clearPropertyKeyframes = () => {
    replaceLayer(removeMotionLayerPropertyKeyframes(selectedLayer, property));
  };

  const applyPropertyEasing = (easing: EasingType) => {
    replaceLayer({
      ...selectedLayer,
      keyframes: sortMotionKeyframes(
        selectedLayer.keyframes.map((keyframe) =>
          keyframe.property === property ? { ...keyframe, easing } : keyframe,
        ),
      ),
    } as MotionLayer);
  };

  const duplicatePropertyKeyframes = (offset: number) => {
    replaceLayer({
      ...selectedLayer,
      keyframes: duplicateMotionPropertyKeyframes(
        selectedLayer.keyframes,
        property,
        offset,
        { duration: selectedLayer.duration },
      ),
    } as MotionLayer);
  };

  const reversePropertyKeyframes = () => {
    replaceLayer({
      ...selectedLayer,
      keyframes: reverseMotionPropertyKeyframes(
        selectedLayer.keyframes,
        property,
      ),
    } as MotionLayer);
  };

  const scalePropertyKeyframes = (scale: number) => {
    replaceLayer({
      ...selectedLayer,
      keyframes: scaleMotionPropertyKeyframeTimes(
        selectedLayer.keyframes,
        property,
        scale,
        { duration: selectedLayer.duration },
      ),
    } as MotionLayer);
  };

  const copyPropertyKeyframes = () => {
    setKeyframeClipboard(
      copyMotionPropertyKeyframes(selectedLayer.keyframes, property),
    );
  };

  const pastePropertyKeyframes = () => {
    if (!keyframeClipboard) return;
    replaceLayer({
      ...selectedLayer,
      keyframes: pasteMotionPropertyKeyframes(
        selectedLayer.keyframes,
        property,
        keyframeClipboard,
        localPlayhead,
        { duration: selectedLayer.duration },
      ),
    } as MotionLayer);
  };

  const layerWithKeyframeUpdate = (
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id" | "property">>,
  ): MotionLayer => {
    const nextKeyframes = selectedLayer.keyframes.map((keyframe) =>
      keyframe.id === keyframeId ? { ...keyframe, ...updates } : keyframe,
    );
    const affectsRovingTimes =
      updates.time !== undefined || updates.value !== undefined;
    if (!affectsRovingTimes) {
      return {
        ...selectedLayer,
        keyframes: sortMotionKeyframes(nextKeyframes),
      } as MotionLayer;
    }
    const edited = selectedLayer.keyframes.find(
      (keyframe) => keyframe.id === keyframeId,
    );
    if (!edited) {
      return {
        ...selectedLayer,
        keyframes: sortMotionKeyframes(nextKeyframes),
      } as MotionLayer;
    }
    const editedProperty = edited.property;
    const propertyKeyframes = nextKeyframes.filter(
      (keyframe) => keyframe.property === editedProperty,
    );
    const redistributed = redistributeRovingKeyframeTimes(propertyKeyframes);
    const byId = new Map(
      redistributed.map((keyframe) => [keyframe.id, keyframe]),
    );
    return {
      ...selectedLayer,
      keyframes: sortMotionKeyframes(
        nextKeyframes.map((keyframe) =>
          keyframe.property === editedProperty
            ? (byId.get(keyframe.id) ?? keyframe)
            : keyframe,
        ),
      ),
    } as MotionLayer;
  };

  const updateKeyframe = (
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id" | "property">>,
  ) => {
    replaceLayer(layerWithKeyframeUpdate(keyframeId, updates));
  };

  const removeKeyframe = (keyframeId: string) => {
    replaceLayer(removeMotionLayerKeyframe(selectedLayer, keyframeId));
  };

  const toggleKeyframeRoving = (keyframeId: string, next: boolean) => {
    replaceLayer(
      setMotionKeyframeRoving(selectedLayer, property, keyframeId, next),
    );
  };

  const getGraphPointerPoint = (event: ReactPointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: GRAPH_PADDING, y: GRAPH_PADDING };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
    };
  };

  const beginKeyframeDrag = (
    keyframeId: string,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    keyframeDragRef.current = {
      pointerId: event.pointerId,
      keyframeId,
    };
    capturePointer(event);
  };

  const moveKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGraphPointerPoint(event);
    const rawTime = graph.xToTime(point.x);
    const nextTime = event.altKey
      ? roundGraphValue(rawTime, 0.001)
      : snapTimeToFrame(rawTime, composition.frameRate);
    const nextValue = roundGraphValue(
      graph.yToValue(point.y),
      descriptor?.step ?? 0.01,
    );

    const nextLayer = layerWithKeyframeUpdate(drag.keyframeId, {
      time: nextTime,
      value: nextValue,
    });
    pendingLayerRef.current = nextLayer;
    previewLayer(nextLayer);
    setPlayhead(selectedLayer.startTime + nextTime);
  };

  const endKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (keyframeDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      keyframeDragRef.current = null;
      const pending = pendingLayerRef.current;
      pendingLayerRef.current = null;
      commitLayerGesture(pending);
    }
  };

  const buildSegmentFrame = (
    fromKeyframe: Keyframe & { readonly value: number },
    toKeyframe: Keyframe & { readonly value: number },
    unclampedY = false,
  ): GraphSegmentFrame => ({
    t0: fromKeyframe.time,
    t1: toKeyframe.time,
    v0: fromKeyframe.value,
    v1: toKeyframe.value,
    toX: (time) => graph.timeToX(time),
    toY: (value) => graph.valueToY(value),
    fromX: (x) => graph.xToTime(x),
    fromY: (y) => (unclampedY ? graph.yToValueUnclamped(y) : graph.yToValue(y)),
  });

  const beginHandleDrag = (
    keyframeId: string,
    grip: "in" | "out",
    event: ReactPointerEvent<SVGElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    handleDragRef.current = {
      pointerId: event.pointerId,
      keyframeId,
      grip,
    };
    capturePointer(event);
  };

  const moveHandleDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = handleDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const segment = numericSegments.find(
      (candidate) => candidate.from.id === drag.keyframeId,
    );
    if (!segment) return;
    const frame = buildSegmentFrame(segment.from, segment.to, true);
    const point = getGraphPointerPoint(event);
    const nextHandle = graphPointToNormalizedHandle(point, frame);
    const seededHandles: BezierHandlePair =
      segment.from.easing === "bezier" && segment.from.bezierHandles
        ? {
            in: { ...segment.from.bezierHandles.in },
            out: { ...segment.from.bezierHandles.out },
          }
        : seedBezierHandlesFromEasing(segment.from.easing);
    const nextHandles: BezierHandlePair =
      drag.grip === "in"
        ? { in: nextHandle, out: seededHandles.out }
        : { in: seededHandles.in, out: nextHandle };
    const nextLayer = layerWithKeyframeUpdate(drag.keyframeId, {
      easing: "bezier",
      bezierHandles: nextHandles,
    });
    pendingLayerRef.current = nextLayer;
    previewLayer(nextLayer);
  };

  const endHandleDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (handleDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      handleDragRef.current = null;
      const pending = pendingLayerRef.current;
      pendingLayerRef.current = null;
      commitLayerGesture(pending);
    }
  };

  const dispatchGraphPointerMove = (event: ReactPointerEvent<SVGElement>) => {
    if (handleDragRef.current) {
      moveHandleDrag(event);
      return;
    }
    if (keyframeDragRef.current) {
      moveKeyframeDrag(event);
    }
  };

  const dispatchGraphPointerEnd = (event: ReactPointerEvent<SVGElement>) => {
    if (handleDragRef.current) {
      endHandleDrag(event);
      return;
    }
    if (keyframeDragRef.current) {
      endKeyframeDrag(event);
    }
  };

  const setExpressionType = (type: MotionExpressionType | "") => {
    if (!type) {
      if (propertyExpression) {
        replaceLayer(
          removeMotionLayerExpression(selectedLayer, propertyExpression.id),
        );
      }
      return;
    }
    replaceLayer(
      addMotionLayerExpression(
        selectedLayer,
        createMotionExpression(type, property),
      ),
    );
  };

  const updateExpression = (
    updater: (expression: MotionExpression) => MotionExpression,
  ) => {
    if (!propertyExpression) return;
    replaceLayer(
      updateMotionLayerExpression(
        selectedLayer,
        propertyExpression.id,
        updater,
      ),
    );
  };

  const expressionError =
    propertyExpression && propertyExpression.enabled
      ? getMotionExpressionError(propertyExpression.id)
      : null;

  const activeReferenceLayer =
    composition.layers.find((layer) => layer.id === referenceLayerId) ??
    selectedLayer;
  const referencePropertyOptions =
    getGraphEditorAvailableProperties(activeReferenceLayer);
  const resolvedReferenceProperty = referencePropertyOptions.some(
    (item) => item.property === referenceProperty,
  )
    ? referenceProperty
    : referencePropertyOptions[0]?.property ?? "";

  const insertLayerReference = () => {
    if (!propertyExpression || propertyExpression.type !== "expression") return;
    if (!resolvedReferenceProperty) return;
    const snippet = buildLayerReferenceExpression(
      activeReferenceLayer,
      selectedLayer,
      resolvedReferenceProperty,
    );
    updateExpression((expression) => {
      const existing = expression.code ?? "";
      const separator = existing.length === 0 || existing.endsWith("\n")
        ? ""
        : " ";
      return { ...expression, code: `${existing}${separator}${snippet}` };
    });
  };

  const graph = buildGraph(propertyKeyframes, currentValue, baseValue, layerDuration);
  const playheadX =
    GRAPH_PADDING +
    (localPlayhead / layerDuration) * (GRAPH_WIDTH - GRAPH_PADDING * 2);

  const numericSegments = buildNumericSegments(propertyKeyframes);
  const selectedKeyframeId = keyframeAtPlayhead?.id ?? null;
  const bezierHandleSegments = numericSegments.filter(
    (segment) =>
      segment.from.easing === "bezier" ||
      segment.from.id === selectedKeyframeId ||
      segment.to.id === selectedKeyframeId,
  );
  const isSpeedMode = graphMode === "speed";
  const speedModel = isSpeedMode
    ? buildSpeedGraphModel(numericSegments, layerDuration)
    : null;

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="Graph Editor" icon={Activity} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title="Animated Property" icon={ListTree}>
          <div className="grid grid-cols-2 gap-1.5">
            {availableProperties.map((item) => {
              const active = item.property === property;
              const count = getMotionLayerPropertyKeyframes(
                selectedLayer,
                item.property,
              ).length;
              return (
                <button
                  key={item.property}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedProperty(item.property)}
                  className={`flex min-w-0 items-center justify-between gap-2 rounded-[7px] border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "border-accent bg-selected text-accent"
                      : "border-border bg-bg-1 text-fg-2 hover:border-border-strong hover:bg-bg-2"
                  }`}
                >
                  <span
                    className="truncate text-[11.5px] font-medium"
                    title={prettyPropertyLabel(item.label)}
                  >
                    {prettyPropertyLabel(item.label)}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      active
                        ? "bg-accent/15 text-accent"
                        : count > 0
                          ? "bg-bg-3 text-fg-3"
                          : "bg-bg-2 text-fg-muted"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Expression"
          icon={Activity}
          defaultOpen={Boolean(propertyExpression)}
          action={
            <IconButton
              icon={Trash2}
              label="Clear expression"
              size="sm"
              variant="danger"
              disabled={!propertyExpression}
              onClick={() => setExpressionType("")}
            />
          }
        >
          <Field label="Preset">
            <SelectInput
              value={propertyExpression?.type ?? ""}
              options={[
                { value: "", label: "None" },
                ...MOTION_EXPRESSION_PRESETS.map((preset) => ({
                  value: preset.type,
                  label: preset.name,
                })),
              ]}
              onChange={(type) =>
                setExpressionType(type as MotionExpressionType | "")
              }
            />
          </Field>

          {propertyExpression ? (
            <>
              <SwitchInput
                label="Enabled"
                description="Procedural value is added at render time"
                checked={propertyExpression.enabled}
                onChange={(enabled) =>
                  replaceLayer(
                    toggleMotionLayerExpression(
                      selectedLayer,
                      propertyExpression.id,
                      enabled,
                    ),
                  )
                }
              />

              {propertyExpression.type === "expression" ? (
                <>
                  <Field label="Expression">
                    <textarea
                      aria-label="Expression code"
                      value={propertyExpression.code ?? ""}
                      rows={4}
                      spellCheck={false}
                      onChange={(event) =>
                        updateExpression((expression) => ({
                          ...expression,
                          code: event.target.value,
                        }))
                      }
                      placeholder="value + wiggle(2, 20)"
                      className="w-full resize-y rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-fg-2 outline-none focus:border-border-strong"
                    />
                  </Field>

                  {expressionError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] leading-relaxed text-danger"
                    >
                      <span className="mt-[1px] inline-flex shrink-0 items-center rounded bg-danger px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                        Error
                      </span>
                      <span className="min-w-0 break-words">{expressionError}</span>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-dashed border-border bg-bg-2 px-3 py-3">
                    <ToolcraftText
                      type="supporting"
                      color="secondary"
                      className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-fg-muted"
                    >
                      Insert reference
                    </ToolcraftText>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        aria-label="Reference layer"
                        value={referenceLayerId || selectedLayer.id}
                        onChange={(event) => {
                          setReferenceLayerId(event.target.value);
                          setReferenceProperty("");
                        }}
                        className="w-full cursor-pointer appearance-none truncate rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 text-[12px] font-medium text-fg-2 outline-none"
                      >
                        {composition.layers.map((layer) => (
                          <option key={layer.id} value={layer.id}>
                            {layer.id === selectedLayer.id
                              ? `${layer.name} (this layer)`
                              : layer.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Reference property"
                        value={resolvedReferenceProperty}
                        onChange={(event) =>
                          setReferenceProperty(event.target.value)
                        }
                        className="w-full cursor-pointer appearance-none truncate rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 text-[12px] font-medium text-fg-2 outline-none"
                      >
                        {referencePropertyOptions.map((item) => (
                          <option key={item.property} value={item.property}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      label="Insert reference"
                      size="sm"
                      variant="secondary"
                      className="mt-2 w-full"
                      isDisabled={!resolvedReferenceProperty}
                      onClick={insertLayerReference}
                    />
                  </div>
                </>
              ) : null}

              {hasExpressionParameters(propertyExpression.type) ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {EXPRESSION_TYPES_WITH_AMPLITUDE.has(propertyExpression.type) ? (
                    <Field label="Amplitude">
                      <NumberInput
                        value={propertyExpression.amplitude}
                        step={descriptor?.step ?? 1}
                        onChange={(amplitude) =>
                          updateExpression((expression) => ({
                            ...expression,
                            amplitude,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                  {EXPRESSION_TYPES_WITH_FREQUENCY.has(propertyExpression.type) ? (
                    <Field
                      label={
                        propertyExpression.type === "posterize"
                          ? "Samples/sec"
                          : "Frequency"
                      }
                    >
                      <NumberInput
                        value={propertyExpression.frequency}
                        min={0}
                        step={0.1}
                        onChange={(frequency) =>
                          updateExpression((expression) => ({
                            ...expression,
                            frequency,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                  {EXPRESSION_TYPES_WITH_PHASE.has(propertyExpression.type) ? (
                    <Field label="Phase" hint="deg">
                      <NumberInput
                        value={propertyExpression.phase}
                        step={5}
                        onChange={(phase) =>
                          updateExpression((expression) => ({
                            ...expression,
                            phase,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                  {EXPRESSION_TYPES_WITH_SEED.has(propertyExpression.type) ? (
                    <Field label="Seed">
                      <NumberInput
                        value={propertyExpression.seed}
                        step={1}
                        onChange={(seed) =>
                          updateExpression((expression) => ({
                            ...expression,
                            seed,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                  {propertyExpression.type === "spring" ? (
                    <Field label="Decay">
                      <NumberInput
                        value={propertyExpression.decay}
                        min={0}
                        step={0.1}
                        onChange={(decay) =>
                          updateExpression((expression) => ({
                            ...expression,
                            decay,
                          }))
                        }
                      />
                    </Field>
                  ) : null}
                </div>
              ) : (
                <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                  {getExpressionSummary(propertyExpression.type)}
                </ToolcraftText>
              )}
            </>
          ) : (
            <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              Add a safe expression preset to generate procedural motion for
              this property.
            </ToolcraftText>
          )}
        </Section>

        <Section
          title={descriptor?.label ?? property}
          icon={Activity}
          keepOpenInAccordion={Boolean(selectedProperty)}
          action={
            <div className="flex items-center gap-1">
              <IconButton
                icon={Plus}
                label={keyframeAtPlayhead ? "Update keyframe" : "Add keyframe"}
                size="sm"
                variant={keyframeAtPlayhead ? "solid" : "outline"}
                onClick={addOrUpdateKeyframe}
              />
              <IconButton
                icon={Trash2}
                label="Clear property keyframes"
                size="sm"
                variant="danger"
                disabled={propertyKeyframes.length === 0}
                onClick={clearPropertyKeyframes}
              />
            </div>
          }
        >
          <div className="mb-2">
            <SegmentedControl<GraphMode>
              value={graphMode}
              options={[
                { value: "value", label: "Value" },
                { value: "speed", label: "Speed" },
              ]}
              onChange={setGraphMode}
            />
          </div>
          <div className="rounded-lg border border-border bg-bg-2 p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
              className="h-[148px] w-full overflow-visible"
              role="img"
              aria-label={`${descriptor?.label ?? property} ${
                isSpeedMode ? "speed" : "keyframe"
              } graph`}
              onPointerMove={dispatchGraphPointerMove}
              onPointerUp={dispatchGraphPointerEnd}
              onPointerCancel={dispatchGraphPointerEnd}
            >
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line
                  key={ratio}
                  x1={GRAPH_PADDING}
                  x2={GRAPH_WIDTH - GRAPH_PADDING}
                  y1={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  y2={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  stroke="var(--border)"
                  strokeDasharray="4 5"
                />
              ))}
              <line
                x1={playheadX}
                x2={playheadX}
                y1={GRAPH_PADDING}
                y2={GRAPH_HEIGHT - GRAPH_PADDING}
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
              {isSpeedMode ? (
                speedModel ? (
                  <>
                    <line
                      data-testid="speed-zero-line"
                      x1={GRAPH_PADDING}
                      x2={GRAPH_WIDTH - GRAPH_PADDING}
                      y1={speedModel.zeroY}
                      y2={speedModel.zeroY}
                      stroke="var(--fg-muted)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    {speedModel.path ? (
                      <path
                        data-testid="speed-graph-polyline"
                        d={speedModel.path}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                    {speedModel.points.map((point) => (
                      <SpeedGraphPoint
                        key={point.id}
                        point={point}
                        layerStartTime={selectedLayer.startTime}
                        onSeek={(time) => setPlayhead(time)}
                      />
                    ))}
                  </>
                ) : (
                  <text
                    x={GRAPH_WIDTH / 2}
                    y={GRAPH_HEIGHT / 2}
                    fill="var(--fg-muted)"
                    textAnchor="middle"
                    className="text-[11px]"
                  >
                    Add two keyframes to see speed
                  </text>
                )
              ) : (
                <>
                  {graph.path ? (
                    <path
                      d={graph.path}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                  {bezierHandleSegments.map((segment) => (
                    <BezierHandleGrips
                      key={`handles-${segment.from.id}`}
                      segment={segment}
                      frameFor={buildSegmentFrame}
                      onDragStart={beginHandleDrag}
                      onDragMove={moveHandleDrag}
                      onDragEnd={endHandleDrag}
                    />
                  ))}
                  {graph.points.map((point) => (
                    <KeyframeGraphPoint
                      key={point.id}
                      point={point}
                      active={
                        Math.abs(point.time - localPlayhead) <=
                        1 / Math.max(1, composition.frameRate)
                      }
                      layerStartTime={selectedLayer.startTime}
                      onSeek={(time) => setPlayhead(time)}
                      onDragStart={beginKeyframeDrag}
                      onDragMove={moveKeyframeDrag}
                      onDragEnd={endKeyframeDrag}
                    />
                  ))}
                  {graph.points.length === 0 ? (
                    <text
                      x={GRAPH_WIDTH / 2}
                      y={GRAPH_HEIGHT / 2}
                      fill="var(--fg-muted)"
                      textAnchor="middle"
                      className="text-[11px]"
                    >
                      Add keyframes to draw a curve
                    </text>
                  ) : null}
                </>
              )}
            </svg>
            <div className="mt-1 flex items-center justify-between text-[10.5px] tabular-nums text-fg-muted">
              <span>0.00s</span>
              <span>{layerDuration.toFixed(2)}s</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Value at playhead" hint={descriptor?.unit}>
              <NumberInput
                value={currentValue}
                step={descriptor?.step ?? 0.01}
                onChange={(value) =>
                  replaceLayer(
                    upsertMotionLayerKeyframe(selectedLayer, property, localPlayhead, {
                      value,
                      easing: keyframeAtPlayhead?.easing ?? "ease",
                    }),
                  )
                }
              />
            </Field>
            <Field label="Layer base" hint={descriptor?.unit}>
              <NumberInput
                value={baseValue}
                step={descriptor?.step ?? 0.01}
                onChange={(value) =>
                  replaceLayer(setMotionLayerPropertyValue(selectedLayer, property, value))
                }
              />
            </Field>
          </div>
        </Section>

        <Section title="Keyframes" icon={Diamond}>
          <div className="space-y-1.5">
            <KeyframeTimingToolbar
              disabled={propertyKeyframes.length === 0}
              canPaste={Boolean(keyframeClipboard)}
              onApply={applyPropertyEasing}
              onCopy={copyPropertyKeyframes}
              onPaste={pastePropertyKeyframes}
              onDuplicate={duplicatePropertyKeyframes}
              onReverse={reversePropertyKeyframes}
              onScale={scalePropertyKeyframes}
            />
            {propertyKeyframes.length === 0 ? (
              <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                No keyframes on this property yet. Add one at the current
                playhead to start shaping motion.
              </ToolcraftText>
            ) : (
              propertyKeyframes.map((keyframe, index) => (
                <KeyframeRow
                  key={keyframe.id}
                  keyframe={keyframe}
                  descriptor={descriptor}
                  onUpdate={(updates) => updateKeyframe(keyframe.id, updates)}
                  onRemove={() => removeKeyframe(keyframe.id)}
                  roving={{
                    enabled: keyframe.roving === true,
                    canRove:
                      index > 0 && index < propertyKeyframes.length - 1,
                    onToggle: (next) => toggleKeyframeRoving(keyframe.id, next),
                  }}
                />
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function KeyframeGraphPoint({
  point,
  active,
  layerStartTime,
  onSeek,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  point: GraphPoint;
  active: boolean;
  layerStartTime: number;
  onSeek: (time: number) => void;
  onDragStart: (keyframeId: string, event: ReactPointerEvent<SVGElement>) => void;
  onDragMove: (event: ReactPointerEvent<SVGElement>) => void;
  onDragEnd: (event: ReactPointerEvent<SVGElement>) => void;
}): JSX.Element {
  const seekToPoint = () => onSeek(layerStartTime + point.time);
  const radius = active ? 7 : 5;
  const draggable = !point.roving;
  return (
    <g
      role="button"
      tabIndex={0}
      data-testid={`keyframe-point-${point.id}`}
      data-roving={point.roving ? "true" : "false"}
      className={
        draggable
          ? "cursor-grab outline-none active:cursor-grabbing"
          : "cursor-pointer outline-none"
      }
      onPointerDown={
        draggable ? (event) => onDragStart(point.id, event) : undefined
      }
      onPointerMove={draggable ? onDragMove : undefined}
      onPointerUp={draggable ? onDragEnd : undefined}
      onPointerCancel={draggable ? onDragEnd : undefined}
      onClick={seekToPoint}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          seekToPoint();
        }
      }}
    >
      <title>
        {point.roving
          ? `${point.time.toFixed(2)}s · roving`
          : `${point.time.toFixed(2)}s`}
      </title>
      {point.roving ? (
        <rect
          x={point.x - radius}
          y={point.y - radius}
          width={radius * 2}
          height={radius * 2}
          transform={`rotate(45 ${point.x} ${point.y})`}
          fill="var(--bg-1)"
          stroke={active ? "var(--accent-strong)" : "var(--accent)"}
          strokeWidth={active ? 3 : 2}
        />
      ) : (
        <circle
          cx={point.x}
          cy={point.y}
          r={radius}
          fill={active ? "var(--accent-strong)" : "var(--accent)"}
          stroke="var(--bg-1)"
          strokeWidth={active ? 3 : 2}
        />
      )}
    </g>
  );
}

function SpeedGraphPoint({
  point,
  layerStartTime,
  onSeek,
}: {
  point: GraphPoint;
  layerStartTime: number;
  onSeek: (time: number) => void;
}): JSX.Element {
  const size = 5;
  return (
    <g
      role="button"
      tabIndex={0}
      data-testid={`speed-point-${point.id}`}
      className="cursor-pointer outline-none"
      onClick={() => onSeek(layerStartTime + point.time)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSeek(layerStartTime + point.time);
        }
      }}
    >
      <title>{`${point.time.toFixed(2)}s`}</title>
      <rect
        x={point.x - size}
        y={point.y - size}
        width={size * 2}
        height={size * 2}
        transform={`rotate(45 ${point.x} ${point.y})`}
        fill="var(--bg-1)"
        stroke="var(--accent)"
        strokeWidth={2}
      />
    </g>
  );
}

function BezierHandleGrips({
  segment,
  frameFor,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  segment: NumericSegment;
  frameFor: (
    from: Keyframe & { readonly value: number },
    to: Keyframe & { readonly value: number },
  ) => GraphSegmentFrame;
  onDragStart: (
    keyframeId: string,
    grip: "in" | "out",
    event: ReactPointerEvent<SVGElement>,
  ) => void;
  onDragMove: (event: ReactPointerEvent<SVGElement>) => void;
  onDragEnd: (event: ReactPointerEvent<SVGElement>) => void;
}): JSX.Element {
  const frame = frameFor(segment.from, segment.to);
  const anchorStart = { x: frame.toX(frame.t0), y: frame.toY(frame.v0) };
  const anchorEnd = { x: frame.toX(frame.t1), y: frame.toY(frame.v1) };

  if (isFlatSegment(segment.from.value, segment.to.value)) {
    const midX = (anchorStart.x + anchorEnd.x) / 2;
    const midY = (anchorStart.y + anchorEnd.y) / 2;
    return (
      <g data-testid={`flat-segment-hint-${segment.from.id}`}>
        <title>Flat segment — handles have no effect</title>
        <circle
          cx={midX}
          cy={midY}
          r={3}
          fill="var(--fg-muted)"
          opacity={0.5}
        />
      </g>
    );
  }

  const handles: BezierHandlePair =
    segment.from.easing === "bezier" && segment.from.bezierHandles
      ? segment.from.bezierHandles
      : seedBezierHandlesFromEasing(segment.from.easing);
  const inPoint = normalizedHandleToGraphPoint(handles.in, frame);
  const outPoint = normalizedHandleToGraphPoint(handles.out, frame);

  return (
    <g>
      <line
        x1={anchorStart.x}
        y1={anchorStart.y}
        x2={inPoint.x}
        y2={inPoint.y}
        stroke="var(--fg-muted)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <line
        x1={anchorEnd.x}
        y1={anchorEnd.y}
        x2={outPoint.x}
        y2={outPoint.y}
        stroke="var(--fg-muted)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <circle
        role="button"
        data-testid={`bezier-grip-in-${segment.from.id}`}
        className="cursor-grab outline-none active:cursor-grabbing"
        cx={inPoint.x}
        cy={inPoint.y}
        r={5}
        fill="var(--bg-1)"
        stroke="var(--accent)"
        strokeWidth="1.5"
        onPointerDown={(event) => onDragStart(segment.from.id, "in", event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
      <circle
        role="button"
        data-testid={`bezier-grip-out-${segment.from.id}`}
        className="cursor-grab outline-none active:cursor-grabbing"
        cx={outPoint.x}
        cy={outPoint.y}
        r={5}
        fill="var(--bg-1)"
        stroke="var(--accent)"
        strokeWidth="1.5"
        onPointerDown={(event) => onDragStart(segment.from.id, "out", event)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      />
    </g>
  );
}

function hasExpressionParameters(type: MotionExpressionType): boolean {
  return (
    EXPRESSION_TYPES_WITH_AMPLITUDE.has(type) ||
    EXPRESSION_TYPES_WITH_FREQUENCY.has(type) ||
    EXPRESSION_TYPES_WITH_PHASE.has(type) ||
    EXPRESSION_TYPES_WITH_SEED.has(type) ||
    type === "spring"
  );
}

function getExpressionSummary(type: MotionExpressionType): string {
  switch (type) {
    case "loop":
      return "Loop repeats this property's keyframes after the last key.";
    case "ping-pong":
      return "Ping-pong repeats keyframes forward and backward.";
    case "posterize":
      return "Posterize samples this property's value at a lower rate.";
    case "expression":
      return "Write a JavaScript expression: value, time, wiggle(), loopOut(), linear(), ease(), clamp(), random(), Math.";
    case "sine":
    case "wiggle":
    case "drift":
    case "spring":
    case "random":
      return "Adjust expression parameters above.";
  }
}

function CameraGraphEditor({
  composition,
  camera,
  selectedProperty,
  setSelectedProperty,
  playhead,
  setPlayhead,
  replaceCamera,
  keyframeClipboard,
  setKeyframeClipboard,
  embedded = false,
}: {
  composition: MotionComposition;
  camera: MotionCamera;
  selectedProperty: MotionCameraProperty;
  setSelectedProperty: (property: string | null) => void;
  playhead: number;
  setPlayhead: (playhead: number) => void;
  replaceCamera: (nextCamera: MotionCamera) => void;
  keyframeClipboard: MotionKeyframeClipboard | null;
  setKeyframeClipboard: (clipboard: MotionKeyframeClipboard | null) => void;
  embedded?: boolean;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const keyframeDragRef = useRef<{
    readonly pointerId: number;
    readonly keyframeId: string;
  } | null>(null);
  const property = selectedProperty;
  const descriptor = getMotionCameraPropertyDescriptor(property);
  const propertyKeyframes = getMotionCameraPropertyKeyframes(camera, property);
  const duration = Math.max(composition.duration, 0.001);
  const localPlayhead = clamp(playhead, 0, duration);
  const enabledCamera = {
    ...camera,
    enabled: true,
  };
  const animatedCamera = getMotionCameraAtTime(
    { ...composition, camera: enabledCamera },
    localPlayhead,
  );
  const currentValue = getMotionCameraPropertyValue(animatedCamera, property);
  const baseValue = getMotionCameraPropertyValue(enabledCamera, property);
  const keyframeAtPlayhead = propertyKeyframes.find(
    (keyframe) => Math.abs(keyframe.time - localPlayhead) <= 1 / 1000,
  );
  const graph = buildGraph(propertyKeyframes, currentValue, baseValue, duration);
  const playheadX =
    GRAPH_PADDING +
    (localPlayhead / duration) * (GRAPH_WIDTH - GRAPH_PADDING * 2);

  const updateKeyframe = (
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id" | "property">>,
  ) => {
    replaceCamera({
      ...enabledCamera,
      keyframes: sortMotionKeyframes(
        (enabledCamera.keyframes ?? []).map((keyframe) =>
          keyframe.id === keyframeId ? { ...keyframe, ...updates } : keyframe,
        ),
      ),
    });
  };

  const applyPropertyEasing = (easing: EasingType) => {
    replaceCamera({
      ...enabledCamera,
      keyframes: sortMotionKeyframes(
        (enabledCamera.keyframes ?? []).map((keyframe) =>
          keyframe.property === property ? { ...keyframe, easing } : keyframe,
        ),
      ),
    });
  };

  const duplicatePropertyKeyframes = (offset: number) => {
    replaceCamera({
      ...enabledCamera,
      keyframes: duplicateMotionPropertyKeyframes(
        enabledCamera.keyframes ?? [],
        property,
        offset,
        { duration },
      ),
    });
  };

  const reversePropertyKeyframes = () => {
    replaceCamera({
      ...enabledCamera,
      keyframes: reverseMotionPropertyKeyframes(
        enabledCamera.keyframes ?? [],
        property,
      ),
    });
  };

  const scalePropertyKeyframes = (scale: number) => {
    replaceCamera({
      ...enabledCamera,
      keyframes: scaleMotionPropertyKeyframeTimes(
        enabledCamera.keyframes ?? [],
        property,
        scale,
        { duration },
      ),
    });
  };

  const copyPropertyKeyframes = () => {
    setKeyframeClipboard(
      copyMotionPropertyKeyframes(enabledCamera.keyframes ?? [], property),
    );
  };

  const pastePropertyKeyframes = () => {
    if (!keyframeClipboard) return;
    replaceCamera({
      ...enabledCamera,
      keyframes: pasteMotionPropertyKeyframes(
        enabledCamera.keyframes ?? [],
        property,
        keyframeClipboard,
        localPlayhead,
        { duration },
      ),
    });
  };

  const getGraphPointerPoint = (event: ReactPointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: GRAPH_PADDING, y: GRAPH_PADDING };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
    };
  };

  const beginKeyframeDrag = (
    keyframeId: string,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    keyframeDragRef.current = {
      pointerId: event.pointerId,
      keyframeId,
    };
    capturePointer(event);
  };

  const moveKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGraphPointerPoint(event);
    const rawTime = graph.xToTime(point.x);
    const nextTime = event.altKey
      ? roundGraphValue(rawTime, 0.001)
      : snapTimeToFrame(rawTime, composition.frameRate);
    const nextValue = roundGraphValue(
      graph.yToValue(point.y),
      descriptor.step,
    );

    updateKeyframe(drag.keyframeId, {
      time: nextTime,
      value: nextValue,
    });
    setPlayhead(nextTime);
  };

  const endKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (keyframeDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      keyframeDragRef.current = null;
    }
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="Camera Graph" icon={Camera} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title="Camera" icon={ListTree}>
          <div className="grid grid-cols-2 gap-1.5">
            {MOTION_CAMERA_PROPERTY_DESCRIPTORS.map((item) => {
              const active = item.property === property;
              const count = getMotionCameraPropertyKeyframes(
                enabledCamera,
                item.property,
              ).length;
              return (
                <Button
                  key={item.property}
                  label={item.label}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedProperty(item.property)}
                  className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-bg-2 text-fg-3 hover:border-border-strong hover:bg-hover hover:text-fg"
                  }`}
                >
                  <span className="truncate text-[11.5px] font-medium">
                    {item.label}
                  </span>
                  <span className="rounded bg-bg-1 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
        </Section>

        <Section
          title={descriptor.label}
          icon={Activity}
          action={
            <div className="flex items-center gap-1">
              <IconButton
                icon={Plus}
                label={keyframeAtPlayhead ? "Update keyframe" : "Add keyframe"}
                size="sm"
                variant={keyframeAtPlayhead ? "solid" : "outline"}
                onClick={() =>
                  replaceCamera(
                    upsertMotionCameraKeyframe(
                      enabledCamera,
                      property,
                      localPlayhead,
                      {
                        value: currentValue,
                        easing: keyframeAtPlayhead?.easing ?? "ease",
                      },
                    ),
                  )
                }
              />
              <IconButton
                icon={Trash2}
                label="Clear property keyframes"
                size="sm"
                variant="danger"
                disabled={propertyKeyframes.length === 0}
                onClick={() =>
                  replaceCamera(
                    removeMotionCameraPropertyKeyframes(enabledCamera, property),
                  )
                }
              />
            </div>
          }
        >
          <div className="rounded-lg border border-border bg-bg-2 p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
              className="h-[148px] w-full overflow-visible"
              role="img"
              aria-label={`${descriptor.label} keyframe graph`}
            >
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line
                  key={ratio}
                  x1={GRAPH_PADDING}
                  x2={GRAPH_WIDTH - GRAPH_PADDING}
                  y1={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  y2={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  stroke="var(--border)"
                  strokeDasharray="4 5"
                />
              ))}
              <line
                x1={playheadX}
                x2={playheadX}
                y1={GRAPH_PADDING}
                y2={GRAPH_HEIGHT - GRAPH_PADDING}
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
              {graph.path ? (
                <path
                  d={graph.path}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {graph.points.map((point) => (
                <KeyframeGraphPoint
                  key={point.id}
                  point={point}
                  active={
                    Math.abs(point.time - localPlayhead) <=
                    1 / Math.max(1, composition.frameRate)
                  }
                  layerStartTime={0}
                  onSeek={setPlayhead}
                  onDragStart={beginKeyframeDrag}
                  onDragMove={moveKeyframeDrag}
                  onDragEnd={endKeyframeDrag}
                />
              ))}
              {graph.points.length === 0 ? (
                <text
                  x={GRAPH_WIDTH / 2}
                  y={GRAPH_HEIGHT / 2}
                  fill="var(--fg-muted)"
                  textAnchor="middle"
                  className="text-[11px]"
                >
                  Add keyframes to draw a curve
                </text>
              ) : null}
            </svg>
            <div className="mt-1 flex items-center justify-between text-[10.5px] tabular-nums text-fg-muted">
              <span>0.00s</span>
              <span>{duration.toFixed(2)}s</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Value at playhead" hint={descriptor.unit}>
              <NumberInput
                value={currentValue}
                step={descriptor.step}
                min={descriptor.min}
                max={descriptor.max}
                onChange={(value) =>
                  replaceCamera(
                    upsertMotionCameraKeyframe(
                      enabledCamera,
                      property,
                      localPlayhead,
                      {
                        value,
                        easing: keyframeAtPlayhead?.easing ?? "ease",
                      },
                    ),
                  )
                }
              />
            </Field>
            <Field label="Base" hint={descriptor.unit}>
              <NumberInput
                value={baseValue}
                step={descriptor.step}
                min={descriptor.min}
                max={descriptor.max}
                onChange={(value) =>
                  replaceCamera(
                    setMotionCameraPropertyValue(enabledCamera, property, value),
                  )
                }
              />
            </Field>
          </div>
        </Section>

        <Section title="Keyframes" icon={Diamond}>
          <div className="space-y-1.5">
            <KeyframeTimingToolbar
              disabled={propertyKeyframes.length === 0}
              canPaste={Boolean(keyframeClipboard)}
              onApply={applyPropertyEasing}
              onCopy={copyPropertyKeyframes}
              onPaste={pastePropertyKeyframes}
              onDuplicate={duplicatePropertyKeyframes}
              onReverse={reversePropertyKeyframes}
              onScale={scalePropertyKeyframes}
            />
            {propertyKeyframes.length === 0 ? (
              <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                No keyframes on this camera property yet. Add one at the current
                playhead to shape the scene move.
              </ToolcraftText>
            ) : (
              propertyKeyframes.map((keyframe) => (
                <KeyframeRow
                  key={keyframe.id}
                  keyframe={keyframe}
                  descriptor={descriptor}
                  onUpdate={(updates) => updateKeyframe(keyframe.id, updates)}
                  onRemove={() =>
                    replaceCamera(removeMotionCameraKeyframe(enabledCamera, keyframe.id))
                  }
                />
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function LightGraphEditor({
  composition,
  light,
  selectedProperty,
  setSelectedProperty,
  playhead,
  setPlayhead,
  replaceLight,
  keyframeClipboard,
  setKeyframeClipboard,
  embedded = false,
}: {
  composition: MotionComposition;
  light: MotionLight;
  selectedProperty: string | null;
  setSelectedProperty: (property: string | null) => void;
  playhead: number;
  setPlayhead: (playhead: number) => void;
  replaceLight: (nextLight: MotionLight) => void;
  keyframeClipboard: MotionKeyframeClipboard | null;
  setKeyframeClipboard: (clipboard: MotionKeyframeClipboard | null) => void;
  embedded?: boolean;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const keyframeDragRef = useRef<{
    readonly pointerId: number;
    readonly keyframeId: string;
  } | null>(null);
  const property: MotionLightProperty =
    selectedProperty && isMotionLightProperty(selectedProperty)
      ? selectedProperty
      : "light.intensity";
  const descriptor = getMotionLightPropertyDescriptor(property);
  const propertyKeyframes = getMotionLightPropertyKeyframes(light, property);
  const duration = Math.max(composition.duration, 0.001);
  const localPlayhead = clamp(playhead, 0, duration);
  const animatedLight = getMotionLightAtTime(light, composition, localPlayhead);
  const currentValue = getMotionLightPropertyValue(animatedLight, property);
  const baseValue = getMotionLightPropertyValue(light, property);
  const keyframeAtPlayhead = propertyKeyframes.find(
    (keyframe) => Math.abs(keyframe.time - localPlayhead) <= 1 / 1000,
  );
  const graph = buildGraph(propertyKeyframes, currentValue, baseValue, duration);
  const playheadX =
    GRAPH_PADDING +
    (localPlayhead / duration) * (GRAPH_WIDTH - GRAPH_PADDING * 2);

  const updateKeyframe = (
    keyframeId: string,
    updates: Partial<Omit<Keyframe, "id" | "property">>,
  ) => {
    replaceLight({
      ...light,
      keyframes: sortMotionKeyframes(
        (light.keyframes ?? []).map((keyframe) =>
          keyframe.id === keyframeId ? { ...keyframe, ...updates } : keyframe,
        ),
      ),
    });
  };

  const applyPropertyEasing = (easing: EasingType) => {
    replaceLight({
      ...light,
      keyframes: sortMotionKeyframes(
        (light.keyframes ?? []).map((keyframe) =>
          keyframe.property === property ? { ...keyframe, easing } : keyframe,
        ),
      ),
    });
  };

  const duplicatePropertyKeyframes = (offset: number) => {
    replaceLight({
      ...light,
      keyframes: duplicateMotionPropertyKeyframes(
        light.keyframes ?? [],
        property,
        offset,
        { duration },
      ),
    });
  };

  const reversePropertyKeyframes = () => {
    replaceLight({
      ...light,
      keyframes: reverseMotionPropertyKeyframes(
        light.keyframes ?? [],
        property,
      ),
    });
  };

  const scalePropertyKeyframes = (scale: number) => {
    replaceLight({
      ...light,
      keyframes: scaleMotionPropertyKeyframeTimes(
        light.keyframes ?? [],
        property,
        scale,
        { duration },
      ),
    });
  };

  const copyPropertyKeyframes = () => {
    setKeyframeClipboard(
      copyMotionPropertyKeyframes(light.keyframes ?? [], property),
    );
  };

  const pastePropertyKeyframes = () => {
    if (!keyframeClipboard) return;
    replaceLight({
      ...light,
      keyframes: pasteMotionPropertyKeyframes(
        light.keyframes ?? [],
        property,
        keyframeClipboard,
        localPlayhead,
        { duration },
      ),
    });
  };

  const getGraphPointerPoint = (event: ReactPointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return { x: GRAPH_PADDING, y: GRAPH_PADDING };
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
    };
  };

  const beginKeyframeDrag = (
    keyframeId: string,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    keyframeDragRef.current = {
      pointerId: event.pointerId,
      keyframeId,
    };
    capturePointer(event);
  };

  const moveKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getGraphPointerPoint(event);
    const rawTime = graph.xToTime(point.x);
    const nextTime = event.altKey
      ? roundGraphValue(rawTime, 0.001)
      : snapTimeToFrame(rawTime, composition.frameRate);
    const nextValue = roundGraphValue(
      graph.yToValue(point.y),
      descriptor.step,
    );

    updateKeyframe(drag.keyframeId, {
      time: nextTime,
      value: nextValue,
    });
    setPlayhead(nextTime);
  };

  const endKeyframeDrag = (event: ReactPointerEvent<SVGElement>) => {
    if (keyframeDragRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      keyframeDragRef.current = null;
    }
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="Light Graph" icon={Activity} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={light.name} icon={ListTree}>
          <div className="grid grid-cols-2 gap-1.5">
            {MOTION_LIGHT_PROPERTY_DESCRIPTORS.map((item) => {
              const active = item.property === property;
              const count = getMotionLightPropertyKeyframes(
                light,
                item.property,
              ).length;
              return (
                <Button
                  key={item.property}
                  label={item.label}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setSelectedProperty(item.property)}
                  className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-bg-2 text-fg-3 hover:border-border-strong hover:bg-hover hover:text-fg"
                  }`}
                >
                  <span className="truncate text-[11.5px] font-medium">
                    {item.label}
                  </span>
                  <span className="rounded bg-bg-1 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted">
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
        </Section>

        <Section
          title={descriptor.label}
          icon={Activity}
          action={
            <div className="flex items-center gap-1">
              <IconButton
                icon={Plus}
                label={keyframeAtPlayhead ? "Update keyframe" : "Add keyframe"}
                size="sm"
                variant={keyframeAtPlayhead ? "solid" : "outline"}
                onClick={() =>
                  replaceLight(
                    upsertMotionLightKeyframe(light, property, localPlayhead, {
                      value: currentValue,
                      easing: keyframeAtPlayhead?.easing ?? "ease",
                    }),
                  )
                }
              />
              <IconButton
                icon={Trash2}
                label="Clear property keyframes"
                size="sm"
                variant="danger"
                disabled={propertyKeyframes.length === 0}
                onClick={() =>
                  replaceLight(removeMotionLightPropertyKeyframes(light, property))
                }
              />
            </div>
          }
        >
          <div className="rounded-lg border border-border bg-bg-2 p-2">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
              className="h-[148px] w-full overflow-visible"
              role="img"
              aria-label={`${descriptor.label} keyframe graph`}
            >
              {[0.25, 0.5, 0.75].map((ratio) => (
                <line
                  key={ratio}
                  x1={GRAPH_PADDING}
                  x2={GRAPH_WIDTH - GRAPH_PADDING}
                  y1={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  y2={GRAPH_PADDING + ratio * (GRAPH_HEIGHT - GRAPH_PADDING * 2)}
                  stroke="var(--border)"
                  strokeDasharray="4 5"
                />
              ))}
              <line
                x1={playheadX}
                x2={playheadX}
                y1={GRAPH_PADDING}
                y2={GRAPH_HEIGHT - GRAPH_PADDING}
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
              {graph.path ? (
                <path
                  d={graph.path}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {graph.points.map((point) => (
                <KeyframeGraphPoint
                  key={point.id}
                  point={point}
                  active={
                    Math.abs(point.time - localPlayhead) <=
                    1 / Math.max(1, composition.frameRate)
                  }
                  layerStartTime={0}
                  onSeek={setPlayhead}
                  onDragStart={beginKeyframeDrag}
                  onDragMove={moveKeyframeDrag}
                  onDragEnd={endKeyframeDrag}
                />
              ))}
              {graph.points.length === 0 ? (
                <text
                  x={GRAPH_WIDTH / 2}
                  y={GRAPH_HEIGHT / 2}
                  fill="var(--fg-muted)"
                  textAnchor="middle"
                  className="text-[11px]"
                >
                  Add keyframes to draw a curve
                </text>
              ) : null}
            </svg>
            <div className="mt-1 flex items-center justify-between text-[10.5px] tabular-nums text-fg-muted">
              <span>0.00s</span>
              <span>{duration.toFixed(2)}s</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Value at playhead" hint={descriptor.unit}>
              <NumberInput
                value={currentValue}
                step={descriptor.step}
                min={descriptor.min}
                max={descriptor.max}
                onChange={(value) =>
                  replaceLight(
                    upsertMotionLightKeyframe(light, property, localPlayhead, {
                      value,
                      easing: keyframeAtPlayhead?.easing ?? "ease",
                    }),
                  )
                }
              />
            </Field>
            <Field label="Base" hint={descriptor.unit}>
              <NumberInput
                value={baseValue}
                step={descriptor.step}
                min={descriptor.min}
                max={descriptor.max}
                onChange={(value) =>
                  replaceLight(setMotionLightPropertyValue(light, property, value))
                }
              />
            </Field>
          </div>
        </Section>

        <Section title="Keyframes" icon={Diamond}>
          <div className="space-y-1.5">
            <KeyframeTimingToolbar
              disabled={propertyKeyframes.length === 0}
              canPaste={Boolean(keyframeClipboard)}
              onApply={applyPropertyEasing}
              onCopy={copyPropertyKeyframes}
              onPaste={pastePropertyKeyframes}
              onDuplicate={duplicatePropertyKeyframes}
              onReverse={reversePropertyKeyframes}
              onScale={scalePropertyKeyframes}
            />
            {propertyKeyframes.length === 0 ? (
              <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                No keyframes on this light property yet. Add one at the current
                playhead to animate the scene lighting.
              </ToolcraftText>
            ) : (
              propertyKeyframes.map((keyframe) => (
                <KeyframeRow
                  key={keyframe.id}
                  keyframe={keyframe}
                  descriptor={descriptor}
                  onUpdate={(updates) => updateKeyframe(keyframe.id, updates)}
                  onRemove={() =>
                    replaceLight(removeMotionLightKeyframe(light, keyframe.id))
                  }
                />
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function KeyframeRow({
  keyframe,
  descriptor,
  onUpdate,
  onRemove,
  roving,
}: {
  keyframe: Keyframe;
  descriptor: { readonly step?: number; readonly unit?: string } | undefined;
  onUpdate: (updates: Partial<Omit<Keyframe, "id" | "property">>) => void;
  onRemove: () => void;
  roving?: {
    readonly enabled: boolean;
    readonly canRove: boolean;
    readonly onToggle: (next: boolean) => void;
  };
}): JSX.Element {
  const numericValue =
    typeof keyframe.value === "number" && Number.isFinite(keyframe.value)
      ? keyframe.value
      : 0;
  const isRoving = roving?.enabled === true;
  const roveDisabledTitle = roving?.canRove
    ? "Rove: derive this keyframe's time for constant speed between neighbors"
    : "The first and last keyframe of a property cannot rove";
  return (
    <div
      data-testid={`keyframe-row-${keyframe.id}`}
      className="space-y-1.5 rounded-md border border-border bg-bg-2 p-1.5"
    >
      <div className="grid grid-cols-[58px_minmax(0,1fr)_minmax(116px,0.9fr)_28px] items-center gap-1.5">
        <NumberInput
          value={keyframe.time}
          min={0}
          step={0.05}
          disabled={isRoving}
          onChange={(time) => onUpdate({ time })}
        />
        <NumberInput
          value={numericValue}
          step={descriptor?.step ?? 0.01}
          unit={descriptor?.unit}
          onChange={(value) => onUpdate({ value })}
        />
        <SelectInput
          value={keyframe.easing}
          options={EASING_OPTIONS}
          onChange={(easing) => onUpdate({ easing: easing as EasingType })}
        />
        <IconButton
          icon={Trash2}
          label="Delete keyframe"
          size="sm"
          variant="danger"
          onClick={onRemove}
        />
      </div>
      {roving ? (
        <div data-testid={`rove-switch-${keyframe.id}`} title={roveDisabledTitle}>
          <SwitchInput
            label="Rove"
            description="Auto-derive time for constant speed"
            checked={isRoving}
            disabled={!roving.canRove}
            onChange={roving.onToggle}
          />
        </div>
      ) : null}
    </div>
  );
}

function KeyframeTimingToolbar({
  disabled,
  canPaste,
  onApply,
  onCopy,
  onPaste,
  onDuplicate,
  onReverse,
  onScale,
}: {
  disabled: boolean;
  canPaste: boolean;
  onApply: (easing: EasingType) => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: (offset: number) => void;
  onReverse: () => void;
  onScale: (scale: number) => void;
}): JSX.Element {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg-2 p-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-1.5">
        <Field label="Set easing for property keys">
          <SelectInput
            value=""
            disabled={disabled}
            placeholder="Choose easing..."
            options={[{ value: "", label: "Choose easing..." }, ...EASING_OPTIONS]}
            onChange={(easing) => {
              if (!easing) return;
              onApply(easing as EasingType);
            }}
          />
        </Field>
        <IconButton
          icon={Copy}
          label="Copy property keyframes"
          size="md"
          variant="outline"
          disabled={disabled}
          onClick={onCopy}
        />
        <IconButton
          icon={ClipboardPaste}
          label="Paste keyframes at playhead"
          size="md"
          variant="outline"
          disabled={!canPaste}
          onClick={onPaste}
        />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <TimingToolButton
          label="+0.5s"
          title="Duplicate keys forward by half a second"
          disabled={disabled}
          onClick={() => onDuplicate(0.5)}
        />
        <TimingToolButton
          label="Reverse"
          title="Reverse keys inside their current time span"
          disabled={disabled}
          onClick={onReverse}
        />
        <TimingToolButton
          label="50%"
          title="Compress key timing to half speed span"
          disabled={disabled}
          onClick={() => onScale(0.5)}
        />
        <TimingToolButton
          label="200%"
          title="Stretch key timing to double speed span"
          disabled={disabled}
          onClick={() => onScale(2)}
        />
      </div>
    </div>
  );
}

function TimingToolButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      label={label}
      variant="secondary"
      size="sm"
      type="button"
      tooltip={title}
      isDisabled={disabled}
      onClick={onClick}
    />
  );
}

interface NumericSegment {
  readonly from: Keyframe & { readonly value: number };
  readonly to: Keyframe & { readonly value: number };
}

function buildNumericSegments(
  keyframes: readonly Keyframe[],
): NumericSegment[] {
  const numeric = keyframes
    .filter(
      (keyframe): keyframe is Keyframe & { readonly value: number } =>
        typeof keyframe.value === "number" && Number.isFinite(keyframe.value),
    )
    .slice()
    .sort((a, b) => a.time - b.time);
  const segments: NumericSegment[] = [];
  for (let index = 0; index < numeric.length - 1; index += 1) {
    segments.push({ from: numeric[index]!, to: numeric[index + 1]! });
  }
  return segments;
}

function buildGraph(
  keyframes: readonly Keyframe[],
  currentValue: number,
  baseValue: number,
  duration: number,
): {
  readonly path: string;
  readonly points: GraphPoint[];
  readonly xToTime: (x: number) => number;
  readonly yToValue: (y: number) => number;
  readonly yToValueUnclamped: (y: number) => number;
  readonly timeToX: (time: number) => number;
  readonly valueToY: (value: number) => number;
} {
  const numericKeyframes = keyframes
    .map((keyframe) => ({
      ...keyframe,
      value: typeof keyframe.value === "number" ? keyframe.value : Number.NaN,
    }))
    .filter((keyframe) => Number.isFinite(keyframe.value))
    .sort((a, b) => a.time - b.time);
  const values = numericKeyframes.map((keyframe) => keyframe.value);
  const seedValues = values.length > 0 ? values : [currentValue, baseValue];
  const minValue = Math.min(...seedValues);
  const maxValue = Math.max(...seedValues);
  const span = Math.max(maxValue - minValue, Math.abs(maxValue) * 0.2, 1);
  const min = minValue - span * 0.18;
  const max = maxValue + span * 0.18;
  const graphWidth = GRAPH_WIDTH - GRAPH_PADDING * 2;
  const graphHeight = GRAPH_HEIGHT - GRAPH_PADDING * 2;
  const valueToY = (value: number) =>
    GRAPH_PADDING + (1 - (value - min) / Math.max(max - min, 0.001)) * graphHeight;
  const xToTime = (x: number) =>
    clamp((clamp(x, GRAPH_PADDING, GRAPH_WIDTH - GRAPH_PADDING) - GRAPH_PADDING) / graphWidth, 0, 1) *
    duration;
  const yToValue = (y: number) => {
    const ratio = clamp(
      (clamp(y, GRAPH_PADDING, GRAPH_HEIGHT - GRAPH_PADDING) - GRAPH_PADDING) /
        graphHeight,
      0,
      1,
    );
    return max - ratio * Math.max(max - min, 0.001);
  };
  const yToValueUnclamped = (y: number) => {
    const ratio = (y - GRAPH_PADDING) / graphHeight;
    return max - ratio * Math.max(max - min, 0.001);
  };

  const points = numericKeyframes.map((keyframe) => ({
    id: keyframe.id,
    time: keyframe.time,
    x: GRAPH_PADDING + (clamp(keyframe.time, 0, duration) / duration) * graphWidth,
    y: valueToY(keyframe.value),
    roving: keyframe.roving === true,
  }));

  const timeToX = (time: number) =>
    GRAPH_PADDING + (clamp(time, 0, duration) / duration) * graphWidth;
  const path = buildEasedGraphPath(
    numericKeyframes,
    duration,
    timeToX,
    valueToY,
  );

  return {
    path,
    points,
    xToTime,
    yToValue,
    yToValueUnclamped,
    timeToX,
    valueToY,
  };
}

function buildEasedGraphPath(
  keyframes: readonly (Keyframe & { readonly value: number })[],
  duration: number,
  timeToX: (time: number) => number,
  valueToY: (value: number) => number,
): string {
  if (keyframes.length === 0) return "";
  if (keyframes.length === 1) {
    const only = keyframes[0];
    return `M ${timeToX(only.time)} ${valueToY(only.value)}`;
  }

  const commands: string[] = [];
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    const segmentDuration = Math.max(0.001, to.time - from.time);
    if (from.easing === "hold") {
      const startX = roundGraphCoordinate(timeToX(from.time));
      const endX = roundGraphCoordinate(timeToX(to.time));
      const fromY = roundGraphCoordinate(valueToY(from.value));
      const toY = roundGraphCoordinate(valueToY(to.value));
      if (commands.length === 0) {
        commands.push(`M ${startX} ${fromY}`);
      } else if (index > 0) {
        commands.push(`L ${startX} ${fromY}`);
      }
      commands.push(`L ${endX} ${fromY}`);
      commands.push(`L ${endX} ${toY}`);
      continue;
    }
    const sampleCount = Math.max(
      8,
      Math.ceil((segmentDuration / Math.max(0.001, duration)) * 96),
    );

    for (let sample = 0; sample <= sampleCount; sample += 1) {
      if (index > 0 && sample === 0) continue;
      const progress = sample / sampleCount;
      const easedProgress = applyGraphEasing(progress, from.easing);
      const time = from.time + segmentDuration * progress;
      const value = from.value + (to.value - from.value) * easedProgress;
      commands.push(
        `${commands.length === 0 ? "M" : "L"} ${roundGraphCoordinate(
          timeToX(time),
        )} ${roundGraphCoordinate(valueToY(value))}`,
      );
    }
  }
  return commands.join(" ");
}

function applyGraphEasing(progress: number, easing: EasingType): number {
  const easingFn =
    easing in EASING_FUNCTIONS
      ? EASING_FUNCTIONS[easing as keyof typeof EASING_FUNCTIONS]
      : EASING_FUNCTIONS.linear;
  return easingFn(clamp(progress, 0, 1));
}

function roundGraphCoordinate(value: number): number {
  return Number(value.toFixed(3));
}

function snapTimeToFrame(time: number, frameRate: number): number {
  const safeFrameRate =
    Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  return roundGraphValue(Math.max(0, time), 1 / safeFrameRate);
}

function roundGraphValue(value: number, step: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0.001;
  return Number((Math.round(value / safeStep) * safeStep).toFixed(4));
}

function formatEasingName(easing: string): string {
  return easing
    .replace(/^ease/, "Ease")
    .replace(/-/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
