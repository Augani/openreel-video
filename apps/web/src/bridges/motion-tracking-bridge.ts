import {
  getMotionTrackingEngine,
  type Rectangle,
  type TrackingOptions,
  type TrackingJob,
  type TrackingData,
  type TrackingKeyframe,
  type Point,
} from "@openreel/core";

export interface MotionTrackingState {
  isTracking: boolean;
  progress: number;
  currentJob: TrackingJob | null;
  trackingData: TrackingData | null;
  lostFrames: number[];
  error: string | null;
}

export type MotionTrackingStateListener = (state: MotionTrackingState) => void;

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
  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeLost: (() => void) | null = null;

  constructor() {
    this.unsubscribeProgress = this.engine.onTrackingProgress(
      this.handleProgress,
    );
    this.unsubscribeLost = this.engine.onTrackingLost(this.handleTrackingLost);
  }

  private handleProgress = (progress: number): void => {
    this.updateState({ progress });
  };

  private handleTrackingLost = (frameIndex: number): void => {
    const lostFrames = [...this.currentState.lostFrames, frameIndex];
    this.updateState({ lostFrames });
  };

  private updateState(partial: Partial<MotionTrackingState>): void {
    this.currentState = { ...this.currentState, ...partial };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentState);
    }
  }

  subscribe(listener: MotionTrackingStateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  getState(): MotionTrackingState {
    return this.currentState;
  }

  async startTracking(
    clipId: string,
    region: Rectangle,
    options: TrackingOptions = {},
  ): Promise<TrackingJob> {
    this.updateState({
      isTracking: true,
      progress: 0,
      lostFrames: [],
      error: null,
      trackingData: null,
    });

    try {
      const job = await this.engine.startTracking(clipId, region, options);
      this.updateState({ currentJob: job });

      const pollInterval = setInterval(() => {
        const currentJob = this.engine.getTrackingJob(job.id);
        if (!currentJob) {
          clearInterval(pollInterval);
          return;
        }

        this.updateState({ currentJob, progress: currentJob.progress });

        if (
          currentJob.status === "completed" ||
          currentJob.status === "failed" ||
          currentJob.status === "cancelled"
        ) {
          clearInterval(pollInterval);

          if (currentJob.status === "completed") {
            const allTrackingData = this.engine.getTrackingDataForClip(clipId);
            const latestData =
              allTrackingData.length > 0
                ? allTrackingData[allTrackingData.length - 1]
                : null;

            if (latestData) {
              this.clipTrackingMap.set(clipId, latestData.trackId);
            }

            this.updateState({
              isTracking: false,
              trackingData: latestData,
              currentJob,
            });
          } else if (currentJob.status === "failed") {
            this.updateState({
              isTracking: false,
              error: currentJob.error || "Tracking failed",
              currentJob,
            });
          } else {
            this.updateState({
              isTracking: false,
              currentJob,
            });
          }
        }
      }, 100);

      return job;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.updateState({
        isTracking: false,
        error: errorMessage,
      });
      throw error;
    }
  }

  cancelTracking(jobId: string): void {
    this.engine.cancelTracking(jobId);
    this.updateState({
      isTracking: false,
      progress: 0,
    });
  }

  applyTrackingToElement(
    trackId: string,
    elementId: string,
    offset: Point = { x: 0, y: 0 },
  ): void {
    this.engine.applyTrackingToElement(trackId, elementId, offset);
  }

  applyTrackingToClip(clipId: string, offset: Point = { x: 0, y: 0 }): boolean {
    const trackId = this.clipTrackingMap.get(clipId);
    if (!trackId) {
      console.warn(`No tracking data found for clip ${clipId}`);
      return false;
    }
    try {
      this.applyTrackingToElement(trackId, clipId, offset);
      return true;
    } catch {
      return false;
    }
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

  getTrackingDataForClip(clipId: string): TrackingData[] {
    return this.engine.getTrackingDataForClip(clipId);
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

  removeAttachment(elementId: string): void {
    this.engine.removeTrackingFromElement(elementId);
  }

  hasTrackingData(clipId: string): boolean {
    return this.clipTrackingMap.has(clipId);
  }

  getClipTrackId(clipId: string): string | null {
    return this.clipTrackingMap.get(clipId) || null;
  }

  reset(): void {
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

export function resetMotionTrackingBridge(): void {
  if (motionTrackingBridgeInstance) {
    motionTrackingBridgeInstance.reset();
  }
}
