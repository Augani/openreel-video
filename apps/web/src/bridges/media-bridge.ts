import {
  MediaImportService,
  initializeMediaImportService,
  WaveformGenerator,
  getWaveformGenerator,
} from "@openreel/core";
import type {
  ProcessedMedia,
  WaveformData,
  MediaTrackInfo,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Import progress callback type
 */
export type ImportProgressCallback = (
  completed: number,
  total: number,
  currentFile: string,
) => void;

/**
 * Waveform progress callback type
 */
export type WaveformProgressCallback = (progress: number) => void;

/**
 * Import result with additional UI-specific data
 */
export interface MediaBridgeImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** The processed media item if successful */
  media?: ProcessedMedia;
  /** Error message if import failed */
  error?: string;
  /** Warnings during import */
  warnings?: string[];
  /** Whether waveform was generated */
  hasWaveform: boolean;
}

/**
 * MediaBridge class for connecting UI to media import functionality
 */
export class MediaBridge {
  private mediaImportService: MediaImportService | null = null;
  private waveformGenerator: WaveformGenerator | null = null;
  private initialized = false;

  private async generateVideoElementThumbnails(
    file: File | Blob,
    count = 10,
    width = 160,
  ): Promise<{ timestamp: number; dataUrl: string }[]> {
    if (typeof document === "undefined") {
      return [];
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    const waitForEvent = (
      eventName: "loadedmetadata" | "seeked",
      timeoutMs = 2500,
    ) =>
      new Promise<void>((resolve, reject) => {
        let timeoutId: number | undefined;
        const finish = (error?: Error) => {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
          video.removeEventListener(eventName, onEvent);
          video.removeEventListener("error", onError);
          if (error) reject(error);
          else resolve();
        };
        const onEvent = () => finish();
        const onError = () => finish(new Error("Video thumbnail decode failed"));

        timeoutId = window.setTimeout(
          () => finish(new Error("Video thumbnail decode timed out")),
          timeoutMs,
        );
        video.addEventListener(eventName, onEvent, { once: true });
        video.addEventListener("error", onError, { once: true });
      });

    try {
      await waitForEvent("loadedmetadata");

      const sourceWidth = video.videoWidth || width;
      const sourceHeight = video.videoHeight || Math.round(width * 9 / 16);
      const height = Math.max(
        1,
        Math.round(width * (sourceHeight / Math.max(1, sourceWidth))),
      );
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0;
      const maxSeekTime = Math.max(0, duration - 0.05);
      const timestamps =
        duration > 0
          ? Array.from({ length: Math.max(1, count) }, (_, i) => {
              const progress =
                count <= 1 ? 0.1 : (i + 0.5) / Math.max(1, count);
              return Math.min(maxSeekTime, Math.max(0, duration * progress));
            })
          : [0];

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return [];
      }

      const thumbnails: { timestamp: number; dataUrl: string }[] = [];
      for (const timestamp of timestamps) {
        if (Math.abs(video.currentTime - timestamp) > 0.01) {
          video.currentTime = timestamp;
          await waitForEvent("seeked");
        }

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(video, 0, 0, width, height);
        thumbnails.push({
          timestamp,
          dataUrl: canvas.toDataURL("image/jpeg", 0.72),
        });
      }

      return thumbnails;
    } catch {
      return [];
    } finally {
      cleanup();
    }
  }

  /**
   * Initialize the media bridge
   * Connects to the MediaImportService and WaveformGenerator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize the media import service
      this.mediaImportService = await initializeMediaImportService();
      this.waveformGenerator = getWaveformGenerator();
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`MediaBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Import a media file
   *
   * Decode using MediaBunny and extract metadata
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param file - The file to import
   * @param generateWaveform - Whether to generate waveform data (default: true)
   * @returns Import result with processed media or error
   */
  async importFile(
    file: File,
    generateWaveform = true,
    quickMode = false,
  ): Promise<MediaBridgeImportResult> {
    if (!this.initialized || !this.mediaImportService) {
      return {
        success: false,
        error: "MediaBridge not initialized",
        hasWaveform: false,
      };
    }

    const projectStateBefore = this.captureProjectState();

    try {
      const result = await this.mediaImportService.importMedia(file, {
        generateThumbnails: !quickMode,
        thumbnailCount: 10,
        thumbnailWidth: 160,
        generateWaveform: generateWaveform && !quickMode,
        waveformSamplesPerSecond: 100,
        useFallback: true,
        quickMode,
      });

      if (!result.success || !result.media) {
        return {
          success: false,
          error: result.error || "Import failed",
          warnings: result.warnings,
          hasWaveform: false,
        };
      }

      const metadata = result.media.metadata;
      if (!this.validateMetadata(metadata)) {
        return {
          success: false,
          error: "Failed to extract valid metadata from media file",
          hasWaveform: false,
        };
      }

      return {
        success: true,
        media: result.media,
        warnings: result.warnings,
        hasWaveform: result.media.waveformData !== null,
      };
    } catch (error) {
      this.restoreProjectState(projectStateBefore);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown import error";
      return {
        success: false,
        error: errorMessage,
        hasWaveform: false,
      };
    }
  }

  async generateThumbnailsForMedia(
    file: File | Blob,
    mediaType: "video" | "audio" | "image",
  ): Promise<{ timestamp: number; dataUrl: string }[]> {
    if (!this.initialized || !this.mediaImportService) {
      return [];
    }

    try {
      const thumbnails = await this.mediaImportService.generateThumbnailsForMedia(
        file,
        mediaType,
        { count: 10, width: 160 },
      );

      const mapped = thumbnails.map((thumb) => ({
        timestamp: thumb.timestamp,
        dataUrl: thumb.dataUrl || "",
      })).filter((t) => t.dataUrl);

      if (mapped.length > 0 || mediaType !== "video") {
        return mapped;
      }

      return await this.generateVideoElementThumbnails(file, 10, 160);
    } catch {
      if (mediaType === "video") {
        return await this.generateVideoElementThumbnails(file, 10, 160);
      }
      return [];
    }
  }

  /**
   * Import multiple media files
   *
   * @param files - Array of files to import
   * @param onProgress - Optional progress callback
   * @returns Array of import results
   */
  async importFiles(
    files: File[],
    onProgress?: ImportProgressCallback,
  ): Promise<MediaBridgeImportResult[]> {
    if (!this.initialized || !this.mediaImportService) {
      return files.map(() => ({
        success: false,
        error: "MediaBridge not initialized",
        hasWaveform: false,
      }));
    }

    const results: MediaBridgeImportResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i, files.length, file.name);

      const result = await this.importFile(file);
      results.push(result);
    }

    onProgress?.(files.length, files.length, "Complete");
    return results;
  }

  /**
   * Generate waveform data for a media file
   *
   * Generate waveform visualization asynchronously
   * Feature: core-ui-integration, Property 11: Waveform Generation
   *
   * @param file - The audio/video file
   * @param mediaId - Unique identifier for caching
   * @param samplesPerSecond - Waveform resolution (default: 100)
   * @returns WaveformData with peaks array proportional to duration
   */
  async generateWaveform(
    file: File | Blob,
    mediaId: string,
    samplesPerSecond = 100,
  ): Promise<WaveformData | null> {
    if (!this.initialized || !this.waveformGenerator) {
      return null;
    }

    try {
      const waveformData = await this.waveformGenerator.generateWaveform(
        file,
        mediaId,
        { samplesPerSecond, enableCaching: true },
      );

      // Validate waveform data
      // Store peaks array proportional to duration
      if (!this.validateWaveformData(waveformData)) {
        return null;
      }

      return waveformData;
    } catch (error) {
      console.error("MediaBridge: Waveform generation error:", error);
      return null;
    }
  }

  /**
   * Extract metadata from a media file without full import
   *
   * Extract metadata (duration, dimensions, codec)
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param file - The file to analyze
   * @returns MediaTrackInfo with extracted metadata
   */
  async extractMetadata(file: File | Blob): Promise<MediaTrackInfo | null> {
    if (!this.initialized || !this.mediaImportService) {
      return null;
    }

    try {
      // Use the media import service to validate and extract metadata
      const result = await this.mediaImportService.importMedia(file as File, {
        generateThumbnails: false,
        generateWaveform: false,
        useFallback: true,
      });

      if (!result.success || !result.media) {
        return null;
      }

      return result.media.metadata;
    } catch (error) {
      console.error("MediaBridge: Metadata extraction error:", error);
      return null;
    }
  }

  /**
   * Validate extracted metadata
   *
   * Extract metadata (duration, dimensions, codec)
   * Feature: core-ui-integration, Property 10: Media Import Metadata Extraction
   *
   * @param metadata - The metadata to validate
   * @returns true if metadata is valid
   */
  validateMetadata(metadata: MediaTrackInfo): boolean {
    // Check if it's an image (no hasVideo, no hasAudio, but has dimensions)
    const isImage =
      !metadata.hasVideo &&
      !metadata.hasAudio &&
      metadata.width > 0 &&
      metadata.height > 0;

    // Duration must be non-null (can be 0 for images)
    if (metadata.duration === null || metadata.duration === undefined) {
      return false;
    }

    // For non-images, duration must be positive
    if (!isImage && metadata.duration <= 0) {
      return false;
    }

    // For images, validate dimensions
    if (isImage) {
      if (
        metadata.width === null ||
        metadata.width === undefined ||
        metadata.width <= 0
      ) {
        return false;
      }
      if (
        metadata.height === null ||
        metadata.height === undefined ||
        metadata.height <= 0
      ) {
        return false;
      }
      return true;
    }

    // For video files, width and height must be positive
    if (metadata.hasVideo) {
      if (
        metadata.width === null ||
        metadata.width === undefined ||
        metadata.width <= 0
      ) {
        return false;
      }
      if (
        metadata.height === null ||
        metadata.height === undefined ||
        metadata.height <= 0
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate waveform data
   *
   * Store peaks array proportional to duration
   * Feature: core-ui-integration, Property 11: Waveform Generation
   *
   * @param waveformData - The waveform data to validate
   * @returns true if waveform data is valid
   */
  validateWaveformData(waveformData: WaveformData): boolean {
    // Peaks array must exist and have length
    if (!waveformData.peaks || waveformData.peaks.length === 0) {
      return false;
    }

    // Duration must be positive
    if (waveformData.duration <= 0) {
      return false;
    }

    // Peaks length should be proportional to duration
    // Expected length = duration * samplesPerSecond
    const expectedLength = Math.ceil(
      waveformData.duration * waveformData.samplesPerSecond,
    );
    const actualLength = waveformData.peaks.length;

    // Allow some tolerance (within 10% or 10 samples)
    const tolerance = Math.max(expectedLength * 0.1, 10);
    if (Math.abs(actualLength - expectedLength) > tolerance) {
      return false;
    }

    return true;
  }

  /**
   * Get supported file formats
   */
  getSupportedFormats(): {
    video: string[];
    audio: string[];
    image: string[];
  } {
    if (!this.mediaImportService) {
      return { video: [], audio: [], image: [] };
    }
    return this.mediaImportService.getSupportedFormats();
  }

  /**
   * Check if a file format is supported
   *
   * @param file - The file to check
   * @returns true if the format is supported
   */
  async isFormatSupported(file: File | Blob): Promise<boolean> {
    if (!this.mediaImportService) {
      return false;
    }

    const validation = await this.mediaImportService.validateFormat(file);
    return validation.supported;
  }

  /**
   * Capture current project state for rollback
   *
   * Maintain current state on failed import
   * Feature: core-ui-integration, Property 13: Failed Import State Preservation
   */
  private captureProjectState(): {
    mediaLibraryIds: string[];
    timelineClipIds: string[];
  } {
    const projectState = useProjectStore.getState();
    const project = projectState.project;

    return {
      mediaLibraryIds: project.mediaLibrary.items.map((m) => m.id),
      timelineClipIds: project.timeline.tracks.flatMap((t) =>
        t.clips.map((c) => c.id),
      ),
    };
  }

  /**
   * Restore project state on failed import
   *
   * Maintain current state on failed import
   * Feature: core-ui-integration, Property 13: Failed Import State Preservation
   *
   * Note: This is a safety mechanism. In practice, we don't modify the project
   * state until import is successful, so this is mainly for edge cases.
   */
  private restoreProjectState(_stateBefore: {
    mediaLibraryIds: string[];
    timelineClipIds: string[];
  }): void {
    // In the current implementation, we don't modify project state until
    // import is successful, so no rollback is needed. This method exists
    // as a safety mechanism for future changes.
  }

  /**
   * Dispose of the media bridge and clean up resources
   */
  dispose(): void {
    this.mediaImportService = null;
    this.waveformGenerator = null;
    this.initialized = false;
  }
}

// Singleton instance
let mediaBridgeInstance: MediaBridge | null = null;

/**
 * Get the shared MediaBridge instance
 */
export function getMediaBridge(): MediaBridge {
  if (!mediaBridgeInstance) {
    mediaBridgeInstance = new MediaBridge();
  }
  return mediaBridgeInstance;
}

/**
 * Initialize the shared MediaBridge
 */
export async function initializeMediaBridge(): Promise<MediaBridge> {
  const bridge = getMediaBridge();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared MediaBridge
 */
export function disposeMediaBridge(): void {
  if (mediaBridgeInstance) {
    mediaBridgeInstance.dispose();
    mediaBridgeInstance = null;
  }
}
