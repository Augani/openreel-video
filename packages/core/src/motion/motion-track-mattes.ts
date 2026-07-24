import type {
  MotionComposition,
  MotionLayer,
  MotionTrackMatte,
  MotionTrackMatteType,
} from "./types";
import {
  getMotionLayerById,
  getMotionLayerDescendantIds,
} from "./motion-hierarchy";

export interface MotionTrackMattePreset {
  readonly type: MotionTrackMatteType;
  readonly name: string;
  readonly description: string;
}

export const MOTION_TRACK_MATTE_PRESETS: readonly MotionTrackMattePreset[] = [
  {
    type: "alpha",
    name: "Alpha",
    description: "Uses source transparency to reveal this layer.",
  },
  {
    type: "alpha-inverted",
    name: "Alpha Inverted",
    description: "Uses source transparency to cut this layer away.",
  },
  {
    type: "luma",
    name: "Luma",
    description: "Uses source brightness to reveal this layer.",
  },
  {
    type: "luma-inverted",
    name: "Luma Inverted",
    description: "Uses source brightness to cut this layer away.",
  },
];

export function getAvailableMotionTrackMatteSources(
  composition: MotionComposition,
  layerId: string,
): MotionLayer[] {
  const excluded = getMotionLayerDescendantIds(composition, layerId);
  excluded.add(layerId);
  return composition.layers.filter((layer) => !excluded.has(layer.id));
}

export function getMotionTrackMatteSource(
  composition: MotionComposition,
  layer: MotionLayer,
): MotionLayer | undefined {
  const matte = layer.trackMatte;
  if (!matte?.enabled) return undefined;
  if (matte.sourceLayerId === layer.id) return undefined;
  return getMotionLayerById(composition, matte.sourceLayerId);
}

export function setMotionLayerTrackMatte<T extends MotionLayer>(
  layer: T,
  matte: MotionTrackMatte,
): T {
  return {
    ...layer,
    trackMatte: sanitizeMotionTrackMatte(matte),
  } as T;
}

export function updateMotionLayerTrackMatte<T extends MotionLayer>(
  layer: T,
  updater: (matte: MotionTrackMatte) => MotionTrackMatte,
): T {
  const matte = layer.trackMatte;
  if (!matte) return layer;
  return setMotionLayerTrackMatte(layer, updater(matte));
}

export function toggleMotionLayerTrackMatte<T extends MotionLayer>(
  layer: T,
  enabled: boolean,
): T {
  return updateMotionLayerTrackMatte(layer, (matte) => ({ ...matte, enabled }));
}

export function clearMotionLayerTrackMatte<T extends MotionLayer>(layer: T): T {
  const { trackMatte: _trackMatte, ...rest } = layer;
  return rest as T;
}

export function isInvertedMotionTrackMatte(
  type: MotionTrackMatteType,
): boolean {
  return type === "alpha-inverted" || type === "luma-inverted";
}

export function isLumaMotionTrackMatte(type: MotionTrackMatteType): boolean {
  return type === "luma" || type === "luma-inverted";
}

function sanitizeMotionTrackMatte(matte: MotionTrackMatte): MotionTrackMatte {
  return {
    enabled: matte.enabled,
    sourceLayerId: matte.sourceLayerId,
    type: isSupportedType(matte.type) ? matte.type : "alpha",
  };
}

function isSupportedType(value: string): value is MotionTrackMatteType {
  return MOTION_TRACK_MATTE_PRESETS.some((preset) => preset.type === value);
}
