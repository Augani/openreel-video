import { app } from "electron";
import os from "node:os";
import path from "node:path";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

// Opt-outs / opt-ins read from the environment so a misbehaving driver can be
// worked around without a rebuild.
const SAFE_GPU_ENV = "OPENREEL_SAFE_GPU";
const AGGRESSIVE_GPU_ENV = "OPENREEL_AGGRESSIVE_GPU";
const JS_FLAGS_ENV = "OPENREEL_JS_FLAGS";

const GPU_DISABLED_MARKER = ".openreel-gpu-disabled";
const GPU_CRASH_LIMIT = 2;
/** Launches that stay on software rendering after the crash limit is hit. */
const GPU_FALLBACK_LAUNCHES = 3;

const MIN_OLD_SPACE_MB = 4096;
const MAX_OLD_SPACE_MB = 8192;
const OLD_SPACE_RAM_FRACTION = 0.3;

/** Single `enable-features` list: a second appendSwitch call would overwrite the first. */
export function buildEnableFeatures(platform: NodeJS.Platform): string[] {
  if (platform === "linux") return ["VaapiVideoDecoder", "VaapiVideoEncoder"];
  return [];
}

/** V8 old-space cap: 30% of system RAM, clamped to 4-8 GB so small machines are not starved. */
export function computeMaxOldSpaceMb(totalMemBytes: number): number {
  const mb = Math.floor((totalMemBytes / (1024 * 1024)) * OLD_SPACE_RAM_FRACTION);
  return Math.min(MAX_OLD_SPACE_MB, Math.max(MIN_OLD_SPACE_MB, mb));
}

/**
 * V8 flags for every Electron process. `extra` (OPENREEL_JS_FLAGS) is appended last so a flag can be
 * A/B-tested against the desktop perf harness without a rebuild.
 */
export function buildJsFlags(totalMemBytes: number, extra?: string): string {
  const flags = [`--max-old-space-size=${computeMaxOldSpaceMb(totalMemBytes)}`];
  const trimmed = extra?.trim();
  if (trimmed) flags.push(trimmed);
  return flags.join(" ");
}

/**
 * Number of launches left in the software-rendering fallback. The marker holds
 * that count; an unreadable or legacy (timestamp) marker counts as one launch.
 */
export function parseFallbackLaunches(text: string): number {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 1 || n > GPU_FALLBACK_LAUNCHES) return 1;
  return n;
}

export function shouldDisableAfterCrash(crashCount: number): boolean {
  return crashCount >= GPU_CRASH_LIMIT;
}

function markerPath(): string {
  return path.join(app.getPath("userData"), GPU_DISABLED_MARKER);
}

/** Launches left in the software-rendering fallback; 0 when there is no marker. Does not modify it. */
function readFallbackLaunches(): number {
  try {
    return parseFallbackLaunches(readFileSync(markerPath(), "utf8"));
  } catch {
    // No marker (or unreadable): normal launch.
    return 0;
  }
}

/**
 * Count one launch off the fallback marker. Call only once the single-instance
 * lock is held, so a second instance that quits immediately does not use up a
 * fallback launch.
 */
export function consumeGpuFallbackLaunch(): void {
  const remaining = readFallbackLaunches();
  if (remaining <= 0) return;
  try {
    if (remaining <= 1) rmSync(markerPath(), { force: true });
    else writeFileSync(markerPath(), String(remaining - 1), "utf8");
  } catch {
    // Best effort; a stale marker only repeats the fallback.
  }
}

/** Command-line switches; must run before app ready. Does not consume the fallback marker. */
export function applyPerformanceSwitches(): void {
  const { commandLine } = app;
  const userData = (): string => app.getPath("userData");

  // A previous session crashed the GPU process repeatedly: stay on software
  // rendering for a few launches so the app does not alternate between crashing
  // and working. consumeGpuFallbackLaunch() counts the marker down.
  const remaining = readFallbackLaunches();
  if (remaining > 0) {
    console.warn(
      `[gpu] disabling hardware acceleration after repeated GPU crashes (${remaining} launch(es) left)`,
    );
    app.disableHardwareAcceleration();
    return;
  }

  let gpuCrashes = 0;
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU") return;
    gpuCrashes += 1;
    if (!shouldDisableAfterCrash(gpuCrashes)) return;
    try {
      writeFileSync(path.join(userData(), GPU_DISABLED_MARKER), String(GPU_FALLBACK_LAUNCHES), "utf8");
    } catch (error) {
      console.error("[gpu] failed to write GPU-disabled marker:", error);
    }
  });

  if (process.env[SAFE_GPU_ENV] === "1") {
    console.warn(`[gpu] ${SAFE_GPU_ENV}=1: skipping performance switches`);
    return;
  }

  // Chromium already enables GPU rasterization on macOS/Windows and benchmarks
  // showed no gain from these flags, so they are opt-in for problem drivers.
  if (process.env[AGGRESSIVE_GPU_ENV] === "1") {
    commandLine.appendSwitch("ignore-gpu-blocklist");
    commandLine.appendSwitch("enable-gpu-rasterization");
    commandLine.appendSwitch("enable-zero-copy");
    const features = buildEnableFeatures(process.platform);
    if (features.length > 0) commandLine.appendSwitch("enable-features", features.join(","));
  }

  commandLine.appendSwitch("js-flags", buildJsFlags(os.totalmem(), process.env[JS_FLAGS_ENV]));
}
