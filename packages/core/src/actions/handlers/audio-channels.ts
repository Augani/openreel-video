import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Clip, Track } from "../../types/timeline";
import { sanitizeChannelMap, type ClipChannelMap } from "../../audio/channel-map";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

interface SetChannelMapParams {
  readonly clipIds: readonly string[];
  /** The new mapping, or null to go back to the file's import default. */
  readonly map: ClipChannelMap | null;
}

const findClip = (project: Project, id: string): Clip | undefined => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip;
  }
  return undefined;
};

/**
 * Modify > Audio Channels: sets (or clears) the channel map of one or many clips in one undo step.
 * The inverse restores every clip's previous map individually, so a multi-selection with
 * different starting maps undoes exactly.
 */
const audioSetChannelMap: ActionHandler = {
  type: "audio/setChannelMap",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as SetChannelMapParams;
    const errors: { code: string; message: string }[] = [];
    if (!Array.isArray(params.clipIds) || params.clipIds.length === 0) {
      errors.push({ code: "INVALID_PARAMS", message: "Give at least one clip id" });
    } else {
      for (const id of params.clipIds) {
        if (!findClip(project, id)) errors.push({ code: "CLIP_NOT_FOUND", message: `Clip not found: ${id}` });
      }
    }
    if (params.map !== null && !sanitizeChannelMap(params.map)) {
      errors.push({ code: "INVALID_PARAMS", message: "map must be { format: mono | stereo | 5.1, sources: number[] } or null" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as unknown as SetChannelMapParams;
    const map = params.map === null ? undefined : sanitizeChannelMap(params.map);
    const ids = new Set(params.clipIds);
    const set = (clip: Clip): Clip => {
      const { channelMap: _old, ...rest } = clip;
      void _old;
      return (map ? { ...rest, channelMap: map } : rest) as Clip;
    };
    const timeline = project.timeline as { tracks: Track[] };
    timeline.tracks = timeline.tracks.map((track) =>
      track.clips.some((c) => ids.has(c.id)) ? { ...track, clips: track.clips.map((c) => (ids.has(c.id) ? set(c) : c)) } : track,
    );
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as unknown as SetChannelMapParams;
    const restore = params.clipIds.map((id) => ({ clipId: id, map: findClip(projectBefore, id)?.channelMap ?? null }));
    return {
      type: "audio/restoreChannelMaps",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { restore },
    };
  },
};

interface RestoreParams {
  readonly restore: readonly { readonly clipId: string; readonly map: ClipChannelMap | null }[];
}

/** Inverse of audio/setChannelMap: puts each clip's own previous map back. */
const audioRestoreChannelMaps: ActionHandler = {
  type: "audio/restoreChannelMaps",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as RestoreParams;
    const errors = (params.restore ?? [])
      .filter((entry) => !findClip(project, entry.clipId))
      .map((entry) => ({ code: "CLIP_NOT_FOUND", message: `Clip not found: ${entry.clipId}` }));
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as unknown as RestoreParams;
    const byClip = new Map(params.restore.map((entry) => [entry.clipId, entry.map] as const));
    const timeline = project.timeline as { tracks: Track[] };
    timeline.tracks = timeline.tracks.map((track) =>
      track.clips.some((c) => byClip.has(c.id))
        ? {
            ...track,
            clips: track.clips.map((c) => {
              if (!byClip.has(c.id)) return c;
              const { channelMap: _old, ...rest } = c;
              void _old;
              const map = byClip.get(c.id);
              return (map ? { ...rest, channelMap: map } : rest) as Clip;
            }),
          }
        : track,
    );
  },
  invert(): Action | null {
    return null;
  },
};

registerActionHandler(audioSetChannelMap);
registerActionHandler(audioRestoreChannelMaps);
