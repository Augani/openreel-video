import type { GraphicTemplate } from "../graphic-templates/types";

/**
 * Live linked compositions (OpenReel's Dynamic Link).
 *
 * A LinkedComposition is the MASTER of a graphic composition: its template (layer
 * stack and exposed parameters) is edited in the composition editor, in its own
 * window or panel. Every timeline instance that links to it mirrors that template,
 * so an edit shows in the timeline at once, with no render and no re-import.
 *
 * Preview and export agree by construction: a linked instance is expanded into
 * ordinary text / shape / svg clips by the same `expandGraphicInstance` as any
 * Essential Graphics instance, and neither the preview nor the exporter knows the
 * difference.
 */
export interface LinkedComposition {
  readonly id: string;
  readonly name: string;
  /** The master template. Linked instances carry an equal copy (kept in step by `editLinkedComposition`). */
  readonly template: GraphicTemplate;
  readonly createdAt: number;
  readonly modifiedAt: number;
  /** Bumped by every edit of the template; a Render and Replace render records the revision it saw. */
  readonly revision: number;
}

/** Metadata key on the media clip that stands in for a rendered linked composition. */
export const LINKED_BAKE_CLIP_KEY = "linkedCompositionInstanceId";
