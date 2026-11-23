import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFfmpegProbe } from "../ingest/probe-media";

/**
 * ffmpeg helpers of the Media Browser: probing, thumbnails and hover-scrub frames, preview
 * transcodes, and lossless joining of a recording the camera split into several files. Source media
 * is only ever read; everything written lands in `cacheDir`.
 */

export interface ClipRef {
  name: string;
  kind: string;
  segments: Array<{ path: string; audioPaths?: string[] }>;
}

export interface ToolContext {
  ffmpegPath: string;
  /** Where previews and joined files are written. */
  cacheDir: string;
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function run(ffmpegPath: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const onAbort = (): void => {
      proc.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    proc.on("error", reject);
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout: Buffer.concat(out), stderr });
    });
  });
}

/** Run at most `limit` jobs at a time. */
function limiter(limit: number): <T>(job: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = (): void => {
    active--;
    waiting.shift()?.();
  };
  return async <T>(job: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await job();
    } finally {
      next();
    }
  };
}
const thumbLimit = limiter(3);

const durationCache = new Map<string, number>();

/** Duration in seconds of one file (0 when unknown). */
export async function probeDuration(ctx: ToolContext, file: string): Promise<number> {
  const stat = await fs.stat(file);
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  const cached = durationCache.get(key);
  if (cached !== undefined) return cached;
  const { stderr } = await run(ctx.ffmpegPath, ["-hide_banner", "-nostdin", "-i", file]);
  const duration = parseFfmpegProbe(stderr).duration ?? 0;
  durationCache.set(key, duration);
  return duration;
}

export interface ClipProbe {
  duration: number;
  segmentDurations: number[];
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: string;
}

/** Total duration (the sum of the segments) and the first segment's picture format. */
export async function probeClip(ctx: ToolContext, clip: ClipRef): Promise<ClipProbe> {
  const segmentDurations: number[] = [];
  for (const segment of clip.segments) segmentDurations.push(await probeDuration(ctx, segment.path));
  const { stderr } = await run(ctx.ffmpegPath, ["-hide_banner", "-nostdin", "-i", clip.segments[0].path]);
  const first = parseFfmpegProbe(stderr);
  return { duration: segmentDurations.reduce((a, b) => a + b, 0), segmentDurations, width: first.width, height: first.height, frameRate: first.frameRate, videoCodec: first.videoCodec };
}

const dataUrl = (jpeg: Buffer): string => `data:image/jpeg;base64,${jpeg.toString("base64")}`;

/** One JPEG frame (as a data URL) of a file at `time` seconds, `width` px wide; null when none could be read. */
export async function thumbnailOf(ctx: ToolContext, file: string, time: number, width: number): Promise<string | null> {
  return thumbLimit(async () => {
    const attempt = async (seek: number): Promise<Buffer | null> => {
      const args = ["-hide_banner", "-nostdin", "-loglevel", "error", ...(seek > 0 ? ["-ss", seek.toFixed(3)] : []), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "-"];
      const result = await run(ctx.ffmpegPath, args).catch(() => null);
      return result && result.stdout.length > 100 ? result.stdout : null;
    };
    const frame = (await attempt(time)) ?? (time > 0 ? await attempt(0) : null);
    return frame ? dataUrl(frame) : null;
  });
}

/** Evenly spaced frames across the whole clip (spanned clips included) for hover scrubbing. */
export async function filmstripOf(ctx: ToolContext, clip: ClipRef, count: number, width: number): Promise<{ duration: number; frames: Array<string | null> }> {
  const probe = await probeClip(ctx, clip);
  const total = probe.duration;
  const jobs: Array<Promise<string | null>> = [];
  for (let i = 0; i < count; i++) {
    let t = total > 0 ? ((i + 0.5) / count) * total : 0;
    let index = 0;
    while (index < clip.segments.length - 1 && t >= probe.segmentDurations[index]) {
      t -= probe.segmentDurations[index];
      index++;
    }
    jobs.push(thumbnailOf(ctx, clip.segments[index].path, Math.max(0, t), width));
  }
  return { duration: total, frames: await Promise.all(jobs) };
}

const sh = (p: string): string => `'${p.replace(/'/g, "'\\''")}'`;

async function writeConcatList(dir: string, files: string[], tag: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const list = path.join(dir, `${tag}.txt`);
  await fs.writeFile(list, files.map((f) => `file ${sh(f)}\n`).join(""), "utf8");
  return list;
}

async function clipKey(clip: ClipRef, extra: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(extra);
  for (const segment of clip.segments) {
    for (const file of [segment.path, ...(segment.audioPaths ?? [])]) {
      const stat = await fs.stat(file).catch(() => null);
      hash.update(`${file}|${stat?.size ?? 0}|${stat?.mtimeMs ?? 0}\n`);
    }
  }
  return hash.digest("hex").slice(0, 24);
}

const extOf = (file: string): string => path.extname(file).toLowerCase() || ".mp4";

export interface JoinResult {
  path: string;
  /** File name to import under (the clip's name plus the container extension). */
  name: string;
  duration: number;
  joined: boolean;
}

/**
 * The file to import for a clip. One segment: the original, untouched. Several: the segments joined
 * losslessly (stream copy, no re-encode) into one file in the cache, built once and reused.
 */
export async function prepareClipFile(ctx: ToolContext, clip: ClipRef, signal?: AbortSignal): Promise<JoinResult> {
  if (clip.segments.length === 1 && !(clip.segments[0].audioPaths?.length)) {
    const only = clip.segments[0].path;
    return { path: only, name: path.basename(only), duration: await probeDuration(ctx, only), joined: false };
  }
  const key = await clipKey(clip, "join1");
  const joinDir = path.join(ctx.cacheDir, "joined");
  await fs.mkdir(joinDir, { recursive: true });
  const first = clip.segments[0].path;
  const hasAudioFiles = clip.segments.some((s) => s.audioPaths?.length);
  const candidates = clip.kind === "panasonic-p2" ? [".mxf", ".mov"] : [extOf(first)];
  const lists = path.join(ctx.cacheDir, "lists");
  let lastError = "";
  for (const ext of candidates) {
    const out = path.join(joinDir, `${key}${ext}`);
    const done = await fs.stat(out).then((s) => s.size > 0, () => false);
    if (!done) {
      const part = path.join(joinDir, `${key}.part${ext}`);
      const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", await writeConcatList(lists, clip.segments.map((s) => s.path), `${key}-v`)];
      if (hasAudioFiles) {
        const channels = Math.max(...clip.segments.map((s) => s.audioPaths?.length ?? 0));
        for (let c = 0; c < channels; c++) {
          const files = clip.segments.map((s) => s.audioPaths?.[c]).filter((f): f is string => !!f);
          if (files.length !== clip.segments.length) break;
          args.push("-f", "concat", "-safe", "0", "-i", await writeConcatList(lists, files, `${key}-a${c}`));
        }
        args.push("-map", "0:v:0");
        const inputs = args.filter((a) => a === "-i").length;
        for (let i = 1; i < inputs; i++) args.push("-map", `${i}:a:0`);
      } else args.push("-map", "0:v:0", "-map", "0:a?");
      args.push("-c", "copy", ...(ext === ".mp4" || ext === ".mov" ? ["-movflags", "+faststart"] : []), ...(ext === ".mts" || ext === ".m2ts" ? ["-f", "mpegts"] : []), part);
      const result = await run(ctx.ffmpegPath, args, signal);
      if (result.code !== 0) {
        lastError = result.stderr.split("\n").filter(Boolean).slice(-2).join(" ");
        await fs.rm(part, { force: true });
        continue;
      }
      await fs.rename(part, out);
    }
    const duration = await probeDuration(ctx, out);
    return { path: out, name: `${clip.name}${ext}`, duration, joined: true };
  }
  throw new Error(`The clip's ${clip.segments.length} files could not be joined${lastError ? `: ${lastError}` : "."}`);
}

export interface PreviewResult {
  path: string;
  duration: number;
  /** Only the first part of a long clip is transcoded. */
  truncated: boolean;
}

export const PREVIEW_MAX_SECONDS = 300;

/** A small H.264 stand-in for the Source monitor: 360p, fast encode, the segments played back to back. */
export async function buildPreview(ctx: ToolContext, clip: ClipRef, signal?: AbortSignal): Promise<PreviewResult> {
  const key = await clipKey(clip, "preview1");
  const dir = path.join(ctx.cacheDir, "previews");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${key}.mp4`);
  const probe = await probeClip(ctx, clip);
  const truncated = probe.duration > PREVIEW_MAX_SECONDS;
  const reported = Math.min(probe.duration, PREVIEW_MAX_SECONDS);
  if (await fs.stat(out).then((s) => s.size > 0, () => false)) return { path: out, duration: reported, truncated };
  const part = path.join(dir, `${key}.part.mp4`);
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
  const lists = path.join(ctx.cacheDir, "lists");
  args.push("-f", "concat", "-safe", "0", "-i", await writeConcatList(lists, clip.segments.map((s) => s.path), `${key}-pv`));
  const audioChannels = Math.min(2, Math.min(...clip.segments.map((s) => s.audioPaths?.length ?? 0)));
  for (let c = 0; c < audioChannels; c++) {
    args.push("-f", "concat", "-safe", "0", "-i", await writeConcatList(lists, clip.segments.map((s) => s.audioPaths![c]), `${key}-pa${c}`));
  }
  args.push("-t", String(PREVIEW_MAX_SECONDS), "-map", "0:v:0");
  if (audioChannels === 2) args.push("-filter_complex", "[1:a:0][2:a:0]amerge=inputs=2[pa]", "-map", "[pa]");
  else if (audioChannels === 1) args.push("-map", "1:a:0");
  else args.push("-map", "0:a:0?");
  args.push("-vf", "scale=-2:360,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", part);
  const result = await run(ctx.ffmpegPath, args, signal);
  if (result.code !== 0) {
    await fs.rm(part, { force: true });
    throw new Error(`The preview could not be made: ${result.stderr.split("\n").filter(Boolean).slice(-2).join(" ")}`);
  }
  await fs.rename(part, out);
  return { path: out, duration: reported, truncated };
}
