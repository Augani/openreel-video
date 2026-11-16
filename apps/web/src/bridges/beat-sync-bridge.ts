import {
  BeatDetectionEngine,
  getBeatDetectionEngine,
  type Beat,
  type BeatAnalysisResult,
  type TimelineBeatMarker,
  type TimelineBeatAnalysis,
  type Clip,
} from "@openreel/core";

export interface BeatSyncState {
  isAnalyzing: boolean;
  progress: number;
  error: string | null;
  beatMarkers: TimelineBeatMarker[];
  beatAnalysis: TimelineBeatAnalysis | null;
}

interface BeatSyncOptions {
  snapToBeats: boolean;
  snapThreshold: number;
  autoZoomOnBeats: boolean;
  zoomIntensity: number;
  autoCutOnBeats: boolean;
  beatsPerCut: number;
}

const DEFAULT_BEAT_SYNC_OPTIONS: BeatSyncOptions = {
  snapToBeats: true,
  snapThreshold: 0.1,
  autoZoomOnBeats: false,
  zoomIntensity: 1.1,
  autoCutOnBeats: false,
  beatsPerCut: 4,
};

class BeatSyncBridge {
  private engine: BeatDetectionEngine;
  private state: BeatSyncState = {
    isAnalyzing: false,
    progress: 0,
    error: null,
    beatMarkers: [],
    beatAnalysis: null,
  };
  private options: BeatSyncOptions = { ...DEFAULT_BEAT_SYNC_OPTIONS };
  private listeners: Set<(state: BeatSyncState) => void> = new Set();

  constructor() {
    this.engine = getBeatDetectionEngine();
  }

  getState(): BeatSyncState {
    return { ...this.state };
  }

  getOptions(): BeatSyncOptions {
    return { ...this.options };
  }

  setOptions(options: Partial<BeatSyncOptions>): void {
    this.options = { ...this.options, ...options };
  }

  subscribe(listener: (state: BeatSyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  private updateState(updates: Partial<BeatSyncState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  async analyzeAudioFromBlob(
    blob: Blob,
    sourceClipId?: string,
  ): Promise<BeatAnalysisResult> {
    this.updateState({
      isAnalyzing: true,
      progress: 0,
      error: null,
    });

    try {
      this.updateState({ progress: 10 });

      const result = await this.engine.analyzeFromBlob(blob);

      this.updateState({ progress: 80 });

      const beatMarkers = this.convertToBeatMarkers(
        result.beats,
        result.downbeats,
      );
      const beatAnalysis: TimelineBeatAnalysis = {
        bpm: result.bpm,
        confidence: result.confidence,
        sourceClipId,
        analyzedAt: Date.now(),
      };

      this.updateState({
        isAnalyzing: false,
        progress: 100,
        beatMarkers,
        beatAnalysis,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Beat analysis failed";
      this.updateState({
        isAnalyzing: false,
        progress: 0,
        error: errorMessage,
      });
      throw error;
    }
  }

  async analyzeAudioFromUrl(
    url: string,
    sourceClipId?: string,
  ): Promise<BeatAnalysisResult> {
    this.updateState({
      isAnalyzing: true,
      progress: 0,
      error: null,
    });

    try {
      this.updateState({ progress: 10 });

      const result = await this.engine.analyzeFromUrl(url);

      this.updateState({ progress: 80 });

      const beatMarkers = this.convertToBeatMarkers(
        result.beats,
        result.downbeats,
      );
      const beatAnalysis: TimelineBeatAnalysis = {
        bpm: result.bpm,
        confidence: result.confidence,
        sourceClipId,
        analyzedAt: Date.now(),
      };

      this.updateState({
        isAnalyzing: false,
        progress: 100,
        beatMarkers,
        beatAnalysis,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Beat analysis failed";
      this.updateState({
        isAnalyzing: false,
        progress: 0,
        error: errorMessage,
      });
      throw error;
    }
  }

  async analyzeAudioBuffer(
    audioBuffer: AudioBuffer,
    sourceClipId?: string,
  ): Promise<BeatAnalysisResult> {
    this.updateState({
      isAnalyzing: true,
      progress: 0,
      error: null,
    });

    try {
      this.updateState({ progress: 10 });

      const result = await this.engine.analyzeAudioBuffer(audioBuffer);

      this.updateState({ progress: 80 });

      const beatMarkers = this.convertToBeatMarkers(
        result.beats,
        result.downbeats,
      );
      const beatAnalysis: TimelineBeatAnalysis = {
        bpm: result.bpm,
        confidence: result.confidence,
        sourceClipId,
        analyzedAt: Date.now(),
      };

      this.updateState({
        isAnalyzing: false,
        progress: 100,
        beatMarkers,
        beatAnalysis,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Beat analysis failed";
      this.updateState({
        isAnalyzing: false,
        progress: 0,
        error: errorMessage,
      });
      throw error;
    }
  }

  private convertToBeatMarkers(
    beats: Beat[],
    downbeats: number[],
  ): TimelineBeatMarker[] {
    const downbeatSet = new Set(downbeats);
    return beats.map((beat) => ({
      time: beat.time,
      strength: beat.strength,
      index: beat.index,
      isDownbeat: downbeatSet.has(beat.time) || beat.index % 4 === 0,
    }));
  }

  generateManualBeatMarkers(
    bpm: number,
    duration: number,
    offset: number = 0,
  ): TimelineBeatMarker[] {
    const beats = this.engine.generateBeatMarkersAtInterval(
      bpm,
      duration,
      offset,
    );
    const beatMarkers: TimelineBeatMarker[] = beats.map((beat) => ({
      time: beat.time,
      strength: beat.strength,
      index: beat.index,
      isDownbeat: beat.index % 4 === 0,
    }));

    const beatAnalysis: TimelineBeatAnalysis = {
      bpm,
      confidence: 1,
      analyzedAt: Date.now(),
    };

    this.updateState({
      beatMarkers,
      beatAnalysis,
    });

    return beatMarkers;
  }

  snapTimeToNearestBeat(time: number): number {
    if (!this.options.snapToBeats || this.state.beatMarkers.length === 0) {
      return time;
    }

    const beats = this.state.beatMarkers.map((bm) => ({
      time: bm.time,
      strength: bm.strength,
      index: bm.index,
    }));

    return this.engine.snapTimeToNearestBeat(
      time,
      beats,
      this.options.snapThreshold,
    );
  }

  getBeatsInRange(startTime: number, endTime: number): TimelineBeatMarker[] {
    return this.state.beatMarkers.filter(
      (bm) => bm.time >= startTime && bm.time <= endTime,
    );
  }

  getNearestBeat(time: number): TimelineBeatMarker | null {
    if (this.state.beatMarkers.length === 0) return null;

    let nearest = this.state.beatMarkers[0];
    let minDist = Math.abs(nearest.time - time);

    for (const beat of this.state.beatMarkers) {
      const dist = Math.abs(beat.time - time);
      if (dist < minDist) {
        minDist = dist;
        nearest = beat;
      }
    }

    return nearest;
  }

  getNextBeat(time: number): TimelineBeatMarker | null {
    for (const beat of this.state.beatMarkers) {
      if (beat.time > time) {
        return beat;
      }
    }
    return null;
  }

  getPreviousBeat(time: number): TimelineBeatMarker | null {
    let prev: TimelineBeatMarker | null = null;
    for (const beat of this.state.beatMarkers) {
      if (beat.time >= time) break;
      prev = beat;
    }
    return prev;
  }

  generateCutPointsForClips(_clips: Clip[], beatsPerCut: number = 4): number[] {
    const cutPoints: number[] = [];
    const downbeats = this.state.beatMarkers.filter((bm) => bm.isDownbeat);

    for (let i = beatsPerCut; i < downbeats.length; i += beatsPerCut) {
      cutPoints.push(downbeats[i].time);
    }

    return cutPoints;
  }

  clearBeatMarkers(): void {
    this.updateState({
      beatMarkers: [],
      beatAnalysis: null,
      error: null,
    });
  }

  setBeatMarkers(
    beatMarkers: TimelineBeatMarker[],
    beatAnalysis: TimelineBeatAnalysis,
  ): void {
    this.updateState({
      beatMarkers,
      beatAnalysis,
    });
  }
}

let beatSyncBridgeInstance: BeatSyncBridge | null = null;

export function getBeatSyncBridge(): BeatSyncBridge {
  if (!beatSyncBridgeInstance) {
    beatSyncBridgeInstance = new BeatSyncBridge();
  }
  return beatSyncBridgeInstance;
}
