import type { TextAnimation } from "./types";

/** Entry has priority when phase windows overlap, matching character animation. */
export function isTextAnimationEntry(animation: TextAnimation, time: number, duration: number): boolean {
  const entryDuration = animation.preset === "none" ? 0 : animation.inDuration;
  return time <= entryDuration || animation.outDuration <= 0 || time < duration - animation.outDuration;
}

export function resolveTextAnimationPhase(animation: TextAnimation, entry: boolean): TextAnimation {
  if (entry || !animation.out) return animation;
  return {
    ...animation.out,
    inDuration: animation.inDuration,
    outDuration: animation.outDuration,
  };
}
