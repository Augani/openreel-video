import {
  OPENREEL_TEMPLATE_EXTENSION,
  editGraphicTemplate,
  getGraphicInstance,
  graphicInstanceOfClip,
  graphicInstanceToTemplate,
  groupClipsIntoGraphic,
  groupableClipIds,
  insertGraphicTemplate,
  moveGraphic,
  parseGraphicTemplatePackage,
  removeGraphic,
  resizeGraphic,
  serializeGraphicTemplate,
  setGraphicParameters,
  ungroupGraphic,
  type GraphicEditResult,
  type GraphicInstance,
  type GraphicTemplate,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useGraphicTemplatesStore } from "../stores/graphic-templates-store";
import { toast } from "../stores/notification-store";
import { commitSequenceEdit } from "./sequence-commands";
import { selectGraphic } from "./graphic-selection";
import { duplicateLinkedInstance } from "@openreel/core";
import { editLinkedCompositionCommand } from "./linked-comp-commands";

/**
 * Essential Graphics commands. Each one computes the next project with the pure
 * functions in @openreel/core (graphic-templates/) and commits it as exactly ONE
 * `project/applyEditSnapshot` action: one undo step, the same path the agent
 * tools use. Failures are returned (and toasted by `run`), never thrown.
 */

export type GraphicCommandResult = GraphicEditResult;

async function commit(label: string, build: (project: Project) => GraphicEditResult): Promise<GraphicCommandResult> {
  let instanceId: string | undefined;
  const result = await commitSequenceEdit(label, (project) => {
    const built = build(project);
    if (built.ok) instanceId = built.instanceId;
    return built;
  });
  return result.ok
    ? { ok: true, project: result.project, ...(instanceId ? { instanceId } : {}) }
    : { ok: false, message: result.message };
}

async function run(title: string, label: string, build: (project: Project) => GraphicEditResult): Promise<GraphicCommandResult> {
  const result = await commit(label, build);
  if (!result.ok) toast.warning(title, result.message);
  return result;
}

export { graphicAnchorId } from "./graphic-selection";

/** Instance behind the current selection, if a graphic is selected. */
export function selectedGraphicInstance(project: Project, selectedIds: readonly string[]): GraphicInstance | undefined {
  for (const id of selectedIds) {
    const instance = graphicInstanceOfClip(project, id);
    if (instance) return instance;
  }
  return undefined;
}

export interface InsertGraphicRequest {
  readonly startTime?: number;
  readonly trackId?: string;
  readonly duration?: number;
  readonly values?: Readonly<Record<string, unknown>>;
}

/** Insert a template at the playhead (or `startTime`) and select it. */
export async function insertGraphic(template: GraphicTemplate, request: InsertGraphicRequest = {}): Promise<GraphicCommandResult> {
  const startTime = request.startTime ?? useTimelineStore.getState().playheadPosition;
  const result = await run("Insert graphic", `Insert ${template.name}`, (project) =>
    insertGraphicTemplate(project, template, {
      startTime,
      trackId: request.trackId,
      duration: request.duration,
      values: request.values,
    }),
  );
  if (result.ok && result.instanceId) selectGraphic(result.instanceId);
  return result;
}

export const setGraphicValues = (instanceId: string, updates: Readonly<Record<string, unknown>>, label = "Edit graphic") =>
  run("Edit graphic", label, (project) => setGraphicParameters(project, instanceId, updates));

export const setGraphicValue = (instanceId: string, parameterId: string, value: unknown) =>
  setGraphicValues(instanceId, { [parameterId]: value });

export const resizeGraphicCommand = (instanceId: string, target: { startTime?: number; duration: number }) =>
  run("Resize graphic", "Resize graphic", (project) => resizeGraphic(project, instanceId, target));

export const moveGraphicCommand = (instanceId: string, target: { startTime?: number; trackId?: string }) =>
  run("Move graphic", "Move graphic", (project) => moveGraphic(project, instanceId, target));

export const removeGraphicCommand = (instanceId: string) =>
  run("Delete graphic", "Delete graphic", (project) => removeGraphic(project, instanceId));

export const ungroupGraphicCommand = (instanceId: string) =>
  run("Ungroup graphic", "Ungroup graphic", (project) => ungroupGraphic(project, instanceId));

export const editGraphicTemplateCommand = (
  instanceId: string,
  label: string,
  edit: (template: GraphicTemplate) => GraphicTemplate,
) => {
  // A linked composition has ONE master template: editing it from the timeline edits every instance.
  const linkedId = getGraphicInstance(useProjectStore.getState().getFullProject(), instanceId)?.linkedCompositionId;
  if (linkedId) return editLinkedCompositionCommand(linkedId, label, edit);
  return run("Edit graphic", label, (project) => editGraphicTemplate(project, instanceId, edit));
};

/** Duplicate right after the original (Premiere's Ctrl+D). */
export async function duplicateGraphicCommand(instanceId: string): Promise<GraphicCommandResult> {
  const project = useProjectStore.getState().getFullProject();
  const instance = getGraphicInstance(project, instanceId);
  if (!instance) return { ok: false, message: "That graphic no longer exists." };
  const result = await run("Duplicate graphic", "Duplicate graphic", (current) =>
    instance.linkedCompositionId
      ? duplicateLinkedInstance(current, instance.id)
      : insertGraphicTemplate(current, instance.template, {
      startTime: instance.startTime + instance.duration,
      duration: instance.duration,
      values: instance.values,
      name: instance.name,
    }),
  );
  if (result.ok && result.instanceId) selectGraphic(result.instanceId);
  return result;
}

/** Trim a graphic to the playhead (the Timeline's "trim start/end to playhead"). */
export async function trimGraphicToPlayhead(instanceId: string, trimStart: boolean, time: number): Promise<boolean> {
  const instance = getGraphicInstance(useProjectStore.getState().getFullProject(), instanceId);
  if (!instance) return false;
  const end = instance.startTime + instance.duration;
  if (time <= instance.startTime || time >= end) return false;
  const result = trimStart
    ? await resizeGraphicCommand(instanceId, { startTime: time, duration: end - time })
    : await resizeGraphicCommand(instanceId, { duration: time - instance.startTime });
  return result.ok;
}

/** Save the (possibly edited) graphic as a reusable template in "My templates". */
export function saveGraphicAsTemplate(instanceId: string, name: string): GraphicTemplate | null {
  const instance = getGraphicInstance(useProjectStore.getState().getFullProject(), instanceId);
  if (!instance) return null;
  const template = graphicInstanceToTemplate(instance, { name: name || `${instance.name} (custom)` });
  useGraphicTemplatesStore.getState().save(template);
  if (useGraphicTemplatesStore.getState().persistenceFailed) {
    toast.warning("Template saved for this session only", "Browser storage is full or unavailable. Export it to a .openreel-template file to keep it.");
  } else {
    toast.success("Template saved", `"${template.name}" is in Graphics > Templates > My templates.`);
  }
  return template;
}

export function downloadGraphicTemplate(template: GraphicTemplate): void {
  const blob = new Blob([serializeGraphicTemplate(template)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${template.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "template"}${OPENREEL_TEMPLATE_EXTENSION}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Group the selected text / shape / SVG clips into one graphic (one undo step) and select it. */
export async function groupSelectionIntoGraphic(name?: string): Promise<GraphicCommandResult> {
  const ids = useUIStore.getState().getSelectedClipIds();
  const result = await run("Group into graphic", "Group into graphic", (project) => groupClipsIntoGraphic(project, ids, { name }));
  if (result.ok && result.instanceId) selectGraphic(result.instanceId);
  return result;
}

/** How many of the selected clips can become graphic layers. */
export function groupableSelectionCount(project: Project, ids: readonly string[]): number {
  return groupableClipIds(project, ids).length;
}

/** Synchronous guard: does the selection touch a graphic? (Callers skip the async path when not.) */
export function selectionHasGraphics(ids: readonly string[]): boolean {
  const project = useProjectStore.getState()?.project;
  if (!project?.graphicInstances?.length) return false;
  return ids.some((id) => graphicInstanceOfClip(project, id) !== undefined);
}

/**
 * Timeline selection edits (delete, duplicate, trim to playhead, ripple) for the
 * graphics in `ids`. Returns the ids that are NOT part of a graphic so the caller
 * can carry on with ordinary clips; `ok` is false when a graphic edit failed.
 * Split (razor) does not apply to a graphic: it is a single template instance.
 */
export async function editGraphicSelection(
  ids: readonly string[],
  operation: "split" | "delete" | "duplicate" | "ripple" | "trim-start" | "trim-end",
  time: number,
): Promise<{ readonly handled: boolean; readonly ok: boolean; readonly remaining: string[] }> {
  const project = useProjectStore.getState().getFullProject();
  const instances = new Map<string, GraphicInstance>();
  const remaining: string[] = [];
  for (const id of ids) {
    const instance = graphicInstanceOfClip(project, id);
    if (instance) instances.set(instance.id, instance);
    else remaining.push(id);
  }
  if (instances.size === 0) return { handled: false, ok: true, remaining: [...ids] };
  let ok = true;
  for (const instance of instances.values()) {
    if (operation === "delete" || operation === "ripple") ok = (await removeGraphicCommand(instance.id)).ok && ok;
    else if (operation === "duplicate") ok = (await duplicateGraphicCommand(instance.id)).ok && ok;
    else if (operation === "trim-start" || operation === "trim-end") {
      ok = (await trimGraphicToPlayhead(instance.id, operation === "trim-start", time)) && ok;
    } else {
      toast.info("Graphics cannot be split", "A graphic is one template. Trim it, or ungroup it to edit its layers separately.");
      ok = false;
    }
  }
  return { handled: true, ok, remaining };
}

export type ImportTemplateResult =
  | { readonly ok: true; readonly template: GraphicTemplate }
  | { readonly ok: false; readonly message: string };

/** Read, validate and add a `.openreel-template` file to the library. Nothing is added when it is rejected. */
export async function importGraphicTemplateFile(file: File): Promise<ImportTemplateResult> {
  if (file.size > 12_000_000) return { ok: false, message: "That file is larger than 12 MB, which is more than a template should be." };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, message: "The file could not be read." };
  }
  const parsed = parseGraphicTemplatePackage(text);
  if (!parsed.ok) return { ok: false, message: parsed.errors[0] ?? "That is not a valid template." };
  const store = useGraphicTemplatesStore.getState();
  // A template with a built-in or existing id is imported as a copy, never overwriting.
  const taken = new Set(store.list().map((item) => item.id));
  let template = parsed.template;
  if (taken.has(template.id)) template = { ...template, id: `custom-${crypto.randomUUID()}` };
  store.save(template);
  return { ok: true, template };
}
