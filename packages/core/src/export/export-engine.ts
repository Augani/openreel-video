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
} from "./types";
import {
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  VIDEO_QUALITY_PRESETS,
} from "./types";
import { VideoEngine, getVideoEngine } from "../video/video-engine";
import { AudioEngine, getAudioEngine } from "../audio/audio-engine";
import { titleEngine } from "../text/title-engine";
import { graphicsEngine } from "../graphics/graphics-engine";
import { UpscalingEngine, getUpscalingEngine } from "../video/upscaling";
import { getMediaEngine } from "../media/mediabunny-engine";
import { getFFmpegFallback } from "../media/ffmpeg-fallback";
import { getWavEncoder } from "../wasm/wav";

export class ExportEngine {
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
      this.videoEngine = getVideoEngine();
      this.audioEngine = getAudioEngine();

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
    if (!this.initialized || !this.mediabunny) {
      throw new Error("ExportEngine not initialized. Call initialize() first.");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findSupportedAudioCodec(
    outputFormat: { getSupportedAudioCodecs: () => any[] },
    audioSettings: AudioExportSettings,
    getFirstEncodableAudioCodec: (codecs: any[]) => Promise<string | null>,
  ): Promise<{ codec: string; bitrate: number }> {
    const supportedCodecs = outputFormat.getSupportedAudioCodecs();
    const requestedBitrate = audioSettings.bitrate * 1000;

    const bitrateFallbacks = [requestedBitrate, 192000, 128000, 96000].filter(
      (b, i, arr) => arr.indexOf(b) === i,
    );

    for (const bitrate of bitrateFallbacks) {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      if (codec) {
        const isSupported = await this.isAudioConfigSupported(
          codec,
          bitrate,
          audioSettings.channels,
          audioSettings.sampleRate,
        );
        if (isSupported) {
          return { codec, bitrate };
        }
      }
    }

    for (const fallbackCodec of ["aac", "mp3", "opus"]) {
      if (
        supportedCodecs.some((c: string) =>
          String(c).toLowerCase().includes(fallbackCodec) ||
          (fallbackCodec === "aac" && String(c).toLowerCase().includes("mp4a")),
        )
      ) {
        for (const bitrate of bitrateFallbacks) {
          const isSupported = await this.isAudioConfigSupported(
            fallbackCodec,
            bitrate,
            audioSettings.channels,
            audioSettings.sampleRate,
          );
          if (isSupported) {
            return { codec: fallbackCodec, bitrate };
          }
        }
      }
    }

    const defaultCodec = await getFirstEncodableAudioCodec(supportedCodecs);
    return {
      codec: defaultCodec || "aac",
      bitrate: 128000,
    };
  }

  private async isAudioConfigSupported(
    codec: string,
    bitrate: number,
    channels: number,
    sampleRate: number,
  ): Promise<boolean> {
    if (typeof AudioEncoder === "undefined") {
      return true;
    }

    try {
      let codecString: string;
      if (codec === "aac" || codec.includes("mp4a")) {
        codecString = "mp4a.40.2";
      } else if (codec === "opus") {
        codecString = "opus";
      } else if (codec === "mp3") {
        codecString = "mp3";
      } else {
        codecString = codec;
      }

      const config: AudioEncoderConfig = {
        codec: codecString,
        sampleRate,
        numberOfChannels: channels,
        bitrate,
      };

      const support = await AudioEncoder.isConfigSupported(config);
      return support.supported === true;
    } catch {
      return false;
    }
  }

  async *exportVideo(
    project: Project,
    settings: Partial<VideoExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

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

    if (fullSettings.codec === "prores") {
      console.warn(
        `[ExportEngine] ProRes encoding is not supported in browsers. Switching to H.264 high quality.`,
      );
      fullSettings.codec = "h264";
      fullSettings.format = "mp4";
      fullSettings.bitrate = 25000;
      fullSettings.quality = 95;
    }

    const pixelCount = fullSettings.width * fullSettings.height;
    const isMemoryIntensiveCodec =
      fullSettings.codec === "vp9" ||
      fullSettings.codec === "av1" ||
      fullSettings.codec === "h265";
    const maxSafePixels = isMemoryIntensiveCodec ? 1920 * 1080 : 3840 * 2160;

    if (pixelCount > maxSafePixels && isMemoryIntensiveCodec) {
      console.warn(
        `[ExportEngine] ${fullSettings.codec.toUpperCase()} at ${fullSettings.width}x${fullSettings.height} may cause browser instability. Reducing to 1080p for stability.`,
      );
      const aspectRatio = fullSettings.width / fullSettings.height;
      if (aspectRatio > 1) {
        fullSettings.width = 1920;
        fullSettings.height = Math.round(1920 / aspectRatio);
      } else {
        fullSettings.height = 1920;
        fullSettings.width = Math.round(1920 * aspectRatio);
      }
      fullSettings.width = Math.round(fullSettings.width / 2) * 2;
      fullSettings.height = Math.round(fullSettings.height / 2) * 2;
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    await this.initializeGPUForExport(
      fullSettings.width,
      fullSettings.height,
    );

    this.videoEngine?.resetExportState();

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    const totalFrames = Math.ceil(timelineDuration * fullSettings.frameRate);
    let bytesWritten = 0;

    try {
      yield this.createProgress("preparing", 0, totalFrames, 0, 0);

      const {
        Output,
        BufferTarget,
        Mp4OutputFormat,
        WebMOutputFormat,
        MovOutputFormat,
        VideoSampleSource,
        AudioSampleSource,
        VideoSample,
        AudioSample,
        getFirstEncodableVideoCodec,
        getFirstEncodableAudioCodec,
        QUALITY_MEDIUM,
      } = this.mediabunny!;
      let outputFormat;
      switch (fullSettings.format) {
        case "webm":
          outputFormat = new WebMOutputFormat();
          break;
        case "mov":
          outputFormat = new MovOutputFormat();
          break;
        case "mp4":
        default:
          outputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
          break;
      }

      const target = new BufferTarget();
      const output = new Output({ format: outputFormat, target });
      const videoCodec = await getFirstEncodableVideoCodec(
        outputFormat.getSupportedVideoCodecs(),
        { width: fullSettings.width, height: fullSettings.height },
      );

      if (!videoCodec) {
        throw this.createError(
          "UNSUPPORTED_CODEC",
          "No supported video codec found",
          "preparing",
        );
      }

      const audioCodecResult = await this.findSupportedAudioCodec(
        outputFormat,
        fullSettings.audioSettings,
        getFirstEncodableAudioCodec,
      );

      const videoSource = new VideoSampleSource({
        codec: videoCodec,
        bitrate: QUALITY_MEDIUM,
        keyFrameInterval:
          fullSettings.keyframeInterval / fullSettings.frameRate,
        hardwareAcceleration: "prefer-hardware",
      });
      const audioSource = new AudioSampleSource({
        codec: audioCodecResult.codec as "aac" | "opus" | "mp3",
        bitrate: audioCodecResult.bitrate,
      });
      output.addVideoTrack(videoSource);
      output.addAudioTrack(audioSource);
      output.setMetadataTags({
        title: project.name,
        date: new Date(),
      });

      await output.start();

      const isIntensiveCodec =
        fullSettings.codec === "vp9" ||
        fullSettings.codec === "av1" ||
        fullSettings.codec === "h265";
      const microFlushInterval = isIntensiveCodec ? 5 : 10;
      const majorFlushInterval = 30;
      const cacheCleanInterval = 90;

      for (let frame = 0; frame < totalFrames; frame++) {
        if (this.abortController.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const time = frame / fullSettings.frameRate;
        const rendered = await this.videoEngine!.renderFrame(
          project,
          time,
          fullSettings.width,
          fullSettings.height,
        );
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

        const videoSample = new VideoSample(frameImage, {
          timestamp: time,
          duration: 1 / fullSettings.frameRate,
        });

        await videoSource.add(videoSample);
        videoSample.close();
        frameImage.close();

        this.currentExport!.framesRendered = frame + 1;

        if ((frame + 1) % microFlushInterval === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if ((frame + 1) % majorFlushInterval === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if ((frame + 1) % cacheCleanInterval === 0) {
          this.videoEngine?.clearVideoElementCache();
          try {
            const mediaEngine = getMediaEngine();
            mediaEngine.clearFrameCache();
          } catch {
            // MediaEngine may not be initialized
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        yield this.createProgress(
          "rendering",
          (frame + 1) / totalFrames,
          totalFrames,
          frame + 1,
          bytesWritten,
        );
      }
      yield this.createProgress(
        "encoding",
        0.95,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      const audioBuffer = await this.renderTimelineAudio(project, fullSettings);
      if (audioBuffer) {
        const audioSamples = AudioSample.fromAudioBuffer(audioBuffer, 0);
        for (const sample of audioSamples) {
          await audioSource.add(sample);
          sample.close();
        }
      }
      videoSource.close();
      audioSource.close();

      yield this.createProgress(
        "muxing",
        0.98,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      await output.finalize();
      const buffer = target.buffer;
      if (!buffer) {
        throw this.createError(
          "MUXER_ERROR",
          "Output buffer is empty",
          "muxing",
        );
      }

      const blob = new Blob([buffer], {
        type: this.getMimeType(fullSettings.format),
      });
      bytesWritten = blob.size;

      yield this.createProgress(
        "complete",
        1,
        totalFrames,
        totalFrames,
        bytesWritten,
      );

      return {
        success: true,
        blob,
        stats: this.calculateStats(totalFrames, bytesWritten),
      };
    } catch (error) {
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
      this.abortController = null;
      this.currentExport = null;
      this.videoEngine?.clearVideoElementCache();
    }
  }

  async *exportVideoWithWorker(
    project: Project,
    settings: Partial<VideoExportSettings> = {},
    writableStream?: FileSystemWritableFileStream,
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const fullSettings: VideoExportSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      ...settings,
      audioSettings: {
        ...DEFAULT_VIDEO_SETTINGS.audioSettings,
        ...settings.audioSettings,
      },
    };

    if (fullSettings.codec === "prores") {
      console.warn(
        `[ExportEngine] ProRes encoding is not supported in browsers. Switching to H.264 high quality.`,
      );
      fullSettings.codec = "h264";
      fullSettings.format = "mp4";
      fullSettings.bitrate = 25000;
      fullSettings.quality = 95;
    }

    const pixelCount = fullSettings.width * fullSettings.height;
    const isMemoryIntensiveCodec =
      fullSettings.codec === "vp9" ||
      fullSettings.codec === "av1" ||
      fullSettings.codec === "h265";
    const maxSafePixels = isMemoryIntensiveCodec ? 1920 * 1080 : 3840 * 2160;

    if (pixelCount > maxSafePixels && isMemoryIntensiveCodec) {
      console.warn(
        `[ExportEngine] ${fullSettings.codec.toUpperCase()} at ${fullSettings.width}x${fullSettings.height} may cause browser instability. Reducing to 1080p for stability.`,
      );
      const aspectRatio = fullSettings.width / fullSettings.height;
      if (aspectRatio > 1) {
        fullSettings.width = 1920;
        fullSettings.height = Math.round(1920 / aspectRatio);
      } else {
        fullSettings.height = 1920;
        fullSettings.width = Math.round(1920 * aspectRatio);
      }
      fullSettings.width = Math.round(fullSettings.width / 2) * 2;
      fullSettings.height = Math.round(fullSettings.height / 2) * 2;
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const gpuEnabled = await this.initializeGPUForExport(
      fullSettings.width,
      fullSettings.height,
    );
    if (!gpuEnabled) {
      console.warn("[ExportEngine] GPU acceleration not available for export");
    }

    this.videoEngine?.resetExportState();

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    const totalFrames = Math.ceil(timelineDuration * fullSettings.frameRate);

    try {
      yield this.createProgress("preparing", 0, totalFrames, 0, 0);

      const workerResult = await this.runWorkerExport(
        project,
        fullSettings,
        totalFrames,
        writableStream,
      );

      for await (const progress of workerResult.progressGenerator) {
        if (this.abortController?.signal.aborted) {
          this.exportWorker?.postMessage({ type: "cancel" });
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }
        yield progress;
      }

      const result = await workerResult.resultPromise;
      return result;
    } catch (error) {
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
      this.terminateWorker();
      this.abortController = null;
      this.currentExport = null;
      this.videoEngine?.clearVideoElementCache();
    }
  }

  private async runWorkerExport(
    project: Project,
    settings: VideoExportSettings,
    totalFrames: number,
    writableStream?: FileSystemWritableFileStream,
  ): Promise<{
    progressGenerator: AsyncGenerator<ExportProgress>;
    resultPromise: Promise<ExportResult>;
  }> {
    let workerReadyResolve: (() => void) | null = null;
    let resultResolve: ((result: ExportResult) => void) | null = null;
    let resultReject: ((error: Error) => void) | null = null;

    const workerReadyPromise = new Promise<void>((resolve) => {
      workerReadyResolve = resolve;
    });

    const resultPromise = new Promise<ExportResult>((resolve, reject) => {
      resultResolve = resolve;
      resultReject = reject;
    });

    let framesInFlight = 0;
    const MAX_FRAMES_IN_FLIGHT = writableStream ? 1 : 3;
    let frameProcessedResolve: (() => void) | null = null;

    this.exportWorker = new Worker(
      new URL("./export-worker.ts", import.meta.url),
      { type: "module" },
    );

    this.exportWorker.onmessage = async (event) => {
      const { type, blob, error, chunk } = event.data;

      if (type === "ready") {
        workerReadyResolve?.();
        return;
      }

      if (type === "chunk" && writableStream && chunk) {
        try {
          await writableStream.write({
            type: "write",
            position: chunk.position,
            data: chunk.data,
          });
        } catch (e) {
          console.error("[ExportEngine] Failed to write chunk:", e);
        }
        return;
      }

      if (type === "frameProcessed") {
        framesInFlight = Math.max(0, framesInFlight - 1);
        if (frameProcessedResolve) {
          frameProcessedResolve();
          frameProcessedResolve = null;
        }
        return;
      }

      if (type === "complete") {
        if (writableStream) {
          try {
            await writableStream.close();
          } catch (e) {
            console.error("[ExportEngine] Failed to close stream:", e);
          }
        }
        const stats = this.calculateStats(totalFrames, blob?.size || 0);
        resultResolve?.({ success: true, blob, stats });
        return;
      }

      if (type === "error") {
        if (writableStream) {
          try {
            await writableStream.abort();
          } catch {}
        }
        resultReject?.(new Error(error || "Worker encoding failed"));
        return;
      }
    };

    this.exportWorker.onerror = (error) => {
      resultReject?.(new Error(error.message || "Worker error"));
    };

    this.exportWorker.postMessage({
      type: "init",
      settings,
      projectName: project.name,
      useStreamTarget: !!writableStream,
    });

    await workerReadyPromise;

    const self = this;

    async function waitForCapacity(): Promise<void> {
      if (framesInFlight < MAX_FRAMES_IN_FLIGHT) {
        return;
      }
      await new Promise<void>((resolve) => {
        frameProcessedResolve = resolve;
      });
    }

    async function* generateProgress(): AsyncGenerator<ExportProgress> {
      for (let frame = 0; frame < totalFrames; frame++) {
        if (self.abortController?.signal.aborted) {
          return;
        }

        await waitForCapacity();

        const time = frame / settings.frameRate;
        const rendered = await self.videoEngine!.renderFrame(
          project,
          time,
          settings.width,
          settings.height,
        );

        const shouldUpscale = self.shouldApplyUpscaling(project, settings);
        let frameImage = rendered.image;

        if (shouldUpscale && self.upscalingEngine?.isInitialized()) {
          const upscaled = await self.upscalingEngine.upscaleImageBitmap(
            frameImage,
            settings.width,
            settings.height,
            settings.upscaling!,
          );
          frameImage.close();
          frameImage = upscaled;
        }

        framesInFlight++;

        self.exportWorker?.postMessage(
          {
            type: "addFrame",
            frame: frameImage,
            frameIndex: frame,
            timestamp: time,
            totalFrames,
            settings,
          },
          [frameImage],
        );

        self.currentExport!.framesRendered = frame + 1;

        yield self.createProgress(
          "rendering",
          (frame + 1) / totalFrames,
          totalFrames,
          frame + 1,
          0,
        );

        const cleanupInterval = writableStream ? 10 : 30;
        if ((frame + 1) % cleanupInterval === 0) {
          self.videoEngine?.clearVideoElementCache();
          try {
            const mediaEngine = getMediaEngine();
            mediaEngine.clearFrameCache();
          } catch {
            // MediaEngine may not be initialized
          }
          if (writableStream) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      }

      while (framesInFlight > 0) {
        await new Promise<void>((resolve) => {
          if (framesInFlight === 0) {
            resolve();
          } else {
            frameProcessedResolve = resolve;
          }
        });
      }

      yield self.createProgress("encoding", 0.95, totalFrames, totalFrames, 0);

      const audioBuffer = await self.renderTimelineAudioPublic(project);
      if (audioBuffer) {
        const channels: Float32Array[] = [];
        for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
          channels.push(audioBuffer.getChannelData(i).slice());
        }
        self.exportWorker?.postMessage({
          type: "addAudio",
          audioBuffer: {
            channels,
            sampleRate: audioBuffer.sampleRate,
            length: audioBuffer.length,
          },
        });
      }

      yield self.createProgress("muxing", 0.98, totalFrames, totalFrames, 0);

      self.exportWorker?.postMessage({ type: "finalize" });
    }

    return {
      progressGenerator: generateProgress(),
      resultPromise,
    };
  }

  private async renderTimelineAudioPublic(
    project: Project,
  ): Promise<AudioBuffer | null> {
    return this.renderTimelineAudio(project);
  }

  private isSimpleProject(project: Project): { simple: boolean; singleClip?: { mediaId: string; startTime: number; endTime: number; speed: number } } {
    const { timeline } = project;

    const allTracks = timeline.tracks.filter(t => !t.hidden);
    const videoTracks = allTracks.filter(t => t.type === "video" || t.type === "image");
    const textTracks = allTracks.filter(t => t.type === "text");
    const graphicsTracks = allTracks.filter(t => t.type === "graphics");
    const audioTracks = allTracks.filter(t => t.type === "audio");

    if (textTracks.length > 0) {
      return { simple: false };
    }

    if (graphicsTracks.length > 0) {
      return { simple: false };
    }

    if (audioTracks.length > 0 && audioTracks.some(t => t.clips.length > 0)) {
      return { simple: false };
    }

    let totalVideoClips = 0;
    let singleClip: { mediaId: string; startTime: number; endTime: number; speed: number } | undefined;
    let clipWithEffects = false;

    for (const track of videoTracks) {
      for (const clip of track.clips) {
        totalVideoClips++;

        if (clip.effects && clip.effects.length > 0) {
          clipWithEffects = true;
        }

        if (clip.keyframes && clip.keyframes.length > 0) {
          clipWithEffects = true;
        }

        if (clip.transform) {
          const t = clip.transform;
          if (t.scale.x !== 1 || t.scale.y !== 1 || t.rotation !== 0 ||
              t.position.x !== 0 || t.position.y !== 0 || t.opacity !== 1) {
            clipWithEffects = true;
          }
        }

        if (totalVideoClips === 1 && !clipWithEffects) {
          const mediaItem = project.mediaLibrary.items.find(m => m.id === clip.mediaId);
          if (mediaItem?.type === "video") {
            singleClip = {
              mediaId: clip.mediaId,
              startTime: clip.inPoint,
              endTime: clip.outPoint,
              speed: clip.speed || 1,
            };
          }
        }
      }
    }

    if (clipWithEffects) {
      return { simple: false };
    }

    if (totalVideoClips === 1 && singleClip) {
      return { simple: true, singleClip };
    }

    return { simple: false };
  }

  async *exportVideoWithFFmpeg(
    project: Project,
    settings: Partial<VideoExportSettings> = {},
    writableStream?: FileSystemWritableFileStream,
  ): AsyncGenerator<ExportProgress, ExportResult> {

    if (!this.initialized) {
      await this.initialize();
    }

    const fullSettings: VideoExportSettings = {
      ...DEFAULT_VIDEO_SETTINGS,
      ...settings,
      audioSettings: {
        ...DEFAULT_VIDEO_SETTINGS.audioSettings,
        ...settings.audioSettings,
      },
    };

    if (fullSettings.codec === "prores") {
      fullSettings.codec = "h264";
      fullSettings.format = "mp4";
      fullSettings.bitrate = 25000;
      fullSettings.quality = 95;
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const { timeline } = project;
    const timelineDuration = this.calculateTimelineDuration(timeline);

    if (timelineDuration <= 0) {
      return {
        success: false,
        error: this.createError(
          "MUXER_ERROR",
          "Timeline is empty. Add clips before exporting.",
          "preparing",
        ),
      };
    }

    const totalFrames = Math.ceil(timelineDuration * fullSettings.frameRate);
    const simpleCheck = this.isSimpleProject(project);

    this.videoEngine?.resetExportState();

    yield this.createProgress("preparing", 0, totalFrames, 0, 0);

    const mediaEngine = getMediaEngine();

    if (!mediaEngine.isAvailable()) {
      await mediaEngine.initialize();
    }
    mediaEngine.clearFrameCache();
    mediaEngine.disposeAllExportDecoders();
    this.videoEngine?.clearVideoElementCache();

    try {
      const ffmpeg = getFFmpegFallback();
      await ffmpeg.load();

      if (simpleCheck.simple && simpleCheck.singleClip) {
        const mediaItem = project.mediaLibrary.items.find(m => m.id === simpleCheck.singleClip!.mediaId);
        if (mediaItem?.blob) {
          const inputWidth = mediaItem.metadata.width;
          const inputHeight = mediaItem.metadata.height;

          const clip = project.timeline.tracks
            .flatMap(t => t.clips)
            .find(c => c.mediaId === simpleCheck.singleClip!.mediaId);

          const hasClipEffects = clip && (
            (clip.effects && clip.effects.length > 0) ||
            (clip.transform && (
              clip.transform.scale.x !== 1 ||
              clip.transform.scale.y !== 1 ||
              clip.transform.rotation !== 0 ||
              clip.transform.position.x !== 0 ||
              clip.transform.position.y !== 0 ||
              clip.transform.opacity !== 1
            )) ||
            (clip.keyframes && clip.keyframes.length > 0)
          );

          const allTracks = project.timeline.tracks.filter(t => !t.hidden);
          const hasMultipleTracks = allTracks.length > 1;
          const hasAnyTextOrGraphics = allTracks.some(t =>
            (t.type === "text" || t.type === "graphics") && t.clips.length > 0
          );

          const canUseStreamCopy =
            simpleCheck.singleClip.speed === 1 &&
            inputWidth === fullSettings.width &&
            inputHeight === fullSettings.height &&
            simpleCheck.singleClip.startTime === 0 &&
            !hasClipEffects &&
            !hasMultipleTracks &&
            !hasAnyTextOrGraphics;


          let lastProgress: ExportProgress | null = null;
          const onProgress = (progress: ExportProgress) => {
            lastProgress = progress;
          };

          const resultPromise = ffmpeg.exportVideoDirectly(
            mediaItem.blob,
            {
              startTime: simpleCheck.singleClip.startTime,
              endTime: simpleCheck.singleClip.endTime,
              width: fullSettings.width,
              height: fullSettings.height,
              frameRate: fullSettings.frameRate,
              format: fullSettings.format === "webm" ? "webm" : "mp4",
              videoBitrate: `${fullSettings.bitrate}k`,
              audioBitrate: `${fullSettings.audioSettings.bitrate}k`,
              speed: simpleCheck.singleClip.speed,
              writableStream,
              useStreamCopy: canUseStreamCopy,
            },
            onProgress,
          );

          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 100));

            if (lastProgress !== null) {
              const progressToYield = lastProgress as ExportProgress;
              yield progressToYield;
              if (progressToYield.phase === "complete") {
                break;
              }
            }

            const isResolved = await Promise.race([
              resultPromise.then(() => true),
              new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
            ]);

            if (isResolved) {
              break;
            }
          }

          const blob = await resultPromise;

          return {
            success: true,
            blob: blob || undefined,
            stats: this.calculateStats(totalFrames, blob?.size || 0),
          };
        }
      }

      await this.initializeGPUForExport(
        fullSettings.width,
        fullSettings.height,
      );

      const usedMediaIds = new Set<string>();
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.mediaId) {
            usedMediaIds.add(clip.mediaId);
          }
        }
      }

      for (const mediaId of usedMediaIds) {
        const mediaItem = project.mediaLibrary.items.find(m => m.id === mediaId);
        if (mediaItem?.blob && mediaItem.type === "video") {
          await mediaEngine.createExportDecoder(mediaId, mediaItem.blob, fullSettings.width);
        }
      }

      const self = this;

      async function* generateFrames(): AsyncIterable<{ image: ImageBitmap; frameIndex: number }> {
        for (let frame = 0; frame < totalFrames; frame++) {
          if (self.abortController?.signal.aborted) {
            return;
          }

          const time = frame / fullSettings.frameRate;
          const rendered = await self.videoEngine!.renderFrame(
            project,
            time,
            fullSettings.width,
            fullSettings.height,
          );

          const shouldUpscale = self.shouldApplyUpscaling(project, fullSettings);
          let frameImage = rendered.image;

          if (shouldUpscale && self.upscalingEngine?.isInitialized()) {
            const upscaled = await self.upscalingEngine.upscaleImageBitmap(
              frameImage,
              fullSettings.width,
              fullSettings.height,
              fullSettings.upscaling!,
            );
            frameImage.close();
            frameImage = upscaled;
          }

          self.currentExport!.framesRendered = frame + 1;

          if ((frame + 1) % 60 === 0) {
            self.videoEngine?.clearVideoElementCache();
            mediaEngine.clearFrameCache();
          }

          yield { image: frameImage, frameIndex: frame };
        }
      }

      let lastProgress: ExportProgress | null = null;
      const onProgress = (progress: ExportProgress) => {
        lastProgress = progress;
      };

      const audioBuffer = await this.renderTimelineAudio(project, fullSettings);

      const resultPromise = ffmpeg.encodeFrameSequence(
        generateFrames(),
        {
          width: fullSettings.width,
          height: fullSettings.height,
          frameRate: fullSettings.frameRate,
          totalFrames,
          format: fullSettings.format === "webm" ? "webm" : "mp4",
          videoBitrate: `${fullSettings.bitrate}k`,
          audioBitrate: `${fullSettings.audioSettings.bitrate}k`,
          audioBuffer: audioBuffer || undefined,
          writableStream,
        },
        onProgress,
      );

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (lastProgress !== null) {
          const progressToYield = lastProgress as ExportProgress;
          yield progressToYield;
          if (progressToYield.phase === "complete") {
            break;
          }
        }

        const isResolved = await Promise.race([
          resultPromise.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
        ]);

        if (isResolved) {
          break;
        }
      }

      const blob = await resultPromise;

      return {
        success: true,
        blob: blob || undefined,
        stats: this.calculateStats(totalFrames, blob?.size || 0),
      };
    } catch (error) {
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
      this.abortController = null;
      this.currentExport = null;
      this.videoEngine?.clearVideoElementCache();
      mediaEngine.disposeAllExportDecoders();
      mediaEngine.clearFrameCache();
    }
  }

  private terminateWorker(): void {
    if (this.exportWorker) {
      this.exportWorker.terminate();
      this.exportWorker = null;
    }
  }

  async *exportAudio(
    project: Project,
    settings: Partial<AudioExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const fullSettings: AudioExportSettings = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...settings,
    };

    if (!this.mediabunny && fullSettings.format !== "wav") {
      return {
        success: false,
        error: this.createError(
          "UNSUPPORTED_CODEC",
          `Audio export to ${fullSettings.format} format requires MediaBunny. WAV format is available as a fallback.`,
          "preparing",
        ),
      };
    }

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

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

    try {
      yield this.createProgress("preparing", 0, 1, 0, 0);
      const audioBuffer = await this.renderTimelineAudio(project, {
        audioSettings: fullSettings,
      } as VideoExportSettings);

      if (!audioBuffer) {
        throw this.createError(
          "AUDIO_ENCODE_FAILED",
          "No audio to export",
          "rendering",
        );
      }

      yield this.createProgress("encoding", 0.5, 1, 0, 0);

      // Encode based on format
      let blob: Blob;

      if (fullSettings.format === "wav") {
        blob = this.encodeWav(audioBuffer, fullSettings);
      } else {
        // Use MediaBunny for other formats
        blob = await this.encodeAudioWithMediaBunny(audioBuffer, fullSettings);
      }

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

  async *exportImageSequence(
    project: Project,
    settings: Partial<SequenceExportSettings> = {},
  ): AsyncGenerator<ExportProgress, ExportResult> {
    this.ensureInitialized();

    const { timeline } = project;
    const frameRate = project.settings.frameRate;
    const totalFrames = Math.ceil(timeline.duration * frameRate);

    const fullSettings: SequenceExportSettings = {
      ...DEFAULT_IMAGE_SETTINGS,
      width: project.settings.width,
      height: project.settings.height,
      startFrame: 0,
      endFrame: totalFrames - 1,
      namingPattern: "frame_{0000}",
      ...settings,
    };

    this.abortController = new AbortController();
    this.currentExport = { startTime: Date.now(), framesRendered: 0 };

    const framesToExport = fullSettings.endFrame - fullSettings.startFrame + 1;
    const blobs: Blob[] = [];

    try {
      yield this.createProgress("preparing", 0, framesToExport, 0, 0);

      for (let i = 0; i < framesToExport; i++) {
        if (this.abortController.signal.aborted) {
          throw this.createError(
            "CANCELLED",
            "Export cancelled by user",
            "rendering",
          );
        }

        const frameNumber = fullSettings.startFrame + i;
        const time = frameNumber / frameRate;

        const result = await this.exportFrame(project, time, fullSettings);
        if (result.success && result.blob) {
          blobs.push(result.blob);
        }

        this.currentExport!.framesRendered = i + 1;

        yield this.createProgress(
          "rendering",
          (i + 1) / framesToExport,
          framesToExport,
          i + 1,
          blobs.reduce((sum, b) => sum + b.size, 0),
        );
      }

      yield this.createProgress(
        "complete",
        1,
        framesToExport,
        framesToExport,
        0,
      );

      const totalSize = blobs.reduce((sum, b) => sum + b.size, 0);

      return {
        success: true,
        blob: blobs[0],
        stats: this.calculateStats(framesToExport, totalSize),
      };
    } catch (error) {
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
    const duration = project.timeline.duration;

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
    const duration = project.timeline.duration;

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
    _settings?: VideoExportSettings,
  ): Promise<AudioBuffer | null> {
    const { timeline } = project;

    const hasAudio = timeline.tracks.some(
      (track) =>
        (track.type === "audio" || track.type === "video") &&
        !track.muted &&
        track.clips.length > 0,
    );

    if (!hasAudio) {
      return null;
    }

    const timelineDuration = this.calculateTimelineDuration(timeline);
    if (timelineDuration <= 0) {
      return null;
    }

    const rendered = await this.audioEngine!.renderAudio(
      project,
      0,
      timelineDuration,
    );

    return rendered.buffer;
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

  private encodeWav(buffer: AudioBuffer, settings: AudioExportSettings): Blob {
    const numberOfChannels = Math.min(
      buffer.numberOfChannels,
      settings.channels,
    );
    const sampleRate = settings.sampleRate;
    const bitDepth = settings.bitDepth;

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

  private getMimeType(format: VideoExportSettings["format"]): string {
    switch (format) {
      case "webm":
        return "video/webm";
      case "mov":
        return "video/quicktime";
      case "mp4":
      default:
        return "video/mp4";
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
    const textClips = titleEngine.getAllTextClips();
    for (const textClip of textClips) {
      const endTime = textClip.startTime + textClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const shapeClips = graphicsEngine.getAllShapeClips();
    for (const shapeClip of shapeClips) {
      const endTime = shapeClip.startTime + shapeClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const svgClips = graphicsEngine.getAllSVGClips();
    for (const svgClip of svgClips) {
      const endTime = svgClip.startTime + svgClip.duration;
      if (endTime > maxEndTime) {
        maxEndTime = endTime;
      }
    }
    const stickerClips = graphicsEngine.getAllStickerClips();
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
let exportEngineInstance: ExportEngine | null = null;

export function getExportEngine(): ExportEngine {
  if (!exportEngineInstance) {
    exportEngineInstance = new ExportEngine();
  }
  return exportEngineInstance;
}

export async function initializeExportEngine(): Promise<ExportEngine> {
  const engine = getExportEngine();
  await engine.initialize();
  return engine;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
