import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { MediaProbe } from "../ingest/probe-media";
import type { WatchExportPresetId } from "../../shared/watch-folders";

/**
 * Headless render for export watch folders: a dropped media file is re-encoded to an export preset by
 * the bundled ffmpeg in the main process. No window, no editor and no open project are involved, so it
 * never touches what the user is working on. (Project files go through the editor's export queue instead,
 * see project-render.ts.)
 *
 * The preset ids and numbers are the Export dialog's quick presets (apps/web/src/services/quick-export-presets.ts).
 */

export interface WatchVideoPreset {
  kind: "video";
  label: string;
  /** Fixed output size, or null to keep the source's size. */
  size: { width: number; height: number } | null;
  /** Fixed frame rate, or null to keep the source's. */
  frameRate: number | null;
  videoKbps: number;
}
export interface WatchAudioPreset {
  kind: "audio";
  label: string;
}
export type WatchPreset = WatchVideoPreset | WatchAudioPreset;

export const WATCH_PRESETS: Record<WatchExportPresetId, WatchPreset> = {
  mp4: { kind: "video", label: "MP4 Standard (source size)", size: null, frameRate: null, videoKbps: 12000 },
  "1080p-high": { kind: "video", label: "1080p High Quality", size: { width: 1920, height: 1080 }, frameRate: 30, videoKbps: 20000 },
  "1080p-60": { kind: "video", label: "1080p 60fps", size: { width: 1920, height: 1080 }, frameRate: 60, videoKbps: 25000 },
  "4k": { kind: "video", label: "4K Standard", size: { width: 3840, height: 2160 }, frameRate: 30, videoKbps: 50000 },
  wav: { kind: "audio", label: "Audio Only (WAV)" },
};

export const isWatchPresetId = (id: string): id is WatchExportPresetId => Object.prototype.hasOwnProperty.call(WATCH_PRESETS, id);

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "m4v", "mov", "mkv", "webm", "avi", "mxf", "mts", "m2ts", "ts", "mpg", "mpeg", "wmv", "flv", "3gp", "ogv"]);
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "aif", "aiff", "wma", "caf"]);
export const PROJECT_EXTENSIONS: ReadonlySet<string> = new Set(["oreel", "openreel"]);

export const extensionOf = (file: string): string => path.extname(file).slice(1).toLowerCase();

export type WatchFileKind = "video" | "audio" | "project" | "other";
export function classifyFile(file: string): WatchFileKind {
  const ext = extensionOf(file);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (PROJECT_EXTENSIONS.has(ext)) return "project";
  return "other";
}

export interface RenderPlan {
  /** Output extension without the dot. */
  ext: string;
  args: string[];
}

/** ffmpeg arguments that render `src` into `out` for `presetId`. Throws a readable message when the source cannot make that output. */
export function buildWatchRenderArgs(
  presetId: WatchExportPresetId,
  src: string,
  out: string,
  source: Pick<MediaProbe, "hasVideo" | "hasAudio">,
  videoEncoder = "libx264",
): RenderPlan {
  const preset = WATCH_PRESETS[presetId];
  const base = ["-y", "-nostdin", "-i", src, "-map_metadata", "0"];
  if (preset.kind === "audio") {
    if (!source.hasAudio) throw new Error("The file has no audio to export.");
    return { ext: "wav", args: [...base, "-vn", "-map", "0:a:0", "-c:a", "pcm_s24le", "-ar", "48000", "-ac", "2", "-progress", "pipe:2", out] };
  }
  if (!source.hasVideo) {
    if (!source.hasAudio) throw new Error("The file has neither video nor audio.");
    // An audio file under a video preset becomes an AAC audio file rather than an empty video.
    return { ext: "m4a", args: [...base, "-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-progress", "pipe:2", out] };
  }
  const filters: string[] = [];
  if (preset.size) {
    const { width, height } = preset.size;
    filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, "setsar=1");
  } else {
    // Even dimensions: H.264 4:2:0 refuses odd ones.
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  }
  if (preset.frameRate) filters.push(`fps=${preset.frameRate}`);
  const args = [...base, "-map", "0:v:0", ...(source.hasAudio ? ["-map", "0:a:0"] : []), "-vf", filters.join(","), "-c:v", videoEncoder, "-b:v", `${preset.videoKbps}k`, "-pix_fmt", "yuv420p"];
  if (videoEncoder === "libx264") args.push("-preset", "medium");
  if (source.hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  args.push("-movflags", "+faststart", "-progress", "pipe:2", out);
  return { ext: "mp4", args };
}

/** Parses the newest `out_time_us` / `out_time_ms` (both are microseconds in ffmpeg's progress output) as seconds. */
export function parseOutTimeSeconds(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_(?:us|ms)=(\d+)/g)];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]) / 1_000_000;
}

export function uniquePath(dir: string, base: string, ext: string, exists: (p: string) => boolean = fs.existsSync): string {
  const dot = ext ? `.${ext}` : "";
  let candidate = path.join(dir, `${base}${dot}`);
  for (let i = 1; exists(candidate); i++) candidate = path.join(dir, `${base}-${i}${dot}`);
  return candidate;
}

export interface RenderDeps {
  ffmpegPath(): string;
  probe(file: string): Promise<Pick<MediaProbe, "duration" | "hasVideo" | "hasAudio">>;
  videoEncoder(): Promise<string>;
  isHardwareEncoder(encoder: string): boolean;
}

export interface RenderRequest {
  src: string;
  presetId: WatchExportPresetId;
  outputDir: string;
  onProgress(fraction: number | null): void;
  signal: AbortSignal;
}

function runFfmpeg(ffmpeg: string, args: string[], durationSec: number | undefined, onProgress: (f: number | null) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Cancelled"));
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    const onAbort = (): void => {
      proc.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    proc.stderr.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4096);
      const seconds = parseOutTimeSeconds(tail);
      if (seconds !== null && durationSec && durationSec > 0) onProgress(Math.min(0.99, seconds / durationSec));
    });
    proc.on("error", (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    proc.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) return reject(new Error("Cancelled"));
      if (code === 0) return resolve();
      const reason = tail.split("\n").map((line) => line.trim()).filter((line) => line && !/^(frame|fps|stream_|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress)=/.test(line)).slice(-2).join(" ");
      reject(new Error(`ffmpeg exited with code ${code}${reason ? `: ${reason}` : ""}`));
    });
  });
}

/**
 * Renders one file. The output is written under a hidden temporary name and renamed when ffmpeg
 * finishes, so nothing downstream ever sees a half-written file. Hardware encoders fall back to libx264
 * once. Returns the final output path.
 */
export async function renderMediaFile(request: RenderRequest, deps: RenderDeps): Promise<string> {
  const probe = await deps.probe(request.src);
  const base = path.basename(request.src, path.extname(request.src));
  await fs.promises.mkdir(request.outputDir, { recursive: true });
  const encoder = await deps.videoEncoder();
  const plan = buildWatchRenderArgs(request.presetId, request.src, "<out>", probe, encoder);
  const finalPath = uniquePath(request.outputDir, base, plan.ext);
  const partial = path.join(request.outputDir, `.${path.basename(finalPath)}.${process.pid}.partial.${plan.ext}`);
  const argsFor = (enc: string): string[] => buildWatchRenderArgs(request.presetId, request.src, partial, probe, enc).args;
  try {
    try {
      await runFfmpeg(deps.ffmpegPath(), argsFor(encoder), probe.duration, request.onProgress, request.signal);
    } catch (error) {
      if (request.signal.aborted || !deps.isHardwareEncoder(encoder)) throw error;
      await runFfmpeg(deps.ffmpegPath(), argsFor("libx264"), probe.duration, request.onProgress, request.signal);
    }
    const stat = await fs.promises.stat(partial);
    if (stat.size === 0) throw new Error("ffmpeg produced an empty file.");
    // Never replace a file that appeared while rendering.
    const target = fs.existsSync(finalPath) ? uniquePath(request.outputDir, base, plan.ext) : finalPath;
    await fs.promises.rename(partial, target);
    request.onProgress(1);
    return target;
  } finally {
    await fs.promises.rm(partial, { force: true }).catch(() => undefined);
  }
}
