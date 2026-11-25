import { clipHasWarp, framePlacement, getSpeedEngine, masksInStabilizedSpace, warpCompositionMap, type Clip, type Mask } from "@openreel/core";
import type { ClipTransform } from "./types";

interface Sized { width?: number; height?: number; videoWidth?: number; videoHeight?: number }

/**
 * The clip's masks as the Program monitor draws them: object masks (tracked on the raw decoded frames) move with
 * the clip's stabilizing warp at this time, exactly as the export compositor moves them. Other masks are unchanged.
 */
export function masksForStabilizedFrame(
  clip: Clip | undefined,
  masks: readonly Mask[],
  frame: Sized,
  transform: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): readonly Mask[] {
  if (!clip || masks.length === 0 || !masks.some((mask) => mask.space === "source") || !clipHasWarp(clip)) return masks;
  const width = frame.videoWidth ?? frame.width ?? 0;
  const height = frame.videoHeight ?? frame.height ?? 0;
  if (!(width > 0) || !(height > 0)) return masks;
  const sourceTime = (clip.inPoint ?? 0) + getSpeedEngine().getSourceTimeAtPlaybackTime(clip.id, time - clip.startTime);
  return masksInStabilizedSpace(masks, warpCompositionMap(clip, sourceTime, width, height, framePlacement(transform, width, height, canvasWidth, canvasHeight)), time);
}
