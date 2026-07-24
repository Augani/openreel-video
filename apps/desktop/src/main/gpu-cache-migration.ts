import { app } from "electron";
import path from "node:path";
import { existsSync, statSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from "node:fs";

// Regenerable on-disk caches that Chromium/Electron rebuild on demand. A stale
// GPU/shader cache written by a previous Electron build crashes the new build's
// GPU process at startup (EXC_BREAKPOINT/SIGTRAP), so we drop them on upgrade.
// User data (IndexedDB, Local Storage, Cookies, projects) is never touched.
// Names cover the Metal (macOS) and Dawn (Windows/Linux) backends plus newer
// Chromium variants; absent dirs are skipped, so listing extras is harmless.
const REGENERABLE_CACHE_DIRS = [
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GraphiteDawnCache",
  "GPUPersistentCache",
  "ShaderCache",
  "GrShaderCache",
  "Code Cache",
];

const VERSION_MARKER_FILE = ".openreel-build";

function readMarker(markerPath: string): string {
  try {
    if (statSync(markerPath).isFile()) {
      return readFileSync(markerPath, "utf8").trim();
    }
    // Corrupt marker (e.g. a directory) — remove it so a good one can be written.
    rmSync(markerPath, { recursive: true, force: true });
  } catch {
    // Missing or unreadable → treat as first run.
  }
  return "";
}

function writeMarker(markerPath: string, version: string): void {
  try {
    const tmp = `${markerPath}.tmp`;
    writeFileSync(tmp, version, "utf8");
    renameSync(tmp, markerPath);
  } catch (error) {
    console.error("[gpu-cache] failed to write version marker:", error);
  }
}

export function migrateGpuCacheOnUpgrade(): void {
  try {
    const userData = app.getPath("userData");
    const currentVersion = app.getVersion();
    try {
      mkdirSync(userData, { recursive: true });
    } catch {
      // userData should be creatable; if not, the writes below will no-op safely.
    }
    const markerPath = path.join(userData, VERSION_MARKER_FILE);

    const previousVersion = readMarker(markerPath);
    if (previousVersion === currentVersion) return;

    let allCleared = true;
    if (previousVersion) {
      for (const dir of REGENERABLE_CACHE_DIRS) {
        const target = path.join(userData, dir);
        if (!existsSync(target)) continue;
        try {
          rmSync(target, { recursive: true, force: true });
        } catch (error) {
          allCleared = false;
          console.error(`[gpu-cache] failed to clear ${dir}:`, error);
        }
      }
      console.log(
        `[gpu-cache] cleared regenerable caches on version change ${previousVersion} -> ${currentVersion}`,
      );
    }

    // Only advance the marker when the clear fully succeeded (or there was
    // nothing to clear). If a clear failed, leave the old marker so the next
    // launch retries — otherwise a stale cache that crashes the GPU process
    // would never be recovered.
    if (allCleared) writeMarker(markerPath, currentVersion);
  } catch (error) {
    // Never block startup on cache migration.
    console.error("[gpu-cache] migration skipped:", error);
  }
}
