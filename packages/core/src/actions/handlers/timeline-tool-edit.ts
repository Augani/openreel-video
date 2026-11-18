import type { TimelineToolItemEdit } from "../../editing/timeline-tool-edit";
import {
  applyTimelineToolEdits,
  invertTimelineToolEdits,
  validateTimelineToolEdits,
} from "../../editing/timeline-tool-edit";
import { registerActionHandler, createInverseAction } from "../registry";
registerActionHandler({
  type: "timeline/toolEdit",
  validate(action, project) {
    try {
      if (!Array.isArray(action.params.edits))
        throw new Error("Missing timeline edits.");
      validateTimelineToolEdits(
        project,
        action.params.edits as TimelineToolItemEdit[],
      );
      return { valid: true, errors: [] };
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            code: "INVALID_PARAMS",
            message:
              error instanceof Error ? error.message : "Invalid timeline edit.",
          },
        ],
      };
    }
  },
  apply(action, project) {
    Object.assign(
      project,
      applyTimelineToolEdits(
        project,
        action.params.edits as TimelineToolItemEdit[],
      ),
    );
  },
  invert(action) {
    return createInverseAction(action, "timeline/toolEdit", {
      edits: invertTimelineToolEdits(
        action.params.edits as TimelineToolItemEdit[],
      ),
    });
  },
});
