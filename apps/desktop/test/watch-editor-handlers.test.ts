import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WatchFolderConfig } from "../src/shared/watch-folders";
import { recordedMediaDirs, ensureBin, ingestIntoOpenProject, renderProjectViaEditor, type ToolCaller, type ToolResultLike } from "../src/main/watch/editor-handlers";

const folder = (extra: Partial<WatchFolderConfig> = {}): WatchFolderConfig => ({
  id: "f1", kind: "ingest", path: "/watch", paused: false, bin: "Cards", createProxies: false, presetId: "1080p-high", outputDir: "/out", includeProjects: true, baselined: true, processExisting: false, ...extra,
});
const file = { path: "/watch/a.mp4", name: "a.mp4", size: 10, mtimeMs: 1 };
const signal = new AbortController().signal;

function caller(handler: (name: string, args: Record<string, unknown>) => ToolResultLike, hasEditor = true): ToolCaller & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { calls, hasEditor: () => hasEditor, call: async (name, args) => (calls.push({ name, args }), handler(name, args)) };
}
const NO_PROJECT: ToolResultLike = { ok: false, error: { code: "NO_PROJECT", message: "No project is open" } };

describe("ensureBin", () => {
  it("reuses a top-level bin by name, case-insensitively", async () => {
    const c = caller(() => ({ ok: true, data: { bins: [{ id: "b1", name: "cards" }, { id: "b2", name: "Cards", parentId: "b1" }] } }));
    expect(await ensureBin(c, "Cards")).toBe("b1");
    expect(c.calls.map((x) => x.name)).toEqual(["list_bins"]);
  });
  it("creates the bin when it is missing", async () => {
    const c = caller((name) => (name === "list_bins" ? { ok: true, data: { bins: [] } } : { ok: true, data: { binId: "new" } }));
    expect(await ensureBin(c, " Cards ")).toBe("new");
    expect(c.calls[1]).toEqual({ name: "create_bin", args: { name: "Cards" } });
  });
  it("returns null when no project is open", async () => {
    expect(await ensureBin(caller(() => NO_PROJECT), "Cards")).toBeNull();
  });
});

describe("ingestIntoOpenProject", () => {
  it("imports into the bin with proxies when asked", async () => {
    const c = caller((name) => {
      if (name === "list_bins") return { ok: true, data: { bins: [{ id: "b1", name: "Cards" }] } };
      return { ok: true, data: { imported: [{ mediaId: "m1" }] } };
    });
    const result = await ingestIntoOpenProject(c, { folder: folder({ createProxies: true }), file, signal });
    expect(result).toEqual({ outcome: "imported", detail: 'Imported into "Cards" (proxies queued)' });
    expect(c.calls.at(-1)).toEqual({ name: "import_media_from_path", args: { paths: ["/watch/a.mp4"], bin: "b1", createProxies: true } });
  });

  it("imports to the project root when no bin is configured", async () => {
    const c = caller(() => ({ ok: true, data: { imported: [{ mediaId: "m1" }] } }));
    await ingestIntoOpenProject(c, { folder: folder({ bin: "" }), file, signal });
    expect(c.calls).toEqual([{ name: "import_media_from_path", args: { paths: ["/watch/a.mp4"] } }]);
  });

  it("waits instead of failing when there is no editor window or no open project", async () => {
    expect(await ingestIntoOpenProject(caller(() => ({ ok: true }), false), { folder: folder(), file, signal })).toMatchObject({ outcome: "waiting" });
    expect(await ingestIntoOpenProject(caller(() => NO_PROJECT), { folder: folder(), file, signal })).toMatchObject({ outcome: "waiting" });
    const c = caller((name) => (name === "list_bins" ? { ok: true, data: { bins: [{ id: "b", name: "Cards" }] } } : NO_PROJECT));
    expect(await ingestIntoOpenProject(c, { folder: folder(), file, signal })).toMatchObject({ outcome: "waiting" });
  });

  it("fails with the editor's reason when the import is refused", async () => {
    const c = caller((name) => (name === "list_bins" ? { ok: true, data: { bins: [{ id: "b", name: "Cards" }] } } : { ok: false, error: { code: "UNSUPPORTED_TYPE", message: "OpenReel could not decode this file." } }));
    await expect(ingestIntoOpenProject(c, { folder: folder(), file, signal })).rejects.toThrow("could not decode");
  });
});

describe("renderProjectViaEditor", () => {
  const deps = { sleep: async () => undefined, pollMs: 0, timeoutMs: 60_000 };
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "watch-handlers-"));
  const projectFolder = folder({ kind: "export", outputDir: out });
  const projectFile = { path: "/watch/cut.oreel", name: "cut.oreel", size: 10, mtimeMs: 1 };

  it("opens the project, queues the export with the preset and waits for the queue job", async () => {
    let polls = 0;
    const progress: Array<number | null> = [];
    const c = caller((name) => {
      if (name === "open_project_file") return { ok: true, data: { name: "cut" } };
      if (name === "queue_export") return { ok: true, data: { jobId: "j1" } };
      polls++;
      return { ok: true, data: { jobs: [{ id: "j1", status: polls < 3 ? "running" : "completed", progress: polls / 3, outputPath: path.join(out, "cut.mp4") }] } };
    });
    const result = await renderProjectViaEditor(c, { folder: projectFolder, file: projectFile, signal, onProgress: (f) => progress.push(f) }, deps);
    expect(result).toEqual({ outputPath: path.join(out, "cut.mp4") });
    expect(fs.existsSync(out)).toBe(true);
    expect(c.calls[0]).toEqual({ name: "open_project_file", args: { path: "/watch/cut.oreel" } });
    expect(c.calls[1]).toMatchObject({ name: "queue_export", args: { presetId: "1080p-high", overwrite: false, start: true } });
    expect((c.calls[1].args.outputPath as string).endsWith("cut.mp4")).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("searches for offline media and retries the export when the editor reports it offline", async () => {
    let queues = 0;
    const c = caller((name) => {
      if (name === "open_project_file") return { ok: true };
      if (name === "relink_media") return { ok: true };
      if (name === "queue_export") return ++queues < 3 ? { ok: false, error: { message: "Relink the original media before exporting: a.mp4" } } : { ok: true, data: { jobId: "j2" } };
      return { ok: true, data: { jobs: [{ id: "j2", status: "completed", outputPath: path.join(out, "cut.mp4") }] } };
    });
    await renderProjectViaEditor(c, { folder: projectFolder, file: projectFile, signal, onProgress: () => undefined }, deps);
    expect(c.calls.filter((call) => call.name === "relink_media").map((call) => call.args)).toEqual([{ folder: "/watch" }]);
    expect(queues).toBe(3);
    // An offline-media failure reported by the queue job (not the queue call) retries the same way.
    let jobRuns = 0;
    const viaJob = caller((name) => {
      if (name === "queue_export") return { ok: true, data: { jobId: `j${++jobRuns}` } };
      if (name === "list_export_jobs") return { ok: true, data: { jobs: [{ id: `j${jobRuns}`, status: jobRuns < 2 ? "failed" : "completed", error: "Relink the original media before exporting: a.mp4", outputPath: path.join(out, "cut.mp4") }] } };
      return { ok: true };
    });
    await renderProjectViaEditor(viaJob, { folder: projectFolder, file: projectFile, signal, onProgress: () => undefined }, deps);
    expect(jobRuns).toBe(2);
    const stuck = caller((name) => (name === "queue_export" ? { ok: false, error: { message: "Relink the original media before exporting: a.mp4" } } : { ok: true }));
    await expect(renderProjectViaEditor(stuck, { folder: projectFolder, file: projectFile, signal, onProgress: () => undefined }, deps)).rejects.toThrow(/Relink the original media/);
  });

  it("fails with the job's error, and refuses the audio-only preset", async () => {
    const failing = caller((name) => {
      if (name === "open_project_file") return { ok: true };
      if (name === "queue_export") return { ok: true, data: { jobId: "j1" } };
      return { ok: true, data: { jobs: [{ id: "j1", status: "failed", error: "Encoder failed" }] } };
    });
    await expect(renderProjectViaEditor(failing, { folder: projectFolder, file: projectFile, signal, onProgress: () => undefined }, deps)).rejects.toThrow("Encoder failed");
    await expect(renderProjectViaEditor(caller(() => ({ ok: true })), { folder: folder({ kind: "export", presetId: "wav", outputDir: out }), file: projectFile, signal, onProgress: () => undefined }, deps)).rejects.toThrow(/video preset/);
  });

  it("surfaces a project that will not open", async () => {
    const c = caller(() => ({ ok: false, error: { code: "UNREADABLE", message: "Not a valid project file" } }));
    await expect(renderProjectViaEditor(c, { folder: projectFolder, file: projectFile, signal, onProgress: () => undefined }, deps)).rejects.toThrow("Not a valid project file");
  });

  it("cancels the queue job when aborted", async () => {
    const controller = new AbortController();
    const c = caller((name) => {
      if (name === "open_project_file") return { ok: true };
      if (name === "queue_export") return { ok: true, data: { jobId: "j9" } };
      if (name === "list_export_jobs") {
        controller.abort();
        return { ok: true, data: { jobs: [{ id: "j9", status: "running", progress: 0.1 }] } };
      }
      return { ok: true };
    });
    await expect(renderProjectViaEditor(c, { folder: projectFolder, file: projectFile, signal: controller.signal, onProgress: () => undefined }, deps)).rejects.toThrow("Cancelled");
    expect(c.calls.at(-1)).toEqual({ name: "cancel_export_job", args: { jobId: "j9" } });
  });
});

describe("recordedMediaDirs", () => {
  it("collects the folders of the media paths a project records, wherever the wrapper puts them", () => {
    const project = { project: { mediaLibrary: { items: [{ sourceFile: { path: "/Volumes/A/clips/a.mp4" } }, { sourceFile: { path: "/Volumes/A/clips/b.mp4" } }, { sourceFile: { path: "relative.mp4" } }, { sourceFile: {} }] } } };
    expect(recordedMediaDirs(JSON.stringify(project))).toEqual(["/Volumes/A/clips"]);
    expect(recordedMediaDirs("not json")).toEqual([]);
  });
});
