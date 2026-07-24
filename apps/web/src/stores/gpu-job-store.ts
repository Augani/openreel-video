import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PendingGpuJob {
  jobID: string;
  mediaId: string;
  projectId: string;
  kind: string;
  suggestedName: string;
  sourceClipId?: string;
  createdAt: number;
  retries: number;
  failed: boolean;
}

interface GpuJobState {
  jobs: PendingGpuJob[];
  addJob: (
    job: Omit<PendingGpuJob, "retries" | "failed" | "createdAt"> & {
      createdAt?: number;
    },
  ) => void;
  removeJob: (jobID: string) => void;
  incrementRetry: (jobID: string) => void;
  resetRetries: (jobID: string) => void;
  markFailed: (jobID: string) => void;
  retryJob: (jobID: string) => void;
  getJobsForProject: (projectId: string) => PendingGpuJob[];
}

export const useGpuJobStore = create<GpuJobState>()(
  persist(
    (set, get) => ({
      jobs: [],

      addJob: (job) =>
        set((s) => ({
          jobs: [
            ...s.jobs,
            {
              ...job,
              createdAt: job.createdAt ?? Date.now(),
              retries: 0,
              failed: false,
            },
          ],
        })),

      removeJob: (jobID) =>
        set((s) => ({ jobs: s.jobs.filter((j) => j.jobID !== jobID) })),

      incrementRetry: (jobID) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.jobID === jobID ? { ...j, retries: j.retries + 1 } : j,
          ),
        })),

      resetRetries: (jobID) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.jobID === jobID ? { ...j, retries: 0 } : j,
          ),
        })),

      markFailed: (jobID) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.jobID === jobID ? { ...j, failed: true } : j,
          ),
        })),

      retryJob: (jobID) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.jobID === jobID ? { ...j, retries: 0, failed: false } : j,
          ),
        })),

      getJobsForProject: (projectId) =>
        get().jobs.filter((j) => j.projectId === projectId),
    }),
    { name: "gpu-pending-jobs" },
  ),
);
