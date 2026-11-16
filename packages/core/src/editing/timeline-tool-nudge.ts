import type { Project } from "../types/project";
import type { Clip } from "../types/timeline";
import {
  prepareTimelineToolEdit,
  type TimelineToolMode,
  type TimelineToolPlan,
} from "./timeline-tool-edit";

export const NUDGE_FRAMES = 1;
export const NUDGE_FRAMES_LARGE = 5;

/** The edit point nearest the playhead: the clip's head or its tail. */
export function chooseNudgeEdge(
  clip: { startTime: number; duration: number },
  playhead: number,
): "left" | "right" {
  const toStart = Math.abs(playhead - clip.startTime);
  const toEnd = Math.abs(playhead - (clip.startTime + clip.duration));
  return toStart < toEnd ? "left" : "right";
}

/**
 * Plans a keyboard nudge of the active tool's edit by whole frames. Positive
 * `frames` is a rightward gesture, matching a drag: later in time for ripple,
 * roll, slide and stretch; for slip the content moves the opposite way (as in
 * a drag), unless the clip is reversed. Bounds are the same as a drag, so a
 * nudge past a handle or neighbour is clamped (an empty plan if nothing moves).
 */
export function planToolNudge(
  project: Project,
  options: {
    mode: TimelineToolMode;
    itemId: string;
    linkedIds?: readonly string[];
    edge?: "left" | "right";
    frames: number;
  },
): TimelineToolPlan {
  const { frames, ...rest } = options;
  if (!Number.isFinite(frames)) throw new Error("The nudge must be finite.");
  const prepared = prepareTimelineToolEdit(project, rest);
  const rate =
    Number.isFinite(project.settings.frameRate) && project.settings.frameRate > 0
      ? project.settings.frameRate
      : 30;
  const reversed = "reversed" in prepared.primary && Boolean((prepared.primary as Clip).reversed);
  const sign = options.mode === "slip" && !reversed ? -1 : 1;
  return prepared.plan((sign * frames) / rate);
}
