import { MessageChannelMain, type WebContents, type MessagePortMain } from "electron";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ExportJob, type ExportArgs } from "../sidecar/export-job";
import { CfrWriter } from "../sidecar/cfr";
import { selectEncoder, probeEncoders } from "../sidecar/encoder-probe";
import type { ExportCodec, EncodeMode } from "../sidecar/encode-args";

export interface ExportStartArgs {
  width: number;
  height: number;
  frameRate: number;
  codec: string;
  format: string;
  bitrateKbps: number;
  outputPath: string;
  totalFrames: number;
  audioSampleRate: number;
  audioChannels: number;
  encodeMode?: "fast" | "balanced" | "smallest";
  quality?: number;
  proresProfile?: "proxy" | "lt" | "standard" | "hq" | "4444" | "4444xq";
}

const MAX_INITIAL_CREDITS = 10;
const MAX_IN_FLIGHT_FRAME_BYTES = 128 * 1024 * 1024;

interface JobEntry {
  job: ExportJob | null;
  cfr: CfrWriter | null;
  port: MessagePortMain;
  exportArgs: ExportArgs;
  audioWavPath: string;
  started: boolean;
  audioQueue: Promise<void>;
  queue: Promise<void>;
}

const jobs = new Map<string, JobEntry>();

export function initialFrameCredits(args: Pick<ExportArgs, "width" | "height">): number {
  const frameBytes = Math.max(1, args.width * args.height * 4);
  return Math.max(
    1,
    Math.min(MAX_INITIAL_CREDITS, Math.floor(MAX_IN_FLIGHT_FRAME_BYTES / frameBytes)),
  );
}

export function resolveExportArgs(
  args: ExportStartArgs,
  platform: NodeJS.Platform,
  encoders: string[],
  audioWavPath: string,
): ExportArgs {
  const mode: EncodeMode = args.encodeMode ?? "balanced";
  const encoder = selectEncoder(args.codec, platform, encoders, mode) ?? "libx264";
  const codec = (args.codec === "h265" ? "hevc" : args.codec) as ExportCodec;
  return {
    width: args.width,
    height: args.height,
    frameRate: args.frameRate,
    codec,
    encoder,
    mode,
    quality: args.quality ?? 80,
    bitrateKbps: args.bitrateKbps,
    outputPath: args.outputPath,
    audioWavPath,
    format: args.format,
    proresProfile: args.proresProfile,
  };
}

export async function startExport(wc: WebContents, args: ExportStartArgs): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  const encoders = await probeEncoders();
  const audioWavPath = path.join(os.tmpdir(), `openreel-${jobId}.wav`);
  const exportArgs = resolveExportArgs(args, process.platform, encoders, audioWavPath);

  const { port1, port2 } = new MessageChannelMain();
  const entry: JobEntry = {
    job: null,
    cfr: null,
    port: port1,
    exportArgs,
    audioWavPath,
    started: false,
    audioQueue: Promise.resolve(),
    queue: Promise.resolve(),
  };

  // The renderer streams frames concurrently (credit window), but CfrWriter is
  // stateful and must process pushes strictly in arrival order. EventEmitter
  // fires this listener synchronously per message, so chaining each frame onto a
  // per-job queue keeps exactly one push (and one ffmpeg stdin write) in flight —
  // preventing the frame-duplication race (inflated duration / looping frames)
  // and the stdin listener pile-up. "finish" is chained after all frames so
  // endInput() cannot close stdin while frames are still queued.
  port1.on("message", (e) => {
    const msg = e.data as
      | { type?: string; ts?: number; buffer?: ArrayBuffer }
      | null;
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "frame" && msg.buffer) {
      const buffer = msg.buffer;
      const ts = msg.ts ?? 0;
      entry.queue = entry.queue
        .then(async () => {
          if (!entry.cfr) return;
          await entry.cfr.push(new Uint8Array(buffer), ts);
          port1.postMessage({ type: "credit", credits: 1 });
        })
        .catch((err) => {
          port1.postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        });
    } else if (msg.type === "finish") {
      entry.queue = entry.queue.then(() => {
        entry.job?.endInput();
      });
    }
  });
  port1.start();

  wc.postMessage("openreel:export-port", { jobId }, [port2]);
  jobs.set(jobId, entry);
  return { jobId };
}

export async function writeAudioWav(args: { jobId: string; wav: ArrayBuffer }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  if (entry.started) return;
  entry.audioQueue = entry.audioQueue.then(() =>
    fs.writeFile(entry.audioWavPath, Buffer.from(args.wav)),
  );
  await entry.audioQueue;
  startNativeExportJob(args.jobId, entry);
}

export async function writeAudioChunk(args: {
  jobId: string;
  chunk: ArrayBuffer;
  position: number;
}): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  if (entry.started) throw new Error(`audio already finalized for export job ${args.jobId}`);

  entry.audioQueue = entry.audioQueue.then(() =>
    writeFileChunk(entry.audioWavPath, args.chunk, args.position),
  );
  await entry.audioQueue;
}

export async function finishAudio(args: { jobId: string }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) throw new Error(`unknown export job ${args.jobId}`);
  await entry.audioQueue;
  startNativeExportJob(args.jobId, entry);
}

async function writeFileChunk(
  filePath: string,
  chunk: ArrayBuffer,
  position: number,
): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(filePath, "r+");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    handle = await fs.open(filePath, "w+");
  }
  try {
    await handle.write(Buffer.from(chunk), 0, chunk.byteLength, position);
  } finally {
    await handle.close();
  }
}

function startNativeExportJob(jobId: string, entry: JobEntry): void {
  if (entry.started) return;
  entry.job = new ExportJob(
    entry.exportArgs,
    (frame) => entry.port.postMessage({ type: "progress", frame }),
    () => {
      entry.port.postMessage({ type: "done" });
      cleanupJob(jobId);
    },
    (msg) => {
      entry.port.postMessage({ type: "error", message: msg });
      cleanupJob(jobId);
    },
  );
  entry.cfr = new CfrWriter(entry.exportArgs.frameRate, async (f) => {
    await entry.job!.writeFrame(f);
  });
  entry.job.start();
  entry.started = true;
  entry.port.postMessage({ type: "credit", credits: initialFrameCredits(entry.exportArgs) });
}

export function cancelAllExports(): void {
  for (const [, entry] of jobs) {
    try {
      entry.job?.cancel();
    } catch {
      /* best-effort kill on quit */
    }
    void fs.rm(entry.audioWavPath, { force: true }).catch(() => {});
  }
  jobs.clear();
}

function cleanupJob(jobId: string): void {
  const entry = jobs.get(jobId);
  if (!entry) return;
  void fs.rm(entry.audioWavPath, { force: true }).catch(() => {});
  jobs.delete(jobId);
}

export async function cancelExport(args: { jobId: string }): Promise<void> {
  const entry = jobs.get(args.jobId);
  if (!entry) return;
  entry.job?.cancel();
  try {
    await fs.rm(entry.audioWavPath, { force: true });
  } catch {
    /* best-effort temp cleanup */
  }
  jobs.delete(args.jobId);
}
