import type { Project } from "../types/project";
import type { VideoEngine } from "../video/video-engine";
import type { AudioEngine } from "../audio/audio-engine";
import type { RenderedFrame } from "../video/types";
import type {
  PlaybackConfig,
  PlaybackState,
  PlaybackEvent,
  PlaybackEventListener,
  PlaybackStats,
  FrameRenderResult,
} from "./types";
import { DEFAULT_PLAYBACK_CONFIG } from "./types";
import {
  MasterTimelineClock,
  initializeMasterClock,
  type ClockState,
  type ClockSubscriber,
} from "./master-timeline-clock";
import {
  RealtimeAudioGraph,
  initializeRealtimeAudioGraph,
  type AudioClipSchedule,
} from "../audio/realtime-audio-graph";

export class PlaybackController {
  private videoEngine: VideoEngine | null = null;
  private audioEngine: AudioEngine | null = null;
  private project: Project | null = null;
  private config: PlaybackConfig;

  private masterClock: MasterTimelineClock;
  private clockUnsubscribe: (() => void) | null = null;
  private realtimeAudioGraph: RealtimeAudioGraph;

  private state: PlaybackState = "stopped";
  private playbackRate: number = 1.0;
  private useRealtimeAudio: boolean = true;

  private currentFrame: RenderedFrame | null = null;
  private frameRenderTimes: number[] = [];
  private droppedFrames: number = 0;

  private scrubDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isScrubbing: boolean = false;
  private isRenderingFrame: boolean = false;

  private eventListeners: Map<string, Set<PlaybackEventListener>> = new Map();

  private displayCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private displayCtx:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null = null;

  constructor(config: Partial<PlaybackConfig> = {}) {
    this.config = { ...DEFAULT_PLAYBACK_CONFIG, ...config };
    this.masterClock = initializeMasterClock({
      frameRate: this.config.frameRate,
    });
    this.realtimeAudioGraph = initializeRealtimeAudioGraph(this.masterClock);
  }

  async initialize(
    videoEngine: VideoEngine,
    audioEngine: AudioEngine,
  ): Promise<void> {
    this.videoEngine = videoEngine;
    this.audioEngine = audioEngine;

    this.setupClockSubscription();
  }

  getRealtimeAudioGraph(): RealtimeAudioGraph {
    return this.realtimeAudioGraph;
  }

  private setupClockSubscription(): void {
    if (this.clockUnsubscribe) {
      this.clockUnsubscribe();
    }

    const subscriber: ClockSubscriber = {
      onTimeUpdate: (time: number) => {
        this.handleClockTimeUpdate(time);
      },
      onStateChange: (clockState: ClockState) => {
        this.handleClockStateChange(clockState);
      },
    };

    this.clockUnsubscribe = this.masterClock.subscribe(subscriber);
  }

  private handleClockTimeUpdate(time: number): void {
    if (this.state !== "playing" || this.isRenderingFrame) {
      return;
    }

    if (this.masterClock.shouldSkipFrame()) {
      this.droppedFrames++;
      return;
    }

    if (this.masterClock.shouldRepeatFrame()) {
      this.emitEvent({
        type: "timeupdate",
        time,
        state: this.state,
      });
      return;
    }

    this.renderFrameAtTime(time);

    this.emitEvent({
      type: "timeupdate",
      time,
      state: this.state,
    });
  }

  private handleClockStateChange(clockState: ClockState): void {
    const previousState = this.state;

    if (clockState === "stopped") {
      this.state = "stopped";
      this.stopAudioPlayback();

      if (previousState !== "stopped") {
        this.emitEvent({
          type: "stop",
          time: 0,
          state: this.state,
        });
        this.emitEvent({
          type: "statechange",
          time: 0,
          state: this.state,
        });
      }
    }
  }

  getMasterClock(): MasterTimelineClock {
    return this.masterClock;
  }

  setProject(project: Project): void {
    this.project = project;
    this.state = "stopped";
    this.masterClock.setDuration(project.timeline.duration);
    this.clearAudioBuffer();
  }

  setDisplayCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    this.displayCanvas = canvas;
    this.displayCtx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.masterClock.currentTime;
  }

  getCurrentFrame(): RenderedFrame | null {
    return this.currentFrame;
  }

  isPlaying(): boolean {
    return this.state === "playing";
  }

  getIsScrubbing(): boolean {
    return this.isScrubbing;
  }

  async play(): Promise<void> {
    if (!this.project || !this.videoEngine) {
      throw new Error("PlaybackController not properly initialized");
    }

    if (this.state === "playing") return;

    const duration = this.project.timeline.duration;
    if (this.masterClock.currentTime >= duration) {
      this.masterClock.seek(0);
    }

    this.state = "playing";

    await this.preloadAudioBuffers();
    await this.masterClock.play();
    await this.startAudioPlayback();

    const currentTime = this.masterClock.currentTime;

    this.emitEvent({
      type: "play",
      time: currentTime,
      state: this.state,
    });

    this.emitEvent({
      type: "statechange",
      time: currentTime,
      state: this.state,
    });
  }

  pause(): void {
    if (this.state !== "playing") return;

    this.state = "paused";

    this.masterClock.pause();
    this.stopAudioPlayback();

    const currentTime = this.masterClock.currentTime;

    this.emitEvent({
      type: "pause",
      time: currentTime,
      state: this.state,
    });

    this.emitEvent({
      type: "statechange",
      time: currentTime,
      state: this.state,
    });
  }

  stop(): void {
    const previousState = this.state;
    this.state = "stopped";

    this.masterClock.stop();
    this.stopAudioPlayback();

    this.emitEvent({
      type: "stop",
      time: 0,
      state: this.state,
    });

    if (previousState !== this.state) {
      this.emitEvent({
        type: "statechange",
        time: 0,
        state: this.state,
      });
    }
  }

  async togglePlayback(): Promise<void> {
    if (this.state === "playing") {
      this.pause();
    } else {
      await this.play();
    }
  }

  async seek(time: number): Promise<void> {
    if (!this.project) return;

    const wasPlaying = this.state === "playing";

    const duration = this.project.timeline.duration;
    const clampedTime = Math.max(0, Math.min(time, duration));

    this.masterClock.seek(clampedTime);
    this.realtimeAudioGraph.seekTo(clampedTime);

    if (wasPlaying) {
      this.stopAudioPlayback();
      await this.startAudioPlayback();
    }

    await this.renderFrameAtTime(clampedTime);

    this.emitEvent({
      type: "seek",
      time: clampedTime,
      state: this.state,
    });
  }

  startScrubbing(): void {
    this.isScrubbing = true;

    // Pause playback if playing
    if (this.state === "playing") {
      this.pause();
    }
  }

  async scrubTo(time: number): Promise<FrameRenderResult> {
    if (!this.project || !this.videoEngine) {
      return {
        frame: null,
        renderTime: 0,
        fromCache: false,
        timedOut: false,
      };
    }

    const duration = this.project.timeline.duration;
    const clampedTime = Math.max(0, Math.min(time, duration));

    this.masterClock.seek(clampedTime);
    this.realtimeAudioGraph.seekTo(clampedTime);

    this.emitEvent({
      type: "timeupdate",
      time: clampedTime,
      state: this.state,
    });

    return this.renderFrameWithTimeout(clampedTime);
  }

  endScrubbing(): void {
    this.isScrubbing = false;

    if (this.scrubDebounceTimer) {
      clearTimeout(this.scrubDebounceTimer);
      this.scrubDebounceTimer = null;
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.1, Math.min(4.0, rate));
    this.masterClock.setPlaybackRate(this.playbackRate);
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  getStats(): PlaybackStats {
    const avgRenderTime =
      this.frameRenderTimes.length > 0
        ? this.frameRenderTimes.reduce((a, b) => a + b, 0) /
          this.frameRenderTimes.length
        : 0;

    return {
      currentTime: this.masterClock.currentTime,
      duration: this.project?.timeline.duration ?? 0,
      state: this.state,
      fps: this.calculateFPS(),
      droppedFrames: this.droppedFrames,
      audioBufferHealth: this.calculateAudioBufferHealth(),
      videoBufferHealth: 1.0,
      avgFrameRenderTime: avgRenderTime,
    };
  }

  addEventListener(type: string, listener: PlaybackEventListener): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: PlaybackEventListener): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  dispose(): void {
    this.stop();

    if (this.clockUnsubscribe) {
      this.clockUnsubscribe();
      this.clockUnsubscribe = null;
    }

    this.masterClock.dispose();
    this.realtimeAudioGraph.dispose();
    this.clearAudioBuffer();
    this.eventListeners.clear();
    this.currentFrame?.image.close();
    this.currentFrame = null;
    this.displayCanvas = null;
    this.displayCtx = null;
    this.videoEngine = null;
    this.audioEngine = null;
    this.project = null;
  }

  private async renderFrameAtTime(time: number): Promise<void> {
    if (!this.project || !this.videoEngine || this.isRenderingFrame) return;

    this.isRenderingFrame = true;
    const startTime = performance.now();

    try {
      const frame = await this.videoEngine.renderFrame(this.project, time);

      const renderTime = performance.now() - startTime;
      this.trackFrameRenderTime(renderTime);

      this.masterClock.reportVideoTime(time);

      if (this.currentFrame && this.currentFrame !== frame) {
        this.currentFrame.image.close();
      }
      this.currentFrame = frame;

      this.drawFrameToCanvas(frame);

      this.emitEvent({
        type: "framerendered",
        time,
        state: this.state,
        frame,
      });
    } catch (error) {
      console.error("Frame render error:", error);
      this.droppedFrames++;
    } finally {
      this.isRenderingFrame = false;
    }
  }

  private async renderFrameWithTimeout(
    time: number,
  ): Promise<FrameRenderResult> {
    if (!this.project || !this.videoEngine) {
      return {
        frame: null,
        renderTime: 0,
        fromCache: false,
        timedOut: false,
      };
    }

    const startTime = performance.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Frame render timeout"));
        }, this.config.frameRenderTimeout);
      });

      // Race between render and timeout
      const frame = await Promise.race([
        this.videoEngine.renderFrame(this.project, time),
        timeoutPromise,
      ]);

      const renderTime = performance.now() - startTime;
      this.trackFrameRenderTime(renderTime);
      if (this.currentFrame && this.currentFrame !== frame) {
        this.currentFrame.image.close();
      }
      this.currentFrame = frame;

      // Draw to display canvas
      this.drawFrameToCanvas(frame);

      return {
        frame,
        renderTime,
        fromCache: false, // Could check video engine cache stats
        timedOut: false,
      };
    } catch (error) {
      const renderTime = performance.now() - startTime;

      if (error instanceof Error && error.message === "Frame render timeout") {
        return {
          frame: null,
          renderTime,
          fromCache: false,
          timedOut: true,
        };
      }

      console.error("Frame render error:", error);
      return {
        frame: null,
        renderTime,
        fromCache: false,
        timedOut: false,
      };
    }
  }

  private drawFrameToCanvas(frame: RenderedFrame): void {
    if (!this.displayCanvas || !this.displayCtx) return;

    // Resize canvas if needed
    if (
      this.displayCanvas.width !== frame.width ||
      this.displayCanvas.height !== frame.height
    ) {
      this.displayCanvas.width = frame.width;
      this.displayCanvas.height = frame.height;
    }

    // Draw the frame
    this.displayCtx.drawImage(frame.image, 0, 0);
  }

  private async startAudioPlayback(): Promise<void> {
    if (!this.config.enableAudio || !this.project) {
      return;
    }

    if (this.useRealtimeAudio) {
      await this.realtimeAudioGraph.resume();
      this.setupTracksInAudioGraph();
      this.realtimeAudioGraph.startScheduler((time) =>
        this.getAudioClipsAtTime(time),
      );
    }
  }

  private setupTracksInAudioGraph(): void {
    if (!this.project) return;

    const hasSoloTracks = this.project.timeline.tracks.some((t) => t.solo);

    for (const track of this.project.timeline.tracks) {
      if (track.type !== "audio" && track.type !== "video") continue;

      this.realtimeAudioGraph.createTrack({
        trackId: track.id,
        volume: 1.0,
        pan: 0,
        muted: track.muted,
        solo: track.solo,
        effects: [],
      });

      if (hasSoloTracks) {
        this.realtimeAudioGraph.setTrackSolo(track.id, track.solo);
      }
    }
  }

  private getAudioClipsAtTime(time: number): AudioClipSchedule[] {
    if (!this.project || !this.audioEngine) return [];

    const schedules: AudioClipSchedule[] = [];
    const { timeline, mediaLibrary } = this.project;

    for (const track of timeline.tracks) {
      if (track.type !== "audio" && track.type !== "video") continue;

      for (const clip of track.clips) {
        const clipEnd = clip.startTime + clip.duration;
        if (clipEnd <= time || clip.startTime > time + 1) continue;

        const mediaItem = mediaLibrary.items.find((m) => m.id === clip.mediaId);
        if (!mediaItem?.blob) continue;

        const cachedBuffer = this.getOrDecodeAudioBuffer(mediaItem);
        if (!cachedBuffer) continue;

        schedules.push({
          clipId: clip.id,
          trackId: track.id,
          audioBuffer: cachedBuffer,
          startTime: clip.startTime,
          endTime: clipEnd,
          mediaOffset: clip.inPoint,
          volume: clip.volume,
          pan: 0,
          effects: clip.audioEffects || [],
        });
      }
    }

    return schedules;
  }

  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private audioDecodePromises: Map<string, Promise<AudioBuffer | null>> =
    new Map();

  private async preloadAudioBuffers(): Promise<void> {
    if (!this.project) return;

    const { timeline, mediaLibrary } = this.project;
    const mediaIdsToPreload = new Set<string>();

    for (const track of timeline.tracks) {
      if (track.type !== "audio" && track.type !== "video") continue;

      for (const clip of track.clips) {
        const mediaItem = mediaLibrary.items.find((m) => m.id === clip.mediaId);
        if (mediaItem?.blob && !this.audioBufferCache.has(mediaItem.id)) {
          mediaIdsToPreload.add(mediaItem.id);
        }
      }
    }

    const decodePromises: Promise<AudioBuffer | null>[] = [];

    for (const mediaId of mediaIdsToPreload) {
      const mediaItem = mediaLibrary.items.find((m) => m.id === mediaId);
      if (mediaItem?.blob) {
        decodePromises.push(this.decodeAudioBuffer(mediaItem));
      }
    }

    await Promise.all(decodePromises);
  }

  private async decodeAudioBuffer(mediaItem: {
    id: string;
    blob?: Blob | null;
  }): Promise<AudioBuffer | null> {
    if (this.audioBufferCache.has(mediaItem.id)) {
      return this.audioBufferCache.get(mediaItem.id) || null;
    }

    if (this.audioDecodePromises.has(mediaItem.id)) {
      return this.audioDecodePromises.get(mediaItem.id) || null;
    }

    if (!mediaItem.blob) return null;

    const audioContext = this.masterClock.getAudioContext();

    const decodePromise = mediaItem.blob
      .arrayBuffer()
      .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        this.audioBufferCache.set(mediaItem.id, buffer);
        this.audioDecodePromises.delete(mediaItem.id);
        return buffer;
      })
      .catch(() => {
        this.audioDecodePromises.delete(mediaItem.id);
        return null;
      });

    this.audioDecodePromises.set(mediaItem.id, decodePromise);
    return decodePromise;
  }

  private getOrDecodeAudioBuffer(mediaItem: {
    id: string;
    blob?: Blob | null;
  }): AudioBuffer | null {
    const cached = this.audioBufferCache.get(mediaItem.id);
    if (cached) return cached;

    if (!mediaItem.blob) return null;

    this.decodeAudioBuffer(mediaItem);

    return null;
  }

  private stopAudioPlayback(): void {
    if (this.useRealtimeAudio) {
      this.realtimeAudioGraph.stopScheduler();
    }
  }

  private clearAudioBuffer(): void {
    this.stopAudioPlayback();
    this.audioBufferCache.clear();
  }

  private trackFrameRenderTime(time: number): void {
    this.frameRenderTimes.push(time);

    // Keep only last 60 samples
    if (this.frameRenderTimes.length > 60) {
      this.frameRenderTimes.shift();
    }
  }

  private calculateFPS(): number {
    if (this.frameRenderTimes.length < 2) return 0;

    const avgRenderTime =
      this.frameRenderTimes.reduce((a, b) => a + b, 0) /
      this.frameRenderTimes.length;

    return avgRenderTime > 0 ? 1000 / avgRenderTime : 0;
  }

  private calculateAudioBufferHealth(): number {
    return 1.0;
  }

  private emitEvent(event: PlaybackEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Event listener error:", error);
        }
      }
    }

    // Also emit to 'all' listeners
    const allListeners = this.eventListeners.get("all");
    if (allListeners) {
      for (const listener of allListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("Event listener error:", error);
        }
      }
    }
  }
}
let playbackControllerInstance: PlaybackController | null = null;

export function getPlaybackController(): PlaybackController {
  if (!playbackControllerInstance) {
    playbackControllerInstance = new PlaybackController();
  }
  return playbackControllerInstance;
}

export async function initializePlaybackController(
  videoEngine: VideoEngine,
  audioEngine: AudioEngine,
): Promise<PlaybackController> {
  const controller = getPlaybackController();
  await controller.initialize(videoEngine, audioEngine);
  return controller;
}
