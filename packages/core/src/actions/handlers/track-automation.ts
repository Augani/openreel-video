import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import type { AutomationPoint } from "../../types/timeline";
import type { MutableTimeline } from "../../utils/immutable-updates";
import { isTrackAutomationLane, withTrackLane, type TrackAutomationLane } from "../../audio/track-automation";
import type { AudioRack, AudioRackEffect, Track, TrackAutomationMode } from "../../types/timeline";
import { isTrackAutomationMode, type TrackAutomationPass } from "../../audio/track-automation-modes";
import { isAutomatableRackParam, sanitizeRackEffectAutomation } from "../../audio/rack-effect-automation";
import { AUDIO_RACK_EFFECT_DEFINITIONS } from "../../audio/track-audio-rack";
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

interface RecordParams {
  /** One entry per recorded track; the whole pass is one undo step. */
  passes: TrackAutomationPass[];
}

const withEffectLane = (effect: AudioRackEffect, param: string, points: AutomationPoint[] | null): AudioRackEffect => {
  const next: Record<string, AutomationPoint[]> = { ...(effect.automation ?? {}) };
  const cleaned = points
    ? sanitizeRackEffectAutomation(effect.type, { [param]: points }, (key) => {
        const spec = AUDIO_RACK_EFFECT_DEFINITIONS[effect.type].params.find((x) => x.key === key);
        return spec ? { min: spec.min, max: spec.max } : undefined;
      })?.[param]
    : undefined;
  if (cleaned?.length) next[param] = cleaned;
  else delete next[param];
  const { automation: _old, ...rest } = effect;
  void _old;
  return Object.keys(next).length ? { ...rest, automation: next } : rest;
};

/**
 * One whole automation recording pass (fader and pan lanes, rack effect keyframes, any number of tracks) as ONE
 * undo step. The inverse is the same action carrying the previous points of exactly the lanes it touched.
 */
const trackAutomationRecord: ActionHandler = {
  type: "trackAutomation/record",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as Partial<RecordParams>;
    const errors: { code: string; message: string }[] = [];
    if (!Array.isArray(params.passes) || params.passes.length === 0) {
      return { valid: false, errors: [{ code: "INVALID_PARAMS", message: "passes must be a non-empty array" }] };
    }
    for (const pass of params.passes) {
      const track = project.timeline.tracks.find((t) => t.id === pass.trackId);
      if (!track) {
        errors.push({ code: "TRACK_NOT_FOUND", message: `Track not found: ${String(pass.trackId)}` });
        continue;
      }
      for (const edit of pass.effects ?? []) {
        const effect = track.audioRack?.effects.find((e) => e.id === edit.effectId);
        if (!effect) errors.push({ code: "INVALID_PARAMS", message: `Rack effect not found: ${edit.effectId}` });
        else if (!isAutomatableRackParam(effect.type, edit.param)) {
          errors.push({ code: "INVALID_PARAMS", message: `${effect.type}.${edit.param} cannot be automated` });
        }
      }
      for (const lane of ["volume", "pan"] as const) {
        const points = pass.lanes?.[lane];
        if (points != null && !Array.isArray(points)) errors.push({ code: "INVALID_PARAMS", message: `${lane} points must be an array or null` });
      }
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const { passes } = action.params as unknown as RecordParams;
    const timeline = project.timeline as MutableTimeline;
    timeline.tracks = timeline.tracks.map((t): Track => {
      const pass = passes.find((p) => p.trackId === t.id);
      if (!pass) return t;
      let next: Track = t;
      for (const lane of ["volume", "pan"] as const) {
        if (pass.lanes && lane in pass.lanes) next = withTrackLane(next, lane, pass.lanes[lane] ?? null);
      }
      if (pass.effects?.length && next.audioRack) {
        let effects = next.audioRack.effects;
        for (const edit of pass.effects) {
          effects = effects.map((e) => (e.id === edit.effectId ? withEffectLane(e, edit.param, edit.points) : e));
        }
        const rack: AudioRack = { ...next.audioRack, effects };
        next = { ...next, audioRack: rack };
      }
      return next;
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const { passes } = action.params as unknown as RecordParams;
    const inverse: TrackAutomationPass[] = [];
    for (const pass of passes) {
      const track = projectBefore.timeline.tracks.find((t) => t.id === pass.trackId);
      if (!track) continue;
      const lanes: { volume?: AutomationPoint[] | null; pan?: AutomationPoint[] | null } = {};
      for (const lane of ["volume", "pan"] as const) {
        if (pass.lanes && lane in pass.lanes) {
          const prior = track.automation?.[lane];
          lanes[lane] = prior ? structuredClone(prior) : null;
        }
      }
      const effects = (pass.effects ?? []).map((edit) => {
        const prior = track.audioRack?.effects.find((e) => e.id === edit.effectId)?.automation?.[edit.param];
        return { effectId: edit.effectId, param: edit.param, points: prior ? structuredClone(prior) : null };
      });
      inverse.push({ trackId: pass.trackId, ...(pass.lanes ? { lanes } : {}), ...(effects.length ? { effects } : {}) });
    }
    return {
      type: "trackAutomation/record",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { passes: inverse } as unknown as Action["params"],
    };
  },
};

/** Sets the track's automation mode (Off, Read, Write, Touch, Latch). One undo step. */
const trackAutomationSetMode: ActionHandler = {
  type: "trackAutomation/setMode",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { trackId?: unknown; mode?: unknown };
    const errors: { code: string; message: string }[] = [];
    if (typeof params.trackId !== "string" || !project.timeline.tracks.some((t) => t.id === params.trackId)) {
      errors.push({ code: "TRACK_NOT_FOUND", message: `Track not found: ${String(params.trackId)}` });
    }
    if (!isTrackAutomationMode(params.mode)) {
      errors.push({ code: "INVALID_PARAMS", message: "mode must be off, read, write, touch or latch" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { trackId: string; mode: TrackAutomationMode };
    const timeline = project.timeline as MutableTimeline;
    timeline.tracks = timeline.tracks.map((t) => {
      if (t.id !== params.trackId) return t;
      const { automationMode: _old, ...rest } = t;
      void _old;
      return params.mode === "read" ? rest : { ...rest, automationMode: params.mode };
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { trackId: string };
    const prior = projectBefore.timeline.tracks.find((t) => t.id === params.trackId)?.automationMode ?? "read";
    return {
      type: "trackAutomation/setMode",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { trackId: params.trackId, mode: prior },
    };
  },
};

registerActionHandler(trackAutomationRecord);
registerActionHandler(trackAutomationSetMode);
