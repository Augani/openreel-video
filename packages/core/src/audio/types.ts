import type { Effect } from "../types/timeline";

export interface AudioWaveformData {
  readonly peaks: Float32Array;
  readonly rms: Float32Array;
  readonly sampleRate: number;
  readonly samplesPerPixel: number;
  readonly duration: number;
}

export interface LoudnessMetrics {
  readonly integrated: number; // LUFS
  readonly shortTerm: number; // LUFS
  readonly momentary: number; // LUFS
  readonly truePeak: number; // dBTP
  readonly range: number; // LU
}

export interface TimeRange {
  readonly start: number;
  readonly end: number;
}

export interface AudioTrackRenderInfo {
  readonly trackId: string;
  readonly index: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly clips: AudioClipRenderInfo[];
}

export interface AudioClipRenderInfo {
  readonly clipId: string;
  readonly mediaId: string;
  readonly sourceTime: number;
  readonly timelineStartTime: number;
  readonly duration: number;
  readonly volume: number;
  readonly pan: number;
  readonly effects: Effect[];
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly speed?: number;
  readonly reversed?: boolean;
  /** Zero-based index of the audio track within the source media file to use. */
  readonly audioTrackIndex?: number;
}

export interface AudioChannelState {
  readonly trackId: string;
  readonly volume: number;
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
  readonly peakLevel: number;
  readonly rmsLevel: number;
}

export interface AudioEffectNodeConfig {
  readonly type: string;
  readonly params: Record<string, unknown>;
  readonly enabled: boolean;
}

export interface RenderedAudio {
  readonly buffer: AudioBuffer;
  readonly startTime: number;
  readonly duration: number;
  readonly channels: number;
  readonly sampleRate: number;
}

export interface AudioEngineConfig {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bufferSize: number;
  readonly latencyHint: "interactive" | "balanced" | "playback";
}

export const DEFAULT_AUDIO_CONFIG: AudioEngineConfig = {
  sampleRate: 48000,
  channels: 2,
  bufferSize: 4096,
  latencyHint: "interactive",
};
