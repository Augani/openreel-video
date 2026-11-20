import { applyCaptionBurnIn } from "../captions/caption-export";
import type { Project } from "../types/project";
import type {
  VideoExportSettings,
  AudioExportSettings,
  ImageExportSettings,
  SequenceExportSettings,
  ExportProgress,
  ExportPreset,
  ExportResult,
  ExportStats,
  ExportError,
  ExportVideoOptions,
} from "./types";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
  effectiveRateControl,
  exportWritesAlpha,
} from "./types";
import { VideoEngine, getVideoEngine } from "../video/video-engine";
import { AudioEngine, getAudioEngine } from "../audio/audio-engine";
import { downmixSurroundToStereo, isSurroundLayout } from "../audio/surround";
import { DEFAULT_DIALNORM, DOLBY_VIDEO_DESKTOP_ONLY_REASON, dolbyChannelsProblem, dolbyDeliveryProblems, dolbyMimeType, isDolbyFormat, resolveDolbyAudioSettings, type DolbyCodec } from "./dolby";
import { encodeMultichannelWav, isSurroundDelivery, resolveSequenceAudioSettings, surroundFormatProblem } from "./surround-export";
import { audioBufferFromChunk, renderMixdownCached } from "../audio/mixdown-cache";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { UpscalingEngine, getUpscalingEngine } from "../video/upscaling";
import { getMediaEngine } from "../media/mediabunny-engine";
import { outputColorForExport } from "./color-output";
import { hdrExportTargetFor } from "../video/hdr-frame";
import { getWavEncoder } from "../wasm/wav";
import type { EncoderBackend } from "./encoder-backend";
import { getEncoderBackendFactory, setEncoderBackendFactory } from "./encoder-backend";
import { WebCodecsBackend } from "./webcodecs-backend";
import { webCodecsEncoderOptions } from "./encoder-choice";
import { encodeGif, gifPlaybackFps, validateGifFrameBudget, validateGifOptions, type GifFrame } from "./gif-encoder";
import { MAX_SEQUENCE_BYTES, packImageSequence, sequenceFrameRange, validateSequenceRange, type SequenceImageFormat } from "./image-sequence";
import { declineSmartRender, formatSmartRenderSummary, planSmartRender, type SmartRenderPlan, type SmartRenderSourceInfo } from "./smart-render";
import { scanSourceForSmartRender } from "./smart-render-scan";
import {
  LoudnessNormalizer,
  measureRenderedLoudness,
  planNormalization,
  type LoudnessSnapshot,
} from "../audio/loudness";
import {
  activeLoudnessTarget,
  audioBufferChannels,
  buildLoudnessReport,
  createAudioBufferFromChannels,
  normalizeAudioBuffer,
  type LoudnessExportReport,
} from "./loudness-export";
import { proxyExportReport } from "../media/proxy-workflow";
import {
  broadcastAudioTrackCount,
  isBroadcastCodec,
  layoutBroadcastChannels,
  planBroadcastChannels,
  wantsMonoTracks,
  type BroadcastDeliverySettings,
} from "./broadcast";
import { isolateStem, planStems } from "./stem-export";
import { resolveWebCodecsExportLimits } from "./webcodecs-limits";
import { checkBrowserExportCapability, getVideoExportValidationError, getMissingExportMedia } from "./browser-capabilities";
import {
  getMediaItemCapabilities,
  trackHasAudioItems,
} from "../timeline/timeline-items";

// Encodes allowed in flight for backends that declare supportsPipelining.
/**
 * How long one frame may take to render before the export is declared stuck. A frame at a cut can
 * need several decoders to seek into long-GOP sources (a 4K clip with 10 s keyframes means decoding
 * a few hundred frames before the first picture), and a dense timeline needs one such seek per layer;
 * measured on a 110-minute, 9-layer soak timeline under machine load a single frame took over 30 s.
 * A decoder that is truly hung still fails the export, two minutes later.
 */
export const RENDER_FRAME_WATCHDOG_MS = 120_000;

const EXPORT_PIPELINE_DEPTH = 3;

/** Share of the progress bar owned by frame rendering; audio drain and muxing own the rest. */
const RENDER_PROGRESS_SHARE = 0.97;
/** Relative cost of stream-copying a frame versus rendering and encoding it. */
const SMART_COPY_FRAME_COST = 0.03;

export interface ExportEngineOptions {
  /**
   * Render with this VideoEngine instead of the editor's live singleton. A queued
   * export passes its own so export mode, frame caches and the GPU compositor never
   * touch the engine that drives the live preview.
   */
  videoEngine?: VideoEngine;
  audioEngine?: AudioEngine;
}

export class ExportEngine {
  constructor(private readonly options: ExportEngineOptions = {}) {}

  /** True when this engine owns its video engine, so shared caches must be left alone. */
  private get isolated(): boolean {
    return this.options.videoEngine !== undefined;
  }

  private static readonly AUDIO_EXPORT_CHUNK_DURATION_SECONDS = 15;
  private mediabunny: typeof import("mediabunny") | null = null;
  private initialized = false;
  private videoEngine: VideoEngine | null = null;
  private audioEngine: AudioEngine | null = null;
  private upscalingEngine: UpscalingEngine | null = null;
  private abortController: AbortController | null = null;
  private currentExport: {
    startTime: number;
    framesRendered: number;
  } | null = null;
  private loudnessReport: LoudnessExportReport | undefined;
  private exportWorker: Worker | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.mediabunny = await import("mediabunny");
    } catch (error) {
      console.warn("[ExportEngine] MediaBunny not available:", error);
      this.mediabunny = null;
    }

    try {
      this.videoEngine = this.options.videoEngine ?? getVideoEngine();
      this.audioEngine = this.options.audioEngine ?? getAudioEngine();

      if (!this.videoEngine.isInitialized()) {
        await this.videoEngine.initialize();
      }
      if (!this.audioEngine.isInitialized()) {
        await this.audioEngine.initialize();
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  async initializeGPUForExport(
    width: number,
    height: number,
  ): Promise<boolean> {
    if (!this.initialized || !this.videoEngine) {
      await this.initialize();
    }

    try {
      await this.videoEngine!.initializeGPUCompositor(width, height);
      const gpuCompositor = this.videoEngine!.getGPUCompositor();
      if (gpuCompositor) {
        const device = gpuCompositor.getDevice();
        if (device) {
          this.upscalingEngine = getUpscalingEngine();
          await this.upscalingEngine.initialize({ device });
        }
        return true;
      }
      return false;
    } catch (error) {
      throw new Error(
        `ExportEngine initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  isMediaBunnyAvailable(): boolean {
    return this.mediabunny !== null;
  }

  isWebCodecsSupported(): boolean {
    return (
      typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined"
    );
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("ExportEngine not initialized. Call initialize() first.");
    }
  }

  async *exportVideo(
    sourceProject: Project,
    settings: Partial<VideoExportSettings> = {},
    writableStream?: FileSystemWritableFileStream,
    exportOptions: ExportVideoOptions = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();
    // Only burned-in caption tracks are drawn into the picture; the backend still sees every cue
    // (sourceProject) so embedded subtitle tracks carry the full text.
    const project = applyCaptionBurnIn(sourceProject, settings.captions);
    const burnInChanged = project !== sourceProject;
    // Cached preview frames contain every caption, so they cannot be reused when some are excluded.
    // The timecode overlay is not in the preview cache either.
    const cachedFrames = burnInChanged || settings.burnInTimecode?.enabled ? undefined : exportOptions.cachedFrames;
    let cachedFrameCount = 0;

    if (!this.mediabunny) {
      const errorMessage = this.isWebCodecsSupported()
        ? "MediaBunny library failed to load. Please refresh the page and try again."
        : "Video export requires WebCodecs API which is not supported in your browser. Please use Chrome, Edge, or another WebCodecs-compatible browser.";
      return {
        success: false,
        error: this.createError("UNSUPPORTED_CODEC", errorMessage, "preparing"),
      };
    }

    const fullSettings: VideoExportSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      ...settings,
      audioSettings: {
        ...DEFAULT_VIDEO_SETTINGS.audioSettings,
        ...settings.audioSettings,
      },
    };

    // A 5.1 sequence delivers six channels (AAC in MP4 / MOV) unless the export asks for stereo.
    fullSettings.audioSettings = resolveSequenceAudioSettings(project, fullSettings.audioSettings);
    const surroundProblem = isSurroundDelivery(fullSettings.audioSettings) ? surroundFormatProblem(fullSettings.format) : null;
    if (surroundProblem) return { success: false, error: this.createError("INVALID_SETTINGS", surroundProblem, "preparing") };
    if (isDolbyFormat(fullSettings.audioSettings.format)) {
      const dolbyProblem = dolbyDeliveryProblems(fullSettings.audioSettings, fullSettings.format)[0];
      if (dolbyProblem) return { success: false, error: this.createError("INVALID_SETTINGS", dolbyProblem, "preparing") };
      fullSettings.audioSettings = resolveDolbyAudioSettings(fullSettings.audioSettings);
    }

    const encoderBackendFactory = getEncoderBackendFactory();
    const backend: EncoderBackend = encoderBackendFactory
      ? encoderBackendFactory(this.mediabunny)
      : new WebCodecsBackend(this.mediabunny!, {
          ...webCodecsEncoderOptions(fullSettings.encoderChoice),
          ...(exportOptions.encoderPreference === "prefer-software" && fullSettings.encoderChoice !== "hardware"
            ? { hardwareAcceleration: "prefer-software" as const }
            : {}),
        });

    if (backend.normalizesProResToH264 && (fullSettings.format === "mkv" || isDolbyFormat(fullSettings.audioSettings.format))) {
      return { success: false, error: this.createError("UNSUPPORTED_CODEC", fullSettings.format === "mkv" ? "MKV export needs the desktop app. Choose MP4, MOV or WebM." : DOLBY_VIDEO_DESKTOP_ONLY_REASON, "preparing") };
    }
    if (backend.normalizesProResToH264 && (fullSettings.codec === "prores" || fullSettings.codec === "dnxhr" || isBroadcastCodec(fullSettings.codec) || fullSettings.format === "mxf" || hasBroadcastOptions(fullSettings.broadcast))) {
      return { success: false, error: this.createError("UNSUPPORTED_CODEC", "ProRes, DNxHR, XDCAM HD422, AVC-Intra, MXF, mono audio tracks and timecode tracks require the desktop encoder. Choose H.264 / MP4 for browser export.", "preparing") };
    }
    // The sequence's start timecode (10:00:00:00 for broadcast) is written into native MOV / MXF files unless the
    // export dialog set another one.
    if (!backend.normalizesProResToH264 && (fullSettings.format === "mov" || fullSettings.format === "mxf") && !fullSettings.broadcast?.startTimecode && project.settings.startTimecode) {
      fullSettings.broadcast = { ...fullSettings.broadcast, startTimecode: project.settings.startTimecode };
    }

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);
    const range = fullSettings.range;
    if (range && (!Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)
      || range.startTime < 0 || range.endTime <= range.startTime || range.endTime > timelineDuration + 1e-7)) {
      return { success: false, error: this.createError("INVALID_SETTINGS", "Choose an In/Out range inside the timeline, with Out after In.", "preparing") };
    }
    const exportStart = range?.startTime ?? 0;
    const exportDuration = Math.min(range?.endTime ?? timelineDuration, timelineDuration) - exportStart;
    const missingMedia = getMissingExportMedia(project, range);
    if (missingMedia.length) return { success: false, error: this.createError("INVALID_SETTINGS", `Relink the original media before exporting: ${missingMedia.join(", ")}`, "preparing") };
    const initialValidation = getVideoExportValidationError(fullSettings, timelineDuration);
    if (initialValidation) return { success: false, error: this.createError("INVALID_SETTINGS", initialValidation, "preparing") };

    if (backend.requiresWebCodecsClamping) {
      Object.assign(
        fullSettings,
        resolveWebCodecsExportLimits(fullSettings, exportDuration).settings,
      );
    }

    const validationError = getVideoExportValidationError(fullSettings, timelineDuration);
    if (validationError) {
      return {
        success: false,
        error: this.createError(
          "INVALID_SETTINGS",
          validationError,
          "preparing",
        ),
      };
    }

    if (!writableStream) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "No writable stream provided. Export requires a file destination.",
          "preparing",
        ),
      };
    }

    const totalFrames = Math.max(1, Math.ceil(exportDuration * fullSettings.frameRate - 1e-7));
    if (this.currentExport) {
      return { success: false, error: this.createError("INVALID_SETTINGS", "An export is already running. Wait for it to finish or cancel it before retrying.", "preparing") };
    }
    const abortController = new AbortController();
    this.abortController = abortController;
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    this.loudnessReport = undefined;
    // Audio runs beside the video loop (see audioTask below). If it fails, that failure, not the
    // CANCELLED it triggers in the video loop, is what the caller must see.
    let audioFailure: unknown;
    const checkCancelled = () => {
      if (audioFailure !== undefined) throw audioFailure;
      if (abortController.signal.aborted) throw this.createError("CANCELLED", "Export cancelled by user", "rendering");
    };

    const phaseStart = performance.now();
    let phaseMark = phaseStart;
    const phase = (name: string): void => {
      const now = performance.now();
      console.debug(`[export-phase] ${name} +${(now - phaseMark).toFixed(0)}ms (t=${(now - phaseStart).toFixed(0)}ms)`);
      phaseMark = now;
    };
    try {
      yield this.createProgress("preparing", 0, totalFrames, 0, 0);
      checkCancelled();
      if (backend.requiresWebCodecsClamping) {
        const capability = await checkBrowserExportCapability(fullSettings, this.mediabunny!, project.timeline.tracks.some((track) => trackHasAudioItems(project, track.id)));
        if (!capability.supported) throw this.createError("UNSUPPORTED_CODEC", capability.reason!, "preparing");
      }
      checkCancelled();
      phase("capability");
      await this.initializeGPUForExport(fullSettings.width, fullSettings.height);
      phase("gpu-init");
      checkCancelled();
      let smartPlan = await this.planSmartRenderFor(project, fullSettings, backend, exportStart, totalFrames);
      checkCancelled();
      if (smartPlan?.eligible && backend.smartRender?.prepare) {
        const prepared = await backend.smartRender.prepare(smartPlan, (mediaId) => project.mediaLibrary.items.find((item) => item.id === mediaId)?.blob ?? undefined);
        smartPlan = "decline" in prepared ? declineSmartRender(smartPlan, prepared.decline) : prepared.plan;
        checkCancelled();
      }
      phase("smart-plan");
      const smartCopy = smartPlan?.eligible ? backend.smartRender : undefined;
      if (smartCopy) smartCopy.enable(smartPlan ?? undefined);
      this.videoEngine?.resetExportState();
      const hdrTarget = hdrExportTargetFor(project, fullSettings);
      if (this.videoEngine) {
        this.videoEngine.exportMode = true;
        // ProRes 4444 with alpha: composite over transparency instead of black.
        this.videoEngine.transparentBackground = exportWritesAlpha(fullSettings);
        // Rec.2020 / HDR output: render the float image and encode it directly (no 8-bit read-back).
        this.videoEngine.setHdrExportTarget?.(hdrTarget);
      }
      await backend.start(fullSettings, sourceProject, writableStream);
      phase("backend-start");
      checkCancelled();

      // Mixing and encoding the audio is independent of rendering frames, so it runs beside the
      // video loop instead of in front of it: a long timeline used to sit at 0% for the whole
      // mixdown (23 s for a minute of a 120-clip timeline) before the first frame. The muxer
      // interleaves the two tracks as they arrive. Only the loop's own progress is reported.
      let audioTask: Promise<void> | undefined;
      if (backend.audioBeforeVideo) {
        audioTask = (async () => {
          try {
            await this.encodeTimelineAudioToBackend(project, backend, fullSettings.audioSettings, exportStart, exportDuration, abortController.signal, fullSettings.broadcast);
          } finally {
            this.audioEngine?.clearCache();
          }
          await backend.closeAudio();
          phase("audio");
        })();
        audioTask.catch((error: unknown) => {
          const cancelled = typeof error === "object" && error !== null && "code" in error && (error as ExportError).code === "CANCELLED";
          if (cancelled || abortController.signal.aborted) return;
          audioFailure = error;
          abortController.abort();
        });
      }

      const mediaEngine = getMediaEngine();
      const videoMediaIds: string[] = [];
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (range && (clip.startTime >= range.endTime || clip.startTime + clip.duration <= range.startTime)) continue;
          const mediaItem = project.mediaLibrary.items.find(
            (m) => m.id === clip.mediaId,
          );
          if (
            mediaItem?.blob &&
            getMediaItemCapabilities(mediaItem).visual &&
            mediaItem.type === "video" &&
            !videoMediaIds.includes(mediaItem.id)
          ) {
            videoMediaIds.push(mediaItem.id);
            try {
              await mediaEngine.createExportDecoder(
                mediaItem.id,
                mediaItem.blob,
                fullSettings.width,
              );
            } catch (error) {
              console.warn("[ExportEngine] export decoder unavailable, frames will use the slow per-frame path:", error);
            }
          }
        }
      }

      phase("decoders");
      let renderMsTotal = 0;
      const pipelined = backend.supportsPipelining === true;
      const pipelineDepth = pipelined ? EXPORT_PIPELINE_DEPTH : 1;
      const pendingEncodes: Promise<void>[] = [];
      const segments: SmartRenderPlan["segments"] = smartCopy
        ? smartPlan!.segments
        : [{ kind: "encode", startFrame: 0, endFrame: totalFrames }];
      let copiedFramesDone = 0;
      let copiedRuns = 0;
      const copiedFramesPlanned = smartCopy ? smartPlan!.copiedFrames : 0;
      // A copied frame costs a few percent of an encoded one, so progress is
      // weighted by work rather than by frame count (a 90%-copied export must
      // not report 90% after the first second and then crawl).
      const workTotal = totalFrames - copiedFramesPlanned + copiedFramesPlanned * SMART_COPY_FRAME_COST;
      const renderProgress = (framesDone: number): number => {
        const work = framesDone - copiedFramesDone + copiedFramesDone * SMART_COPY_FRAME_COST;
        return Math.min(1, work / workTotal) * RENDER_PROGRESS_SHARE;
      };
      for (const segment of segments) {
      if (segment.kind === "copy") {
        checkCancelled();
        const sourceBlob = project.mediaLibrary.items.find((item) => item.id === segment.mediaId)?.blob;
        if (!sourceBlob) throw this.createError("FRAME_ENCODE_FAILED", "A smart-render source is no longer available.", "encoding");
        const copied = await smartCopy!.copyRun(sourceBlob, segment.sourceStart, segment.sourceEnd, segment.startFrame / fullSettings.frameRate);
        if (copied !== segment.endFrame - segment.startFrame) {
          throw this.createError("FRAME_ENCODE_FAILED", `Smart render copied ${copied} of ${segment.endFrame - segment.startFrame} frames.`, "encoding");
        }
        copiedFramesDone += copied;
        copiedRuns++;
        this.currentExport!.framesRendered = segment.endFrame;
        yield this.createProgress("rendering", renderProgress(segment.endFrame), totalFrames, segment.endFrame, backend.getBytesWritten());
        continue;
      }
      smartCopy?.beginEncodeRun();
      for (let frame = segment.startFrame; frame < segment.endFrame; frame++) {
        checkCancelled();

        const time = frame / fullSettings.frameRate;
        const renderStart = performance.now();
        // A frame already in the preview render cache replaces a full re-render.
        const cachedImage = cachedFrames && !fullSettings.upscaling?.enabled && !hdrTarget
          ? await cachedFrames.takeFrame(exportStart + time)
          : undefined;
        if (cachedImage) cachedFrameCount++;
        const rendered = cachedImage
          ? { image: cachedImage }
          : await this.waitForVideoOperation(this.videoEngine!.renderFrame(
              project,
              exportStart + time,
              fullSettings.width,
              fullSettings.height,
              ...(fullSettings.burnInTimecode?.enabled ? [{ timecodeBurnIn: fullSettings.burnInTimecode }] : []),
            ), abortController.signal, "rendering", (lateFrame) => lateFrame.image.close(), RENDER_FRAME_WATCHDOG_MS);
        renderMsTotal += performance.now() - renderStart;
        if (frame === segment.startFrame && segment.startFrame === 0) phase("first-frame-rendered");
        const shouldUpscale = this.shouldApplyUpscaling(project, fullSettings);
        let frameImage = rendered.image;

        if (shouldUpscale && this.upscalingEngine?.isInitialized()) {
          const upscaled = await this.upscalingEngine.upscaleImageBitmap(
            frameImage,
            fullSettings.width,
            fullSettings.height,
            fullSettings.upscaling!,
          );
          frameImage.close();
          frameImage = upscaled;
        }

        // Queue the encode so the next frame can render while this one is
        // read back. The backend receives frames in call order; the queue is
        // bounded and the oldest entry is awaited once it is full.
        const pending = this.waitForVideoOperation(backend.addVideoFrame(
          frameImage,
          time,
          1 / fullSettings.frameRate,
        // A queued frame waits behind earlier ones, so scale the watchdog by
        // pipeline depth rather than timing each frame from submission.
        ), abortController.signal, "encoding", undefined, 30_000 * pipelineDepth);
        // Failures surface when the entry is awaited; avoid an unhandled
        // rejection while a later frame is still rendering.
        pending.catch(() => undefined);
        pendingEncodes.push(pending);
        if (pendingEncodes.length >= pipelineDepth) {
          await pendingEncodes.shift();
        }

        this.currentExport!.framesRendered = frame + 1;

        if (!pipelined && backend.needsFrameThrottling && (frame + 1) % 5 === 0) {
          // Yield to the browser without invalidating decoder state. Clearing
          // these caches during a sequential export forces fresh seeks and can
          // repeat source frames, which shows up as brief pauses in the file.
          await new Promise((resolve) => setTimeout(resolve, 2));
        }

        yield this.createProgress(
          "rendering",
          renderProgress(frame + 1),
          totalFrames,
          frame + 1,
          backend.getBytesWritten(),
        );
      }

      while (pendingEncodes.length > 0) {
        await pendingEncodes.shift();
      }
      await smartCopy?.endEncodeRun();
      }

      if (totalFrames > 0) {
        console.info(
          `[export] render=${(renderMsTotal / totalFrames).toFixed(1)}ms/f frames=${totalFrames}`,
        );
      }

      if (audioTask) {
        await audioTask;
      } else {
        try {
          await this.encodeTimelineAudioToBackend(project, backend, fullSettings.audioSettings, exportStart, exportDuration, abortController.signal, fullSettings.broadcast);
        } finally {
          this.audioEngine?.clearCache();
        }
        await backend.closeAudio();
      }

      mediaEngine.disposeAllExportDecoders();
      if (!this.isolated) mediaEngine.clearFrameCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
        this.videoEngine.transparentBackground = false;
      }

      yield this.createProgress(
        "muxing",
        RENDER_PROGRESS_SHARE + 0.01,
        totalFrames,
        totalFrames,
        backend.getBytesWritten(),
      );

      checkCancelled();
      // External encoders (native ffmpeg) may legitimately take minutes to drain
      // buffered frames and rewrite the file, so only WebCodecs keeps the watchdog.
      const externalEncoder =
        backend.drivesExternalEncoder === true || backend.supportsPipelining === true;
      await this.waitForVideoOperation(
        backend.finalize(),
        abortController.signal,
        "muxing",
        undefined,
        externalEncoder ? null : undefined,
      );

      yield this.createProgress(
        "complete",
        1,
        totalFrames,
        totalFrames,
        backend.getBytesWritten(),
      );

      return {
        success: true,
        stats: {
          ...this.calculateStats(totalFrames, backend.getBytesWritten()),
          ...(this.loudnessReport ? { loudness: this.loudnessReport } : {}),
          ...(hdrTarget?.meter?.result() ? { hdrLightLevel: hdrTarget.meter.result()! } : {}),
          sourceMedia: proxyExportReport(project),
          ...(cachedFrames ? { framesFromCache: cachedFrameCount } : {}),
          ...(backend.embeddedCaptions ? { embeddedCaptions: backend.embeddedCaptions } : {}),
          ...(smartPlan ? { smartRender: {
            active: copiedFramesDone > 0,
            engine: backend.smartRender?.engine ?? "webcodecs",
            copiedFrames: copiedFramesDone,
            totalFrames,
            copiedPercent: totalFrames > 0 ? (copiedFramesDone / totalFrames) * 100 : 0,
            copiedRuns,
            reasons: [...smartPlan.reasons],
            summary: formatSmartRenderSummary(copiedFramesDone, totalFrames),
          } } : {}),
        },
      };
    } catch (thrown) {
      const error = audioFailure !== undefined ? audioFailure : thrown;
      // Stop the audio task if the video side failed first.
      abortController.abort();
      try { await backend.abort(); } catch { /* Preserve the original export failure. */ }
      try { await writableStream.abort(); } catch { /* It may already have been aborted by the backend. */ }
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    } finally {
      // A consumer may close the generator at a progress yield after cancel.
      // That bypasses catch, so release encoders and the unfinished destination.
      if (abortController.signal.aborted) {
        try { await backend.abort(); } catch {}
        try { await writableStream.abort(); } catch {}
      }
      this.abortController = null;
      this.currentExport = null;
      this.audioEngine?.clearCache();
      this.videoEngine?.clearVideoElementCache();
      this.videoEngine?.clearCache();
      if (this.videoEngine) {
        this.videoEngine.exportMode = false;
        this.videoEngine.transparentBackground = false;
        this.videoEngine.setHdrExportTarget?.(null);
      }
      try {
        getMediaEngine().disposeAllExportDecoders();
        if (!this.isolated) getMediaEngine().clearFrameCache();
      } catch {}
    }
  }

  /**
   * Smart-render plan for this export, or null when the backend cannot splice
   * packets, the user turned it off, or the frames come from the preview cache.
   */
  private async planSmartRenderFor(
    project: Project,
    settings: VideoExportSettings,
    backend: EncoderBackend,
    exportStart: number,
    totalFrames: number,
  ): Promise<SmartRenderPlan | null> {
    if (!backend.smartRender || settings.smartRender === false || !this.mediabunny) return null;
    // Stream-copied spans carry no overlay: a timecode burn-in re-renders every frame.
    if (settings.burnInTimecode?.enabled) return null;
    // Smart render joins stream-copied spans with a stereo audio pass; a mono-track or broadcast delivery is rendered in full.
    if (isBroadcastCodec(settings.codec) || wantsMonoTracks(settings.broadcast) || settings.broadcast?.mxfPattern === "opatom") return null;
    // Stream-copied source packets carry the source's colour, so a Rec.2020 / HDR export re-renders everything.
    if (outputColorForExport(project, settings.hdr)) return null;
    // Two-pass VBR analyses and re-encodes every frame, so it cannot share the stream-copied spans.
    if (effectiveRateControl(settings) === "vbr2") return null;
    const engine = backend.smartRender.engine ?? "webcodecs";
    if (engine === "webcodecs" && settings.codec !== "h264") return null;
    if (settings.format !== "mp4" && settings.format !== "mov") return null;
    try {
      const sources = new Map<string, SmartRenderSourceInfo>();
      for (const item of project.mediaLibrary.items) {
        if (item.type !== "video" || !item.blob) continue;
        const info = await scanSourceForSmartRender(this.mediabunny, item.id, item.blob, engine);
        if (info) sources.set(item.id, info);
      }
      return planSmartRender({ project, settings, sources, exportStart, totalFrames, engine });
    } catch (error) {
      console.warn("[export] smart render planning failed; encoding everything", error);
      return null;
    }
  }

  private terminateWorker(): void {
    if (this.exportWorker) {
      this.exportWorker.terminate();
      this.exportWorker = null;
    }
  }

  private waitForVideoOperation<T>(
    operation: Promise<T>,
    signal: AbortSignal,
    phase: ExportProgress["phase"],
    disposeLateResult?: (result: T) => void,
    timeoutMs: number | null = 30_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: ExportError) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
      };
      const cancel = () => finish(this.createError("CANCELLED", "Export cancelled by user", phase));
      const timer = timeoutMs === null ? undefined : setTimeout(() => finish(this.createError(
        "FRAME_ENCODE_FAILED",
        "The video export stopped responding. Retry with a lower resolution or a different codec.",
        phase,
      )), timeoutMs);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      operation.then((result) => {
        if (settled) {
          disposeLateResult?.(result);
          return;
        }
        finish();
        resolve(result);
      }, (error: unknown) => {
        if (settled) return;
        finish();
        reject(error);
      });
    });
  }

  async *exportAudio(
    project: Project,
    settings: Partial<AudioExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const requested: AudioExportSettings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...settings,
    };
    // A 5.1 sequence exports a six-channel WAV; the other audio formats are stereo, so they get the downmix.
    let fullSettings: AudioExportSettings = resolveSequenceAudioSettings(
      project,
      requested.format === "wav" || isDolbyFormat(requested.format) ? requested : { ...requested, channelLayout: "stereo" },
    );

    if (isDolbyFormat(fullSettings.format)) {
      const problem = dolbyChannelsProblem(fullSettings.channels);
      if (problem) return { success: false, error: this.createError("INVALID_SETTINGS", problem, "preparing") };
      fullSettings = resolveDolbyAudioSettings(fullSettings);
    }

    if (!this.mediabunny && fullSettings.format !== "wav" && !isDolbyFormat(fullSettings.format)) {
      return {
        success: false,
        error: this.createError(
          "UNSUPPORTED_CODEC",
          `Audio export to ${fullSettings.format} format requires MediaBunny. WAV format is available as a fallback.`,
          "preparing",
        ),
      };
    }

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    if (this.currentExport) return { success: false, error: this.createError("INVALID_SETTINGS", "An export is already running. Wait for it to finish or cancel it before retrying.", "preparing") };
    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    this.loudnessReport = undefined;

    try {
      yield this.createProgress("preparing", 0, 1, 0, 0);
      let audioBuffer = await this.renderTimelineAudio(project, 0, undefined, fullSettings);
      if (this.abortController?.signal.aborted) throw this.createError("CANCELLED", "Export cancelled by user", "rendering");

      if (!audioBuffer) {
        throw this.createError(
          "AUDIO_ENCODE_FAILED",
          "No audio to export",
          "rendering",
        );
      }
      const loudnessTarget = activeLoudnessTarget(fullSettings.loudness);
      if (loudnessTarget) {
        const normalized = normalizeAudioBuffer(audioBuffer, loudnessTarget);
        audioBuffer = normalized.buffer;
        this.loudnessReport = normalized.report;
      }

      yield this.createProgress("encoding", 0.5, 1, 0, 0);

      // Encode based on format
      let blob: Blob;

      if (fullSettings.format === "wav") {
        blob = this.encodeWav(audioBuffer, fullSettings);
      } else if (isDolbyFormat(fullSettings.format)) {
        blob = await this.encodeDolbyAudioBlob(audioBuffer, fullSettings, this.abortController?.signal);
      } else {
        // Use MediaBunny for other formats
        blob = await this.encodeAudioWithMediaBunny(audioBuffer, fullSettings);
      }

      if (this.abortController?.signal.aborted) throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
      yield this.createProgress("complete", 1, 1, 1, blob.size);

      return {
        success: true,
        blob,
        stats: {
          duration: Date.now() - this.currentExport!.startTime,
          framesRendered: 1,
          averageSpeed: 1,
          fileSize: blob.size,
          averageBitrate: (blob.size * 8) / timelineDuration,
          ...(this.loudnessReport ? { loudness: this.loudnessReport } : {}),
          sourceMedia: proxyExportReport(project),
        },
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        return { success: false, error: error as ExportError };
      }
      return {
        success: false,
        error: this.createError(
          "AUDIO_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "encoding",
        ),
      };
    } finally {
      this.abortController = null;
      this.currentExport = null;
    }
  }

  async exportFrame(
    project: Project,
    time: number,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    this.ensureInitialized();

    const fullSettings: ImageExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      ...settings,
    };

    try {
      const renderedFrame = await this.videoEngine!.renderFrame(
        project,
        time,
        fullSettings.width,
        fullSettings.height,
      );

      // Scale if needed (fallback in case render didn't match)
      let canvas: OffscreenCanvas;
      if (
        fullSettings.width !== renderedFrame.width ||
        fullSettings.height !== renderedFrame.height
      ) {
        canvas = new OffscreenCanvas(fullSettings.width, fullSettings.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            renderedFrame.image,
            0,
            0,
            fullSettings.width,
            fullSettings.height,
          );
        }
        renderedFrame.image.close();
      } else {
        canvas = new OffscreenCanvas(renderedFrame.width, renderedFrame.height);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(renderedFrame.image, 0, 0);
        }
        renderedFrame.image.close();
      }
      const mimeType = this.getImageMimeType(fullSettings.format);
      const blob = await canvas.convertToBlob({
        type: mimeType,
        quality: fullSettings.quality / 100,
      });

      return {
        success: true,
        blob,
        stats: {
          duration: 0,
          framesRendered: 1,
          averageSpeed: 0,
          fileSize: blob.size,
          averageBitrate: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createError(
          "FRAME_ENCODE_FAILED",
          error instanceof Error ? error.message : "Unknown error",
          "rendering",
        ),
      };
    }
  }

  async exportImage(
    project: Project,
    settings: Partial<ImageExportSettings> = {},
  ): Promise<ExportResult> {
    return this.exportFrame(project, 0, settings);
  }

  /**
   * Frame range (project frames, inclusive) as a zip of PNG/JPEG frames named by `namingPattern`.
   * Delegates to {@link exportImageSequenceZip}; the result blob is the zip.
   */
  async *exportImageSequence(
    project: Project,
    settings: Partial<SequenceExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    const frameRate = project.settings.frameRate;
    const range =
      settings.startFrame !== undefined || settings.endFrame !== undefined
        ? {
            startTime: (settings.startFrame ?? 0) / frameRate,
            endTime: ((settings.endFrame ?? Math.ceil(project.timeline.duration * frameRate) - 1) + 1) / frameRate,
          }
        : undefined;
    return yield* this.exportImageSequenceZip(project, {
      format: settings.format === "jpg" ? "jpg" : "png",
      quality: settings.quality,
      width: settings.width,
      height: settings.height,
      range,
      pattern: settings.namingPattern,
    });
  }

  /** Render one timeline frame onto an OffscreenCanvas of the given size. */
  private async renderFrameCanvas(project: Project, time: number, width: number, height: number): Promise<OffscreenCanvas> {
    const rendered = await this.videoEngine!.renderFrame(project, time, width, height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(rendered.image, 0, 0, width, height);
    rendered.image.close();
    return canvas;
  }

  /**
   * Image-sequence export: every frame of the range as a PNG or JPEG, numbered from the pattern
   * (`frame_{0000}`), delivered as one zip. `range` is timeline seconds (Out exclusive); omit for everything.
   */
  async *exportImageSequenceZip(
    project: Project,
    options: {
      format?: SequenceImageFormat;
      quality?: number;
      width?: number;
      height?: number;
      range?: { startTime: number; endTime: number };
      pattern?: string;
      startNumber?: number;
    } = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();
    const frameRate = project.settings.frameRate;
    const format = options.format ?? "png";
    const width = options.width ?? project.settings.width;
    const height = options.height ?? project.settings.height;
    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    this.loudnessReport = undefined;
    try {
      const range = sequenceFrameRange(project.timeline.duration, frameRate, options.range);
      const invalid = validateSequenceRange(range);
      if (invalid) throw this.createError("INVALID_SETTINGS", invalid, "preparing");
      const total = range.endFrame - range.startFrame + 1;
      const frames: Uint8Array[] = [];
      let bytes = 0;
      yield this.createProgress("preparing", 0, total, 0, 0);
      for (let i = 0; i < total; i++) {
        if (this.abortController.signal.aborted) throw this.createError("CANCELLED", "Export cancelled by user", "rendering");
        const canvas = await this.renderFrameCanvas(project, (range.startFrame + i) / frameRate, width, height);
        const blob = await canvas.convertToBlob({ type: this.getImageMimeType(format), quality: (options.quality ?? 92) / 100 });
        const data = new Uint8Array(await blob.arrayBuffer());
        frames.push(data);
        bytes += data.byteLength;
        if (bytes > MAX_SEQUENCE_BYTES) throw this.createError("INVALID_SETTINGS", "The image sequence is too large to build in memory; reduce its size, range or quality.", "rendering");
        this.currentExport.framesRendered = i + 1;
        yield this.createProgress("rendering", (i + 1) / total, total, i + 1, bytes);
      }
      yield this.createProgress("muxing", 1, total, total, bytes);
      const zip = await packImageSequence(frames, {
        pattern: options.pattern ?? "frame_{0000}",
        format,
        startFrame: range.startFrame,
        startNumber: options.startNumber,
      });
      yield this.createProgress("complete", 1, total, total, zip.byteLength);
      return { success: true, blob: new Blob([zip as BlobPart], { type: "application/zip" }), stats: this.calculateStats(total, zip.byteLength) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) return { success: false, error: error as ExportError };
      return { success: false, error: this.createError("FRAME_ENCODE_FAILED", error instanceof Error ? error.message : "Unknown error", "rendering") };
    } finally {
      this.abortController = null;
      this.currentExport = null;
    }
  }

  /**
   * Animated GIF export: frames sampled at `fps` over the range, one global palette (`maxColors`),
   * `loop` times (0 = forever). GIF holds at most 50 fps and 4096 px a side.
   */
  async *exportGif(
    project: Project,
    options: {
      fps?: number;
      width?: number;
      height?: number;
      maxColors?: number;
      loop?: number | "none";
      range?: { startTime: number; endTime: number };
    } = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();
    // Frames are sampled at the rate the GIF really plays at (whole-centisecond delays), so duration stays true.
    const fps = gifPlaybackFps(options.fps ?? Math.min(15, project.settings.frameRate));
    const scale = Math.min(1, 640 / project.settings.width);
    const width = options.width ?? Math.max(2, Math.round(project.settings.width * scale));
    const height = options.height ?? Math.max(2, Math.round(project.settings.height * scale));
    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };
    this.loudnessReport = undefined;
    try {
      const invalid = validateGifOptions({ width, height, fps, maxColors: options.maxColors, loop: options.loop });
      if (invalid) throw this.createError("INVALID_SETTINGS", invalid, "preparing");
      const duration = project.timeline.duration;
      const start = options.range?.startTime ?? 0;
      const end = Math.min(duration, options.range?.endTime ?? duration);
      if (!(end > start)) throw this.createError("INVALID_SETTINGS", "There is nothing to export in that range.", "preparing");
      const total = Math.max(1, Math.round((end - start) * fps));
      const budget = validateGifFrameBudget(width, height, total);
      if (budget) throw this.createError("INVALID_SETTINGS", budget, "preparing");
      const frames: GifFrame[] = [];
      yield this.createProgress("preparing", 0, total, 0, 0);
      for (let i = 0; i < total; i++) {
        if (this.abortController.signal.aborted) throw this.createError("CANCELLED", "Export cancelled by user", "rendering");
        const canvas = await this.renderFrameCanvas(project, start + i / fps, width, height);
        const image = canvas.getContext("2d")!.getImageData(0, 0, width, height);
        frames.push({ data: image.data });
        this.currentExport.framesRendered = i + 1;
        yield this.createProgress("rendering", (i + 1) / total, total, i + 1, 0);
      }
      yield this.createProgress("encoding", 1, total, total, 0);
      const gif = encodeGif(frames, { width, height, fps, maxColors: options.maxColors, loop: options.loop });
      yield this.createProgress("complete", 1, total, total, gif.byteLength);
      return { success: true, blob: new Blob([gif as BlobPart], { type: "image/gif" }), stats: this.calculateStats(total, gif.byteLength) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) return { success: false, error: error as ExportError };
      return { success: false, error: this.createError("FRAME_ENCODE_FAILED", error instanceof Error ? error.message : "Unknown error", "encoding") };
    } finally {
      this.abortController = null;
      this.currentExport = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getPresets(): ExportPreset[] {
    return [
      {
        id: "4k-master",
        name: "4K Master Quality",
        description: "Maximum quality 4K for professional delivery",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
          quality: 95,
        },
      },
      {
        id: "4k-prores-hq",
        name: "4K ProRes HQ",
        description: "Professional 4K ProRes for editing/mastering",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 880000,
          quality: 100,
        },
      },
      {
        id: "4k-prores-4444",
        name: "4K ProRes 4444",
        description: "Highest quality ProRes with alpha channel support",
        category: "broadcast",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 3840,
          height: 2160,
          frameRate: 30,
          format: "mov",
          codec: "prores",
          proresProfile: "4444",
          bitrate: 1320000,
          quality: 100,
        },
      },
      {
        id: "youtube-4k",
        name: "YouTube 4K",
        description: "4K UHD optimized for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k"],
          codec: "h264",
        },
      },
      {
        id: "youtube-4k-60",
        name: "YouTube 4K 60fps",
        description: "4K 60fps for YouTube gaming/motion",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-60"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p-high",
        name: "YouTube 1080p High",
        description: "High bitrate 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p-high"],
          codec: "h264",
        },
      },
      {
        id: "youtube-1080p",
        name: "YouTube 1080p",
        description: "Standard 1080p for YouTube",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["1080p"],
          codec: "h264",
        },
      },
      {
        id: "tiktok-1080p",
        name: "TikTok/Reels",
        description: "Vertical 1080x1920 for TikTok/Reels",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1080,
          height: 1920,
          bitrate: 15000,
          frameRate: 30,
          codec: "h264",
        },
      },
      {
        id: "twitter",
        name: "Twitter/X",
        description: "Optimized for Twitter",
        category: "social",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["720p"],
          codec: "h264",
        },
      },
      {
        id: "web-vp9",
        name: "Web (VP9)",
        description: "WebM VP9 for web embedding (720p for stability)",
        category: "web",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          format: "webm",
          codec: "vp9",
          ...VIDEO_QUALITY_PRESETS["720p"],
        },
      },
      {
        id: "archive-4k",
        name: "Archive 4K",
        description: "High quality 4K for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          ...VIDEO_QUALITY_PRESETS["4k-high"],
          codec: "h265",
        },
      },
      {
        id: "archive-prores",
        name: "Archive ProRes",
        description: "Lossless quality ProRes for archival",
        category: "archive",
        settings: {
          ...DEFAULT_VIDEO_SETTINGS,
          width: 1920,
          height: 1080,
          format: "mov",
          codec: "prores",
          proresProfile: "hq",
          bitrate: 220000,
          quality: 100,
        },
      },
      {
        id: "audio-mp3",
        name: "MP3 Audio",
        description: "MP3 320kbps",
        category: "custom",
        settings: DEFAULT_AUDIO_SETTINGS,
      },
      {
        id: "audio-wav",
        name: "WAV Audio",
        description: "Uncompressed WAV 24-bit",
        category: "archive",
        settings: {
          ...DEFAULT_AUDIO_SETTINGS,
          format: "wav",
          bitDepth: 24,
          sampleRate: 48000,
        },
      },
      {
        id: "audio-ac3",
        name: "Dolby Digital (AC-3) Audio",
        description: "Raw .ac3 stream, 192 kbps stereo or 5.1 at 384 kbps or more",
        category: "broadcast",
        settings: { ...DEFAULT_AUDIO_SETTINGS, format: "ac3", bitDepth: 24, bitrate: 192 },
      },
      {
        id: "audio-eac3",
        name: "Dolby Digital Plus (E-AC-3) Audio",
        description: "Raw .ec3 stream, 256 kbps stereo or 5.1 at 384 kbps or more",
        category: "broadcast",
        settings: { ...DEFAULT_AUDIO_SETTINGS, format: "eac3", bitDepth: 24, bitrate: 256 },
      },
    ];
  }

  createPreset(
    name: string,
    settings: VideoExportSettings | AudioExportSettings | ImageExportSettings,
  ): ExportPreset {
    return {
      id: `custom-${Date.now()}`,
      name,
      description: "Custom preset",
      settings,
      category: "custom",
    };
  }

  estimateFileSize(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = "codec" in settings && settings.range
      ? settings.range.endTime - settings.range.startTime : project.timeline.duration;

    if ("codec" in settings) {
      const videoBitrate = settings.bitrate * 1000;
      const audioBitrate = settings.audioSettings.bitrate * 1000;
      return Math.ceil(((videoBitrate + audioBitrate) * duration) / 8);
    } else {
      if (settings.format === "wav") {
        return Math.ceil(
          duration *
            settings.sampleRate *
            settings.channels *
            (settings.bitDepth / 8),
        );
      }
      return Math.ceil((settings.bitrate * 1000 * duration) / 8);
    }
  }

  estimateExportTime(
    project: Project,
    settings: VideoExportSettings | AudioExportSettings,
  ): number {
    const duration = "codec" in settings && settings.range
      ? settings.range.endTime - settings.range.startTime : project.timeline.duration;

    if ("codec" in settings) {
      const pixelCount = settings.width * settings.height;
      const complexity = pixelCount / (1920 * 1080);
      const codecFactor =
        settings.codec === "h265" || settings.codec === "av1" ? 2 : 1;
      return duration * complexity * codecFactor * 0.5;
    } else {
      return duration * 0.1;
    }
  }

  private async renderTimelineAudio(
    project: Project,
    startTime: number = 0,
    duration?: number,
    audioSettings?: AudioExportSettings,
  ): Promise<AudioBuffer | null> {
    const { timeline } = project;

    const hasAudio = timeline.tracks.some(
      (track) => !track.muted && trackHasAudioItems(project, track.id),
    );

    if (!hasAudio) {
      return null;
    }

    const timelineDuration = this.calculateTimelineDuration(timeline);
    if (timelineDuration <= 0) {
      return null;
    }

    const renderDuration = Math.max(
      0,
      Math.min(duration ?? timelineDuration, timelineDuration - startTime),
    );
    if (renderDuration <= 0) {
      return null;
    }

    const renderProject = audioSettings && (project.settings.sampleRate !== audioSettings.sampleRate || project.settings.channels !== audioSettings.channels)
      ? { ...project, settings: { ...project.settings, sampleRate: audioSettings.sampleRate, channels: audioSettings.channels } }
      : project;
    // Unchanged windows (second loudness pass, repeated exports, queued variants)
    // come from the mixdown cache; its key covers every audio-relevant edit.
    const mixed = await renderMixdownCached(
      renderProject,
      startTime,
      renderDuration,
      async () => (await this.audioEngine!.renderAudio(renderProject, startTime, renderDuration)).buffer,
      audioBufferFromChunk,
    );
    // A 5.1 sequence exported as stereo: mixed in 5.1, then folded down (ITU-R BS.775).
    if (audioSettings?.channels === 2 && isSurroundLayout(project.settings) && mixed.numberOfChannels === 6) {
      return createAudioBufferFromChannels(downmixSurroundToStereo(audioBufferChannels(mixed)), mixed.sampleRate) ?? mixed;
    }
    return mixed;
  }

  /**
   * Loudness of the mixdown for [rangeStart, rangeStart + rangeDuration), rendered
   * through the same offline path (and 15 s chunking) the export encodes.
   */
  private async measureMixdownLoudness(
    project: Project,
    audioSettings: AudioExportSettings,
    rangeStart: number,
    rangeDuration: number,
    signal: AbortSignal | undefined = this.abortController?.signal,
  ): Promise<LoudnessSnapshot> {
    return measureRenderedLoudness({
      sampleRate: audioSettings.sampleRate,
      channels: audioSettings.channels,
      duration: rangeDuration,
      chunkSeconds: ExportEngine.AUDIO_EXPORT_CHUNK_DURATION_SECONDS,
      signal,
      render: async (start, duration) => {
        const buffer = await this.renderTimelineAudio(project, rangeStart + start, duration, audioSettings);
        return buffer ? { sampleRate: buffer.sampleRate, channels: audioBufferChannels(buffer) } : null;
      },
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw this.createError("CANCELLED", "Export cancelled by user", "encoding");
      }
      throw error;
    });
  }

  private async encodeTimelineAudioToBackend(
    project: Project,
    backend: EncoderBackend,
    audioSettings: AudioExportSettings,
    rangeStart = 0,
    rangeDuration = this.calculateTimelineDuration(project.timeline),
    // Captured by the caller: this task can outlive the export (this.abortController is nulled
    // in its finally), and must still see its own export's abort, never a later export's.
    signal: AbortSignal | undefined = this.abortController?.signal,
    broadcast?: BroadcastDeliverySettings,
  ): Promise<void> {
    const timelineDuration = rangeDuration;
    // Broadcast delivery: N mono tracks (stereo mix on 1-2, then stems or silence) instead of the stereo stream.
    const trackCount = broadcastAudioTrackCount(broadcast);
    const stemItems = trackCount > 2 && broadcast?.extraTracks === "stems" ? planStems(project, { mode: "audioType" }).slice(0, trackCount - 2) : [];
    const channelPlan = trackCount > 0 ? planBroadcastChannels(trackCount, broadcast?.extraTracks, stemItems.length) : [];
    const isolatedStems = stemItems.map((item) => isolateStem(project, item));
    const renderStemChunk = async (stem: Project | undefined, start: number, duration: number): Promise<Float32Array[]> => {
      if (!stem) return [new Float32Array(Math.max(1, Math.round(duration * audioSettings.sampleRate)))];
      const stemProject = stem.settings.sampleRate === audioSettings.sampleRate && stem.settings.channels === audioSettings.channels
        ? stem
        : { ...stem, settings: { ...stem.settings, sampleRate: audioSettings.sampleRate, channels: audioSettings.channels } };
      return audioBufferChannels((await this.audioEngine!.renderAudio(stemProject, start, duration)).buffer);
    };
    /** The chunk as the N-channel delivery buffer. */
    const toBroadcastChannels = async (mix: Float32Array[], absStart: number, duration: number): Promise<Float32Array[]> => {
      const frames = mix[0]?.length ?? 0;
      const stems: Float32Array[][] = [];
      for (const stem of isolatedStems) stems.push(await renderStemChunk(stem, absStart, duration));
      return layoutBroadcastChannels(channelPlan, mix, stems, frames);
    };
    if (timelineDuration <= 0) {
      return;
    }

    const chunkDuration = ExportEngine.AUDIO_EXPORT_CHUNK_DURATION_SECONDS;

    // Pass 1 (loudness target only): measure the whole mixdown, then derive the
    // static gain and whether the true-peak limiter is needed.
    let normalizer: LoudnessNormalizer | undefined;
    const loudnessTarget = activeLoudnessTarget(audioSettings.loudness);
    if (loudnessTarget) {
      const hasAudio = project.timeline.tracks.some(
        (track) => !track.muted && trackHasAudioItems(project, track.id),
      );
      if (hasAudio) {
        const measured = await this.measureMixdownLoudness(project, audioSettings, rangeStart, timelineDuration, signal);
        const plan = planNormalization(measured, loudnessTarget);
        normalizer = new LoudnessNormalizer(plan, loudnessTarget, audioSettings.sampleRate, audioSettings.channels);
        this.loudnessReport = buildLoudnessReport(loudnessTarget, measured, plan, normalizer);
      }
    }

    const emit = async (channels: Float32Array[], sampleRate: number): Promise<void> => {
      const out = createAudioBufferFromChannels(channels, sampleRate);
      if (out) await backend.addAudioBuffer(out);
    };

    let lastSampleRate: number = audioSettings.sampleRate;
    for (
      let startTime = 0;
      startTime < timelineDuration;
      startTime += chunkDuration
    ) {
      if (signal?.aborted) {
        throw this.createError(
          "CANCELLED",
          "Export cancelled by user",
          "encoding",
        );
      }

      const currentChunkDuration = Math.min(
        chunkDuration,
        timelineDuration - startTime,
      );
      const audioBuffer = await this.renderTimelineAudio(
        project,
        rangeStart + startTime,
        currentChunkDuration,
        audioSettings,
      );

      if (!audioBuffer) {
        continue;
      }

      if (normalizer) {
        lastSampleRate = audioBuffer.sampleRate;
        const processed = normalizer.process(audioBufferChannels(audioBuffer));
        // Loudness applies to the stereo mix; the extra tracks of a broadcast layout are silent with it (validated).
        await emit(trackCount > 0 ? layoutBroadcastChannels(channelPlan, processed, [], processed[0]?.length ?? 0) : processed, audioBuffer.sampleRate);
      } else if (trackCount > 0) {
        const delivery = createAudioBufferFromChannels(
          await toBroadcastChannels(audioBufferChannels(audioBuffer), rangeStart + startTime, currentChunkDuration),
          audioBuffer.sampleRate,
        );
        if (delivery) await backend.addAudioBuffer(delivery);
      } else {
        await backend.addAudioBuffer(audioBuffer);
      }

      // Yield between chunks so the browser can reclaim the previous buffer
      // before the next long-running render starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (normalizer) {
      // The look-ahead limiter holds back a few milliseconds; write them out.
      const tail = normalizer.flush();
      if (tail.length) await emit(trackCount > 0 ? layoutBroadcastChannels(channelPlan, tail, [], tail[0]?.length ?? 0) : tail, lastSampleRate);
      // Reflect the final limiter reduction in the report.
      if (this.loudnessReport) {
        this.loudnessReport = { ...this.loudnessReport, maxGainReductionDb: normalizer.maxGainReductionDb };
      }
    }
  }

  private async encodeAudioWithMediaBunny(
    buffer: AudioBuffer,
    settings: AudioExportSettings,
  ): Promise<Blob> {
    const {
      Output,
      BufferTarget,
      Mp3OutputFormat,
      AudioSampleSource,
      AudioSample,
      getFirstEncodableAudioCodec,
    } = this.mediabunny!;
    let outputFormat;
    switch (settings.format) {
      case "mp3":
        outputFormat = new Mp3OutputFormat();
        break;
      case "aac":
      case "flac":
      case "ogg":
      default:
        return this.encodeWav(buffer, settings);
    }

    const target = new BufferTarget();
    const output = new Output({ format: outputFormat, target });

    const audioCodec = await getFirstEncodableAudioCodec(
      outputFormat.getSupportedAudioCodecs(),
    );

    const audioSource = new AudioSampleSource({
      codec: audioCodec || "mp3",
      bitrate: settings.bitrate * 1000,
    });

    output.addAudioTrack(audioSource);
    await output.start();
    const audioSamples = AudioSample.fromAudioBuffer(buffer, 0);
    for (const sample of audioSamples) {
      await audioSource.add(sample);
      sample.close();
    }

    audioSource.close();
    await output.finalize();

    const resultBuffer = target.buffer;
    if (!resultBuffer) {
      throw new Error("Audio encoding failed");
    }

    return new Blob([resultBuffer], {
      type: this.getAudioMimeType(settings.format),
    });
  }

  /**
   * AC-3 / E-AC-3 elementary stream (`.ac3` / `.ec3`) of the mixdown. The mix is already stereo or L R C LFE Ls Rs;
   * it goes to the encoder as a 24-bit WAV (the 5.1 one carries the speaker mask) and ffmpeg does the rest.
   */
  private async encodeDolbyAudioBlob(buffer: AudioBuffer, settings: AudioExportSettings, signal?: AbortSignal): Promise<Blob> {
    const codec = settings.format as DolbyCodec;
    const channels = buffer.numberOfChannels >= 6 ? 6 : 2;
    const planes = Array.from({ length: channels }, (_, c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)));
    const wav = encodeMultichannelWav(planes, buffer.sampleRate, 24);
    const { encodeDolbyStream } = await import("./dolby-encode");
    const bytes = await encodeDolbyStream({
      wav,
      params: { codec, channels, bitrateKbps: settings.bitrate, sampleRate: buffer.sampleRate, dialnorm: settings.dialnorm ?? DEFAULT_DIALNORM },
    }, signal);
    return new Blob([bytes.buffer as ArrayBuffer], { type: dolbyMimeType(codec) });
  }

  private encodeWav(buffer: AudioBuffer, settings: AudioExportSettings): Blob {
    const numberOfChannels = Math.min(
      buffer.numberOfChannels,
      settings.channels,
    );
    const sampleRate = settings.sampleRate;
    const bitDepth = settings.bitDepth;

    if (numberOfChannels > 2) {
      // 5.1 WAV: WAVE_FORMAT_EXTENSIBLE with the L R C LFE Ls Rs speaker mask.
      const channels = Array.from({ length: numberOfChannels }, (_, c) => buffer.getChannelData(c));
      return new Blob([encodeMultichannelWav(channels, sampleRate, bitDepth).buffer as ArrayBuffer], { type: "audio/wav" });
    }

    if (bitDepth === 32) {
      return this.encodeWav32Float(buffer, numberOfChannels, sampleRate);
    }

    const encoder = getWavEncoder();
    const samples: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      samples.push(buffer.getChannelData(ch));
    }

    const wavData = encoder.encodeFullWav(
      samples,
      sampleRate,
      bitDepth as 16 | 24,
    );

    return new Blob([wavData.buffer as ArrayBuffer], { type: "audio/wav" });
  }

  private encodeWav32Float(
    buffer: AudioBuffer,
    numberOfChannels: number,
    sampleRate: number,
  ): Blob {
    const bitDepth = 32;
    const bytesPerSample = 4;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataLength = buffer.length * blockAlign;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    this.writeString(view, 0, "RIFF");
    view.setUint32(4, totalLength - 8, true);
    this.writeString(view, 8, "WAVE");
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        view.setFloat32(offset, buffer.getChannelData(channel)[i], true);
        offset += bytesPerSample;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  private getAudioMimeType(format: AudioExportSettings["format"]): string {
    switch (format) {
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "aac":
        return "audio/aac";
      case "flac":
        return "audio/flac";
      case "ogg":
        return "audio/ogg";
      case "ac3":
      case "eac3":
        return dolbyMimeType(format);
      default:
        return "audio/mpeg";
    }
  }

  private getImageMimeType(format: ImageExportSettings["format"]): string {
    switch (format) {
      case "png":
        return "image/png";
      case "webp":
        return "image/webp";
      case "jpg":
      default:
        return "image/jpeg";
    }
  }

  private createProgress(
    phase: ExportProgress["phase"],
    progress: number,
    totalFrames: number,
    currentFrame: number,
    bytesWritten: number,
  ): ExportProgress {
    const elapsed = this.currentExport
      ? (Date.now() - this.currentExport.startTime) / 1000
      : 0;
    const framesPerSecond = elapsed > 0 ? currentFrame / elapsed : 0;
    const remainingFrames = totalFrames - currentFrame;
    const estimatedTimeRemaining =
      framesPerSecond > 0 ? remainingFrames / framesPerSecond : 0;

    return {
      phase,
      progress,
      estimatedTimeRemaining,
      currentFrame,
      totalFrames,
      bytesWritten,
      currentBitrate: elapsed > 0 ? (bytesWritten * 8) / elapsed : 0,
    };
  }

  private createError(
    code: ExportError["code"],
    message: string,
    phase: ExportProgress["phase"],
  ): ExportError {
    return {
      code,
      message,
      phase,
      recoverable: code === "CANCELLED",
    };
  }

  private calculateStats(totalFrames: number, fileSize: number): ExportStats {
    const duration = this.currentExport
      ? Date.now() - this.currentExport.startTime
      : 0;
    const framesRendered = this.currentExport?.framesRendered || totalFrames;

    return {
      duration,
      framesRendered,
      averageSpeed: duration > 0 ? (framesRendered / duration) * 1000 : 0,
      fileSize,
      averageBitrate: duration > 0 ? (fileSize * 8000) / duration : 0,
    };
  }

  private calculateTimelineDuration(timeline: Project["timeline"]): number {
    let maxEndTime = 0;
    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        const endTime = clip.startTime + clip.duration;
        if (endTime > maxEndTime) {
          maxEndTime = endTime;
        }
      }
    }
    // Overlays live in project-wide engines: only those on THIS timeline's tracks count. Overlays of
    // other sequences (or moved into a nest, on the nest's own clock) must not stretch the export.
    const ownTrackIds = new Set(timeline.tracks.map((track) => track.id));
    const textClips = titleEngine.getAllTextClips().filter((clip) => ownTrackIds.has(clip.trackId));
    for (const textClip of textClips) {
      const endTime = textClip.startTime + textClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const shapeClips = graphicsEngine.getAllShapeClips().filter((clip) => ownTrackIds.has(clip.trackId));
    for (const shapeClip of shapeClips) {
      const endTime = shapeClip.startTime + shapeClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const svgClips = graphicsEngine.getAllSVGClips().filter((clip) => ownTrackIds.has(clip.trackId));
    for (const svgClip of svgClips) {
      const endTime = svgClip.startTime + svgClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const stickerClips = graphicsEngine.getAllStickerClips().filter((clip) => ownTrackIds.has(clip.trackId));
    for (const stickerClip of stickerClips) {
      const endTime = stickerClip.startTime + stickerClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    if (timeline.subtitles) {
      for (const subtitle of timeline.subtitles) {
        if (subtitle.endTime > maxEndTime) {
          maxEndTime = subtitle.endTime;
        }
      }
    }

    return maxEndTime;
  }

  private shouldApplyUpscaling(
    project: Project,
    settings: VideoExportSettings,
  ): boolean {
    if (!settings.upscaling?.enabled) {
      return false;
    }

    const sourceWidth = project.settings.width;
    const sourceHeight = project.settings.height;
    const targetWidth = settings.width;
    const targetHeight = settings.height;

    return targetWidth > sourceWidth || targetHeight > sourceHeight;
  }

  dispose(): void {
    this.cancel();
    this.terminateWorker();
    this.mediabunny = null;
    this.videoEngine = null;
    this.audioEngine = null;
    if (this.upscalingEngine) {
      this.upscalingEngine.clearTexturePool();
      this.upscalingEngine = null;
    }
    this.initialized = false;
  }
}

/** An export engine with its own VideoEngine and AudioEngine; `dispose()` releases all three. */
export function createIsolatedExportEngine(options: ExportEngineOptions = {}): { engine: ExportEngine; dispose: () => Promise<void> } {
  const videoEngine = options.videoEngine ?? new VideoEngine();
  const audioEngine = options.audioEngine ?? new AudioEngine();
  const engine = new ExportEngine({ videoEngine, audioEngine });
  return {
    engine,
    dispose: async () => {
      engine.dispose();
      try { videoEngine.dispose(); } catch { /* best effort */ }
      try { await audioEngine.dispose(); } catch { /* best effort */ }
    },
  };
}

export { setEncoderBackendFactory };
// Lives in ./types so startup-path modules can import it without pulling the export engine.
export { exportWritesAlpha };

/** Broadcast options only the ffmpeg sidecar can write: mono audio tracks, OP-Atom, interlaced flags, a timecode track. */
export function hasBroadcastOptions(broadcast: BroadcastDeliverySettings | undefined): boolean {
  return !!broadcast && (wantsMonoTracks(broadcast) || broadcast.mxfPattern === "opatom" || broadcast.scan === "interlaced-tff" || !!broadcast.startTimecode);
}

export function exportSettingsRequireNativeEncoder(
  settings: Pick<VideoExportSettings, "codec" | "format"> & Partial<Pick<VideoExportSettings, "colorDepth" | "pixelFormat" | "broadcast" | "audioSettings">>,
): boolean {
  return settings.format === "mkv" || isDolbyFormat(settings.audioSettings?.format) || settings.codec === "prores" || settings.codec === "dnxhr" || isBroadcastCodec(settings.codec) || hasBroadcastOptions(settings.broadcast) || settings.format === "mxf" || (settings.colorDepth ?? 8) > 8 || Boolean(settings.pixelFormat && settings.pixelFormat !== "yuv420");
}

/**
 * Desktop routing: everything the browser encoders cannot do, plus HDR (PQ / HLG). The ffmpeg sidecar writes
 * HEVC Main10 with mastering metadata on every machine, while WebCodecs Main10 depends on the GPU and driver.
 * The web build keeps using exportSettingsRequireNativeEncoder, where HDR goes through WebCodecs when it can.
 */
export function desktopExportRequiresNativeEncoder(
  settings: Pick<VideoExportSettings, "codec" | "format"> & Partial<Pick<VideoExportSettings, "colorDepth" | "pixelFormat" | "hdr" | "broadcast" | "audioSettings">>,
): boolean {
  return exportSettingsRequireNativeEncoder(settings) || settings.hdr === "pq" || settings.hdr === "hlg";
}

let exportEngineInstance: ExportEngine | null = null;

export function getExportEngine(): ExportEngine {
  if (!exportEngineInstance) {
    exportEngineInstance = new ExportEngine();
  }
  return exportEngineInstance;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
