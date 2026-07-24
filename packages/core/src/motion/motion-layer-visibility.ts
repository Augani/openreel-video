import type { MotionComposition, MotionLayer } from "./types";
import {
  getMotionLayerDescendantIds,
  getMotionLayerParentChain,
} from "./motion-hierarchy";

export function getMotionSoloLayerIds(
  composition: MotionComposition,
): ReadonlySet<string> {
  return new Set(
    composition.layers
      .filter((layer) => layer.solo)
      .map((layer) => layer.id),
  );
}

export function hasMotionSoloLayers(composition: MotionComposition): boolean {
  return getMotionSoloLayerIds(composition).size > 0;
}

export function isMotionLayerTreeVisible(
  composition: MotionComposition,
  layer: MotionLayer,
  soloLayerIds: ReadonlySet<string> = getMotionSoloLayerIds(composition),
): boolean {
  if (soloLayerIds.size === 0) return true;
  if (soloLayerIds.has(layer.id)) return true;
  if (hasSoloAncestor(composition, layer, soloLayerIds)) return true;
  return Array.from(getMotionLayerDescendantIds(composition, layer.id)).some((id) =>
    soloLayerIds.has(id),
  );
}

export function isMotionLayerContentVisible(
  composition: MotionComposition,
  layer: MotionLayer,
  soloLayerIds: ReadonlySet<string> = getMotionSoloLayerIds(composition),
): boolean {
  if (layer.guideLayer) return false;
  if (soloLayerIds.size === 0) return true;
  return soloLayerIds.has(layer.id) || hasSoloAncestor(composition, layer, soloLayerIds);
}

export function isMotionGuideLayer(layer: MotionLayer): boolean {
  return Boolean(layer.guideLayer);
}

function hasSoloAncestor(
  composition: MotionComposition,
  layer: MotionLayer,
  soloLayerIds: ReadonlySet<string>,
): boolean {
  return getMotionLayerParentChain(composition, layer).some((parent) =>
    soloLayerIds.has(parent.id),
  );
}
