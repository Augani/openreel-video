import type { MediaItem } from "../types/project";
import type {
  MotionAsset,
  MotionImageLayer,
  MotionTransform,
  MotionVideoLayer,
} from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

export interface CreateMotionImageLayerOptions {
  readonly id?: string;
  readonly name?: string;
  readonly startTime?: number;
  readonly duration: number;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly transform?: Partial<MotionTransform>;
}

export type CreateMotionVideoLayerOptions = CreateMotionImageLayerOptions;

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionImageAssetFromMediaItem(
  item: MediaItem,
  id = `motion-asset-${item.id}`,
): MotionAsset {
  if (item.type !== "image") {
    throw new Error(`Cannot create a motion image asset from ${item.type} media`);
  }
  return {
    id,
    type: "image",
    name: item.name,
    mediaId: item.id,
    width: item.metadata.width,
    height: item.metadata.height,
  };
}

export function createMotionImageLayerFromAsset(
  asset: MotionAsset,
  options: CreateMotionImageLayerOptions,
): MotionImageLayer {
  if (asset.type !== "image") {
    throw new Error(`Cannot create an image layer from ${asset.type} asset`);
  }
  const transform = {
    ...DEFAULT_MOTION_TRANSFORM,
    ...options.transform,
    position: options.transform?.position ?? {
      x: options.compositionWidth / 2,
      y: options.compositionHeight / 2,
    },
  };
  return {
    id: options.id ?? uid("motion-layer"),
    type: "image",
    name: options.name ?? asset.name,
    startTime: options.startTime ?? 0,
    duration: options.duration,
    visible: true,
    locked: false,
    transform,
    keyframes: [],
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    fit: "contain",
  };
}

export function createMotionVideoAssetFromMediaItem(
  item: MediaItem,
  id = `motion-asset-${item.id}`,
): MotionAsset {
  if (item.type !== "video") {
    throw new Error(`Cannot create a motion video asset from ${item.type} media`);
  }
  return {
    id,
    type: "video",
    name: item.name,
    mediaId: item.id,
    width: item.metadata.width,
    height: item.metadata.height,
    duration: item.metadata.duration,
  };
}

export function createMotionVideoLayerFromAsset(
  asset: MotionAsset,
  options: CreateMotionVideoLayerOptions,
): MotionVideoLayer {
  if (asset.type !== "video") {
    throw new Error(`Cannot create a video layer from ${asset.type} asset`);
  }
  const transform = {
    ...DEFAULT_MOTION_TRANSFORM,
    ...options.transform,
    position: options.transform?.position ?? {
      x: options.compositionWidth / 2,
      y: options.compositionHeight / 2,
    },
  };
  return {
    id: options.id ?? uid("motion-layer"),
    type: "video",
    name: options.name ?? asset.name,
    startTime: options.startTime ?? 0,
    duration: options.duration,
    visible: true,
    locked: false,
    transform,
    keyframes: [],
    assetId: asset.id,
    width: asset.width,
    height: asset.height,
    fit: "contain",
    playbackRate: 1,
    timeOffset: 0,
    trimStart: 0,
  };
}
