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
 */

import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/project-store";
import { useKieAIStore, MAX_POLL_RETRIES } from "../stores/kieai-store";
import { pollTaskOnce, getResultUrl } from "../services/kieai/image-generation";
import { KieAIError } from "../services/kieai/types";

const FIRST_POLL_DELAY_MS = 5_000;
const POLL_INTERVAL_IMAGE_MS = 30_000;
const POLL_INTERVAL_VIDEO_MS = 120_000;

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

  useEffect(() => {
    const activeTasks = tasks.filter(
      (t) => t.projectId === projectId && !t.failed,
    );

    // Start a polling loop for each new active task
    for (const task of activeTasks) {
      if (timersRef.current.has(task.taskId)) continue;

      const interval =
        task.type === "video" ? POLL_INTERVAL_VIDEO_MS : POLL_INTERVAL_IMAGE_MS;

      const elapsed  = Date.now() - task.createdAt;
      const firstDelay = elapsed < FIRST_POLL_DELAY_MS
        ? FIRST_POLL_DELAY_MS - elapsed
        : Math.max(0, interval - (elapsed % interval));

      console.log(
        `[KieAIPoller] scheduling ${task.taskId} — first poll in ${Math.round(firstDelay / 1000)}s`,
      );

      const doPoll = async () => {
        timersRef.current.delete(task.taskId);
        if (inFlightRef.current.has(task.taskId)) return;
        inFlightRef.current.add(task.taskId);

        try {
          const record = await pollTaskOnce(task.taskId);
          console.log(`[KieAIPoller] ${task.taskId} state: ${record.state}`);

          if (record.state === "success") {
            // API says done — always remove the task, even if download fails
            try {
              const url = getResultUrl(record);
              console.log(`[KieAIPoller] downloading result: ${url}`);
              const res = await fetch(url);
              const blob = await res.blob();
              await replacePlaceholder(task.mediaId, blob, task.suggestedName);
              console.log(`[KieAIPoller] ✓ replaced placeholder for ${task.taskId}`);
            } catch (downloadErr) {
              console.error(`[KieAIPoller] download failed for ${task.taskId}:`, downloadErr);
              // At minimum clear the pending spinner so the user isn't stuck
              setKieAIItemState(task.mediaId, false, true);
            } finally {
              removeTask(task.taskId);
            }

          } else if (record.state === "fail") {
            console.warn(`[KieAIPoller] task ${task.taskId} failed: ${record.failMsg}`);
            setKieAIItemState(task.mediaId, false, true);
            removeTask(task.taskId);

          } else {
            // Still generating — schedule next poll (no error, don't touch retries)
            console.log(`[KieAIPoller] ${task.taskId} still ${record.state}, retry in ${interval / 1000}s`);
            const t = setTimeout(doPoll, interval);
            timersRef.current.set(task.taskId, t);
          }
        } catch (err) {
          // Auth error — give up immediately, don't count as a retry
          if (err instanceof KieAIError && err.code === 401) {
            console.warn("[KieAIPoller] auth error — stopping poll for", task.taskId);
            setKieAIItemState(task.mediaId, false, true);
            removeTask(task.taskId);
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
            setKieAIItemState(task.mediaId, false, true);
          } else {
            console.warn(
              `[KieAIPoller] poll error for ${task.taskId} (retry ${currentRetries}/${MAX_POLL_RETRIES}):`,
              err,
            );
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
  }, [tasks, projectId, removeTask, incrementRetry, markFailed, replacePlaceholder, setKieAIItemState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);
}
