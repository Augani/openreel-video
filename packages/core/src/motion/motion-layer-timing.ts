import type { MotionComposition, MotionLayer } from "./types";
import { removeMotionLayers } from "./motion-layer-commands";

export interface MotionLayerTimingOptions {
  readonly compositionDuration?: number;
  readonly frameRate?: number;
  readonly minDuration?: number;
}

export interface SequenceMotionLayersOptions extends MotionLayerTimingOptions {
  readonly layerIds: readonly string[];
  readonly startTime?: number;
  readonly gap?: number;
}

export interface StaggerMotionLayersOptions extends MotionLayerTimingOptions {
  readonly layerIds: readonly string[];
  readonly startTime?: number;
  readonly offset?: number;
}

export interface AlignMotionLayersToTimeOptions extends MotionLayerTimingOptions {
  readonly layerIds: readonly string[];
  readonly time: number;
  readonly edge: "in" | "out";
}

export interface FitMotionLayersToRangeOptions extends MotionLayerTimingOptions {
  readonly layerIds: readonly string[];
  readonly startTime: number;
  readonly endTime: number;
  readonly scaleKeyframes?: boolean;
}

const DEFAULT_MIN_DURATION = 1 / 30;

export function moveMotionLayerInTime<T extends MotionLayer>(
  layer: T,
  startTime: number,
  options: MotionLayerTimingOptions = {},
): T {
  const minDuration = getMinDuration(options);
  const maxStart =
    options.compositionDuration == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, options.compositionDuration - Math.max(layer.duration, minDuration));
  return {
    ...layer,
    startTime: snapTime(clampFinite(startTime, 0, maxStart), options.frameRate),
  } as T;
}

export function trimMotionLayerInPoint<T extends MotionLayer>(
  layer: T,
  startTime: number,
  options: MotionLayerTimingOptions = {},
): T {
  const minDuration = getMinDuration(options);
  const endTime = layer.startTime + layer.duration;
  const nextStart = snapTime(
    clampFinite(startTime, 0, Math.max(0, endTime - minDuration)),
    options.frameRate,
  );
  return {
    ...layer,
    startTime: nextStart,
    duration: snapDuration(endTime - nextStart, options),
  } as T;
}

export function trimMotionLayerOutPoint<T extends MotionLayer>(
  layer: T,
  endTime: number,
  options: MotionLayerTimingOptions = {},
): T {
  const minDuration = getMinDuration(options);
  const maxEnd =
    options.compositionDuration == null
      ? Number.POSITIVE_INFINITY
      : Math.max(layer.startTime + minDuration, options.compositionDuration);
  const nextEnd = snapTime(
    clampFinite(endTime, layer.startTime + minDuration, maxEnd),
    options.frameRate,
  );
  return {
    ...layer,
    duration: snapDuration(nextEnd - layer.startTime, options),
  } as T;
}

export function updateMotionCompositionLayerTiming(
  composition: MotionComposition,
  layerId: string,
  updater: (layer: MotionLayer) => MotionLayer,
): MotionComposition {
  return {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === layerId ? updater(layer) : layer,
    ),
    modifiedAt: Date.now(),
  };
}

export function sequenceMotionLayers(
  composition: MotionComposition,
  options: SequenceMotionLayersOptions,
): MotionComposition {
  const selectedIds = new Set(options.layerIds);
  let cursor = snapTime(options.startTime ?? 0, options.frameRate);
  const gap = options.gap ?? 0;

  return {
    ...composition,
    layers: composition.layers.map((layer) => {
      if (!selectedIds.has(layer.id)) return layer;
      const nextLayer = moveMotionLayerInTime(layer, cursor, {
        compositionDuration: options.compositionDuration,
        frameRate: options.frameRate,
        minDuration: options.minDuration,
      });
      cursor = nextLayer.startTime + nextLayer.duration + gap;
      return nextLayer;
    }),
    modifiedAt: Date.now(),
  };
}

export function staggerMotionLayers(
  composition: MotionComposition,
  options: StaggerMotionLayersOptions,
): MotionComposition {
  const selectedIds = new Set(options.layerIds);
  const startTime = options.startTime ?? 0;
  const offset = options.offset ?? 0.1;
  let selectedIndex = 0;

  return {
    ...composition,
    layers: composition.layers.map((layer) => {
      if (!selectedIds.has(layer.id)) return layer;
      const nextLayer = moveMotionLayerInTime(
        layer,
        startTime + selectedIndex * offset,
        {
          compositionDuration: options.compositionDuration,
          frameRate: options.frameRate,
          minDuration: options.minDuration,
        },
      );
      selectedIndex++;
      return nextLayer;
    }),
    modifiedAt: Date.now(),
  };
}

export function alignMotionLayersToTime(
  composition: MotionComposition,
  options: AlignMotionLayersToTimeOptions,
): MotionComposition {
  const selectedIds = new Set(options.layerIds);
  const targetTime = snapTime(options.time, options.frameRate);

  return {
    ...composition,
    layers: composition.layers.map((layer) => {
      if (!selectedIds.has(layer.id)) return layer;
      const targetStart =
        options.edge === "out" ? targetTime - layer.duration : targetTime;
      return moveMotionLayerInTime(layer, targetStart, {
        compositionDuration: options.compositionDuration,
        frameRate: options.frameRate,
        minDuration: options.minDuration,
      });
    }),
    modifiedAt: Date.now(),
  };
}

export function fitMotionLayersToRange(
  composition: MotionComposition,
  options: FitMotionLayersToRangeOptions,
): MotionComposition {
  const selectedIds = new Set(options.layerIds);
  const selectedLayers = composition.layers.filter((layer) =>
    selectedIds.has(layer.id),
  );
  if (selectedLayers.length === 0) return composition;

  const minDuration = getMinDuration(options);
  const sourceStart = Math.min(...selectedLayers.map((layer) => layer.startTime));
  const sourceEnd = Math.max(
    ...selectedLayers.map((layer) => layer.startTime + layer.duration),
  );
  const sourceSpan = Math.max(minDuration, sourceEnd - sourceStart);
  const targetStart = snapTime(Math.min(options.startTime, options.endTime), options.frameRate);
  const targetEnd = snapTime(Math.max(options.startTime, options.endTime), options.frameRate);
  const targetSpan = Math.max(minDuration, targetEnd - targetStart);
  const scale = targetSpan / sourceSpan;

  return {
    ...composition,
    layers: composition.layers.map((layer) => {
      if (!selectedIds.has(layer.id)) return layer;
      const nextStart = snapTime(
        targetStart + (layer.startTime - sourceStart) * scale,
        options.frameRate,
      );
      const nextDuration = snapDuration(layer.duration * scale, options);
      const boundedLayer = moveMotionLayerInTime(
        {
          ...layer,
          duration: nextDuration,
          keyframes:
            options.scaleKeyframes === false
              ? layer.keyframes
              : layer.keyframes.map((keyframe) => ({
                  ...keyframe,
                  time: Math.min(
                    nextDuration,
                    snapTime(keyframe.time * scale, options.frameRate),
                  ),
                })),
        },
        nextStart,
        {
          compositionDuration: options.compositionDuration,
          frameRate: options.frameRate,
          minDuration,
        },
      );
      return boundedLayer;
    }),
    modifiedAt: Date.now(),
  };
}

export interface SplitMotionLayerOptions extends MotionLayerTimingOptions {
  readonly idFactory?: () => string;
  readonly keyframeIdFactory?: () => string;
  readonly nameSuffix?: string;
}

let splitFallbackCounter = 0;

export function splitMotionLayerAtTime(
  composition: MotionComposition,
  layerId: string,
  time: number,
  options: SplitMotionLayerOptions = {},
): MotionComposition | null {
  const target = composition.layers.find((layer) => layer.id === layerId);
  if (!target) return null;

  const minDuration = getMinDuration(options);
  const start = target.startTime;
  const end = target.startTime + target.duration;
  const cut = snapTime(clampFinite(time, 0, end), options.frameRate);
  if (cut <= start + minDuration || cut >= end - minDuration) return null;

  const local = cut - start;
  const idFactory =
    options.idFactory ?? (() => `${layerId}-split-${(splitFallbackCounter += 1)}`);
  const keyframeIdFactory =
    options.keyframeIdFactory ??
    (() => `${layerId}-split-kf-${(splitFallbackCounter += 1)}`);

  const firstHalf = {
    ...target,
    duration: snapDuration(local, options),
  } as MotionLayer;

  const sourceRate = (target as { playbackRate?: number }).playbackRate ?? 1;
  const sourceTimeOffset = (target as { timeOffset?: number }).timeOffset;
  const shiftedKeyframes = (target.keyframes ?? []).map((keyframe) => ({
    ...keyframe,
    id: keyframeIdFactory(),
    time: Number((keyframe.time - local).toFixed(4)),
  }));

  const secondHalf = {
    ...target,
    id: idFactory(),
    name: `${target.name}${options.nameSuffix ?? ""}`,
    startTime: snapTime(cut, options.frameRate),
    duration: snapDuration(end - cut, options),
    keyframes: shiftedKeyframes,
    ...(typeof sourceTimeOffset === "number"
      ? { timeOffset: Number((sourceTimeOffset + local * sourceRate).toFixed(4)) }
      : {}),
  } as MotionLayer;

  const layers: MotionLayer[] = [];
  for (const layer of composition.layers) {
    if (layer.id === layerId) {
      layers.push(firstHalf, secondHalf);
    } else {
      layers.push(layer);
    }
  }

  return { ...composition, layers, modifiedAt: Date.now() };
}

export interface RippleMotionLayersOptions extends MotionLayerTimingOptions {
  readonly fromTime: number;
  readonly deltaSeconds: number;
  readonly excludeLayerIds?: readonly string[];
  readonly includeLocked?: boolean;
}

export function rippleMotionLayers(
  composition: MotionComposition,
  options: RippleMotionLayersOptions,
): MotionComposition {
  if (options.deltaSeconds === 0) return composition;

  const excludedIds = new Set(options.excludeLayerIds ?? []);
  const threshold = options.fromTime - 1e-6;
  let changed = false;

  const layers = composition.layers.map((layer) => {
    if (excludedIds.has(layer.id)) return layer;
    if (layer.locked && !options.includeLocked) return layer;
    if (layer.startTime < threshold) return layer;
    const moved = moveMotionLayerInTime(layer, layer.startTime + options.deltaSeconds, {
      compositionDuration: options.compositionDuration,
      frameRate: options.frameRate,
      minDuration: options.minDuration,
    });
    if (moved.startTime !== layer.startTime) changed = true;
    return moved;
  });

  if (!changed) return composition;
  return { ...composition, layers, modifiedAt: Date.now() };
}

export interface RippleDeleteMotionLayerOptions extends MotionLayerTimingOptions {
  readonly includeLocked?: boolean;
}

export function rippleDeleteMotionLayer(
  composition: MotionComposition,
  layerId: string,
  options: RippleDeleteMotionLayerOptions = {},
): MotionComposition {
  const target = composition.layers.find((layer) => layer.id === layerId);
  if (!target) return composition;

  const gap = target.duration;
  const removalEnd = target.startTime + target.duration;
  const removed = removeMotionLayers(composition, [layerId]);

  return rippleMotionLayers(removed, {
    fromTime: removalEnd,
    deltaSeconds: -gap,
    compositionDuration: options.compositionDuration ?? composition.duration,
    frameRate: options.frameRate ?? composition.frameRate,
    minDuration: options.minDuration,
    includeLocked: options.includeLocked,
  });
}

function snapDuration(
  duration: number,
  options: MotionLayerTimingOptions,
): number {
  return Math.max(getMinDuration(options), snapTime(duration, options.frameRate));
}

function snapTime(time: number, frameRate: number | undefined): number {
  if (!frameRate || frameRate <= 0) return roundTime(time);
  return roundTime(Math.round(time * frameRate) / frameRate);
}

function getMinDuration(options: MotionLayerTimingOptions): number {
  return Math.max(0.001, options.minDuration ?? DEFAULT_MIN_DURATION);
}

function clampFinite(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}

function roundTime(time: number): number {
  return Number(Math.max(0, time).toFixed(4));
}
