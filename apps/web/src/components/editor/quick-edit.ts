import type { Clip } from "@openreel/core";

/** Avoid splitting or trimming away fractions of a single project frame. */
export function canQuickEditAtPlayhead(
  clip: Pick<Clip, "startTime" | "duration">,
  time: number,
  frameRate: number,
): boolean {
  const frame = 1 / (Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30);
  return Number.isFinite(time) &&
    time >= clip.startTime + frame - 1e-6 &&
    time <= clip.startTime + clip.duration - frame + 1e-6;
}
