import fs from "node:fs";
import path from "node:path";
import type { WatchExportPresetId } from "../../shared/watch-folders";
import { WATCH_PRESETS, extensionOf, isWatchPresetId, uniquePath } from "./render";
import type { FolderContext, IngestOutcome } from "./manager";

/**
 * The parts of watch folders that run through the editor window: ingest (import into the open project)
 * and project-file export (the editor's export queue). Both call the same agent tools the MCP server
 * exposes, so imports are undoable actions in the open project and exports use the real export queue.
 */

export interface ToolResultLike {
  ok: boolean;
  summary?: string;
  data?: unknown;
  error?: { code?: string; message?: string; hint?: string };
}

export interface ToolCaller {
  /** True when an editor window exists (no window is created just to look). */
  hasEditor(): boolean;
  call(name: string, args: Record<string, unknown>): Promise<ToolResultLike>;
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const failureText = (result: ToolResultLike): string => result.error?.message ?? result.summary ?? "The editor refused the request.";
const noProject = (result: ToolResultLike): boolean => result.error?.code === "NO_PROJECT";

/** Finds the bin by name (case-insensitive) or creates it. Returns the bin id, or null when no project is open. */
export async function ensureBin(caller: ToolCaller, name: string): Promise<string | null> {
  const listed = await caller.call("list_bins", {});
  if (!listed.ok) {
    if (noProject(listed)) return null;
    throw new Error(failureText(listed));
  }
  const bins = (asRecord(listed.data).bins as Array<Record<string, unknown>> | undefined) ?? [];
  const wanted = name.trim().toLowerCase();
  const match = bins.find((bin) => typeof bin.name === "string" && bin.name.toLowerCase() === wanted && !bin.parentId);
  if (match && typeof match.id === "string") return match.id;
  const created = await caller.call("create_bin", { name: name.trim() });
  if (!created.ok) {
    if (noProject(created)) return null;
    throw new Error(failureText(created));
  }
  const id = asRecord(created.data).binId;
  if (typeof id !== "string") throw new Error("The editor did not report the new bin.");
  return id;
}

export async function ingestIntoOpenProject(caller: ToolCaller, context: FolderContext): Promise<IngestOutcome> {
  const { folder, file } = context;
  if (!caller.hasEditor()) return { outcome: "waiting", detail: "Waiting for the editor window" };
  let binId: string | null | undefined;
  if (folder.bin.trim()) {
    binId = await ensureBin(caller, folder.bin);
    if (binId === null) return { outcome: "waiting", detail: "Waiting for a project to be open" };
  }
  const result = await caller.call("import_media_from_path", {
    paths: [file.path],
    ...(binId ? { bin: binId } : {}),
    ...(folder.createProxies ? { createProxies: true } : {}),
  });
  if (!result.ok) {
    if (noProject(result)) return { outcome: "waiting", detail: "Waiting for a project to be open" };
    throw new Error(failureText(result));
  }
  const imported = (asRecord(result.data).imported as unknown[] | undefined) ?? [];
  if (imported.length === 0) throw new Error("The editor did not import the file.");
  const where = folder.bin.trim() ? ` into "${folder.bin.trim()}"` : "";
  return { outcome: "imported", detail: `Imported${where}${folder.createProxies ? " (proxies queued)" : ""}` };
}

/** Directories of the media paths a project file records (tolerant of the file's wrapper shape). */
export function recordedMediaDirs(content: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return [];
  }
  const dirs = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    const source = record.sourceFile;
    if (source && typeof source === "object") {
      const p = (source as Record<string, unknown>).path;
      if (typeof p === "string" && path.isAbsolute(p)) dirs.add(path.dirname(p));
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(root, 0);
  return [...dirs];
}

/**
 * A reopened project has its media offline (the file stores references, not the footage). Searches the
 * folders the project recorded and the folder the project file sits in, so footage dropped beside the
 * project is found too. Best effort: anything still offline is reported by the export itself.
 */
async function relinkOfflineMedia(caller: ToolCaller, projectPath: string): Promise<void> {
  const folders: string[] = [];
  try {
    folders.push(...recordedMediaDirs(await fs.promises.readFile(projectPath, "utf8")));
  } catch {
    /* unreadable here: the editor already opened it */
  }
  folders.push(path.dirname(projectPath));
  for (const folder of [...new Set(folders)]) {
    await caller.call("relink_media", { folder }).catch(() => undefined);
  }
}

export interface ProjectRenderDeps {
  sleep(ms: number): Promise<void>;
  pollMs: number;
  timeoutMs: number;
}

const defaultProjectDeps: ProjectRenderDeps = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs: 1000, timeoutMs: 6 * 60 * 60 * 1000 };

/**
 * Renders a `.oreel` / `.openreel` project through the editor's export queue: open it in the editor
 * (the project that was open is saved first), queue an export with the folder's preset, and wait for the
 * queue job. The output lands in the folder's output directory.
 */
export async function renderProjectViaEditor(
  caller: ToolCaller,
  context: FolderContext & { onProgress(fraction: number | null): void },
  deps: ProjectRenderDeps = defaultProjectDeps,
): Promise<{ outputPath: string }> {
  const { folder, file, signal } = context;
  if (!isWatchPresetId(folder.presetId) || WATCH_PRESETS[folder.presetId as WatchExportPresetId].kind !== "video") {
    throw new Error("Project files need a video preset; the audio-only preset cannot render a project.");
  }
  const opened = await caller.call("open_project_file", { path: file.path });
  if (!opened.ok) throw new Error(failureText(opened));
  const base = path.basename(file.path, `.${extensionOf(file.path)}`);
  // The editor's export path guard requires an existing destination folder.
  await fs.promises.mkdir(folder.outputDir, { recursive: true });
  const outputPath = uniquePath(folder.outputDir, base, "mp4");
  const runExport = async (): Promise<{ outputPath: string }> => {
    const queued = await caller.call("queue_export", { presetId: folder.presetId, outputPath, overwrite: false, start: true });
    if (!queued.ok) throw new Error(failureText(queued));
    const jobId = asRecord(queued.data).jobId;
    if (typeof jobId !== "string") throw new Error("The editor did not report the export job.");
    const deadline = Date.now() + deps.timeoutMs;
    for (;;) {
      if (signal.aborted) {
        await caller.call("cancel_export_job", { jobId }).catch(() => undefined);
        throw new Error("Cancelled");
      }
      if (Date.now() > deadline) throw new Error("The export did not finish in time.");
      const listed = await caller.call("list_export_jobs", {});
      const jobs = (asRecord(listed.data).jobs as Array<Record<string, unknown>> | undefined) ?? [];
      const job = jobs.find((entry) => entry.id === jobId);
      if (!job) throw new Error("The export job disappeared from the queue.");
      if (typeof job.progress === "number") context.onProgress(job.progress);
      if (job.status === "completed") {
        const placed = typeof job.outputPath === "string" ? job.outputPath : outputPath;
        return { outputPath: placed };
      }
      if (job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") {
        throw new Error(typeof job.error === "string" && job.error ? job.error : `The export ${String(job.status)}.`);
      }
      await deps.sleep(deps.pollMs);
    }
  };
  // A reopened project has its media offline (the file stores references, not the footage). The editor
  // reconnects remembered paths on its own; the folders searched on the second try cover the rest. The
  // export itself reports offline media, so retry only on that and let anything else fail at once.
  for (let attempt = 0; ; attempt++) {
    try {
      return await runExport();
    } catch (error) {
      if (attempt >= 4 || !/relink the original media/i.test(error instanceof Error ? error.message : "")) throw error;
      if (attempt === 1) await relinkOfflineMedia(caller, file.path);
      await deps.sleep(deps.pollMs * 2);
    }
  }
}
