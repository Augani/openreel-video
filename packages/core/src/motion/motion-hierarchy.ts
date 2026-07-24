import type {
  MotionComposition,
  MotionGroupLayer,
  MotionLayer,
  MotionTransform,
  MotionVector2,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import { createMotionNullLayer } from "./motion-null-layers";

export interface ParentMotionLayersOptions {
  readonly preserveStagePosition?: boolean;
}

export interface CreateMotionNullControllerForLayersOptions
  extends ParentMotionLayersOptions {
  readonly id?: string;
  readonly name?: string;
  readonly guideColor?: string;
  readonly guideSize?: number;
}

export interface CreateMotionNullControllerForLayersResult {
  readonly composition: MotionComposition;
  readonly controllerLayerId: string;
}

export function getMotionLayerById(
  composition: MotionComposition,
  layerId: string | null | undefined,
): MotionLayer | undefined {
  if (!layerId) return undefined;
  return composition.layers.find((layer) => layer.id === layerId);
}

export function getMotionLayerChildren(
  composition: MotionComposition,
  parentId: string,
): MotionLayer[] {
  return composition.layers.filter((layer) => layer.parentId === parentId);
}

export function getMotionRootLayers(
  composition: MotionComposition,
): MotionLayer[] {
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  return composition.layers.filter(
    (layer) => !layer.parentId || !layerIds.has(layer.parentId),
  );
}

export function getMotionLayerDescendantIds(
  composition: MotionComposition,
  layerId: string,
): Set<string> {
  const descendants = new Set<string>();
  const visit = (parentId: string) => {
    for (const child of getMotionLayerChildren(composition, parentId)) {
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      visit(child.id);
    }
  };
  visit(layerId);
  return descendants;
}

export function getMotionLayerParentChain(
  composition: MotionComposition,
  layer: MotionLayer,
): MotionLayer[] {
  const chain: MotionLayer[] = [];
  const visited = new Set<string>([layer.id]);
  let currentParentId = layer.parentId;
  while (currentParentId) {
    if (visited.has(currentParentId)) break;
    const parent = getMotionLayerById(composition, currentParentId);
    if (!parent) break;
    chain.unshift(parent);
    visited.add(parent.id);
    currentParentId = parent.parentId;
  }
  return chain;
}

export function canParentMotionLayer(
  composition: MotionComposition,
  layerId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return true;
  if (layerId === parentId) return false;
  if (!getMotionLayerById(composition, layerId)) return false;
  if (!getMotionLayerById(composition, parentId)) return false;
  return !getMotionLayerDescendantIds(composition, layerId).has(parentId);
}

export function setMotionLayerParent(
  composition: MotionComposition,
  layerId: string,
  parentId: string | null,
): MotionComposition {
  if (!canParentMotionLayer(composition, layerId, parentId)) {
    return composition;
  }
  const nextLayers = composition.layers.map((layer) =>
    layer.id === layerId
      ? ({
          ...layer,
          parentId: parentId ?? undefined,
        } as MotionLayer)
      : layer,
  );
  return normalizeMotionLayerHierarchy({
    ...composition,
    layers: nextLayers,
    modifiedAt: Date.now(),
  });
}

export function parentMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  parentId: string | null,
  options: ParentMotionLayersOptions = {},
): MotionComposition {
  const uniqueLayerIds = Array.from(new Set(layerIds));
  if (uniqueLayerIds.length === 0) return composition;
  const parent = parentId ? getMotionLayerById(composition, parentId) : undefined;

  const layers = composition.layers.map((layer) => {
    if (!uniqueLayerIds.includes(layer.id)) return layer;
    if (!canParentMotionLayer(composition, layer.id, parentId)) return layer;
    const nextLayer =
      options.preserveStagePosition && parent
        ? offsetLayerForNewParent(layer, parent.transform)
        : layer;
    return {
      ...nextLayer,
      parentId: parentId ?? undefined,
    } as MotionLayer;
  });

  return normalizeMotionLayerHierarchy({
    ...composition,
    layers,
    modifiedAt: Date.now(),
  });
}

export function clearMotionLayerParents(
  composition: MotionComposition,
  layerIds: readonly string[],
): MotionComposition {
  return parentMotionLayers(composition, layerIds, null);
}

export function createMotionNullControllerForLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  options: CreateMotionNullControllerForLayersOptions = {},
): CreateMotionNullControllerForLayersResult | null {
  const selectedLayers = composition.layers.filter(
    (layer) => layerIds.includes(layer.id) && layer.type !== "null",
  );
  if (selectedLayers.length === 0) return null;

  const position = getAverageLayerPosition(selectedLayers);
  const startTime = Math.min(...selectedLayers.map((layer) => layer.startTime));
  const endTime = Math.max(
    ...selectedLayers.map((layer) => layer.startTime + layer.duration),
  );
  const controller = createMotionNullLayer(composition, {
    id: options.id,
    name: options.name ?? "Selection Controller",
    startTime,
    duration: Math.max(0.001, Number((endTime - startTime).toFixed(4))),
    position,
    guideColor: options.guideColor,
    guideSize: options.guideSize,
  });
  const withController: MotionComposition = {
    ...composition,
    layers: [...composition.layers, controller],
    modifiedAt: Date.now(),
  };
  const parented = parentMotionLayers(
    withController,
    selectedLayers.map((layer) => layer.id),
    controller.id,
    { preserveStagePosition: options.preserveStagePosition ?? true },
  );

  return {
    composition: parented,
    controllerLayerId: controller.id,
  };
}

export interface GroupMotionLayersOptions {
  readonly id?: string;
  readonly name?: string;
  readonly preserveStagePosition?: boolean;
}

export interface GroupMotionLayersResult {
  readonly composition: MotionComposition;
  readonly groupLayerId: string;
}

const createGroupLayerId = (): string =>
  `motion-group-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function groupMotionLayers(
  composition: MotionComposition,
  layerIds: readonly string[],
  options: GroupMotionLayersOptions = {},
): GroupMotionLayersResult | null {
  const selectedSet = new Set(layerIds);
  const idToParent = new Map(
    composition.layers.map((layer) => [layer.id, layer.parentId]),
  );
  const isTopMostSelection = (layer: MotionLayer): boolean => {
    let parentId = layer.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (selectedSet.has(parentId)) return false;
      parentId = idToParent.get(parentId);
    }
    return true;
  };
  // Only reparent the top-most selected layers; descendants of a selected
  // parent ride along so internal nesting is preserved.
  const selectedLayers = composition.layers.filter(
    (layer) => selectedSet.has(layer.id) && isTopMostSelection(layer),
  );
  if (selectedLayers.length === 0) return null;

  const position = getAverageLayerPosition(selectedLayers);
  const startTime = Math.min(...selectedLayers.map((layer) => layer.startTime));
  const endTime = Math.max(
    ...selectedLayers.map((layer) => layer.startTime + layer.duration),
  );
  const groupId = options.id ?? createGroupLayerId();
  const group: MotionGroupLayer = {
    id: groupId,
    type: "group",
    name: options.name ?? "Group",
    startTime,
    duration: Math.max(0.001, Number((endTime - startTime).toFixed(4))),
    visible: true,
    locked: false,
    transform: { ...DEFAULT_MOTION_TRANSFORM, position },
    keyframes: [],
    children: [],
  };
  const withGroup: MotionComposition = {
    ...composition,
    layers: [...composition.layers, group],
    modifiedAt: Date.now(),
  };
  const parented = parentMotionLayers(
    withGroup,
    selectedLayers.map((layer) => layer.id),
    groupId,
    { preserveStagePosition: options.preserveStagePosition ?? true },
  );
  return { composition: parented, groupLayerId: groupId };
}

export function ungroupMotionLayers(
  composition: MotionComposition,
  groupLayerIds: readonly string[],
): MotionComposition {
  const groups = composition.layers.filter(
    (layer): layer is MotionGroupLayer =>
      layer.type === "group" && groupLayerIds.includes(layer.id),
  );
  if (groups.length === 0) return composition;
  let next = composition;
  for (const group of groups) {
    const childIds = getMotionLayerChildren(next, group.id).map(
      (layer) => layer.id,
    );
    next = parentMotionLayers(next, childIds, group.parentId ?? null, {
      preserveStagePosition: true,
    });
  }
  const removeIds = new Set(groups.map((group) => group.id));
  return normalizeMotionLayerHierarchy({
    ...next,
    layers: next.layers.filter((layer) => !removeIds.has(layer.id)),
    modifiedAt: Date.now(),
  });
}

export function normalizeMotionLayerHierarchy(
  composition: MotionComposition,
): MotionComposition {
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  const directChildren = new Map<string, string[]>();
  const layers = composition.layers.map((layer) => {
    const parentId =
      layer.parentId && layerIds.has(layer.parentId) && layer.parentId !== layer.id
        ? layer.parentId
        : undefined;
    if (parentId) {
      const ids = directChildren.get(parentId) ?? [];
      ids.push(layer.id);
      directChildren.set(parentId, ids);
    }
    return parentId === layer.parentId
      ? layer
      : ({ ...layer, parentId } as MotionLayer);
  });

  return {
    ...composition,
    layers: layers.map((layer) =>
      layer.type === "group"
        ? ({
            ...layer,
            children: directChildren.get(layer.id) ?? [],
          } satisfies MotionGroupLayer)
        : layer,
    ),
  };
}

function getAverageLayerPosition(layers: readonly MotionLayer[]): MotionVector2 {
  const total = layers.reduce(
    (sum, layer) => ({
      x: sum.x + layer.transform.position.x,
      y: sum.y + layer.transform.position.y,
      z: (sum.z ?? 0) + (layer.transform.position.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 },
  );
  const count = Math.max(1, layers.length);
  return {
    x: Number((total.x / count).toFixed(4)),
    y: Number((total.y / count).toFixed(4)),
    z: Number(((total.z ?? 0) / count).toFixed(4)),
  };
}

const round4 = (value: number): number => Number(value.toFixed(4));

function offsetLayerForNewParent(
  layer: MotionLayer,
  parentTransform: MotionTransform,
): MotionLayer {
  const parentPosition = parentTransform.position;
  const parentRadians = (parentTransform.rotation * Math.PI) / 180;
  const cos = Math.cos(parentRadians);
  const sin = Math.sin(parentRadians);
  const scaleX = parentTransform.scale.x || 1;
  const scaleY = parentTransform.scale.y || 1;

  const toParentLocal = (x: number, y: number): { x: number; y: number } => {
    const dx = x - parentPosition.x;
    const dy = y - parentPosition.y;
    const rotatedX = dx * cos + dy * sin;
    const rotatedY = -dx * sin + dy * cos;
    return { x: rotatedX / scaleX, y: rotatedY / scaleY };
  };

  const localPosition = toParentLocal(
    layer.transform.position.x,
    layer.transform.position.y,
  );
  const offsetPosition = {
    x: round4(localPosition.x),
    y: round4(localPosition.y),
    z: round4((layer.transform.position.z ?? 0) - (parentPosition.z ?? 0)),
  };

  return {
    ...layer,
    transform: {
      ...layer.transform,
      position: offsetPosition,
      rotation: round4(layer.transform.rotation - parentTransform.rotation),
      scale: {
        x: round4(layer.transform.scale.x / scaleX),
        y: round4(layer.transform.scale.y / scaleY),
      },
    },
    keyframes: layer.keyframes.map((keyframe) => {
      if (typeof keyframe.value !== "number") {
        return keyframe;
      }
      switch (keyframe.property) {
        case "transform.position.x":
          return {
            ...keyframe,
            value: round4((keyframe.value - parentPosition.x) / scaleX),
          };
        case "transform.position.y":
          return {
            ...keyframe,
            value: round4((keyframe.value - parentPosition.y) / scaleY),
          };
        case "transform.position.z":
          return {
            ...keyframe,
            value: round4(keyframe.value - (parentPosition.z ?? 0)),
          };
        case "transform.rotation":
          return {
            ...keyframe,
            value: round4(keyframe.value - parentTransform.rotation),
          };
        case "transform.scale.x":
          return { ...keyframe, value: round4(keyframe.value / scaleX) };
        case "transform.scale.y":
          return { ...keyframe, value: round4(keyframe.value / scaleY) };
        default:
          return keyframe;
      }
    }),
  } as MotionLayer;
}
