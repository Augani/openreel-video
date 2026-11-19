import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import type { Marker } from "../../types/timeline";
import { MARKER_KINDS } from "../../types/timeline";
import { registerActionHandler, createInverseAction } from "../registry";
import { findClip, patchClip } from "./clip-helpers";

/**
 * `clipmarker/set`: replaces the markers of one clip (clip markers) or one media item
 * (master-clip markers) as a single undoable action. Marker times are source-media seconds.
 * `markers: []` clears them. The inverse is the same action carrying the previous list.
 */
export interface ClipMarkerSetParams {
  readonly clipId?: string;
  readonly mediaId?: string;
  readonly markers: readonly Marker[];
}

const validMarker = (m: unknown): boolean => {
  const x = m as Partial<Marker> | null;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.time === "number" &&
    Number.isFinite(x.time) &&
    x.time >= 0 &&
    typeof x.label === "string" &&
    typeof x.color === "string" &&
    (x.duration === undefined || (Number.isFinite(x.duration) && x.duration >= 0)) &&
    (x.kind === undefined || (MARKER_KINDS as readonly string[]).includes(x.kind))
  );
};

function validate(action: Action, project: Project): ValidationResult {
  const p = action.params as unknown as ClipMarkerSetParams;
  const errors: { code: string; message: string }[] = [];
  if ((p.clipId === undefined) === (p.mediaId === undefined))
    errors.push({ code: "INVALID_PARAMS", message: "Exactly one of clipId or mediaId is required" });
  else if (p.clipId !== undefined && !findClip(project, p.clipId))
    errors.push({ code: "CLIP_NOT_FOUND", message: "Clip not found" });
  else if (p.mediaId !== undefined && !project.mediaLibrary.items.some((i) => i.id === p.mediaId))
    errors.push({ code: "INVALID_PARAMS", message: "Media item not found" });
  if (!Array.isArray(p.markers) || !p.markers.every(validMarker))
    errors.push({ code: "INVALID_PARAMS", message: "markers must be a list of valid markers" });
  else if (new Set(p.markers.map((m) => m.id)).size !== p.markers.length)
    errors.push({ code: "INVALID_PARAMS", message: "marker ids must be unique" });
  return { valid: errors.length === 0, errors } as ValidationResult;
}

function apply(action: Action, project: Project): void {
  const p = action.params as unknown as ClipMarkerSetParams;
  const markers = p.markers.map((m) => ({ ...m }));
  if (p.clipId !== undefined) {
    patchClip(project, p.clipId, { markers: markers.length ? markers : undefined });
    return;
  }
  const library = project.mediaLibrary as { items: Project["mediaLibrary"]["items"] };
  library.items = library.items.map((item) => {
    if (item.id !== p.mediaId) return item;
    const next = { ...item, markers };
    if (!markers.length) delete (next as { markers?: unknown }).markers;
    return next;
  });
}

function invert(action: Action, before: Project): Action | null {
  const p = action.params as unknown as ClipMarkerSetParams;
  const prior =
    p.clipId !== undefined
      ? findClip(before, p.clipId)?.markers
      : before.mediaLibrary.items.find((i) => i.id === p.mediaId)?.markers;
  if (p.clipId !== undefined && !findClip(before, p.clipId)) return null;
  const params: Record<string, unknown> = { markers: (prior ?? []).map((m) => ({ ...m })) };
  if (p.clipId !== undefined) params.clipId = p.clipId;
  else params.mediaId = p.mediaId;
  return createInverseAction(action, "clipmarker/set", params);
}

registerActionHandler({ type: "clipmarker/set", validate, apply, invert });
