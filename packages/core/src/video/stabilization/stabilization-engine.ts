import type {
  StabilizationProfile,
  CorrectionTransform,
  StabilizationConfig,
  StabilizationRenderContext,
} from "./types";
import type { Clip, Transform } from "../../types/timeline";
import {
  DEFAULT_STABILIZATION_CONFIG,
  STABILIZATION_ANALYSIS_VERSION,
} from "./types";
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
    this.flowEngine = new OpticalFlowCPU(INTERPOLATION_QUALITY_PRESETS.high);
  }

  hasProfile(clipId: string): boolean {
    return this.profiles.has(clipId);
  }

  setProfile(profile: StabilizationProfile): void {
    this.profiles.set(profile.clipId, profile);
  }

  async analyzeClip(
    clipId: string,
    videoElement: HTMLVideoElement,
    duration: number,
    sourceStartTime: number = 0,
    config: StabilizationConfig = DEFAULT_STABILIZATION_CONFIG,
    onProgress?: (progress: number) => void,
  ): Promise<StabilizationProfile> {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Stabilization analysis requires a positive duration");
    }

    if (!Number.isFinite(sourceStartTime) || sourceStartTime < 0) {
      throw new Error("Stabilization analysis requires a valid source start time");
    }

    if (videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
      throw new Error("Stabilization analysis requires loaded video metadata");
    }

    const fps = 30;
    const interval = Math.max(1, config.analysisInterval);
    const frameCount = Math.max(1, Math.ceil((duration * fps) / interval));
    const frameInterval = interval / fps;
    const maxRelativeTime = Math.max(duration - 0.001, 0);

    const analysisWidth = Math.min(960, videoElement.videoWidth);
    const analysisHeight = Math.round(
      analysisWidth * (videoElement.videoHeight / videoElement.videoWidth),
    );

    const canvas = document.createElement("canvas");
    canvas.width = analysisWidth;
    canvas.height = analysisHeight;
    const ctx = canvas.getContext("2d")!;

    let prevImageData: ImageData | null = null;
    const samples = [];
    const maxSourceTime = Number.isFinite(videoElement.duration)
      ? Math.max(videoElement.duration - 0.001, 0)
      : sourceStartTime + maxRelativeTime;
    const maxMotionPerSample = Math.max(12, analysisWidth * 0.03);

    for (let i = 0; i <= frameCount; i++) {
      const relativeTime = Math.min(i * frameInterval, maxRelativeTime);
      const sourceTime = Math.min(sourceStartTime + relativeTime, maxSourceTime);

      await this.seekVideoFrame(videoElement, sourceTime);

      ctx.drawImage(videoElement, 0, 0, analysisWidth, analysisHeight);
      const currentImageData = ctx.getImageData(0, 0, analysisWidth, analysisHeight);

      if (prevImageData) {
        const flowField = await this.flowEngine.computeFlowField(
          prevImageData,
          currentImageData,
        );
        const sample = this.clampMotionSample(
          extractDominantMotion(flowField, sourceTime),
          maxMotionPerSample,
        );
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
      analysisWidth,
      analysisHeight,
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
      sourceStartTime,
      analysisDimensions: {
        width: analysisWidth,
        height: analysisHeight,
      },
    };

    this.profiles.set(clipId, profile);
    return profile;
  }

  private clampMotionSample(
    sample: StabilizationProfile["samples"][number],
    maxMotionPerSample: number,
  ): StabilizationProfile["samples"][number] {
    const magnitude = Math.hypot(sample.dx, sample.dy);
    if (magnitude <= maxMotionPerSample || magnitude === 0) {
      return sample;
    }

    const scale = maxMotionPerSample / magnitude;
    return {
      ...sample,
      dx: sample.dx * scale,
      dy: sample.dy * scale,
    };
  }

  private async seekVideoFrame(
    videoElement: HTMLVideoElement,
    sourceTime: number,
  ): Promise<void> {
    const maxSourceTime = Number.isFinite(videoElement.duration)
      ? Math.max(videoElement.duration - 0.001, 0)
      : Math.max(sourceTime, 0);
    const clampedTime = Math.max(0, Math.min(sourceTime, maxSourceTime));
    const seekTime =
      clampedTime <= 0 && maxSourceTime > 0.002 ? 0.001 : clampedTime;
    const needsSeek =
      Math.abs(videoElement.currentTime - seekTime) > 0.01 ||
      videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA;

    if (needsSeek) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timeoutId) {
            window.clearTimeout(timeoutId);
          }
          videoElement.removeEventListener("seeked", onSeeked);
          resolve();
        };
        const onSeeked = () => {
          finish();
        };
        const timeoutId = window.setTimeout(finish, 3000);

        videoElement.addEventListener("seeked", onSeeked);
        videoElement.currentTime = seekTime;
      });
    }

    await this.waitForRenderableFrame(videoElement);
  }

  private async waitForRenderableFrame(
    videoElement: HTMLVideoElement,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      let callbackId: number | null = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        if (
          callbackId !== null &&
          typeof videoElement.cancelVideoFrameCallback === "function"
        ) {
          videoElement.cancelVideoFrameCallback(callbackId);
        }
        resolve();
      };

      const timeoutId = window.setTimeout(finish, 250);

      if (typeof videoElement.requestVideoFrameCallback === "function") {
        callbackId = videoElement.requestVideoFrameCallback(() => {
          finish();
        });
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          finish();
        });
      });
    });
  }

  getCorrectionTransform(
    clipId: string,
    sourceTime: number,
    renderContext?: StabilizationRenderContext,
  ): CorrectionTransform | null {
    const profile = this.profiles.get(clipId);
    if (!profile || profile.corrections.length === 0) return null;

    const relativeSourceTime = Math.max(
      0,
      Math.min(sourceTime - profile.sourceStartTime, profile.duration),
    );

    const frameIndex = relativeSourceTime / profile.frameInterval;
    const idx = Math.min(
      Math.floor(frameIndex),
      profile.corrections.length - 1,
    );
    const nextIdx = Math.min(idx + 1, profile.corrections.length - 1);
    const frac = frameIndex - idx;

    const curr = profile.corrections[idx];
    const next = profile.corrections[nextIdx];

    const interpolated = idx === nextIdx
      ? curr
      : {
      dx: curr.dx + (next.dx - curr.dx) * frac,
      dy: curr.dy + (next.dy - curr.dy) * frac,
      rotation: curr.rotation + (next.rotation - curr.rotation) * frac,
      scale: curr.scale + (next.scale - curr.scale) * frac,
      };

    if (!renderContext) {
      return interpolated;
    }

    if (renderContext.sourceWidth <= 0 || renderContext.sourceHeight <= 0) {
      return interpolated;
    }

    const fitScale = Math.min(
      renderContext.canvasWidth / renderContext.sourceWidth,
      renderContext.canvasHeight / renderContext.sourceHeight,
    );
    const renderScaleX =
      (renderContext.sourceWidth / profile.analysisDimensions.width) * fitScale;
    const renderScaleY =
      (renderContext.sourceHeight / profile.analysisDimensions.height) * fitScale;

    return {
      ...interpolated,
      dx: interpolated.dx * renderScaleX,
      dy: interpolated.dy * renderScaleY,
    };
  }

  removeProfile(clipId: string): void {
    this.profiles.delete(clipId);
  }

  dispose(): void {
    this.profiles.clear();
  }
}

export function getStabilizedTransform(
  clip: Clip,
  transform: Transform,
  sourceTime: number,
  renderContext: StabilizationRenderContext,
): Transform {
  if (
    !clip.stabilization?.enabled ||
    !clip.stabilization.analyzed ||
    clip.stabilization.analysisVersion !== STABILIZATION_ANALYSIS_VERSION
  ) {
    return transform;
  }

  const engine = getStabilizationEngine();
  if (!engine.hasProfile(clip.id) && clip.stabilization.profile) {
    engine.setProfile(clip.stabilization.profile);
  }

  const correction = engine.getCorrectionTransform(
    clip.id,
    sourceTime,
    renderContext,
  );
  if (!correction) {
    return transform;
  }

  return {
    ...transform,
    position: {
      x: transform.position.x + correction.dx,
      y: transform.position.y + correction.dy,
    },
    rotation: transform.rotation + (correction.rotation * 180) / Math.PI,
    scale: {
      x: transform.scale.x * correction.scale,
      y: transform.scale.y * correction.scale,
    },
  };
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
