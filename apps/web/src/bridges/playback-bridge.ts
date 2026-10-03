import type { PlaybackController, PlaybackEvent } from "@openreel/core";
import { useTimelineStore, type PlaybackState } from "../stores/timeline-store";
import { useEngineStore } from "../stores/engine-store";
import { useProjectStore } from "../stores/project-store";
import { resolvePlaybackLoop, resolvePlaybackStart, type PlaybackLoopRange } from "../utils/playback-loop";

export interface TrackAudibility {
  trackId: string;
  isAudible: boolean;
  isMuted: boolean;
  isSolo: boolean;
}

export class PlaybackBridge {
  private playbackController: PlaybackController | null = null;
  private unsubscribeTimelineStore: (() => void) | null = null;
  private unsubscribePlaybackEvents: (() => void) | null = null;
  private initialized = false;
  private isUpdatingProject = false;
  private unsubscribeLoopState: (() => void) | null = null;
  private unsubscribeClock: (() => void) | null = null;
  private lastClockTime: number | null = null;
  private lastLoopIteration = 0;
  private activeLoop: PlaybackLoopRange | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Get the playback controller from the engine store
    const engineState = useEngineStore.getState();

    if (!engineState.initialized) {
      throw new Error("EngineStore must be initialized before PlaybackBridge");
    }

    this.playbackController = engineState.playbackController;

    if (!this.playbackController) {
      throw new Error("PlaybackController not available in EngineStore");
    }

    // Set up the project in the playback controller
    const projectState = useProjectStore.getState();
    this.playbackController.setProject(projectState.project);

    // Subscribe to playback events from the controller
    this.setupPlaybackEventSubscriptions();

    // Subscribe to project changes to update the playback controller
    this.setupProjectSubscription();
    this.setupLoopSubscription();

    this.initialized = true;
  }

  private syncLoop(): void {
    const controller = this.playbackController;
    if (!controller) return;
    const state = useTimelineStore.getState();
    const duration = useProjectStore.getState().getTimelineDuration();
    const loop = resolvePlaybackLoop(state, duration);
    this.activeLoop = loop;
    const clock = controller.getMasterClock();
    const wasPlaying = clock.isPlaying;
    const currentTime = wasPlaying ? clock.currentTime : state.playheadPosition;
    clock.setLoop(Boolean(loop), loop?.start ?? 0, loop?.end ?? 0);
    if (state.playbackState === "playing" && !state.isScrubbing) {
      const position = loop ? resolvePlaybackStart(currentTime, duration, loop) : currentTime;
      if (wasPlaying || position !== state.playheadPosition) {
        // Reanchor the elapsed clock when changing a loop so disabling it
        // continues from the visible frame rather than the original raw time.
        this.lastClockTime = position;
        this.lastLoopIteration = 0;
        clock.seek(position);
        controller.getRealtimeAudioGraph().seekTo(position);
        state.setPlayheadPosition(position);
      }
    }
  }

  private setupLoopSubscription(): void {
    if (!this.playbackController) return;
    this.syncLoop();
    this.unsubscribeLoopState = useTimelineStore.subscribe(
      (state) => [state.loopEnabled, state.loopStart, state.loopEnd] as const,
      () => this.syncLoop(),
      { equalityFn: (left, right) => left.every((value, index) => value === right[index]) },
    );
    const controller = this.playbackController;
    this.unsubscribeClock = controller.getMasterClock().subscribe({
      onTimeUpdate: (time) => {
        const state = useTimelineStore.getState();
        const iteration = controller.getMasterClock().loopIteration;
        if (this.activeLoop && state.playbackState === "playing" && !state.isScrubbing &&
            (iteration > this.lastLoopIteration ||
              (this.lastClockTime !== null && time < this.lastClockTime - 0.001))) {
          // Audio schedules need a fresh offset when the shared clock wraps.
          controller.getRealtimeAudioGraph().seekTo(time);
          state.setPlayheadPosition(time);
        }
        this.lastClockTime = time;
        this.lastLoopIteration = iteration;
      },
      onStateChange: () => { this.lastClockTime = null; this.lastLoopIteration = 0; },
    });
  }

  /**
   * Set up subscriptions to playback events from the controller
   */
  private setupPlaybackEventSubscriptions(): void {
    if (!this.playbackController) return;

    const handlePlaybackEvent = (event: PlaybackEvent) => {
      const timelineStore = useTimelineStore.getState();

      switch (event.type) {
        case "timeupdate":
          if (!this.isUpdatingProject && !this.playbackController?.getIsScrubbing()) {
            timelineStore.setPlayheadPosition(event.time);
          }
          break;

        case "statechange":
          this.syncPlaybackState(event.state);
          break;

        case "ended":
          // Handle playback end
          timelineStore.pause();
          break;

        case "framerendered":
          // Update current frame in engine store if needed
          if (event.frame) {
            useEngineStore.setState({ currentFrame: event.frame });
          }
          break;
      }
    };

    // Subscribe to all playback events
    this.playbackController.addEventListener("timeupdate", handlePlaybackEvent);
    this.playbackController.addEventListener(
      "statechange",
      handlePlaybackEvent,
    );
    this.playbackController.addEventListener("ended", handlePlaybackEvent);
    this.playbackController.addEventListener(
      "framerendered",
      handlePlaybackEvent,
    );

    // Store cleanup function
    this.unsubscribePlaybackEvents = () => {
      this.playbackController?.removeEventListener(
        "timeupdate",
        handlePlaybackEvent,
      );
      this.playbackController?.removeEventListener(
        "statechange",
        handlePlaybackEvent,
      );
      this.playbackController?.removeEventListener(
        "ended",
        handlePlaybackEvent,
      );
      this.playbackController?.removeEventListener(
        "framerendered",
        handlePlaybackEvent,
      );
    };
  }

  /**
   * Set up subscription to project changes
   */
  private setupProjectSubscription(): void {
    this.unsubscribeTimelineStore = useProjectStore.subscribe(
      (state) => state.project,
      (project) => {
        if (this.playbackController) {
          const timelineStore = useTimelineStore.getState();
          const wasPlaying = timelineStore.playbackState === "playing";
          const duration = useProjectStore.getState().getTimelineDuration();
          const currentTime = wasPlaying ? resolvePlaybackStart(
            timelineStore.playheadPosition,
            duration,
            resolvePlaybackLoop(timelineStore, duration),
          ) : timelineStore.playheadPosition;

          this.isUpdatingProject = true;
          this.playbackController.setProject(project);
          this.isUpdatingProject = false;
          this.syncLoop();

          this.playbackController.scrubTo(currentTime);
          // Explicitly restore position — scrubTo may be blocked by isScrubbing
          timelineStore.setPlayheadPosition(currentTime);
          if (wasPlaying) {
            this.playbackController.play();
          }
        }
      },
    );
  }

  /**
   * Sync playback state from controller to timeline store
   * Note: Core PlaybackState includes "seeking" which maps to "paused" in UI
   */
  private syncPlaybackState(
    controllerState: "stopped" | "playing" | "paused" | "seeking",
  ): void {
    if (this.isUpdatingProject) {
      return;
    }

    if (this.playbackController?.getIsScrubbing()) {
      return;
    }

    const timelineStore = useTimelineStore.getState();
    const currentState = timelineStore.playbackState;

    // Map controller state to timeline store state
    // "seeking" is treated as "paused" in the UI
    const mappedState =
      controllerState === "seeking" ? "paused" : controllerState;

    // Only update if state actually changed
    if (currentState !== mappedState) {
      switch (mappedState) {
        case "playing":
          timelineStore.play();
          break;
        case "paused":
          timelineStore.pause();
          break;
        case "stopped":
          timelineStore.stop();
          break;
      }
    }
  }

  /**
   * Check if the bridge is fully initialized with playback controller
   */
  isReady(): boolean {
    return this.initialized && this.playbackController !== null;
  }

  /**
   * Start playback
   *
   * Start synchronized video and audio playback
   * Feature: core-ui-integration, Property 5: Playback State Transitions
   */
  async play(): Promise<void> {
    if (this.playbackController) {
      const state = useTimelineStore.getState();
      const duration = useProjectStore.getState().getTimelineDuration();
      const loop = resolvePlaybackLoop(state, duration);
      const position = resolvePlaybackStart(state.playheadPosition, duration, loop);
      if (loop && position !== state.playheadPosition) await this.seek(position);
      await this.playbackController.play();
    }
    useTimelineStore.getState().play();
  }

  /**
   * Pause playback
   *
   * Stop playback and display frame at current position
   * Feature: core-ui-integration, Property 5: Playback State Transitions
   */
  pause(): void {
    if (this.playbackController) {
      this.playbackController.pause();
    }
    useTimelineStore.getState().pause();
  }

  /**
   * Stop playback and reset to beginning
   *
   * Feature: core-ui-integration, Property 5: Playback State Transitions
   */
  stop(): void {
    if (this.playbackController) {
      this.playbackController.stop();
    }
    const store = useTimelineStore.getState();
    store.stop();
    store.seekToStart();
  }

  /**
   * Toggle between play and pause
   */
  async togglePlayback(): Promise<void> {
    if (this.playbackController) {
      await this.playbackController.togglePlayback();
    } else {
      useTimelineStore.getState().togglePlayback();
    }
  }

  /**
   * Seek to a specific time
   *
   * Update both video and audio positions synchronously
   * Feature: core-ui-integration, Property 7: Seek Position Synchronization
   */
  async seek(time: number): Promise<void> {
    if (this.playbackController) {
      await this.playbackController.seek(time);
    }
    useTimelineStore.getState().seekTo(time);
  }

  /**
   * Start scrubbing mode
   */
  startScrubbing(): void {
    if (this.playbackController) {
      this.playbackController.startScrubbing();
    }
    useTimelineStore
      .getState()
      .startScrubbing(useTimelineStore.getState().playheadPosition);
  }

  /**
   * Update scrub position
   */
  scrubTo(time: number): void {
    // Keep pointer movement lightweight. Preview already observes the timeline
    // store and renders a debounced scrub frame; seeking the core controller on
    // every mousemove duplicated video rendering and repeatedly touched audio.
    useTimelineStore.getState().updateScrubPosition(time);
  }

  /**
   * End scrubbing mode
   */
  endScrubbing(): void {
    const timelineState = useTimelineStore.getState();
    const finalPosition =
      timelineState.scrubPosition ?? timelineState.playheadPosition;
    if (this.playbackController) {
      // Synchronize the master clock/audio once at the final drag position.
      void this.playbackController.scrubTo(finalPosition);
      this.playbackController.endScrubbing();
    }
    timelineState.endScrubbing();
  }

  /**
   * Set playback rate
   */
  setPlaybackRate(rate: number): void {
    if (this.playbackController) {
      this.playbackController.setPlaybackRate(rate);
    }
    useTimelineStore.getState().setPlaybackRate(rate);
  }

  // ============================================
  // Track Mute/Solo Handling
  // Feature: core-ui-integration
  // Property 8: Track Mute Exclusion
  // Property 9: Track Solo Behavior
  // ============================================

  /**
   * Check if a track is audible based on mute/solo state
   *
   * Muted tracks excluded from audio mix
   * Solo tracks mute all non-soloed tracks
   * Feature: core-ui-integration, Property 8: Track Mute Exclusion
   * Feature: core-ui-integration, Property 9: Track Solo Behavior
   *
   * @param track - The track to check
   * @param hasSoloTracks - Whether any track in the timeline has solo enabled
   * @returns true if the track should be audible
   */
  isTrackAudible(
    track: { muted: boolean; solo: boolean },
    hasSoloTracks: boolean,
  ): boolean {
    // If track is explicitly muted, it's not audible (Requirement 2.5)
    if (track.muted) {
      return false;
    }

    // If any track has solo enabled, only soloed tracks are audible (Requirement 2.6)
    if (hasSoloTracks && !track.solo) {
      return false;
    }

    return true;
  }

  /**
   * Get the effective audibility of all tracks considering mute/solo
   *
   * Muted tracks excluded from audio mix
   * Solo tracks mute all non-soloed tracks
   * Feature: core-ui-integration, Property 8: Track Mute Exclusion
   * Feature: core-ui-integration, Property 9: Track Solo Behavior
   *
   * @param tracks - Array of tracks to evaluate
   * @returns Array of TrackAudibility objects
   */
  getTrackAudibility(
    tracks: Array<{ id: string; muted: boolean; solo: boolean }>,
  ): TrackAudibility[] {
    const hasSoloTracks = tracks.some((t) => t.solo);

    return tracks.map((track) => ({
      trackId: track.id,
      isAudible: this.isTrackAudible(track, hasSoloTracks),
      isMuted: track.muted,
      isSolo: track.solo,
    }));
  }

  /**
   * Get audible track IDs from the current project
   *
   * Handle mute/solo for audio mixing
   * Feature: core-ui-integration, Property 8, Property 9
   *
   * @returns Set of track IDs that should be included in the audio mix
   */
  getAudibleTrackIds(): Set<string> {
    const projectState = useProjectStore.getState();
    const tracks = projectState.project.timeline.tracks;

    const audibility = this.getTrackAudibility(tracks);
    const audibleIds = new Set<string>();

    for (const track of audibility) {
      if (track.isAudible) {
        audibleIds.add(track.trackId);
      }
    }

    return audibleIds;
  }

  /**
   * Check if any track has solo enabled
   *
   * @returns true if at least one track has solo enabled
   */
  hasSoloTracks(): boolean {
    const projectState = useProjectStore.getState();
    const tracks = projectState.project.timeline.tracks;
    return tracks.some((t) => t.solo);
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    return useTimelineStore.getState().playbackState;
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    if (this.playbackController) {
      return this.playbackController.getCurrentTime();
    }
    return useTimelineStore.getState().playheadPosition;
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.playbackController?.isPlaying() ?? false;
  }

  /**
   * Check if currently scrubbing
   */
  isScrubbing(): boolean {
    return this.playbackController?.getIsScrubbing() ?? false;
  }

  /**
   * Get playback statistics
   */
  getStats() {
    return this.playbackController?.getStats() ?? null;
  }

  /**
   * Dispose of the playback bridge and clean up subscriptions
   */
  dispose(): void {
    this.unsubscribeLoopState?.();
    this.unsubscribeLoopState = null;
    this.unsubscribeClock?.();
    this.unsubscribeClock = null;
    this.playbackController?.getMasterClock().setLoop(false);
    this.lastClockTime = null;
    this.lastLoopIteration = 0;
    this.activeLoop = null;
    // Unsubscribe from playback events
    if (this.unsubscribePlaybackEvents) {
      this.unsubscribePlaybackEvents();
      this.unsubscribePlaybackEvents = null;
    }

    // Unsubscribe from timeline store
    if (this.unsubscribeTimelineStore) {
      this.unsubscribeTimelineStore();
      this.unsubscribeTimelineStore = null;
    }

    this.playbackController = null;
    this.initialized = false;
  }
}

// Singleton instance
let playbackBridgeInstance: PlaybackBridge | null = null;

/**
 * Get the shared PlaybackBridge instance
 */
export function getPlaybackBridge(): PlaybackBridge {
  if (!playbackBridgeInstance) {
    playbackBridgeInstance = new PlaybackBridge();
  }
  return playbackBridgeInstance;
}

/**
 * Initialize the shared PlaybackBridge
 */
export async function initializePlaybackBridge(): Promise<PlaybackBridge> {
  const bridge = getPlaybackBridge();
  await bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared PlaybackBridge
 */
export function disposePlaybackBridge(): void {
  if (playbackBridgeInstance) {
    playbackBridgeInstance.dispose();
    playbackBridgeInstance = null;
  }
}
