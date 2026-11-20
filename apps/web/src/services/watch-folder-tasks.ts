import { backgroundTasks, type BackgroundTaskInput, type BackgroundTaskStatus } from "@openreel/core/tasks/task-registry";
import type { OpenReelWatchFoldersSnapshot, OpenReelWatchItem, OpenReelWatchItemState } from "../types/global";

/**
 * Mirrors desktop watch-folder activity into the background task panel. The work itself runs in the
 * main process; this only presents it (the only control is Retry on a failed item).
 */

const STATUS: Record<OpenReelWatchItemState, BackgroundTaskStatus> = {
  detecting: "queued",
  queued: "queued",
  waiting: "queued",
  running: "running",
  done: "completed",
  failed: "failed",
  duplicate: "completed",
  cancelled: "cancelled",
};

const DETAIL: Partial<Record<OpenReelWatchItemState, string>> = {
  detecting: "Waiting for the file to finish copying",
  duplicate: "Duplicate, skipped",
};

/** Newest finished items kept in the panel (the main process keeps more; the panel stays short). */
export const MAX_FINISHED_WATCH_TASKS = 12;

const folderName = (snapshot: OpenReelWatchFoldersSnapshot, id: string): string => {
  const folder = snapshot.folders.find((entry) => entry.config.id === id)?.config;
  return folder ? (folder.path.split(/[\\/]/).filter(Boolean).pop() ?? folder.path) : "folder";
};

function toTask(snapshot: OpenReelWatchFoldersSnapshot, item: OpenReelWatchItem): BackgroundTaskInput {
  const config = snapshot.folders.find((entry) => entry.config.id === item.folderId)?.config;
  const verb = config?.kind === "export" ? "Render" : "Import";
  const paused = config?.paused === true && (item.state === "queued" || item.state === "detecting");
  return {
    id: `watch-folders:${item.id}`,
    kind: config?.kind === "export" ? "export" : "import",
    source: "watch-folders",
    title: `Watch folder · ${verb} ${item.name}`,
    detail: paused ? `Folder "${folderName(snapshot, item.folderId)}" is paused` : (item.error ?? item.detail ?? DETAIL[item.state] ?? folderName(snapshot, item.folderId)),
    status: STATUS[item.state],
    progress: item.state === "running" ? item.progress : item.state === "done" ? 1 : item.state === "queued" || item.state === "detecting" ? 0 : null,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    error: item.state === "failed" ? item.error : undefined,
  };
}

export function syncWatchFolderTasks(snapshot: OpenReelWatchFoldersSnapshot, retry: (itemId: string) => void): void {
  const active = snapshot.items.filter((item) => item.state === "detecting" || item.state === "queued" || item.state === "waiting" || item.state === "running");
  const finished = snapshot.items.filter((item) => !active.includes(item)).slice(0, MAX_FINISHED_WATCH_TASKS);
  backgroundTasks.syncSource(
    "watch-folders",
    [...active, ...finished].map((item) => ({
      task: toTask(snapshot, item),
      controls: item.state === "failed" ? { retry: () => retry(item.id) } : {},
    })),
  );
}

/** Starts mirroring. Returns a stop function. A no-op off desktop. */
export function startWatchFolderTasks(): () => void {
  const bridge = window.openreel?.watchFolders;
  if (!bridge) return () => undefined;
  let alive = true;
  const retry = (itemId: string): void => void bridge.retry(itemId).catch(() => undefined);
  const off = bridge.onChange((snapshot) => {
    if (alive) syncWatchFolderTasks(snapshot, retry);
  });
  void bridge
    .list()
    .then((snapshot) => {
      if (alive) syncWatchFolderTasks(snapshot, retry);
    })
    .catch(() => undefined);
  return () => {
    alive = false;
    off();
    backgroundTasks.syncSource("watch-folders", []);
  };
}
