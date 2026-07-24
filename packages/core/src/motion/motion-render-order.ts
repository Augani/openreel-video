import type {
  MotionComposition,
  MotionLayer,
  MotionTransform,
} from "./types";
import { applyMotionCameraToTransform } from "./motion-camera";
import { motionLayerMayUse3D } from "./motion-3d-transform";
import {
  evaluateMotionPropertyValueAtTime,
  type MotionExpressionContext,
} from "./motion-expressions";
import { resolveMotionLayerVariableBindings } from "./motion-variable-bindings";

export interface MotionRenderOrderOptions {
  readonly variableOverrides?: Record<string, string | number | boolean>;
}

interface MotionLayerRenderOrderItem {
  readonly layer: MotionLayer;
  readonly index: number;
  readonly depth: number;
  readonly uses3d: boolean;
}

const DEPTH_EPSILON = 1 / 1_000_000;

export function orderMotionLayersForRender(
  composition: MotionComposition,
  layers: readonly MotionLayer[],
  compositionTime: number,
  options: MotionRenderOrderOptions = {},
): MotionLayer[] {
  const orderedLayers: MotionLayer[] = [];
  let segment: MotionLayer[] = [];

  const flushSegment = () => {
    if (segment.length > 0) {
      orderedLayers.push(
        ...sortMotionLayerRenderSegment(
          composition,
          segment,
          compositionTime,
          options,
        ),
      );
      segment = [];
    }
  };

  for (const layer of layers) {
    if (layer.type === "adjustment") {
      flushSegment();
      orderedLayers.push(layer);
    } else {
      segment.push(layer);
    }
  }

  flushSegment();
  return orderedLayers;
}

export function getMotionLayerRenderDepth(
  composition: MotionComposition,
  sourceLayer: MotionLayer,
  compositionTime: number,
  options: MotionRenderOrderOptions = {},
): number {
  const layer = resolveMotionLayerVariableBindings(
    composition,
    sourceLayer,
    options.variableOverrides,
  );
  const localTime = compositionTime - layer.startTime;
  const transform = evaluateMotionTransformAtTime(
    layer.transform,
    layer.keyframes,
    localTime,
    layer.expressions,
    layer.duration,
    { composition, layer },
  );
  return applyMotionCameraToTransform(
    composition,
    transform,
    compositionTime,
  ).position.z ?? 0;
}

function sortMotionLayerRenderSegment(
  composition: MotionComposition,
  layers: readonly MotionLayer[],
  compositionTime: number,
  options: MotionRenderOrderOptions,
): MotionLayer[] {
  const items = layers.map<MotionLayerRenderOrderItem>((sourceLayer, index) => {
    const layer = resolveMotionLayerVariableBindings(
      composition,
      sourceLayer,
      options.variableOverrides,
    );
    const depth = getMotionLayerRenderDepth(
      composition,
      sourceLayer,
      compositionTime,
      options,
    );
    return {
      layer: sourceLayer,
      index,
      depth,
      uses3d: motionLayerMayUse3D(layer) || Math.abs(depth) > DEPTH_EPSILON,
    };
  });

  if (!items.some((item) => item.uses3d)) {
    return [...layers];
  }

  return items
    .sort((a, b) => {
      const depthDelta = a.depth - b.depth;
      if (Math.abs(depthDelta) > DEPTH_EPSILON) return depthDelta;
      return a.index - b.index;
    })
    .map((item) => item.layer);
}

function evaluateMotionTransformAtTime(
  base: MotionTransform,
  keyframes: MotionLayer["keyframes"],
  localTime: number,
  expressions: MotionLayer["expressions"] = [],
  duration = Number.POSITIVE_INFINITY,
  context?: MotionExpressionContext,
): MotionTransform {
  const value = (property: string, fallback: number): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes,
      expressions,
      property,
      localTime,
      fallback,
      duration,
      context,
    });

  return {
    position: {
      x: value("transform.position.x", base.position.x),
      y: value("transform.position.y", base.position.y),
      z: value("transform.position.z", base.position.z ?? 0),
    },
    scale: {
      x: value("transform.scale.x", base.scale.x),
      y: value("transform.scale.y", base.scale.y),
    },
    rotation: value("transform.rotation", base.rotation),
    rotation3d: {
      x: value("transform.rotation.x", base.rotation3d?.x ?? 0),
      y: value("transform.rotation.y", base.rotation3d?.y ?? 0),
    },
    anchor: {
      x: value("transform.anchor.x", base.anchor.x),
      y: value("transform.anchor.y", base.anchor.y),
    },
    opacity: value("transform.opacity", base.opacity),
    perspective: value("transform.perspective", base.perspective ?? 1000),
    transformStyle: base.transformStyle,
  };
}
