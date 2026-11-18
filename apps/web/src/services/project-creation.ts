import type { Project, ProjectSettings } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useProcessingStore } from "./processing-manager";
import { flushEditorFieldDrafts } from "./editor-field-drafts";
import { saveCurrentProjectForReplacement } from "./project-replacement";

interface Options {
  name: string;
  settings?: Partial<ProjectSettings>;
  signal?: AbortSignal;
  /** A newer route request can supersede a pending save without publishing stale work. */
  isCurrent?: () => boolean;
}
let active: Options | null = null;
const current = (options: Options) =>
  !options.signal?.aborted && (!options.isCurrent || options.isCurrent());

/** One atomic New path for URLs, desktop welcome presets and the format form. */
export async function createEditorProject(options: Options): Promise<Project> {
  if (active && current(active))
    throw new Error("Another project is already being created.");
  const name = options.name,
    settings = options.settings ? structuredClone(options.settings) : undefined;
  const state = useProjectStore.getState(),
    owner = { projectId: state.project.id, history: state.actionHistory };
  function available() {
    if (!current(options))
      throw (
        options.signal?.reason ??
        new DOMException("Project creation was cancelled", "AbortError")
      );
    const latest = useProjectStore.getState();
    if (
      latest.project.id !== owner.projectId ||
      latest.actionHistory !== owner.history
    )
      throw new Error(
        "The open project changed. Try again from the current project.",
      );
    if (
      useUIStore.getState().exportState.isExporting ||
      useTimelineStore.getState().playbackLockedReason ||
      useProcessingStore.getState().hasActiveProcessing()
    )
      throw new Error(
        "Wait for the current operation to finish before creating a project.",
      );
  }
  available();
  active = options;
  try {
    await flushEditorFieldDrafts(owner);
    available();
    await saveCurrentProjectForReplacement(owner.projectId);
    available();
    useProjectStore.getState().createNewProject(name, settings);
    return useProjectStore.getState().project;
  } catch (error) {
    if (!current(options))
      throw (
        options.signal?.reason ??
        new DOMException("Project creation was cancelled", "AbortError")
      );
    throw error;
  } finally {
    if (active === options) active = null;
  }
}
