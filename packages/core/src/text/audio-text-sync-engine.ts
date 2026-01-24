import { getBeatDetectionEngine, type BeatAnalysisResult } from "../audio/beat-detection-engine";

export interface ClipTiming {
  readonly clipId: string;
  readonly originalStartTime: number;
  readonly originalDuration: number;
  readonly newStartTime: number;
  readonly newDuration: number;
}

export type SyncMode = "smart" | "one-per-beat" | "preserve-duration";

export interface BeatSyncConfig {
  readonly syncMode: SyncMode;
  readonly beatSubdivision: 1 | 2 | 4;
  readonly offsetMs: number;
  readonly snapToDownbeats: boolean;
}

export const DEFAULT_BEAT_SYNC_CONFIG: BeatSyncConfig = {
  syncMode: "smart",
  beatSubdivision: 1,
  offsetMs: 0,
  snapToDownbeats: false,
};

export interface SyncProgress {
  readonly phase: "analyzing" | "syncing" | "complete" | "error";
  readonly percent: number;
  readonly message: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export interface ClipInfo {
  readonly id: string;
  readonly startTime: number;
  readonly duration: number;
  readonly trackId: string;
}

export class BeatSyncEngine {
  async analyzeBeats(
    audioBlob: Blob,
    onProgress?: SyncProgressCallback,
  ): Promise<BeatAnalysisResult> {
    onProgress?.({
      phase: "analyzing",
      percent: 20,
      message: "Analyzing audio for beats...",
    });

    const beatEngine = getBeatDetectionEngine();
    const result = await beatEngine.analyzeFromBlob(audioBlob);

    onProgress?.({
      phase: "complete",
      percent: 100,
      message: `Detected ${result.bpm} BPM with ${result.beats.length} beats`,
    });

    return result;
  }

  calculateSyncedTimings(
    clips: ClipInfo[],
    beatAnalysis: BeatAnalysisResult,
    audioStartTime: number,
    config: BeatSyncConfig,
  ): ClipTiming[] {
    if (clips.length === 0 || beatAnalysis.beats.length === 0) {
      return [];
    }

    const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);
    const beatTimes = this.getSubdividedBeats(beatAnalysis, config);
    const offsetSeconds = config.offsetMs / 1000;
    const timings: ClipTiming[] = [];

    if (beatTimes.length < 2) {
      return [];
    }

    const avgBeatInterval = (beatTimes[beatTimes.length - 1] - beatTimes[0]) / (beatTimes.length - 1);
    let currentBeatIndex = 0;

    for (const clip of sortedClips) {
      if (currentBeatIndex >= beatTimes.length) break;

      const beatTime = beatTimes[currentBeatIndex] + audioStartTime + offsetSeconds;

      switch (config.syncMode) {
        case "preserve-duration": {
          timings.push({
            clipId: clip.id,
            originalStartTime: clip.startTime,
            originalDuration: clip.duration,
            newStartTime: beatTime,
            newDuration: clip.duration,
          });
          currentBeatIndex++;
          break;
        }

        case "one-per-beat": {
          const nextBeatIndex = Math.min(currentBeatIndex + 1, beatTimes.length - 1);
          const nextBeatTime = beatTimes[nextBeatIndex] + audioStartTime + offsetSeconds;
          const beatDuration = nextBeatTime - beatTime;

          timings.push({
            clipId: clip.id,
            originalStartTime: clip.startTime,
            originalDuration: clip.duration,
            newStartTime: beatTime,
            newDuration: Math.max(0.1, beatDuration),
          });
          currentBeatIndex++;
          break;
        }

        case "smart":
        default: {
          const beatsToSpan = Math.max(1, Math.round(clip.duration / avgBeatInterval));
          const endBeatIndex = Math.min(currentBeatIndex + beatsToSpan, beatTimes.length - 1);
          const endBeatTime = beatTimes[endBeatIndex] + audioStartTime + offsetSeconds;
          const newDuration = endBeatTime - beatTime;

          timings.push({
            clipId: clip.id,
            originalStartTime: clip.startTime,
            originalDuration: clip.duration,
            newStartTime: beatTime,
            newDuration: Math.max(0.1, newDuration),
          });
          currentBeatIndex = endBeatIndex;
          break;
        }
      }
    }

    return timings;
  }

  private getSubdividedBeats(
    beatAnalysis: BeatAnalysisResult,
    config: BeatSyncConfig,
  ): number[] {
    const beats = config.snapToDownbeats
      ? beatAnalysis.beats.filter((_, i) => i % 4 === 0)
      : beatAnalysis.beats;

    if (config.beatSubdivision === 1) {
      return beats.map((b) => b.time);
    }

    const times: number[] = [];
    for (let i = 0; i < beats.length - 1; i++) {
      const beatDuration = beats[i + 1].time - beats[i].time;
      const subBeatDuration = beatDuration / config.beatSubdivision;
      for (let j = 0; j < config.beatSubdivision; j++) {
        times.push(beats[i].time + j * subBeatDuration);
      }
    }
    if (beats.length > 0) {
      times.push(beats[beats.length - 1].time);
    }
    return times;
  }

  snapClipToNearestBeat(
    clipStartTime: number,
    beatAnalysis: BeatAnalysisResult,
    audioStartTime: number,
    maxSnapDistance: number = 0.2,
  ): number {
    const relativeTime = clipStartTime - audioStartTime;
    let nearestBeat = beatAnalysis.beats[0];
    let minDistance = Math.abs(nearestBeat.time - relativeTime);

    for (const beat of beatAnalysis.beats) {
      const distance = Math.abs(beat.time - relativeTime);
      if (distance < minDistance) {
        minDistance = distance;
        nearestBeat = beat;
      }
    }

    if (minDistance <= maxSnapDistance) {
      return nearestBeat.time + audioStartTime;
    }

    return clipStartTime;
  }
}

let beatSyncEngineInstance: BeatSyncEngine | null = null;

export function getBeatSyncEngine(): BeatSyncEngine {
  if (!beatSyncEngineInstance) {
    beatSyncEngineInstance = new BeatSyncEngine();
  }
  return beatSyncEngineInstance;
}

export function disposeBeatSyncEngine(): void {
  beatSyncEngineInstance = null;
}

export { type BeatAnalysisResult };
