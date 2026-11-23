import { promises as fs } from "node:fs";
import path from "node:path";
import { relinkNameKey, type RelinkCandidate } from "../../../../../packages/core/src/media/desktop-ingest";
import { clipNameKey, compileProxyPattern } from "../../../../../packages/core/src/media/proxy-attach";
import { isPreviewTwinName } from "./folders";
import type { MediaProbe } from "./probe-media";

const MEDIA_EXTENSIONS = new Set([
  ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".mxf", ".mts", ".m2ts", ".ts", ".mpg", ".mpeg", ".3gp", ".wmv", ".flv", ".ogv",
  ".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus", ".aif", ".aiff", ".wma",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".avif",
]);

export interface ScanOptions {
  root: string;
  /** Names (file names or stems) of the media being looked for. */
  names: readonly string[];
  /** "proxy" matches `_proxy`-style suffixes too. */
  mode: "media" | "proxy";
  /** Proxy mode: a name pattern with one {name} (`{name}_proxy`). Files that do not follow it are not looked at. */
  proxyPattern?: string;
  probe: (filePath: string, signal?: AbortSignal) => Promise<MediaProbe | null>;
  signal?: AbortSignal;
  maxDepth?: number;
  maxVisited?: number;
}

export interface ScanResult {
  candidates: RelinkCandidate[];
  /** Files looked at. */
  visited: number;
  /** The walk stopped at the depth or file limit. */
  truncated: boolean;
}

/**
 * Search a folder tree for the files `names` refer to. Only files whose name matches one of the wanted
 * names are probed, so a big drive is walked but not decoded. Symlinks are not followed (no loops),
 * hidden folders are skipped.
 */
export async function scanFolderForMedia(options: ScanOptions): Promise<ScanResult> {
  const pattern = options.mode === "proxy" && options.proxyPattern?.trim() ? compileProxyPattern(options.proxyPattern) : null;
  const keyOf = (name: string): string | null => (pattern ? pattern.keyOf(name) : relinkNameKey(name, options.mode === "proxy"));
  const wanted = new Set(options.names.map((name) => (pattern ? clipNameKey(name) : relinkNameKey(name, options.mode === "proxy"))));
  const maxDepth = options.maxDepth ?? 8;
  const maxVisited = options.maxVisited ?? 200_000;
  const found: Array<{ filePath: string; size: number }> = [];
  let visited = 0;
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (options.signal?.aborted || truncated) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (options.signal?.aborted) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth) truncated = true;
        else await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (++visited > maxVisited) {
          truncated = true;
          return;
        }
        if (!MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        // The H.264 preview twin of a ProRes proxy travels with it; it is not a proxy of its own.
        if (options.mode === "proxy" && isPreviewTwinName(entry.name)) continue;
        const key = keyOf(entry.name);
        if (key === null || !wanted.has(key)) continue;
        const stat = await fs.stat(full).catch(() => null);
        if (stat) found.push({ filePath: full, size: stat.size });
      }
    }
  };
  await walk(path.resolve(options.root), 0);

  const candidates: RelinkCandidate[] = [];
  for (const { filePath, size } of found) {
    if (options.signal?.aborted) break;
    const probe = await options.probe(filePath, options.signal);
    candidates.push({
      path: filePath,
      name: path.basename(filePath),
      size,
      ...(probe?.duration !== undefined ? { duration: probe.duration } : {}),
      ...(probe?.frameRate !== undefined ? { frameRate: probe.frameRate } : {}),
      ...(probe?.width !== undefined ? { width: probe.width } : {}),
      ...(probe?.height !== undefined ? { height: probe.height } : {}),
    });
  }
  return { candidates, visited, truncated };
}
