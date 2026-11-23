import type { EasingType, Keyframe } from "../types/timeline";
import { EASING_FUNCTIONS, type EasingName } from "./easing-functions";
import { solveBezierEase, DEFAULT_BEZIER_HANDLES } from "./keyframe-bezier";

const isNamedEasing = (easing: EasingType): easing is EasingName => easing in EASING_FUNCTIONS;

/**
 * Eased progress (0..1) of the segment that leaves `keyframe`, for linear progress `t`. The single definition used by the
 * keyframe engine (graph, preview, export) and by anything that has to evaluate a lane without pulling the whole engine in.
 */
export function easeKeyframeSegment(t: number, keyframe: Pick<Keyframe, "easing" | "bezierHandles">): number {
  const clampedT = Math.max(0, Math.min(1, t));
  if (keyframe.bezierHandles && keyframe.easing === "bezier") {
    return solveBezierEase(clampedT, keyframe.bezierHandles.in.x, keyframe.bezierHandles.in.y, keyframe.bezierHandles.out.x, keyframe.bezierHandles.out.y);
  }
  switch (keyframe.easing) {
    case "linear":
      return clampedT;
    case "ease-in":
      return clampedT * clampedT;
    case "ease-out":
      return clampedT * (2 - clampedT);
    case "ease-in-out":
      return clampedT < 0.5 ? 2 * clampedT * clampedT : -1 + (4 - 2 * clampedT) * clampedT;
    case "bezier":
      // Default bezier if no handles specified
      return solveBezierEase(clampedT, DEFAULT_BEZIER_HANDLES.in.x, DEFAULT_BEZIER_HANDLES.in.y, DEFAULT_BEZIER_HANDLES.out.x, DEFAULT_BEZIER_HANDLES.out.y);
    default:
      if (isNamedEasing(keyframe.easing)) return EASING_FUNCTIONS[keyframe.easing](clampedT);
      return clampedT;
  }
}
