import type { ActionExecutorLike } from "../lazy-action-executor";
import type { MediaItem } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useKieAIStore, type PendingKieAITask } from "../../stores/kieai-store";

export function createPendingKieAIPlaceholder(
  task: PendingKieAITask,
): MediaItem {
  return {
    id: task.mediaId,
    name: task.suggestedName,
    type: task.type,
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 0,
    },
    thumbnailUrl: task.sourcePreviewUrl ?? null,
    waveformData: null,
    isPlaceholder: true,
    isPending: !task.failed,
    kieaiError: task.failed || undefined,
    kieaiTaskId: task.taskId,
  };
}

/** Attach a late accepted task when its originating project is open again. */
export function attachPendingKieAIPlaceholder(task: PendingKieAITask): boolean {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject || store.project.id !== task.projectId)
    return false;
  const existing = store.project.mediaLibrary.items.find(
    (item) => item.id === task.mediaId,
  );
  if (existing && existing.kieaiTaskId !== task.taskId) return false;
  if (!existing) store.addPlaceholderMedia(createPendingKieAIPlaceholder(task));
  useKieAIStore
    .getState()
    .markPlaceholderAttached(
      task.taskId,
      existing?.thumbnailUrl ?? task.sourcePreviewUrl,
    );
  return true;
}

/** Accepted remote work outlives its dialog and stays bound to the origin. */
export function registerAcceptedImageTask(input: {
  taskId: string;
  mediaId: string;
  projectId: string;
  executor: ActionExecutorLike;
  suggestedName: string;
  previewUrl: string | null;
}): PendingKieAITask {
  const existing = useKieAIStore
    .getState()
    .tasks.find((task) => task.taskId === input.taskId);
  if (existing) return existing;
  const task: PendingKieAITask = {
    taskId: input.taskId,
    mediaId: input.mediaId,
    projectId: input.projectId,
    type: "image",
    suggestedName: input.suggestedName,
    createdAt: Date.now(),
    retries: 0,
    failed: false,
    needsPlaceholder: true,
    restorePlaceholder: true,
    sourcePreviewUrl: input.previewUrl,
  };
  useKieAIStore.getState().addTask(task);
  const current = useProjectStore.getState();
  if (current.actionExecutor === input.executor)
    attachPendingKieAIPlaceholder(task);
  return task;
}
