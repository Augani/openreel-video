import type { RenderedFrame } from "../video/types";

export type PlaybackState = "stopped" | "playing" | "paused" | "seeking";

export interface PlaybackConfig {
  readonly frameRate: number;
  readonly audioBufferSize: number;
  readonly frameBufferAhead: number;
  readonly audioLookahead: number;
  readonly frameRenderTimeout: number;
  readonly enableAudio: boolean;
  readonly enableVideo: boolean;
  /**
   * Render a composed frame inside seek()/scrubTo(). A host that presents its own paused frames (the
   * editor's Preview) turns this off: the frame would only be built, kept in `currentFrame` and
   * never drawn, which for a 4K long-GOP clip costs a decode from the previous keyframe plus two
   * 4K bitmaps per seek. The master clock and audio graph are still moved.
   */
  readonly renderStillFrames: boolean;
}

export const DEFAULT_PLAYBACK_CONFIG: PlaybackConfig = {
  frameRate: 30,
  audioBufferSize: 4096,
  frameBufferAhead: 5,
  audioLookahead: 0.1,
  frameRenderTimeout: 100, // 100ms as per requirement 6.3
  enableAudio: true,
  enableVideo: true,
  renderStillFrames: true,
};

export type PlaybackEventType =
  | "play"
  | "pause"
  | "stop"
  | "seek"
  | "timeupdate"
  | "ended"
  | "error"
  | "statechange"
  | "framerendered"
  | "bufferunderrun";

export interface PlaybackEvent {
  readonly type: PlaybackEventType;
  readonly time: number;
  readonly state: PlaybackState;
  readonly error?: Error;
  readonly frame?: RenderedFrame;
}

export type PlaybackEventListener = (event: PlaybackEvent) => void;

export interface PlaybackStats {
  readonly currentTime: number;
  readonly duration: number;
  readonly state: PlaybackState;
  readonly fps: number;
  readonly droppedFrames: number;
  readonly audioBufferHealth: number;
  readonly videoBufferHealth: number;
  readonly avgFrameRenderTime: number;
}

export interface FrameRenderResult {
  readonly frame: RenderedFrame | null;
  readonly renderTime: number;
  readonly fromCache: boolean;
  readonly timedOut: boolean;
}
