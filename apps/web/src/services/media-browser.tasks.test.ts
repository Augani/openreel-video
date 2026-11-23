import { beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";

const importMedia = vi.fn();
vi.mock("../stores/project-store", () => ({ useProjectStore: { getState: () => ({ importMedia }) } }));
vi.mock("../stores/source-monitor-store", () => ({ useSourceMonitorStore: { getState: () => ({}) } }));
vi.mock("../stores/notification-store", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("./native-decode", () => ({ rememberNativePath: vi.fn() }));
vi.mock("./media-metadata-commands", () => ({ setMediaMetadata: vi.fn(async () => undefined) }));

import { importEntries } from "./media-browser";

const entry = (name: string) => ({ kind: "file", name, path: `/cards/${name}`, mtimeMs: 1, size: 3 }) as never;
const rows = () => backgroundTasks.getSnapshot().filter((t) => t.source === "media-browser");

beforeEach(() => {
  backgroundTasks.clearFinished();
  importMedia.mockReset();
  (window as unknown as { openreel: unknown }).openreel = {
    platform: "desktop",
    mediaBrowser: { prepareImport: async ({ clip }: { clip: { name: string } }) => ({ path: `/cards/${clip.name}`, name: clip.name }), readXmp: async () => null },
    ingest: { stat: async () => ({}) },
    fs: { readFileBytes: async () => new Uint8Array([1, 2, 3]) },
  };
});

describe("Media Browser ingest task", () => {
  it("reports one batch row that completes with every clip imported", async () => {
    importMedia.mockResolvedValue({ success: true, actionId: "m" });
    const report = await importEntries([entry("a.mp4"), entry("b.mp4")]);
    expect(report.imported).toBe(2);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ status: "completed", title: expect.stringContaining("2 clips") });
  });

  it("fails the row when every clip fails, and Retry re-runs only the failed entries", async () => {
    importMedia.mockResolvedValue({ success: false, error: { message: "Unsupported container" } });
    const report = await importEntries([entry("a.mp4")]);
    expect(report.failed[0].reason).toBe("Unsupported container");
    const [row] = rows();
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Unsupported container");
    expect(row.can.retry).toBe(true);

    importMedia.mockResolvedValue({ success: true, actionId: "m" });
    backgroundTasks.retry(row.id);
    await vi.waitFor(() => expect(rows().some((t) => t.status === "completed")).toBe(true));
    expect(importMedia).toHaveBeenCalledTimes(2);
  });

  it("a partial failure keeps the row completed and still reports the failure", async () => {
    importMedia.mockResolvedValueOnce({ success: true, actionId: "m" }).mockResolvedValueOnce({ success: false, error: { message: "bad" } });
    const report = await importEntries([entry("a.mp4"), entry("b.mp4")]);
    expect(report).toMatchObject({ imported: 1, failed: [{ name: "b.mp4" }] });
    expect(rows()[0].status).toBe("completed");
    expect(rows()[0].detail).toContain("1 failed");
  });

  it("Cancel stops before the next clip", async () => {
    let release: () => void = () => undefined;
    importMedia.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ success: true, actionId: "m" }); }));
    const pending = importEntries([entry("a.mp4"), entry("b.mp4")]);
    await vi.waitFor(() => expect(rows()[0]?.status).toBe("running"));
    expect(rows()[0].can.cancel).toBe(true);
    await vi.waitFor(() => expect(importMedia).toHaveBeenCalledTimes(1));
    backgroundTasks.cancel(rows()[0].id);
    release();
    const report = await pending;
    expect(report.imported).toBe(1);
    expect(importMedia).toHaveBeenCalledTimes(1);
    expect(rows()[0].status).toBe("cancelled");
  });
});
