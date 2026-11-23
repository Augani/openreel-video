import {
  applySpatialInterpolation,
  pairPositionKeys,
  setSpatialHandle,
  type Clip,
  type Keyframe,
  type SpatialInterpolationOp,
  type Vec2,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";

/**
 * Edits to the position motion path (spatial interpolation). Every edit is one `keyframe/setAll`
 * undo step on the clip, like the temporal interpolation edits, and is refused while exporting, while
 * playback is locked, or when the clip's track is locked.
 */
function editableClip(clipId: string): Clip | null {
  if (useUIStore.getState().exportState.isExporting || useTimelineStore.getState().playbackLockedReason) return null;
  const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  return track && !track.locked ? (track.clips.find((c) => c.id === clipId) ?? null) : null;
}

function commit(clip: Clip, keyframes: Keyframe[]): boolean {
  if (keyframes.every((key, i) => key === clip.keyframes[i]) && keyframes.length === clip.keyframes.length) return false;
  return useProjectStore.getState().updateClipKeyframes(clip.id, keyframes, { derived: true });
}

export function applySpatialInterpolationToClip(clipId: string, keyIds: readonly string[], op: SpatialInterpolationOp): boolean {
  const clip = editableClip(clipId);
  if (!clip?.keyframes?.length || !keyIds.length) return false;
  return commit(clip, applySpatialInterpolation(clip.keyframes, keyIds, op));
}

/** `offset` is the handle's position relative to its key, in position units. */
export function setSpatialHandleOnClip(clipId: string, keyId: string, which: "in" | "out", offset: Vec2): boolean {
  const clip = editableClip(clipId);
  if (!clip?.keyframes?.length) return false;
  return commit(clip, setSpatialHandle(clip.keyframes, keyId, which, offset));
}

/** Moves the position keys of path vertex `index` to (x, y). */
export function moveSpatialVertexOnClip(clipId: string, index: number, x: number, y: number): boolean {
  const clip = editableClip(clipId);
  if (!clip?.keyframes?.length) return false;
  const pairs = pairPositionKeys(clip.keyframes);
  const pair = pairs?.[index];
  if (!pair || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  return commit(clip, clip.keyframes.map((key) => (key.id === pair.x.id ? { ...key, value: x } : key.id === pair.y.id ? { ...key, value: y } : key)));
}
