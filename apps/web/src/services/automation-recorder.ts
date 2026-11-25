import { create } from "zustand";
import {
  getRealtimeAudioGraph,
  isRecordingMode,
  LaneRecorder,
  rackPan,
  rackVolume,
  trackAutomationMode,
  type TrackAutomationLane,
  type TrackAutomationPass,
} from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";

/**
 * Records mixer fader / pan moves into the track automation lanes during playback (Write, Touch, Latch).
 * Moves are streamed in by the mixer; the whole pass (every track and lane, every loop lap) is committed as ONE
 * undoable `trackAutomation/record` action when playback stops or pauses.
 */

export interface AutomationRecordingState {
  /** Tracks with an open recorder this pass (armed). */
  armed: Record<string, true>;
  /** Tracks whose recorder is writing right now (a held control in Touch, always in Write, latched in Latch). */
  writing: Record<string, true>;
}

export const useAutomationRecording = create<AutomationRecordingState>(() => ({ armed: {}, writing: {} }));

interface TrackRecorders {
  volume: LaneRecorder;
  pan: LaneRecorder;
}

/** A backwards or large forward jump of the playhead is a loop wrap or a seek, not playback. */
const JUMP_BACK = 0.05;
const JUMP_FORWARD = 0.75;

type Graph = ReturnType<typeof getRealtimeAudioGraph>;

class AutomationRecorderService {
  private recorders = new Map<string, TrackRecorders>();
  private touching = new Map<string, { volume: boolean; pan: boolean }>();
  private lastPosition = 0;
  private active = false;
  private graph: Graph | null = null;

  /** The mixer reports a fader / pan move. Starts a touch when the control was not yet held (keyboard, wheel). */
  move(trackId: string, lane: TrackAutomationLane, value: number): void {
    if (!this.recorders.has(trackId)) return;
    const held = this.touching.get(trackId)?.[lane] === true;
    if (!held) this.touch(trackId, lane, value);
    this.recorders.get(trackId)?.[lane].value(this.lastPosition, value);
    this.publish();
  }

  /** The control was grabbed. */
  touch(trackId: string, lane: TrackAutomationLane, value: number): void {
    const recorder = this.recorders.get(trackId)?.[lane];
    if (!recorder) return;
    this.touching.set(trackId, { ...(this.touching.get(trackId) ?? { volume: false, pan: false }), [lane]: true });
    recorder.touch(this.lastPosition, value);
    this.takeOver(trackId, lane, true);
    this.publish();
  }

  /** The control was let go. Returns true when a pass is open for it (so the mixer skips its own rack commit). */
  commit(trackId: string, lane: TrackAutomationLane): boolean {
    const recorder = this.recorders.get(trackId)?.[lane];
    if (!recorder) return false;
    this.touching.set(trackId, { ...(this.touching.get(trackId) ?? { volume: false, pan: false }), [lane]: false });
    recorder.release(this.lastPosition);
    // Touch hands the lane back to the existing curve; Write and Latch keep it.
    if (recorder.mode === "touch") this.takeOver(trackId, lane, false);
    this.publish();
    return true;
  }

  isRecording(trackId: string): boolean {
    return this.recorders.has(trackId);
  }

  private takeOver(trackId: string, lane: TrackAutomationLane, overridden: boolean): void {
    try {
      this.graph?.setTrackLaneOverride(trackId, lane, overridden);
    } catch {
      /* audio unavailable */
    }
  }

  private publish(): void {
    const armed: Record<string, true> = {};
    const writing: Record<string, true> = {};
    for (const [id, pair] of this.recorders) {
      armed[id] = true;
      if (pair.volume.isWriting || pair.pan.isWriting) writing[id] = true;
    }
    useAutomationRecording.setState({ armed, writing });
  }

  begin(position: number): void {
    if (this.active) return;
    const { project } = useProjectStore.getState();
    try {
      this.graph = getRealtimeAudioGraph();
    } catch {
      this.graph = null;
    }
    this.lastPosition = position;
    for (const track of project.timeline.tracks) {
      const mode = trackAutomationMode(track);
      if (!isRecordingMode(mode)) continue;
      // The rack owns the fader / pan value the strip shows (a drag commits it on release).
      const volume = rackVolume(track.audioRack);
      const pan = rackPan(track.audioRack);
      this.recorders.set(track.id, {
        volume: new LaneRecorder("volume", mode, track.automation?.volume, volume, position),
        pan: new LaneRecorder("pan", mode, track.automation?.pan, pan, position),
      });
      this.touching.set(track.id, { volume: false, pan: false });
      // Write takes both lanes over from the start of the pass; Touch / Latch take a lane over when it is grabbed.
      if (mode === "write") {
        this.takeOver(track.id, "volume", true);
        this.takeOver(track.id, "pan", true);
      }
    }
    this.active = this.recorders.size > 0;
    this.publish();
  }

  /** Playhead tick during a pass: extends held values and closes spans across loop wraps and seeks. */
  tick(position: number): void {
    if (!this.active) return;
    const delta = position - this.lastPosition;
    if (delta < -JUMP_BACK || delta > JUMP_FORWARD) {
      for (const pair of this.recorders.values()) {
        pair.volume.jump(this.lastPosition, position);
        pair.pan.jump(this.lastPosition, position);
      }
    } else {
      for (const pair of this.recorders.values()) {
        pair.volume.advance(position);
        pair.pan.advance(position);
      }
    }
    this.lastPosition = position;
  }

  /** Ends the pass: ONE undoable action for everything recorded, then the lanes go back to the graph. */
  async end(position: number): Promise<void> {
    if (!this.active) return;
    this.active = false;
    const passes: TrackAutomationPass[] = [];
    const recorders = this.recorders;
    this.recorders = new Map();
    this.touching = new Map();
    for (const [trackId, pair] of recorders) {
      const volume = pair.volume.finish(position);
      const pan = pair.pan.finish(position);
      if (volume || pan) {
        passes.push({ trackId, lanes: { ...(volume ? { volume } : {}), ...(pan ? { pan } : {}) } });
      }
    }
    try {
      if (passes.length > 0) await useProjectStore.getState().recordTrackAutomation(passes);
    } finally {
      for (const trackId of recorders.keys()) {
        this.takeOver(trackId, "volume", false);
        this.takeOver(trackId, "pan", false);
      }
      this.graph = null;
      this.publish();
    }
  }
}

export const automationRecorder = new AutomationRecorderService();

/** Follows transport state: a pass opens when playback starts and commits when it stops or pauses. */
export function startAutomationRecorder(): () => void {
  let playing = useTimelineStore.getState().playbackState === "playing";
  const unsubscribe = useTimelineStore.subscribe((state) => {
    const nowPlaying = state.playbackState === "playing";
    if (nowPlaying && !playing) automationRecorder.begin(state.playheadPosition);
    else if (nowPlaying) automationRecorder.tick(state.playheadPosition);
    else if (!nowPlaying && playing) void automationRecorder.end(state.playheadPosition);
    playing = nowPlaying;
  });
  if (playing) automationRecorder.begin(useTimelineStore.getState().playheadPosition);
  return () => {
    unsubscribe();
    void automationRecorder.end(useTimelineStore.getState().playheadPosition);
  };
}
