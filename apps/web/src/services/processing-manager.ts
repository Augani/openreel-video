import { create } from "zustand";
import i18n from "../i18n";

export type ProcessingType =
  | "background-removal"
  | "auto-reframe"
  | "color-grading"
  | "effects";

export interface ProcessingTask {
  id: string;
  clipId: string;
  type: ProcessingType;
  progress: number;
  status: "queued" | "processing" | "completed" | "failed";
  message: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

interface ProcessingState {
  tasks: Map<string, ProcessingTask>;
  isProcessing: boolean;
  currentTaskId: string | null;

  addTask: (clipId: string, type: ProcessingType) => string;
  updateTaskProgress: (
    taskId: string,
    progress: number,
    message?: string,
  ) => void;
  completeTask: (taskId: string) => void;
  failTask: (taskId: string, error: string) => void;
  removeTask: (taskId: string) => void;
  getTasksForClip: (clipId: string) => ProcessingTask[];
  hasActiveProcessing: () => boolean;
  getOverallProgress: () => {
    total: number;
    completed: number;
    progress: number;
  };
  clearCompleted: () => void;
}

let taskIdCounter = 0;

export const useProcessingStore = create<ProcessingState>((set, get) => ({
  tasks: new Map(),
  isProcessing: false,
  currentTaskId: null,

  addTask: (clipId, type) => {
    const taskId = `task-${++taskIdCounter}-${Date.now()}`;
    const task: ProcessingTask = {
      id: taskId,
      clipId,
      type,
      progress: 0,
      status: "queued",
      message: i18n.t("processing.waitingToStart"),
    };

    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, task);
      return {
        tasks: newTasks,
        isProcessing: true,
        currentTaskId: state.currentTaskId || taskId,
      };
    });

    return taskId;
  },

  updateTaskProgress: (taskId, progress, message) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        ...task,
        progress: Math.min(100, Math.max(0, progress)),
        status: "processing",
        message: message || task.message,
        startedAt: task.startedAt || Date.now(),
      });

      return { tasks: newTasks };
    });
  },

  completeTask: (taskId) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        ...task,
        progress: 100,
        status: "completed",
        message: i18n.t("processing.complete"),
        completedAt: Date.now(),
      });

      const hasRemaining = Array.from(newTasks.values()).some(
        (t) => t.status === "queued" || t.status === "processing",
      );

      const nextTask = hasRemaining
        ? Array.from(newTasks.values()).find((t) => t.status === "queued")
            ?.id || null
        : null;

      return {
        tasks: newTasks,
        isProcessing: hasRemaining,
        currentTaskId: nextTask,
      };
    });
  },

  failTask: (taskId, error) => {
    set((state) => {
      const task = state.tasks.get(taskId);
      if (!task) return state;

      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        ...task,
        status: "failed",
        message: i18n.t("processing.failed"),
        error,
        completedAt: Date.now(),
      });

      const hasRemaining = Array.from(newTasks.values()).some(
        (t) => t.status === "queued" || t.status === "processing",
      );

      return {
        tasks: newTasks,
        isProcessing: hasRemaining,
        currentTaskId: hasRemaining
          ? Array.from(newTasks.values()).find((t) => t.status === "queued")
              ?.id || null
          : null,
      };
    });
  },

  removeTask: (taskId) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(taskId);

      const hasRemaining = Array.from(newTasks.values()).some(
        (t) => t.status === "queued" || t.status === "processing",
      );

      return {
        tasks: newTasks,
        isProcessing: hasRemaining,
        currentTaskId: hasRemaining ? state.currentTaskId : null,
      };
    });
  },

  getTasksForClip: (clipId) => {
    return Array.from(get().tasks.values()).filter((t) => t.clipId === clipId);
  },

  hasActiveProcessing: () => {
    return Array.from(get().tasks.values()).some(
      (t) => t.status === "queued" || t.status === "processing",
    );
  },

  getOverallProgress: () => {
    const tasks = Array.from(get().tasks.values());
    const activeTasks = tasks.filter(
      (t) => t.status !== "completed" && t.status !== "failed",
    );

    if (activeTasks.length === 0) {
      return { total: 0, completed: 0, progress: 100 };
    }

    const totalProgress = activeTasks.reduce((sum, t) => sum + t.progress, 0);
    const avgProgress = totalProgress / activeTasks.length;

    return {
      total: activeTasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      progress: Math.round(avgProgress),
    };
  },

  clearCompleted: () => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      for (const [id, task] of newTasks) {
        if (task.status === "completed" || task.status === "failed") {
          newTasks.delete(id);
        }
      }
      return { tasks: newTasks };
    });
  },
}));

export const getProcessingTypeLabel = (type: ProcessingType): string =>
  i18n.t(`processing.types.${type}`);
