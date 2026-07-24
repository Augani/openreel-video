import type { MotionBlurSettings, MotionComposition, MotionLayer } from "./types";
import { DEFAULT_MOTION_BLUR_SETTINGS } from "./types";

export interface MotionBlurSamplePlan {
  readonly enabled: boolean;
  readonly sampleTimes: readonly number[];
  readonly weight: number;
}

export function normalizeMotionBlurSettings(
  settings: MotionBlurSettings | undefined,
): MotionBlurSettings {
  const merged = settings ?? DEFAULT_MOTION_BLUR_SETTINGS;
  return {
    enabled: merged.enabled,
    shutterAngle: clamp(merged.shutterAngle, 0, 720),
    shutterPhase: clamp(merged.shutterPhase, -360, 360),
    samples: Math.round(clamp(merged.samples, 2, 32)),
  };
}

export function getMotionBlurSampleTimes(
  compositionTime: number,
  frameRate: number,
  settings: MotionBlurSettings | undefined,
): readonly number[] {
  const normalized = normalizeMotionBlurSettings(settings);
  if (!normalized.enabled || normalized.shutterAngle <= 0) {
    return [compositionTime];
  }

  const samples = Math.max(2, normalized.samples);
  const frameDuration = 1 / Math.max(1, frameRate);
  const exposureDuration = frameDuration * (normalized.shutterAngle / 360);
  const phaseOffset = frameDuration * (normalized.shutterPhase / 360);
  const startTime = compositionTime + phaseOffset;

  if (samples === 1 || exposureDuration <= 0) {
    return [compositionTime];
  }

  const step = exposureDuration / (samples - 1);
  return Array.from({ length: samples }, (_, index) => startTime + step * index);
}

export function getMotionLayerBlurSamplePlan(
  composition: MotionComposition,
  layer: MotionLayer,
): MotionBlurSamplePlan {
  const settings = normalizeMotionBlurSettings(composition.motionBlur);
  if (!settings.enabled || !layer.motionBlur) {
    return {
      enabled: false,
      sampleTimes: [],
      weight: 1,
    };
  }

  const sampleTimes = getMotionBlurSampleTimes(
    0,
    composition.frameRate,
    settings,
  );
  return {
    enabled: sampleTimes.length > 1,
    sampleTimes,
    weight: sampleTimes.length > 0 ? 1 / sampleTimes.length : 1,
  };
}

export function getMotionBlurSamplePlanAtTime(
  composition: MotionComposition,
  layer: MotionLayer,
  compositionTime: number,
): MotionBlurSamplePlan {
  const settings = normalizeMotionBlurSettings(composition.motionBlur);
  if (!settings.enabled || !layer.motionBlur) {
    return {
      enabled: false,
      sampleTimes: [compositionTime],
      weight: 1,
    };
  }

  const sampleTimes = getMotionBlurSampleTimes(
    compositionTime,
    composition.frameRate,
    settings,
  );
  return {
    enabled: sampleTimes.length > 1,
    sampleTimes,
    weight: sampleTimes.length > 0 ? 1 / sampleTimes.length : 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
