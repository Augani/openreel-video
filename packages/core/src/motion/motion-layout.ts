import type { MotionComposition, MotionLayer, MotionVector2 } from "./types";
import { getMotionLayerVisualBounds } from "./motion-masks";

export type MotionLayerAlignment =
  | "left"
  | "center-x"
  | "right"
  | "top"
  | "center-y"
  | "bottom";

export type MotionLayerDistributionAxis = "horizontal" | "vertical";
export type MotionLayerLayoutReference = "selection" | "composition";
export type MotionLayerResizeHandle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "nw"
  | "ne"
  | "sw"
  | "se";

export interface MotionLayerLayoutBounds {
  readonly layerId: string;
  readonly left: number;
  readonly centerX: number;
  readonly right: number;
  readonly top: number;
  readonly centerY: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface MotionLayerAlignmentOptions {
  readonly relativeTo?: MotionLayerLayoutReference;
  readonly includeLocked?: boolean;
}

export interface MotionLayerDistributionOptions {
  readonly includeLocked?: boolean;
}

export interface ResizeMotionLayerOptions {
  readonly minSize?: number;
  readonly preserveAspect?: boolean;
  readonly resizeFromCenter?: boolean;
}

export interface RotateMotionLayerOptions {
  readonly snapDegrees?: number;
}

export function getMotionLayerLayoutBounds(
  layer: MotionLayer,
): MotionLayerLayoutBounds {
  const local = getMotionLayerVisualBounds(layer);
  const scaleX = finiteOr(layer.transform.scale.x, 1);
  const scaleY = finiteOr(layer.transform.scale.y, 1);
  const x1 = layer.transform.position.x + local.x * scaleX;
  const x2 = layer.transform.position.x + (local.x + local.width) * scaleX;
  const y1 = layer.transform.position.y + local.y * scaleY;
  const y2 = layer.transform.position.y + (local.y + local.height) * scaleY;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  return {
    layerId: layer.id,
    left: roundLayoutValue(left),
    centerX: roundLayoutValue((left + right) / 2),
    right: roundLayoutValue(right),
    top: roundLayoutValue(top),
    centerY: roundLayoutValue((top + bottom) / 2),
    bottom: roundLayoutValue(bottom),
    width: roundLayoutValue(right - left),
    height: roundLayoutValue(bottom - top),
  };
}

export function getMotionLayerSelectionBounds(
  layers: readonly MotionLayer[],
  layerIds: readonly string[],
): MotionLayerLayoutBounds | null {
  const selected = new Set(layerIds);
  const bounds = layers
    .filter((layer) => selected.has(layer.id))
    .map(getMotionLayerLayoutBounds);

  if (bounds.length === 0) return null;
  return combineLayoutBounds("selection", bounds);
}

export function alignMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  alignment: MotionLayerAlignment,
  options: MotionLayerAlignmentOptions = {},
): MotionComposition {
  const selectedIds = new Set(layerIds);
  if (selectedIds.size === 0) return composition;

  const selectedBounds =
    options.relativeTo === "composition"
      ? createCompositionBounds(composition)
      : getMotionLayerSelectionBounds(composition.layers, layerIds);
  if (!selectedBounds) return composition;

  let changed = false;
  const layers = composition.layers.map((layer) => {
    if (!selectedIds.has(layer.id) || (layer.locked && !options.includeLocked)) {
      return layer;
    }
    const bounds = getMotionLayerLayoutBounds(layer);
    const delta = getAlignmentDelta(bounds, selectedBounds, alignment);
    if (delta.x === 0 && delta.y === 0) return layer;
    changed = true;
    return moveMotionLayerBy(layer, delta.x, delta.y);
  });

  return changed ? { ...composition, layers, modifiedAt: Date.now() } : composition;
}

export function distributeMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  axis: MotionLayerDistributionAxis,
  options: MotionLayerDistributionOptions = {},
): MotionComposition {
  const selectedIds = new Set(layerIds);
  if (selectedIds.size < 3) return composition;

  const selected = composition.layers
    .filter((layer) => selectedIds.has(layer.id))
    .map((layer) => ({ layer, bounds: getMotionLayerLayoutBounds(layer) }))
    .sort((a, b) =>
      axis === "horizontal"
        ? a.bounds.centerX - b.bounds.centerX
        : a.bounds.centerY - b.bounds.centerY,
    );
  if (selected.length < 3) return composition;

  const first = selected[0]?.bounds;
  const last = selected[selected.length - 1]?.bounds;
  if (!first || !last) return composition;

  const firstCenter = axis === "horizontal" ? first.centerX : first.centerY;
  const lastCenter = axis === "horizontal" ? last.centerX : last.centerY;
  const step = (lastCenter - firstCenter) / (selected.length - 1);
  const targetCenters = new Map<string, number>();

  selected.forEach(({ layer }, index) => {
    targetCenters.set(layer.id, roundLayoutValue(firstCenter + step * index));
  });

  let changed = false;
  const layers = composition.layers.map((layer) => {
    const targetCenter = targetCenters.get(layer.id);
    if (
      targetCenter == null ||
      (layer.locked && !options.includeLocked) ||
      layer.id === selected[0]?.layer.id ||
      layer.id === selected[selected.length - 1]?.layer.id
    ) {
      return layer;
    }

    const bounds = getMotionLayerLayoutBounds(layer);
    const currentCenter = axis === "horizontal" ? bounds.centerX : bounds.centerY;
    const delta = roundLayoutValue(targetCenter - currentCenter);
    if (delta === 0) return layer;
    changed = true;
    return axis === "horizontal"
      ? moveMotionLayerBy(layer, delta, 0)
      : moveMotionLayerBy(layer, 0, delta);
  });

  return changed ? { ...composition, layers, modifiedAt: Date.now() } : composition;
}

export function resizeMotionLayerByHandle<T extends MotionLayer>(
  layer: T,
  handle: MotionLayerResizeHandle,
  delta: MotionVector2,
  options: ResizeMotionLayerOptions = {},
): T {
  const bounds = getMotionLayerLayoutBounds(layer);
  const minSize = Math.max(1, options.minSize ?? 8);
  const resizedBounds = resizeLayoutBounds(bounds, handle, delta, options);
  const { left, right, top, bottom } = resizedBounds;

  const width = Math.max(minSize, right - left);
  const height = Math.max(minSize, bottom - top);
  const currentScaleX = finiteOr(layer.transform.scale.x, 1);
  const currentScaleY = finiteOr(layer.transform.scale.y, 1);
  const scaleX = scaleFromResizedSpan(currentScaleX, width, bounds.width);
  const scaleY = scaleFromResizedSpan(currentScaleY, height, bounds.height);

  return {
    ...layer,
    transform: {
      ...layer.transform,
      position: {
        x: roundLayoutValue((left + right) / 2),
        y: roundLayoutValue((top + bottom) / 2),
      },
      scale: {
        x: roundLayoutValue(scaleX),
        y: roundLayoutValue(scaleY),
      },
    },
  } as T;
}

/** Resize several layers as one selection while preserving their relative layout. */
export function resizeMotionLayerSelectionByHandle<T extends MotionLayer>(
  layers: readonly T[],
  handle: MotionLayerResizeHandle,
  delta: MotionVector2,
  options: ResizeMotionLayerOptions = {},
): T[] {
  const editableLayers = layers.filter((layer) => !layer.locked);
  const bounds = getMotionLayerSelectionBounds(
    editableLayers,
    editableLayers.map((layer) => layer.id),
  );
  if (!bounds) return [...layers];

  const resized = resizeLayoutBounds(bounds, handle, delta, options);
  const widthRatio = bounds.width > 0 ? resized.width / bounds.width : 1;
  const heightRatio = bounds.height > 0 ? resized.height / bounds.height : 1;
  const editableIds = new Set(editableLayers.map((layer) => layer.id));

  return layers.map((layer) => {
    if (!editableIds.has(layer.id)) return layer;
    const layerBounds = getMotionLayerLayoutBounds(layer);
    const relativeX = bounds.width > 0
      ? (layerBounds.centerX - bounds.left) / bounds.width
      : 0.5;
    const relativeY = bounds.height > 0
      ? (layerBounds.centerY - bounds.top) / bounds.height
      : 0.5;
    const nextBoundsCenterX = resized.left + relativeX * resized.width;
    const nextBoundsCenterY = resized.top + relativeY * resized.height;
    return {
      ...layer,
      transform: {
        ...layer.transform,
        position: {
          x: roundLayoutValue(
            layer.transform.position.x + nextBoundsCenterX - layerBounds.centerX,
          ),
          y: roundLayoutValue(
            layer.transform.position.y + nextBoundsCenterY - layerBounds.centerY,
          ),
        },
        scale: {
          x: roundLayoutValue(layer.transform.scale.x * widthRatio),
          y: roundLayoutValue(layer.transform.scale.y * heightRatio),
        },
      },
    } as T;
  });
}

/** Rotate several layers around their shared selection center. */
export function rotateMotionLayerSelectionByPointer<T extends MotionLayer>(
  layers: readonly T[],
  center: MotionVector2,
  startPointer: MotionVector2,
  currentPointer: MotionVector2,
  options: RotateMotionLayerOptions = {},
): T[] {
  const editableIds = new Set(
    layers.filter((layer) => !layer.locked).map((layer) => layer.id),
  );
  const rawDelta = angleBetween(center, currentPointer) - angleBetween(center, startPointer);
  const delta = options.snapDegrees && options.snapDegrees > 0
    ? Math.round(rawDelta / options.snapDegrees) * options.snapDegrees
    : rawDelta;
  const radians = (delta * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return layers.map((layer) => {
    if (!editableIds.has(layer.id)) return layer;
    const offsetX = layer.transform.position.x - center.x;
    const offsetY = layer.transform.position.y - center.y;
    return {
      ...layer,
      transform: {
        ...layer.transform,
        position: {
          x: roundLayoutValue(center.x + offsetX * cosine - offsetY * sine),
          y: roundLayoutValue(center.y + offsetX * sine + offsetY * cosine),
        },
        rotation: roundLayoutValue(layer.transform.rotation + delta),
      },
    } as T;
  });
}

function resizeLayoutBounds(
  bounds: MotionLayerLayoutBounds,
  handle: MotionLayerResizeHandle,
  delta: MotionVector2,
  options: ResizeMotionLayerOptions,
): MotionLayerLayoutBounds {
  const minSize = Math.max(1, options.minSize ?? 8);
  let left = bounds.left;
  let right = bounds.right;
  let top = bounds.top;
  let bottom = bounds.bottom;

  const affectsWest = handle.includes("w");
  const affectsEast = handle.includes("e");
  const affectsNorth = handle.includes("n");
  const affectsSouth = handle.includes("s");

  if (options.resizeFromCenter) {
    if (affectsWest) {
      left += delta.x;
      right -= delta.x;
    } else if (affectsEast) {
      left -= delta.x;
      right += delta.x;
    }

    if (affectsNorth) {
      top += delta.y;
      bottom -= delta.y;
    } else if (affectsSouth) {
      top -= delta.y;
      bottom += delta.y;
    }
  } else {
    if (affectsWest) left += delta.x;
    if (affectsEast) right += delta.x;
    if (affectsNorth) top += delta.y;
    if (affectsSouth) bottom += delta.y;
  }

  ({ left, right } = enforceMinimumSpan(left, right, minSize, {
    fromCenter: options.resizeFromCenter,
    anchorStart: affectsEast,
    anchorEnd: affectsWest,
  }));
  ({ left: top, right: bottom } = enforceMinimumSpan(top, bottom, minSize, {
    fromCenter: options.resizeFromCenter,
    anchorStart: affectsSouth,
    anchorEnd: affectsNorth,
  }));

  if (options.preserveAspect && bounds.width > 0 && bounds.height > 0) {
    ({ left, right, top, bottom } = preserveResizeAspect(
      { left, right, top, bottom },
      bounds,
      handle,
      Boolean(options.resizeFromCenter),
      minSize,
    ));
  }

  return combineLayoutBounds(bounds.layerId, [
    {
      ...bounds,
      left,
      right,
      top,
      bottom,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    },
  ]);
}

export function rotateMotionLayerByPointer<T extends MotionLayer>(
  layer: T,
  center: MotionVector2,
  startPointer: MotionVector2,
  currentPointer: MotionVector2,
  options: RotateMotionLayerOptions = {},
): T {
  const startAngle = angleBetween(center, startPointer);
  const currentAngle = angleBetween(center, currentPointer);
  const delta = currentAngle - startAngle;
  const rawRotation = layer.transform.rotation + delta;
  const rotation =
    options.snapDegrees && options.snapDegrees > 0
      ? Math.round(rawRotation / options.snapDegrees) * options.snapDegrees
      : rawRotation;

  return {
    ...layer,
    transform: {
      ...layer.transform,
      rotation: roundLayoutValue(rotation),
    },
  } as T;
}

function getAlignmentDelta(
  bounds: MotionLayerLayoutBounds,
  target: MotionLayerLayoutBounds,
  alignment: MotionLayerAlignment,
): { readonly x: number; readonly y: number } {
  switch (alignment) {
    case "left":
      return { x: roundLayoutValue(target.left - bounds.left), y: 0 };
    case "center-x":
      return { x: roundLayoutValue(target.centerX - bounds.centerX), y: 0 };
    case "right":
      return { x: roundLayoutValue(target.right - bounds.right), y: 0 };
    case "top":
      return { x: 0, y: roundLayoutValue(target.top - bounds.top) };
    case "center-y":
      return { x: 0, y: roundLayoutValue(target.centerY - bounds.centerY) };
    case "bottom":
      return { x: 0, y: roundLayoutValue(target.bottom - bounds.bottom) };
  }
}

function moveMotionLayerBy<T extends MotionLayer>(layer: T, x: number, y: number): T {
  return {
    ...layer,
    transform: {
      ...layer.transform,
      position: {
        x: roundLayoutValue(layer.transform.position.x + x),
        y: roundLayoutValue(layer.transform.position.y + y),
      },
    },
  } as T;
}

function enforceMinimumSpan(
  start: number,
  end: number,
  minSize: number,
  options: {
    readonly fromCenter?: boolean;
    readonly anchorStart?: boolean;
    readonly anchorEnd?: boolean;
  },
): { readonly left: number; readonly right: number } {
  if (end - start >= minSize) {
    return { left: start, right: end };
  }

  if (options.fromCenter) {
    const center = (start + end) / 2;
    return { left: center - minSize / 2, right: center + minSize / 2 };
  }

  if (options.anchorStart) {
    return { left: start, right: start + minSize };
  }

  if (options.anchorEnd) {
    return { left: end - minSize, right: end };
  }

  return { left: start, right: start + minSize };
}

function preserveResizeAspect(
  edges: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
  original: MotionLayerLayoutBounds,
  handle: MotionLayerResizeHandle,
  fromCenter: boolean,
  minSize: number,
): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const aspect = original.width / original.height;
  const width = Math.max(minSize, edges.right - edges.left);
  const height = Math.max(minSize, edges.bottom - edges.top);
  const widthRatio = Math.abs(width - original.width) / original.width;
  const heightRatio = Math.abs(height - original.height) / original.height;
  const widthDriven =
    handle === "e" || handle === "w" || widthRatio >= heightRatio;

  if (widthDriven) {
    return setResizeHeight(edges, width / aspect, handle, fromCenter);
  }
  return setResizeWidth(edges, height * aspect, handle, fromCenter);
}

function setResizeWidth(
  edges: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
  width: number,
  handle: MotionLayerResizeHandle,
  fromCenter: boolean,
) {
  if (fromCenter || (!handle.includes("e") && !handle.includes("w"))) {
    const center = (edges.left + edges.right) / 2;
    return { ...edges, left: center - width / 2, right: center + width / 2 };
  }
  if (handle.includes("w")) {
    return { ...edges, left: edges.right - width };
  }
  return { ...edges, right: edges.left + width };
}

function setResizeHeight(
  edges: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
  height: number,
  handle: MotionLayerResizeHandle,
  fromCenter: boolean,
) {
  if (fromCenter || (!handle.includes("n") && !handle.includes("s"))) {
    const center = (edges.top + edges.bottom) / 2;
    return { ...edges, top: center - height / 2, bottom: center + height / 2 };
  }
  if (handle.includes("n")) {
    return { ...edges, top: edges.bottom - height };
  }
  return { ...edges, bottom: edges.top + height };
}

function scaleFromResizedSpan(
  currentScale: number,
  resizedSpan: number,
  currentSpan: number,
): number {
  if (currentSpan <= 0) return currentScale;
  const sign = currentScale < 0 ? -1 : 1;
  const magnitude = Math.abs(currentScale) * (resizedSpan / currentSpan);
  return sign * Math.max(0.0001, magnitude);
}

function angleBetween(center: MotionVector2, point: MotionVector2): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function createCompositionBounds(
  composition: MotionComposition,
): MotionLayerLayoutBounds {
  return {
    layerId: composition.id,
    left: 0,
    centerX: roundLayoutValue(composition.width / 2),
    right: composition.width,
    top: 0,
    centerY: roundLayoutValue(composition.height / 2),
    bottom: composition.height,
    width: composition.width,
    height: composition.height,
  };
}

function combineLayoutBounds(
  layerId: string,
  bounds: readonly MotionLayerLayoutBounds[],
): MotionLayerLayoutBounds {
  const left = Math.min(...bounds.map((item) => item.left));
  const right = Math.max(...bounds.map((item) => item.right));
  const top = Math.min(...bounds.map((item) => item.top));
  const bottom = Math.max(...bounds.map((item) => item.bottom));
  return {
    layerId,
    left: roundLayoutValue(left),
    centerX: roundLayoutValue((left + right) / 2),
    right: roundLayoutValue(right),
    top: roundLayoutValue(top),
    centerY: roundLayoutValue((top + bottom) / 2),
    bottom: roundLayoutValue(bottom),
    width: roundLayoutValue(right - left),
    height: roundLayoutValue(bottom - top),
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function roundLayoutValue(value: number): number {
  return Number(value.toFixed(4));
}
