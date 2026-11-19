import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { Subtitle } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import type { SpeakerProfile } from "../../captions/diarization";
import { registerActionHandler, type ActionHandler } from "../registry";

/**
 * speaker/apply {subtitles?, profiles?}: set the caption cues and/or the
 * project's speaker profiles in one undo step (diarize, rename, reassign,
 * recolour). Omitted parts are left alone; the inverse restores both.
 */

const bad = (message: string): ValidationResult => ({ valid: false, errors: [{ code: "INVALID_PARAMS", message }] });

const speakerApply: ActionHandler = {
  type: "speaker/apply",
  validate(action) {
    const p = action.params as { subtitles?: unknown; profiles?: unknown };
    if (p.subtitles === undefined && p.profiles === undefined) return bad("subtitles or profiles is required");
    if (p.subtitles !== undefined && !Array.isArray(p.subtitles)) return bad("subtitles must be a list");
    if (p.profiles !== undefined) {
      if (!Array.isArray(p.profiles)) return bad("profiles must be a list");
      const names = new Set<string>();
      for (const profile of p.profiles as Array<Partial<SpeakerProfile>>) {
        if (typeof profile?.name !== "string" || !profile.name.trim() || typeof profile.color !== "string")
          return bad("each profile needs a name and a colour");
        if (names.has(profile.name)) return bad(`Duplicate speaker: ${profile.name}`);
        names.add(profile.name);
      }
    }
    return { valid: true, errors: [] };
  },
  apply(action: Action, project: Project) {
    const p = action.params as { subtitles?: Subtitle[]; profiles?: SpeakerProfile[] };
    if (p.subtitles) (project.timeline as MutableTimeline).subtitles = p.subtitles;
    if (p.profiles) (project as { speakers?: readonly SpeakerProfile[] }).speakers = p.profiles;
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const p = action.params as { subtitles?: Subtitle[]; profiles?: SpeakerProfile[] };
    return {
      type: "speaker/apply",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        ...(p.subtitles ? { subtitles: projectBefore.timeline.subtitles.map((s) => ({ ...s })) } : {}),
        ...(p.profiles ? { profiles: (projectBefore.speakers ?? []).map((s) => ({ ...s })) } : {}),
      },
    };
  },
};

registerActionHandler(speakerApply);
