import { promises as fs, mkdirSync, mkdtempSync, lstatSync, chmodSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

export const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

const tracked = new Set<string>();
let resolvedDir: string | null = null;

function defaultTempDir(): string {
  return path.join(os.tmpdir(), "openreel-temp");
}

function processUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/**
 * The shared dir lives at a predictable path in a world-writable tmpdir, so
 * another local user could have pre-created it (or planted a symlink there).
 * Use it only when it is a real directory we own; otherwise take a private one.
 */
function resolveTempDir(): string {
  const dir = defaultTempDir();
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const st = lstatSync(dir);
  const uid = processUid();
  const safe = st.isDirectory() && !st.isSymbolicLink() && (uid === null || st.uid === uid);
  if (!safe) return mkdtempSync(path.join(os.tmpdir(), "openreel-temp-"));
  if (uid !== null && (st.mode & 0o077) !== 0) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      // Best effort; the ownership check above already holds.
    }
  }
  return dir;
}

function isSafeDir(dir: string): boolean {
  const st = lstatSync(dir);
  const uid = processUid();
  return st.isDirectory() && !st.isSymbolicLink() && (uid === null || st.uid === uid);
}

/**
 * The resolved dir is cached, but a tmp cleaner may delete it during a long
 * session, so recreate it (cheap when present) and re-apply the safety check.
 */
function ensureTempDirSync(): string {
  if (resolvedDir === null) {
    resolvedDir = resolveTempDir();
    return resolvedDir;
  }
  try {
    mkdirSync(resolvedDir, { recursive: true, mode: 0o700 });
    if (!isSafeDir(resolvedDir)) resolvedDir = resolveTempDir();
  } catch {
    resolvedDir = resolveTempDir();
  }
  return resolvedDir;
}

/** App-owned temp directory, so cleanup never has to guess which tmpdir files are ours. */
export function appTempDir(): string {
  return ensureTempDirSync();
}

export async function ensureTempDir(): Promise<string> {
  return ensureTempDirSync();
}

/** Reserve a unique path inside the temp dir and track it for cleanup. */
export function newTempPath(prefix: string, ext: string): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const p = path.join(ensureTempDirSync(), `${prefix}-${randomUUID()}.${safeExt}`);
  tracked.add(p);
  return p;
}

/** Same as newTempPath but guarantees the directory exists before returning. */
export async function newTempPathReady(prefix: string, ext: string): Promise<string> {
  await ensureTempDir();
  return newTempPath(prefix, ext);
}

export function isTrackedTemp(p: string): boolean {
  return tracked.has(p);
}

/** Delete a tracked temp file. Paths we did not hand out are ignored. */
export async function releaseTemp(p: string): Promise<boolean> {
  if (!tracked.delete(p)) return false;
  await fs.rm(p, { force: true });
  return true;
}

/** Synchronous release for quit paths. Paths we did not hand out are ignored. */
export function releaseTempSync(p: string): boolean {
  if (!tracked.delete(p)) return false;
  try {
    rmSync(p, { force: true });
  } catch {
    // best effort
  }
  return true;
}

/**
 * Remove entries older than maxAgeMs; returns how many were removed. Entries are
 * inspected with lstat and removed without following symlinks, and entries owned
 * by another user are left alone.
 */
export async function sweepStaleTemp(maxAgeMs: number = STALE_TEMP_MS, now: number = Date.now()): Promise<number> {
  let dir: string;
  let names: string[];
  try {
    dir = ensureTempDirSync();
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  const uid = processUid();
  let removed = 0;
  await Promise.all(
    names.map(async (name) => {
      const full = path.join(dir, name);
      try {
        const st = await fs.lstat(full);
        if (uid !== null && st.uid !== uid) return;
        if (now - st.mtimeMs > maxAgeMs) {
          // fs.rm unlinks a symlink itself rather than following it.
          await fs.rm(full, { recursive: !st.isSymbolicLink(), force: true });
          removed++;
        }
      } catch {
        // raced with another delete
      }
    }),
  );
  return removed;
}

/** Remove everything this process created. Synchronous so it completes inside will-quit. */
export function cleanupTempOnQuit(): void {
  for (const p of tracked) {
    try {
      rmSync(p, { force: true });
    } catch {
      // best effort
    }
  }
  tracked.clear();
  try {
    if (resolvedDir) rmdirSync(resolvedDir);
  } catch {
    // not empty (another instance) or already gone
  }
}
