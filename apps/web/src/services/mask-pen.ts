import type { BezierPath, Mask } from "@openreel/core";
import { editMaskPathAtTime } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { editClipMasks } from "./clip-masks";

/** Half a frame: path keyframes closer than this to the playhead are the same keyframe. */
export function maskKeyTolerance(): number {
  const rate = useProjectStore.getState().project.settings.frameRate || 30;
  return 0.5 / rate;
}

export function currentMaskTime(): number {
  return useTimelineStore.getState().playheadPosition;
}

export function maskOf(clipId: string, maskId: string): Mask | undefined {
  return (useProjectStore.getState().project.masks ?? []).find(
    (mask) => mask.clipId === clipId && mask.id === maskId,
  );
}

function scopeFor(clipId: string) {
  const state = useProjectStore.getState();
  return { projectId: state.project.id, clipId, history: state.actionHistory };
}

/** One discrete, undoable mask edit (a single undo step). */
export async function commitMaskEdit(
  clipId: string,
  maskId: string,
  produce: (mask: Mask) => Mask,
): Promise<boolean> {
  try {
    return await editClipMasks(scopeFor(clipId), (current) =>
      current.map((mask) => (mask.id === maskId ? produce(mask) : mask)),
    );
  } catch (error) {
    console.warn("[MaskPen] edit failed", error);
    return false;
  }
}

/** Adds a freshly drawn closed path as a new "drawn" mask (one undo step). */
export async function commitNewMask(clipId: string, path: BezierPath, space?: Mask["space"]): Promise<string | null> {
  const mask: Mask = {
    id: crypto.randomUUID(),
    clipId,
    type: "drawn",
    path,
    feathering: 0,
    expansion: 0,
    opacity: 1,
    inverted: false,
    keyframes: [],
    ...(space ? { space } : {}),
  };
  try {
    const ok = await editClipMasks(scopeFor(clipId), (current) => [...current, mask]);
    return ok ? mask.id : null;
  } catch (error) {
    console.warn("[MaskPen] could not add the mask", error);
    return null;
  }
}

/**
 * A pointer gesture (vertex / handle / whole-mask drag). While the pointer is
 * down the edited mask is previewed straight into the project store (no
 * history), so the Program canvas follows the pointer live. `end()` restores
 * the original masks and commits the final path as ONE `mask/setAll` action,
 * so the whole drag is exactly one undo step and the undo target is the mask
 * as it was before the drag. `update` takes the outline as the monitor shows it; `toStored` maps it to the mask's
 * own space (a source-space object mask on a stabilized clip).
 */
export interface MaskGesture {
  readonly base: Mask;
  update: (path: BezierPath) => void;
  end: () => Promise<boolean>;
}

export function beginMaskGesture(clipId: string, maskId: string, toStored: (shown: BezierPath) => BezierPath = (shown) => shown): MaskGesture | null {
  const base = maskOf(clipId, maskId);
  if (!base) return null;
  const scope = scopeFor(clipId);
  const baseMasks = useProjectStore.getState().project.masks ?? [];
  const time = currentMaskTime();
  const tolerance = maskKeyTolerance();
  const edited = (path: BezierPath): Mask => editMaskPathAtTime(base, time, () => toStored(path), tolerance);
  let latest: BezierPath | null = null;
  let frame: number | null = null;
  let previewed = false;

  const flush = (): void => {
    frame = null;
    if (!latest) return;
    const next = edited(latest);
    useProjectStore.setState((state) => {
      if (state.project.id !== scope.projectId) return {};
      return {
        project: {
          ...state.project,
          masks: baseMasks.map((mask) => (mask.id === maskId ? next : mask)),
        },
      };
    });
    previewed = true;
  };

  return {
    base,
    update: (path) => {
      latest = path;
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    end: async () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      const path = latest;
      latest = null;
      if (previewed) {
        // Put the original masks back so the committed action's undo target is the pre-drag state.
        useProjectStore.setState((state) =>
          state.project.id === scope.projectId
            ? { project: { ...state.project, masks: baseMasks } }
            : {},
        );
        previewed = false;
      }
      if (!path) return false;
      try {
        return await editClipMasks(scope, (current) =>
          current.map((mask) => (mask.id === maskId ? edited(path) : mask)),
        );
      } catch (error) {
        console.warn("[MaskPen] gesture commit failed", error);
        return false;
      }
    },
  };
}
