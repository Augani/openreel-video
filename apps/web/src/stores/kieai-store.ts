/**
 * KieAI background task store
 *
 * Tracks pending KieAI generation tasks so the poller can resume them across
 * dialog closes and page refreshes (tasks live on KieAI servers for ~3 days).
 *
 * Task lifecycle:
 *   pending → (poll ok + download ok) → removed (success)
 *   pending → (poll ok + download fail / API fail / auth fail) → failed ← user can retry
 *   pending → (10 poll errors) → failed  ← user can retry
 *   failed  → (user clicks retry)        → pending (retries reset)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_POLL_RETRIES = 10;

export interface PendingKieAITask {
  /** KieAI task ID returned by createImageTask */
  taskId: string;
  /** The MediaItem placeholder ID in the project's media library */
  mediaId: string;
  /** The project this task belongs to */
  projectId: string;
  /** "image" | "video" — determines polling interval */
  type: "image" | "video";
  /** Suggested file name for the result (e.g. "photo_kieai.png") */
  suggestedName: string;
  /** Unix timestamp (ms) when the task was created */
  createdAt: number;
  /** Number of consecutive poll/download errors */
  retries: number;
  /** Set to true when retries >= MAX_POLL_RETRIES — poller stops, UI shows retry button */
  failed: boolean;
  /** A response accepted while its originating project was closed. */
  needsPlaceholder?: boolean;
  sourcePreviewUrl?: string | null;
  /** Recreate a missing unsaved placeholder when its project reopens. */
  restorePlaceholder?: boolean;
  /** Preserve the receipt while a user-deleted/replaced target stays absent. */
  detached?: boolean;
}

interface KieAIStore {
  tasks: PendingKieAITask[];
  addTask: (task: Omit<PendingKieAITask, "retries" | "failed">) => void;
  removeTask: (taskId: string) => void;
  markPlaceholderAttached: (taskId: string, previewUrl?: string | null) => void;
  setTaskDetached: (taskId: string, detached: boolean) => void;
  resetRetry: (taskId: string) => void;
  incrementRetry: (taskId: string) => void;
  markFailed: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  getTasksForProject: (projectId: string) => PendingKieAITask[];
}

export const useKieAIStore = create<KieAIStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (task) =>
        set((s) => ({
          tasks: s.tasks.some((current) => current.taskId === task.taskId)
            ? s.tasks
            : [...s.tasks, { ...task, retries: 0, failed: false }],
        })),

      markPlaceholderAttached: (taskId, previewUrl) =>
        set((state) => {
          const task = state.tasks.find((task) => task.taskId === taskId);
          if (!task) return state;
          const sourcePreviewUrl = task.sourcePreviewUrl ?? previewUrl ?? null;
          if (
            task.restorePlaceholder &&
            !task.needsPlaceholder &&
            !task.detached &&
            task.sourcePreviewUrl === sourcePreviewUrl
          )
            return state;
          return {
            tasks: state.tasks.map((task) =>
              task.taskId === taskId
                ? {
                    ...task,
                    needsPlaceholder: false,
                    restorePlaceholder: true,
                    detached: false,
                    sourcePreviewUrl,
                  }
                : task,
            ),
          };
        }),
      setTaskDetached: (taskId, detached) =>
        set((state) =>
          state.tasks.some(
            (task) => task.taskId === taskId && task.detached !== detached,
          )
            ? {
                tasks: state.tasks.map((task) =>
                  task.taskId === taskId ? { ...task, detached } : task,
                ),
              }
            : state,
        ),
      resetRetry: (taskId) =>
        set((state) =>
          state.tasks.some((task) => task.taskId === taskId && task.retries > 0)
            ? {
                tasks: state.tasks.map((task) =>
                  task.taskId === taskId ? { ...task, retries: 0 } : task,
                ),
              }
            : state,
        ),

      removeTask: (taskId) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.taskId !== taskId) })),

      incrementRetry: (taskId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.taskId === taskId ? { ...t, retries: t.retries + 1 } : t,
          ),
        })),

      markFailed: (taskId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.taskId === taskId ? { ...t, failed: true } : t,
          ),
        })),

      retryTask: (taskId) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.taskId === taskId ? { ...t, retries: 0, failed: false } : t,
          ),
        })),

      getTasksForProject: (projectId) =>
        get().tasks.filter((t) => t.projectId === projectId),
    }),
    { name: "kieai-pending-tasks" },
  ),
);
