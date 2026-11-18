import { getAudioEngine, planSilenceCut } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

export interface SilenceSettings {
  threshold: number;
  minSilenceDuration: number;
  paddingBefore: number;
  paddingAfter: number;
}

export interface SilentRegion {
  start: number;
  end: number;
  duration: number;
}

export interface SilenceAnalysisResult {
  silentRegions: SilentRegion[];
  totalSilenceDuration: number;
  clipDuration: number;
}

export const DEFAULT_SILENCE_SETTINGS: SilenceSettings = {
  threshold: -40,
  minSilenceDuration: 0.5,
  paddingBefore: 0.1,
  paddingAfter: 0.1,
};

type SilenceProgressCallback = (
  progress: number,
  message: string,
) => void;

export class SilenceCutBridge {
  private audioContext: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  async analyzeClip(
    clipId: string,
    settings: SilenceSettings,
    onProgress?: SilenceProgressCallback,
  ): Promise<SilenceAnalysisResult> {
    const store = useProjectStore.getState();
    const clip = store.getClip(clipId);

    if (!clip) {
      throw new Error("Clip not found");
    }

    const mediaItem = store.getMediaItem(clip.mediaId);
    if (!mediaItem?.blob) {
      throw new Error("Media blob not found");
    }

    onProgress?.(10, "Loading audio...");

    const audioContext = this.getAudioContext();
    const arrayBuffer = await mediaItem.blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    onProgress?.(30, "Detecting silence...");

    const audioEngine = getAudioEngine();
    const rawSilentRanges = audioEngine.detectSilence(
      audioBuffer,
      settings.threshold,
    );

    onProgress?.(60, "Processing results...");

    const inPoint = clip.inPoint ?? 0;
    const outPoint = clip.outPoint ?? audioBuffer.duration;
    const clipDuration = outPoint - inPoint;

    const filteredRegions = rawSilentRanges
      .map((range) => {
        const relativeStart = range.start - inPoint;
        const relativeEnd = range.end - inPoint;

        const adjustedStart = Math.max(
          0,
          relativeStart + settings.paddingBefore,
        );
        const adjustedEnd = Math.min(
          clipDuration,
          relativeEnd - settings.paddingAfter,
        );

        return {
          start: adjustedStart,
          end: adjustedEnd,
          duration: adjustedEnd - adjustedStart,
        };
      })
      .filter(
        (region) =>
          region.duration >= settings.minSilenceDuration &&
          region.start >= 0 &&
          region.end <= clipDuration &&
          region.start < region.end,
      );

    onProgress?.(90, "Finalizing...");

    const totalSilenceDuration = filteredRegions.reduce(
      (sum, region) => sum + region.duration,
      0,
    );

    onProgress?.(100, "Complete");

    return {
      silentRegions: filteredRegions,
      totalSilenceDuration,
      clipDuration,
    };
  }

  /** Largest media file the passive preview scan will decode. */
  static readonly PREVIEW_MAX_BYTES = 48 * 1024 * 1024;
  private previewCache = new Map<string, number>();

  /**
   * Number of silent sections the Remove silences recipe would cut, for a quiet preview on its card.
   * Null when the clip is too large to scan in the background.
   */
  async countSilences(clipId: string, settings: SilenceSettings): Promise<number | null> {
    const store = useProjectStore.getState();
    const clip = store.getClip(clipId);
    const blob = clip ? store.getMediaItem(clip.mediaId)?.blob : undefined;
    if (!clip || !blob || blob.size > SilenceCutBridge.PREVIEW_MAX_BYTES) return null;
    const key = `${clipId}:${blob.size}:${clip.inPoint ?? 0}:${clip.outPoint ?? ""}:${settings.threshold}:${settings.minSilenceDuration}`;
    const cached = this.previewCache.get(key);
    if (cached !== undefined) return cached;
    const result = await this.analyzeClip(clipId, settings);
    this.previewCache.set(key, result.silentRegions.length);
    return result.silentRegions.length;
  }

  async cutSilence(
    clipId: string,
    silentRegions: SilentRegion[],
    onProgress?: SilenceProgressCallback,
  ): Promise<{ success: boolean; error?: string }> {
    if (silentRegions.length === 0) {
      return { success: true };
    }

    const store = useProjectStore.getState();
    if (!store.getClip(clipId)) return { success: false, error: "Clip not found" };
    try {
      onProgress?.(0, "Preparing cuts...");
      // One sync-lock aware plan (the same ripple-delete planner as a manual
      // ripple delete) and one undo step.
      const plan = planSilenceCut(store.getFullProject(), clipId, silentRegions, crypto.randomUUID());
      const result = store.commitTimelineToolEdit(plan);
      if (!result.success)
        return { success: false, error: result.error?.message ?? "Could not cut silence." };
      onProgress?.(100, "Complete");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  dispose(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

let bridgeInstance: SilenceCutBridge | null = null;

export function getSilenceCutBridge(): SilenceCutBridge {
  if (!bridgeInstance) {
    bridgeInstance = new SilenceCutBridge();
  }
  return bridgeInstance;
}
