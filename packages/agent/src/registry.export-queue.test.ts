import { describe, it, expect } from "vitest";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeEmptyProject } from "./test-fixtures";
import type {
  EditingHost,
  ExportQueueBridge,
  ExportQueueJobInfo,
  QueueExportRequest,
} from "./host";

function hostWithQueue(): { host: EditingHost; requests: QueueExportRequest[]; jobs: ExportQueueJobInfo[] } {
  const base = new HeadlessHost(makeEmptyProject());
  const requests: QueueExportRequest[] = [];
  const jobs: ExportQueueJobInfo[] = [];
  const bridge: ExportQueueBridge = {
    enqueue: async (request) => {
      requests.push(request);
      const job: ExportQueueJobInfo = {
        id: `job-${jobs.length + 1}`,
        outputName: request.filename ?? "Project.mp4",
        sequenceName: "Project",
        presetLabel: request.preset ?? "Custom",
        status: request.start === false ? "queued" : "running",
        progress: 0,
        elapsedMs: 0,
        usePreviews: request.usePreviews ?? true,
      };
      jobs.push(job);
      return job;
    },
    list: () => jobs,
    cancel: (jobId) => {
      const index = jobs.findIndex((job) => job.id === jobId);
      if (index < 0) return { found: false };
      jobs[index] = { ...jobs[index], status: "cancelled" };
      return { found: true, status: "cancelled" };
    },
  };
  return { host: Object.assign(base, { exportQueue: bridge }), requests, jobs };
}

describe("export queue tools", () => {
  it("registers the three tools with the right flags", () => {
    expect(getTool("queue_export")?.expensive).toBe(true);
    expect(getTool("queue_export")?.readOnly).toBe(false);
    expect(getTool("list_export_jobs")?.readOnly).toBe(true);
    expect(getTool("cancel_export_job")?.readOnly).toBe(false);
  });

  for (const [name, args] of [
    ["queue_export", {}],
    ["list_export_jobs", {}],
    ["cancel_export_job", { jobId: "x" }],
  ] as Array<[string, Record<string, unknown>]>) {
    it(`${name} fails gracefully without the capability`, async () => {
      const result = await executeTool(name, args, new HeadlessHost(makeEmptyProject()));
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("UNSUPPORTED");
      expect(result.summary.toLowerCase()).toContain("export queue");
    });
  }

  it("queues, lists and cancels through the bridge", async () => {
    const { host, requests } = hostWithQueue();
    const queued = await executeTool(
      "queue_export",
      { preset: "1080p-high", rangeStart: 1, rangeEnd: 3, usePreviews: false, filename: "Cut A" },
      host,
    );
    expect(queued.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      preset: "1080p-high",
      rangeStart: 1,
      rangeEnd: 3,
      usePreviews: false,
      filename: "Cut A",
      start: true,
    });
    const jobId = (queued.data as { jobId: string }).jobId;

    const second = await executeTool("queue_export", { format: "webm", codec: "vp9", start: false }, host);
    expect(second.ok).toBe(true);
    expect(requests[1].start).toBe(false);

    const listed = await executeTool("list_export_jobs", {}, host);
    expect((listed.data as { jobs: ExportQueueJobInfo[] }).jobs).toHaveLength(2);

    const cancelled = await executeTool("cancel_export_job", { jobId }, host);
    expect(cancelled.ok).toBe(true);
    const after = await executeTool("list_export_jobs", {}, host);
    expect((after.data as { jobs: ExportQueueJobInfo[] }).jobs[0].status).toBe("cancelled");

    const missing = await executeTool("cancel_export_job", { jobId: "nope" }, host);
    expect(missing.ok).toBe(false);
    expect(missing.error?.code).toBe("NOT_FOUND");
  });

  it("validates arguments before queueing", async () => {
    const { host, requests } = hostWithQueue();
    const half = await executeTool("queue_export", { rangeStart: 1 }, host);
    expect(half.error?.code).toBe("INVALID_PARAMS");
    const backwards = await executeTool("queue_export", { rangeStart: 5, rangeEnd: 2 }, host);
    expect(backwards.error?.code).toBe("INVALID_PARAMS");
    const badFormat = await executeTool("queue_export", { format: "avi" }, host);
    expect(badFormat.error?.code).toBe("INVALID_PARAMS");
    const badSize = await executeTool("queue_export", { width: -4 }, host);
    expect(badSize.error?.code).toBe("INVALID_PARAMS");
    const noId = await executeTool("cancel_export_job", {}, host);
    expect(noId.error?.code).toBe("INVALID_PARAMS");
    expect(requests).toHaveLength(0);
  });
});

describe("queue_export captions", () => {
  it("passes per-track burn-in and embedded settings through", async () => {
    const { host, requests } = hostWithQueue();
    const result = await executeTool(
      "queue_export",
      { format: "mov", captions: [{ captionTrackId: "", burnIn: false, embedded: "cea608" }, { captionTrackId: "es", embedded: "subtitle" }] },
      host,
    );
    expect(result.ok, result.summary).toBe(true);
    expect(requests[0].captions).toEqual([
      { captionTrackId: "", burnIn: false, embedded: "cea608" },
      { captionTrackId: "es", embedded: "subtitle" },
    ]);
  });

  it("rejects malformed caption settings", async () => {
    const { host, requests } = hostWithQueue();
    expect((await executeTool("queue_export", { captions: [{ burnIn: true }] }, host)).error?.code).toBe("INVALID_PARAMS");
    expect((await executeTool("queue_export", { captions: [{ captionTrackId: "", embedded: "sei" }] }, host)).error?.code).toBe("INVALID_PARAMS");
    expect(requests).toHaveLength(0);
  });
});
