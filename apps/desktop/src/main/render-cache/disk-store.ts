import { promises as fs } from "node:fs";
import path from "node:path";
import { RENDER_CACHE_FOLDER, frameKeySchema, projectKeySchema } from "../../shared/render-cache";

const EXT = ".frm";
const INDEX_FILE = "index.json";

function fileFor(key: string): string {
  frameKeySchema.parse(key);
  return key === "__index__" ? INDEX_FILE : `${key}${EXT}`;
}

function keyFor(file: string): string | null {
  if (file === INDEX_FILE) return "__index__";
  const match = /^(f\d{1,9})\.frm$/.exec(file);
  return match ? match[1] : null;
}

export class RenderCacheDiskFullError extends Error {
  constructor() {
    super("The scratch disk is full. Free up space or choose another scratch folder in Settings > Render cache.");
  }
}

/**
 * Frame files under `<scratch>/OpenReel Render Cache/<project>/`. Writes go to a temp file and are renamed into
 * place, so a crash leaves either the old file or the new one, never a torn frame (the renderer also verifies
 * sizes against its index on restore). Only keys that match the shared schemas ever reach the file system.
 */
export class RenderCacheDisk {
  readonly root: string;

  constructor(scratchDir: string) {
    this.root = path.join(scratchDir, RENDER_CACHE_FOLDER);
  }

  private dir(project: string): string {
    projectKeySchema.parse(project);
    return path.join(this.root, project);
  }

  async put(project: string, key: string, data: Uint8Array): Promise<void> {
    const dir = this.dir(project);
    const target = path.join(dir, fileFor(key));
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") throw new RenderCacheDiskFullError();
      throw error;
    }
  }

  async get(project: string, key: string): Promise<Uint8Array | undefined> {
    try {
      const buf = await fs.readFile(path.join(this.dir(project), fileFor(key)));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(project: string, keys: readonly string[]): Promise<void> {
    const dir = this.dir(project);
    await Promise.all(keys.map((key) => fs.rm(path.join(dir, fileFor(key)), { force: true })));
  }

  async list(project: string): Promise<Array<{ key: string; bytes: number }>> {
    const dir = this.dir(project);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: Array<{ key: string; bytes: number }> = [];
    for (const name of names) {
      const key = keyFor(name);
      if (!key) {
        // leftover temp files from a crash
        if (name.endsWith(".tmp")) await fs.rm(path.join(dir, name), { force: true }).catch(() => undefined);
        continue;
      }
      try {
        out.push({ key, bytes: (await fs.stat(path.join(dir, name))).size });
      } catch {
        /* removed while listing */
      }
    }
    return out;
  }

  async clearProject(project: string): Promise<void> {
    await fs.rm(this.dir(project), { recursive: true, force: true });
  }

  /** Deletes only this app's folder, never the scratch directory the user picked. */
  async clearAll(): Promise<void> {
    await fs.rm(this.root, { recursive: true, force: true });
  }

  async usage(): Promise<{ bytes: number; projects: Array<{ key: string; bytes: number; files: number; touchedAt: number }> }> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch {
      return { bytes: 0, projects: [] };
    }
    const projects: Array<{ key: string; bytes: number; files: number; touchedAt: number }> = [];
    for (const key of names) {
      if (!projectKeySchema.safeParse(key).success) continue;
      let bytes = 0;
      let files = 0;
      let touchedAt = 0;
      try {
        for (const name of await fs.readdir(path.join(this.root, key))) {
          if (!keyFor(name)) continue;
          const st = await fs.stat(path.join(this.root, key, name));
          bytes += st.size;
          files++;
          touchedAt = Math.max(touchedAt, st.mtimeMs, st.atimeMs);
        }
      } catch {
        continue;
      }
      projects.push({ key, bytes, files, touchedAt });
    }
    return { bytes: projects.reduce((sum, p) => sum + p.bytes, 0), projects };
  }

  /**
   * Keep the whole cache inside `capBytes` by removing the least recently touched projects, never `keep`.
   * Returns the keys removed. (Frames inside one project are evicted LRU by the renderer's own budget.)
   */
  async trim(capBytes: number, keep: string | null): Promise<string[]> {
    const { bytes, projects } = await this.usage();
    let total = bytes;
    const removed: string[] = [];
    for (const project of projects.sort((a, b) => a.touchedAt - b.touchedAt)) {
      if (total <= capBytes) break;
      if (project.key === keep) continue;
      await this.clearProject(project.key);
      total -= project.bytes;
      removed.push(project.key);
    }
    return removed;
  }

  /** Remove projects untouched for `maxAgeMs` (abandoned drafts, deleted projects). */
  async sweepStale(maxAgeMs: number, keep: string | null, now = Date.now()): Promise<string[]> {
    const { projects } = await this.usage();
    const removed: string[] = [];
    for (const project of projects) {
      if (project.key === keep || now - project.touchedAt < maxAgeMs) continue;
      await this.clearProject(project.key);
      removed.push(project.key);
    }
    return removed;
  }
}
