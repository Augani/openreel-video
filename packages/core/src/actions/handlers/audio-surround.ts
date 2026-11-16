import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Clip, Track } from "../../types/timeline";
import { sanitizeSurroundPan, type SurroundPan } from "../../audio/surround";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

interface SetSurroundPanParams {
  readonly clipId?: string;
  readonly trackId?: string;
  /** The new position, or null to remove it (clip falls back to its track, track to front centre). */
  readonly pan: Partial<SurroundPan> | null;
}

const findClip = (project: Project, id: string): Clip | undefined => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip;
  }
  return undefined;
};

/**
 * Sets (or clears) the surround position of a clip or a track: one undo step,
 * and the history coalesces the rapid calls of a puck drag into one entry.
 */
const audioSetSurroundPan: ActionHandler = {
  type: "audio/setSurroundPan",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as SetSurroundPanParams;
    const errors: { code: string; message: string }[] = [];
    const hasClip = typeof params.clipId === "string";
    const hasTrack = typeof params.trackId === "string";
    if (hasClip === hasTrack) {
      errors.push({ code: "INVALID_PARAMS", message: "Give exactly one of clipId or trackId" });
    } else if (hasClip && !findClip(project, params.clipId!)) {
      errors.push({ code: "CLIP_NOT_FOUND", message: `Clip not found: ${params.clipId}` });
    } else if (hasTrack && !project.timeline.tracks.some((t) => t.id === params.trackId)) {
      errors.push({ code: "TRACK_NOT_FOUND", message: `Track not found: ${params.trackId}` });
    }
    if (params.pan !== null && (typeof params.pan !== "object" || Array.isArray(params.pan))) {
      errors.push({ code: "INVALID_PARAMS", message: "pan must be an object or null" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as unknown as SetSurroundPanParams;
    const pan = params.pan === null ? undefined : sanitizeSurroundPan(params.pan);
    const set = <T extends object>(item: T): T => {
      const { surroundPan: _old, ...rest } = item as T & { surroundPan?: SurroundPan };
      void _old;
      return (pan ? { ...rest, surroundPan: pan } : rest) as T;
    };
    const timeline = project.timeline as { tracks: Track[] };
    timeline.tracks = timeline.tracks.map((track) => {
      if (params.trackId !== undefined) return track.id === params.trackId ? set(track) : track;
      if (!track.clips.some((c) => c.id === params.clipId)) return track;
      return { ...track, clips: track.clips.map((c) => (c.id === params.clipId ? set(c) : c)) };
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as unknown as SetSurroundPanParams;
    const prior = params.clipId !== undefined
      ? findClip(projectBefore, params.clipId)?.surroundPan
      : projectBefore.timeline.tracks.find((t) => t.id === params.trackId)?.surroundPan;
    return {
      type: "audio/setSurroundPan",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        ...(params.clipId !== undefined ? { clipId: params.clipId } : { trackId: params.trackId }),
        pan: prior ? { ...prior } : null,
      },
    };
  },
};

registerActionHandler(audioSetSurroundPan);
