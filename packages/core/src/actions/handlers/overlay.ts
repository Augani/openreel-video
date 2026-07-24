import type { Project } from "../../types/project";
import type { Action, ValidationResult } from "../../types/actions";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";

type OverlayField =
  | "textClips"
  | "shapeClips"
  | "svgClips"
  | "stickerClips";

interface OverlayItem {
  readonly id: string;
  readonly [key: string]: unknown;
}

function getOverlays(project: Project, field: OverlayField): OverlayItem[] {
  return ((project as unknown as Record<string, OverlayItem[]>)[field] ??
    []) as OverlayItem[];
}

function setOverlays(
  project: Project,
  field: OverlayField,
  clips: OverlayItem[],
): void {
  (project as unknown as Record<string, OverlayItem[]>)[field] = clips;
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function err(message: string): ValidationResult {
  return { valid: false, errors: [{ code: "INVALID_PARAMS", message }] };
}

export function makeOverlayHandlers(
  prefix: string,
  field: OverlayField,
): ActionHandler[] {
  const create: ActionHandler = {
    type: `${prefix}/create`,
    validate(action: Action): ValidationResult {
      const clip = (action.params as { clip?: OverlayItem }).clip;
      return clip && typeof clip.id === "string"
        ? ok()
        : err(`${prefix}/create requires a clip with an id`);
    },
    apply(action: Action, project: Project): void {
      const clip = (action.params as { clip: OverlayItem }).clip;
      setOverlays(project, field, [...getOverlays(project, field), clip]);
    },
    invert(action: Action): Action | null {
      const clip = (action.params as { clip: OverlayItem }).clip;
      return {
        type: `${prefix}/remove`,
        id: `inverse-${action.id}`,
        timestamp: Date.now(),
        params: { clipId: clip.id },
      };
    },
  };

  const update: ActionHandler = {
    type: `${prefix}/update`,
    validate(action: Action, project: Project): ValidationResult {
      const clipId = (action.params as { clipId?: string }).clipId;
      return getOverlays(project, field).some((c) => c.id === clipId)
        ? ok()
        : err(`${prefix} clip not found: ${String(clipId)}`);
    },
    apply(action: Action, project: Project): void {
      const { clipId, updates } = action.params as {
        clipId: string;
        updates: Record<string, unknown>;
      };
      setOverlays(
        project,
        field,
        getOverlays(project, field).map((c) =>
          c.id === clipId ? { ...c, ...updates } : c,
        ),
      );
    },
    invert(action: Action, projectBefore: Project): Action | null {
      const clipId = (action.params as { clipId: string }).clipId;
      const prior = getOverlays(projectBefore, field).find(
        (c) => c.id === clipId,
      );
      if (!prior) return null;
      return {
        type: `${prefix}/update`,
        id: `inverse-${action.id}`,
        timestamp: Date.now(),
        params: { clipId, updates: { ...prior } },
      };
    },
  };

  const remove: ActionHandler = {
    type: `${prefix}/remove`,
    validate(action: Action, project: Project): ValidationResult {
      const clipId = (action.params as { clipId?: string }).clipId;
      return getOverlays(project, field).some((c) => c.id === clipId)
        ? ok()
        : err(`${prefix} clip not found: ${String(clipId)}`);
    },
    apply(action: Action, project: Project): void {
      const clipId = (action.params as { clipId: string }).clipId;
      setOverlays(
        project,
        field,
        getOverlays(project, field).filter((c) => c.id !== clipId),
      );
    },
    invert(action: Action, projectBefore: Project): Action | null {
      const clipId = (action.params as { clipId: string }).clipId;
      const prior = getOverlays(projectBefore, field).find(
        (c) => c.id === clipId,
      );
      if (!prior) return null;
      return {
        type: `${prefix}/create`,
        id: `inverse-${action.id}`,
        timestamp: Date.now(),
        params: { clip: { ...prior } },
      };
    },
  };

  return [create, update, remove];
}

const OVERLAY_DEFS: ReadonlyArray<{ prefix: string; field: OverlayField }> = [
  { prefix: "text", field: "textClips" },
  { prefix: "shape", field: "shapeClips" },
  { prefix: "svg", field: "svgClips" },
  { prefix: "sticker", field: "stickerClips" },
];

for (const def of OVERLAY_DEFS) {
  for (const handler of makeOverlayHandlers(def.prefix, def.field)) {
    registerActionHandler(handler);
  }
}
