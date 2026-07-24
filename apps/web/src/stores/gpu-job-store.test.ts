import { describe, it, expect, beforeEach } from "vitest";
import { useGpuJobStore } from "./gpu-job-store";

beforeEach(() => {
  useGpuJobStore.setState({ jobs: [] });
});

describe("gpu-job-store", () => {
  it("adds and lists jobs for a project", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "Upscaled" });
    useGpuJobStore.getState().addJob({ jobID: "j2", mediaId: "m2", projectId: "p2", kind: "denoise", suggestedName: "Denoised" });
    const p1 = useGpuJobStore.getState().getJobsForProject("p1");
    expect(p1.map((j) => j.jobID)).toEqual(["j1"]);
    expect(p1[0].retries).toBe(0);
    expect(p1[0].failed).toBe(false);
  });
  it("increments retries and marks failed", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "x" });
    useGpuJobStore.getState().incrementRetry("j1");
    expect(useGpuJobStore.getState().jobs[0].retries).toBe(1);
    useGpuJobStore.getState().markFailed("j1");
    expect(useGpuJobStore.getState().jobs[0].failed).toBe(true);
    useGpuJobStore.getState().retryJob("j1");
    expect(useGpuJobStore.getState().jobs[0].failed).toBe(false);
    expect(useGpuJobStore.getState().jobs[0].retries).toBe(0);
  });
  it("resets retries to zero without clearing failed", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "x" });
    useGpuJobStore.getState().incrementRetry("j1");
    useGpuJobStore.getState().incrementRetry("j1");
    useGpuJobStore.getState().markFailed("j1");
    useGpuJobStore.getState().resetRetries("j1");
    expect(useGpuJobStore.getState().jobs[0].retries).toBe(0);
    expect(useGpuJobStore.getState().jobs[0].failed).toBe(true);
  });
  it("removes jobs", () => {
    useGpuJobStore.getState().addJob({ jobID: "j1", mediaId: "m1", projectId: "p1", kind: "upscale", suggestedName: "x" });
    useGpuJobStore.getState().removeJob("j1");
    expect(useGpuJobStore.getState().jobs).toHaveLength(0);
  });
});
