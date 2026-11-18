import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import {
  applyRoutingParams,
  getAudioBuses,
  sanitizeBus,
  sanitizeSend,
  validateRoutingParams,
  type AudioRoutingSetParams,
  type TrackRoutingPatch,
} from "../../audio/audio-routing";
import type { MutableTimeline } from "../../utils/immutable-updates";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

/** Clean buses/sends so stored routing is always well-formed whatever the caller sent. */
function sanitizeParams(params: AudioRoutingSetParams): AudioRoutingSetParams {
  const buses =
    params.buses === undefined
      ? undefined
      : params.buses === null
        ? null
        : params.buses.map(sanitizeBus).filter((b): b is NonNullable<typeof b> => !!b);
  const tracks: Record<string, TrackRoutingPatch> = {};
  for (const [id, patch] of Object.entries(params.tracks ?? {})) {
    tracks[id] = {
      ...(patch.output !== undefined ? { output: patch.output } : {}),
      ...(patch.sends !== undefined
        ? { sends: patch.sends ? patch.sends.map(sanitizeSend).filter((s): s is NonNullable<typeof s> => !!s) : null }
        : {}),
    };
  }
  return { ...(buses !== undefined ? { buses } : {}), ...(params.tracks ? { tracks } : {}) };
}

/**
 * One undo step for every routing edit (add/remove bus, output assignment,
 * sends, bus flags/automation). The params describe the NEW state of the
 * touched buses/tracks; the inverse restores the previous state of exactly
 * those, so undo is exact.
 */
const audioRoutingSet: ActionHandler = {
  type: "audioRouting/set",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as unknown as AudioRoutingSetParams;
    if (!params || typeof params !== "object" || (params.buses === undefined && !params.tracks)) {
      return { valid: false, errors: [{ code: "INVALID_PARAMS", message: "audioRouting/set needs buses and/or tracks" }] };
    }
    const problem = validateRoutingParams(project.timeline, sanitizeParams(params));
    return problem
      ? { valid: false, errors: [{ code: "INVALID_ROUTING", message: problem }] }
      : { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const params = sanitizeParams(action.params as unknown as AudioRoutingSetParams);
    const next = applyRoutingParams(project.timeline, params);
    const timeline = project.timeline as MutableTimeline;
    timeline.tracks = next.tracks;
    if (next.audioBuses) timeline.audioBuses = next.audioBuses;
    else delete timeline.audioBuses;
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as unknown as AudioRoutingSetParams;
    const before = projectBefore.timeline;
    const tracks: Record<string, TrackRoutingPatch> = {};
    for (const id of Object.keys(params.tracks ?? {})) {
      const track = before.tracks.find((t) => t.id === id);
      if (!track) continue;
      tracks[id] = { output: track.output ?? null, sends: track.sends ? structuredClone(track.sends) : null };
    }
    const prior = getAudioBuses(projectBefore.timeline);
    return {
      type: "audioRouting/set",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        ...(params.buses !== undefined ? { buses: prior.length ? structuredClone([...prior]) : null } : {}),
        ...(params.tracks ? { tracks } : {}),
        label: "Undo audio routing",
      },
    };
  },
};

registerActionHandler(audioRoutingSet);
