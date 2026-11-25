import {
  createIsolatedExportEngine,
  describeExportSource,
  desktopExportRequiresNativeEncoder,
  planInvalidation,
  setEncoderBackendFactory,
  encoderChoiceForcesNative,
  WebCodecsBackend,
  webCodecsEncoderOptions,
  type ExportEngine,
  type ExportFrameSource,
  type ExportJob,
  type ExportJobOutput,
  type ExportJobSmartRender,
  type Project,
  type VideoExportSettings,
} from "@openreel/core";
import { reportExportLoudness } from "../export-loudness-report";
import { ensureProjectFonts } from "../project-fonts";
import { prepareObjectRemovalForExport } from "../export-object-removal";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { mimeForExt, extForFormat } from "../export-runner";
import { NativeFFmpegBackend } from "../native-ffmpeg-backend";
import { renderCacheService } from "../render-cache-service";
import { createBrowserOutputSink } from "./export-queue-storage";
import { ParallelExportCancelled, cancelParallelExport, tryParallelSegmentExport } from "./parallel-segment-export";

export interface RunJobResult {
  readonly output: ExportJobOutput;
  readonly framesFromCache: number;
  readonly cacheFramesAvailable: boolean;
  /** Present when smart rendering planned this export (copied or not). */
  readonly smartRender?: ExportJobSmartRender;
  /** The export report's statement of which media was read (always full resolution). */
  readonly sourceMedia?: string;
}

/** The engine of the job that is encoding right now, so Cancel can reach it. */
let activeJobEngine: ExportEngine | null = null;
export const cancelRunningExportJob = (): void => {
  activeJobEngine?.cancel();
  cancelParallelExport();
};

export class ExportJobCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportJobCancelled";
  }
}

const isDesktop = (): boolean => typeof window !== "undefined" && window.openreel?.platform === "desktop";

const NOOP_WRITABLE = {
  async seek() {},
  async write() {},
  async close() {},
  async abort() {},
  async truncate() {},
} as unknown as FileSystemWritableFileStream;

export function createDiskWritable(path: string): Promise<FileSystemWritableFileStream> {
  const fs = window.openreel!.fs;
  return fs.openWrite(path).then((handleId) => {
    let cursor = 0;
    return {
      async seek(position: number) { cursor = position; },
      async write(data: unknown) {
        let bytes: ArrayBuffer | Uint8Array;
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) bytes = data;
        else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
        else return;
        await fs.writeChunk(handleId, bytes, cursor);
        cursor += bytes.byteLength;
      },
      async close() { await fs.closeWrite(handleId); },
      async abort() { await fs.abortWrite(handleId); },
      async truncate() {},
    } as unknown as FileSystemWritableFileStream;
  });
}

/** Which encoder a job asks WebCodecs for. A re-run after a hardware session could not be opened asks for software. */
export type EncoderPreference = "prefer-hardware" | "prefer-software";

const webCodecsFactoryFor = (settings: VideoExportSettings, clamp: boolean, encoder: EncoderPreference = "prefer-hardware") => {
  const videoCodec = settings.codec === "h265" ? "hevc" : "avc";
  return (mediabunny: unknown) =>
    mediabunny
      ? new WebCodecsBackend(mediabunny as ConstructorParameters<typeof WebCodecsBackend>[0], {
          ...webCodecsEncoderOptions(settings.encoderChoice),
          // The automatic re-run after a hardware session failed to open asks for software, unless the user chose Hardware.
          ...(encoder === "prefer-software" && settings.encoderChoice !== "hardware" ? { hardwareAcceleration: "prefer-software" as const } : {}),
          videoCodecs: [videoCodec],
          clampResolution: clamp,
        })
      : new NativeFFmpegBackend(() => (window as { __openreelExportPath?: string }).__openreelExportPath ?? "");
};

/** Whether a desktop export is encoded by the ffmpeg sidecar (the only encode parallel segments use) rather than by WebCodecs. */
const usesNativeEncoder = (settings: VideoExportSettings): boolean =>
  desktopExportRequiresNativeEncoder(settings) || settings.encodeMode === "smallest" || settings.codec === "av1" || encoderChoiceForcesNative(settings.encoderChoice, settings.codec);

async function runParallelIfPossible(job: ExportJob, project: Project, settings: VideoExportSettings, ext: string, hooks: RunJobHooks): Promise<RunJobResult | null> {
  const fs = window.openreel!.fs;
  const path = await fs.tempFilePath(ext, true);
  try {
    const result = await tryParallelSegmentExport({ job, project, settings, outputPath: path, hooks });
    if (!result) {
      await fs.releaseTemp?.(path).catch(() => undefined);
      return null;
    }
    return { output: { filename: job.outputName, bytes: 0, storage: "disk", path }, framesFromCache: 0, cacheFramesAvailable: false };
  } catch (error) {
    await fs.releaseTemp?.(path).catch(() => undefined);
    if (error instanceof ParallelExportCancelled) throw new ExportJobCancelled();
    throw error;
  }
}

/** Let input, paint and timers run between frames so the editor stays usable during a job. */
const yieldToMain = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return typeof scheduler?.yield === "function"
    ? scheduler.yield()
    : new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export interface RunJobHooks {
  onProgress(progress01: number, phase: string): void;
  isCancelled(): boolean;
}

/**
 * Encode one queued job from its project snapshot. The editor's live project is
 * never read here, which is what makes a queued job immune to later edits.
 */
export async function runExportJob(job: ExportJob, project: Project, hooks: RunJobHooks, encoder: EncoderPreference = "prefer-hardware"): Promise<RunJobResult> {
  // A queued job renders with its own video/audio engines. The live preview's
  // engines are never put in export mode, never have their caches cleared, and
  // never see the job's frames.
  const isolated = createIsolatedExportEngine();
  activeJobEngine = isolated.engine;
  try {
    return await runExportJobWith(isolated.engine, job, project, hooks, encoder);
  } finally {
    // Owned here so an early failure (engine init, fonts, output sink) cannot leak the engines.
    if (activeJobEngine === isolated.engine) activeJobEngine = null;
    await isolated.dispose();
  }
}

async function runExportJobWith(engine: ExportEngine, job: ExportJob, project: Project, hooks: RunJobHooks, encoder: EncoderPreference): Promise<RunJobResult> {
  const settings: VideoExportSettings = { ...job.settings, ...(job.range ? { range: job.range } : {}) };
  const ext = extForFormat(settings.format, settings.codec);
  const desktop = isDesktop();
  const checkCancelled = () => {
    if (hooks.isCancelled()) throw new ExportJobCancelled();
  };

  await engine.initialize();
  checkCancelled();
  await ensureProjectFonts(project);
  checkCancelled();

  // Effects, transitions and overlays render through engines that follow the
  // live project. If the snapshot differs visually from it, point them at the
  // snapshot for this run and restore the live project afterwards.
  const liveProject = useProjectStore.getState().getFullProject();
  const plan = planInvalidation(project, liveProject);
  const swapProcessing = plan.all || plan.ranges.length > 0;
  // The global overlay/effect/transition engines are shared with the live
  // preview. While they point at the snapshot, live playback and edits would
  // render and edit the wrong state, so the editor is locked until they are restored.
  let lockedPlayback = false;
  const source = job.usePreviews ? renderCacheService.createExportFrameSource(project, settings) : null;
  const frameSource: ExportFrameSource | undefined = source ?? undefined;

  // Desktop: render the timeline in parallel segments in hidden worker windows when it is safe. Frames taken from the
  // preview cache, or an encode that is not the native one, keep the serial path (so parallel and serial agree).
  if (desktop && !frameSource && usesNativeEncoder(settings)) {
    const parallel = await runParallelIfPossible(job, project, settings, ext, hooks);
    if (parallel) return parallel;
    checkCancelled();
  }

  let writable: FileSystemWritableFileStream;
  let finish: () => Promise<ExportJobOutput>;
  let discard: () => Promise<void>;
  let restoreFactory: (() => void) | null = null;

  if (desktop) {
    const fs = window.openreel!.fs;
    const path = await fs.tempFilePath(ext, true);
    const native = usesNativeEncoder(settings);
    (window as { __openreelExportPath?: string }).__openreelExportPath = path;
    if (native) {
      setEncoderBackendFactory(() => new NativeFFmpegBackend(() => path));
      writable = NOOP_WRITABLE;
    } else {
      setEncoderBackendFactory(webCodecsFactoryFor(settings, false, encoder));
      writable = await createDiskWritable(path);
    }
    restoreFactory = () => setEncoderBackendFactory(() => new NativeFFmpegBackend(() => path));
    finish = async () => ({ filename: job.outputName, bytes: 0, storage: "disk", path });
    discard = async () => {
      await fs.releaseTemp?.(path).catch(() => undefined);
    };
  } else {
    const sink = await createBrowserOutputSink(job.id, ext, mimeForExt(ext));
    writable = sink.writable;
    finish = async () => ({ filename: job.outputName, bytes: await sink.finish(), storage: "browser" });
    discard = () => sink.discard();
  }

  let generator: ReturnType<typeof engine.exportVideo> | undefined;
  try {
    checkCancelled();
    if (swapProcessing) {
      useTimelineStore.getState().pause?.();
      useTimelineStore.getState().lockPlayback("Rendering a queued export");
      lockedPlayback = true;
      useProjectStore.getState().syncRenderProcessingFrom(project);
    }
    // A cleared Remove Object cache is re-analysed here, with progress, rather than failing the render.
    try {
      await prepareObjectRemovalForExport(project, { isCancelled: hooks.isCancelled, onProgress: (fraction, label) => hooks.onProgress(fraction, label) });
    } catch (error) {
      if (hooks.isCancelled()) throw new ExportJobCancelled();
      throw error;
    }
    checkCancelled();
    // Desktop carries the preference in its encoder factory; the browser passes it per run so it never outlives this job.
    generator = engine.exportVideo(project, settings, writable, {
      ...(frameSource ? { cachedFrames: frameSource } : {}),
      ...(!desktop && encoder === "prefer-software" ? { encoderPreference: "prefer-software" as const } : {}),
    });
    let framesFromCache = 0;
    let smartRender: RunJobResult["smartRender"];
    let sourceMedia: string | undefined;
    for (;;) {
      const step = await generator.next();
      if (hooks.isCancelled()) {
        engine.cancel();
        throw new ExportJobCancelled();
      }
      if (step.done) {
        const result = step.value;
        if (!result.success) {
          if (result.error?.code === "CANCELLED") throw new ExportJobCancelled();
          throw new Error(result.error?.message || "Export failed");
        }
        framesFromCache = result.stats?.framesFromCache ?? 0;
        reportExportLoudness(result.stats?.loudness);
        const report = result.stats?.smartRender;
        if (report) {
          smartRender = {
            copiedPercent: report.copiedPercent,
            summary: report.summary,
            ...(report.engine ? { engine: report.engine } : {}),
            copiedFrames: report.copiedFrames,
            totalFrames: report.totalFrames,
            copiedRuns: report.copiedRuns,
            ...(report.copiedSeconds !== undefined ? { copiedSeconds: report.copiedSeconds, encodedSeconds: report.encodedSeconds } : {}),
            ...(report.audio
              ? { audioCopiedSeconds: report.audio.copiedSeconds, audioEncodedSeconds: report.audio.encodedSeconds, audioMode: report.audio.mode }
              : {}),
            reasons: report.reasons,
          };
        }
        sourceMedia = result.stats?.sourceMedia ? describeExportSource(result.stats.sourceMedia, typeof window !== "undefined" && window.openreel?.platform === "desktop") || result.stats.sourceMedia.message : undefined;
        break;
      }
      hooks.onProgress(step.value.progress, step.value.phase);
      await yieldToMain();
    }
    const output = await finish();
    return { output, framesFromCache, cacheFramesAvailable: Boolean(frameSource), ...(smartRender ? { smartRender } : {}), ...(sourceMedia ? { sourceMedia } : {}) };
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await discard();
    throw error;
  } finally {
    try {
      await generator?.return({ success: false });
    } catch {
      /* keep the original outcome */
    }
    restoreFactory?.();
    if (swapProcessing) {
      try {
        useProjectStore.getState().syncRenderProcessingFrom(useProjectStore.getState().getFullProject());
      } finally {
        if (lockedPlayback) useTimelineStore.getState().unlockPlayback();
      }
    }
  }
}
