import type { Keyframe, AutomationPoint } from "../types/timeline";

export function keyframesToAutomation(
  keyframes: Keyframe[] | undefined,
  property: string,
): AutomationPoint[] {
  if (!keyframes || keyframes.length === 0) return [];
  return keyframes
    .filter((kf) => kf.property === property && typeof kf.value === "number")
    .map((kf) => ({ time: kf.time, value: kf.value as number }))
    .sort((a, b) => a.time - b.time);
}
