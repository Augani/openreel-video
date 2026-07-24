import type {
  MotionComposition,
  MotionCompositionLayer,
  MotionInstanceOverrides,
  MotionLayer,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";
import type { Keyframe } from "../types/timeline";
import {
  getMotionLayerDescendantIds,
  normalizeMotionLayerHierarchy,
} from "./motion-hierarchy";
import {
  getMotionCompositionLayerLinearTime,
  removeMotionLayerPropertyKeyframes,
  sortMotionKeyframes,
} from "./motion-keyframes";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";

export const MOTION_COMPOSITION_TIME_PROPERTY = "composition.time";

export interface PrecomposeMotionLayersOptions {
  readonly name?: string;
  readonly compositionId?: string;
  readonly layerId?: string;
  readonly now?: number;
}

export interface PrecomposeMotionLayersResult {
  readonly hostComposition: MotionComposition;
  readonly nestedComposition: MotionComposition;
  readonly precompLayerId: string;
  readonly movedLayerIds: string[];
}

export interface EnableMotionCompositionTimeRemapOptions {
  readonly sourceDuration?: number;
  readonly idFactory?: (time: number, value: number, index: number) => string;
}

export function getMotionCompositionById(
  compositions: readonly MotionComposition[],
  compositionId: string | null | undefined,
): MotionComposition | undefined {
  if (!compositionId) return undefined;
  return compositions.find((composition) => composition.id === compositionId);
}

export function isMotionCompositionLayer(
  layer: MotionLayer,
): layer is MotionCompositionLayer {
  return layer.type === "composition";
}

export function getNestedMotionCompositionIds(
  composition: MotionComposition,
): string[] {
  return composition.layers
    .filter(isMotionCompositionLayer)
    .map((layer) => layer.compositionId)
    .filter(Boolean);
}

export function getMotionCompositionDescendantIds(
  compositions: readonly MotionComposition[],
  compositionId: string,
): Set<string> {
  const descendants = new Set<string>();
  const visit = (currentId: string) => {
    const current = getMotionCompositionById(compositions, currentId);
    if (!current) return;

    for (const nestedId of getNestedMotionCompositionIds(current)) {
      if (descendants.has(nestedId)) continue;
      descendants.add(nestedId);
      visit(nestedId);
    }
  };

  visit(compositionId);
  return descendants;
}

export function canNestMotionComposition(
  compositions: readonly MotionComposition[],
  hostCompositionId: string,
  sourceCompositionId: string | null | undefined,
): boolean {
  if (!sourceCompositionId) return false;
  if (hostCompositionId === sourceCompositionId) return false;
  if (!getMotionCompositionById(compositions, hostCompositionId)) return false;
  if (!getMotionCompositionById(compositions, sourceCompositionId)) return false;
  return !getMotionCompositionDescendantIds(
    compositions,
    sourceCompositionId,
  ).has(hostCompositionId);
}

export function getMotionCompositionLayerSource(
  compositions: readonly MotionComposition[],
  layer: MotionCompositionLayer,
): MotionComposition | undefined {
  return getMotionCompositionById(compositions, layer.compositionId);
}

export function getMotionCompositionLayerLocalTime(
  layer: MotionCompositionLayer,
  layerLocalTime: number,
): number {
  return Math.max(0, evaluateMotionPropertyValueAtTime({
    keyframes: layer.keyframes,
    expressions: layer.expressions,
    property: MOTION_COMPOSITION_TIME_PROPERTY,
    localTime: layerLocalTime,
    fallback: getMotionCompositionLayerLinearTime(layer, layerLocalTime),
    duration: layer.duration,
  }));
}

export function getMotionCompositionLayerPlaybackTime(
  layer: MotionCompositionLayer,
  layerLocalTime: number,
  sourceDuration: number,
): number {
  const sourceTime = getMotionCompositionLayerLocalTime(layer, layerLocalTime);
  if (!layer.loop || !Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return sourceTime;
  }
  const wrapped = sourceTime % sourceDuration;
  return wrapped < 0 ? wrapped + sourceDuration : wrapped;
}

export function isMotionCompositionTimeRemapped(
  layer: MotionCompositionLayer,
): boolean {
  return layer.keyframes.some(
    (keyframe) => keyframe.property === MOTION_COMPOSITION_TIME_PROPERTY,
  );
}

export function enableMotionCompositionTimeRemap<T extends MotionCompositionLayer>(
  layer: T,
  options: EnableMotionCompositionTimeRemapOptions = {},
): T {
  const endTime = Math.max(0.001, layer.duration);
  const startValue = getMotionCompositionLayerLinearTime(layer, 0);
  const rawEndValue = getMotionCompositionLayerLinearTime(layer, endTime);
  const endValue =
    options.sourceDuration === undefined
      ? rawEndValue
      : Math.min(Math.max(0, options.sourceDuration), rawEndValue);
  const remapKeys: Keyframe[] = [
    {
      id: options.idFactory?.(0, startValue, 0) ?? createPrecomposeId("motion-kf"),
      property: MOTION_COMPOSITION_TIME_PROPERTY,
      time: 0,
      value: startValue,
      easing: "linear",
    },
    {
      id:
        options.idFactory?.(endTime, endValue, 1) ??
        createPrecomposeId("motion-kf"),
      property: MOTION_COMPOSITION_TIME_PROPERTY,
      time: endTime,
      value: endValue,
      easing: "linear",
    },
  ];
  return {
    ...removeMotionLayerPropertyKeyframes(layer, MOTION_COMPOSITION_TIME_PROPERTY),
    keyframes: sortMotionKeyframes([
      ...layer.keyframes.filter(
        (keyframe) => keyframe.property !== MOTION_COMPOSITION_TIME_PROPERTY,
      ),
      ...remapKeys,
    ]),
  } as T;
}

export function clearMotionCompositionTimeRemap<T extends MotionCompositionLayer>(
  layer: T,
): T {
  return removeMotionLayerPropertyKeyframes(
    layer,
    MOTION_COMPOSITION_TIME_PROPERTY,
  );
}

export function precomposeMotionLayers(
  hostComposition: MotionComposition,
  layerIds: readonly string[],
  options: PrecomposeMotionLayersOptions = {},
): PrecomposeMotionLayersResult | null {
  const movedLayerIds = getLayerIdsWithDescendants(hostComposition, layerIds);
  if (movedLayerIds.size === 0) return null;

  const selectedLayers = hostComposition.layers.filter((layer) =>
    movedLayerIds.has(layer.id),
  );
  if (selectedLayers.length === 0) return null;

  const now = options.now ?? Date.now();
  const nestedCompositionId =
    options.compositionId ?? createPrecomposeId("motion-precomp");
  const precompLayerId = options.layerId ?? createPrecomposeId("motion-layer");
  const name =
    options.name ??
    (selectedLayers.length === 1
      ? `${selectedLayers[0]?.name ?? "Layer"} Precomp`
      : `Precomp ${selectedLayers.length} Layers`);
  const firstSelectedIndex = hostComposition.layers.findIndex((layer) =>
    movedLayerIds.has(layer.id),
  );
  const movedLayerIdSet = new Set(selectedLayers.map((layer) => layer.id));
  const nestedLayers = normalizeMotionLayerHierarchy({
    ...hostComposition,
    id: nestedCompositionId,
    name,
    backgroundColor: "transparent",
    layers: selectedLayers.map((layer) =>
      cleanLayerReferencesForPrecomp(layer, movedLayerIdSet),
    ),
    createdAt: now,
    modifiedAt: now,
  }).layers;
  const nestedComposition: MotionComposition = {
    ...hostComposition,
    id: nestedCompositionId,
    name,
    backgroundColor: "transparent",
    layers: nestedLayers,
    guides: [],
    createdAt: now,
    modifiedAt: now,
  };
  const precompLayer: MotionCompositionLayer = {
    id: precompLayerId,
    type: "composition",
    name,
    startTime: 0,
    duration: hostComposition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: {
        x: hostComposition.width / 2,
        y: hostComposition.height / 2,
      },
    },
    keyframes: [],
    compositionId: nestedComposition.id,
    width: hostComposition.width,
    height: hostComposition.height,
    timeOffset: 0,
    playbackRate: 1,
    fit: "fill",
  };

  const hostLayers = hostComposition.layers.reduce<MotionLayer[]>(
    (layers, layer, index) => {
      if (index === firstSelectedIndex) {
        layers.push(precompLayer);
      }
      if (!movedLayerIds.has(layer.id)) {
        layers.push(cleanLayerReferencesForHost(layer, movedLayerIds));
      }
      return layers;
    },
    [],
  );

  return {
    hostComposition: normalizeMotionLayerHierarchy({
      ...hostComposition,
      layers: hostLayers,
      modifiedAt: now,
    }),
    nestedComposition,
    precompLayerId,
    movedLayerIds: selectedLayers.map((layer) => layer.id),
  };
}

/**
 * Apply a component instance's per-child overrides (text / fill color) onto a
 * clone of the referenced component composition, for rendering a single instance
 * without mutating the shared master.
 */
export function applyMotionInstanceOverrides(
  source: MotionComposition,
  overrides: MotionInstanceOverrides | undefined,
): MotionComposition {
  if (!overrides || Object.keys(overrides).length === 0) return source;
  return {
    ...source,
    layers: source.layers.map((layer) => {
      const override = overrides[layer.id];
      if (!override) return layer;
      let next = layer;
      if (override.text !== undefined && next.type === "text") {
        next = { ...next, text: override.text };
      }
      if (override.color !== undefined) {
        if (next.type === "text") {
          const { fillGradient: _droppedGradient, ...restStyle } = next.style;
          next = { ...next, style: { ...restStyle, color: override.color } };
        } else if (next.type === "shape") {
          next = {
            ...next,
            style: {
              ...next.style,
              fill: {
                type: "solid",
                color: override.color,
                opacity: next.style.fill.opacity ?? 1,
              },
            },
          };
        }
      }
      return next;
    }),
  };
}

/**
 * Add another instance of a component: duplicate a composition-layer so it
 * references the same master composition (edits to the master update all
 * instances), offset on stage. Returns null if the layer isn't a composition.
 */
export function addMotionComponentInstance(
  composition: MotionComposition,
  instanceLayerId: string,
  options: { readonly id?: string; readonly offset?: { x: number; y: number } } = {},
): { readonly composition: MotionComposition; readonly instanceLayerId: string } | null {
  const source = composition.layers.find(
    (layer): layer is MotionCompositionLayer =>
      layer.id === instanceLayerId && layer.type === "composition",
  );
  if (!source) return null;
  const newId = options.id ?? createPrecomposeId("motion-layer");
  const offset = options.offset ?? { x: 48, y: 48 };
  const instance: MotionCompositionLayer = {
    ...source,
    id: newId,
    parentId: source.parentId,
    transform: {
      ...source.transform,
      position: {
        ...source.transform.position,
        x: source.transform.position.x + offset.x,
        y: source.transform.position.y + offset.y,
      },
    },
  };
  const layers = composition.layers.map((layer) =>
    layer.id === source.parentId && layer.type === "group"
      ? { ...layer, children: [...layer.children, newId] }
      : layer,
  );
  return {
    composition: {
      ...composition,
      layers: [...layers, instance],
      modifiedAt: Date.now(),
    },
    instanceLayerId: newId,
  };
}

function getLayerIdsWithDescendants(
  composition: MotionComposition,
  layerIds: readonly string[],
): Set<string> {
  const existingLayerIds = new Set(composition.layers.map((layer) => layer.id));
  const ids = new Set(layerIds.filter((id) => existingLayerIds.has(id)));
  for (const layerId of [...ids]) {
    for (const descendantId of getMotionLayerDescendantIds(composition, layerId)) {
      ids.add(descendantId);
    }
  }
  return ids;
}

function cleanLayerReferencesForPrecomp(
  layer: MotionLayer,
  movedLayerIds: ReadonlySet<string>,
): MotionLayer {
  const nextLayer = {
    ...layer,
    parentId:
      layer.parentId && movedLayerIds.has(layer.parentId)
        ? layer.parentId
        : undefined,
    trackMatte:
      layer.trackMatte && movedLayerIds.has(layer.trackMatte.sourceLayerId)
        ? layer.trackMatte
        : undefined,
  } as MotionLayer;

  if (nextLayer.type === "group") {
    return {
      ...nextLayer,
      children: nextLayer.children.filter((childId) => movedLayerIds.has(childId)),
    };
  }
  return nextLayer;
}

function cleanLayerReferencesForHost(
  layer: MotionLayer,
  movedLayerIds: ReadonlySet<string>,
): MotionLayer {
  const nextLayer = {
    ...layer,
    parentId:
      layer.parentId && movedLayerIds.has(layer.parentId) ? undefined : layer.parentId,
    trackMatte:
      layer.trackMatte && movedLayerIds.has(layer.trackMatte.sourceLayerId)
        ? undefined
        : layer.trackMatte,
  } as MotionLayer;

  if (nextLayer.type === "group") {
    return {
      ...nextLayer,
      children: nextLayer.children.filter((childId) => !movedLayerIds.has(childId)),
    };
  }
  return nextLayer;
}

function createPrecomposeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
