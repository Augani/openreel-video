import type {
  MediaTrackInfo,
  ThumbnailResult,
  WaveformData,
  ExportSettings,
  ExportProgress,
  VideoFrameResult,
  FrameCacheEntry,
} from "./types";

import type {
  InputVideoTrack,
  InputAudioTrack,
  ConversionOptions,
} from "mediabunny";

export const SUPPORTED_VIDEO_FORMATS = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
];

export const SUPPORTED_AUDIO_FORMATS = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/webm",
];

export const SUPPORTED_IMAGE_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export function isSupportedFormat(mimeType: string): boolean {
  const baseMimeType = mimeType.split(";")[0].trim();
  return (
    SUPPORTED_VIDEO_FORMATS.includes(baseMimeType) ||
    SUPPORTED_AUDIO_FORMATS.includes(baseMimeType) ||
    SUPPORTED_IMAGE_FORMATS.includes(baseMimeType)
  );
}

export function inferMediaType(
  mimeType: string,
): "video" | "audio" | "image" | null {
  const baseMimeType = mimeType.split(";")[0].trim();
  if (SUPPORTED_VIDEO_FORMATS.includes(baseMimeType)) return "video";
  if (SUPPORTED_AUDIO_FORMATS.includes(baseMimeType)) return "audio";
  if (SUPPORTED_IMAGE_FORMATS.includes(baseMimeType)) return "image";
  return null;
}
type MediaBunnyInput = {
  computeDuration(): Promise<number>;
  getMimeType(): Promise<string>;
  getPrimaryVideoTrack(): Promise<InputVideoTrack | null>;
  getPrimaryAudioTrack(): Promise<InputAudioTrack | null>;
  getFormat(): Promise<unknown>;
  [Symbol.dispose]?: () => void;
};

export class ExportFrameDecoder {
  private input: MediaBunnyInput | null = null;
  private sink: InstanceType<typeof import("mediabunny").CanvasSink> | null = null;
  private mediabunny: typeof import("mediabunny");
  private file: File | Blob;
  private width?: number;
  private initialized = false;
  private reusableCanvas: OffscreenCanvas | null = null;
  private reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(mediabunny: typeof import("mediabunny"), file: File | Blob, width?: number) {
    this.mediabunny = mediabunny;
    this.file = file;
    this.width = width;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    const { Input, ALL_FORMATS, BlobSource, CanvasSink } = this.mediabunny;

    this.input = new Input({
      source: new BlobSource(this.file),
      formats: ALL_FORMATS,
    }) as unknown as MediaBunnyInput;

    const videoTrack = await this.input.getPrimaryVideoTrack();
    if (!videoTrack) {
      this.dispose();
      return false;
    }

    const canDecode = await videoTrack.canDecode();
    if (!canDecode) {
      this.dispose();
      return false;
    }

    const sinkOptions: Record<string, unknown> = { poolSize: 2 };
    if (this.width) {
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      sinkOptions.width = this.width;
      sinkOptions.height = Math.round(this.width * aspectRatio);
      sinkOptions.fit = "contain";
    }

    this.sink = new CanvasSink(videoTrack, sinkOptions);
    this.initialized = true;
    return true;
  }

  async getFrame(timestamp: number): Promise<OffscreenCanvas | null> {
    if (!this.sink) return null;

    const result = await this.sink.getCanvas(timestamp);
    if (!result) return null;

    const w = result.canvas.width;
    const h = result.canvas.height;

    if (!this.reusableCanvas || this.reusableCanvas.width !== w || this.reusableCanvas.height !== h) {
      this.reusableCanvas = new OffscreenCanvas(w, h);
      this.reusableCtx = this.reusableCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    }

    this.reusableCtx!.clearRect(0, 0, w, h);
    this.reusableCtx!.drawImage(result.canvas, 0, 0);
    return this.reusableCanvas;
  }

  dispose(): void {
    if (this.input) {
      this.input[Symbol.dispose]?.();
      this.input = null;
    }
    this.sink = null;
    this.reusableCanvas = null;
    this.reusableCtx = null;
    this.initialized = false;
  }
}

export class MediaBunnyEngine {
  private initialized = false;
  private mediabunny: typeof import("mediabunny") | null = null;
  private frameCache: Map<string, FrameCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 5;
  private exportDecoders: Map<string, ExportFrameDecoder> = new Map();

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to support lazy loading
      this.mediabunny = await import("mediabunny");
      this.initialized = true;
    } catch (error) {
      console.warn("MediaBunny not available, will use fallback");
      throw new Error("MediaBunny initialization failed");
    }
  }

  isAvailable(): boolean {
    return this.initialized && this.mediabunny !== null;
  }

  clearFrameCache(): void {
    for (const entry of this.frameCache.values()) {
      if (entry.image instanceof OffscreenCanvas) {
        entry.image.width = 0;
        entry.image.height = 0;
      }
    }
    this.frameCache.clear();
  }

  getFrameCacheSize(): number {
    return this.frameCache.size;
  }

  async createExportDecoder(mediaId: string, file: File | Blob, width?: number): Promise<ExportFrameDecoder | null> {
    this.ensureInitialized();

    const existing = this.exportDecoders.get(mediaId);
    if (existing) {
      return existing;
    }

    const decoder = new ExportFrameDecoder(this.mediabunny!, file, width);
    const success = await decoder.initialize();
    if (!success) {
      return null;
    }

    this.exportDecoders.set(mediaId, decoder);
    return decoder;
  }

  getExportDecoder(mediaId: string): ExportFrameDecoder | null {
    return this.exportDecoders.get(mediaId) || null;
  }

  disposeExportDecoder(mediaId: string): void {
    const decoder = this.exportDecoders.get(mediaId);
    if (decoder) {
      decoder.dispose();
      this.exportDecoders.delete(mediaId);
    }
  }

  disposeAllExportDecoders(): void {
    for (const decoder of this.exportDecoders.values()) {
      decoder.dispose();
    }
    this.exportDecoders.clear();
  }

  private ensureInitialized(): void {
    if (!this.mediabunny) {
      throw new Error("MediaBunny not initialized. Call initialize() first.");
    }
  }

  async createInput(file: File | Blob): Promise<MediaBunnyInput> {
    this.ensureInitialized();
    const { Input, ALL_FORMATS, BlobSource } = this.mediabunny!;

    return new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
  }

  async validateFormat(file: File | Blob): Promise<{
    supported: boolean;
    format: string | null;
    error?: string;
  }> {
    const mimeType = file.type;
    if (!isSupportedFormat(mimeType)) {
      return {
        supported: false,
        format: null,
        error: `Unsupported format: ${
          mimeType || "unknown"
        }. Supported formats: MP4, WebM, MOV, MP3, WAV, AAC, JPG, PNG, WebP`,
      };
    }

    // Images don't need MediaBunny validation - they're already supported
    if (mimeType.startsWith("image/")) {
      return {
        supported: true,
        format: mimeType,
      };
    }

    try {
      const input = await this.createInput(file);
      const format = await input.getFormat();

      input[Symbol.dispose]?.();

      if (!format) {
        return {
          supported: false,
          format: null,
          error: "Could not determine file format. The file may be corrupted.",
        };
      }

      return {
        supported: true,
        format: mimeType,
      };
    } catch (error) {
      return {
        supported: false,
        format: null,
        error: `Failed to parse file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private async extractImageMetadata(
    file: File | Blob,
    mimeType: string,
  ): Promise<MediaTrackInfo> {
    // Load image to get dimensions
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = objectUrl;
      });

      return {
        duration: 0, // Images have no duration
        width: img.naturalWidth,
        height: img.naturalHeight,
        frameRate: 0,
        codec: "",
        sampleRate: 0,
        channels: 0,
        fileSize: file.size,
        mimeType,
        hasVideo: false,
        hasAudio: false,
        rotation: 0,
        canDecode: true,
        videoBitrate: 0,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async extractMetadata(file: File | Blob): Promise<MediaTrackInfo> {
    // Special handling for images - MediaBunny doesn't process static images well
    const fileType = file instanceof File ? file.type : "";
    if (fileType.startsWith("image/")) {
      return await this.extractImageMetadata(file, fileType);
    }

    const input = await this.createInput(file);

    try {
      const duration = await input.computeDuration();
      const mimeType = await input.getMimeType();

      const videoTrack = await input.getPrimaryVideoTrack();
      const audioTrack = await input.getPrimaryAudioTrack();

      let width = 0;
      let height = 0;
      let frameRate = 0;
      let videoCodec = "";
      let rotation = 0;
      let canDecodeVideo = false;
      let videoBitrate = 0;

      if (videoTrack) {
        width = videoTrack.displayWidth;
        height = videoTrack.displayHeight;
        rotation = videoTrack.rotation || 0;
        videoCodec = videoTrack.codec || "";
        canDecodeVideo = await videoTrack.canDecode();

        // Compute frame rate and bitrate from packet stats
        try {
          const stats = await videoTrack.computePacketStats(100);
          frameRate = stats.averagePacketRate || 30;
          videoBitrate = stats.averageBitrate || 0;
        } catch {
          frameRate = 30; // Default
        }
      }

      let sampleRate = 0;
      let channels = 0;
      let audioCodec = "";
      let canDecodeAudio = false;

      if (audioTrack) {
        sampleRate = audioTrack.sampleRate;
        channels = audioTrack.numberOfChannels;
        audioCodec = audioTrack.codec || "";
        canDecodeAudio = await audioTrack.canDecode();
      }

      return {
        duration,
        width,
        height,
        frameRate,
        codec: videoCodec || audioCodec,
        sampleRate,
        channels,
        fileSize: file.size,
        mimeType,
        hasVideo: !!videoTrack,
        hasAudio: !!audioTrack,
        rotation,
        canDecode: canDecodeVideo || canDecodeAudio,
        videoBitrate,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async generateThumbnails(
    file: File | Blob,
    count: number = 5,
    width: number = 320,
  ): Promise<ThumbnailResult[]> {
    this.ensureInitialized();
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return [];
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      const height = Math.round(width * aspectRatio);

      const sink = new CanvasSink(videoTrack, {
        width,
        height,
        fit: "contain" as const,
        poolSize: Math.min(count, 10), // Limit pool size for memory efficiency
      });

      const startTimestamp = await videoTrack.getFirstTimestamp();
      const endTimestamp = await videoTrack.computeDuration();
      const duration = endTimestamp - startTimestamp;
      const timestamps =
        count === 1
          ? [startTimestamp]
          : Array.from(
              { length: count },
              (_, i) => startTimestamp + (i / (count - 1)) * duration,
            );

      const thumbnails: ThumbnailResult[] = [];

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (result) {
          // Clone the canvas since the pool reuses them
          const clone = new OffscreenCanvas(
            result.canvas.width,
            result.canvas.height,
          );
          const ctx = clone.getContext("2d");
          if (ctx) {
            ctx.drawImage(result.canvas, 0, 0);
          }
          let dataUrl: string | undefined;
          try {
            const blob = await clone.convertToBlob({
              type: "image/jpeg",
              quality: 0.7,
            });
            dataUrl = URL.createObjectURL(blob);
          } catch {}

          thumbnails.push({
            timestamp: result.timestamp,
            canvas: clone,
            dataUrl,
          });
        }
      }

      return thumbnails;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async generateFilmstripThumbnails(
    file: File | Blob,
    duration: number,
    thumbnailWidth: number = 80,
    interval: number = 1,
  ): Promise<ThumbnailResult[]> {
    this.ensureInitialized();
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return [];
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }
      const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
      const height = Math.round(thumbnailWidth * aspectRatio);
      const count = Math.max(1, Math.ceil(duration / interval));

      const sink = new CanvasSink(videoTrack, {
        width: thumbnailWidth,
        height,
        fit: "cover" as const,
        poolSize: Math.min(count, 20),
      });

      const startTimestamp = await videoTrack.getFirstTimestamp();
      const timestamps = Array.from(
        { length: count },
        (_, i) => startTimestamp + i * interval,
      );

      const thumbnails: ThumbnailResult[] = [];

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (result) {
          // Clone the canvas
          const clone = new OffscreenCanvas(
            result.canvas.width,
            result.canvas.height,
          );
          const ctx = clone.getContext("2d");
          if (ctx) {
            ctx.drawImage(result.canvas, 0, 0);
          }
          let dataUrl: string | undefined;
          try {
            const blob = await clone.convertToBlob({
              type: "image/jpeg",
              quality: 0.6,
            });
            dataUrl = URL.createObjectURL(blob);
          } catch {}

          thumbnails.push({
            timestamp: result.timestamp,
            canvas: clone,
            dataUrl,
          });
        }
      }

      return thumbnails;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async getFrameAtTime(
    file: File | Blob,
    timestamp: number,
    width?: number,
  ): Promise<VideoFrameResult | null> {
    this.ensureInitialized();
    const { CanvasSink } = this.mediabunny!;
    const fileName = "name" in file ? file.name : "blob";
    const cacheKey = `${fileName}-${file.size}-${timestamp}-${width || "auto"}`;
    const cached = this.frameCache.get(cacheKey);
    if (cached) {
      cached.lastAccessed = Date.now();
      return {
        timestamp: cached.timestamp,
        duration: 0, // Cached frames might not have duration stored, or we can add it to cache
        canvas: cached.image,
        width: cached.width,
        height: cached.height,
      };
    }

    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        return null;
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }

      const sinkOptions: Record<string, unknown> = { poolSize: 1 };
      if (width) {
        const aspectRatio = videoTrack.displayHeight / videoTrack.displayWidth;
        sinkOptions.width = width;
        sinkOptions.height = Math.round(width * aspectRatio);
        sinkOptions.fit = "contain";
      }

      const sink = new CanvasSink(videoTrack, sinkOptions);
      const result = await sink.getCanvas(timestamp);

      if (!result) {
        return null;
      }

      // Clone the canvas
      const clone = new OffscreenCanvas(
        result.canvas.width,
        result.canvas.height,
      );
      const ctx = clone.getContext("2d");
      if (ctx) {
        ctx.drawImage(result.canvas, 0, 0);
      }

      // Cache the result
      if (this.frameCache.size >= this.MAX_CACHE_SIZE) {
        let oldestKey = "";
        let oldestTime = Infinity;
        for (const [key, entry] of this.frameCache.entries()) {
          if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          this.frameCache.delete(oldestKey);
        }
      }

      this.frameCache.set(cacheKey, {
        timestamp: result.timestamp,
        image: clone,
        width: clone.width,
        height: clone.height,
        lastAccessed: Date.now(),
      });

      return {
        timestamp: result.timestamp,
        duration: result.duration,
        canvas: clone,
        width: clone.width,
        height: clone.height,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async generateWaveform(
    file: File | Blob,
    samplesPerSecond: number = 100,
  ): Promise<WaveformData> {
    this.ensureInitialized();
    const { AudioSampleSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const audioTrack = await input.getPrimaryAudioTrack();
      if (!audioTrack) {
        throw new Error("No audio track found");
      }

      const canDecode = await audioTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode audio track");
      }

      const sink = new AudioSampleSink(audioTrack);
      const duration = await audioTrack.computeDuration();
      const totalSamples = Math.ceil(duration * samplesPerSecond);

      const peaks: number[] = [];
      const rms: number[] = [];
      const timestamps = Array.from(
        { length: totalSamples },
        (_, i) => i / samplesPerSecond,
      );

      for await (const sample of sink.samplesAtTimestamps(timestamps)) {
        if (!sample) {
          peaks.push(0);
          rms.push(0);
          continue;
        }
        const bytesNeeded = sample.allocationSize({
          format: "f32",
          planeIndex: 0,
        });
        const floats = new Float32Array(bytesNeeded / 4);
        sample.copyTo(floats, { format: "f32", planeIndex: 0 });
        let peak = 0;
        let sumSquares = 0;
        for (let i = 0; i < floats.length; i++) {
          const abs = Math.abs(floats[i]);
          peak = Math.max(peak, abs);
          sumSquares += floats[i] * floats[i];
        }

        peaks.push(peak);
        rms.push(Math.sqrt(sumSquares / floats.length));

        sample.close();
      }

      return {
        peaks: new Float32Array(peaks),
        rms: new Float32Array(rms),
        sampleRate: samplesPerSecond,
        duration,
        samplesPerSecond,
      };
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async convertMedia(
    file: File | Blob,
    settings: ExportSettings,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    this.ensureInitialized();
    const {
      Input,
      Output,
      Conversion,
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
      WebMOutputFormat,
      MovOutputFormat,
      Mp3OutputFormat,
      QUALITY_HIGH,
      QUALITY_MEDIUM,
    } = this.mediabunny!;

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
    let outputFormat;
    switch (settings.format) {
      case "webm":
        outputFormat = new WebMOutputFormat();
        break;
      case "mov":
        outputFormat = new MovOutputFormat();
        break;
      case "mp3":
        outputFormat = new Mp3OutputFormat();
        break;
      case "mp4":
      default:
        outputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
        break;
    }

    const output = new Output({
      format: outputFormat,
      target: new BufferTarget(),
    });
    const conversionOptions: Record<string, unknown> = {
      input,
      output,
    };

    // Video options
    if (settings.width || settings.height || settings.videoBitrate) {
      conversionOptions.video = {
        ...(settings.width && { width: settings.width }),
        ...(settings.height && { height: settings.height }),
        ...(settings.width && settings.height && { fit: "contain" }),
        ...(settings.frameRate && { frameRate: settings.frameRate }),
        bitrate: settings.videoBitrate || QUALITY_HIGH,
      };
    }

    // Audio options
    if (settings.audioBitrate || settings.sampleRate || settings.channels) {
      conversionOptions.audio = {
        ...(settings.audioBitrate && { bitrate: settings.audioBitrate }),
        ...(settings.sampleRate && { sampleRate: settings.sampleRate }),
        ...(settings.channels && { numberOfChannels: settings.channels }),
      };
    }

    // Discard audio for video-only export
    if (
      settings.format === "mp4" ||
      settings.format === "webm" ||
      settings.format === "mov"
    ) {
      if (!conversionOptions.audio) {
        conversionOptions.audio = { bitrate: QUALITY_MEDIUM };
      }
    }

    const conversion = await Conversion.init(
      conversionOptions as ConversionOptions,
    );

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((t: { reason: string }) => t.reason)
        .join(", ");
      throw new Error(`Conversion invalid: ${reasons}`);
    }

    // Warn about discarded tracks that were not explicitly discarded
    if (conversion.discardedTracks.length > 0) {
      console.warn(
        "Some tracks were discarded during conversion:",
        conversion.discardedTracks,
      );
    }
    if (onProgress) {
      let lastProgress = 0;
      conversion.onProgress = (progress: number) => {
        if (progress > lastProgress) {
          lastProgress = progress;
          onProgress({
            phase: progress < 1 ? "encoding" : "complete",
            progress,
            currentFrame: 0,
            totalFrames: 0,
            estimatedTimeRemaining: 0,
          });
        }
      };
    }
    if (signal) {
      signal.addEventListener("abort", () => {
        conversion.cancel();
      });
    }

    try {
      await conversion.execute();
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      throw error;
    }
    const buffer = output.target.buffer;
    if (!buffer) {
      throw new Error("Output buffer is empty");
    }
    const mimeType = this.getMimeTypeForFormat(settings.format);

    return new Blob([buffer], { type: mimeType });
  }

  async extractAudio(
    file: File | Blob,
    format: "mp3" | "wav" | "aac" = "mp3",
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    return this.convertMedia(
      file,
      {
        format: format as ExportSettings["format"],
        audioBitrate: 128000,
        sampleRate: 48000,
        channels: 2,
      },
      onProgress,
      signal,
    );
  }

  async trimMedia(
    file: File | Blob,
    startTime: number,
    endTime: number,
    settings?: Partial<ExportSettings>,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    this.ensureInitialized();
    const {
      Input,
      Output,
      Conversion,
      ALL_FORMATS,
      BlobSource,
      BufferTarget,
      Mp4OutputFormat,
    } = this.mediabunny!;

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new BufferTarget(),
    });

    const conversion = await Conversion.init({
      input,
      output,
      trim: {
        start: startTime,
        end: endTime,
      },
      ...(settings?.videoBitrate && {
        video: { bitrate: settings.videoBitrate },
      }),
      ...(settings?.audioBitrate && {
        audio: { bitrate: settings.audioBitrate },
      }),
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((t: { reason: string }) => t.reason)
        .join(", ");
      throw new Error(`Trim conversion invalid: ${reasons}`);
    }

    if (onProgress) {
      conversion.onProgress = (progress: number) => {
        onProgress({
          phase: progress < 1 ? "encoding" : "complete",
          progress,
          currentFrame: 0,
          totalFrames: 0,
          estimatedTimeRemaining: 0,
        });
      };
    }
    if (signal) {
      signal.addEventListener("abort", () => {
        conversion.cancel();
      });
    }

    try {
      await conversion.execute();
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      throw error;
    }

    if (!output.target.buffer) {
      throw new Error("Output buffer is empty");
    }
    return new Blob([output.target.buffer], { type: "video/mp4" });
  }

  private getMimeTypeForFormat(format: ExportSettings["format"]): string {
    switch (format) {
      case "mp4":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "mov":
        return "video/quicktime";
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "aac":
        return "audio/aac";
      default:
        return "video/mp4";
    }
  }

  async checkCodecSupport(): Promise<{
    video: string[];
    audio: string[];
  }> {
    this.ensureInitialized();
    const { getEncodableVideoCodecs, getEncodableAudioCodecs } =
      this.mediabunny!;

    const [videoCodecs, audioCodecs] = await Promise.all([
      getEncodableVideoCodecs(),
      getEncodableAudioCodecs(),
    ]);

    return {
      video: videoCodecs,
      audio: audioCodecs,
    };
  }

  async getBestVideoCodec(
    width: number,
    height: number,
  ): Promise<string | null> {
    this.ensureInitialized();
    const { getFirstEncodableVideoCodec, Mp4OutputFormat } = this.mediabunny!;

    const format = new Mp4OutputFormat();
    const supportedCodecs = format.getSupportedVideoCodecs();

    try {
      const codec = await getFirstEncodableVideoCodec(supportedCodecs, {
        width,
        height,
      });
      return codec || null;
    } catch {
      return null;
    }
  }

  async exportFrame(
    file: File | Blob,
    timestamp: number,
    format: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    quality: number = 0.8,
  ): Promise<Blob> {
    const frame = await this.getFrameAtTime(file, timestamp);
    if (!frame) {
      throw new Error("Could not extract frame");
    }

    const { canvas } = frame;
    let blob: Blob | null = null;

    if (canvas instanceof OffscreenCanvas) {
      blob = await canvas.convertToBlob({ type: format, quality });
    } else if (canvas instanceof HTMLCanvasElement) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, format, quality),
      );
    } else if (canvas instanceof ImageBitmap) {
      const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = offscreen.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, 0, 0);
        blob = await offscreen.convertToBlob({ type: format, quality });
      }
    }

    if (!blob) {
      throw new Error("Failed to create image blob");
    }

    return blob;
  }

  async generateProxy(
    file: File | Blob,
    onProgress?: (progress: ExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    // Proxy settings: 540p, lower bitrate, faster encoding
    const proxySettings: ExportSettings = {
      format: "mp4",
      height: 540,
      videoBitrate: 1_000_000, // 1 Mbps
      audioBitrate: 96_000, // 96 kbps
    };

    return this.convertMedia(file, proxySettings, onProgress, signal);
  }

  async exportImageSequence(
    file: File | Blob,
    startTime: number,
    endTime: number,
    frameRate: number,
    format: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
    quality: number = 0.8,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob[]> {
    this.ensureInitialized();
    const { CanvasSink } = this.mediabunny!;
    const input = await this.createInput(file);

    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) {
        throw new Error("No video track found");
      }

      const canDecode = await videoTrack.canDecode();
      if (!canDecode) {
        throw new Error("Cannot decode video track");
      }

      const duration = endTime - startTime;
      const frameCount = Math.ceil(duration * frameRate);
      const timestamps = Array.from(
        { length: frameCount },
        (_, i) => startTime + i / frameRate,
      );

      const sink = new CanvasSink(videoTrack, {
        fit: "contain",
        poolSize: 5,
      });

      const blobs: Blob[] = [];
      let processed = 0;

      for await (const result of sink.canvasesAtTimestamps(timestamps)) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        if (result) {
          const { canvas } = result;
          let blob: Blob | null = null;
          if (canvas instanceof OffscreenCanvas) {
            blob = await canvas.convertToBlob({ type: format, quality });
          }

          if (blob) {
            blobs.push(blob);
          }
        }

        processed++;
        onProgress?.(processed / frameCount);
      }

      return blobs;
    } finally {
      input[Symbol.dispose]?.();
    }
  }

  async getBestAudioCodec(): Promise<string | null> {
    this.ensureInitialized();
    const { getFirstEncodableAudioCodec, Mp4OutputFormat } = this.mediabunny!;

    const format = new Mp4OutputFormat();
    const supportedCodecs = format.getSupportedAudioCodecs();

    try {
      const codec = await getFirstEncodableAudioCodec(supportedCodecs);
      return codec || null;
    } catch {
      return null;
    }
  }
}
let engineInstance: MediaBunnyEngine | null = null;

export function getMediaEngine(): MediaBunnyEngine {
  if (!engineInstance) {
    engineInstance = new MediaBunnyEngine();
  }
  return engineInstance;
}

export async function initializeMediaEngine(): Promise<MediaBunnyEngine> {
  const engine = getMediaEngine();
  await engine.initialize();
  return engine;
}
