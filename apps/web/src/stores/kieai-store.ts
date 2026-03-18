/**
 * KieAI background task store
 *
 * Tracks pending KieAI generation tasks so the poller can resume them across
 * dialog closes, page refreshes, etc.
 *
 * Persisted to localStorage so tasks survive a page reload while they're
 * still generating (KieAI tasks live on the server for ~3 days).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

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
}

interface KieAIStore {
  tasks: PendingKieAITask[];
  addTask: (task: PendingKieAITask) => void;
  removeTask: (taskId: string) => void;
  getTasksForProject: (projectId: string) => PendingKieAITask[];
}

export const useKieAIStore = create<KieAIStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (task) =>
        set((s) => ({ tasks: [...s.tasks, task] })),

      removeTask: (taskId) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.taskId !== taskId) })),

      getTasksForProject: (projectId) =>
        get().tasks.filter((t) => t.projectId === projectId),
    }),
    {
      name: "kieai-pending-tasks",
    },
  ),
);
