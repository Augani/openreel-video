export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackingOptions {
  frameRate?: number;
  startFrame?: number;
  endFrame?: number;
  algorithm?: "correlation" | "feature" | "optical-flow";
  confidenceThreshold?: number;
}

export type TrackingJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface TrackingJob {
  id: string;
  clipId: string;
  region: Rectangle;
  status: TrackingJobStatus;
  progress: number;
  options: TrackingOptions;
  startTime: number;
  endTime?: number;
  error?: string;
}

export interface TrackingKeyframe {
  frame: number;
  position: Point;
  scale?: number;
  rotation?: number;
}

export interface TrackingData {
  trackId: string;
  clipId: string;
  keyframes: TrackingKeyframe[];
  confidence: number[];
  lostFrames: number[];
  region: Rectangle;
  frameRate: number;
}

export interface TrackingAttachment {
  elementId: string;
  trackId: string;
  offset: Point;
  applyScale: boolean;
  applyRotation: boolean;
}

export type TrackingProgressCallback = (progress: number) => void;

export type TrackingLostCallback = (frameIndex: number) => void;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class MotionTrackingEngine {
  private trackingJobs: Map<string, TrackingJob> = new Map();
  private trackingData: Map<string, TrackingData> = new Map();
  private attachments: Map<string, TrackingAttachment> = new Map();
  private progressCallbacks: Set<TrackingProgressCallback> = new Set();
  private lostCallbacks: Set<TrackingLostCallback> = new Set();

  constructor() {}
  // Tracking Operations
  async startTracking(
    clipId: string,
    region: Rectangle,
    options: TrackingOptions = {},
  ): Promise<TrackingJob> {
    const jobId = generateId("track-job");
    const job: TrackingJob = {
      id: jobId,
      clipId,
      region,
      status: "pending",
      progress: 0,
      options: {
        frameRate: options.frameRate ?? 30,
        startFrame: options.startFrame ?? 0,
        endFrame: options.endFrame ?? 300,
        algorithm: options.algorithm ?? "correlation",
        confidenceThreshold: options.confidenceThreshold ?? 0.7,
      },
      startTime: Date.now(),
    };

    this.trackingJobs.set(jobId, job);
    this.runTracking(job);

    return job;
  }

  private async runTracking(job: TrackingJob): Promise<void> {
    job.status = "running";
    this.trackingJobs.set(job.id, job);

    const { startFrame, endFrame, frameRate, confidenceThreshold } =
      job.options;
    const totalFrames = (endFrame ?? 300) - (startFrame ?? 0);

    const keyframes: TrackingKeyframe[] = [];
    const confidence: number[] = [];
    const lostFrames: number[] = [];

    // Simulate tracking analysis
    // In a real implementation, this would analyze actual video frames
    for (let i = 0; i <= totalFrames; i++) {
      const currentJob = this.trackingJobs.get(job.id);
      if (!currentJob || currentJob.status === "cancelled") {
        return;
      }

      const frame = (startFrame ?? 0) + i;

      // Simulate tracking result with some motion
      // In real implementation, this would use computer vision algorithms
      const trackingResult = this.simulateTracking(job.region, frame, i);

      keyframes.push({
        frame,
        position: trackingResult.position,
        scale: trackingResult.scale,
        rotation: trackingResult.rotation,
      });

      confidence.push(trackingResult.confidence);
      if (trackingResult.confidence < (confidenceThreshold ?? 0.7)) {
        lostFrames.push(frame);
        this.notifyTrackingLost(frame);
      }
      job.progress = (i / totalFrames) * 100;
      this.trackingJobs.set(job.id, job);
      this.notifyProgress(job.progress);

      // Yield to allow cancellation
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const trackId = generateId("track");
    const trackingData: TrackingData = {
      trackId,
      clipId: job.clipId,
      keyframes,
      confidence,
      lostFrames,
      region: job.region,
      frameRate: frameRate ?? 30,
    };

    this.trackingData.set(trackId, trackingData);

    // Complete job
    job.status = "completed";
    job.progress = 100;
    job.endTime = Date.now();
    this.trackingJobs.set(job.id, job);
  }

  private simulateTracking(
    region: Rectangle,
    _frame: number,
    index: number,
  ): {
    position: Point;
    scale: number;
    rotation: number;
    confidence: number;
  } {
    // Simulate smooth motion with some noise
    const baseX = region.x + region.width / 2;
    const baseY = region.y + region.height / 2;
    const motionX = Math.sin(index * 0.1) * 50;
    const motionY = Math.cos(index * 0.15) * 30;
    const noiseX = (Math.random() - 0.5) * 2;
    const noiseY = (Math.random() - 0.5) * 2;

    // Simulate occasional tracking loss
    const confidence = index % 50 === 0 ? 0.5 : 0.85 + Math.random() * 0.15;

    return {
      position: {
        x: baseX + motionX + noiseX,
        y: baseY + motionY + noiseY,
      },
      scale: 1 + Math.sin(index * 0.05) * 0.1,
      rotation: Math.sin(index * 0.02) * 0.1,
      confidence,
    };
  }

  cancelTracking(jobId: string): void {
    const job = this.trackingJobs.get(jobId);
    if (job && job.status === "running") {
      job.status = "cancelled";
      job.endTime = Date.now();
      this.trackingJobs.set(jobId, job);
    }
  }

  getTrackingJob(jobId: string): TrackingJob | undefined {
    return this.trackingJobs.get(jobId);
  }

  getTrackingData(clipId: string, trackId: string): TrackingData | undefined {
    const data = this.trackingData.get(trackId);
    if (data && data.clipId === clipId) {
      return data;
    }
    return undefined;
  }

  getTrackingDataForClip(clipId: string): TrackingData[] {
    return Array.from(this.trackingData.values()).filter(
      (d) => d.clipId === clipId,
    );
  }

  ingestTrackingData(
    clipId: string,
    keyframes: TrackingKeyframe[],
    region: Rectangle,
    frameRate: number,
  ): TrackingData {
    const trackId = generateId("track");
    const trackingData: TrackingData = {
      trackId,
      clipId,
      keyframes,
      confidence: keyframes.map(() => 1),
      lostFrames: [],
      region,
      frameRate: frameRate > 0 ? frameRate : 30,
    };
    this.trackingData.set(trackId, trackingData);
    return trackingData;
  }
  // Tracking Application (Requirement 23.3)
  applyTrackingToElement(
    trackId: string,
    elementId: string,
    offset: Point = { x: 0, y: 0 },
  ): void {
    const trackingData = this.trackingData.get(trackId);
    if (!trackingData) {
      throw new Error(`Tracking data not found: ${trackId}`);
    }

    const attachment: TrackingAttachment = {
      elementId,
      trackId,
      offset,
      applyScale: true,
      applyRotation: true,
    };

    this.attachments.set(elementId, attachment);
  }

  removeTrackingFromElement(elementId: string): void {
    this.attachments.delete(elementId);
  }

  getAttachment(elementId: string): TrackingAttachment | undefined {
    return this.attachments.get(elementId);
  }

  getAttachmentsForTrack(trackId: string): TrackingAttachment[] {
    return Array.from(this.attachments.values()).filter(
      (a) => a.trackId === trackId,
    );
  }

  getElementPositionAtTime(elementId: string, time: number): Point | null {
    const attachment = this.attachments.get(elementId);
    if (!attachment) {
      return null;
    }

    const trackingData = this.trackingData.get(attachment.trackId);
    if (!trackingData) {
      return null;
    }
    const frame = Math.floor(time * trackingData.frameRate);
    const trackedPosition = this.getTrackedPositionAtFrame(trackingData, frame);
    if (!trackedPosition) {
      return null;
    }
    return {
      x: trackedPosition.x + attachment.offset.x,
      y: trackedPosition.y + attachment.offset.y,
    };
  }

  private getTrackedPositionAtFrame(
    data: TrackingData,
    frame: number,
  ): Point | null {
    if (data.keyframes.length === 0) {
      return null;
    }
    let prevKeyframe: TrackingKeyframe | null = null;
    let nextKeyframe: TrackingKeyframe | null = null;

    for (const kf of data.keyframes) {
      if (kf.frame <= frame) {
        prevKeyframe = kf;
      } else if (!nextKeyframe) {
        nextKeyframe = kf;
        break;
      }
    }
    if (!prevKeyframe) {
      return data.keyframes[0].position;
    }
    if (!nextKeyframe || prevKeyframe.frame === frame) {
      return prevKeyframe.position;
    }
    const t =
      (frame - prevKeyframe.frame) / (nextKeyframe.frame - prevKeyframe.frame);

    return {
      x:
        prevKeyframe.position.x +
        (nextKeyframe.position.x - prevKeyframe.position.x) * t,
      y:
        prevKeyframe.position.y +
        (nextKeyframe.position.y - prevKeyframe.position.y) * t,
    };
  }
  // Tracking Lost Notification (Requirement 23.4)
  onTrackingProgress(callback: TrackingProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  onTrackingLost(callback: TrackingLostCallback): () => void {
    this.lostCallbacks.add(callback);
    return () => this.lostCallbacks.delete(callback);
  }

  private notifyProgress(progress: number): void {
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }

  private notifyTrackingLost(frameIndex: number): void {
    for (const callback of this.lostCallbacks) {
      callback(frameIndex);
    }
  }
  // Manual Correction (Requirement 23.4)
  correctTrackingPoint(
    trackId: string,
    frameIndex: number,
    position: Point,
  ): void {
    const data = this.trackingData.get(trackId);
    if (!data) {
      throw new Error(`Tracking data not found: ${trackId}`);
    }
    const keyframeIndex = data.keyframes.findIndex(
      (kf) => kf.frame === frameIndex,
    );

    if (keyframeIndex >= 0) {
      data.keyframes[keyframeIndex].position = position;
      data.confidence[keyframeIndex] = 1.0;
      const lostIndex = data.lostFrames.indexOf(frameIndex);
      if (lostIndex >= 0) {
        data.lostFrames.splice(lostIndex, 1);
      }
    } else {
      const newKeyframe: TrackingKeyframe = {
        frame: frameIndex,
        position,
        scale: 1,
        rotation: 0,
      };
      let insertIndex = data.keyframes.findIndex((kf) => kf.frame > frameIndex);
      if (insertIndex === -1) {
        insertIndex = data.keyframes.length;
      }

      data.keyframes.splice(insertIndex, 0, newKeyframe);
      data.confidence.splice(insertIndex, 0, 1.0);
    }

    this.trackingData.set(trackId, data);
  }
  // Offset Management (Requirement 23.5)
  setTrackingOffset(elementId: string, offset: Point): void {
    const attachment = this.attachments.get(elementId);
    if (attachment) {
      attachment.offset = offset;
      this.attachments.set(elementId, attachment);
    }
  }

  getTrackingOffset(elementId: string): Point | null {
    const attachment = this.attachments.get(elementId);
    return attachment?.offset ?? null;
  }

  setApplyScale(elementId: string, applyScale: boolean): void {
    const attachment = this.attachments.get(elementId);
    if (attachment) {
      attachment.applyScale = applyScale;
      this.attachments.set(elementId, attachment);
    }
  }

  setApplyRotation(elementId: string, applyRotation: boolean): void {
    const attachment = this.attachments.get(elementId);
    if (attachment) {
      attachment.applyRotation = applyRotation;
      this.attachments.set(elementId, attachment);
    }
  }
  deleteTrackingData(trackId: string): void {
    for (const [elementId, attachment] of this.attachments) {
      if (attachment.trackId === trackId) {
        this.attachments.delete(elementId);
      }
    }
    this.trackingData.delete(trackId);
  }

  deleteTrackingDataForClip(clipId: string): void {
    for (const [trackId, data] of this.trackingData) {
      if (data.clipId === clipId) {
        this.deleteTrackingData(trackId);
      }
    }
  }

  clear(): void {
    this.trackingJobs.clear();
    this.trackingData.clear();
    this.attachments.clear();
  }

  getTrackIds(): string[] {
    return Array.from(this.trackingData.keys());
  }

  hasTracking(elementId: string): boolean {
    return this.attachments.has(elementId);
  }
}
let motionTrackingEngineInstance: MotionTrackingEngine | null = null;

export function getMotionTrackingEngine(): MotionTrackingEngine {
  if (!motionTrackingEngineInstance) {
    motionTrackingEngineInstance = new MotionTrackingEngine();
  }
  return motionTrackingEngineInstance;
}

export function initializeMotionTrackingEngine(): MotionTrackingEngine {
  motionTrackingEngineInstance = new MotionTrackingEngine();
  return motionTrackingEngineInstance;
}
