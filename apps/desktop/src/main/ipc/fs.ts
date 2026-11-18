import { dialog, shell, BrowserWindow, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withNativeDialog } from "../native-dialog-state";
import { newTempPathReady, releaseTemp } from "../temp-dir";

/** Suffix of an in-progress write. A crash leaves `<name>.part` beside the target, never a truncated target. */
export const PART_SUFFIX = ".part";

/**
 * Positioned file writes for exports. Bytes go to `<path>.part`; `close` fsyncs and renames it over
 * `path` in one atomic step, so killing the app mid-write cannot leave a truncated file under the
 * final name, nor destroy a good file that was already there (the old behaviour opened `path`
 * with "w", truncating it immediately).
 */
export class FileWriterRegistry {
  private handles = new Map<string, FileHandle>();
  private paths = new Map<string, string>();

  async open(path: string): Promise<string> {
    const id = randomUUID();
    this.handles.set(id, await fs.open(path + PART_SUFFIX, "w"));
    this.paths.set(id, path);
    return id;
  }

  async writeChunk(id: string, data: ArrayBuffer | Uint8Array, position: number): Promise<void> {
    const fh = this.handles.get(id);
    if (!fh) throw new Error(`unknown write handle ${id}`);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    await fh.write(bytes, 0, bytes.byteLength, position);
  }

  async close(id: string): Promise<void> {
    const fh = this.handles.get(id);
    const p = this.paths.get(id);
    if (!fh) return;
    this.handles.delete(id);
    this.paths.delete(id);
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (p) await fs.rename(p + PART_SUFFIX, p);
  }

  async abort(id: string): Promise<void> {
    const fh = this.handles.get(id);
    const p = this.paths.get(id);
    if (fh) await fh.close();
    this.handles.delete(id);
    this.paths.delete(id);
    if (p) await fs.rm(p + PART_SUFFIX, { force: true });
  }
}

/**
 * Remove `*.part` files older than this process left behind by a killed export, in the directories
 * the app writes exports to. Never touches a file younger than `minAgeMs` (a live writer).
 */
export async function sweepPartFiles(
  dir: string,
  minAgeMs = 60_000,
  prefix = "",
  /** "tmp" removes only this module's own `<name>.<uuid>.tmp` leftovers; "all" also removes `*.part`. */
  kinds: "all" | "tmp" = "all",
): Promise<string[]> {
  const removed: string[] = [];
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (prefix && !name.startsWith(prefix)) continue;
    const isOwnTmp = /\.[0-9a-f-]{36}\.tmp$/.test(name);
    if (!isOwnTmp && !(kinds === "all" && name.endsWith(PART_SUFFIX))) continue;
    const full = join(dir, name);
    try {
      const st = await fs.stat(full);
      if (st.isFile() && Date.now() - st.mtimeMs > minAgeMs) {
        await fs.rm(full, { force: true });
        removed.push(full);
      }
    } catch {
      /* raced with another cleanup */
    }
  }
  return removed;
}

export const fileWriters = new FileWriterRegistry();

function dialogOwner(event?: IpcMainInvokeEvent): BrowserWindow | undefined {
  const requester = event ? BrowserWindow.fromWebContents(event.sender) : null;
  const owner = requester && !requester.isDestroyed() ? requester : BrowserWindow.getFocusedWindow();
  if (!owner || owner.isDestroyed()) return undefined;
  // A native menu or accessibility command may briefly own focus instead of its editor.
  owner.focus();
  return owner;
}

export async function showSaveDialog(args: {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}, event?: IpcMainInvokeEvent): Promise<string | null> {
  const win = dialogOwner(event);
  const options = { defaultPath: args.defaultPath, filters: args.filters };
  const res = await withNativeDialog(() => win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
  return res.canceled || !res.filePath ? null : res.filePath;
}

export async function showOpenDialog(args: {
  filters: { name: string; extensions: string[] }[];
}, event?: IpcMainInvokeEvent): Promise<string | null> {
  const win = dialogOwner(event);
  const options: OpenDialogOptions = { filters: args.filters, properties: ["openFile"] };
  const res = await withNativeDialog(() => win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

export async function readTextFile(args: { path: string }): Promise<string> {
  return fs.readFile(args.path, "utf8");
}

export async function readFileBytes(args: { path: string }): Promise<ArrayBuffer> {
  const buf = await fs.readFile(args.path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function writeTextFile(args: { path: string; data: string }): Promise<void> {
  // Write through symlinks (rename would otherwise replace the link with a file)
  // and keep the existing permissions; a new file gets the default mode.
  let dest = args.path;
  let mode: number | undefined;
  try {
    dest = await fs.realpath(args.path);
    mode = (await fs.stat(dest)).mode & 0o7777;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const tmp = `${dest}.${randomUUID()}.tmp`;
  try {
    // write + fsync + rename: after a crash (or power cut) `dest` is the old file or the new file, whole.
    const fh = await fs.open(tmp, "w", mode);
    try {
      await fh.writeFile(args.data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, dest);
    await syncDirectory(dirname(dest));
    // A previous run killed between write and rename leaves its temp file behind; drop the stale ones.
    // Only our own `.<uuid>.tmp` files: the folder is the user's, and a bare `*.part` there may be someone else's download.
    void sweepPartFiles(dirname(dest), 10 * 60_000, "", "tmp").catch(() => undefined);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // A read-only parent dir, or a file held open by a sync client or
    // antivirus on Windows, blocks the temp-and-rename; write in place instead.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "EBUSY") {
      await fs.writeFile(dest, args.data, "utf8");
      return;
    }
    throw e;
  }
}

/** Flush a directory entry (the rename) to disk. Not supported on Windows; best effort elsewhere. */
async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    const fh = await fs.open(dir, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* some filesystems refuse fsync on a directory */
  }
}

export async function revealInFolder(args: { path: string }): Promise<void> {
  shell.showItemInFolder(args.path);
}

export async function tempFilePath(args: { ext: string; persist?: boolean }): Promise<string> {
  if (args.persist) {
    // Handed to external clients (MCP export artifacts) that may read it after
    // a restart, so keep it out of the tracked dir that is wiped on quit.
    const safeExt = args.ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
    return join(tmpdir(), `openreel-export-${randomUUID()}.${safeExt}`);
  }
  return newTempPathReady("openreel-mat", args.ext);
}

export async function releaseTempFile(args: { path: string }): Promise<boolean> {
  return releaseTemp(args.path);
}
