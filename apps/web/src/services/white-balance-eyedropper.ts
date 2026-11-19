/**
 * White Balance eyedropper: reads the Program monitor under the cursor and
 * turns the sample into Temperature / Tint for one clip.
 *
 * The Program canvas is read directly (the same source the scopes use), so
 * the WebGL and Canvas2D paths behave identically. The clip's current white
 * balance is removed from the sample before solving, so the result replaces
 * the sliders instead of stacking on them. The pick is one
 * `clip/setColorGrading` action: a single undo step.
 */
import {
  evaluateKeyframesAt,
  isFarFromNeutral,
  isNeutralColorGrading,
  isUsableWhiteBalanceSample,
  needsWhiteBalanceInputFrame,
  sampleAverageRgb,
  solveNeutralWhiteBalance,
  whiteBalanceSampleRadius,
  type WhiteBalanceSampleSize,
  type WhiteBalanceSolution,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";

export type WhiteBalancePickResult =
  | { ok: true; solution: WhiteBalanceSolution; farFromNeutral: boolean }
  | { ok: false; reason: "no-frame" | "unusable-sample" | "no-clip" | "outside-clip" | "keyframed" };

/** Average colour (0..1) of the `size` footprint centred on canvas pixel (x, y). Reads only that window. */
export function readCanvasSample(
  source: HTMLCanvasElement | ImageBitmap | OffscreenCanvas,
  x: number,
  y: number,
  size: WhiteBalanceSampleSize,
): [number, number, number] | null {
  if (source.width === 0 || source.height === 0) return null;
  const radius = whiteBalanceSampleRadius(size);
  const cx = Math.min(source.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(source.height - 1, Math.max(0, Math.floor(y)));
  const sx = Math.max(0, cx - radius);
  const sy = Math.max(0, cy - radius);
  const w = Math.min(source.width, cx + radius + 1) - sx;
  const h = Math.min(source.height, cy + radius + 1) - sy;
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, w, h, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  return sampleAverageRgb(image.data, w, h, cx - sx, cy - sy, radius);
}

interface ClipWhiteBalanceState {
  temperature: number;
  tint: number;
  keyframed: boolean;
}

function clipWhiteBalance(clipId: string): ClipWhiteBalanceState | null {
  const clip = useProjectStore.getState().getClip(clipId);
  if (!clip) return null;
  const keys = clip.keyframes ?? [];
  const keyframed = keys.some(
    (key) => key.property === "colorGrade.temperature" || key.property === "colorGrade.tint",
  );
  const sampled = keyframed
    ? evaluateKeyframesAt(keys, Math.max(0, useTimelineStore.getState().playheadPosition - clip.startTime))
    : null;
  return {
    temperature: sampled?.get("colorGrade.temperature") ?? clip.colorGrading?.temperature ?? 0,
    tint: sampled?.get("colorGrade.tint") ?? clip.colorGrading?.tint ?? 0,
    keyframed,
  };
}

/** True when the playhead is over the clip, so the Program frame shows it. */
export function playheadOverClip(clipId: string): boolean {
  const clip = useProjectStore.getState().getClip(clipId);
  if (!clip) return false;
  const head = useTimelineStore.getState().playheadPosition;
  return head >= clip.startTime && head <= clip.startTime + clip.duration;
}

/**
 * True when the displayed Program pixel differs from the white balance stage
 * input (a version 2 clip with later grade stages, or any active white
 * balance), so the pick must sample a transient render of that input.
 */
export function clipNeedsWhiteBalanceInputFrame(clipId: string): boolean {
  const grading = useProjectStore.getState().getClip(clipId)?.colorGrading;
  if (!grading) return false;
  // The clip stores LUTs as JSON; only the neutral/non-neutral decision is needed here.
  return needsWhiteBalanceInputFrame(grading, (g) =>
    isNeutralColorGrading(g as unknown as Parameters<typeof isNeutralColorGrading>[0]),
  );
}

/**
 * What the sliders would become for this sample, without changing the project.
 * `inputFrame` says the sample already is the white balance stage input, so no
 * current white balance is removed from it.
 */
export function previewWhiteBalancePick(
  clipId: string,
  sample: [number, number, number] | null,
  inputFrame = false,
): WhiteBalancePickResult {
  const state = clipWhiteBalance(clipId);
  if (!state) return { ok: false, reason: "no-clip" };
  if (state.keyframed) return { ok: false, reason: "keyframed" };
  if (!playheadOverClip(clipId)) return { ok: false, reason: "outside-clip" };
  if (!sample) return { ok: false, reason: "no-frame" };
  if (!isUsableWhiteBalanceSample(sample)) return { ok: false, reason: "unusable-sample" };
  const solution = solveNeutralWhiteBalance(sample, inputFrame ? {} : state);
  return solution ? { ok: true, solution, farFromNeutral: isFarFromNeutral(sample) } : { ok: false, reason: "unusable-sample" };
}

/** Commit a pick as one undoable action. */
export async function applyWhiteBalancePick(
  clipId: string,
  sample: [number, number, number] | null,
  inputFrame = false,
): Promise<WhiteBalancePickResult> {
  const result = previewWhiteBalancePick(clipId, sample, inputFrame);
  if (!result.ok) return result;
  const saved = await useProjectStore.getState().updateColorGrading(clipId, {
    temperature: result.solution.temperature,
    tint: result.solution.tint,
  });
  return saved ? result : { ok: false, reason: "no-clip" };
}

export const WHITE_BALANCE_PICK_MESSAGES: Record<
  Exclude<WhiteBalancePickResult, { ok: true }>["reason"],
  string
> = {
  "no-frame": "The Program monitor has no frame to sample yet.",
  "unusable-sample": "That pixel is pure black or white. Pick a neutral grey or white area that is not clipped.",
  "no-clip": "The clip is no longer available.",
  "outside-clip": "Move the playhead over the clip, then pick a neutral area.",
  keyframed: "Temperature or Tint is keyframed on this clip. Remove the keyframes or edit them at the playhead.",
};
