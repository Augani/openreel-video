import type { MotionLayer } from "./types";
import type { EasingType } from "../types/timeline";
import {
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValueAtTime,
  upsertMotionLayerKeyframe,
} from "./motion-keyframes";

export interface MotionPositionPathPoint {
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly xKeyframeId?: string;
  readonly yKeyframeId?: string;
  readonly easing: EasingType;
}

export function getMotionLayerPositionPath(
  layer: MotionLayer,
): MotionPositionPathPoint[] {
  const xKeyframes = getMotionLayerPropertyKeyframes(
    layer,
    "transform.position.x",
  );
  const yKeyframes = getMotionLayerPropertyKeyframes(
    layer,
    "transform.position.y",
  );
  const times = new Set([
    ...xKeyframes.map((keyframe) => keyframe.time),
    ...yKeyframes.map((keyframe) => keyframe.time),
  ]);
  if (times.size === 0) return [];

  const xByTime = new Map(xKeyframes.map((keyframe) => [keyframe.time, keyframe]));
  const yByTime = new Map(yKeyframes.map((keyframe) => [keyframe.time, keyframe]));

  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const xKeyframe = xByTime.get(time);
      const yKeyframe = yByTime.get(time);
      return {
        time,
        x: readNumericKeyframeValue(
          xKeyframe?.value,
          getMotionLayerPropertyValueAtTime(
            layer,
            "transform.position.x",
            time,
          ),
        ),
        y: readNumericKeyframeValue(
          yKeyframe?.value,
          getMotionLayerPropertyValueAtTime(
            layer,
            "transform.position.y",
            time,
          ),
        ),
        xKeyframeId: xKeyframe?.id,
        yKeyframeId: yKeyframe?.id,
        easing: xKeyframe?.easing ?? yKeyframe?.easing ?? "ease",
      };
    });
}

export function setMotionLayerPositionPathPoint<T extends MotionLayer>(
  layer: T,
  time: number,
  position: { readonly x: number; readonly y: number },
  easing: EasingType = "ease",
): T {
  return upsertMotionLayerKeyframe(
    upsertMotionLayerKeyframe(layer, "transform.position.x", time, {
      value: roundMotionPathValue(position.x),
      easing,
    }),
    "transform.position.y",
    time,
    {
      value: roundMotionPathValue(position.y),
      easing,
    },
  );
}

function readNumericKeyframeValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundMotionPathValue(value: number): number {
  return Number(value.toFixed(4));
}
