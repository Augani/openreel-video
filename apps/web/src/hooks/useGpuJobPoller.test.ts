import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGpuJobPoller } from "./useGpuJobPoller";
import { useGpuJobStore } from "../stores/gpu-job-store";
import { useProjectStore } from "../stores/project-store";
import { createEmptyProject } from "../stores/project/project-helpers";

const importGpuResult = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../services/gpu-result-import", () => ({
  importGpuResult: (...args: unknown[]) => importGpuResult(...args),
}));

const PROJECT_ID = "test-project-id";

function installDesktopBridge(gpu: Record<string, unknown>): void {
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    gpu,
    fs: {
      readFileBytes: vi.fn(async () => new ArrayBuffer(8)),
    },
  };
}

function seedProject(): void {
  const project = { ...createEmptyProject("Poller Test"), id: PROJECT_ID };
  useProjectStore.setState({ project });
}

beforeEach(() => {
  vi.useFakeTimers();
  importGpuResult.mockClear();
  useGpuJobStore.setState({ jobs: [] });
  seedProject();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("useGpuJobPoller", () => {
  it("schedules polling for a job added AFTER the hook mounts (store-reactive)", async () => {
    const jobStatus = vi.fn(async () => ({ jobID: "job-1", status: "processing" }));
    installDesktopBridge({
      jobStatus,
      fetchManifest: vi.fn(),
      downloadArtifact: vi.fn(),
    });

    renderHook(() => useGpuJobPoller());

    expect(jobStatus).not.toHaveBeenCalled();

    act(() => {
      useGpuJobStore.getState().addJob({
        jobID: "job-1",
        mediaId: "media-1",
        projectId: PROJECT_ID,
        kind: "upscale",
        suggestedName: "Upscaled",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(jobStatus).toHaveBeenCalledWith("job-1");
  });

  it("imports the artifact and removes the job on completion", async () => {
    const jobStatus = vi.fn(async () => ({ jobID: "job-2", status: "completed" }));
    const fetchManifest = vi.fn(async () => ({
      jobID: "job-2",
      kind: "upscale",
      artifacts: [{ type: "video", relativePath: "out/result.mp4" }],
    }));
    const downloadArtifact = vi.fn(async () => ({ tempPath: "/tmp/result.mp4", mime: "video/mp4" }));
    installDesktopBridge({ jobStatus, fetchManifest, downloadArtifact });

    renderHook(() => useGpuJobPoller());

    act(() => {
      useGpuJobStore.getState().addJob({
        jobID: "job-2",
        mediaId: "media-2",
        projectId: PROJECT_ID,
        kind: "upscale",
        suggestedName: "Upscaled",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(jobStatus).toHaveBeenCalledWith("job-2");
    expect(downloadArtifact).toHaveBeenCalledWith("job-2", "out/result.mp4");
    expect(importGpuResult).toHaveBeenCalledTimes(1);
    expect(useGpuJobStore.getState().jobs.find((j) => j.jobID === "job-2")).toBeUndefined();
  });
});
