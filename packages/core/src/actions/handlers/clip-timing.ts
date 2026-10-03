import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import { registerActionHandler, type ActionHandler } from "../registry";
import { findClip, patchClip } from "./clip-helpers";

// Undo restores timeline and source bounds independently, including speed edits.
const restoreTiming: ActionHandler = {
  type: "clip/restoreTiming",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as Record<string, unknown>;
    const errors = [];
    if (typeof params.clipId !== "string" || !findClip(project, params.clipId)) {
      errors.push({ code: "CLIP_NOT_FOUND", message: "Clip not found" });
    }
    for (const field of ["startTime", "duration", "inPoint", "outPoint"]) {
      const value = params[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push({ code: "INVALID_PARAMS", message: `${field} must be a finite non-negative number` });
      }
    }
    if (typeof params.inPoint === "number" && typeof params.outPoint === "number" && params.outPoint < params.inPoint) {
      errors.push({ code: "INVALID_PARAMS", message: "Out point must follow in point" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const { clipId, startTime, duration, inPoint, outPoint } = action.params as {
      clipId: string; startTime: number; duration: number; inPoint: number; outPoint: number;
    };
    patchClip(project, clipId, { startTime, duration, inPoint, outPoint });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const clip = findClip(projectBefore, (action.params as { clipId: string }).clipId);
    if (!clip) return null;
    return { type: "clip/restoreTiming", id: `inverse-${action.id}`, timestamp: Date.now(),
      params: { clipId: clip.id, startTime: clip.startTime, duration: clip.duration,
        inPoint: clip.inPoint, outPoint: clip.outPoint } };
  },
};

registerActionHandler(restoreTiming);
