import type { Project } from "@openreel/core";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { useProjectStore } from "../stores/project-store";
import { useProjectManagerStore } from "../stores/project-manager-store";
import { toast } from "../stores/notification-store";
import type { OpenReelProjectManagerEvent, OpenReelProjectManagerOptions } from "../types/global";
import { projectManager } from "./project-manager";
import { activateOpenedProject } from "./project-replacement";

/**
 * File > Project Manager (desktop): collect or consolidate the project into a new folder. The files are written
 * by the main process (ffmpeg sidecar); this side sends the project, shows progress in the background-task panel and
 * the dialog, and opens the result.
 */

/** What the main process needs: the project as the editor saves it, minus bytes and previews it cannot use. */
export function projectJsonForManager(project: Project): string {
  return JSON.stringify(project, (key, value) =>
    key === "blob" || key === "fileHandle" || key === "waveformData" || key === "filmstripThumbnails" || key === "thumbnailUrl" ? null : value,
  );
}

export function projectManagerAvailable(): boolean {
  return Boolean(window.openreel?.projectManager);
}

const TASK_PREFIX = "project-manager:";
let subscribed = false;
/** Arguments of the last job started here, so a failed or cancelled run can be retried from the task panel. */
let lastStart: [OpenReelProjectManagerOptions, string, string | undefined] | null = null;

function onEvent(event: OpenReelProjectManagerEvent): void {
  const store = useProjectManagerStore.getState();
  // Another window's job is not this dialog's: events carry the job id of the one started here.
  if (store.job && store.job.jobId !== event.jobId && store.job.phase !== "done" && store.job.phase !== "error" && store.job.phase !== "cancelled") return;
  store.setJob(event);
  const retryArgs = lastStart;
  const active = event.phase === "scanning" || event.phase === "running" || event.phase === "finalizing";
  backgroundTasks.upsert(
    {
      id: `${TASK_PREFIX}${event.jobId}`,
      kind: "other",
      source: "project-manager",
      title: "Project Manager",
      detail: event.phase === "error" ? event.error : event.label,
      status: active ? "running" : event.phase === "done" ? "completed" : event.phase === "cancelled" ? "cancelled" : "failed",
      progress: event.fraction,
      ...(event.phase === "error" ? { error: event.error } : {}),
    },
    active ? { cancel: () => void cancelProjectManagerJob() } : retryArgs ? { retry: () => void startProjectManagerJob(...retryArgs).catch((error: unknown) => toast.error("Project Manager failed", error instanceof Error ? error.message : "")) } : undefined,
  );
  if (event.phase === "done") toast.success("Project Manager finished", event.summary ? `${event.summary.files} files, ${(event.summary.bytes / 1e6).toFixed(1)} MB in ${event.destDir}` : "");
  else if (event.phase === "error") toast.error("Project Manager failed", event.error ?? "");
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.openreel?.projectManager?.onEvent(onEvent);
}

export async function startProjectManagerJob(options: OpenReelProjectManagerOptions, destParent: string, projectName?: string): Promise<string> {
  const bridge = window.openreel?.projectManager;
  if (!bridge) throw new Error("Project Manager needs the desktop app.");
  ensureSubscribed();
  lastStart = [options, destParent, projectName];
  const project = useProjectStore.getState().getFullProject();
  const { jobId } = await bridge.start({ projectJson: projectJsonForManager(project), options, destParent, ...(projectName ? { projectName } : {}) });
  if (useProjectManagerStore.getState().job?.jobId !== jobId) {
    useProjectManagerStore.getState().setJob({ jobId, phase: "scanning", fraction: 0, label: "Starting", itemIndex: 0, itemCount: 0 });
  }
  return jobId;
}

export async function cancelProjectManagerJob(): Promise<void> {
  const job = useProjectManagerStore.getState().job;
  if (job) await window.openreel?.projectManager?.cancel(job.jobId);
}

/** Open the project folder's project in the editor (saving the current one first, as Open does). */
export async function openCollectedProject(projectPath: string): Promise<void> {
  const fs = window.openreel?.fs;
  if (!fs) throw new Error("Opening needs the desktop app.");
  const content = await fs.readFile(projectPath);
  const project = await projectManager.parseProjectContent(content);
  await projectManager.ensureInitialized().catch(() => undefined);
  await activateOpenedProject({ project, fileHandle: { kind: "native", path: projectPath } });
}
