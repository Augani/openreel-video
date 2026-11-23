import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { AudioPluginRack, AudioBus, Track } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import { MASTER_RACK_TARGET, MAX_RACK_NATIVE_PLUGINS, sanitizePluginRack } from "../../audio/native-plugin/native-plugin-rack";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

const currentRack = (project: Project, target: string): AudioPluginRack | undefined =>
  target === MASTER_RACK_TARGET
    ? project.timeline.masterPluginRack
    : project.timeline.tracks.find((t) => t.id === target)?.pluginRack ?? project.timeline.audioBuses?.find((b) => b.id === target)?.pluginRack;

/**
 * Replaces one hosted-plugin rack (a track's, a bus's or the master's) wholesale, so every edit (insert, remove, reorder, bypass, values,
 * state chunk, parameter keyframe) is exactly one history entry whose inverse restores the previous rack.
 */
const audioPluginRackSet: ActionHandler = {
  type: "audioPluginRack/set",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { target?: unknown; rack?: unknown };
    const errors: { code: string; message: string }[] = [];
    const target = params.target;
    if (typeof target !== "string") {
      errors.push({ code: "INVALID_PARAMS", message: "target must be a track or bus id, or the master" });
    } else if (target !== MASTER_RACK_TARGET && !project.timeline.tracks.some((t) => t.id === target) && !project.timeline.audioBuses?.some((b) => b.id === target)) {
      errors.push({ code: "TRACK_NOT_FOUND", message: `Track or bus not found: ${target}` });
    }
    const rack = params.rack as Partial<AudioPluginRack> | null | undefined;
    if (rack != null) {
      if (typeof rack !== "object" || !Array.isArray(rack.plugins)) {
        errors.push({ code: "INVALID_PARAMS", message: "rack.plugins must be an array" });
      } else if (rack.plugins.length > MAX_RACK_NATIVE_PLUGINS) {
        errors.push({ code: "INVALID_PARAMS", message: `A rack holds at most ${MAX_RACK_NATIVE_PLUGINS} plugins` });
      }
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { target: string; rack: AudioPluginRack | null };
    const rack = sanitizePluginRack(params.rack);
    const timeline = project.timeline as MutableTimeline;
    if (params.target === MASTER_RACK_TARGET) {
      if (rack) timeline.masterPluginRack = rack;
      else delete timeline.masterPluginRack;
      return;
    }
    if (timeline.audioBuses?.some((b) => b.id === params.target) && !timeline.tracks.some((t) => t.id === params.target)) {
      timeline.audioBuses = timeline.audioBuses.map((b): AudioBus => {
        if (b.id !== params.target) return b;
        const { pluginRack: _old, ...rest } = b;
        void _old;
        return rack ? { ...rest, pluginRack: rack } : rest;
      });
      return;
    }
    timeline.tracks = timeline.tracks.map((t): Track => {
      if (t.id !== params.target) return t;
      const { pluginRack: _old, ...rest } = t;
      void _old;
      return rack ? { ...rest, pluginRack: rack } : rest;
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { target: string };
    const prior = currentRack(projectBefore, params.target);
    return {
      type: "audioPluginRack/set",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { target: params.target, rack: prior ? structuredClone(prior) : null },
    };
  },
};

registerActionHandler(audioPluginRackSet);
