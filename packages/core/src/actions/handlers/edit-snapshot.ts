import type { Project } from "../../types/project";
import { registerActionHandler, createInverseAction } from "../registry";
import { syncActiveSequence, withNestProjection } from "../../timeline/sequences";

/** Internal commit boundary. External documents must pass the portable validator. */
export type EditSnapshot = Pick<Project, "name" | "settings" | "timeline" | "mediaLibrary" | "textClips" | "shapeClips" | "svgClips" | "stickerClips" | "adjustmentLayers" | "masks" | "particleEffects" | "multicamGroups" | "multicamSources" | "compoundClips" | "sequences" | "activeSequenceId" | "openSequenceIds" | "nestedInstances" | "motionCompositions" | "motionInstances" | "generatedShaders" | "creation" | "graphicInstances" | "linkedCompositions" | "bins">;
export function editSnapshot(source: Project): EditSnapshot {
  // The stored active sequence is stale until flushed: snapshot a consistent view.
  const project = syncActiveSequence(source);
  const { sequences, activeSequenceId, openSequenceIds } = project;
  const { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, particleEffects, multicamGroups, multicamSources, compoundClips, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, graphicInstances, linkedCompositions, bins } = project;
  return { name, settings, timeline, mediaLibrary, textClips, shapeClips, svgClips, stickerClips, adjustmentLayers, masks, particleEffects, multicamGroups, multicamSources, compoundClips, sequences, activeSequenceId, openSequenceIds, nestedInstances, motionCompositions, motionInstances, generatedShaders, creation, graphicInstances, linkedCompositions, bins };
}
const optionalSnapshotFields = [
  "textClips", "shapeClips", "svgClips", "stickerClips", "adjustmentLayers",
  "masks", "particleEffects", "multicamGroups", "multicamSources", "compoundClips", "sequences", "activeSequenceId", "openSequenceIds", "nestedInstances",
  "motionCompositions", "motionInstances", "generatedShaders", "creation", "graphicInstances", "linkedCompositions",
] as const satisfies readonly (keyof EditSnapshot)[];
registerActionHandler({
  type: "project/applyEditSnapshot",
  validate(action) { return action.params.snapshot && typeof action.params.snapshot === "object" ? { valid: true, errors: [] } : { valid: false, errors: [{ code: "INVALID_PARAMS", message: "Missing edit snapshot" }] }; },
  apply(action, project) {
    const snapshot = action.params.snapshot as EditSnapshot;
    const copied = { ...JSON.parse(JSON.stringify({ ...snapshot, mediaLibrary: undefined })), mediaLibrary: { items: snapshot.mediaLibrary.items.map((item) => ({ ...item })) } };
    Object.assign(project, copied, { modifiedAt: Date.now() });
    for (const field of optionalSnapshotFields) {
      if (snapshot[field] === undefined) Reflect.deleteProperty(project, field);
    }
    // Bins are restored too (an undo of an import that created bins removes them); snapshots that never mention bins leave them alone.
    if ("bins" in snapshot && snapshot.bins === undefined) Reflect.deleteProperty(project, "bins");
    if (project.sequences) {
      // compoundClips is a projection of the non-active sequences: rebuild it.
      const projected = withNestProjection({ ...project, compoundClips: undefined });
      (project as { compoundClips?: unknown }).compoundClips = projected.compoundClips;
    }
    if (snapshot.particleEffects === undefined) delete (project as { particleEffects?: unknown }).particleEffects;
    else (project as { particleEffects: unknown }).particleEffects = structuredClone(snapshot.particleEffects);
  },
  invert(action, before) { return createInverseAction(action, "project/applyEditSnapshot", { snapshot: editSnapshot(before) }); },
});
