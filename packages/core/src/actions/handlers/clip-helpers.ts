import type { Project } from "../../types/project";
import type { Clip } from "../../types/timeline";
import type { Action, ValidationResult } from "../../types/actions";
import type {
  MutableTimeline,
  MutableClip,
} from "../../utils/immutable-updates";
import type { ActionHandler } from "../registry";

export function findClip(project: Project, clipId: string): Clip | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

export function patchClip(
  project: Project,
  clipId: string,
  patch: Partial<MutableClip>,
): boolean {
  const timeline = project.timeline as MutableTimeline;
  let found = false;
  timeline.tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip: MutableClip) => {
      if (clip.id === clipId) {
        found = true;
        return { ...clip, ...patch };
      }
      return clip;
    }),
  }));
  return found;
}

export interface ClipFieldHandlerSpec {
  readonly type: string;
  readonly paramKey: string;
  readonly field: keyof MutableClip;
  readonly transform?: (value: unknown) => unknown;
  readonly validateValue?: (value: unknown) => string | null;
}

export function makeClipFieldHandler(spec: ClipFieldHandlerSpec): ActionHandler {
  return {
    type: spec.type,
    validate(action: Action, project: Project): ValidationResult {
      const params = action.params as Record<string, unknown>;
      const clipId = params.clipId;
      const errors = [];
      if (typeof clipId !== "string" || !findClip(project, clipId)) {
        errors.push({
          code: "CLIP_NOT_FOUND",
          message: `Clip not found: ${String(clipId)}`,
        });
      }
      if (spec.validateValue) {
        const msg = spec.validateValue(params[spec.paramKey]);
        if (msg) errors.push({ code: "INVALID_PARAMS", message: msg });
      }
      return { valid: errors.length === 0, errors };
    },
    apply(action: Action, project: Project): void {
      const params = action.params as Record<string, unknown>;
      const clipId = params.clipId as string;
      const raw = params[spec.paramKey];
      const value = spec.transform ? spec.transform(raw) : raw;
      patchClip(project, clipId, {
        [spec.field]: value,
      } as Partial<MutableClip>);
    },
    invert(action: Action, projectBefore: Project): Action | null {
      const params = action.params as Record<string, unknown>;
      const clipId = params.clipId as string;
      const prior = findClip(projectBefore, clipId);
      if (!prior) return null;
      const priorValue = (prior as unknown as Record<string, unknown>)[
        spec.field as string
      ];
      return {
        type: spec.type,
        id: `inverse-${action.id}`,
        timestamp: Date.now(),
        params: { clipId, [spec.paramKey]: priorValue },
      };
    },
  };
}
