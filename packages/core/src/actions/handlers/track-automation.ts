import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { AutomationPoint } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import { isTrackAutomationLane, withTrackLane, type TrackAutomationLane } from "../../audio/track-automation";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

interface Params {
  trackId?: unknown;
  lane?: unknown;
  points?: AutomationPoint[] | null;
}

/** One undo step per lane edit; the inverse restores the lane's previous points. */
const trackAutomationSet: ActionHandler = {
  type: "trackAutomation/set",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as Params;
    const errors: { code: string; message: string }[] = [];
    if (typeof params.trackId !== "string" || !project.timeline.tracks.some((t) => t.id === params.trackId)) {
      errors.push({ code: "TRACK_NOT_FOUND", message: `Track not found: ${String(params.trackId)}` });
    }
    if (!isTrackAutomationLane(params.lane)) {
      errors.push({ code: "INVALID_PARAMS", message: "lane must be 'volume' or 'pan'" });
    }
    if (params.points != null && !Array.isArray(params.points)) {
      errors.push({ code: "INVALID_PARAMS", message: "points must be an array or null" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { trackId: string; lane: TrackAutomationLane; points: AutomationPoint[] | null };
    const timeline = project.timeline as MutableTimeline;
    timeline.tracks = timeline.tracks.map((t) => (t.id === params.trackId ? withTrackLane(t, params.lane, params.points) : t));
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { trackId: string; lane: TrackAutomationLane };
    const prior = projectBefore.timeline.tracks.find((t) => t.id === params.trackId)?.automation?.[params.lane];
    return {
      type: "trackAutomation/set",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { trackId: params.trackId, lane: params.lane, points: prior ? structuredClone(prior) : null },
    };
  },
};

registerActionHandler(trackAutomationSet);
