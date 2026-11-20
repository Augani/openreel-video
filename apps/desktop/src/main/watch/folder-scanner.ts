import fs, { type FSWatcher } from "node:fs";
import path from "node:path";

/**
 * Watches ONE folder (non-recursive) and reports each file once it has stopped growing.
 *
 * Detection is fs.watch (debounced) with a slow periodic rescan behind it, because fs.watch drops
 * events on network shares and some editors' save patterns. A file is "ready" only after its size and
 * mtime have been unchanged for `settleMs` and it can be opened for reading, so a copy or a download
 * that is still being written is never handed on. Files that change after they were reported are
 * reported again (a new version).
 */

export interface ScanFile {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

export interface ScannerFs {
  readdir(dir: string): Promise<Array<{ name: string; isFile: boolean }>>;
  stat(file: string): Promise<{ size: number; mtimeMs: number } | null>;
  canRead(file: string): Promise<boolean>;
  watch(dir: string, onChange: () => void): { close(): void } | null;
}

export interface ScannerOptions {
  /** How long size and mtime must stay unchanged before a file counts as fully written. */
  settleMs: number;
  /** How often files still settling are re-checked. */
  pollMs: number;
  /** Backstop rescan for missed fs.watch events. */
  rescanMs: number;
  /** Collapses bursts of fs.watch events into one scan. */
  debounceMs: number;
  now?: () => number;
}

export const DEFAULT_SCANNER_OPTIONS: ScannerOptions = { settleMs: 2500, pollMs: 700, rescanMs: 5000, debounceMs: 250 };

const PARTIAL_SUFFIXES = [".part", ".partial", ".crdownload", ".download", ".tmp", ".temp", ".filepart", ".aria2", ".swp", ".lock", ".opdownload", ".!qb", "~"];
const JUNK_NAMES = new Set(["thumbs.db", "desktop.ini", "ehthumbs.db"]);

/** Hidden files, OS droppings and the temporary names downloads and copy tools use for unfinished files. */
export function isIgnoredName(name: string): boolean {
  if (!name || name.startsWith(".") || name.startsWith("~$")) return true;
  const lower = name.toLowerCase();
  return JUNK_NAMES.has(lower) || PARTIAL_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export const nodeScannerFs: ScannerFs = {
  async readdir(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile() || entry.isSymbolicLink() }));
  },
  async stat(file) {
    try {
      const stat = await fs.promises.stat(file);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch {
      return null;
    }
  },
  async canRead(file) {
    try {
      const handle = await fs.promises.open(file, "r");
      await handle.close();
      return true;
    } catch {
      return false;
    }
  },
  watch(dir, onChange) {
    try {
      const watcher: FSWatcher = fs.watch(dir, { persistent: false }, () => onChange());
      watcher.on("error", () => undefined);
      return watcher;
    } catch {
      return null;
    }
  },
};

interface Pending {
  size: number;
  mtimeMs: number;
  stableSince: number;
}

export interface ScannerEvents {
  /** A file appeared (or changed) and is being watched until it stops growing. */
  onSeen?(file: ScanFile): void;
  /** A file that was settling disappeared before it finished. */
  onGone?(file: string): void;
  /** The file is complete. Called once per version (size + mtime). */
  onReady(file: ScanFile): void;
  /** The folder cannot be read (deleted, unplugged, permission). Cleared by `onReadable`. */
  onUnreadable?(error: NodeJS.ErrnoException): void;
  onReadable?(): void;
}

export class FolderScanner {
  private readonly pending = new Map<string, Pending>();
  /** Versions already reported: path -> "size:mtime". */
  private readonly reported = new Map<string, string>();
  private watcher: { close(): void } | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private rescan: ReturnType<typeof setInterval> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private scanning: Promise<void> | null = null;
  private again = false;
  private stopped = true;
  private unreadable = false;

  constructor(
    readonly dir: string,
    private readonly events: ScannerEvents,
    private readonly options: ScannerOptions = DEFAULT_SCANNER_OPTIONS,
    private readonly scannerFs: ScannerFs = nodeScannerFs,
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Marks versions that are already handled (a baseline or the ledger) so they are never reported. */
  markReported(file: ScanFile): void {
    this.reported.set(file.path, `${file.size}:${file.mtimeMs}`);
  }

  forget(filePath: string): void {
    this.reported.delete(filePath);
    this.pending.delete(filePath);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.watcher = this.scannerFs.watch(this.dir, () => this.schedule());
    this.rescan = setInterval(() => void this.scan(), this.options.rescanMs);
    this.rescan.unref?.();
    void this.scan();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    this.watcher = null;
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearTimeout(this.poll);
    if (this.rescan) clearInterval(this.rescan);
    this.debounce = this.poll = this.rescan = null;
    this.pending.clear();
  }

  private schedule(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.scan();
    }, this.options.debounceMs);
    this.debounce.unref?.();
  }

  /** One pass over the folder; overlapping calls collapse into a single follow-up pass. */
  scan(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.scanning) {
      this.again = true;
      return this.scanning;
    }
    this.scanning = this.scanOnce().finally(() => {
      this.scanning = null;
      if (this.again && !this.stopped) {
        this.again = false;
        void this.scan();
      }
    });
    return this.scanning;
  }

  private async scanOnce(): Promise<void> {
    let entries: Array<{ name: string; isFile: boolean }>;
    try {
      entries = await this.scannerFs.readdir(this.dir);
    } catch (error) {
      if (!this.unreadable) {
        this.unreadable = true;
        this.events.onUnreadable?.(error as NodeJS.ErrnoException);
      }
      return;
    }
    if (this.unreadable) {
      this.unreadable = false;
      this.events.onReadable?.();
      // The watch handle of a deleted-and-recreated folder is dead: re-arm it.
      this.watcher?.close();
      this.watcher = this.scannerFs.watch(this.dir, () => this.schedule());
    }
    const present = new Set<string>();
    for (const entry of entries) {
      if (!entry.isFile || isIgnoredName(entry.name)) continue;
      const full = path.join(this.dir, entry.name);
      present.add(full);
      if (this.stopped) return;
      const stat = await this.scannerFs.stat(full);
      if (!stat) continue;
      const version = `${stat.size}:${stat.mtimeMs}`;
      if (this.reported.get(full) === version) continue;
      const current = this.pending.get(full);
      if (current && current.size === stat.size && current.mtimeMs === stat.mtimeMs) continue;
      this.pending.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, stableSince: this.now() });
      this.events.onSeen?.({ path: full, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    for (const full of [...this.pending.keys()]) {
      if (!present.has(full)) {
        this.pending.delete(full);
        this.events.onGone?.(full);
      }
    }
    for (const full of [...this.reported.keys()]) if (!present.has(full)) this.reported.delete(full);
    if (this.pending.size > 0) this.armPoll();
  }

  private armPoll(): void {
    if (this.poll || this.stopped) return;
    this.poll = setTimeout(() => {
      this.poll = null;
      void this.checkPending();
    }, this.options.pollMs);
    this.poll.unref?.();
  }

  private async checkPending(): Promise<void> {
    for (const [full, entry] of [...this.pending]) {
      if (this.stopped) return;
      const stat = await this.scannerFs.stat(full);
      if (!stat) {
        this.pending.delete(full);
        this.events.onGone?.(full);
        continue;
      }
      if (stat.size !== entry.size || stat.mtimeMs !== entry.mtimeMs) {
        this.pending.set(full, { size: stat.size, mtimeMs: stat.mtimeMs, stableSince: this.now() });
        continue;
      }
      if (this.now() - entry.stableSince < this.options.settleMs || stat.size === 0) continue;
      if (!(await this.scannerFs.canRead(full))) continue;
      this.pending.delete(full);
      this.reported.set(full, `${stat.size}:${stat.mtimeMs}`);
      this.events.onReady({ path: full, name: path.basename(full), size: stat.size, mtimeMs: stat.mtimeMs });
    }
    if (this.pending.size > 0) this.armPoll();
  }
}
