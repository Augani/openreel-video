import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildProxyArgs,
  buildTranscodeArgs,
  buildExtractAudioArgs,
  MediaJob,
  runWithHwaccelFallback,
  type ProxyPreset,
  type TranscodeContainer,
} from "../sidecar/media-job";
import { getBestH264Encoder, isHardwareEncoder } from "../sidecar/encoder-probe";
import { newTempPathReady } from "../temp-dir";
import { probeAudioStreams as probe, type AudioStreamInfo } from "../sidecar/probe-streams";

function tmpPath(ext: string): Promise<string> {
  return newTempPathReady("openreel", ext);
}

export async function generateProxy(args: {
  srcPath: string;
  preset: ProxyPreset;
}): Promise<{ outPath: string }> {
  const outPath = await tmpPath("mp4");
  const encoder = await getBestH264Encoder();
  await runWithHwaccelFallback(
    buildProxyArgs(args.srcPath, outPath, args.preset, encoder),
    isHardwareEncoder(encoder) ? buildProxyArgs(args.srcPath, outPath, args.preset, "libx264") : undefined,
  );
  return { outPath };
}

export async function transcode(args: {
  srcPath: string;
  container: TranscodeContainer;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}): Promise<{ outPath: string }> {
  const outPath = await tmpPath(args.container);
  const encoder = await getBestH264Encoder();
  const opts = {
    container: args.container,
    videoBitrateKbps: args.videoBitrateKbps,
    audioBitrateKbps: args.audioBitrateKbps,
  };
  await runWithHwaccelFallback(
    buildTranscodeArgs(args.srcPath, outPath, opts, encoder),
    isHardwareEncoder(encoder) ? buildTranscodeArgs(args.srcPath, outPath, opts, "libx264") : undefined,
  );
  return { outPath };
}

export async function extractAudioWav(args: {
  srcPath: string;
  streamIndex?: number;
  channels?: number;
}): Promise<{ outPath: string }> {
  const outPath = await tmpPath("wav");
  await new MediaJob(buildExtractAudioArgs(args.srcPath, outPath, args.streamIndex, args.channels)).run();
  return { outPath };
}

export async function probeAudioStreams(args: {
  srcPath: string;
}): Promise<{ streams: AudioStreamInfo[] }> {
  return { streams: await probe(args.srcPath) };
}

const execFileAsync = promisify(execFile);
const SIPS = "/usr/bin/sips";

/** Output of `sips -g pixelWidth -g pixelHeight`. */
export function parseSipsSize(output: string): { width: number; height: number } | null {
  const width = /pixelWidth:\s*(\d+)/.exec(output);
  const height = /pixelHeight:\s*(\d+)/.exec(output);
  return width && height ? { width: Number(width[1]), height: Number(height[1]) } : null;
}

/**
 * Proprietary camera RAW (CR2/CR3/NEF/ARW/RAF/...): developed by macOS ImageIO through `sips` into a PNG the
 * renderer can decode. Apple's engine picks white balance and tone; OpenReel's RAW Source Settings cannot
 * change it. Other platforms have no such decoder and report a clear error (convert to DNG instead).
 */
export async function developRawStill(args: { srcPath: string }): Promise<{ outPath: string; width: number; height: number }> {
  if (process.platform !== "darwin") {
    throw new Error("This camera format can only be decoded on macOS (ImageIO). Convert it to DNG to import it here.");
  }
  // The path comes from the renderer: refuse anything sips could read as an option or that is not a plain file path.
  if (!path.isAbsolute(args.srcPath) || args.srcPath.includes("\0")) {
    throw new Error("The RAW file path must be absolute.");
  }
  const outPath = await tmpPath("png");
  // execFile, no shell: the path is passed as one argument and never interpreted.
  await execFileAsync(SIPS, ["-s", "format", "png", args.srcPath, "--out", outPath], { timeout: 120_000 });
  const { stdout } = await execFileAsync(SIPS, ["-g", "pixelWidth", "-g", "pixelHeight", outPath], { timeout: 30_000 });
  const size = parseSipsSize(stdout);
  if (!size) throw new Error("macOS could not decode this RAW file.");
  return { outPath, ...size };
}
