import { v4 as uuidv4 } from "uuid";
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
  PROXY_THRESHOLDS,
  type ProxySettings,
} from "./ffmpeg-fallback";

export interface MediaImportOptions {
  generateThumbnails?: boolean;
  thumbnailCount?: number;
  thumbnailWidth?: number;
  generateWaveform?: boolean;
  waveformSamplesPerSecond?: number;
  useFallback?: boolean;
  quickMode?: boolean;
}

const DEFAULT_OPTIONS: Required<MediaImportOptions> = {
  generateThumbnails: true,
  thumbnailCount: 5,
  thumbnailWidth: 320,
  generateWaveform: true,
  waveformSamplesPerSecond: 100,
  useFallback: true,
  quickMode: false,
};

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
    const validation = await this.validateFormat(file);
    if (!validation.supported) {
      // Try FFmpeg fallback if enabled
      if (opts.useFallback) {
        try {
          return await this.importWithFallback(file, opts);
        } catch (fallbackError) {
          return {
            success: false,
            error: validation.error || "Unsupported format",
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
        error: validation.error || "Unsupported format",
      };
    }

    try {
      const metadata = await this.mediaEngine.extractMetadata(file);
      const mediaType = inferMediaType(file.type);

      if (!mediaType) {
        return {
          success: false,
          error: "Could not determine media type",
        };
      }

      if (
        metadata.hasAudio &&
        (metadata.audioTrackCount === undefined || metadata.audioTrackCount <= 1)
      ) {
        try {
          const probeResult = await this.ffmpegFallback.probeAudioStreams(file);
          if (probeResult.audioStreamCount > 1) {
            metadata.audioTrackCount = probeResult.audioStreamCount;
          }
        } catch {
          // FFmpeg probe failed — keep existing count
        }
      }

      if (!metadata.canDecode) {
        warnings.push(
          "Codec may not be fully supported. Playback might be limited.",
        );

        // Try fallback for unsupported codec
        if (opts.useFallback) {
          try {
            return await this.importWithFallback(file, opts);
          } catch {
            // Continue with original file, just with warning
          }
        }
      }
      let thumbnails: ThumbnailResult[] = [];
      if (opts.generateThumbnails && !opts.quickMode) {
        if (mediaType === "video" && metadata.hasVideo) {
          try {
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

  private async importWithFallback(
    file: File,
    opts: Required<MediaImportOptions>,
  ): Promise<MediaImportResult> {
    // Transcode to compatible format
    const compatibleBlob =
      await this.ffmpegFallback.transcodeToCompatible(file);
    const compatibleFile = new File(
      [compatibleBlob],
      file.name.replace(/\.[^.]+$/, ".webm"),
      { type: "video/webm" },
    );

    // Now process with MediaBunny
    const metadata = await this.mediaEngine.extractMetadata(compatibleFile);
    const mediaType = inferMediaType(compatibleFile.type) || "video";

    // Probe original file for audio tracks since WebM transcode may lose them
    if (metadata.audioTrackCount === undefined || metadata.audioTrackCount <= 1) {
      try {
        const probeResult = await this.ffmpegFallback.probeAudioStreams(file);
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
  ): Promise<Blob> {
    // Try MediaBunny first (faster, hardware-accelerated)
    if (this.mediaEngine.isAvailable()) {
      try {
        return await this.mediaEngine.generateProxy(file);
      } catch {
        // Fall through to FFmpeg
      }
    }

    // Use FFmpeg fallback with settings
    return this.ffmpegFallback.generateProxy(file, settings, onProgress);
  }

  async generateProxyWithPreset(
    file: File | Blob,
    preset: "low" | "medium" | "high",
    onProgress?: (progress: {
      phase: string;
      progress: number;
      estimatedTimeRemaining: number;
    }) => void,
  ): Promise<Blob> {
    return this.ffmpegFallback.generateProxyWithPreset(
      file,
      preset,
      onProgress,
    );
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

export function getMediaImportService(): MediaImportService {
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
