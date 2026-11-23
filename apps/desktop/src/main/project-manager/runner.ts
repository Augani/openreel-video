import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../../../../../packages/core/src/types/project";
import {
  type DiskInfo,
  type ItemResult,
  type PlannedItem,
  type ProjectManagerEstimate,
  type ProjectManagerOptions,
  type ProjectManagerPlan,
  applyPlan,
  estimateItemBytes,
  estimatePlan,
  planProjectManager,
} from "../../../../../packages/core/src/project-manager";
import { hashString } from "../../../../../packages/core/src/render-cache/segment-hash";
import { probeMediaFile, type MediaProbe } from "../ingest/probe-media";
import { runFfmpeg } from "../ingest/proxy-runner";
import { buildConsolidateArgs, presetCodecArgs, proxyCodecArgs } from "./ffmpeg-args";

export type ProjectManagerPhase = "scanning" | "running" | "finalizing" | "done" | "error" | "cancelled";

export interface ProjectManagerEvent {
  jobId: string;
  phase: ProjectManagerPhase;
  /** 0..1 of the whole job. */
  fraction: number;
  label: string;
  itemIndex: number;
  itemCount: number;
  destDir?: string;
  projectPath?: string;
  error?: string;
  summary?: ProjectManagerSummary;
}

export interface ProjectManagerSummary {
  destDir: string;
  projectPath: string;
  files: number;
  bytes: number;
  transcoded: number;
  copied: number;
  skipped: number;
  warnings: string[];
}

export interface ScanResult {
  project: Project;
  plan: ProjectManagerPlan;
  estimate: ProjectManagerEstimate;
  probes: Record<string, MediaProbe | null>;
}

/** Everything the run needs from the app that is not on disk: the render cache location. */
export interface RunnerDeps {
  /** Folder holding every project's render files (the scratch disk's cache folder). */
  renderCacheRoot?: string;
  threads?: number;
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else total += (await fs.stat(full).catch(() => null))?.size ?? 0;
  }
  return total;
}

export async function renderCacheDirInfo(root: string, projectId: string): Promise<{ dir: string; bytes: number } | null> {
  const dir = path.join(root, `p${hashString(projectId)}`);
  const bytes = await dirBytes(dir);
  return bytes > 0 ? { dir, bytes } : null;
}

/** Parse the project the renderer sends (the JSON the editor saves). */
export function parseProject(json: string): Project {
  const parsed = JSON.parse(json) as Project | { project?: Project };
  const project = (parsed as { project?: Project }).project && !(parsed as Project).mediaLibrary ? (parsed as { project: Project }).project : (parsed as Project);
  if (!project?.mediaLibrary || !Array.isArray(project.mediaLibrary.items)) throw new Error("That is not an OpenReel project.");
  return project;
}

async function diskInfoFor(item: Project["mediaLibrary"]["items"][number], probes: Record<string, MediaProbe | null>, signal?: AbortSignal): Promise<DiskInfo> {
  const p = item.nativeSource?.path || item.sourceFile?.path;
  if (!p) return { exists: false };
  const stat = await fs.stat(p).catch(() => null);
  if (!stat?.isFile()) return { exists: false };
  let probe: MediaProbe | null = null;
  if (item.type !== "image") {
    probe = await probeMediaFile(p, signal);
    probes[item.id] = probe;
  }
  const proxy = item.proxy?.storage === "path" ? item.proxy : undefined;
  const proxyStat = proxy ? await fs.stat(proxy.path).catch(() => null) : null;
  const twin = proxy?.previewPath ? await fs.stat(proxy.previewPath).catch(() => null) : null;
  return {
    exists: true,
    size: stat.size,
    ...(probe?.width ? { width: probe.width } : {}),
    ...(probe?.height ? { height: probe.height } : {}),
    ...(probe?.frameRate ? { fps: probe.frameRate } : {}),
    ...(probe?.duration ? { duration: probe.duration } : {}),
    ...(probe ? { hasVideo: probe.hasVideo, hasAudio: probe.hasAudio } : {}),
    ...(probe?.videoCodec ? { videoCodec: probe.videoCodec } : {}),
    ...(probe?.audioStreams?.[0] ? { audioChannels: probe.audioStreams[0].channels, sampleRate: probe.audioStreams[0].sampleRate } : {}),
    ...(proxyStat?.isFile() ? { proxySize: proxyStat.size } : {}),
    ...(twin?.isFile() ? { previewSize: twin.size } : {}),
  };
}

/** Read the files the project names, then plan and estimate. Nothing is written. */
export async function scanProject(project: Project, options: ProjectManagerOptions, renderBytes: number, signal?: AbortSignal): Promise<ScanResult> {
  const probes: Record<string, MediaProbe | null> = {};
  const disk: Record<string, DiskInfo> = {};
  // Probe in small batches: each probe is one short ffmpeg process.
  const items = project.mediaLibrary.items.filter((item) => !item.subclip);
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(items.slice(i, i + 4).map(async (item) => { disk[item.id] = await diskInfoFor(item, probes, signal); }));
    signal?.throwIfAborted();
  }
  const plan = planProjectManager(project, options, disk);
  return { project, plan, estimate: estimatePlan(plan, renderBytes), probes };
}

/** Free bytes on the volume that will hold `dir` (the nearest folder that exists). */
export async function freeBytesFor(dir: string): Promise<number | null> {
  let probe = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    try {
      const st = await fs.statfs(probe);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
  return null;
}

async function uniqueDir(parent: string, name: string): Promise<string> {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "Project";
  for (let n = 0; ; n++) {
    const dir = path.join(parent, n === 0 ? safe : `${safe} ${n + 1}`);
    try {
      await fs.mkdir(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

/** Copy with progress to a `.part` file that is renamed when whole. The source is only read. */
async function copyFileWithProgress(src: string, dest: string, onBytes: (bytes: number) => void, signal: AbortSignal): Promise<void> {
  const part = `${dest}.part`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(
      createReadStream(src, { signal }),
      new Transform({ transform(chunk: Buffer, _enc, cb) { onBytes(chunk.length); cb(null, chunk); } }),
      createWriteStream(part, { flags: "wx" }),
      { signal },
    );
    await fs.rename(part, dest);
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function copyTree(src: string, dest: string, signal: AbortSignal): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    signal.throwIfAborted();
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(from, to, signal);
    else if (entry.isFile() && !entry.name.endsWith(".tmp")) await fs.copyFile(from, to);
  }
}

interface Step {
  weight: number;
  label: string;
  run: (progress: (fraction: number) => void) => Promise<void>;
}

export interface RunInput {
  project: Project;
  options: ProjectManagerOptions;
  /** Parent folder; the project folder is created inside it. */
  destParent: string;
  projectName?: string;
}

export interface ProjectManagerJob {
  jobId: string;
  done: Promise<ProjectManagerSummary>;
  cancel(): void;
}

/** Start a Project Manager run. Events report progress; `done` settles with the summary (or rejects when cancelled or failed). */
export function startProjectManagerJob(input: RunInput, emit: (event: ProjectManagerEvent) => void, deps: RunnerDeps = {}): ProjectManagerJob {
  const jobId = randomUUID();
  const controller = new AbortController();
  const signal = controller.signal;
  let itemIndex = 0;
  let itemCount = 0;
  const send = (phase: ProjectManagerPhase, fraction: number, label: string, extra: Partial<ProjectManagerEvent> = {}): void =>
    emit({ jobId, phase, fraction: Math.max(0, Math.min(1, fraction)), label, itemIndex, itemCount, ...extra });

  const done = (async (): Promise<ProjectManagerSummary> => {
    let destDir = "";
    try {
      send("scanning", 0, "Reading the media");
      const cacheInfo = input.options.includeRenderFiles && !(input.options.mode === "consolidate" && input.options.trim)
        ? (deps.renderCacheRoot ? await renderCacheDirInfo(deps.renderCacheRoot, input.project.id) : null)
        : null;
      const scan = await scanProject(input.project, input.options, cacheInfo?.bytes ?? 0, signal);
      const { plan, probes } = scan;

      // Never read from and write to the same place, and make sure the disk can hold the result.
      await fs.mkdir(input.destParent, { recursive: true });
      const free = await freeBytesFor(input.destParent);
      const need = Math.round(scan.estimate.totalBytes * 1.25) + 8 * 1024 * 1024;
      if (free !== null && free < need) {
        throw new Error(`Not enough disk space: about ${Math.ceil(need / 1e6)} MB needed, ${Math.floor(free / 1e6)} MB free.`);
      }
      destDir = await uniqueDir(input.destParent, input.projectName ?? input.project.name);
      const newProjectId = randomUUID();

      const steps: Step[] = [];
      const results: Record<string, ItemResult> = {};
      const threads = deps.threads ?? Math.max(1, Math.floor(os.availableParallelism() / 2));
      const abs = (rel: string): string => path.join(destDir, ...rel.split("/"));
      let bytesDone = 0;

      const runFfmpegStep = async (args: string[], total: number, progress: (f: number) => void): Promise<void> => {
        const out = await runFfmpeg(args, (seconds) => progress(total > 0 ? Math.min(0.99, seconds / total) : 0), signal);
        if (out.code !== 0) throw new Error(`ffmpeg exited with code ${out.code}: ${out.stderr.trim().split(/\r?\n/).slice(-2).join(" ")}`);
      };

      for (const item of plan.items) {
        if (item.action === "offline" || !item.srcPath) continue;
        const weight = Math.max(1, estimateItemBytes(item) + (item.proxy ? item.proxy.size + item.proxy.previewSize : 0));
        steps.push({
          weight,
          label: item.name,
          run: async (progress) => {
            const probe = probes[item.mediaId];
            const outPath = abs(item.outRel);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            if (item.action === "copy") {
              const size = item.info.size ?? 1;
              let copied = 0;
              await copyFileWithProgress(item.srcPath as string, outPath, (n) => { copied += n; progress(Math.min(0.99, copied / size * (item.proxy ? 0.8 : 1))); }, signal);
              results[item.mediaId] = { outPath, size: (await fs.stat(outPath)).size, duration: item.info.duration ?? item.sourceDuration };
            } else {
              const frame = { width: probe?.width ?? item.info.width ?? 1920, height: probe?.height ?? item.info.height ?? 1080, fps: item.fps };
              const codec = item.audioOnly
                ? { video: [], audio: item.conformAudio ? ["-c:a", "pcm_s24le", "-ar", "48000"] : ["-c:a", "pcm_s16le"], format: "wav" as const }
                : presetCodecArgs(item.preset!, frame, item.conformAudio);
              const part = `${outPath}.part`;
              await runFfmpegStep(
                buildConsolidateArgs({ srcPath: item.srcPath as string, outPath: part, codec, segments: item.segments, fps: item.fps, hasVideo: Boolean(probe?.hasVideo) && !item.audioOnly, audioStreams: probe?.audioStreams?.length ?? (probe?.hasAudio ? 1 : 0), threads }),
                item.keptSeconds,
                (f) => progress(f * (item.proxy ? 0.8 : 1)),
              ).catch(async (error) => { await fs.rm(part, { force: true }); throw error; });
              await fs.rename(part, outPath);
              const out = await probeMediaFile(outPath);
              results[item.mediaId] = {
                outPath,
                size: (await fs.stat(outPath)).size,
                duration: out?.duration ?? item.keptSeconds,
                ...(out?.width ? { width: out.width, height: out.height } : {}),
                ...(out?.frameRate ? { frameRate: out.frameRate } : {}),
                ...(out?.videoCodec ? { codec: out.videoCodec } : {}),
              };
            }
            if (item.proxy) await runProxy(item, results[item.mediaId], progress);
            progress(1);
          },
        });
      }

      const runProxy = async (item: PlannedItem, result: ItemResult, progress: (f: number) => void): Promise<void> => {
        const proxy = item.proxy;
        if (!proxy) return;
        const outPath = abs(proxy.outRel);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        const copyOne = async (src: string, dest: string, size: number, from: number, span: number): Promise<void> => {
          let copied = 0;
          await copyFileWithProgress(src, dest, (n) => { copied += n; progress(from + span * Math.min(1, copied / Math.max(1, size))); }, signal);
        };
        if (proxy.action === "copy") {
          await copyOne(proxy.srcPath, outPath, proxy.size, 0.8, 0.2);
          if (proxy.previewSrcPath && proxy.previewOutRel) await copyOne(proxy.previewSrcPath, abs(proxy.previewOutRel), proxy.previewSize, 0.8, 0.2);
        } else {
          // The proxy has the media's own frame grid, so the same kept stretches cut it identically.
          const probe = await probeMediaFile(proxy.srcPath, signal);
          const part = `${outPath}.part`;
          await runFfmpegStep(
            buildConsolidateArgs({ srcPath: proxy.srcPath, outPath: part, codec: proxyCodecArgs(proxy.codec), segments: item.segments, fps: item.fps, hasVideo: Boolean(probe?.hasVideo), audioStreams: Math.min(1, probe?.audioStreams?.length ?? 0), threads }),
            item.keptSeconds,
            (f) => progress(0.8 + f * 0.2),
          ).catch(async (error) => { await fs.rm(part, { force: true }); throw error; });
          await fs.rename(part, outPath);
          if (proxy.previewSrcPath && proxy.previewOutRel) {
            const twinPart = `${abs(proxy.previewOutRel)}.part`;
            await runFfmpegStep(
              buildConsolidateArgs({ srcPath: proxy.previewSrcPath, outPath: twinPart, codec: proxyCodecArgs("h264"), segments: item.segments, fps: item.fps, hasVideo: true, audioStreams: 1, threads }),
              item.keptSeconds,
              () => undefined,
            ).catch(async (error) => { await fs.rm(twinPart, { force: true }); throw error; });
            await fs.rename(twinPart, abs(proxy.previewOutRel));
          }
        }
        results[item.mediaId] = {
          ...result,
          proxyPath: outPath,
          ...(proxy.previewOutRel ? { proxyPreviewPath: abs(proxy.previewOutRel) } : {}),
          proxySize: (await fs.stat(outPath)).size + (proxy.previewOutRel ? (await fs.stat(abs(proxy.previewOutRel)).catch(() => null))?.size ?? 0 : 0),
        };
      };

      if (cacheInfo) {
        steps.push({
          weight: Math.max(1, cacheInfo.bytes),
          label: "Render files",
          run: async () => {
            // Stored under the NEW project's cache key, so the copy finds them when it is opened.
            const newKey = `p${hashString(newProjectId)}`;
            await copyTree(cacheInfo.dir, path.join(destDir, "Render Cache", newKey), signal);
          },
        });
      }

      const totalWeight = steps.reduce((sum, s) => sum + s.weight, 0) || 1;
      itemCount = steps.length;
      for (const step of steps) {
        signal.throwIfAborted();
        itemIndex += 1;
        const base = bytesDone / totalWeight;
        send("running", base * 0.97, step.label);
        await step.run((f) => send("running", (base + (step.weight * f) / totalWeight) * 0.97, step.label));
        bytesDone += step.weight;
      }

      signal.throwIfAborted();
      send("finalizing", 0.98, "Writing the project");
      const name = input.projectName ?? input.project.name;
      const rewritten = applyPlan(input.project, plan, results, { projectId: newProjectId, projectName: name, now: Date.now() });
      const projectPath = path.join(destDir, `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "Project"}.oreel`);
      await fs.writeFile(`${projectPath}.part`, JSON.stringify(rewritten, null, 2));
      await fs.rename(`${projectPath}.part`, projectPath);

      const files = await countFiles(destDir);
      const summary: ProjectManagerSummary = {
        destDir,
        projectPath,
        files: files.count,
        bytes: files.bytes,
        transcoded: plan.items.filter((i) => i.action === "transcode").length,
        copied: plan.items.filter((i) => i.action === "copy").length,
        skipped: plan.items.filter((i) => i.action === "offline").length,
        warnings: plan.warnings,
      };
      send("done", 1, "Done", { destDir, projectPath, summary });
      return summary;
    } catch (error) {
      // Only what this run created goes: the folder it made, never anything it read.
      if (destDir) await fs.rm(destDir, { recursive: true, force: true }).catch(() => undefined);
      if (signal.aborted) {
        send("cancelled", 0, "Cancelled");
        throw new DOMException("aborted", "AbortError");
      }
      const message = error instanceof Error ? error.message : String(error);
      send("error", 0, "Failed", { error: message });
      throw error;
    }
  })();
  // A rejected `done` that nobody awaits (the renderer reads events) must not crash the process.
  done.catch(() => undefined);
  return { jobId, done, cancel: () => controller.abort() };
}

async function countFiles(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await countFiles(full);
      count += sub.count;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      count += 1;
      bytes += (await fs.stat(full)).size;
    }
  }
  return { count, bytes };
}
