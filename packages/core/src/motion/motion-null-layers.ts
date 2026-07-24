import type { MotionComposition, MotionNullLayer, MotionVector2 } from "./types";
import { DEFAULT_MOTION_TRANSFORM } from "./types";

export interface CreateMotionNullLayerOptions {
  readonly id?: string;
  readonly name?: string;
  readonly startTime?: number;
  readonly duration?: number;
  readonly position?: MotionVector2;
  readonly guideColor?: string;
  readonly guideSize?: number;
}

const createNullLayerId = (): string =>
  `motion-null-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionNullLayer(
  composition: Pick<MotionComposition, "width" | "height" | "duration">,
  options: CreateMotionNullLayerOptions = {},
): MotionNullLayer {
  return normalizeMotionNullLayer({
    id: options.id ?? createNullLayerId(),
    type: "null",
    name: options.name ?? "Null Controller",
    startTime: options.startTime ?? 0,
    duration: options.duration ?? composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: options.position ?? {
        x: composition.width / 2,
        y: composition.height / 2,
        z: 0,
      },
      anchor: { x: 0, y: 0 },
    },
    keyframes: [],
    guideColor: options.guideColor ?? "#14b8a6",
    guideSize: options.guideSize ?? 48,
  });
}

export function normalizeMotionNullLayer(layer: MotionNullLayer): MotionNullLayer {
  return {
    ...layer,
    guideColor: normalizeColor(layer.guideColor, "#14b8a6"),
    guideSize: clamp(finite(layer.guideSize, 48), 12, 240),
  };
}

export function isMotionControllerLayer(
  layer: { readonly type: string },
): layer is MotionNullLayer {
  return layer.type === "null";
}

function normalizeColor(color: string | undefined, fallback: string): string {
  const normalized = color?.trim();
  if (!normalized) return fallback;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return normalized;
  if (/^rgba?\(/i.test(normalized)) return normalized;
  return fallback;
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(Number(value).toFixed(4)) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}
