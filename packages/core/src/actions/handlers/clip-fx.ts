import type { Action, ValidationResult } from "../../types/actions";
import { isObjectRemovalSettings } from "../../video/content-aware-fill/types";
import { isWarpAnalysis } from "../../video/stabilization/warp/types";
import type { Project } from "../../types/project";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";
import { makeClipFieldHandler, findClip, patchClip } from "./clip-helpers";
import { isFootageColorPreset } from "../../color/source-color";
import { isTimeInterpolation } from "../../video/time-interpolation/types";

import { CLIP_SPEED_MIN as SPEED_MIN, CLIP_SPEED_MAX as SPEED_MAX } from "../../editing/speed-limits";

const isNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// Speed changes also recompute the clip's timeline duration from its source
// span (outPoint - inPoint) / speed. Duration is derived, so the inverse just
// restores the prior speed.
const clipSetSpeed: ActionHandler = {
  type: "clip/setSpeed",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: string; speed?: unknown };
    const errors = [];
    if (typeof params.clipId !== "string" || !findClip(project, params.clipId)) {
      errors.push({
        code: "CLIP_NOT_FOUND",
        message: `Clip not found: ${String(params.clipId)}`,
      });
    }
    if (params.speed != null && !isNumber(params.speed)) {
      errors.push({ code: "INVALID_PARAMS", message: "speed must be a number" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as { clipId: string; speed: number };
    const clip = findClip(project, params.clipId);
    if (!clip) return;
    const speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, Number(params.speed)));
    const sourceSpan = clip.outPoint - clip.inPoint;
    patchClip(project, params.clipId, {
      speed,
      duration: sourceSpan > 0 ? sourceSpan / speed : clip.duration,
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { clipId: string };
    const prior = findClip(projectBefore, params.clipId);
    if (!prior) return null;
    return {
      type: "clip/setSpeed",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { clipId: params.clipId, speed: prior.speed ?? 1 },
    };
  },
};

// Consolidated speed-ramp persistence: keyframes + freeze frames + pitch in one
// undoable unit (the ramp UI mutates the speed engine, then persists here).
const speedSetRampData: ActionHandler = {
  type: "speed/setRampData",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: string };
    return typeof params.clipId === "string" && findClip(project, params.clipId)
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: [
            {
              code: "CLIP_NOT_FOUND",
              message: `Clip not found: ${String(params.clipId)}`,
            },
          ],
        };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as {
      clipId: string;
      keyframes?: unknown;
      freezeFrames?: unknown;
      pitchCorrection?: unknown;
    };
    patchClip(project, params.clipId, {
      speedKeyframes: params.keyframes as never,
      freezeFrames: params.freezeFrames as never,
      pitchCorrection: params.pitchCorrection as never,
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const params = action.params as { clipId: string };
    const prior = findClip(projectBefore, params.clipId);
    if (!prior) return null;
    return {
      type: "speed/setRampData",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        clipId: params.clipId,
        keyframes: prior.speedKeyframes,
        freezeFrames: prior.freezeFrames,
        pitchCorrection: prior.pitchCorrection,
      },
    };
  },
};

const handlers = [
  clipSetSpeed,
  speedSetRampData,
  makeClipFieldHandler({
    type: "clip/setReverse",
    paramKey: "reversed",
    field: "reversed",
    validateValue: (v) =>
      v == null || typeof v === "boolean" ? null : "reversed must be a boolean",
  }),
  makeClipFieldHandler({
    type: "clip/setTimeInterpolation",
    paramKey: "timeInterpolation",
    field: "timeInterpolation",
    validateValue: (v) =>
      v === undefined || isTimeInterpolation(v)
        ? null
        : "timeInterpolation must be frameSampling, frameBlending or opticalFlow",
  }),
  makeClipFieldHandler({
    type: "clip/setInterpolationQuality",
    paramKey: "interpolationQuality",
    field: "interpolationQuality",
    validateValue: (v) =>
      v === undefined || v === "low" || v === "medium" || v === "high"
        ? null
        : "interpolationQuality must be low, medium or high",
  }),
  makeClipFieldHandler({
    type: "clip/setColorInterpretation",
    paramKey: "colorInterpretation",
    field: "colorInterpretation",
    validateValue: (v) =>
      v == null || isFootageColorPreset(v) ? null : "colorInterpretation must be an Interpret Footage preset id",
    transform: (v) => (v == null ? undefined : v),
  }),
  makeClipFieldHandler({
    type: "clip/setOcioInputSpace",
    paramKey: "ocioInputSpace",
    field: "ocioInputSpace",
    validateValue: (v) =>
      v == null || (typeof v === "string" && v.length > 0 && v.length <= 256) ? null : "ocioInputSpace must be a colour space name",
    transform: (v) => (v == null ? undefined : v),
  }),
  makeClipFieldHandler({
    type: "clip/setPitchCorrection",
    paramKey: "pitchCorrection",
    field: "pitchCorrection",
    validateValue: (v) =>
      v == null || typeof v === "boolean"
        ? null
        : "pitchCorrection must be a boolean",
  }),
  makeClipFieldHandler({
    type: "clip/setStabilization",
    paramKey: "stabilization",
    field: "stabilization",
    validateValue: (v) => {
      if (v == null) return null;
      if (typeof v !== "object") return "stabilization must be an object";
      const { warp, warpAnalysis } = v as { warp?: unknown; warpAnalysis?: unknown };
      if (warp !== undefined && (warp === null || typeof warp !== "object")) return "stabilization.warp must be an object";
      if (warpAnalysis !== undefined && !isWarpAnalysis(warpAnalysis)) return "stabilization.warpAnalysis is not a valid analysis";
      return null;
    },
  }),
  makeClipFieldHandler({
    type: "clip/setChromaKey",
    paramKey: "chromaKey",
    field: "chromaKey",
    validateValue: (v) =>
      v == null || typeof v === "object" ? null : "chromaKey must be an object",
  }),
  makeClipFieldHandler({
    type: "clip/setObjectRemoval",
    paramKey: "objectRemoval",
    field: "objectRemoval",
    transform: (v) => (v == null ? undefined : v),
    validateValue: (v) =>
      v == null || isObjectRemovalSettings(v) ? null : "objectRemoval must be { enabled, maskId, dilate, feather, analysisKey? } within range",
  }),
  makeClipFieldHandler({
    type: "speed/setKeyframes",
    paramKey: "keyframes",
    field: "speedKeyframes",
    validateValue: (v) =>
      v == null || Array.isArray(v) ? null : "keyframes must be an array",
  }),
  makeClipFieldHandler({
    type: "speed/setFreezeFrames",
    paramKey: "freezeFrames",
    field: "freezeFrames",
    validateValue: (v) =>
      v == null || Array.isArray(v) ? null : "freezeFrames must be an array",
  }),
];

for (const handler of handlers) {
  registerActionHandler(handler);
}
