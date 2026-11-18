import type { Transform } from "@openreel/core";
import { useProjectStore, type ProjectState } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";

function resetTarget(state: ProjectState, id: string) {
  const media = state.getClip(id);
  const text = media ? undefined : state.getTextClip(id);
  const graphic = media || text
    ? undefined
    : state.getShapeClip(id) ?? state.getSVGClip(id) ?? state.getStickerClip(id);
  const clip = media ?? text ?? graphic;
  if (!clip || !state.project.timeline.tracks.some(
    track => track.id === clip.trackId && !track.locked,
  )) return null;
  const transform: Pick<Transform, "position" | "scale" | "rotation" | "opacity"> = {
    position: { x: text || graphic ? 0.5 : 0, y: text || graphic ? 0.5 : 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
  };
  const before = clip.transform;
  const changed = before.position.x !== transform.position.x
    || before.position.y !== transform.position.y
    || before.scale.x !== 1 || before.scale.y !== 1
    || before.rotation !== 0 || before.opacity !== 1;
  return changed
    ? { kind: text ? "text" : graphic ? "graphic" : "media", transform }
    : null;
}

export function canResetClipTransform(state: ProjectState, id: string | undefined): boolean {
  return !!id && resetTarget(state, id) !== null;
}

/** Retains the header's 2D reset behavior and its existing per-clip Undo route. */
export async function resetClipTransform(id: string): Promise<boolean> {
  const ui = useUIStore.getState();
  const timeline = useTimelineStore.getState();
  if (ui.exportState.isExporting || ui.effectApplicationClipId !== null
    || timeline.playbackLockedReason) return false;
  const state = useProjectStore.getState();
  const target = resetTarget(state, id);
  if (!target) return false;
  timeline.pause();
  if (target.kind === "text") {
    return state.updateTextTransform(id, target.transform) !== null;
  }
  if (target.kind === "graphic") {
    return state.updateShapeTransform(id, target.transform) !== null;
  }
  return (await state.updateClipTransform(id, target.transform)).success;
}
