import type { TrackingPixels } from "./motion-frame-tracker";
import { MotionTrackSession, type TrackSessionConfig, type TrackStatus, type TrackStep } from "./motion-track-session";

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
  /**
   * forward: the region is defined at startFrame and tracked up to endFrame.
   * backward: the region is defined at endFrame and tracked down to startFrame.
   */
  direction?: "forward" | "backward";
  /** Scale / rotation the track already has at the anchor frame (re-tracking part of a path). */
  initialScale?: number;
  initialRotation?: number;
}

/** A frame-sequential tracker; runs in a worker or in-thread behind the same interface. */
export interface TrackStepper {
  step(frame: TrackingFrame): Promise<TrackStep>;
  dispose(): void;
}
export type TrackStepperFactory = (config: TrackSessionConfig) => TrackStepper;

export interface TrackingFrame extends TrackingPixels {
  sourceWidth?: number;
  sourceHeight?: number;
}

export type TrackingFrameProvider = (frameIndex: number) => Promise<TrackingFrame | null>;

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
  /** Per-frame state, parallel to keyframes. Absent on older projects. */
  states?: TrackStatus[];
  /** Frames whose point was set by hand (always full confidence). */
  manualFrames?: number[];
  stats?: TrackingStats;
}

export interface TrackingStats {
  frames: number;
  elapsedMs: number;
  framesPerSecond: number;
  /** Time spent waiting for decoded frames vs time the tracker itself was busy. */
  decodeMs: number;
  trackMs: number;
}

interface TrackingAttachment {
  elementId: string;
  trackId: string;
  offset: Point;
  applyScale: boolean;
  applyRotation: boolean;
}

type TrackingProgressCallback = (progress: number) => void;

type TrackingLostCallback = (frameIndex: number) => void;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class MotionTrackingEngine {
  private trackingJobs: Map<string, TrackingJob> = new Map();
  private completions = new Map<string, Promise<TrackingJob>>();
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
    readFrame?: TrackingFrameProvider,
    createStepper?: TrackStepperFactory,
  ): Promise<TrackingJob> {
    if (!readFrame) throw new Error("Tracking requires decoded source frames");
    const frameRate = options.frameRate ?? 30;
    const startFrame = options.startFrame ?? 0, endFrame = options.endFrame ?? 300;
    if (!Number.isFinite(frameRate) || frameRate <= 0 || !Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame < startFrame
      || (options.confidenceThreshold !== undefined && (!Number.isFinite(options.confidenceThreshold) || options.confidenceThreshold <= 0 || options.confidenceThreshold > 1))
      || (options.direction !== undefined && options.direction !== "forward" && options.direction !== "backward")
      || (options.algorithm !== undefined && !["correlation", "feature", "optical-flow"].includes(options.algorithm))
      || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) {
      throw new Error("Tracking requires a valid region and frame range");
    }
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
        direction: options.direction ?? "forward",
        initialScale: options.initialScale ?? 1,
        initialRotation: options.initialRotation ?? 0,
      },
      startTime: Date.now(),
    };

    this.trackingJobs.set(jobId, job);
    this.completions.set(jobId, this.runTracking(job, readFrame, createStepper));

    return job;
  }

  waitForTracking(jobId: string): Promise<TrackingJob> {
    const completion = this.completions.get(jobId);
    if (!completion) return Promise.reject(new Error("Tracking job not found"));
    return completion;
  }

  private async runTracking(job: TrackingJob, readFrame: TrackingFrameProvider, createStepper?: TrackStepperFactory): Promise<TrackingJob> {
    job.status = "running";
    const cancelled = () => !this.trackingJobs.has(job.id) || this.getTrackingJob(job.id)?.status === "cancelled";
    const { startFrame = 0, endFrame = 300, frameRate = 30, confidenceThreshold = .7, algorithm = "correlation", direction = "forward", initialScale = 1, initialRotation = 0 } = job.options;
    const order: number[] = [];
    if (direction === "backward") for (let frame = endFrame; frame >= startFrame; frame--) order.push(frame);
    else for (let frame = startFrame; frame <= endFrame; frame++) order.push(frame);
    const results: Array<{ frame: number; step: TrackStep }> = [];
    const config: TrackSessionConfig = { region: job.region, algorithm, confidenceThreshold, initialScale, initialRotation };
    const stepper: TrackStepper = createStepper ? createStepper(config) : (() => { const session = new MotionTrackSession(config); return { step: (frame: TrackingFrame) => session.step(frame), dispose: () => undefined }; })();
    const began = Date.now();
    let decodeMs = 0, trackMs = 0;
    try {
      // One frame of look-ahead: the next frame decodes while the tracker works on the current one.
      let upcoming: Promise<TrackingFrame | null> | null = readFrame(order[0]);
      for (let index = 0; index < order.length; index++) {
        if (cancelled()) return job;
        const frame = order[index];
        const waitStart = performance.now();
        const pixels = await upcoming;
        decodeMs += performance.now() - waitStart;
        if (cancelled()) return job;
        if (!pixels) throw new Error(`Could not decode tracking frame ${frame}`);
        upcoming = index + 1 < order.length ? readFrame(order[index + 1]) : null;
        // A rejected look-ahead must not surface as unhandled before it is awaited.
        upcoming?.catch(() => undefined);
        const trackStart = performance.now();
        const step = await stepper.step(pixels);
        trackMs += performance.now() - trackStart;
        results.push({ frame, step });
        if (step.lost) this.notifyTrackingLost(frame);
        job.progress = order.length === 1 ? 100 : index / (order.length - 1) * 100;
        this.notifyProgress(job.progress);
        // Decoding is asynchronous; also yield when frames come from a cache.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (cancelled()) return job;
      results.sort((a, b) => a.frame - b.frame);
      const elapsedMs = Math.max(1, Date.now() - began);
      const trackId = generateId("track");
      this.trackingData.set(trackId, {
        trackId, clipId: job.clipId, frameRate, region: { ...job.region },
        keyframes: results.map(({ frame, step }) => ({ frame, position: { ...step.position }, scale: step.scale, rotation: step.rotation })),
        confidence: results.map(({ step }) => step.confidence),
        lostFrames: results.filter(({ step }) => step.lost).map(({ frame }) => frame),
        states: results.map(({ step }) => step.status),
        stats: { frames: results.length, elapsedMs, framesPerSecond: results.length / (elapsedMs / 1000), decodeMs: Math.round(decodeMs), trackMs: Math.round(trackMs) },
      });
      job.status = "completed"; job.progress = 100;
    } catch (error) {
      if (!cancelled()) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Tracking failed";
      }
    } finally {
      stepper.dispose();
      job.endTime = Date.now();
    }
    return job;
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
    for (const job of this.trackingJobs.values()) this.cancelTracking(job.id);
    this.completions.clear();
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
