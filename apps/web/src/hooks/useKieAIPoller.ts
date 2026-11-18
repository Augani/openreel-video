/** Poll accepted work only while its originating project is open. */
import type { MediaItem } from "@openreel/core";
import { useEffect, useMemo } from "react";
import { useProjectStore } from "../stores/project-store";
import {
  useKieAIStore,
  MAX_POLL_RETRIES,
  type PendingKieAITask,
} from "../stores/kieai-store";
import { pollTaskOnce, getResultUrl } from "../services/kieai/image-generation";
import { attachPendingKieAIPlaceholder } from "../services/kieai/image-task-registration";
import { KieAIError } from "../services/kieai/types";
const FIRST_POLL_DELAY_MS = 5000;
const POLL_INTERVAL_IMAGE_MS = 30000;
const POLL_INTERVAL_VIDEO_MS = 120000;
const TASK_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ALLOWED_RESULT_HOSTS = new Set([
  "tempfile.aiquickdraw.com",
  "cdn.kie.ai",
]);
function isAllowedResultUrl(url: string): boolean {
  try {
    return ALLOWED_RESULT_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
export function useKieAIPoller() {
  const tasks = useKieAIStore((state) => state.tasks);
  const projectId = useProjectStore((state) => state.project.id);
  const executor = useProjectStore((state) => state.actionExecutor);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const selectManagedMedia = useMemo(() => {
    let previous: readonly MediaItem[] | undefined;
    let previousProject = "";
    let signature = "";
    return (state: ReturnType<typeof useProjectStore.getState>) => {
      if (
        state.project.mediaLibrary.items !== previous ||
        state.project.id !== previousProject
      ) {
        previous = state.project.mediaLibrary.items;
        previousProject = state.project.id;
        const ids = new Set(
          tasks
            .filter((task) => task.projectId === state.project.id)
            .map((task) => task.mediaId),
        );
        signature = ids.size
          ? previous
              .filter((item) => ids.has(item.id))
              .map(
                (item) =>
                  `${item.id}:${item.kieaiTaskId ?? ""}:${Boolean(item.isPending)}:${Boolean(item.isPlaceholder)}:${Boolean(item.kieaiError)}:${item.blob === null}`,
              )
              .join("|")
          : "";
      }
      return signature;
    };
  }, [tasks]);
  const managedMedia = useProjectStore(selectManagedMedia);
  const scope = useMemo(
    () => ({
      projectId,
      executor,
      hasOpenProject,
      active: false,
      timers: new Map<string, ReturnType<typeof setTimeout>>(),
      inFlight: new Map<string, AbortController>(),
      seen: new Set<string>(),
      replacing: new Set<string>(),
    }),
    [projectId, executor, hasOpenProject],
  );
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      for (const timer of scope.timers.values()) clearTimeout(timer);
      scope.timers.clear();
      for (const controller of scope.inFlight.values()) controller.abort();
      scope.inFlight.clear();
    };
  }, [scope]);
  useEffect(() => {
    const active = tasks.filter(
      (task) => hasOpenProject && task.projectId === projectId,
    );
    const activeIds = new Set<string>();
    const sameProject = () => {
      const current = useProjectStore.getState();
      return (
        scope.active &&
        current.hasOpenProject &&
        current.project.id === scope.projectId &&
        current.actionExecutor === scope.executor
      );
    };
    const ownsTask = (task: PendingKieAITask) =>
      sameProject() &&
      useKieAIStore
        .getState()
        .tasks.some(
          (current) =>
            current.taskId === task.taskId &&
            current.mediaId === task.mediaId &&
            current.projectId === task.projectId &&
            current.createdAt === task.createdAt &&
            !current.failed &&
            !current.detached,
        );
    const ownsPlaceholder = (task: PendingKieAITask) =>
      useProjectStore
        .getState()
        .project.mediaLibrary.items.some(
          (item) =>
            item.id === task.mediaId &&
            item.kieaiTaskId === task.taskId &&
            (item.isPlaceholder || item.isPending || item.kieaiError) &&
            item.blob === null,
        );
    const fail = (task: PendingKieAITask) => {
      if (!ownsTask(task)) return;
      useKieAIStore.getState().markFailed(task.taskId);
      if (ownsPlaceholder(task))
        useProjectStore.getState().setKieAIItemState(task.mediaId, false, true);
    };
    for (const task of active) {
      if (scope.replacing.has(task.taskId)) {
        activeIds.add(task.taskId);
        continue;
      }
      const item = useProjectStore
        .getState()
        .project.mediaLibrary.items.find((item) => item.id === task.mediaId);
      if (ownsPlaceholder(task)) {
        scope.seen.add(task.taskId);
        if (task.detached || !task.restorePlaceholder || task.needsPlaceholder)
          useKieAIStore
            .getState()
            .markPlaceholderAttached(task.taskId, item?.thumbnailUrl);
      } else if (task.detached || scope.seen.has(task.taskId) || item) {
        if (!task.detached)
          useKieAIStore.getState().setTaskDetached(task.taskId, true);
        continue;
      } else if (task.needsPlaceholder || task.restorePlaceholder) {
        if (!attachPendingKieAIPlaceholder(task)) continue;
        scope.seen.add(task.taskId);
      }
      if (task.failed) continue;
      activeIds.add(task.taskId);
      if (scope.timers.has(task.taskId) || scope.inFlight.has(task.taskId))
        continue;
      if (Date.now() - task.createdAt > TASK_MAX_AGE_MS) {
        fail(task);
        continue;
      }
      const interval =
        task.type === "video" ? POLL_INTERVAL_VIDEO_MS : POLL_INTERVAL_IMAGE_MS;
      const schedule = (delay: number) => {
        if (ownsTask(task))
          scope.timers.set(
            task.taskId,
            setTimeout(() => {
              void doPoll();
            }, delay),
          );
      };
      const doPoll = async () => {
        scope.timers.delete(task.taskId);
        if (!ownsTask(task) || scope.inFlight.has(task.taskId)) return;
        // Removing or replacing a pending media item is an explicit local choice.
        if (!ownsPlaceholder(task)) {
          useKieAIStore.getState().setTaskDetached(task.taskId, true);
          return;
        }
        const controller = new AbortController();
        scope.inFlight.set(task.taskId, controller);
        try {
          const record = await pollTaskOnce(task.taskId, controller.signal);
          if (!ownsTask(task) || controller.signal.aborted) return;
          if (!ownsPlaceholder(task)) {
            useKieAIStore.getState().setTaskDetached(task.taskId, true);
            return;
          }
          if (record.state === "success") {
            try {
              const url = getResultUrl(record);
              if (!isAllowedResultUrl(url))
                throw new KieAIError(403, "Result URL host not allowed");
              const response = await fetch(url, { signal: controller.signal });
              if (!ownsTask(task) || controller.signal.aborted) return;
              if (!response.ok)
                throw new KieAIError(
                  response.status,
                  `Download failed: HTTP ${response.status}`,
                );
              const blob = await response.blob();
              if (!ownsTask(task) || controller.signal.aborted) return;
              if (!blob.size)
                throw new KieAIError(500, "Downloaded result is empty");
              if (!ownsPlaceholder(task)) {
                useKieAIStore.getState().setTaskDetached(task.taskId, true);
                return;
              }
              scope.replacing.add(task.taskId);
              const applied = await useProjectStore
                .getState()
                .replacePlaceholderMedia(
                  task.mediaId,
                  blob,
                  task.suggestedName,
                );
              if (ownsTask(task)) {
                if (applied === false)
                  useKieAIStore.getState().setTaskDetached(task.taskId, true);
                else useKieAIStore.getState().removeTask(task.taskId);
              }
            } catch {
              if (!controller.signal.aborted && ownsTask(task)) fail(task);
            }
          } else if (record.state === "fail") {
            fail(task);
          } else {
            useKieAIStore.getState().resetRetry(task.taskId);
            schedule(interval);
          }
        } catch (error) {
          if (!ownsTask(task) || controller.signal.aborted) return;
          if (error instanceof KieAIError && error.code === 401) {
            fail(task);
            return;
          }
          useKieAIStore.getState().incrementRetry(task.taskId);
          const current = useKieAIStore
            .getState()
            .tasks.find((item) => item.taskId === task.taskId);
          if (!current || current.retries >= MAX_POLL_RETRIES) fail(task);
          else schedule(interval);
        } finally {
          scope.replacing.delete(task.taskId);
          if (scope.inFlight.get(task.taskId) === controller)
            scope.inFlight.delete(task.taskId);
        }
      };
      const elapsed = Date.now() - task.createdAt;
      schedule(
        elapsed < FIRST_POLL_DELAY_MS
          ? FIRST_POLL_DELAY_MS - elapsed
          : Math.max(0, interval - (elapsed % interval)),
      );
    }
    const retainedIds = new Set(active.map((task) => task.taskId));
    for (const id of scope.seen)
      if (!retainedIds.has(id)) scope.seen.delete(id);
    for (const [id, timer] of scope.timers) {
      if (!activeIds.has(id)) {
        clearTimeout(timer);
        scope.timers.delete(id);
      }
    }
    for (const [id, controller] of scope.inFlight) {
      if (!activeIds.has(id)) {
        controller.abort();
        scope.inFlight.delete(id);
      }
    }
  }, [tasks, projectId, hasOpenProject, scope, managedMedia]);
}
