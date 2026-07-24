import type { MotionComposition, MotionLayer, MotionVector2 } from "./types";
import {
  getMotionLayerDescendantIds,
  normalizeMotionLayerHierarchy,
} from "./motion-hierarchy";
import {
  getMotionLayerPropertyValueAtTime,
  upsertMotionLayerKeyframe,
} from "./motion-keyframes";

export interface DuplicateMotionLayersOptions {
  readonly idFactory?: (layer: MotionLayer, index: number) => string;
  readonly keyframeIdFactory?: (
    keyframeId: string,
    layer: MotionLayer,
    index: number,
  ) => string;
  readonly offset?: MotionVector2;
}

export interface DuplicateMotionLayersResult {
  readonly composition: MotionComposition;
  readonly duplicatedLayerIds: string[];
}

export interface MotionLayerClipboard {
  readonly layers: MotionLayer[];
  readonly rootLayerIds: string[];
  readonly sourceStartTime: number;
}

export interface PasteMotionLayersOptions extends DuplicateMotionLayersOptions {
  readonly targetTime: number;
}

export interface NudgeMotionLayersOptions {
  readonly time?: number;
  readonly includeLocked?: boolean;
}

export function duplicateMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  options: DuplicateMotionLayersOptions = {},
): DuplicateMotionLayersResult {
  const requestedIds = normalizeLayerIds(layerIds);
  if (requestedIds.length === 0) {
    return { composition, duplicatedLayerIds: [] };
  }

  const duplicateIds = getLayerIdsWithDescendants(composition, requestedIds);
  const sourceLayers = composition.layers.filter((layer) => duplicateIds.has(layer.id));
  if (sourceLayers.length === 0) {
    return { composition, duplicatedLayerIds: [] };
  }

  const offset = options.offset ?? { x: 32, y: 32 };
  const idFactory = options.idFactory ?? createDefaultLayerId;
  const keyframeIdFactory = options.keyframeIdFactory ?? createDefaultKeyframeId;
  const idMap = new Map<string, string>();
  sourceLayers.forEach((layer, index) => {
    idMap.set(layer.id, idFactory(layer, index));
  });

  const topLevelDuplicateIds = new Set(
    sourceLayers
      .filter((layer) => !hasAncestorInSet(composition, layer, duplicateIds))
      .map((layer) => layer.id),
  );
  const clonedLayers = sourceLayers.map((layer, index) =>
    cloneLayerForDuplicate(layer, index, idMap, topLevelDuplicateIds, offset, {
      keyframeIdFactory,
    }),
  );
  const lastSourceIndex = Math.max(
    ...sourceLayers.map((layer) =>
      composition.layers.findIndex((candidate) => candidate.id === layer.id),
    ),
  );
  const nextLayers = [
    ...composition.layers.slice(0, lastSourceIndex + 1),
    ...clonedLayers,
    ...composition.layers.slice(lastSourceIndex + 1),
  ];
  const duplicatedLayerIds = requestedIds
    .map((id) => idMap.get(id))
    .filter((id): id is string => Boolean(id));

  return {
    composition: normalizeMotionLayerHierarchy({
      ...composition,
      layers: nextLayers,
      modifiedAt: Date.now(),
    }),
    duplicatedLayerIds,
  };
}

export function copyMotionLayersToClipboard(
  composition: MotionComposition,
  layerIds: readonly string[],
): MotionLayerClipboard | null {
  const requestedIds = normalizeLayerIds(layerIds);
  const copiedIds = getLayerIdsWithDescendants(composition, requestedIds);
  const sourceLayers = composition.layers.filter((layer) => copiedIds.has(layer.id));
  if (sourceLayers.length === 0) return null;

  const copiedLayers = sourceLayers.map((layer) => {
    const cloned = cloneJson(layer);
    const sanitized = {
      ...cloned,
      parentId:
        cloned.parentId && copiedIds.has(cloned.parentId)
          ? cloned.parentId
          : undefined,
      trackMatte:
        cloned.trackMatte && copiedIds.has(cloned.trackMatte.sourceLayerId)
          ? cloned.trackMatte
          : undefined,
    } as MotionLayer;
    return sanitized.type === "group"
      ? {
          ...sanitized,
          children: sanitized.children.filter((childId) => copiedIds.has(childId)),
        }
      : sanitized;
  });

  return {
    layers: copiedLayers,
    rootLayerIds: requestedIds.filter((id) => copiedIds.has(id)),
    sourceStartTime: Math.min(...copiedLayers.map((layer) => layer.startTime)),
  };
}

export function pasteMotionLayersFromClipboard(
  composition: MotionComposition,
  clipboard: MotionLayerClipboard,
  options: PasteMotionLayersOptions,
): DuplicateMotionLayersResult {
  if (clipboard.layers.length === 0 || clipboard.rootLayerIds.length === 0) {
    return { composition, duplicatedLayerIds: [] };
  }

  const sourceLayers = cloneJson(clipboard.layers);
  const sourceIds = new Set(sourceLayers.map((layer) => layer.id));
  const stagingComposition: MotionComposition = {
    ...composition,
    layers: sourceLayers,
  };
  const duplicated = duplicateMotionLayers(
    stagingComposition,
    clipboard.rootLayerIds,
    {
      idFactory: options.idFactory,
      keyframeIdFactory: options.keyframeIdFactory,
      offset: options.offset ?? { x: 0, y: 0 },
    },
  );
  if (duplicated.duplicatedLayerIds.length === 0) {
    return { composition, duplicatedLayerIds: [] };
  }

  const targetTime = Math.max(
    0,
    Math.min(
      Number.isFinite(options.targetTime) ? options.targetTime : 0,
      composition.duration,
    ),
  );
  const timeOffset = targetTime - clipboard.sourceStartTime;
  const pastedLayers = duplicated.composition.layers
    .filter((layer) => !sourceIds.has(layer.id))
    .map(
      (layer) =>
        ({
          ...layer,
          startTime: roundMotionCommandValue(
            Math.max(0, layer.startTime + timeOffset),
          ),
        }) as MotionLayer,
    );

  return {
    composition: normalizeMotionLayerHierarchy({
      ...composition,
      layers: [...composition.layers, ...pastedLayers],
      modifiedAt: Date.now(),
    }),
    duplicatedLayerIds: duplicated.duplicatedLayerIds,
  };
}

export function removeMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
): MotionComposition {
  const removeIds = getLayerIdsWithDescendants(composition, layerIds);
  if (removeIds.size === 0) return composition;

  const layers = composition.layers
    .filter((layer) => !removeIds.has(layer.id))
    .map((layer) => cleanRemovedLayerReferences(layer, removeIds));

  return normalizeMotionLayerHierarchy({
    ...composition,
    layers,
    modifiedAt: Date.now(),
  });
}

export function setMotionLayersLocked(
  composition: MotionComposition,
  layerIds: readonly string[],
  locked: boolean,
): MotionComposition {
  return patchMotionLayers(composition, layerIds, (layer) =>
    layer.locked === locked ? layer : ({ ...layer, locked } as MotionLayer),
  );
}

export function setMotionLayersVisible(
  composition: MotionComposition,
  layerIds: readonly string[],
  visible: boolean,
): MotionComposition {
  return patchMotionLayers(composition, layerIds, (layer) =>
    layer.visible === visible ? layer : ({ ...layer, visible } as MotionLayer),
  );
}

export function nudgeMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  delta: MotionVector2,
  options: NudgeMotionLayersOptions = {},
): MotionComposition {
  if (delta.x === 0 && delta.y === 0) return composition;
  const targetIds = new Set(getTopLevelLayerIds(composition, layerIds));
  if (targetIds.size === 0) return composition;

  let changed = false;
  const layers = composition.layers.map((layer) => {
    if (!targetIds.has(layer.id) || (layer.locked && !options.includeLocked)) {
      return layer;
    }

    changed = true;
    const localTime =
      options.time == null
        ? 0
        : Math.min(layer.duration, Math.max(0, options.time - layer.startTime));
    const writesPositionKeyframes = layer.keyframes.some(
      (keyframe) =>
        keyframe.property === "transform.position.x" ||
        keyframe.property === "transform.position.y",
    );

    if (writesPositionKeyframes) {
      const nextX =
        readNumber(
          getMotionLayerPropertyValueAtTime(
            layer,
            "transform.position.x",
            localTime,
            composition,
          ),
          layer.transform.position.x,
        ) + delta.x;
      const nextY =
        readNumber(
          getMotionLayerPropertyValueAtTime(
            layer,
            "transform.position.y",
            localTime,
            composition,
          ),
          layer.transform.position.y,
        ) + delta.y;
      return upsertMotionLayerKeyframe(
        upsertMotionLayerKeyframe(layer, "transform.position.x", localTime, {
          value: roundMotionCommandValue(nextX),
          easing: "ease",
        }),
        "transform.position.y",
        localTime,
        { value: roundMotionCommandValue(nextY), easing: "ease" },
      );
    }

    return {
      ...layer,
      transform: {
        ...layer.transform,
        position: {
          x: roundMotionCommandValue(layer.transform.position.x + delta.x),
          y: roundMotionCommandValue(layer.transform.position.y + delta.y),
        },
      },
    } as MotionLayer;
  });

  return changed
    ? {
        ...composition,
        layers,
        modifiedAt: Date.now(),
      }
    : composition;
}

function patchMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  updater: (layer: MotionLayer) => MotionLayer,
): MotionComposition {
  const targetIds = new Set(normalizeLayerIds(layerIds));
  if (targetIds.size === 0) return composition;
  let changed = false;
  const layers = composition.layers.map((layer) => {
    if (!targetIds.has(layer.id)) return layer;
    const nextLayer = updater(layer);
    if (nextLayer !== layer) changed = true;
    return nextLayer;
  });
  return changed
    ? {
        ...composition,
        layers,
        modifiedAt: Date.now(),
      }
    : composition;
}

function cloneLayerForDuplicate(
  layer: MotionLayer,
  index: number,
  idMap: ReadonlyMap<string, string>,
  topLevelDuplicateIds: ReadonlySet<string>,
  offset: MotionVector2,
  options: Required<Pick<DuplicateMotionLayersOptions, "keyframeIdFactory">>,
): MotionLayer {
  const clone = cloneJson(layer);
  const nextLayer = {
    ...clone,
    id: idMap.get(layer.id) ?? createDefaultLayerId(layer, index),
    name: `${clone.name} Copy`,
    parentId: clone.parentId ? idMap.get(clone.parentId) ?? clone.parentId : undefined,
    keyframes: clone.keyframes.map((keyframe, keyframeIndex) => ({
      ...keyframe,
      id: options.keyframeIdFactory(keyframe.id, layer, keyframeIndex),
    })),
    trackMatte: clone.trackMatte
      ? {
          ...clone.trackMatte,
          sourceLayerId:
            idMap.get(clone.trackMatte.sourceLayerId) ??
            clone.trackMatte.sourceLayerId,
        }
      : undefined,
  } as MotionLayer;

  const positionedLayer = topLevelDuplicateIds.has(layer.id)
    ? ({
        ...nextLayer,
        transform: {
          ...nextLayer.transform,
          position: {
            x: roundMotionCommandValue(nextLayer.transform.position.x + offset.x),
            y: roundMotionCommandValue(nextLayer.transform.position.y + offset.y),
          },
        },
      } as MotionLayer)
    : nextLayer;

  if (positionedLayer.type === "group") {
    return {
      ...positionedLayer,
      children: positionedLayer.children
        .map((childId) => idMap.get(childId))
        .filter((childId): childId is string => Boolean(childId)),
    };
  }
  return positionedLayer;
}

function cleanRemovedLayerReferences(
  layer: MotionLayer,
  removeIds: ReadonlySet<string>,
): MotionLayer {
  const nextLayer = {
    ...layer,
    parentId:
      layer.parentId && removeIds.has(layer.parentId) ? undefined : layer.parentId,
    trackMatte:
      layer.trackMatte && removeIds.has(layer.trackMatte.sourceLayerId)
        ? undefined
        : layer.trackMatte,
  } as MotionLayer;

  if (nextLayer.type === "group") {
    return {
      ...nextLayer,
      children: nextLayer.children.filter((childId) => !removeIds.has(childId)),
    };
  }
  return nextLayer;
}

function getLayerIdsWithDescendants(
  composition: MotionComposition,
  layerIds: readonly string[],
): Set<string> {
  const ids = new Set(normalizeLayerIds(layerIds));
  for (const layerId of [...ids]) {
    for (const descendantId of getMotionLayerDescendantIds(composition, layerId)) {
      ids.add(descendantId);
    }
  }
  return ids;
}

function getTopLevelLayerIds(
  composition: MotionComposition,
  layerIds: readonly string[],
): string[] {
  const ids = new Set(normalizeLayerIds(layerIds));
  return composition.layers
    .filter((layer) => ids.has(layer.id) && !hasAncestorInSet(composition, layer, ids))
    .map((layer) => layer.id);
}

function hasAncestorInSet(
  composition: MotionComposition,
  layer: MotionLayer,
  layerIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>([layer.id]);
  let parentId = layer.parentId;
  while (parentId) {
    if (layerIds.has(parentId)) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    const parent = composition.layers.find((candidate) => candidate.id === parentId);
    parentId = parent?.parentId;
  }
  return false;
}

function normalizeLayerIds(layerIds: readonly string[]): string[] {
  return Array.from(new Set(layerIds.filter(Boolean)));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createDefaultLayerId(_layer: MotionLayer, index: number): string {
  return `motion-layer-${Date.now()}-${index}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function createDefaultKeyframeId(
  _keyframeId: string,
  _layer: MotionLayer,
  index: number,
): string {
  return `motion-kf-${Date.now()}-${index}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMotionCommandValue(value: number): number {
  return Number(value.toFixed(4));
}
