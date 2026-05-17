import type { EasingType } from "../types/timeline";
import { AnimationEngine } from "./animation-engine";

export interface SpeedKeyframe {
  id: string;
  time: number;
  speed: number;
  easing: EasingType;
}

export interface FreezeFrame {
  id: string;
  clipId: string;
  sourceTime: number;
  startTime: number;
  duration: number;
}

export interface ClipSpeedData {
  clipId: string;
  baseSpeed: number;
  reverse: boolean;
  keyframes: SpeedKeyframe[];
  pitchCorrection: boolean;
  freezeFrames: FreezeFrame[];
  originalDuration: number;
}

export const SPEED_MIN = 0.1;
export const SPEED_MAX = 20;

export class SpeedEngine {
  private clipSpeedData: Map<string, ClipSpeedData> = new Map();
  private animationEngine: AnimationEngine;

  constructor(animationEngine?: AnimationEngine) {
    this.animationEngine = animationEngine || new AnimationEngine();
  }
  // Speed Control (Requirement 19.1)
  setClipSpeed(clipId: string, speed: number, originalDuration: number): void {
    const clampedSpeed = this.clampSpeed(speed);
    const data = this.getOrCreateSpeedData(clipId, originalDuration);
    data.baseSpeed = clampedSpeed;
    this.clipSpeedData.set(clipId, data);
  }

  getClipSpeed(clipId: string): number {
    const data = this.clipSpeedData.get(clipId);
    return data?.baseSpeed ?? 1;
  }

  getEffectiveDuration(clipId: string): number {
    const data = this.clipSpeedData.get(clipId);
    if (!data) return 0;
    if (data.keyframes.length > 0) {
      return this.calculateVariableSpeedDuration(data);
    }

    return data.originalDuration / data.baseSpeed;
  }

  private calculateVariableSpeedDuration(data: ClipSpeedData): number {
    const keyframes = [...data.keyframes].sort((a, b) => a.time - b.time);

    if (keyframes.length === 0) {
      return data.originalDuration / data.baseSpeed;
    }

    // Integrate 1/speed over the original duration to get effective duration
    // We use numerical integration with small time steps
    const steps = 1000;
    const dt = data.originalDuration / steps;
    let effectiveDuration = 0;

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      const speed = this.getSpeedAtSourceTime(data, t);
      effectiveDuration += dt / speed;
    }

    return effectiveDuration;
  }

  private clampSpeed(speed: number): number {
    return Math.max(SPEED_MIN, Math.min(SPEED_MAX, speed));
  }
  // Reverse Playback (Requirement 19.2)
  setReverse(
    clipId: string,
    reverse: boolean,
    originalDuration?: number,
  ): void {
    let data = this.clipSpeedData.get(clipId);
    if (!data && originalDuration !== undefined) {
      data = this.getOrCreateSpeedData(clipId, originalDuration);
      this.clipSpeedData.set(clipId, data);
    }
    if (data) {
      data.reverse = reverse;
    } else {
    }
  }

  isReverse(clipId: string): boolean {
    const data = this.clipSpeedData.get(clipId);
    return data?.reverse ?? false;
  }

  getFrameIndexAtTime(
    clipId: string,
    playbackTime: number,
    frameRate: number,
  ): number {
    const sourceTime = this.getSourceTimeAtPlaybackTime(clipId, playbackTime);
    const frameIndex = Math.floor(sourceTime * frameRate);

    return Math.max(0, frameIndex);
  }

  getFrameIndicesInRange(
    clipId: string,
    startTime: number,
    endTime: number,
    frameRate: number,
  ): number[] {
    const frameDuration = 1 / frameRate;
    const frames: number[] = [];

    for (let t = startTime; t < endTime; t += frameDuration) {
      frames.push(this.getFrameIndexAtTime(clipId, t, frameRate));
    }

    return frames;
  }
  // Speed Ramping (Requirement 19.3)
  addSpeedKeyframe(
    clipId: string,
    time: number,
    speed: number,
    easing: EasingType = "linear",
  ): string {
    const data = this.clipSpeedData.get(clipId);
    if (!data) {
      throw new Error(`No speed data for clip ${clipId}`);
    }

    const id = `speed-kf-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
    const keyframe: SpeedKeyframe = {
      id,
      time,
      speed: this.clampSpeed(speed),
      easing,
    };
    const existingIndex = data.keyframes.findIndex(
      (kf) => Math.abs(kf.time - time) < 0.001,
    );

    if (existingIndex >= 0) {
      data.keyframes[existingIndex] = keyframe;
    } else {
      data.keyframes.push(keyframe);
      data.keyframes.sort((a, b) => a.time - b.time);
    }

    return id;
  }

  removeSpeedKeyframe(clipId: string, keyframeId: string): void {
    const data = this.clipSpeedData.get(clipId);
    if (data) {
      data.keyframes = data.keyframes.filter((kf) => kf.id !== keyframeId);
    }
  }

  getSpeedKeyframes(clipId: string): SpeedKeyframe[] {
    const data = this.clipSpeedData.get(clipId);
    return data?.keyframes ?? [];
  }

  getSpeedAtTime(clipId: string, sourceTime: number): number {
    const data = this.clipSpeedData.get(clipId);
    if (!data) return 1;

    return this.getSpeedAtSourceTime(data, sourceTime);
  }

  private getSpeedAtSourceTime(
    data: ClipSpeedData,
    sourceTime: number,
  ): number {
    const keyframes = data.keyframes;

    if (keyframes.length === 0) {
      return data.baseSpeed;
    }

    const sorted = [...keyframes].sort((a, b) => a.time - b.time);

    if (sourceTime <= sorted[0].time) {
      return sorted[0].speed;
    }

    if (sourceTime >= sorted[sorted.length - 1].time) {
      return sorted[sorted.length - 1].speed;
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sourceTime >= sorted[i].time && sourceTime <= sorted[i + 1].time) {
        const kf1 = sorted[i];
        const kf2 = sorted[i + 1];
        const duration = kf2.time - kf1.time;
        const elapsed = sourceTime - kf1.time;
        const linearProgress = duration > 0 ? elapsed / duration : 0;
        const easedProgress = this.animationEngine.applyEasing(
          linearProgress,
          kf1.easing,
        );
        return kf1.speed + (kf2.speed - kf1.speed) * easedProgress;
      }
    }

    return data.baseSpeed;
  }
  // Freeze Frames (Requirement 19.4)
  createFreezeFrame(
    clipId: string,
    sourceTime: number,
    startTime: number,
    duration: number,
  ): FreezeFrame {
    const data = this.clipSpeedData.get(clipId);
    if (!data) {
      throw new Error(`No speed data for clip ${clipId}`);
    }

    const id = `freeze-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 11)}`;
    const freezeFrame: FreezeFrame = {
      id,
      clipId,
      sourceTime,
      startTime,
      duration,
    };

    data.freezeFrames.push(freezeFrame);
    data.freezeFrames.sort((a, b) => a.startTime - b.startTime);

    return freezeFrame;
  }

  removeFreezeFrame(clipId: string, freezeFrameId: string): void {
    const data = this.clipSpeedData.get(clipId);
    if (data) {
      data.freezeFrames = data.freezeFrames.filter(
        (ff) => ff.id !== freezeFrameId,
      );
    }
  }

  getFreezeFrames(clipId: string): FreezeFrame[] {
    const data = this.clipSpeedData.get(clipId);
    return data?.freezeFrames ?? [];
  }

  getFreezeFrameAtTime(
    clipId: string,
    playbackTime: number,
  ): FreezeFrame | null {
    const data = this.clipSpeedData.get(clipId);
    if (!data) return null;

    for (const ff of data.freezeFrames) {
      if (
        playbackTime >= ff.startTime &&
        playbackTime < ff.startTime + ff.duration
      ) {
        return ff;
      }
    }

    return null;
  }

  getSourceTimeAtPlaybackTime(clipId: string, playbackTime: number): number {
    const data = this.clipSpeedData.get(clipId);
    if (!data) return playbackTime;
    const freezeFrame = this.getFreezeFrameAtTime(clipId, playbackTime);
    if (freezeFrame) {
      return freezeFrame.sourceTime;
    }

    let adjustedTime = playbackTime;
    for (const ff of data.freezeFrames) {
      if (ff.startTime + ff.duration <= playbackTime) {
        adjustedTime -= ff.duration;
      } else if (ff.startTime < playbackTime) {
        break;
      }
    }
    if (data.keyframes.length > 0) {
      return this.calculateSourceTimeWithVariableSpeed(data, adjustedTime);
    }

    let sourceTime = adjustedTime * data.baseSpeed;
    if (data.reverse) {
      sourceTime = data.originalDuration - sourceTime;
    }

    return Math.max(0, Math.min(data.originalDuration, sourceTime));
  }

  private calculateSourceTimeWithVariableSpeed(
    data: ClipSpeedData,
    playbackTime: number,
  ): number {
    // Use numerical integration to find source time
    // We use binary search with numerical integration

    const effectiveDuration = this.calculateVariableSpeedDuration(data);

    if (playbackTime <= 0) return 0;
    if (playbackTime >= effectiveDuration) return data.originalDuration;

    let low = 0;
    let high = data.originalDuration;
    const tolerance = 0.0001;

    while (high - low > tolerance) {
      const mid = (low + high) / 2;
      const calculatedPlaybackTime = this.integratePlaybackTime(data, mid);

      if (calculatedPlaybackTime < playbackTime) {
        low = mid;
      } else {
        high = mid;
      }
    }

    let sourceTime = (low + high) / 2;
    if (data.reverse) {
      sourceTime = data.originalDuration - sourceTime;
    }

    return Math.max(0, Math.min(data.originalDuration, sourceTime));
  }

  private integratePlaybackTime(
    data: ClipSpeedData,
    sourceTime: number,
  ): number {
    const steps = Math.max(100, Math.ceil(sourceTime * 100));
    const dt = sourceTime / steps;
    let playbackTime = 0;

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      const speed = this.getSpeedAtSourceTime(data, t);
      playbackTime += dt / speed;
    }

    return playbackTime;
  }
  // Pitch Correction
  setPitchCorrection(clipId: string, enabled: boolean): void {
    const data = this.clipSpeedData.get(clipId);
    if (data) {
      data.pitchCorrection = enabled;
    }
  }

  isPitchCorrectionEnabled(clipId: string): boolean {
    const data = this.clipSpeedData.get(clipId);
    return data?.pitchCorrection ?? true;
  }

  getInterpolationInfo(
    clipId: string,
    playbackTime: number,
    sourceFrameRate: number,
  ): {
    needsInterpolation: boolean;
    frameBefore: number;
    frameAfter: number;
    t: number;
  } {
    const sourceTime = this.getSourceTimeAtPlaybackTime(clipId, playbackTime);
    const frameDuration = 1 / sourceFrameRate;
    const exactFrame = sourceTime / frameDuration;
    const frameBeforeIndex = Math.floor(exactFrame);
    const frameAfterIndex = frameBeforeIndex + 1;
    const t = exactFrame - frameBeforeIndex;

    const needsInterpolation = t > 0.01 && t < 0.99;

    return {
      needsInterpolation,
      frameBefore: frameBeforeIndex * frameDuration,
      frameAfter: frameAfterIndex * frameDuration,
      t,
    };
  }
  private getOrCreateSpeedData(
    clipId: string,
    originalDuration: number,
  ): ClipSpeedData {
    let data = this.clipSpeedData.get(clipId);
    if (!data) {
      data = {
        clipId,
        baseSpeed: 1,
        reverse: false,
        keyframes: [],
        pitchCorrection: true,
        freezeFrames: [],
        originalDuration,
      };
      this.clipSpeedData.set(clipId, data);
    }
    return data;
  }

  initializeClip(clipId: string, originalDuration: number): void {
    this.getOrCreateSpeedData(clipId, originalDuration);
  }

  removeClip(clipId: string): void {
    this.clipSpeedData.delete(clipId);
  }

  getClipIds(): string[] {
    return Array.from(this.clipSpeedData.keys());
  }

  getClipSpeedData(clipId: string): ClipSpeedData | undefined {
    return this.clipSpeedData.get(clipId);
  }

  clear(): void {
    this.clipSpeedData.clear();
  }
}
let speedEngineInstance: SpeedEngine | null = null;

export function getSpeedEngine(): SpeedEngine {
  if (!speedEngineInstance) {
    speedEngineInstance = new SpeedEngine();
  }
  return speedEngineInstance;
}

export function initializeSpeedEngine(
  animationEngine?: AnimationEngine,
): SpeedEngine {
  speedEngineInstance = new SpeedEngine(animationEngine);
  return speedEngineInstance;
}
