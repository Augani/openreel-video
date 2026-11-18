import {
  BeatDetectionProcessor,
  getBeatDetectionProcessor,
  initWasmBeatDetection,
} from "../wasm/beat-detection";

export interface Beat {
  readonly time: number;
  readonly strength: number;
  readonly index: number;
}

export interface BeatAnalysisResult {
  readonly bpm: number;
  readonly confidence: number;
  readonly beats: Beat[];
  readonly duration: number;
  readonly downbeats: number[];
}

interface BeatDetectionConfig {
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly sensitivity: number;
  readonly windowSize: number;
  readonly hopSize: number;
}

const DEFAULT_BEAT_DETECTION_CONFIG: BeatDetectionConfig = {
  minBpm: 60,
  maxBpm: 200,
  sensitivity: 0.5,
  windowSize: 2048,
  hopSize: 512,
};

export class BeatDetectionEngine {
  private config: BeatDetectionConfig;
  private audioContext: AudioContext | OfflineAudioContext | null = null;
  private wasmProcessor: BeatDetectionProcessor;
  private wasmInitialized: boolean = false;

  constructor(config: Partial<BeatDetectionConfig> = {}) {
    this.config = { ...DEFAULT_BEAT_DETECTION_CONFIG, ...config };
    this.wasmProcessor = getBeatDetectionProcessor();
    this.initWasm();
  }

  private async initWasm(): Promise<void> {
    if (this.wasmInitialized) return;
    try {
      await initWasmBeatDetection();
      await this.wasmProcessor.ensureWasm();
      this.wasmInitialized = true;
    } catch {
      this.wasmInitialized = false;
    }
  }

  async analyzeAudioBuffer(
    audioBuffer: AudioBuffer,
  ): Promise<BeatAnalysisResult> {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    const onsets = this.detectOnsets(channelData, sampleRate);
    const { bpm, confidence } = this.calculateBpm(onsets, duration);
    const beats = this.generateBeats(bpm, duration, onsets);
    const downbeats = this.detectDownbeats(beats);

    return {
      bpm,
      confidence,
      beats,
      duration,
      downbeats,
    };
  }

  async analyzeFromBlob(blob: Blob): Promise<BeatAnalysisResult> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.analyzeAudioBuffer(audioBuffer);
  }

  async analyzeFromUrl(url: string): Promise<BeatAnalysisResult> {
    const response = await fetch(url);
    const blob = await response.blob();
    return this.analyzeFromBlob(blob);
  }

  /**
   * Detects onset events (significant energy increases) in audio using RMS energy analysis.
   * Algorithm: Extract RMS energy in windows, smooth for stability, apply adaptive threshold,
   * find peaks (local maxima with sufficient rise), enforce minimum spacing between detections.
   *
   * This is more robust than spectral methods for real-world audio with variable dynamics.
   */
  private detectOnsets(samples: Float32Array, sampleRate: number): number[] {
    const { windowSize, hopSize, sensitivity } = this.config;
    const onsets: number[] = [];

    const numFrames = Math.floor((samples.length - windowSize) / hopSize);
    const energiesF32 = new Float32Array(numFrames);

    this.wasmProcessor.computeRMSEnergies(samples, windowSize, hopSize, energiesF32);

    const smoothedF32 = new Float32Array(numFrames);
    this.wasmProcessor.smoothArray(energiesF32, smoothedF32, 5);

    const smoothedEnergies = Array.from(smoothedF32);
    // Step 3: Compute dynamic threshold based on local statistics and sensitivity
    const threshold = this.calculateAdaptiveThreshold(
      smoothedEnergies,
      sensitivity,
    );

    // Step 4: Detect peaks (onsets) with multiple constraints
    let lastOnsetFrame = -10;
    // Minimum 100ms between onsets to avoid detecting echoes/reverb as separate onsets
    const minFramesBetweenOnsets = Math.floor((sampleRate / hopSize) * 0.1);

    for (let i = 1; i < smoothedEnergies.length - 1; i++) {
      const current = smoothedEnergies[i];
      const prev = smoothedEnergies[i - 1];
      const localThreshold = threshold[i];

      // Must be local maximum in time
      const isLocalMax =
        current > smoothedEnergies[i - 1] && current >= smoothedEnergies[i + 1];
      // Must exceed adaptive threshold at this point
      const isAboveThreshold = current > localThreshold;
      // Must show sufficient energy rise (indicates attack phase, not just high sustained energy)
      const hasRise = current - prev > localThreshold * 0.3;
      // Enforce minimum spacing between detections (prevents duplicate detections)
      const notTooClose = i - lastOnsetFrame >= minFramesBetweenOnsets;

      if (isLocalMax && isAboveThreshold && hasRise && notTooClose) {
        const timeInSeconds = (i * hopSize) / sampleRate;
        onsets.push(timeInSeconds);
        lastOnsetFrame = i;
      }
    }

    return onsets;
  }

  /**
   * Computes per-frame dynamic thresholds using local statistics.
   * Combines median (robust to outliers) and mean (captures overall level).
   * Sensitivity parameter: 0 (strict, few false positives) to 1 (loose, more detections).
   * Local context window accounts for audio dynamics (e.g., quiet intro vs loud chorus).
   */
  private calculateAdaptiveThreshold(
    energies: number[],
    sensitivity: number,
  ): number[] {
    const medianWindowSize = 50;
    const thresholds: number[] = [];

    for (let i = 0; i < energies.length; i++) {
      const start = Math.max(0, i - medianWindowSize);
      const end = Math.min(energies.length, i + medianWindowSize);
      const windowArr = new Float32Array(energies.slice(start, end));

      const median = this.wasmProcessor.calculateMedian(windowArr);
      const mean = this.wasmProcessor.calculateMean(windowArr);

      const threshold = median + (mean - median) * (1 - sensitivity);
      thresholds.push(threshold * (1.5 - sensitivity * 0.5));
    }

    return thresholds;
  }

  private calculateBpm(
    onsets: number[],
    duration: number,
  ): { bpm: number; confidence: number } {
    if (onsets.length < 4) {
      return { bpm: 120, confidence: 0 };
    }

    const intervals: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
      intervals.push(onsets[i] - onsets[i - 1]);
    }

    const { minBpm, maxBpm } = this.config;
    const minInterval = 60 / maxBpm;
    const maxInterval = 60 / minBpm;

    const validIntervals = intervals.filter(
      (i) => i >= minInterval && i <= maxInterval,
    );

    if (validIntervals.length < 3) {
      return { bpm: 120, confidence: 0 };
    }

    const bpmCandidates = new Map<number, number>();
    const bpmResolution = 1;

    for (const interval of validIntervals) {
      const bpm = Math.round(60 / interval / bpmResolution) * bpmResolution;
      if (bpm >= minBpm && bpm <= maxBpm) {
        bpmCandidates.set(bpm, (bpmCandidates.get(bpm) || 0) + 1);
      }

      const doubleBpm =
        Math.round(120 / interval / bpmResolution) * bpmResolution;
      if (doubleBpm >= minBpm && doubleBpm <= maxBpm) {
        bpmCandidates.set(doubleBpm, (bpmCandidates.get(doubleBpm) || 0) + 0.5);
      }

      const halfBpm = Math.round(30 / interval / bpmResolution) * bpmResolution;
      if (halfBpm >= minBpm && halfBpm <= maxBpm) {
        bpmCandidates.set(halfBpm, (bpmCandidates.get(halfBpm) || 0) + 0.3);
      }
    }

    let bestBpm = 120;
    let bestScore = 0;

    for (const [bpm, score] of bpmCandidates) {
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
      }
    }

    const expectedBeats = (duration * bestBpm) / 60;
    const actualBeats = onsets.length;
    const confidence = Math.min(
      1,
      Math.max(0, 1 - Math.abs(expectedBeats - actualBeats) / expectedBeats),
    );

    return { bpm: bestBpm, confidence };
  }

  private generateBeats(
    bpm: number,
    duration: number,
    onsets: number[],
  ): Beat[] {
    const beatInterval = 60 / bpm;
    const beats: Beat[] = [];

    let firstBeatTime = 0;
    if (onsets.length > 0) {
      const firstOnset = onsets[0];
      const offsetBeats = Math.round(firstOnset / beatInterval);
      firstBeatTime = firstOnset - offsetBeats * beatInterval;
      while (firstBeatTime < 0) firstBeatTime += beatInterval;
    }

    let beatIndex = 0;
    for (let time = firstBeatTime; time < duration; time += beatInterval) {
      const nearestOnset = this.findNearestOnset(
        time,
        onsets,
        beatInterval * 0.3,
      );
      const strength = nearestOnset !== null ? 1 : 0.5;

      beats.push({
        time: nearestOnset !== null ? nearestOnset : time,
        strength,
        index: beatIndex,
      });

      beatIndex++;
    }

    return beats;
  }

  private findNearestOnset(
    time: number,
    onsets: number[],
    tolerance: number,
  ): number | null {
    let nearest: number | null = null;
    let minDist = tolerance;

    for (const onset of onsets) {
      const dist = Math.abs(onset - time);
      if (dist < minDist) {
        minDist = dist;
        nearest = onset;
      }
    }

    return nearest;
  }

  private detectDownbeats(beats: Beat[]): number[] {
    if (beats.length < 4) {
      return beats.filter((_, i) => i % 4 === 0).map((b) => b.time);
    }

    const downbeats: number[] = [];
    const strongBeats = beats.filter((b) => b.strength > 0.7);

    if (strongBeats.length > 0) {
      const firstStrong = strongBeats[0];
      const firstIndex = beats.findIndex((b) => b.time === firstStrong.time);

      for (let i = firstIndex; i < beats.length; i += 4) {
        downbeats.push(beats[i].time);
      }
    } else {
      for (let i = 0; i < beats.length; i += 4) {
        downbeats.push(beats[i].time);
      }
    }

    return downbeats;
  }

  generateBeatMarkersAtInterval(
    bpm: number,
    duration: number,
    startTime: number = 0,
    beatsPerBar: number = 4,
  ): Beat[] {
    const beatInterval = 60 / bpm;
    const beats: Beat[] = [];
    let beatIndex = 0;

    for (let time = startTime; time < duration; time += beatInterval) {
      const isDownbeat = beatIndex % beatsPerBar === 0;
      beats.push({
        time,
        strength: isDownbeat ? 1 : 0.7,
        index: beatIndex,
      });
      beatIndex++;
    }

    return beats;
  }

  snapTimeToNearestBeat(
    time: number,
    beats: Beat[],
    snapThreshold: number = 0.1,
  ): number {
    if (beats.length === 0) return time;

    let nearest = beats[0];
    let minDist = Math.abs(beats[0].time - time);

    for (const beat of beats) {
      const dist = Math.abs(beat.time - time);
      if (dist < minDist) {
        minDist = dist;
        nearest = beat;
      }
    }

    return minDist <= snapThreshold ? nearest.time : time;
  }

  getBeatsInRange(beats: Beat[], startTime: number, endTime: number): Beat[] {
    return beats.filter((b) => b.time >= startTime && b.time <= endTime);
  }

  dispose(): void {
    if (this.audioContext && this.audioContext instanceof AudioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

let beatDetectionEngineInstance: BeatDetectionEngine | null = null;

export function getBeatDetectionEngine(): BeatDetectionEngine {
  if (!beatDetectionEngineInstance) {
    beatDetectionEngineInstance = new BeatDetectionEngine();
  }
  return beatDetectionEngineInstance;
}
