import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { BrowserWindow, type WebContents } from "electron";
import { CHANNELS } from "../../shared/ipc-contract";
import { APP_INDEX } from "../protocol";
import { installNavigationGuard } from "../nav-guard";
import { getVerifiedEncoders, isHardwareEncoder } from "../sidecar/encoder-probe";
import { SegmentSession, type SessionSegment } from "../sidecar/segment-session";
import { appTempDir, newTempPathReady, releaseTemp } from "../temp-dir";
import { acquirePowerHold, releasePowerHold } from "../power";
import { cancelExport, isChaptersMetadata, resolveExportArgs, type ExportStartArgs } from "./export";
import { canHoldChapters } from "../sidecar/export-job";
import { segmentRuns, type SegmentRun } from "./segment-registry";

/**
 * Parallel segment export, main-process side.
 *
 * The editor window asks for a session: the timeline is already cut into segments (core/export/segment-plan).
 * Hidden worker windows, each a full renderer with its own engines, take segments from the session one at a time,
 * render them from the queue job's project snapshot and stream the frames into the ordinary native encode path
 * (ipc/export.ts, `segment` start args). One more hidden window renders the audio once for the whole timeline.
 * When every segment holds exactly its frames and the audio is complete, the segments are stream-copied together
 * with the audio into the output file and the editor is told it is done.
 */

export interface SegmentStartArgs {
  /** The queue job whose snapshot the workers load, and the settings they render with. */
  jobId: string;
  settings: unknown;
  /** Resolved like a normal export start (encoder, quality, output path ...). */
  start: ExportStartArgs;
  segments: Array<{ index: number; startFrame: number; endFrame: number }>;
  /** Segments rendered at once; the audio window is extra. */
  workers: number;
}

export type SegmentEvent =
  | { sessionId: string; type: "progress"; framesDone: number; totalFrames: number; phase: string }
  | { sessionId: string; type: "done"; encoder: string; workers: number }
  | { sessionId: string; type: "error"; message: string };

interface Live {
  run: SegmentRun;
  windows: Set<BrowserWindow>;
  audio: { handle: FileHandle | null; queue: Promise<void>; finished: Promise<void>; resolveFinished: () => void; rejectFinished: (error: Error) => void };
  args: SegmentStartArgs;
  encoder: string;
  settled: boolean;
  lastEmit: number;
  assembling: boolean;
}

const live = new Map<string, Live>();

const PROGRESS_INTERVAL_MS = 250;

function emit(entry: Live, event: SegmentEvent): void {
  const { editor } = entry.run;
  if (!editor.isDestroyed()) editor.send(CHANNELS.exportSegmentsEvent, event);
}

function createWorkerWindow(sessionId: string, role: "video" | "audio"): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    title: `OpenReel export worker (${role})`,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // A hidden renderer must keep rendering at full speed.
      backgroundThrottling: false,
    },
  });
  installNavigationGuard(win, APP_INDEX);
  void win.loadURL(`${APP_INDEX}#/export-segment-worker/${encodeURIComponent(sessionId)}/${role}`);
  return win;
}

function closeWindows(entry: Live): void {
  for (const win of entry.windows) {
    if (!win.isDestroyed()) win.destroy();
  }
  entry.windows.clear();
}

async function teardown(sessionId: string, entry: Live): Promise<void> {
  segmentRuns.delete(sessionId);
  live.delete(sessionId);
  releasePowerHold(sessionId);
  closeWindows(entry);
  entry.run.session.cancel();
  try {
    await entry.audio.queue.catch(() => undefined);
    await entry.audio.handle?.close().catch(() => undefined);
  } catch {
    /* already closed */
  }
  await releaseTemp(entry.run.session.argsFor(entry.run.session.segments[0]).audioWavPath).catch(() => false);
  await entry.run.session.dispose();
}

function fail(sessionId: string, message: string): void {
  const entry = live.get(sessionId);
  if (!entry || entry.settled) return;
  entry.settled = true;
  entry.audio.rejectFinished(new Error(message));
  entry.audio.finished.catch(() => undefined);
  emit(entry, { sessionId, type: "error", message });
  void cancelSegmentJobs(sessionId).finally(() => teardown(sessionId, entry));
}

/** Stop the encoders of every segment of the session that are still running. */
async function cancelSegmentJobs(sessionId: string): Promise<void> {
  const ids = [...(live.get(sessionId)?.run.jobIds ?? [])];
  await Promise.all(ids.map((jobId) => cancelExport({ jobId }).catch(() => undefined)));
}

async function maybeAssemble(sessionId: string, entry: Live): Promise<void> {
  const { session } = entry.run;
  if (entry.settled || entry.assembling || !session.allComplete) return;
  entry.assembling = true;
  try {
    emit(entry, { sessionId, type: "progress", framesDone: session.totalFrames, totalFrames: session.totalFrames, phase: "Rendering audio" });
    await entry.audio.finished;
    emit(entry, { sessionId, type: "progress", framesDone: session.totalFrames, totalFrames: session.totalFrames, phase: "Joining segments" });
    await session.assemble();
    if (entry.settled) return;
    entry.settled = true;
    emit(entry, { sessionId, type: "done", encoder: entry.encoder, workers: entry.args.workers });
    await teardown(sessionId, entry);
  } catch (error) {
    entry.assembling = false;
    fail(sessionId, error instanceof Error ? error.message : String(error));
  }
}

export async function startSegmentExport(editor: WebContents, args: SegmentStartArgs): Promise<{ sessionId: string; encoder: string }> {
  if (!Array.isArray(args.segments) || args.segments.length < 2) throw new Error("A parallel export needs at least two segments.");
  let workers = Math.max(1, Math.min(8, Math.floor(args.workers)));
  const sessionId = randomUUID();
  const encoders = await getVerifiedEncoders();
  const audioWavPath = await newTempPathReady(`openreel-segaudio-${sessionId}`, "wav");
  const dir = await fs.mkdtemp(path.join(appTempDir(), `openreel-segments-${sessionId}-`));
  let session: SegmentSession;
  let encoder: string;
  try {
    const resolved = resolveExportArgs({ ...args.start, segment: undefined }, process.platform, encoders, audioWavPath);
    if (resolved.rateControl === "vbr2" || resolved.color || resolved.alpha || resolved.dolby || resolved.scan || resolved.vr) {
      throw new Error("This export cannot be split into segments.");
    }
    encoder = resolved.encoder;
    // Chapter markers of MP4 / MOV: written to the scratch directory and muxed at the final join.
    if (args.start.chaptersMetadata !== undefined && canHoldChapters(resolved.format)) {
      if (!isChaptersMetadata(args.start.chaptersMetadata)) throw new Error("Invalid chapter metadata.");
      const chaptersPath = path.join(dir, "chapters.ffmeta");
      await fs.writeFile(chaptersPath, args.start.chaptersMetadata, "utf8");
      resolved.chaptersPath = chaptersPath;
    }
    // Hardware encoders share a few engines: more than two sessions at once stop helping.
    if (isHardwareEncoder(encoder)) workers = Math.min(workers, 2);
    const segments: SessionSegment[] = args.segments.map((segment) => ({ index: segment.index, startFrame: segment.startFrame, endFrame: segment.endFrame }));
    session = new SegmentSession({ args: resolved, segments, dir });
  } catch (error) {
    await releaseTemp(audioWavPath).catch(() => false);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  let resolveFinished = (): void => undefined;
  let rejectFinished: (error: Error) => void = () => undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const run: SegmentRun = {
    id: sessionId,
    editor,
    session,
    jobIds: new Set(),
    progress: (index, frame) => {
      session.reportProgress(index, frame);
      const entry = live.get(sessionId);
      if (!entry || entry.settled) return;
      const now = Date.now();
      if (now - entry.lastEmit < PROGRESS_INTERVAL_MS) return;
      entry.lastEmit = now;
      emit(entry, { sessionId, type: "progress", framesDone: session.framesDone, totalFrames: session.totalFrames, phase: "Rendering segments" });
    },
    finished: (index, frames) => {
      session.complete(index, frames);
      const entry = live.get(sessionId);
      if (entry) void maybeAssemble(sessionId, entry);
    },
    fail: (message) => fail(sessionId, message),
  };
  const entry: Live = {
    run,
    windows: new Set(),
    audio: { handle: null, queue: Promise.resolve(), finished, resolveFinished, rejectFinished },
    args: { ...args, workers },
    encoder,
    settled: false,
    lastEmit: 0,
    assembling: false,
  };
  segmentRuns.set(sessionId, run);
  live.set(sessionId, entry);
  // A reload or crash of the editor window orphans the export: stop it.
  acquirePowerHold(sessionId, editor, () => {
    const current = live.get(sessionId);
    if (current && !current.settled) {
      current.settled = true;
      void cancelSegmentJobs(sessionId).finally(() => teardown(sessionId, current));
    }
  });
  for (let i = 0; i < Math.min(workers, args.segments.length); i++) entry.windows.add(createWorkerWindow(sessionId, "video"));
  entry.windows.add(createWorkerWindow(sessionId, "audio"));
  for (const win of entry.windows) {
    win.webContents.once("render-process-gone", () => fail(sessionId, "An export worker stopped unexpectedly."));
  }
  return { sessionId, encoder };
}

export async function cancelSegmentExport(args: { sessionId: string }): Promise<void> {
  const entry = live.get(args.sessionId);
  if (!entry || entry.settled) return;
  entry.settled = true;
  entry.audio.rejectFinished(new Error("Export cancelled"));
  entry.audio.finished.catch(() => undefined);
  await cancelSegmentJobs(args.sessionId);
  await teardown(args.sessionId, entry);
}

export function cancelAllSegmentExports(): void {
  for (const sessionId of [...live.keys()]) void cancelSegmentExport({ sessionId });
}

/** What a worker window needs to start: the job to load, the settings, and its role is in its URL. */
export function segmentWorkerInit(args: { sessionId: string }): { jobId: string; settings: unknown; totalFrames: number; frameRate: number } {
  const entry = live.get(args.sessionId);
  if (!entry) throw new Error("This parallel export is no longer running.");
  return { jobId: entry.args.jobId, settings: entry.args.settings, totalFrames: entry.run.session.totalFrames, frameRate: entry.args.start.frameRate };
}

export function segmentWorkerNext(args: { sessionId: string }): SessionSegment | null {
  const entry = live.get(args.sessionId);
  return entry && !entry.settled ? entry.run.session.take() : null;
}

export async function segmentAudioChunk(args: { sessionId: string; chunk: ArrayBuffer; position: number }): Promise<void> {
  const entry = live.get(args.sessionId);
  if (!entry || entry.settled) throw new Error("This parallel export is no longer running.");
  const wav = entry.run.session.argsFor(entry.run.session.segments[0]).audioWavPath;
  const audio = entry.audio;
  audio.queue = audio.queue.then(async () => {
    if (!audio.handle) audio.handle = await fs.open(wav, "w+");
    await audio.handle.write(Buffer.from(args.chunk), 0, args.chunk.byteLength, args.position);
  });
  await audio.queue;
}

export async function segmentAudioFinish(args: { sessionId: string }): Promise<void> {
  const entry = live.get(args.sessionId);
  if (!entry || entry.settled) throw new Error("This parallel export is no longer running.");
  const audio = entry.audio;
  await audio.queue;
  await audio.handle?.close();
  audio.handle = null;
  audio.resolveFinished();
  // The audio window is done; drop it while the last segments finish.
  void maybeAssemble(args.sessionId, entry);
}

export function segmentWorkerFail(args: { sessionId: string; message: string }): void {
  fail(args.sessionId, args.message);
}
