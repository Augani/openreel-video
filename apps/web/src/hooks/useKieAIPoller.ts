/**
 * useKieAIPoller
 *
 * Background poller for KieAI generation tasks.
 *
 * - First poll: 5 s after task creation
 * - Subsequent polls: 30 s (image) / 2 min (video)
 * - Up to MAX_POLL_RETRIES consecutive errors before giving up
 * - On exhaustion: marks task as failed; UI shows a manual retry button
 * - On API success: downloads result, replaces placeholder, removes task
 * - Task is ALWAYS removed on API success/fail — never left stuck
 * - Tasks older than 3 days are auto-expired
 */

import { useEffect, useRef, useCallback } from "react";
import { useProjectStore } from "../stores/project-store";
import { useKieAIStore, MAX_POLL_RETRIES } from "../stores/kieai-store";
import { pollTaskOnce, getResultUrl } from "../services/kieai/image-generation";
import { KieAIError } from "../services/kieai/types";

const FIRST_POLL_DELAY_MS = 5_000;
const POLL_INTERVAL_IMAGE_MS = 30_000;
const POLL_INTERVAL_VIDEO_MS = 120_000;

/** Tasks older than 3 days are expired (KieAI cleans up server-side too) */
const TASK_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Allowed result URL host for SSRF protection */
const ALLOWED_RESULT_HOSTS = new Set([
  "tempfile.aiquickdraw.com",
  "cdn.kie.ai",
]);

function isAllowedResultUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_RESULT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function useKieAIPoller() {
  const tasks            = useKieAIStore((s) => s.tasks);
  const removeTask       = useKieAIStore((s) => s.removeTask);
  const incrementRetry   = useKieAIStore((s) => s.incrementRetry);
  const markFailed       = useKieAIStore((s) => s.markFailed);
  const projectId        = useProjectStore((s) => s.project?.id);
  const replacePlaceholder = useProjectStore((s) => s.replacePlaceholderMedia);
  const setKieAIItemState  = useProjectStore((s) => s.setKieAIItemState);

  const timersRef   = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  // Use refs for callbacks to avoid stale closures in recursive setTimeout
  const replacePlaceholderRef = useRef(replacePlaceholder);
  replacePlaceholderRef.current = replacePlaceholder;
  const setKieAIItemStateRef = useRef(setKieAIItemState);
  setKieAIItemStateRef.current = setKieAIItemState;

  const handleExpiredTask = useCallback((taskId: string, mediaId: string) => {
    markFailed(taskId);
    setKieAIItemStateRef.current(mediaId, false, true);
  }, [markFailed]);

  useEffect(() => {
    const activeTasks = tasks.filter(
      (t) => t.projectId === projectId && !t.failed,
    );

    // Start a polling loop for each new active task
    for (const task of activeTasks) {
      if (timersRef.current.has(task.taskId)) continue;
      if (inFlightRef.current.has(task.taskId)) continue;

      // Expire tasks older than 3 days
      if (Date.now() - task.createdAt > TASK_MAX_AGE_MS) {
        handleExpiredTask(task.taskId, task.mediaId);
        continue;
      }

      const interval =
        task.type === "video" ? POLL_INTERVAL_VIDEO_MS : POLL_INTERVAL_IMAGE_MS;

      const elapsed  = Date.now() - task.createdAt;
      const firstDelay = elapsed < FIRST_POLL_DELAY_MS
        ? FIRST_POLL_DELAY_MS - elapsed
        : Math.max(0, interval - (elapsed % interval));

      const doPoll = async () => {
        timersRef.current.delete(task.taskId);
        if (inFlightRef.current.has(task.taskId)) return;
        inFlightRef.current.add(task.taskId);

        try {
          const record = await pollTaskOnce(task.taskId);

          if (record.state === "success") {
            // API says done — remove on success, mark failed on download error (retryable)
            try {
              const url = getResultUrl(record);

              if (!isAllowedResultUrl(url)) {
                throw new KieAIError(403, `Result URL host not allowed: ${url}`);
              }

              const res = await fetch(url);
              if (!res.ok) {
                throw new KieAIError(res.status, `Download failed: HTTP ${res.status}`);
              }

              const blob = await res.blob();
              if (blob.size === 0) {
                throw new KieAIError(500, "Downloaded result is empty");
              }

              await replacePlaceholderRef.current(task.mediaId, blob, task.suggestedName);
              removeTask(task.taskId);
            } catch (downloadErr) {
              console.error(`[KieAIPoller] download failed for ${task.taskId}:`, downloadErr);
              markFailed(task.taskId);
              setKieAIItemStateRef.current(task.mediaId, false, true);
            }

          } else if (record.state === "fail") {
            console.warn(`[KieAIPoller] task ${task.taskId} failed: ${record.failMsg}`);
            setKieAIItemStateRef.current(task.mediaId, false, true);
            markFailed(task.taskId);

          } else {
            // Still generating — schedule next poll
            const t = setTimeout(doPoll, interval);
            timersRef.current.set(task.taskId, t);
          }
        } catch (err) {
          // Auth error — give up immediately, don't count as a retry
          if (err instanceof KieAIError && err.code === 401) {
            console.warn("[KieAIPoller] auth error — stopping poll for", task.taskId);
            markFailed(task.taskId);
            setKieAIItemStateRef.current(task.mediaId, false, true);
            return;
          }

          // Network / transient error — increment retry counter
          incrementRetry(task.taskId);

          // Re-read current task state from the store (retries may have just incremented)
          const currentTask = useKieAIStore
            .getState()
            .tasks.find((t) => t.taskId === task.taskId);

          const currentRetries = currentTask ? currentTask.retries : MAX_POLL_RETRIES;

          if (currentRetries >= MAX_POLL_RETRIES) {
            console.warn(
              `[KieAIPoller] ${task.taskId} exhausted ${MAX_POLL_RETRIES} retries — marking failed`,
            );
            markFailed(task.taskId);
            setKieAIItemStateRef.current(task.mediaId, false, true);
          } else {
            const t = setTimeout(doPoll, interval);
            timersRef.current.set(task.taskId, t);
          }
        } finally {
          inFlightRef.current.delete(task.taskId);
        }
      };

      const t = setTimeout(doPoll, firstDelay);
      timersRef.current.set(task.taskId, t);
    }

    // Cancel timers for tasks removed from the active list
    for (const [taskId, timer] of timersRef.current) {
      const stillActive = activeTasks.some((t) => t.taskId === taskId);
      if (!stillActive) {
        clearTimeout(timer);
        timersRef.current.delete(taskId);
      }
    }
  }, [tasks, projectId, removeTask, incrementRetry, markFailed, handleExpiredTask]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
}
