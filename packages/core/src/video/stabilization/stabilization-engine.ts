import type { StabilizationProfile, CorrectionTransform, StabilizationConfig } from "./types";
import { DEFAULT_STABILIZATION_CONFIG } from "./types";
import { OpticalFlowCPU } from "../frame-interpolation/optical-flow-cpu";
import { INTERPOLATION_QUALITY_PRESETS } from "../frame-interpolation/types";
import {
  extractDominantMotion,
  accumulateMotionPath,
  smoothPath,
  computeCorrections,
} from "./motion-path";

export class StabilizationEngine {
  private profiles: Map<string, StabilizationProfile> = new Map();
  private flowEngine: OpticalFlowCPU;

  constructor() {
    this.flowEngine = new OpticalFlowCPU(INTERPOLATION_QUALITY_PRESETS.medium);
  }

  hasProfile(clipId: string): boolean {
    return this.profiles.has(clipId);
  }

  async analyzeClip(
    clipId: string,
    videoElement: HTMLVideoElement,
    duration: number,
    config: StabilizationConfig = DEFAULT_STABILIZATION_CONFIG,
    onProgress?: (progress: number) => void,
  ): Promise<StabilizationProfile> {
    const fps = 30;
    const interval = config.analysisInterval;
    const frameCount = Math.ceil((duration * fps) / interval);
    const frameInterval = interval / fps;

    const analysisWidth = Math.min(640, videoElement.videoWidth);
    const analysisHeight = Math.round(
      analysisWidth * (videoElement.videoHeight / videoElement.videoWidth),
    );

    const canvas = document.createElement("canvas");
    canvas.width = analysisWidth;
    canvas.height = analysisHeight;
    const ctx = canvas.getContext("2d")!;

    let prevImageData: ImageData | null = null;
    const samples = [];

    for (let i = 0; i <= frameCount; i++) {
      const time = Math.min(i * frameInterval, duration - 0.001);

      videoElement.currentTime = time;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener("seeked", onSeeked);
          resolve();
        };
        videoElement.addEventListener("seeked", onSeeked);
        setTimeout(resolve, 1000);
      });

      ctx.drawImage(videoElement, 0, 0, analysisWidth, analysisHeight);
      const currentImageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);

      if (prevImageData) {
        const flowField = await this.flowEngine.computeFlowField(
          prevImageData,
          currentImageData,
        );
        const sample = extractDominantMotion(flowField, time);
        samples.push(sample);
      }

      prevImageData = currentImageData;
      onProgress?.(i / frameCount);
    }

    const { cumDx, cumDy, cumRotation } = accumulateMotionPath(samples);

    const smoothedDx = smoothPath(cumDx, config.strength);
    const smoothedDy = smoothPath(cumDy, config.strength);
    const smoothedRotation = smoothPath(cumRotation, config.strength);

    const corrections = computeCorrections(
      cumDx,
      cumDy,
      cumRotation,
      smoothedDx,
      smoothedDy,
      smoothedRotation,
      config.cropMode,
    );

    let maxDisplacement = 0;
    for (const c of corrections) {
      const d = Math.sqrt(c.dx * c.dx + c.dy * c.dy);
      maxDisplacement = Math.max(maxDisplacement, d);
    }

    const profile: StabilizationProfile = {
      clipId,
      samples,
      corrections,
      maxDisplacement,
      frameInterval,
      duration,
    };

    this.profiles.set(clipId, profile);
    return profile;
  }

  getCorrectionTransform(
    clipId: string,
    sourceTime: number,
  ): CorrectionTransform | null {
    const profile = this.profiles.get(clipId);
    if (!profile || profile.corrections.length === 0) return null;

    const frameIndex = sourceTime / profile.frameInterval;
    const idx = Math.min(
      Math.floor(frameIndex),
      profile.corrections.length - 1,
    );
    const nextIdx = Math.min(idx + 1, profile.corrections.length - 1);
    const frac = frameIndex - idx;

    if (idx === nextIdx) return profile.corrections[idx];

    const curr = profile.corrections[idx];
    const next = profile.corrections[nextIdx];

    return {
      dx: curr.dx + (next.dx - curr.dx) * frac,
      dy: curr.dy + (next.dy - curr.dy) * frac,
      rotation: curr.rotation + (next.rotation - curr.rotation) * frac,
      scale: curr.scale + (next.scale - curr.scale) * frac,
    };
  }

  removeProfile(clipId: string): void {
    this.profiles.delete(clipId);
  }

  dispose(): void {
    this.profiles.clear();
  }
}

let stabilizationEngineInstance: StabilizationEngine | null = null;

export function getStabilizationEngine(): StabilizationEngine {
  if (!stabilizationEngineInstance) {
    stabilizationEngineInstance = new StabilizationEngine();
  }
  return stabilizationEngineInstance;
}

export function disposeStabilizationEngine(): void {
  stabilizationEngineInstance?.dispose();
  stabilizationEngineInstance = null;
}
