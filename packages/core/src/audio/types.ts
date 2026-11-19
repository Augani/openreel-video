import type { AutomationPoint, ClipFade, Effect } from "../types/timeline";

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
  /** Solo Safe: stays audible while other tracks are soloed. */
  readonly soloSafe?: boolean;
  readonly clips: AudioClipRenderInfo[];
}

export interface AudioClipRenderInfo {
  readonly compoundClipId?: string;
  readonly clipId: string;
  readonly mediaId: string;
  readonly sourceTime: number;
  readonly clipOffset: number;
  readonly timelineStartTime: number;
  readonly duration: number;
  readonly clipDuration: number;
  readonly volume: number;
  readonly volumeAutomation: AutomationPoint[];
  readonly pan: number;
  /** Time-varying pan lane (clip-relative seconds, -1..1); overrides `pan` once automated. */
  readonly panAutomation?: AutomationPoint[];
  /** Maintain audio pitch when `speed` != 1 (default true). */
  readonly pitchCorrection?: boolean;
  /** 5.1 sequences only: the clip's resolved surround position (clip, else track). */
  readonly surroundPan?: import("./surround").SurroundPan;
  /** Audio Channels mapping (clip, else the media's import preset); applied to the decoded source before anything else. */
  readonly channelMap?: import("./channel-map").ClipChannelMap;
  readonly effects: Effect[];
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly fadeOrigin?: ClipFade["origin"];
  readonly transitionFadeIn?: number;
  readonly transitionFadeOut?: number;
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
  readonly soloSafe?: boolean;
  readonly peakLevel: number;
  readonly rmsLevel: number;
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
