import type { MotionAdjustmentLayer, MotionTransform } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

export interface CreateMotionAdjustmentLayerOptions {
  readonly id?: string;
  readonly name?: string;
  readonly startTime?: number;
  readonly duration: number;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly transform?: Partial<MotionTransform>;
}

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionAdjustmentLayer(
  options: CreateMotionAdjustmentLayerOptions,
): MotionAdjustmentLayer {
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
    type: "adjustment",
    name: options.name ?? "Adjustment Layer",
    startTime: options.startTime ?? 0,
    duration: options.duration,
    visible: true,
    locked: false,
    transform,
    keyframes: [],
    width: options.compositionWidth,
    height: options.compositionHeight,
    effects: [],
  };
}

export function isMotionAdjustmentLayer(
  layer: { readonly type: string },
): layer is MotionAdjustmentLayer {
  return layer.type === "adjustment";
}
