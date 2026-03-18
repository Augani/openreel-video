/**
 * useKieAIPoller
 *
 * Runs in the background (mounted at app root) and periodically polls KieAI
 * for pending task results:
 *   - Images: every 30 seconds
 *   - Videos: every 2 minutes
 *
 * On success, downloads the result and replaces the placeholder.
 * The task is ALWAYS removed once the API reports success or failure — even
 * if the local download/processing step fails, so the user is never stuck.
 */

import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/project-store";
import { useKieAIStore } from "../stores/kieai-store";
import { pollTaskOnce, getResultUrl } from "../services/kieai/image-generation";
import { KieAIError } from "../services/kieai/types";

const FIRST_POLL_DELAY_MS = 5_000;      // Check quickly after task creation
const POLL_INTERVAL_IMAGE_MS = 30_000;  // 30 s between subsequent polls
const POLL_INTERVAL_VIDEO_MS = 120_000; // 2 min

export function useKieAIPoller() {
  const tasks = useKieAIStore((s) => s.tasks);
  const removeTask = useKieAIStore((s) => s.removeTask);
  const replacePlaceholderMedia = useProjectStore((s) => s.replacePlaceholderMedia);
  const projectId = useProjectStore((s) => s.project?.id);

  // Track per-task poll timers so we can cancel them cleanly
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const projectTasks = tasks.filter((t) => t.projectId === projectId);

    // Start polling for any task that doesn't already have a timer
    for (const task of projectTasks) {
      if (timersRef.current.has(task.taskId)) continue; // already scheduled

      const interval =
        task.type === "video" ? POLL_INTERVAL_VIDEO_MS : POLL_INTERVAL_IMAGE_MS;

      const elapsed = Date.now() - task.createdAt;
      const firstDelay = elapsed < FIRST_POLL_DELAY_MS
        ? FIRST_POLL_DELAY_MS - elapsed
        : Math.max(0, interval - (elapsed % interval));

      console.log(`[KieAIPoller] scheduling task ${task.taskId} — first poll in ${Math.round(firstDelay / 1000)}s`);

      const doPoll = async () => {
        timersRef.current.delete(task.taskId);

        if (inFlightRef.current.has(task.taskId)) return;
        inFlightRef.current.add(task.taskId);

        try {
          console.log(`[KieAIPoller] polling task ${task.taskId}`);
          const record = await pollTaskOnce(task.taskId);
          console.log(`[KieAIPoller] task ${task.taskId} state: ${record.state}`);

          if (record.state === "success") {
            // Log raw record so we can inspect the actual resultJson shape
            console.log(`[KieAIPoller] raw success record:`, JSON.stringify(record, null, 2));

            // API says done — fetch result and replace placeholder.
            // ALWAYS remove the task even if download/replace fails.
            try {
              const url = getResultUrl(record);
              console.log(`[KieAIPoller] downloading result: ${url}`);
              const res = await fetch(url);
              const blob = await res.blob();
              await replacePlaceholderMedia(task.mediaId, blob, task.suggestedName);
              console.log(`[KieAIPoller] ✓ replaced placeholder for task ${task.taskId}`);
            } catch (downloadErr) {
              console.error(`[KieAIPoller] download/replace failed for ${task.taskId}:`, downloadErr);
              // Fallback: at minimum clear the pending flag so the user isn't stuck
              try {
                const url = getResultUrl(record);
                replacePlaceholderMedia(
                  task.mediaId,
                  new Blob([], { type: "image/png" }),
                  task.suggestedName,
                ).catch(() => {}); // best effort
                console.warn(`[KieAIPoller] falling back — result URL: ${url}`);
              } catch {
                // ignore
              }
            } finally {
              removeTask(task.taskId);
            }

          } else if (record.state === "fail") {
            console.warn(`[KieAIPoller] task ${task.taskId} failed: ${record.failMsg}`);
            removeTask(task.taskId);

          } else {
            // Still generating — schedule next poll
            console.log(`[KieAIPoller] task ${task.taskId} still ${record.state}, retry in ${interval / 1000}s`);
            const t = setTimeout(doPoll, interval);
            timersRef.current.set(task.taskId, t);
          }
        } catch (err) {
          if (err instanceof KieAIError && err.code === 401) {
            console.warn("[KieAIPoller] auth error — stopping poll for", task.taskId);
            removeTask(task.taskId);
          } else {
            // Network error — retry
            console.warn(`[KieAIPoller] poll error for ${task.taskId}, retrying:`, err);
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

    // Cancel timers for tasks that are no longer in the list
    for (const [taskId, timer] of timersRef.current) {
      if (!projectTasks.some((t) => t.taskId === taskId)) {
        clearTimeout(timer);
        timersRef.current.delete(taskId);
      }
    }
  }, [tasks, projectId, removeTask, replacePlaceholderMedia]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);
}
