import { describe, expect, it, vi } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import type { Project } from "@openreel/core";
import { projectJsonForManager, startProjectManagerJob } from "./project-consolidate";

describe("projectJsonForManager", () => {
  it("drops bytes, handles and previews the main process cannot use and keeps paths and timing", () => {
    const project = {
      id: "p",
      name: "P",
      mediaLibrary: {
        items: [
          {
            id: "m",
            name: "clip.mov",
            blob: new Blob(["x"]),
            fileHandle: {},
            waveformData: new Float32Array(1000),
            thumbnailUrl: "blob:http://x/1",
            filmstripThumbnails: [{ timestamp: 0, url: "data:image/png;base64,AAAA" }],
            sourceFile: { name: "clip.mov", size: 1, lastModified: 1, path: "/media/clip.mov" },
            metadata: { duration: 3 },
          },
        ],
      },
    } as unknown as Project;
    const parsed = JSON.parse(projectJsonForManager(project));
    const item = parsed.mediaLibrary.items[0];
    expect(item.blob).toBeNull();
    expect(item.waveformData).toBeNull();
    expect(item.thumbnailUrl).toBeNull();
    expect(item.filmstripThumbnails).toBeNull();
    expect(item.sourceFile.path).toBe("/media/clip.mov");
    expect(item.metadata.duration).toBe(3);
  });
});

describe("Project Manager background task", () => {
  it("lists the job with progress and Cancel, then offers Retry after a failure", async () => {
    let emit: (event: Record<string, unknown>) => void = () => undefined;
    const start = vi.fn(async () => ({ jobId: "job-1" }));
    (window as unknown as { openreel: unknown }).openreel = {
      projectManager: { start, cancel: vi.fn(), onEvent: (cb: typeof emit) => { emit = cb; } },
    };
    const project = {} as never;
    vi.spyOn(await import("../stores/project-store").then((m) => m.useProjectStore), "getState").mockReturnValue({ getFullProject: () => ({ id: "p", name: "P", mediaLibrary: { items: [] } }) } as never);
    void project;
    await startProjectManagerJob({} as never, "/dest", "Copy");
    emit({ jobId: "job-1", phase: "running", fraction: 0.25, label: "Copying clip.mov", itemIndex: 1, itemCount: 4 });
    const running = backgroundTasks.getSnapshot().find((t) => t.id === "project-manager:job-1");
    expect(running).toMatchObject({ status: "running", progress: 0.25, source: "project-manager" });
    expect(running?.can.cancel).toBe(true);
    emit({ jobId: "job-1", phase: "error", fraction: 0.25, label: "Failed", itemIndex: 1, itemCount: 4, error: "Disk full" });
    const failed = backgroundTasks.getSnapshot().find((t) => t.id === "project-manager:job-1");
    expect(failed).toMatchObject({ status: "failed", error: "Disk full" });
    expect(failed?.can.retry).toBe(true);
    backgroundTasks.retry("project-manager:job-1");
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });
});
