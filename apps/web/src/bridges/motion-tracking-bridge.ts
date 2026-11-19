import {
  getMotionTrackingEngine,
  type Rectangle,
  type TrackingOptions,
  type TrackingJob,
  type TrackingData,
  type TrackingKeyframe,
  type Point,
  mergeTrackingData,
  correctTrackingFrame,
} from "@openreel/core";

import { createMotionTrackingSource } from "../services/motion-tracking-source";
import { createWorkerTrackStepper } from "../services/motion-track-stepper";
import { persistMotionTrackingAnalysis, readMotionTrackingAnalysis, applyMotionTracking, removeMotionTracking, type MotionTrackingApplyOptions } from "../services/motion-tracking-edit";
import { backgroundTasks } from "@openreel/core/tasks/task-registry";
import { useProjectStore } from "../stores/project-store";

export interface MotionTrackingRunOptions extends TrackingOptions {
  /** Frame (clip-local, at project fps) where `region` is defined. Omit for the whole clip from its first frame. */
  anchorFrame?: number;
  /** Merge the result into the existing path instead of replacing it (partial re-track). */
  merge?: boolean;
}

export interface MotionTrackingState {
  isTracking: boolean;
  progress: number;
  currentJob: TrackingJob | null;
  trackingData: TrackingData | null;
  lostFrames: number[];
  error: string | null;
}

type MotionTrackingStateListener = (state: MotionTrackingState) => void;

class MotionTrackingBridge {
  private engine = getMotionTrackingEngine();
  private currentState: MotionTrackingState = {
    isTracking: false,
    progress: 0,
    currentJob: null,
    trackingData: null,
    lostFrames: [],
    error: null,
  };
  private listeners: Set<MotionTrackingStateListener> = new Set();
  private clipTrackingMap: Map<string, string> = new Map();
  private ownerProjectId = "";
  private active: { controller: AbortController; source: ReturnType<typeof createMotionTrackingSource>; job?: TrackingJob } | null = null;
  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeLost: (() => void) | null = null;

  constructor() {
    this.unsubscribeProgress = this.engine.onTrackingProgress(
      this.handleProgress,
    );
    this.unsubscribeLost = this.engine.onTrackingLost(this.handleTrackingLost);
  }

  private lastProgressAt = 0;
  private pendingLostFrames: number[] = [];
  private handleProgress = (progress: number): void => {
    if (!this.active || this.active.controller.signal.aborted) return;
    const now = Date.now();
    if (progress < 100 && now - this.lastProgressAt < 100) return;
    this.lastProgressAt = now;
    this.updateState({ progress, lostFrames: [...this.pendingLostFrames] });
  };

  private handleTrackingLost = (frameIndex: number): void => {
    if (this.active && !this.active.controller.signal.aborted) this.pendingLostFrames.push(frameIndex);
  };

  private taskId: string | null = null;
  private taskClipId: string | null = null;
  private taskTitle = "Motion tracking";

  /** Mirror the run into the unified background-task registry (cancel forwards to cancelTracking). */
  private reportTask(): void {
    const state = this.currentState;
    if (state.isTracking) {
      if (!this.taskId) {
        this.taskId = `tracking:${Date.now()}`;
        const clipId = this.taskClipId;
        const project = useProjectStore.getState();
        const clip = clipId ? project.getClip(clipId) : undefined;
        const media = clip ? project.getMediaItem(clip.mediaId) : undefined;
        this.taskTitle = media ? `Tracking \u00b7 ${media.name}` : "Motion tracking";
      }
      backgroundTasks.upsert(
        { id: this.taskId, kind: "tracking", source: "tracking", title: this.taskTitle, detail: state.lostFrames.length ? `${state.lostFrames.length} frames lost` : "Following the selected region", status: "running", progress: state.progress / 100 },
        { cancel: () => this.cancelTracking() },
      );
    } else if (this.taskId) {
      const id = this.taskId;
      this.taskId = null;
      backgroundTasks.upsert(
        state.error
          ? { id, kind: "tracking", source: "tracking", title: this.taskTitle, status: "failed", error: state.error }
          : { id, kind: "tracking", source: "tracking", title: this.taskTitle, status: state.trackingData ? "completed" : "cancelled", progress: state.trackingData ? 1 : null },
      );
    }
  }

  private updateState(partial: Partial<MotionTrackingState>): void {
    this.currentState = { ...this.currentState, ...partial };
    this.reportTask();
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentState);
    }
  }

  subscribe(listener: MotionTrackingStateListener): () => void {
    this.ensureOwner();
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  getState(): MotionTrackingState {
    this.ensureOwner();
    return this.currentState;
  }

  private ensureOwner(): void {
    const id = useProjectStore.getState().project.id;
    if (this.ownerProjectId === id) return;
    this.ownerProjectId = id;
    this.cancelTracking();
    this.clipTrackingMap.clear();
    this.engine.clear();
    this.currentState = { isTracking: false, progress: 0, currentJob: null, trackingData: null, lostFrames: [], error: null };
  }

  async startTracking(clipId: string, region: Rectangle, options: MotionTrackingRunOptions = {}): Promise<TrackingJob> {
    this.ensureOwner();
    if (this.active) throw new Error("The previous tracking job is still finishing");
    const controller = new AbortController();
    const { anchorFrame, merge, ...trackingOptions } = options;
    const backward = options.direction === "backward";
    const probe = anchorFrame === undefined ? undefined : { startFrame: backward ? 0 : anchorFrame, endFrame: backward ? anchorFrame : Number.MAX_SAFE_INTEGER };
    const source = createMotionTrackingSource(clipId, region, controller.signal, probe);
    const previous = merge ? readMotionTrackingAnalysis(clipId) : null;
    const seed = previous && anchorFrame !== undefined ? previous.data.keyframes.reduce<typeof previous.data.keyframes[number] | null>((best, key) => !best || Math.abs(key.frame - anchorFrame) < Math.abs(best.frame - anchorFrame) ? key : best, null) : null;
    const active: { controller: AbortController; source: ReturnType<typeof createMotionTrackingSource>; job?: TrackingJob } = { controller, source };
    this.active = active;
    this.lastProgressAt = 0; this.pendingLostFrames = [];
    this.taskClipId = clipId;
    this.updateState({ isTracking: true, progress: 0, lostFrames: [], error: null, trackingData: null, currentJob: null });
    try {
      const job = await this.engine.startTracking(clipId, source.region, {
        ...trackingOptions, frameRate: source.frameRate, startFrame: source.startFrame, endFrame: source.endFrame,
        initialScale: seed?.scale ?? 1, initialRotation: seed?.rotation ?? 0,
      }, source.readFrame, createWorkerTrackStepper);
      active.job = job;
      this.updateState({ currentJob: job });
      void this.engine.waitForTracking(job.id).then(async finished => {
        if (controller.signal.aborted || this.active !== active) return;
        if (finished.status === "completed") {
          source.assertCurrent();
          const result = this.engine.getTrackingDataForClip(clipId).at(-1);
          if (!result) throw new Error("Tracking did not produce a path");
          const data = merge ? mergeTrackingData(previous?.data ?? null, result) : result;
          await persistMotionTrackingAnalysis(source.projectId, { version: 1, signature: source.signature, data }, controller.signal, merge ? "Re-track motion" : "Analyze motion tracking");
          if (controller.signal.aborted || this.active !== active) return;
          this.clipTrackingMap.set(clipId, data.trackId);
          this.updateState({ isTracking: false, progress: 100, trackingData: data, lostFrames: data.lostFrames, currentJob: finished });
        } else this.updateState({ isTracking: false, currentJob: finished, error: finished.error ?? null });
      }).catch(error => {
        if (!controller.signal.aborted && this.active === active) this.updateState({ isTracking: false, error: error instanceof Error ? error.message : "Tracking failed" });
      }).finally(() => {
        source.dispose();
        if (this.active === active) this.active = null;
      });
      return job;
    } catch (error) {
      source.dispose(); this.active = null;
      this.updateState({ isTracking: false, error: error instanceof Error ? error.message : "Tracking failed" });
      throw error;
    }
  }

  /** Run a track and resolve once the path is saved to the clip (one undo step). Rejects on failure or cancel. */
  async track(clipId: string, region: Rectangle, options: MotionTrackingRunOptions = {}): Promise<TrackingData> {
    await this.startTracking(clipId, region, options);
    return new Promise<TrackingData>((resolve, reject) => {
      const unsubscribe = this.subscribe(state => {
        if (state.isTracking) return;
        queueMicrotask(() => unsubscribe());
        if (state.error) reject(new Error(state.error));
        else if (state.trackingData) resolve(state.trackingData);
        else reject(new Error("Tracking was cancelled"));
      });
    });
  }

  cancelTracking(jobId?: string): void {
    const active = this.active;
    if (active && (!jobId || active.job?.id === jobId)) {
      active.controller.abort();
      if (active.job) this.engine.cancelTracking(active.job.id);
      active.source.dispose();
    } else if (jobId) this.engine.cancelTracking(jobId);
    this.updateState({ isTracking: false, progress: 0 });
  }

  applyTrackingToElement(
    trackId: string,
    elementId: string,
    offset: Point = { x: 0, y: 0 },
  ): void {
    this.engine.applyTrackingToElement(trackId, elementId, offset);
  }

  async applyTrackingToClip(clipId: string, offset: Point = { x: 0, y: 0 }, targetId = clipId,
    options: Omit<MotionTrackingApplyOptions, "offset"> = { applyScale: true, applyRotation: true, smoothing: 0, mode: "follow" }): Promise<boolean> {
    await applyMotionTracking(clipId, targetId, { ...options, offset });
    return true;
  }

  setTrackingOffset(elementId: string, offset: Point): void {
    this.engine.setTrackingOffset(elementId, offset);
  }

  getTrackingOffset(elementId: string): Point | null {
    return this.engine.getTrackingOffset(elementId);
  }

  setApplyScale(elementId: string, applyScale: boolean): void {
    this.engine.setApplyScale(elementId, applyScale);
  }

  setApplyRotation(elementId: string, applyRotation: boolean): void {
    this.engine.setApplyRotation(elementId, applyRotation);
  }

  getElementPositionAtTime(
    elementId: string,
    timeInSeconds: number,
  ): Point | null {
    return this.engine.getElementPositionAtTime(elementId, timeInSeconds);
  }

  correctTrackingPoint(
    trackId: string,
    frameIndex: number,
    position: Point,
  ): void {
    this.engine.correctTrackingPoint(trackId, frameIndex, position);
  }

  /** Set one tracked point by hand (source pixels). One undo step; anything attached to the path follows. */
  async correctPoint(clipId: string, frame: number, position: Point): Promise<TrackingData> {
    const saved = readMotionTrackingAnalysis(clipId);
    if (!saved) throw new Error("Track the clip before correcting a point");
    const data = correctTrackingFrame(saved.data, frame, position);
    await persistMotionTrackingAnalysis(useProjectStore.getState().project.id, { ...saved, data }, undefined, "Correct tracked point");
    this.updateState({ trackingData: data, lostFrames: data.lostFrames });
    return data;
  }

  getTrackingDataForClip(clipId: string): TrackingData[] {
    this.ensureOwner();
    const saved = readMotionTrackingAnalysis(clipId);
    return saved ? [saved.data] : this.engine.getTrackingDataForClip(clipId);
  }

  ingestTrackingData(
    clipId: string,
    keyframes: TrackingKeyframe[],
    region: Rectangle,
    frameRate: number,
  ): TrackingData {
    return this.engine.ingestTrackingData(clipId, keyframes, region, frameRate);
  }

  getTrackingData(clipId: string, trackId: string): TrackingData | undefined {
    return this.engine.getTrackingData(clipId, trackId);
  }

  async removeAttachment(elementId: string): Promise<void> {
    await removeMotionTracking(elementId);
    this.engine.removeTrackingFromElement(elementId);
  }

  hasTrackingData(clipId: string): boolean {
    this.ensureOwner();
    return this.getTrackingDataForClip(clipId).length > 0;
  }

  getClipTrackId(clipId: string): string | null {
    return this.clipTrackingMap.get(clipId) || null;
  }

  reset(): void {
    this.cancelTracking();
    this.clipTrackingMap.clear();
    this.engine.clear();
    this.updateState({
      isTracking: false,
      progress: 0,
      currentJob: null,
      trackingData: null,
      lostFrames: [],
      error: null,
    });
  }

  dispose(): void {
    this.cancelTracking();
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
    }
    if (this.unsubscribeLost) {
      this.unsubscribeLost();
    }
    this.listeners.clear();
  }
}

let motionTrackingBridgeInstance: MotionTrackingBridge | null = null;

export function getMotionTrackingBridge(): MotionTrackingBridge {
  if (!motionTrackingBridgeInstance) {
    motionTrackingBridgeInstance = new MotionTrackingBridge();
  }
  return motionTrackingBridgeInstance;
}
