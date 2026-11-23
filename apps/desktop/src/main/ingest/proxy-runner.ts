import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopPreviewTwinName, profileHasBurnIn } from "../../../../../packages/core/src/media/desktop-ingest";
import { isIntermediateProxyCodec } from "../../../../../packages/core/src/media/proxy-presets";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";
import { buildProxyArgs, parseProgressSeconds } from "./proxy-args";
import { probeMediaFile } from "./probe-media";
import type { ProxyJob, ProxyJobResult } from "./proxy-queue";

/** First installed font drawtext can use for the burn-in (a monospaced one reads best for timecode). */
export function pickBurnInFont(platform: NodeJS.Platform = process.platform, exists: (file: string) => boolean = existsSync): string | undefined {
  const candidates =
    platform === "darwin"
      ? ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf", "/System/Library/Fonts/Supplemental/Courier New.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"]
      : platform === "win32"
        ? ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf", "C:/Windows/Fonts/arial.ttf"]
        : ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/TTF/DejaVuSansMono.ttf", "/usr/share/fonts/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf", "/usr/share/fonts/liberation/LiberationMono-Regular.ttf", "/usr/share/fonts/noto/NotoSansMono-Regular.ttf"];
  return candidates.find((file) => exists(file));
}

/** A `.part` file this old is a leftover of a crash, not an encode that is still writing. */
const STALE_PART_MS = 10 * 60_000;
let runCounter = 0;

/** True when the process that named a `.part` file (`<out>.<pid>-<n>.part`) no longer exists, so no run can still be writing it. */
function partOwnerIsGone(name: string): boolean {
  const pid = Number(/\.(\d+)-\d+\.part$/.exec(name)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Remove leftover `.part` files of earlier runs of the same output. A run that is still writing
 * keeps touching its file, so only parts untouched for STALE_PART_MS are swept, plus parts whose
 * owning process is gone (the app was killed mid-encode: nothing can still be writing them).
 */
async function sweepStaleParts(outDir: string, fileNames: readonly string[], keep: ReadonlySet<string>): Promise<void> {
  const entries = await fs.readdir(outDir).catch(() => [] as string[]);
  const now = Date.now();
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".part") && !keep.has(name) && fileNames.some((f) => name.startsWith(`${f}.`)))
      .map(async (name) => {
        const full = path.join(outDir, name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat && (now - stat.mtimeMs >= STALE_PART_MS || partOwnerIsGone(name))) await fs.rm(full, { force: true });
      }),
  );
}

/** Nice value for proxy encodes: below the editor's own work, above nothing that matters. */
export const PROXY_NICE = 10;

function lowerPriority(pid: number | undefined): void {
  if (!pid) return;
  try {
    // Unix nice 10 / Windows BELOW_NORMAL: playback and export keep the CPU when they need it.
    os.setPriority(pid, process.platform === "win32" ? os.constants.priority.PRIORITY_BELOW_NORMAL : PROXY_NICE);
  } catch {
    // Not permitted or the process already exited: the job still runs, just at normal priority.
  }
}

export interface SpawnResult {
  code: number | null;
  stderr: string;
}

export function runFfmpeg(args: string[], onSeconds: (seconds: number) => void, signal: AbortSignal): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    lowerPriority(proc.pid);
    let stderr = "";
    let tail = "";
    const onAbort = (): void => {
      proc.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.stdout.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-2048);
      const seconds = parseProgressSeconds(tail);
      if (seconds !== null) onSeconds(seconds);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    proc.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    proc.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
      else resolve({ code, stderr });
    });
  });
}

/** Threads for a proxy encode: about a quarter of the cores per running job, at least one. */
export function proxyThreads(concurrency: number, cores = os.availableParallelism()): number {
  return Math.max(1, Math.floor(cores / (concurrency >= 2 ? 4 : 3)));
}

/**
 * Build one proxy with the ffmpeg sidecar. Output goes to a per-run `.part` file and is renamed when ffmpeg
 * succeeds, so a crash or cancel never leaves a half-written proxy that looks finished.
 */
export async function runProxyJob(
  job: ProxyJob,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  concurrency = 1,
): Promise<ProxyJobResult> {
  const srcStat = await fs.stat(job.srcPath).catch(() => null);
  if (!srcStat?.isFile()) throw new Error("The full-resolution file is missing, so the proxy cannot be built.");
  const probe = await probeMediaFile(job.srcPath, signal);
  signal.throwIfAborted();
  if (!probe?.hasVideo || !probe.width || !probe.height) throw new Error("ffmpeg could not read a video stream from this file.");
  await fs.mkdir(job.outDir, { recursive: true });
  const outPath = path.join(job.outDir, job.fileName);
  const intermediate = isIntermediateProxyCodec(job.profile.codec);
  const previewPath = intermediate && job.previewTwin ? path.join(job.outDir, desktopPreviewTwinName(job.fileName)) : undefined;
  // Every run writes its own `.part` name: a cancelled run that is still winding down (its cleanup
  // runs after ffmpeg exits) must never delete the file a newer run of the same proxy is writing.
  const token = `${process.pid}-${++runCounter}`;
  const part = `${outPath}.${token}.part`;
  const previewPart = previewPath ? `${previewPath}.${token}.part` : undefined;
  const cleanup = async (): Promise<void> => {
    await Promise.all([fs.rm(part, { force: true }), previewPart ? fs.rm(previewPart, { force: true }) : undefined]);
  };
  await sweepStaleParts(
    job.outDir,
    previewPath ? [job.fileName, path.basename(previewPath)] : [job.fileName],
    new Set([path.basename(part), ...(previewPart ? [path.basename(previewPart)] : [])]),
  );
  const burnIn = profileHasBurnIn(job.profile);
  const fontFile = burnIn ? pickBurnInFont() : undefined;
  if (burnIn && !fontFile) throw new Error("No font was found for the burn-in text on this computer. Turn burn-in off for this preset.");
  const duration = probe.duration && probe.duration > 0 ? probe.duration : 0;
  const attempt = async (hwaccel: boolean): Promise<SpawnResult> =>
    runFfmpeg(
      buildProxyArgs({
        srcPath: job.srcPath,
        outPath: part,
        previewOutPath: previewPart,
        profile: job.profile,
        srcWidth: probe.width!,
        srcHeight: probe.height!,
        threads: proxyThreads(concurrency),
        hwaccel,
        ...(burnIn ? { clipName: job.name ?? path.basename(job.srcPath), startTimecode: probe.startTimecode, frameRate: probe.frameRate, fontFile } : {}),
      }),
      (seconds) => {
        if (duration > 0) onProgress(Math.min(0.99, seconds / duration));
      },
      signal,
    );
  try {
    let result = await attempt(true);
    // Hardware decode can fail on odd streams: retry once in software (never after a cancel).
    if (result.code !== 0 && !signal.aborted) {
      await cleanup();
      result = await attempt(false);
    }
    if (result.code !== 0) throw new Error(`ffmpeg exited with code ${result.code}: ${result.stderr.trim().split(/\r?\n/).slice(-2).join(" ")}`);
    await fs.rename(part, outPath);
    if (previewPart && previewPath) await fs.rename(previewPart, previewPath);
  } catch (error) {
    await cleanup();
    throw error;
  }
  const out = await probeMediaFile(outPath);
  const stat = await fs.stat(outPath);
  if (!out?.hasVideo || !out.width || !out.height) throw new Error("The finished proxy could not be read back.");
  onProgress(1);
  return {
    outPath,
    ...(previewPath ? { previewPath } : {}),
    width: out.width,
    height: out.height,
    duration: out.duration ?? duration,
    frameRate: out.frameRate ?? probe.frameRate ?? 0,
    codec: out.videoCodec ?? (job.profile.codec.startsWith("prores") ? "prores" : job.profile.codec.startsWith("dnxhr") ? "dnxhd" : "h264"),
    fileSize: stat.size,
  };
}
