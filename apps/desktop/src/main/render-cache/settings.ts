import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RENDER_CACHE_DEFAULT_CAP_BYTES, RENDER_CACHE_MAX_CAP_BYTES, RENDER_CACHE_MIN_CAP_BYTES } from "../../shared/render-cache";

export interface StoredRenderCacheSettings {
  scratchDir: string | null;
  capBytes: number;
}

export const DEFAULT_RENDER_CACHE_SETTINGS: StoredRenderCacheSettings = {
  scratchDir: null,
  capBytes: RENDER_CACHE_DEFAULT_CAP_BYTES,
};

/** Folders the scratch disk may never be: the file system root or the home folder itself. */
export function isAcceptableScratchDir(dir: string): boolean {
  if (!path.isAbsolute(dir)) return false;
  const resolved = path.resolve(dir);
  return resolved !== path.parse(resolved).root && resolved !== path.resolve(os.homedir());
}

export function loadRenderCacheSettings(file: string): StoredRenderCacheSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredRenderCacheSettings>;
    const scratchDir =
      typeof parsed.scratchDir === "string" && isAcceptableScratchDir(parsed.scratchDir) ? parsed.scratchDir : null;
    const cap = parsed.capBytes;
    const capBytes =
      typeof cap === "number" && Number.isFinite(cap)
        ? Math.min(RENDER_CACHE_MAX_CAP_BYTES, Math.max(RENDER_CACHE_MIN_CAP_BYTES, Math.round(cap)))
        : DEFAULT_RENDER_CACHE_SETTINGS.capBytes;
    return { scratchDir, capBytes };
  } catch {
    return { ...DEFAULT_RENDER_CACHE_SETTINGS };
  }
}

export function saveRenderCacheSettings(file: string, settings: StoredRenderCacheSettings): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...settings }, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    /* a read-only profile only loses the choice across restarts */
  }
}

/** The folder must exist (or be creatable) and accept a file. */
export async function probeWritable(dir: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.openreel-probe-${process.pid}`);
    await fs.promises.writeFile(probe, "x");
    await fs.promises.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export async function freeBytes(dir: string): Promise<number | null> {
  try {
    let probe = dir;
    for (let i = 0; i < 6; i++) {
      try {
        const st = await fs.promises.statfs(probe);
        return Number(st.bavail) * Number(st.bsize);
      } catch {
        probe = path.dirname(probe);
      }
    }
  } catch {
    /* unknown */
  }
  return null;
}
