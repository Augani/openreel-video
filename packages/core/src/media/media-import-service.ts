import { v4 as uuidv4 } from "uuid";
import { claimNativeSource, isNativeContainerFile } from "./native-frame-source";
import { classifyProMedia, proMediaProxyNotice, proMediaWebMessage } from "./pro-media";

/** Import warning for a video the browser cannot decode (ProRes, DNxHD...); the UI shows it as a toast. */
export const CODEC_UNSUPPORTED_WARNING =
  "This browser cannot decode this video's codec (for example ProRes or DNxHD), so it can only play through a proxy. The OpenReel desktop app plays it directly.";
import type { MediaItem, MediaMetadata } from "../types/project";
import type {
  ProcessedMedia,
  MediaImportResult,
  ThumbnailResult,
  WaveformData,
} from "./types";
import {
  MediaBunnyEngine,
  getMediaEngine,
  isSupportedFormat,
  inferMediaType,
} from "./mediabunny-engine";
import {
  FFmpegFallback,
  getFFmpegFallback,
  PROXY_PRESETS,
  PROXY_THRESHOLDS,
  type ProxySettings,
  type TranscodeOptions,
} from "./ffmpeg-fallback";
import {
  nativeMediaAvailable,
  proxyViaNative,
  transcodeViaNative,
  probeAudioStreamCountViaNative,
} from "./native-media-bridge";

function parseBitrateKbps(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM]?)/.exec(value.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return Math.round(unit === "m" ? n * 1000 : n);
}

function presetFromSettings(settings?: Partial<ProxySettings>): "low" | "medium" | "high" {
  if (settings?.maxHeight) {
    if (settings.maxHeight <= 540) return "low";
    if (settings.maxHeight <= 720) return "medium";
    return "high";
  }
  const scale = (settings as { scale?: number } | undefined)?.scale;
  if (typeof scale === "number") {
    if (scale >= 0.7) return "high";
    if (scale >= 0.45) return "medium";
    return "low";
  }
  return "medium";
}

interface MediaImportOptions {
  onProgress?: (stage: string) => void;
  generateThumbnails?: boolean;
  thumbnailCount?: number;
  thumbnailWidth?: number;
  generateWaveform?: boolean;
  waveformSamplesPerSecond?: number;
  useFallback?: boolean;
  quickMode?: boolean;
}

const DEFAULT_OPTIONS: Required<MediaImportOptions> = {
  onProgress: () => {},
  generateThumbnails: true,
  thumbnailCount: 5,
  thumbnailWidth: 320,
  generateWaveform: true,
  waveformSamplesPerSecond: 100,
  useFallback: true,
  quickMode: false,
};

/**
 * Files above this size are not probed for extra audio tracks with ffmpeg.wasm: the probe writes the WHOLE
 * file into WebAssembly memory (a transient ArrayBuffer plus the MEMFS copy), which for three 4K long-GOP
 * sources was 1.7 GB of the import peak (memory-infra: partition_alloc/array_buffer). The count mediabunny
 * already took from the container index (`getAudioTracks`) is used instead.
 */
export const FFMPEG_AUDIO_PROBE_MAX_BYTES = 64 * 1024 * 1024;

/** Whether the second-opinion ffmpeg audio-stream probe is worth reading the file for. */
export function shouldProbeAudioStreamsWithFfmpeg(audioTrackCount: number | undefined, fileSize: number): boolean {
  if (audioTrackCount !== undefined && audioTrackCount > 1) return false;
  return audioTrackCount === undefined || fileSize <= FFMPEG_AUDIO_PROBE_MAX_BYTES;
}

export class MediaImportService {
  private mediaEngine: MediaBunnyEngine;
  private ffmpegFallback: FFmpegFallback;
  private initialized = false;

  constructor(mediaEngine?: MediaBunnyEngine, ffmpegFallback?: FFmpegFallback) {
    this.mediaEngine = mediaEngine || getMediaEngine();
    this.ffmpegFallback = ffmpegFallback || getFFmpegFallback();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.mediaEngine.initialize();
      this.initialized = true;
    } catch (error) {
      console.warn("MediaBunny initialization failed, will use fallback only");
      // Service can still work with FFmpeg fallback
      this.initialized = true;
    }
  }

  async importMedia(
    file: File,
    options: MediaImportOptions = {},
  ): Promise<MediaImportResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const warnings: string[] = [];
    opts.onProgress?.("Reading file format");
    // Desktop: an MXF (DNxHD/DNxHR, XDCAM, AVC-Intra...) has no browser demuxer; the sidecar reads it directly.
    const nativeContainer = isNativeContainerFile(file) && (await claimNativeSource(file)) !== null;
    const validation = nativeContainer ? { supported: true, format: file.type || "video/mxf" } : await this.validateFormat(file);
    if (!validation.supported) {
      const proMessage = proMediaWebMessage(file);
      // Try FFmpeg fallback if enabled
      if (opts.useFallback) {
        try {
          const converted = await this.importWithFallback(file, opts);
          const pro = classifyProMedia(file.name, file.type);
          // The web build edits a converted proxy of pro media: say so, with what the desktop app does instead.
          return pro && converted.success
            ? { ...converted, warnings: [proMediaProxyNotice(pro.label), ...(converted.warnings ?? [])] }
            : converted;
        } catch (fallbackError) {
          return {
            success: false,
            error: proMessage ?? (validation.error || "Unsupported format"),
            warnings: [
              `FFmpeg fallback also failed: ${
                fallbackError instanceof Error
                  ? fallbackError.message
                  : "Unknown error"
              }`,
            ],
          };
        }
      }

      return {
        success: false,
        error: proMessage ?? (validation.error || "Unsupported format"),
      };
    }

    try {
      opts.onProgress?.("Reading media metadata");
      const metadata = await this.mediaEngine.extractMetadata(file);
      const mediaType = inferMediaType(file.type) ?? (nativeContainer ? "video" : null);

      if (!mediaType) {
        return {
          success: false,
          error: "Could not determine media type",
        };
      }

      if (metadata.hasAudio && shouldProbeAudioStreamsWithFfmpeg(metadata.audioTrackCount, file.size)) {
        try {
          opts.onProgress?.("Checking audio tracks");
          const probeResult = await this.probeAudioStreamsCompat(file);
          if (probeResult.audioStreamCount > 1) {
            metadata.audioTrackCount = probeResult.audioStreamCount;
          }
        } catch {
          // FFmpeg probe failed — keep existing count
        }
      }

      // Desktop: codecs WebCodecs cannot decode (ProRes...) are decoded by the ffmpeg sidecar on demand,
      // so the file plays as imported: no warning, no browser-side transcode, no waiting for a proxy.
      const nativeDecoded =
        metadata.hasVideo &&
        !(metadata.canDecodeVideo ?? metadata.canDecode) &&
        (await claimNativeSource(file)) !== null;
      if (nativeDecoded) {
        metadata.canDecode = true;
        metadata.canDecodeVideo = true;
      }

      const needsTranscode =
        !nativeDecoded &&
        (!metadata.canDecode ||
          (file.type === "video/quicktime" &&
            !(await this.canBrowserPlay(file))));

      if (needsTranscode) {
        if (!metadata.canDecode) {
          warnings.push(
            CODEC_UNSUPPORTED_WARNING,
          );
        }

        if (opts.useFallback) {
          try {
            return await this.importWithFallback(file, opts, {
              format: "mp4",
              videoCodec: "libx264",
              audioCodec: "aac",
              videoBitrate: "5M",
              audioBitrate: "192k",
            });
          } catch {
            // Continue with original file, just with warning
          }
        }
      }
      let thumbnails: ThumbnailResult[] = [];
      if (opts.generateThumbnails && !opts.quickMode) {
        if (mediaType === "video" && metadata.hasVideo) {
          try {
            opts.onProgress?.("Creating video thumbnails");
            thumbnails = await this.mediaEngine.generateThumbnails(
              file,
              opts.thumbnailCount,
              opts.thumbnailWidth,
            );
          } catch (error) {
            warnings.push(
              `Thumbnail generation failed: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          }
        } else if (mediaType === "image") {
          try {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);

            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve();
              };
              img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Failed to load image"));
              };
              img.src = objectUrl;
            });

            const canvas = document.createElement("canvas");
            const targetWidth = opts.thumbnailWidth || 320;
            const aspectRatio = img.height / img.width;
            const targetHeight = Math.round(targetWidth * aspectRatio);

            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
              thumbnails = [
                {
                  timestamp: 0,
                  canvas,
                  dataUrl,
                },
              ];
            }
          } catch (error) {
            warnings.push(
              `Image thumbnail generation failed: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          }
        }
      }
      let waveformData: WaveformData | null = null;
      if (opts.generateWaveform && metadata.hasAudio && !opts.quickMode) {
        try {
          opts.onProgress?.("Creating audio waveform");
          waveformData = await this.mediaEngine.generateWaveform(
            file,
            opts.waveformSamplesPerSecond,
          );
        } catch (error) {
          warnings.push(
            `Waveform generation failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
        }
      }

      const processedMedia: ProcessedMedia = {
        id: uuidv4(),
        name: file.name,
        type: mediaType,
        blob: file,
        metadata,
        thumbnails,
        waveformData,
      };

      return {
        success: true,
        media: processedMedia,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      // Try fallback on any error
      if (opts.useFallback) {
        try {
          return await this.importWithFallback(file, opts);
        } catch (fallbackError) {
          return {
            success: false,
            error: `Import failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            warnings: [
              `FFmpeg fallback also failed: ${
                fallbackError instanceof Error
                  ? fallbackError.message
                  : "Unknown error"
              }`,
            ],
          };
        }
      }

      return {
        success: false,
        error: `Import failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private canBrowserPlay(file: File | Blob): Promise<boolean> {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      };

      video.onloadedmetadata = () => {
        cleanup();
        resolve(true);
      };
      video.onerror = () => {
        cleanup();
        resolve(false);
      };
      video.src = url;
    });
  }

  private async importWithFallback(
    file: File,
    opts: Required<MediaImportOptions>,
    transcodeOpts?: TranscodeOptions,
  ): Promise<MediaImportResult> {
    const container: "mp4" | "webm" | "mov" = transcodeOpts?.format === "mp4" ? "mp4" : "webm";
    const compatibleBlob = nativeMediaAvailable()
      ? await transcodeViaNative(file, {
          container,
          videoBitrateKbps: parseBitrateKbps(transcodeOpts?.videoBitrate, 2000),
          audioBitrateKbps: parseBitrateKbps(transcodeOpts?.audioBitrate, 128),
        })
      : await this.ffmpegFallback.transcodeToCompatible(file, undefined, transcodeOpts);
    const format = transcodeOpts?.format || "webm";
    const ext = format === "mp4" ? ".mp4" : ".webm";
    const mime = format === "mp4" ? "video/mp4" : "video/webm";
    const compatibleFile = new File(
      [compatibleBlob],
      file.name.replace(/\.[^.]+$/, ext),
      { type: mime },
    );

    // Now process with MediaBunny
    const metadata = await this.mediaEngine.extractMetadata(compatibleFile);
    const mediaType = inferMediaType(compatibleFile.type) || "video";

    // Probe original file for audio tracks since WebM transcode may lose them
    if (shouldProbeAudioStreamsWithFfmpeg(metadata.audioTrackCount, file.size)) {
      try {
        const probeResult = await this.probeAudioStreamsCompat(file);
        if (probeResult.audioStreamCount > 1) {
          metadata.audioTrackCount = probeResult.audioStreamCount;
        }
      } catch {
        // FFmpeg probe failed — keep existing count
      }
    }

    let thumbnails: ThumbnailResult[] = [];
    if (opts.generateThumbnails && metadata.hasVideo) {
      try {
        thumbnails = await this.mediaEngine.generateThumbnails(
          compatibleFile,
          opts.thumbnailCount,
          opts.thumbnailWidth,
        );
      } catch {
        // Ignore thumbnail errors in fallback
      }
    }

    let waveformData: WaveformData | null = null;
    if (opts.generateWaveform && metadata.hasAudio) {
      try {
        waveformData = await this.mediaEngine.generateWaveform(
          compatibleFile,
          opts.waveformSamplesPerSecond,
        );
      } catch {
        // Ignore waveform errors in fallback
      }
    }

    const processedMedia: ProcessedMedia = {
      id: uuidv4(),
      name: file.name,
      type: mediaType,
      blob: compatibleFile,
      metadata,
      thumbnails,
      waveformData,
    };

    return {
      success: true,
      media: processedMedia,
      warnings: ["File was transcoded using FFmpeg fallback"],
    };
  }

  async validateFormat(file: File | Blob): Promise<{
    supported: boolean;
    format: string | null;
    error?: string;
  }> {
    if (!isSupportedFormat(file.type)) {
      return {
        supported: false,
        format: null,
        error: `Unsupported format: ${
          file.type || "unknown"
        }. Supported formats: MP4, WebM, MOV, MP3, WAV, AAC, JPG, PNG, WebP`,
      };
    }
    if (this.mediaEngine.isAvailable()) {
      return this.mediaEngine.validateFormat(file);
    }
    return {
      supported: true,
      format: file.type,
    };
  }

  processedMediaToMediaItem(
    processedMedia: ProcessedMedia,
    thumbnailUrl?: string,
  ): MediaItem {
    const metadata: MediaMetadata = {
      duration: processedMedia.metadata.duration,
      width: processedMedia.metadata.width,
      height: processedMedia.metadata.height,
      frameRate: processedMedia.metadata.frameRate,
      codec: processedMedia.metadata.codec,
      sampleRate: processedMedia.metadata.sampleRate,
      channels: processedMedia.metadata.channels,
      fileSize: processedMedia.metadata.fileSize,
      audioTrackCount: processedMedia.metadata.audioTrackCount,
      ...(processedMedia.metadata.sourceColor ? { sourceColor: processedMedia.metadata.sourceColor } : {}),
    };

    return {
      id: processedMedia.id,
      name: processedMedia.name,
      type: processedMedia.type,
      fileHandle: null,
      blob: processedMedia.blob,
      metadata,
      thumbnailUrl: thumbnailUrl || null,
      waveformData: processedMedia.waveformData?.peaks || null,
    };
  }

  async importMultiple(
    files: File[],
    options: MediaImportOptions = {},
    onProgress?: (completed: number, total: number, current: string) => void,
  ): Promise<MediaImportResult[]> {
    const results: MediaImportResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i, files.length, file.name);

      const result = await this.importMedia(file, options);
      results.push(result);
    }

    onProgress?.(files.length, files.length, "Complete");
    return results;
  }

  shouldUseProxy(metadata: {
    width: number;
    height: number;
    duration: number;
    fileSize?: number;
  }): boolean {
    return this.ffmpegFallback.shouldUseProxy(metadata);
  }

  shouldUseProxyForFile(
    file: File | Blob,
    metadata: { width: number; height: number; duration: number },
  ): boolean {
    return this.ffmpegFallback.shouldUseProxy({
      ...metadata,
      fileSize: file.size,
    });
  }

  getRecommendedProxyPreset(metadata: {
    width: number;
    height: number;
  }): "low" | "medium" | "high" {
    return this.ffmpegFallback.getRecommendedProxyPreset(metadata);
  }

  async generateProxy(
    file: File | Blob,
    settings?: Partial<ProxySettings>,
    onProgress?: (progress: {
      phase: string;
      progress: number;
      estimatedTimeRemaining: number;
    }) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Desktop: native FFmpeg sidecar (hardware encoders, no wasm).
    if (nativeMediaAvailable()) {
      const blob = await proxyViaNative(file, presetFromSettings(settings));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return blob;
    }

    // Try MediaBunny first (faster, hardware-accelerated)
    if (this.mediaEngine.isAvailable()) {
      try {
        const metadata = await this.mediaEngine.extractMetadata(file);
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const options = { ...PROXY_PRESETS.medium, ...settings };
        const scale = Math.min(
          1,
          options.scale,
          (options.maxWidth ?? 1280) / metadata.width,
          (options.maxHeight ?? 720) / metadata.height,
        );
        if (!Number.isFinite(scale) || metadata.width <= 0 || metadata.height <= 0) {
          throw new Error("Video dimensions are unavailable");
        }
        const blob = await this.mediaEngine.generateProxy(file, onProgress, signal, {
          width: Math.max(2, Math.floor(metadata.width * scale / 2) * 2),
          height: Math.max(2, Math.floor(metadata.height * scale / 2) * 2),
          videoBitrate: options.crf >= 30 ? 1_000_000 : options.crf >= 26 ? 2_500_000 : 5_000_000,
          audioBitrate: options.audioBitrate * 1000,
          videoCodec: "avc",
          audioCodec: "aac",
        });
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const proxyMetadata = await this.mediaEngine.extractMetadata(blob);
        if (!proxyMetadata.hasVideo || !(proxyMetadata.canDecodeVideo ?? proxyMetadata.canDecode)) {
          throw new Error("Browser could not create a playable video proxy");
        }
        return blob;
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        // Fall through to FFmpeg
      }
    }

    // Use FFmpeg fallback with settings
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return this.ffmpegFallback.generateProxy(file, settings, onProgress, signal);
  }

  private async probeAudioStreamsCompat(
    file: File | Blob,
  ): Promise<{ audioStreamCount: number }> {
    if (nativeMediaAvailable()) {
      return { audioStreamCount: await probeAudioStreamCountViaNative(file) };
    }
    return this.ffmpegFallback.probeAudioStreams(file);
  }

  async generateProxyWithPreset(
    file: File | Blob,
    preset: "low" | "medium" | "high",
    onProgress?: (progress: {
      phase: string;
      progress: number;
      estimatedTimeRemaining: number;
    }) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    // Named presets cap resolution without unnecessarily shrinking HD sources.
    return this.generateProxy(file, { ...PROXY_PRESETS[preset], scale: 1 }, onProgress, signal);
  }

  async generateProxyIfNeeded(
    file: File | Blob,
    metadata: { width: number; height: number; duration: number },
    onProgress?: (progress: {
      phase: string;
      progress: number;
      estimatedTimeRemaining: number;
    }) => void,
  ): Promise<Blob | null> {
    if (!this.shouldUseProxyForFile(file, metadata)) {
      return null;
    }

    // Determine the best preset based on resolution
    const preset = this.getRecommendedProxyPreset(metadata);
    return this.generateProxyWithPreset(file, preset, onProgress);
  }

  getProxyThresholds(): {
    minPixelCount: number;
    minDuration: number;
    minFileSize: number;
  } {
    return { ...PROXY_THRESHOLDS };
  }

  getSupportedFormats(): {
    video: string[];
    audio: string[];
    image: string[];
  } {
    return {
      video: ["MP4", "WebM", "MOV", "MKV"],
      audio: ["MP3", "WAV", "AAC", "OGG", "FLAC"],
      image: ["JPEG", "PNG", "WebP", "GIF"],
    };
  }

  async generateThumbnailsForMedia(
    file: File | Blob,
    mediaType: "video" | "audio" | "image",
    options: { count?: number; width?: number } = {},
  ): Promise<ThumbnailResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const { count = 10, width = 160 } = options;

    if (mediaType === "video") {
      return this.mediaEngine.generateThumbnails(file, count, width);
    }

    if (mediaType === "image") {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error("Failed to load image"));
        };
        img.src = objectUrl;
      });

      const canvas = document.createElement("canvas");
      const aspectRatio = img.height / img.width;
      const targetHeight = Math.round(width * aspectRatio);

      canvas.width = width;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, targetHeight);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        return [{ timestamp: 0, canvas, dataUrl }];
      }
    }

    return [];
  }

  async generateWaveformForMedia(
    file: File | Blob,
    samplesPerSecond = 100,
  ): Promise<WaveformData | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.mediaEngine.generateWaveform(file, samplesPerSecond);
  }
}
let importServiceInstance: MediaImportService | null = null;

function getMediaImportService(): MediaImportService {
  if (!importServiceInstance) {
    importServiceInstance = new MediaImportService();
  }
  return importServiceInstance;
}

export async function initializeMediaImportService(): Promise<MediaImportService> {
  const service = getMediaImportService();
  await service.initialize();
  return service;
}
