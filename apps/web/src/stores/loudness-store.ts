import { create } from "zustand";
import type { LoudnessAnalysis } from "@openreel/core";

export type LoudnessAnalysisStatus = "idle" | "running" | "done" | "error";

interface LoudnessState {
  status: LoudnessAnalysisStatus;
  /** 0..1 while running */
  progress: number;
  analysis: LoudnessAnalysis | null;
  /** project.id the analysis belongs to, so a stale readout is not shown. */
  projectId: string | null;
  /** The timeline object analysed; a different one later means the readout is stale. */
  timelineRef: unknown;
  error: string | null;
  controller: AbortController | null;
  begin: (controller: AbortController, projectId?: string) => void;
  setProgress: (fraction: number) => void;
  finish: (analysis: LoudnessAnalysis, projectId?: string, timelineRef?: unknown) => void;
  fail: (message: string) => void;
  cancelled: () => void;
  cancel: () => void;
  clear: () => void;
}

export const useLoudnessStore = create<LoudnessState>((set, get) => ({
  status: "idle",
  progress: 0,
  analysis: null,
  projectId: null,
  timelineRef: null,
  error: null,
  controller: null,
  begin: (controller, projectId) =>
    set({ status: "running", progress: 0, error: null, controller, projectId: projectId ?? get().projectId }),
  setProgress: (progress) => set({ progress }),
  finish: (analysis, projectId, timelineRef) =>
    set({
      status: "done",
      progress: 1,
      analysis,
      controller: null,
      projectId: projectId ?? get().projectId,
      timelineRef: timelineRef ?? get().timelineRef,
    }),
  fail: (error) => set({ status: "error", error, controller: null }),
  cancelled: () => set({ status: get().analysis ? "done" : "idle", controller: null, progress: 0 }),
  cancel: () => get().controller?.abort(),
  clear: () => set({ status: "idle", analysis: null, progress: 0, error: null, controller: null }),
}));
