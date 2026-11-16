import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { AudioRack } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import {
  MAX_RACK_EFFECTS,
  isAudioRackEffectType,
  sanitizeAudioRack,
} from "../../audio/track-audio-rack";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

/** `target` is a track id, or "master" for the master bus. */
export const MASTER_RACK_TARGET = "master";

const currentRack = (project: Project, target: string): AudioRack | undefined =>
  target === MASTER_RACK_TARGET
    ? project.timeline.masterAudioRack
    : (project.timeline.tracks.find((t) => t.id === target)?.audioRack ??
      project.timeline.audioBuses?.find((b) => b.id === target)?.rack);

/**
 * Replaces one rack wholesale, so every rack edit (add/remove/reorder/bypass/
 * param/volume/pan) is exactly one history entry whose inverse restores the
 * previous rack.
 */
const audioRackSet: ActionHandler = {
  type: "audioRack/set",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { target?: unknown; rack?: unknown };
    const errors: { code: string; message: string }[] = [];
    const target = params.target;
    if (typeof target !== "string") {
      errors.push({ code: "INVALID_PARAMS", message: "target must be a track id or 'master'" });
    } else if (
      target !== MASTER_RACK_TARGET &&
      !project.timeline.tracks.some((t) => t.id === target) &&
      !project.timeline.audioBuses?.some((b) => b.id === target)
    ) {
      errors.push({ code: "TRACK_NOT_FOUND", message: `Track or bus not found: ${target}` });
    }
    const rack = params.rack as Partial<AudioRack> | null | undefined;
    if (rack != null) {
      if (typeof rack !== "object" || !Array.isArray(rack.effects)) {
        errors.push({ code: "INVALID_PARAMS", message: "rack.effects must be an array" });
      } else {
        if (rack.effects.length > MAX_RACK_EFFECTS) {
          errors.push({
            code: "INVALID_PARAMS",
            message: `A rack holds at most ${MAX_RACK_EFFECTS} effects`,
          });
        }
        if (rack.effects.some((e) => !e || !isAudioRackEffectType(e.type))) {
          errors.push({ code: "INVALID_PARAMS", message: "Unknown rack effect type" });
        }
      }
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { target: string; rack: AudioRack | null };
    const rack = sanitizeAudioRack(params.rack);
    const timeline = project.timeline as MutableTimeline & {
      masterAudioRack?: AudioRack;
    };
    if (params.target === MASTER_RACK_TARGET) {
      if (rack) timeline.masterAudioRack = rack;
      else delete timeline.masterAudioRack;
      return;
    }
    if (timeline.audioBuses?.some((b) => b.id === params.target)) {
      timeline.audioBuses = timeline.audioBuses.map((b) => {
        if (b.id !== params.target) return b;
        const { rack: _old, ...rest } = b;
        void _old;
        return (rack ? { ...rest, rack } : rest) as typeof b;
      });
      return;
    }
    timeline.tracks = timeline.tracks.map((t) => {
      if (t.id !== params.target) return t;
      const { audioRack: _old, ...rest } = t as typeof t & { audioRack?: AudioRack };
      void _old;
      return (rack ? { ...rest, audioRack: rack } : rest) as typeof t;
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { target: string };
    const prior = currentRack(projectBefore, params.target);
    return {
      type: "audioRack/set",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        target: params.target,
        rack: prior ? structuredClone(prior) : null,
      },
    };
  },
};

registerActionHandler(audioRackSet);
