import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { projectManager, type PickedProjectFile } from "./project-manager";
import { loadEngineModules } from "./lazy-engines";

function assertAvailable(expectedProjectId: string) {
  if (useProjectStore.getState().project.id !== expectedProjectId) {
    throw new Error("The open project changed before the switch finished. Please try again.");
  }
  if (useUIStore.getState().exportState.isExporting) {
    throw new Error("Wait for the export to finish before switching projects.");
  }
  if (useTimelineStore.getState().playbackLockedReason) {
    throw new Error("Wait for the current operation to finish before switching projects.");
  }
}

export async function saveCurrentProjectForReplacement(expectedProjectId: string): Promise<void> {
  assertAvailable(expectedProjectId);
  let savedProject;
  do {
    const current = useProjectStore.getState();
    savedProject = current.project;
    if (current.hasOpenProject) await current.forceSave();
    assertAvailable(expectedProjectId);
    // Edits can arrive while IndexedDB writes. Flush the newest revision too.
  } while (useProjectStore.getState().project !== savedProject);
}

let opening = false;

/** Shared web/native Open, preserving both current edits and its file handle. */
export async function openEditorProject(): Promise<boolean> {
  if (opening) return false;
  const projectId = useProjectStore.getState().project.id;
  assertAvailable(projectId);
  opening = true;
  try {
    // Call the picker before an await, while the initiating click is active.
    const picked = await projectManager.pickProjectFile();
    if (!picked) return false;
    await activateOpenedProject(picked, projectId);
    return true;
  } finally {
    opening = false;
  }
}

/** Replace the open project with an already-read project file (save the current one first). Also used by MCP open_project_file. */
export async function activateOpenedProject(picked: PickedProjectFile, previousProjectId = useProjectStore.getState().project.id): Promise<void> {
  if (useProjectStore.getState().hasOpenProject) await saveCurrentProjectForReplacement(previousProjectId);
  // loadProject defers until the engines resolve (cold welcome screen); the file handle below must follow it.
  await loadEngineModules();
  useProjectStore.getState().loadProject(picked.project);
  projectManager.activatePickedProject(picked);
  const timeline = useTimelineStore.getState();
  timeline.stop();
  timeline.seekToStart();
  timeline.clearLoopRange();
  timeline.setScrollX(0);
  timeline.setScrollY(0);
  useUIStore.getState().clearSelection();
}
