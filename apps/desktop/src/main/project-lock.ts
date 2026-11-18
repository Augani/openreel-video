import { promises as fs, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Project file locking.
 *
 * Opening a project on desktop takes a lock file beside it (`.<name>.lock`). A second window or app
 * instance that finds a live lock is told who holds it and opens the project read-only instead of
 * letting two editors overwrite each other's saves.
 *
 * - The lock names its owner (`<instance>:<window>`), so two windows of one app conflict too.
 * - The holder rewrites it every HEARTBEAT_MS. A lock is stale (and taken over) when its process
 *   is gone (same machine), or its heartbeat stopped (other machine / network share / PID reuse).
 * - Locks are released when the project closes, the window closes and on quit; a crash leaves a
 *   stale lock that the next open takes over.
 * - A folder we cannot write to (read-only volume) reports `unsupported`: the project still opens
 *   for editing, as it did before locking existed.
 */

export const HEARTBEAT_MS = 5_000;
/** A lock held by another machine is stale once its heartbeat is this old. */
export const REMOTE_STALE_MS = 45_000;
/** On the same machine a live PID wins, unless the heartbeat is absurdly old (PID reuse). */
export const LOCAL_STALE_MS = 10 * 60_000;

export interface LockInfo {
  owner: string;
  instanceId: string;
  pid: number;
  host: string;
  user: string;
  startedAt: number;
  heartbeatAt: number;
}

export interface LockHolder {
  pid: number;
  host: string;
  user: string;
  since: number;
  heartbeatAt: number;
  /** Held by this same app process (another window of it). */
  sameApp: boolean;
  sameHost: boolean;
}

export type LockResult =
  | { status: "acquired" }
  | { status: "held"; holder: LockHolder }
  | { status: "unsupported"; reason: string };

export function lockPathFor(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  return path.join(path.dirname(resolved), `.${path.basename(resolved)}.lock`);
}

export function isStale(info: LockInfo, now: number, host: string, pidAlive: (pid: number) => boolean): boolean {
  const age = now - info.heartbeatAt;
  if (info.host === host) return !pidAlive(info.pid) || age > LOCAL_STALE_MS;
  return age > REMOTE_STALE_MS;
}

export function parseLock(text: string): LockInfo | null {
  try {
    const raw = JSON.parse(text) as Partial<LockInfo>;
    if (
      typeof raw.owner !== "string" ||
      typeof raw.instanceId !== "string" ||
      typeof raw.pid !== "number" ||
      typeof raw.host !== "string" ||
      typeof raw.heartbeatAt !== "number"
    )
      return null;
    return {
      owner: raw.owner,
      instanceId: raw.instanceId,
      pid: raw.pid,
      host: raw.host,
      user: typeof raw.user === "string" ? raw.user : "",
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : raw.heartbeatAt,
      heartbeatAt: raw.heartbeatAt,
    };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface ProjectLocksOptions {
  instanceId?: string;
  host?: string;
  user?: string;
  pid?: number;
  now?: () => number;
  pidAlive?: (pid: number) => boolean;
}

export class ProjectLocks {
  readonly instanceId: string;
  private readonly host: string;
  private readonly user: string;
  private readonly pid: number;
  private readonly now: () => number;
  private readonly pidAlive: (pid: number) => boolean;
  /** lock path -> owner id of the lock this process holds. */
  private readonly held = new Map<string, { owner: string; startedAt: number }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(options: ProjectLocksOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.host = options.host ?? os.hostname();
    this.user = options.user ?? safeUser();
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.pidAlive = options.pidAlive ?? processAlive;
  }

  private infoFor(owner: string, startedAt: number): LockInfo {
    return { owner, instanceId: this.instanceId, pid: this.pid, host: this.host, user: this.user, startedAt, heartbeatAt: this.now() };
  }

  private holderOf(info: LockInfo): LockHolder {
    return {
      pid: info.pid,
      host: info.host,
      user: info.user,
      since: info.startedAt,
      heartbeatAt: info.heartbeatAt,
      sameApp: info.instanceId === this.instanceId,
      sameHost: info.host === this.host,
    };
  }

  async acquire(projectPath: string, owner: string): Promise<LockResult> {
    const lockPath = lockPathFor(projectPath);
    const mine = this.held.get(lockPath);
    if (mine) {
      if (mine.owner === owner) return { status: "acquired" };
      const info = await this.read(lockPath);
      if (info) return { status: "held", holder: this.holderOf(info) };
      // Our own record is gone from disk (deleted by hand): fall through and re-take it.
      this.held.delete(lockPath);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const startedAt = this.now();
      try {
        await fs.writeFile(lockPath, JSON.stringify(this.infoFor(owner, startedAt)), { flag: "wx" });
        this.held.set(lockPath, { owner, startedAt });
        this.startHeartbeat();
        return { status: "acquired" };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") return { status: "unsupported", reason: code ?? String(error) };
      }
      const info = await this.read(lockPath);
      if (info && !isStale(info, this.now(), this.host, this.pidAlive)) return { status: "held", holder: this.holderOf(info) };
      // Stale or unreadable (a crash mid-write): remove and try again. If two openers race here the
      // exclusive create above lets exactly one of them win.
      if (!info) {
        const age = await this.ageOf(lockPath);
        if (age !== null && age < 2_000) return { status: "held", holder: { pid: 0, host: "", user: "", since: this.now(), heartbeatAt: this.now(), sameApp: false, sameHost: false } };
      }
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
    return { status: "unsupported", reason: "lock contention" };
  }

  async release(projectPath: string, owner: string): Promise<boolean> {
    const lockPath = lockPathFor(projectPath);
    const mine = this.held.get(lockPath);
    if (!mine || mine.owner !== owner) return false;
    this.held.delete(lockPath);
    this.removeIfMine(lockPath, owner);
    this.stopHeartbeatIfIdle();
    return true;
  }

  async releaseOwner(owner: string): Promise<void> {
    const mine = [...this.held.entries()].filter(([, entry]) => entry.owner === owner);
    for (const [lockPath] of mine) {
      this.held.delete(lockPath);
      this.removeIfMine(lockPath, owner);
    }
    this.stopHeartbeatIfIdle();
  }

  /**
   * Remove the lock file if it still names us. Synchronous on purpose: a window closing during an app
   * quit drops the entry from `held` right away, and an awaited read/remove could still be in flight when
   * the process exits (the lock would then be left behind for the next opener to wait out).
   */
  private removeIfMine(lockPath: string, owner: string): void {
    try {
      const info = parseLock(readFileSync(lockPath, "utf8"));
      if (info && info.owner === owner && info.instanceId === this.instanceId) rmSync(lockPath, { force: true });
    } catch {
      /* already gone */
    }
  }

  /** Synchronous release for process exit, where an await would never finish. */
  releaseAllSync(fsSync: { readFileSync(p: string, e: "utf8"): string; rmSync(p: string, o: { force: boolean }): void }): void {
    for (const [lockPath, entry] of this.held) {
      try {
        const info = parseLock(fsSync.readFileSync(lockPath, "utf8"));
        if (info && info.owner === entry.owner && info.instanceId === this.instanceId) fsSync.rmSync(lockPath, { force: true });
      } catch {
        /* already gone */
      }
    }
    this.held.clear();
    this.stopHeartbeatIfIdle();
  }

  heldPaths(): string[] {
    return [...this.held.keys()];
  }

  /** One heartbeat pass; exported for tests (the timer calls it). */
  async beat(): Promise<void> {
    for (const [lockPath, entry] of [...this.held]) {
      const info = await this.read(lockPath);
      // Taken over (we were suspended past the stale window) or deleted: do not fight for it.
      if (info && (info.owner !== entry.owner || info.instanceId !== this.instanceId)) {
        this.held.delete(lockPath);
        continue;
      }
      await fs.writeFile(lockPath, JSON.stringify(this.infoFor(entry.owner, entry.startedAt))).catch(() => undefined);
    }
    this.stopHeartbeatIfIdle();
  }

  private startHeartbeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.timer.unref?.();
  }

  private stopHeartbeatIfIdle(): void {
    if (this.held.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async read(lockPath: string): Promise<LockInfo | null> {
    try {
      return parseLock(await fs.readFile(lockPath, "utf8"));
    } catch {
      return null;
    }
  }

  private async ageOf(lockPath: string): Promise<number | null> {
    try {
      return this.now() - (await fs.stat(lockPath)).mtimeMs;
    } catch {
      return null;
    }
  }
}

function safeUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}
