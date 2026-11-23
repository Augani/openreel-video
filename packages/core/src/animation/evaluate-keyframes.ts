import type { Keyframe } from "../types/timeline";
import { keyframeEngine } from "../video/keyframe-engine";
import { samplePositionPath } from "./spatial-path";

export function evaluateKeyframesAt(
  keyframes: readonly Keyframe[] | undefined,
  localTime: number,
): Map<string, number> {
  const values = new Map<string, number>();
  if (!keyframes || keyframes.length === 0) {
    return values;
  }

  const byProperty = new Map<string, Keyframe[]>();
  for (const keyframe of keyframes) {
    const group = byProperty.get(keyframe.property);
    if (group) {
      group.push(keyframe);
    } else {
      byProperty.set(keyframe.property, [keyframe]);
    }
  }

  for (const [property, propertyKeyframes] of byProperty) {
    const result = keyframeEngine.getValueAtTime(propertyKeyframes, localTime);
    if (typeof result.value === "number" && Number.isFinite(result.value)) {
      values.set(property, result.value);
    }
  }

  const route = samplePositionPath(keyframes, localTime, (t, key) => keyframeEngine.easeSegment(t, key));
  if (route && Number.isFinite(route.x) && Number.isFinite(route.y)) {
    values.set("position.x", route.x);
    values.set("position.y", route.y);
  }

  return values;
}
