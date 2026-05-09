import type { Beat, BeatAnalysisResult } from "../audio/beat-detection-engine";
import type { Clip } from "../types/timeline";

export type CutMode = "beats" | "downbeats" | "segments";

export interface AutoEditOptions {
  readonly cutMode: CutMode;
  readonly minClipDuration: number;
  readonly maxClipDuration: number;
  readonly sensitivity: number;
}

export const DEFAULT_AUTO_EDIT_OPTIONS: AutoEditOptions = {
  cutMode: "beats",
  minClipDuration: 0.3,
  maxClipDuration: 10,
  sensitivity: 0.5,
};

export interface AutoEditCut {
  readonly sourceClipId: string;
  readonly inPoint: number;
  readonly outPoint: number;
  readonly startTime: number;
  readonly duration: number;
}

export interface AutoEditResult {
  readonly cuts: AutoEditCut[];
  readonly totalDuration: number;
  readonly beatCount: number;
}

export class AutoEditService {
  generateCuts(
    beatAnalysis: BeatAnalysisResult,
    sourceClips: Clip[],
    options: AutoEditOptions = DEFAULT_AUTO_EDIT_OPTIONS,
  ): AutoEditResult {
    if (sourceClips.length === 0 || beatAnalysis.beats.length === 0) {
      return { cuts: [], totalDuration: 0, beatCount: 0 };
    }

    const cutPoints = this.getCutPoints(beatAnalysis, options);
    const filteredCutPoints = this.filterByMinDuration(
      cutPoints,
      options.minClipDuration,
    );

    const cuts: AutoEditCut[] = [];
    let currentTime = 0;
    let sourceIndex = 0;

    for (let i = 0; i < filteredCutPoints.length - 1; i++) {
      const segmentStart = filteredCutPoints[i];
      const segmentEnd = filteredCutPoints[i + 1];
      const segmentDuration = segmentEnd - segmentStart;

      if (segmentDuration > options.maxClipDuration) continue;

      const sourceClip = sourceClips[sourceIndex % sourceClips.length];
      const availableDuration = sourceClip.outPoint - sourceClip.inPoint;
      const inPoint =
        sourceClip.inPoint +
        ((i * segmentDuration) % Math.max(availableDuration - segmentDuration, segmentDuration));

      cuts.push({
        sourceClipId: sourceClip.id,
        inPoint: Math.min(inPoint, sourceClip.outPoint - segmentDuration),
        outPoint: Math.min(inPoint + segmentDuration, sourceClip.outPoint),
        startTime: currentTime,
        duration: segmentDuration,
      });

      currentTime += segmentDuration;
      sourceIndex++;
    }

    return {
      cuts,
      totalDuration: currentTime,
      beatCount: filteredCutPoints.length,
    };
  }

  private getCutPoints(
    beatAnalysis: BeatAnalysisResult,
    options: AutoEditOptions,
  ): number[] {
    switch (options.cutMode) {
      case "downbeats":
        return [0, ...beatAnalysis.downbeats].sort((a, b) => a - b);

      case "beats": {
        const strengthThreshold = 1 - options.sensitivity;
        const filteredBeats = beatAnalysis.beats.filter(
          (beat: Beat) => beat.strength >= strengthThreshold,
        );
        return [0, ...filteredBeats.map((b: Beat) => b.time)].sort(
          (a, b) => a - b,
        );
      }

      case "segments": {
        const beatsPerSegment = Math.max(
          2,
          Math.round(4 * (1 - options.sensitivity) + 1),
        );
        const points: number[] = [0];
        for (let i = 0; i < beatAnalysis.beats.length; i += beatsPerSegment) {
          points.push(beatAnalysis.beats[i].time);
        }
        return points;
      }

      default:
        return [0, beatAnalysis.duration];
    }
  }

  private filterByMinDuration(
    cutPoints: number[],
    minDuration: number,
  ): number[] {
    if (cutPoints.length <= 1) return cutPoints;

    const filtered: number[] = [cutPoints[0]];
    for (let i = 1; i < cutPoints.length; i++) {
      const lastPoint = filtered[filtered.length - 1];
      if (cutPoints[i] - lastPoint >= minDuration) {
        filtered.push(cutPoints[i]);
      }
    }
    return filtered;
  }
}

let instance: AutoEditService | null = null;

export function getAutoEditService(): AutoEditService {
  if (!instance) {
    instance = new AutoEditService();
  }
  return instance;
}
