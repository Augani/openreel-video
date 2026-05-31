import type { Keyframe } from "../types/timeline";
import { keyframeEngine } from "../video/keyframe-engine";

export function evaluateKeyframesAt(
  keyframes: Keyframe[],
  localTime: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!keyframes || keyframes.length === 0) return out;
  const byProp = new Map<string, Keyframe[]>();
  for (const kf of keyframes) {
    const arr = byProp.get(kf.property);
    if (arr) arr.push(kf);
    else byProp.set(kf.property, [kf]);
  }
  for (const [property, kfs] of byProp) {
    const result = keyframeEngine.getValueAtTime(kfs, localTime);
    if (typeof result.value === "number") out.set(property, result.value);
  }
  return out;
}
