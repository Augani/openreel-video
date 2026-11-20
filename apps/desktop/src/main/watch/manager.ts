import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  WATCH_EXPORT_PRESET_IDS,
  type WatchFolderConfig,
  type WatchFolderKind,
  type WatchFolderPatch,
  type WatchFolderState,
  type WatchFolderStatus,
  type WatchFoldersSnapshot,
  type WatchItem,
} from "../../shared/watch-folders";
import { MEDIA_EXTENSIONS } from "../mcp/path-guard";
import { FolderScanner, DEFAULT_SCANNER_OPTIONS, nodeScannerFs, type ScanFile, type ScannerFs, type ScannerOptions } from "./folder-scanner";
import { fingerprintFile, type Ledger } from "./ledger";
import { canonicalPath, samePath } from "./paths";
import { classifyFile, extensionOf, uniquePath } from "./render";

/**
 * Owns the configured watch folders: one scanner each, a job lane per kind (one ingest at a time, one
 * render at a time), duplicate detection through the ledger, and the `done/` / `failed/` bookkeeping of
 * export folders. Pure Node (the Electron pieces arrive through `handlers`), so it is unit-tested against
 * real temporary folders.
 *
 * Nothing here blocks the UI: scanning and hashing are async, renders run in ffmpeg child processes, and
 * ingest goes through the editor's own tool path one file at a time.
 */

export interface FolderContext {
  folder: WatchFolderConfig;
  file: ScanFile;
  signal: AbortSignal;
}

export type IngestOutcome = { outcome: "imported"; detail?: string } | { outcome: "waiting"; detail: string };

export interface WatchHandlers {
  ingest(context: FolderContext): Promise<IngestOutcome>;
  renderMedia(context: FolderContext & { onProgress(fraction: number | null): void }): Promise<{ outputPath: string }>;
  renderProject(context: FolderContext & { onProgress(fraction: number | null): void }): Promise<{ outputPath: string }>;
}

export interface ConfigStore {
  load(): WatchFolderConfig[];
  save(folders: WatchFolderConfig[]): void;
}

export interface ManagerOptions {
  scanner: ScannerOptions;
  /** How long an ingest that is waiting for an open project sleeps before it tries again. */
  retryWaitMs: number;
  maxItems: number;
  emitThrottleMs: number;
}

export const DEFAULT_MANAGER_OPTIONS: ManagerOptions = { scanner: DEFAULT_SCANNER_OPTIONS, retryWaitMs: 4000, maxItems: 200, emitThrottleMs: 120 };

export interface ManagerDeps {
  configStore: ConfigStore;
  ledger: Ledger;
  handlers: WatchHandlers;
  emit(snapshot: WatchFoldersSnapshot): void;
  /** Absolute paths agents/ingest may touch because of watch folders changed. */
  onRoots?(roots: string[]): void;
  options?: Partial<ManagerOptions>;
  scannerFs?: ScannerFs;
  fingerprint?: (file: string) => Promise<string>;
  now?: () => number;
}

interface Job {
  item: WatchItem;
  folderId: string;
  file: ScanFile;
  fingerprint: string;
  notBefore: number;
  controller: AbortController;
}

interface Runtime {
  scanner: FolderScanner | null;
  state: WatchFolderState;
  message?: string;
}

const DONE_DIR = "done";
const FAILED_DIR = "failed";

export class WatchFolderManager {
  private folders: WatchFolderConfig[] = [];
  private readonly runtime = new Map<string, Runtime>();
  private items: WatchItem[] = [];
  private readonly jobs: Job[] = [];
  private readonly lanes: Record<WatchFolderKind, { busy: boolean; current: Job | null }> = {
    ingest: { busy: false, current: null },
    export: { busy: false, current: null },
  };
  private readonly options: ManagerOptions;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly deps: ManagerDeps) {
    this.options = { ...DEFAULT_MANAGER_OPTIONS, ...deps.options, scanner: { ...DEFAULT_MANAGER_OPTIONS.scanner, ...deps.options?.scanner } };
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private get scannerFs(): ScannerFs {
    return this.deps.scannerFs ?? nodeScannerFs;
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.folders = this.deps.configStore.load();
    this.publishRoots();
    for (const folder of this.folders) void this.startFolder(folder);
    this.emitSoon();
  }

  stop(): void {
    this.stopped = true;
    for (const runtime of this.runtime.values()) runtime.scanner?.stop();
    this.runtime.clear();
    for (const job of this.jobs) job.controller.abort();
    for (const lane of Object.values(this.lanes)) lane.current?.controller.abort();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.pumpTimer = this.emitTimer = null;
    this.deps.ledger.flush();
  }

  // ---- configuration -------------------------------------------------------------------------

  list(): WatchFolderConfig[] {
    return this.folders.map((folder) => ({ ...folder }));
  }

  /** Adds a folder the user picked. Throws a readable message when it is not usable. */
  async add(kind: WatchFolderKind, folderPath: string, overrides: Partial<WatchFolderConfig> = {}): Promise<WatchFolderConfig> {
    if (!path.isAbsolute(folderPath)) throw new Error("Choose a folder.");
    const real = await canonicalPath(folderPath);
    const stat = real ? await fs.promises.stat(real).catch(() => null) : null;
    if (!real || !stat?.isDirectory()) throw new Error("That folder does not exist.");
    if (samePath(real, path.parse(real).root)) throw new Error("Choose a folder, not the whole drive.");
    const config: WatchFolderConfig = {
      id: randomUUID(),
      kind,
      path: real,
      paused: false,
      bin: kind === "ingest" ? "Watch folder" : "",
      createProxies: false,
      presetId: "1080p-high",
      outputDir: kind === "export" ? path.join(real, "output") : "",
      includeProjects: false,
      baselined: false,
      processExisting: false,
      ...overrides,
    };
    if (config.kind === "export" && config.outputDir && path.isAbsolute(config.outputDir)) config.outputDir = (await canonicalPath(config.outputDir)) ?? path.resolve(config.outputDir);
    this.assertUsable(config);
    this.folders = [...this.folders, config];
    this.persist();
    // Wait for the baseline: files that appear once add() has returned are never baselined away.
    await this.startFolder(config);
    return { ...config };
  }

  async update(id: string, patch: WatchFolderPatch): Promise<WatchFolderConfig> {
    const index = this.folders.findIndex((folder) => folder.id === id);
    if (index < 0) throw new Error("That watch folder no longer exists.");
    if (patch.presetId !== undefined && !(WATCH_EXPORT_PRESET_IDS as readonly string[]).includes(patch.presetId)) throw new Error("Unknown export preset.");
    const before = this.folders[index];
    const next: WatchFolderConfig = { ...before, ...patch };
    this.folders = this.folders.map((folder, i) => (i === index ? next : folder));
    this.persist();
    if (patch.paused !== undefined && patch.paused !== before.paused) {
      if (patch.paused) this.stopScanner(id, "paused");
      else void this.startFolder(next);
    }
    this.emitSoon();
    this.pumpSoon(0);
    return { ...next };
  }

  /** Changes where an export folder renders to (a path from the native folder dialog). */
  async setOutputDir(id: string, dir: string): Promise<WatchFolderConfig> {
    const folder = this.folders.find((entry) => entry.id === id);
    if (!folder || folder.kind !== "export") throw new Error("That watch folder no longer exists.");
    const real = await canonicalPath(dir);
    if (!real) throw new Error("That folder does not exist.");
    const next = { ...folder, outputDir: real };
    this.assertUsable(next, id);
    this.folders = this.folders.map((entry) => (entry.id === id ? next : entry));
    this.persist();
    this.emitSoon();
    return { ...next };
  }

  remove(id: string): void {
    this.stopScanner(id);
    this.runtime.delete(id);
    this.folders = this.folders.filter((folder) => folder.id !== id);
    for (const job of this.jobs.filter((entry) => entry.folderId === id)) job.controller.abort();
    this.removeJobs((job) => job.folderId === id);
    for (const lane of Object.values(this.lanes)) if (lane.current?.folderId === id) lane.current.controller.abort();
    this.items = this.items.filter((item) => item.folderId !== id);
    this.deps.ledger.dropFolder(id);
    this.persist();
    this.emitSoon();
  }

  /** Re-queues a failed item (its file is moved back out of failed/ for export folders). */
  async retry(itemId: string): Promise<void> {
    const item = this.items.find((entry) => entry.id === itemId);
    const folder = item && this.folders.find((entry) => entry.id === item.folderId);
    if (!item || !folder || item.state !== "failed") return;
    let source = item.path;
    if (!fs.existsSync(source)) {
      const failedCopy = path.join(folder.path, FAILED_DIR, path.basename(item.path));
      if (!fs.existsSync(failedCopy)) return;
      const back = uniquePath(folder.path, path.basename(item.path, path.extname(item.path)), extensionOf(item.path));
      await fs.promises.rename(failedCopy, back);
      await fs.promises.rm(`${failedCopy}.error.txt`, { force: true });
      source = back;
    }
    this.items = this.items.filter((entry) => entry.id !== itemId);
    this.runtime.get(folder.id)?.scanner?.forget(source);
    this.runtime.get(folder.id)?.scanner?.forget(item.path);
    void this.runtime.get(folder.id)?.scanner?.scan();
    this.emitSoon();
  }

  clearFinished(): void {
    this.items = this.items.filter((item) => !["done", "failed", "duplicate", "cancelled"].includes(item.state));
    this.emitSoon();
  }

  snapshot(): WatchFoldersSnapshot {
    return {
      folders: this.folders.map((config) => ({ config: { ...config }, status: this.statusOf(config) })),
      items: this.items.map((item) => ({ ...item })),
    };
  }

  // ---- validation ----------------------------------------------------------------------------

  private assertUsable(candidate: WatchFolderConfig, ignoreId?: string): void {
    const others = this.folders.filter((folder) => folder.id !== ignoreId && folder.id !== candidate.id);
    if (others.some((folder) => samePath(folder.path, candidate.path))) throw new Error("That folder is already being watched.");
    if (candidate.kind === "export") {
      if (!candidate.outputDir || !path.isAbsolute(candidate.outputDir)) throw new Error("Choose an output folder.");
      // The output may live inside the watched folder (files there are not rescanned: only the top level is watched).
      if (others.some((folder) => samePath(folder.path, candidate.outputDir))) throw new Error("The output folder is watched by another watch folder; rendered files would be picked up again.");
      if (samePath(candidate.outputDir, candidate.path)) throw new Error("Rendered files cannot go into the watched folder itself; pick a different output folder.");
    }
    for (const other of others) {
      if (other.kind === "export" && other.outputDir && samePath(other.outputDir, candidate.path)) throw new Error("That folder is the output of an export watch folder; watching it would re-process the rendered files.");
    }
  }

  private publishRoots(): void {
    const roots = new Set<string>();
    for (const folder of this.folders) {
      roots.add(folder.path);
      if (folder.kind === "export" && folder.outputDir) roots.add(folder.outputDir);
    }
    this.deps.onRoots?.([...roots]);
  }

  private persist(): void {
    this.deps.configStore.save(this.folders);
    this.publishRoots();
  }

  // ---- scanning ------------------------------------------------------------------------------

  private isRelevant(folder: WatchFolderConfig, file: string): boolean {
    if (folder.kind === "ingest") return MEDIA_EXTENSIONS.has(extensionOf(file));
    const kind = classifyFile(file);
    return kind === "video" || kind === "audio" || (kind === "project" && folder.includeProjects);
  }

  private stopScanner(id: string, state?: WatchFolderState): void {
    const runtime = this.runtime.get(id);
    runtime?.scanner?.stop();
    if (runtime) {
      runtime.scanner = null;
      if (state) runtime.state = state;
    }
    this.emitSoon();
  }

  private async startFolder(folder: WatchFolderConfig): Promise<void> {
    if (this.stopped) return;
    const runtime: Runtime = { scanner: null, state: folder.paused ? "paused" : "watching" };
    this.runtime.set(folder.id, runtime);
    if (folder.paused) {
      this.emitSoon();
      return;
    }
    const scanner = new FolderScanner(
      folder.path,
      {
        onSeen: (file) => this.onSeen(folder.id, file),
        onGone: (file) => this.onGone(folder.id, file),
        onReady: (file) => void this.onReady(folder.id, file),
        onUnreadable: (error) => {
          const entry = this.runtime.get(folder.id);
          if (entry) {
            entry.state = "missing";
            entry.message = error.code === "ENOENT" ? "The folder is missing or not mounted." : `The folder cannot be read (${error.code ?? "error"}).`;
          }
          this.emitSoon();
        },
        onReadable: () => {
          const entry = this.runtime.get(folder.id);
          if (entry) {
            entry.state = "watching";
            entry.message = undefined;
          }
          this.emitSoon();
        },
      },
      this.options.scanner,
      this.scannerFs,
    );
    runtime.scanner = scanner;
    const current = this.folders.find((entry) => entry.id === folder.id) ?? folder;
    if (!current.baselined) {
      await this.baseline(current, scanner).catch(() => undefined);
      if (this.stopped || this.runtime.get(folder.id)?.scanner !== scanner) return;
    }
    scanner.start();
    this.emitSoon();
  }

  /** Records what is already in a newly added folder so only files that arrive later are processed. */
  private async baseline(folder: WatchFolderConfig, scanner: FolderScanner): Promise<void> {
    if (!folder.processExisting) {
      let entries: Array<{ name: string; isFile: boolean }> = [];
      try {
        entries = await this.scannerFs.readdir(folder.path);
      } catch {
        return; // unreadable now: baseline on the next start
      }
      for (const entry of entries) {
        if (!entry.isFile) continue;
        const full = path.join(folder.path, entry.name);
        if (!this.isRelevant(folder, full)) continue;
        const stat = await this.scannerFs.stat(full);
        if (!stat) continue;
        try {
          const fingerprint = await (this.deps.fingerprint ?? fingerprintFile)(full);
          this.deps.ledger.record(folder.id, fingerprint, { name: entry.name, at: this.now(), outcome: "baseline" });
        } catch {
          /* unreadable file: it is simply not recorded */
        }
        scanner.markReported({ path: full, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
    this.folders = this.folders.map((entry) => (entry.id === folder.id ? { ...entry, baselined: true } : entry));
    this.persist();
  }

  private newItem(folder: WatchFolderConfig, file: ScanFile): WatchItem {
    const item: WatchItem = { id: randomUUID(), folderId: folder.id, name: file.name, path: file.path, state: "detecting", progress: null, createdAt: this.now(), detail: "Waiting for the file to finish copying" };
    this.items = [item, ...this.items].slice(0, this.options.maxItems);
    return item;
  }

  private onSeen(folderId: string, file: ScanFile): void {
    const folder = this.folders.find((entry) => entry.id === folderId);
    if (!folder || !this.isRelevant(folder, file.path)) return;
    const existing = this.items.find((item) => item.path === file.path && item.state === "detecting");
    if (existing) {
      existing.detail = "Waiting for the file to finish copying";
    } else {
      this.newItem(folder, file);
    }
    this.emitSoon();
  }

  private onGone(folderId: string, filePath: string): void {
    const item = this.items.find((entry) => entry.folderId === folderId && entry.path === filePath && entry.state === "detecting");
    if (item) this.items = this.items.filter((entry) => entry !== item);
    this.emitSoon();
  }

  private async onReady(folderId: string, file: ScanFile): Promise<void> {
    const folder = this.folders.find((entry) => entry.id === folderId);
    if (!folder || this.stopped || !this.isRelevant(folder, file.path)) return;
    const item = this.items.find((entry) => entry.folderId === folderId && entry.path === file.path && entry.state === "detecting") ?? this.newItem(folder, file);
    let fingerprint: string;
    try {
      fingerprint = await (this.deps.fingerprint ?? fingerprintFile)(file.path);
    } catch (error) {
      this.finish(item, "failed", { error: `Could not read the file: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const seen = this.deps.ledger.has(folder.id, fingerprint);
    if (seen) {
      if (folder.kind === "ingest" && seen.name === file.name) {
        // The same file seen again (restart, touched): nothing to report.
        this.items = this.items.filter((entry) => entry !== item);
        this.emitSoon();
        return;
      }
      if (folder.kind === "export") await this.moveAside(folder, file.path, DONE_DIR);
      this.finish(item, "duplicate", { detail: `Same content as "${seen.name}" handled earlier${folder.kind === "export" ? "; moved to done" : ""}` });
      return;
    }
    // Same content already queued or running under another name: do not render it twice.
    const dup = this.jobs.find((job) => job.folderId === folder.id && job.fingerprint === fingerprint) ?? Object.values(this.lanes).map((lane) => lane.current).find((job) => job && job.folderId === folder.id && job.fingerprint === fingerprint);
    if (dup) {
      this.finish(item, "duplicate", { detail: `Same content as "${dup.file.name}", which is already queued` });
      return;
    }
    item.state = "queued";
    item.detail = folder.paused ? "Folder paused" : undefined;
    this.jobs.push({ item, folderId: folder.id, file, fingerprint, notBefore: 0, controller: new AbortController() });
    this.emitSoon();
    this.pumpSoon(0);
  }

  // ---- job lanes -----------------------------------------------------------------------------

  private pumpSoon(delayMs: number): void {
    if (this.stopped) return;
    if (this.pumpTimer && delayMs > 0) return;
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      for (const kind of ["ingest", "export"] as const) void this.pump(kind);
    }, delayMs);
    this.pumpTimer.unref?.();
  }

  private removeJobs(predicate: (job: Job) => boolean): void {
    for (let i = this.jobs.length - 1; i >= 0; i--) if (predicate(this.jobs[i])) this.jobs.splice(i, 1);
  }

  private async pump(kind: WatchFolderKind): Promise<void> {
    const lane = this.lanes[kind];
    if (lane.busy || this.stopped) return;
    const now = this.now();
    const index = this.jobs.findIndex((job) => {
      const folder = this.folders.find((entry) => entry.id === job.folderId);
      return folder?.kind === kind && !folder.paused && job.notBefore <= now;
    });
    if (index < 0) {
      const waiting = this.jobs.filter((job) => this.folders.find((entry) => entry.id === job.folderId)?.kind === kind && job.notBefore > now);
      if (waiting.length) this.pumpSoon(Math.max(50, Math.min(...waiting.map((job) => job.notBefore)) - now));
      return;
    }
    const [job] = this.jobs.splice(index, 1);
    const folder = this.folders.find((entry) => entry.id === job.folderId);
    if (!folder) return;
    lane.busy = true;
    lane.current = job;
    job.item.state = "running";
    job.item.startedAt = job.item.startedAt ?? this.now();
    job.item.detail = kind === "ingest" ? "Importing" : "Rendering";
    this.emitSoon();
    try {
      await this.runJob(folder, job);
    } catch (error) {
      this.finish(job.item, "failed", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      lane.busy = false;
      lane.current = null;
      this.pumpSoon(0);
    }
  }

  private async runJob(folder: WatchFolderConfig, job: Job): Promise<void> {
    const context: FolderContext = { folder, file: job.file, signal: job.controller.signal };
    if (folder.kind === "ingest") {
      const result = await this.deps.handlers.ingest(context);
      if (job.controller.signal.aborted) return this.finish(job.item, "cancelled", {});
      if (result.outcome === "waiting") {
        job.item.state = "waiting";
        job.item.detail = result.detail;
        job.notBefore = this.now() + this.options.retryWaitMs;
        this.jobs.push(job);
        this.emitSoon();
        return;
      }
      this.deps.ledger.record(folder.id, job.fingerprint, { name: job.file.name, at: this.now(), outcome: "imported" });
      return this.finish(job.item, "done", { detail: result.detail ?? "Imported" });
    }
    const onProgress = (fraction: number | null): void => {
      job.item.progress = fraction;
      this.emitSoon();
    };
    try {
      const kind = classifyFile(job.file.path);
      const { outputPath } = kind === "project" ? await this.deps.handlers.renderProject({ ...context, onProgress }) : await this.deps.handlers.renderMedia({ ...context, onProgress });
      this.deps.ledger.record(folder.id, job.fingerprint, { name: job.file.name, at: this.now(), outcome: "rendered" });
      await this.moveAside(folder, job.file.path, DONE_DIR);
      this.finish(job.item, "done", { outputPath, detail: `Rendered to ${path.basename(outputPath)}` });
    } catch (error) {
      if (job.controller.signal.aborted) return this.finish(job.item, "cancelled", {});
      const message = error instanceof Error ? error.message : String(error);
      await this.moveAside(folder, job.file.path, FAILED_DIR, message);
      this.finish(job.item, "failed", { error: message, detail: "Moved to failed" });
    }
  }

  /** Moves a processed export source into `<watch>/done` or `<watch>/failed` (never overwrites). */
  private async moveAside(folder: WatchFolderConfig, file: string, sub: typeof DONE_DIR | typeof FAILED_DIR, errorText?: string): Promise<void> {
    try {
      const dir = path.join(folder.path, sub);
      await fs.promises.mkdir(dir, { recursive: true });
      const ext = extensionOf(file);
      const target = uniquePath(dir, path.basename(file, path.extname(file)), ext);
      await fs.promises.rename(file, target);
      if (errorText) await fs.promises.writeFile(`${target}.error.txt`, `${errorText}\n`, "utf8");
    } catch {
      // The source stays where it is; the ledger / failed item keeps it from being processed again.
    }
  }

  private finish(item: WatchItem, state: WatchItem["state"], extra: { error?: string; detail?: string; outputPath?: string }): void {
    item.state = state;
    item.progress = state === "done" ? 1 : item.progress;
    item.finishedAt = this.now();
    if (extra.error !== undefined) item.error = extra.error;
    if (extra.detail !== undefined) item.detail = extra.detail;
    else if (state === "failed") item.detail = undefined;
    if (extra.outputPath) item.outputPath = extra.outputPath;
    this.emitSoon();
  }

  // ---- status --------------------------------------------------------------------------------

  private statusOf(config: WatchFolderConfig): WatchFolderStatus {
    const runtime = this.runtime.get(config.id);
    const mine = this.items.filter((item) => item.folderId === config.id);
    const count = (...states: WatchItem["state"][]): number => mine.filter((item) => states.includes(item.state)).length;
    return {
      state: config.paused ? "paused" : (runtime?.state ?? "watching"),
      ...(runtime?.message ? { message: runtime.message } : {}),
      detecting: count("detecting"),
      queued: count("queued", "waiting"),
      running: count("running"),
      done: count("done"),
      failed: count("failed"),
      duplicates: count("duplicate"),
    };
  }

  private emitSoon(): void {
    if (this.emitTimer || this.stopped) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.deps.emit(this.snapshot());
    }, this.options.emitThrottleMs);
    this.emitTimer.unref?.();
  }
}
