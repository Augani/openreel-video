import {
  clearParamKeyframes,
  detachLinkedComposition,
  editLinkedComposition,
  getGraphicInstance,
  getLinkedComposition,
  graphicInstanceOfClip,
  insertLinkedComposition,
  linkedInstanceOfBakedClip,
  removeParamKeyframe,
  replaceWithLinkedComposition,
  restoreUnrendered,
  setParamKeyframe,
  type EasingType,
  type GraphicInstance,
  type GraphicTemplate,
  type LinkedEditResult,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";
import { commitSequenceEdit } from "./sequence-commands";
import { selectGraphic } from "./graphic-selection";
import { getLinkedCompTransport } from "./linked-comp-bridge";

/**
 * Linked composition commands. Each computes the next project with the pure
 * functions in @openreel/core (linked-comps/) and commits it as exactly ONE
 * `project/applyEditSnapshot` action: one undo step per user operation.
 */

export type LinkedCommandResult = LinkedEditResult;

async function commit(label: string, build: (project: Project) => LinkedEditResult): Promise<LinkedCommandResult> {
  let instanceId: string | undefined;
  let compositionId: string | undefined;
  let warnings: readonly string[] | undefined;
  const result = await commitSequenceEdit(label, (project) => {
    const built = build(project);
    if (built.ok) {
      instanceId = built.instanceId;
      compositionId = built.compositionId;
      warnings = built.warnings;
    }
    return built;
  });
  return result.ok
    ? {
      ok: true,
      project: result.project,
      ...(instanceId ? { instanceId } : {}),
      ...(compositionId ? { compositionId } : {}),
      ...(warnings ? { warnings } : {}),
    }
    : { ok: false, message: result.message };
}

async function run(title: string, label: string, build: (project: Project) => LinkedEditResult): Promise<LinkedCommandResult> {
  const result = await commit(label, build);
  if (!result.ok) toast.warning(title, result.message);
  return result;
}

/** Instance behind the current selection: a graphic's layers, or the rendered clip standing in for one. */
export function selectedLinkedInstance(project: Project, selectedIds: readonly string[]): GraphicInstance | undefined {
  for (const id of selectedIds) {
    const owner = graphicInstanceOfClip(project, id) ?? linkedInstanceOfBakedClip(project, id);
    if (owner?.linkedCompositionId) return owner;
  }
  return undefined;
}

/** Whether any selected id could become a composition layer or already is one. */
export function selectionCanLinkComposition(project: Project, selectedIds: readonly string[]): boolean {
  return selectedIds.some((id) => {
    if (project.textClips?.some((clip) => clip.id === id)) return true;
    if (project.shapeClips?.some((clip) => clip.id === id)) return true;
    if (project.svgClips?.some((clip) => clip.id === id)) return true;
    return false;
  });
}

/** "Replace with Linked Composition" on the selected clips. */
export async function replaceSelectionWithLinkedComposition(name?: string): Promise<LinkedCommandResult> {
  const ids = useUIStore.getState().getSelectedClipIds();
  const result = await run("Replace with Linked Composition", "Replace with linked composition", (project) =>
    replaceWithLinkedComposition(project, ids, { name }),
  );
  if (result.ok) {
    if (result.instanceId) selectGraphic(result.instanceId);
    if (result.warnings?.length) toast.info("Linked composition", result.warnings[0]);
    else toast.success("Linked composition created", "Open it from the Clip menu to edit it in its own window; the timeline updates as you edit.");
  }
  return result;
}

export const insertLinkedCompositionCommand = (compositionId: string, startTime?: number) =>
  run("Insert linked composition", "Insert linked composition", (project) =>
    insertLinkedComposition(project, compositionId, { startTime: startTime ?? useTimelineStore.getState().playheadPosition }),
  ).then((result) => {
    if (result.ok && result.instanceId) selectGraphic(result.instanceId);
    return result;
  });

/** Replace the master template (the composition window and Essential Graphics > Edit on a linked graphic). */
export const editLinkedCompositionCommand = (
  compositionId: string,
  label: string,
  edit: (template: GraphicTemplate) => GraphicTemplate,
  expectedRevision?: number,
) => run("Edit composition", label, (project) => editLinkedComposition(project, compositionId, edit, { expectedRevision }));

export const detachLinkedCompositionCommand = (instanceId: string) =>
  run("Unlink composition", "Unlink composition", (project) => detachLinkedComposition(project, instanceId));

export const setParamKeyframeCommand = (
  instanceId: string,
  parameterId: string,
  key: { time: number; value: number; easing?: EasingType },
  label = "Set keyframe",
) => run("Keyframe", label, (project) => setParamKeyframe(project, instanceId, parameterId, key));

export const removeParamKeyframeCommand = (instanceId: string, parameterId: string, keyframeId: string) =>
  run("Keyframe", "Delete keyframe", (project) => removeParamKeyframe(project, instanceId, parameterId, keyframeId));

export const clearParamKeyframesCommand = (instanceId: string, parameterId: string) =>
  run("Keyframe", "Stop animating control", (project) => clearParamKeyframes(project, instanceId, parameterId));

export const restoreUnrenderedCommand = async (instanceId: string): Promise<LinkedCommandResult> => {
  const result = await run("Restore Unrendered", "Restore unrendered", (project) => restoreUnrendered(project, instanceId));
  if (result.ok) selectGraphic(instanceId);
  return result;
};

/** Open the composition in its own window. */
export async function openLinkedCompositionWindow(compositionId: string): Promise<boolean> {
  const project = useProjectStore.getState().getFullProject();
  if (!getLinkedComposition(project, compositionId)) {
    toast.warning("Open composition", "That composition no longer exists.");
    return false;
  }
  const opened = await getLinkedCompTransport().open(compositionId);
  if (!opened.ok) toast.warning("Open composition", opened.message ?? "The composition window could not be opened.");
  return opened.ok;
}

/** "Open Linked Composition" for the selection. */
export async function openSelectedLinkedComposition(): Promise<boolean> {
  const project = useProjectStore.getState().getFullProject();
  const instance = selectedLinkedInstance(project, useUIStore.getState().getSelectedClipIds());
  if (!instance?.linkedCompositionId) {
    toast.info("Open Linked Composition", "Select a linked composition on the timeline first.");
    return false;
  }
  return openLinkedCompositionWindow(instance.linkedCompositionId);
}

/** Instance for the selection (live or rendered), by id. */
export function linkedInstanceById(instanceId: string): GraphicInstance | undefined {
  return getGraphicInstance(useProjectStore.getState().getFullProject(), instanceId);
}

/** "Restore Unrendered" for the selection (the rendered clip, or the composition it stands for). */
export async function restoreSelectedLinkedComposition(): Promise<boolean> {
  const project = useProjectStore.getState().getFullProject();
  const instance = selectedLinkedInstance(project, useUIStore.getState().getSelectedClipIds());
  if (!instance?.bake) {
    toast.info("Restore Unrendered", "Select a rendered linked composition first.");
    return false;
  }
  return (await restoreUnrenderedCommand(instance.id)).ok;
}
