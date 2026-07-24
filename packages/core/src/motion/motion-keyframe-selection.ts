import type { Keyframe } from "../types/timeline";
import type { MotionComposition, MotionLayer } from "./types";
import { sortMotionKeyframes } from "./motion-keyframes";

export interface OffsetMotionKeyframesResult {
  readonly composition: MotionComposition;
  readonly appliedDelta: number;
  readonly movedKeyframeIds: readonly string[];
}

export interface DuplicateMotionKeyframesResult {
  readonly composition: MotionComposition;
  readonly appliedDelta: number;
  readonly duplicatedKeyframeIds: readonly string[];
}

const TIME_EPSILON = 1 / 1000;

/**
 * Moves a keyframe selection as one time group across layer, camera, and light
 * tracks. A shared clamped delta preserves spacing when any selected keyframe
 * reaches its owning track boundary.
 */
export function offsetMotionKeyframes(
  composition: MotionComposition,
  keyframeIds: readonly string[],
  deltaSeconds: number,
): OffsetMotionKeyframesResult {
  const requestedIds = new Set(keyframeIds.filter(Boolean));
  if (requestedIds.size === 0 || !Number.isFinite(deltaSeconds)) {
    return { composition, appliedDelta: 0, movedKeyframeIds: [] };
  }

  const bounds: Array<{ readonly id: string; readonly min: number; readonly max: number }> = [];
  for (const layer of composition.layers) {
    for (const keyframe of layer.keyframes) {
      if (!requestedIds.has(keyframe.id)) continue;
      bounds.push({
        id: keyframe.id,
        min: -keyframe.time,
        max: Math.max(0, layer.duration) - keyframe.time,
      });
    }
    for (const mask of layer.masks ?? []) {
      for (const keyframe of mask.pathKeyframes ?? []) {
        if (!requestedIds.has(keyframe.id)) continue;
        bounds.push({
          id: keyframe.id,
          min: -keyframe.time,
          max: Math.max(0, layer.duration) - keyframe.time,
        });
      }
    }
  }
  for (const keyframe of composition.camera?.keyframes ?? []) {
    if (!requestedIds.has(keyframe.id)) continue;
    bounds.push({
      id: keyframe.id,
      min: -keyframe.time,
      max: Math.max(0, composition.duration) - keyframe.time,
    });
  }
  for (const light of composition.lights ?? []) {
    for (const keyframe of light.keyframes ?? []) {
      if (!requestedIds.has(keyframe.id)) continue;
      bounds.push({
        id: keyframe.id,
        min: -keyframe.time,
        max: Math.max(0, composition.duration) - keyframe.time,
      });
    }
  }

  if (bounds.length === 0) {
    return { composition, appliedDelta: 0, movedKeyframeIds: [] };
  }

  const minDelta = Math.max(...bounds.map((bound) => bound.min));
  const maxDelta = Math.min(...bounds.map((bound) => bound.max));
  const appliedDelta = roundTime(
    Math.min(maxDelta, Math.max(minDelta, deltaSeconds)),
  );
  if (Math.abs(appliedDelta) < Number.EPSILON) {
    return {
      composition,
      appliedDelta: 0,
      movedKeyframeIds: bounds.map((bound) => bound.id),
    };
  }

  const movedIds = new Set(bounds.map((bound) => bound.id));
  const layers = composition.layers.map((layer) => {
    const movesLayerKeyframe = layer.keyframes.some((keyframe) =>
      movedIds.has(keyframe.id),
    );
    const movesMaskKeyframe = (layer.masks ?? []).some((mask) =>
      (mask.pathKeyframes ?? []).some((keyframe) => movedIds.has(keyframe.id)),
    );
    if (!movesLayerKeyframe && !movesMaskKeyframe) {
      return layer;
    }
    return {
      ...layer,
      keyframes: offsetKeyframeList(layer.keyframes, movedIds, appliedDelta),
      masks: layer.masks?.map((mask) => ({
        ...mask,
        pathKeyframes: mask.pathKeyframes
          ? offsetKeyframeList(mask.pathKeyframes, movedIds, appliedDelta)
          : mask.pathKeyframes,
      })),
    } as MotionLayer;
  });
  const camera = composition.camera
    ? {
        ...composition.camera,
        keyframes: offsetKeyframeList(
          composition.camera.keyframes ?? [],
          movedIds,
          appliedDelta,
        ),
      }
    : composition.camera;
  const lights = composition.lights?.map((light) => ({
    ...light,
    keyframes: offsetKeyframeList(
      light.keyframes ?? [],
      movedIds,
      appliedDelta,
    ),
  }));

  return {
    composition: {
      ...composition,
      layers,
      camera,
      lights,
      modifiedAt: Date.now(),
    },
    appliedDelta,
    movedKeyframeIds: Array.from(movedIds),
  };
}

/**
 * Copies a mixed keyframe selection to a new group whose earliest keyframe is
 * aligned to `targetTime`. The same clamped delta is used for layer, mask,
 * camera, and light tracks so the copied timing relationship stays intact.
 */
export function duplicateMotionKeyframes(
  composition: MotionComposition,
  keyframeIds: readonly string[],
  targetTime: number,
  idFactory: () => string = defaultKeyframeId,
): DuplicateMotionKeyframesResult {
  const requestedIds = new Set(keyframeIds.filter(Boolean));
  if (requestedIds.size === 0 || !Number.isFinite(targetTime)) {
    return {
      composition,
      appliedDelta: 0,
      duplicatedKeyframeIds: [],
    };
  }

  const bounds: Array<{
    readonly absoluteTime: number;
    readonly minDelta: number;
    readonly maxDelta: number;
  }> = [];
  for (const layer of composition.layers) {
    for (const keyframe of layer.keyframes) {
      if (requestedIds.has(keyframe.id)) {
        bounds.push({
          absoluteTime: layer.startTime + keyframe.time,
          minDelta: -keyframe.time,
          maxDelta: Math.max(0, layer.duration) - keyframe.time,
        });
      }
    }
    for (const mask of layer.masks ?? []) {
      for (const keyframe of mask.pathKeyframes ?? []) {
        if (requestedIds.has(keyframe.id)) {
          bounds.push({
            absoluteTime: layer.startTime + keyframe.time,
            minDelta: -keyframe.time,
            maxDelta: Math.max(0, layer.duration) - keyframe.time,
          });
        }
      }
    }
  }
  for (const keyframe of composition.camera?.keyframes ?? []) {
    if (requestedIds.has(keyframe.id)) {
      bounds.push({
        absoluteTime: keyframe.time,
        minDelta: -keyframe.time,
        maxDelta: Math.max(0, composition.duration) - keyframe.time,
      });
    }
  }
  for (const light of composition.lights ?? []) {
    for (const keyframe of light.keyframes ?? []) {
      if (requestedIds.has(keyframe.id)) {
        bounds.push({
          absoluteTime: keyframe.time,
          minDelta: -keyframe.time,
          maxDelta: Math.max(0, composition.duration) - keyframe.time,
        });
      }
    }
  }

  if (bounds.length === 0) {
    return {
      composition,
      appliedDelta: 0,
      duplicatedKeyframeIds: [],
    };
  }

  const earliestTime = Math.min(
    ...bounds.map((bound) => bound.absoluteTime),
  );
  const minDelta = Math.max(...bounds.map((bound) => bound.minDelta));
  const maxDelta = Math.min(...bounds.map((bound) => bound.maxDelta));
  const appliedDelta = roundTime(
    Math.min(maxDelta, Math.max(minDelta, targetTime - earliestTime)),
  );
  if (Math.abs(appliedDelta) <= TIME_EPSILON) {
    return {
      composition,
      appliedDelta: 0,
      duplicatedKeyframeIds: [],
    };
  }

  const duplicatedKeyframeIds: string[] = [];
  const layers = composition.layers.map((layer) => {
    const layerResult = duplicateKeyframeList(
      layer.keyframes,
      requestedIds,
      appliedDelta,
      idFactory,
    );
    duplicatedKeyframeIds.push(...layerResult.duplicatedIds);
    const masks = layer.masks?.map((mask) => {
      if (!mask.pathKeyframes) return mask;
      const maskResult = duplicateKeyframeList(
        mask.pathKeyframes,
        requestedIds,
        appliedDelta,
        idFactory,
      );
      duplicatedKeyframeIds.push(...maskResult.duplicatedIds);
      return maskResult.duplicatedIds.length > 0
        ? { ...mask, pathKeyframes: maskResult.keyframes }
        : mask;
    });
    if (
      layerResult.duplicatedIds.length === 0 &&
      !masks?.some((mask, index) => mask !== layer.masks?.[index])
    ) {
      return layer;
    }
    return {
      ...layer,
      keyframes: layerResult.keyframes,
      masks,
    } as MotionLayer;
  });

  const cameraResult = duplicateKeyframeList(
    composition.camera?.keyframes ?? [],
    requestedIds,
    appliedDelta,
    idFactory,
  );
  duplicatedKeyframeIds.push(...cameraResult.duplicatedIds);
  const camera = composition.camera
    ? { ...composition.camera, keyframes: cameraResult.keyframes }
    : composition.camera;
  const lights = composition.lights?.map((light) => {
    const result = duplicateKeyframeList(
      light.keyframes ?? [],
      requestedIds,
      appliedDelta,
      idFactory,
    );
    duplicatedKeyframeIds.push(...result.duplicatedIds);
    return result.duplicatedIds.length > 0
      ? { ...light, keyframes: result.keyframes }
      : light;
  });

  return {
    composition: {
      ...composition,
      layers,
      camera,
      lights,
      modifiedAt: Date.now(),
    },
    appliedDelta,
    duplicatedKeyframeIds,
  };
}

function offsetKeyframeList<T extends Keyframe>(
  keyframes: readonly T[],
  movedIds: ReadonlySet<string>,
  delta: number,
): T[] {
  const moved = keyframes
    .filter((keyframe) => movedIds.has(keyframe.id))
    .map((keyframe) => ({
      ...keyframe,
      time: roundTime(keyframe.time + delta),
    })) as T[];
  if (moved.length === 0) return [...keyframes];

  const retained = keyframes.filter(
    (keyframe) =>
      !movedIds.has(keyframe.id) &&
      !moved.some(
        (candidate) =>
          candidate.property === keyframe.property &&
          Math.abs(candidate.time - keyframe.time) <= TIME_EPSILON,
      ),
  );
  return sortMotionKeyframes([...retained, ...moved]) as T[];
}

function duplicateKeyframeList<T extends Keyframe>(
  keyframes: readonly T[],
  selectedIds: ReadonlySet<string>,
  delta: number,
  idFactory: () => string,
): { readonly keyframes: T[]; readonly duplicatedIds: string[] } {
  const duplicates = keyframes
    .filter((keyframe) => selectedIds.has(keyframe.id))
    .map((keyframe) => ({
      ...structuredClone(keyframe),
      id: idFactory(),
      time: roundTime(keyframe.time + delta),
    })) as T[];
  if (duplicates.length === 0) {
    return { keyframes: [...keyframes], duplicatedIds: [] };
  }
  const retained = keyframes.filter(
    (keyframe) =>
      !duplicates.some(
        (candidate) =>
          candidate.property === keyframe.property &&
          Math.abs(candidate.time - keyframe.time) <= TIME_EPSILON,
      ),
  );
  return {
    keyframes: sortMotionKeyframes([...retained, ...duplicates]) as T[],
    duplicatedIds: duplicates.map((keyframe) => keyframe.id),
  };
}

function defaultKeyframeId(): string {
  return `motion-kf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function roundTime(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
