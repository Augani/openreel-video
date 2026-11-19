import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desktopPreviewTwinName } from "../../../../../packages/core/src/media/desktop-ingest";
import { isIntermediateProxyCodec } from "../../../../../packages/core/src/media/proxy-presets";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";
import { buildProxyArgs, parseProgressSeconds } from "./proxy-args";
import { probeMediaFile } from "./probe-media";
import type { ProxyJob, ProxyJobResult } from "./proxy-queue";

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

interface SpawnResult {
  code: number | null;
  stderr: string;
}

function runFfmpeg(args: string[], onSeconds: (seconds: number) => void, signal: AbortSignal): Promise<SpawnResult> {
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
 * Build one proxy with the ffmpeg sidecar. Output goes to a `.part` file and is renamed when ffmpeg
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
  const part = `${outPath}.part`;
  const previewPart = previewPath ? `${previewPath}.part` : undefined;
  const cleanup = async (): Promise<void> => {
    await Promise.all([fs.rm(part, { force: true }), previewPart ? fs.rm(previewPart, { force: true }) : undefined]);
  };
  await cleanup();
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
      }),
      (seconds) => {
        if (duration > 0) onProgress(Math.min(0.99, seconds / duration));
      },
      signal,
    );
  try {
    let result = await attempt(true);
    // Hardware decode can fail on odd streams: retry once in software.
    if (result.code !== 0) {
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
    codec: out.videoCodec ?? (job.profile.codec === "prores-proxy" ? "prores" : job.profile.codec === "dnxhr-lb" ? "dnxhd" : "h264"),
    fileSize: stat.size,
  };
}
