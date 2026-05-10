import type { FlowField } from "../frame-interpolation/types";
import type { MotionSample, CorrectionTransform } from "./types";

export function extractDominantMotion(
  flowField: FlowField,
  frameTime: number,
): MotionSample {
  const { width, height, vectors } = flowField;
  const totalBlocks = width * height;

  const dxValues: number[] = [];
  const dyValues: number[] = [];

  for (let i = 0; i < totalBlocks; i++) {
    const dx = vectors[i * 2];
    const dy = vectors[i * 2 + 1];
    if (dx !== 0 || dy !== 0) {
      dxValues.push(dx);
      dyValues.push(dy);
    }
  }

  if (dxValues.length === 0) {
    return { time: frameTime, dx: 0, dy: 0, rotation: 0 };
  }

  dxValues.sort((a, b) => a - b);
  dyValues.sort((a, b) => a - b);

  const medianDx = dxValues[Math.floor(dxValues.length / 2)];
  const medianDy = dyValues[Math.floor(dyValues.length / 2)];

  const rotation = estimateRotation(flowField, medianDx, medianDy);

  return { time: frameTime, dx: medianDx, dy: medianDy, rotation };
}

function estimateRotation(
  flowField: FlowField,
  globalDx: number,
  globalDy: number,
): number {
  const { width, height, vectors } = flowField;
  const centerX = width / 2;
  const centerY = height / 2;

  let rotationSum = 0;
  let count = 0;

  for (let by = 0; by < height; by++) {
    for (let bx = 0; bx < width; bx++) {
      const idx = (by * width + bx) * 2;
      const dx = vectors[idx] - globalDx;
      const dy = vectors[idx + 1] - globalDy;

      const rx = bx - centerX;
      const ry = by - centerY;
      const dist = Math.sqrt(rx * rx + ry * ry);

      if (dist < 2) continue;

      const cross = rx * dy - ry * dx;
      rotationSum += cross / (dist * dist);
      count++;
    }
  }

  if (count === 0) return 0;
  return rotationSum / count;
}

export function accumulateMotionPath(samples: MotionSample[]): {
  cumDx: number[];
  cumDy: number[];
  cumRotation: number[];
} {
  const cumDx: number[] = [0];
  const cumDy: number[] = [0];
  const cumRotation: number[] = [0];

  for (let i = 0; i < samples.length; i++) {
    cumDx.push(cumDx[i] + samples[i].dx);
    cumDy.push(cumDy[i] + samples[i].dy);
    cumRotation.push(cumRotation[i] + samples[i].rotation);
  }

  return { cumDx, cumDy, cumRotation };
}

export function smoothPath(
  values: number[],
  strength: number,
): number[] {
  const radius = Math.max(1, Math.round((strength / 100) * 30));
  const kernel = buildGaussianKernel(radius);
  const smoothed: number[] = new Array(values.length);

  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let weightSum = 0;

    for (let k = -radius; k <= radius; k++) {
      const idx = Math.min(Math.max(i + k, 0), values.length - 1);
      const weight = kernel[k + radius];
      sum += values[idx] * weight;
      weightSum += weight;
    }

    smoothed[i] = sum / weightSum;
  }

  return smoothed;
}

function buildGaussianKernel(radius: number): number[] {
  const sigma = radius / 3;
  const kernel: number[] = [];

  for (let i = -radius; i <= radius; i++) {
    kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  }

  return kernel;
}

export function computeCorrections(
  cumDx: number[],
  cumDy: number[],
  cumRotation: number[],
  smoothedDx: number[],
  smoothedDy: number[],
  smoothedRotation: number[],
  cropMode: "auto" | "none",
): CorrectionTransform[] {
  const corrections: CorrectionTransform[] = [];
  let maxDisplacement = 0;

  for (let i = 0; i < cumDx.length; i++) {
    const corrDx = smoothedDx[i] - cumDx[i];
    const corrDy = smoothedDy[i] - cumDy[i];
    const corrRotation = smoothedRotation[i] - cumRotation[i];

    const displacement = Math.sqrt(corrDx * corrDx + corrDy * corrDy);
    maxDisplacement = Math.max(maxDisplacement, displacement);

    corrections.push({
      dx: corrDx,
      dy: corrDy,
      rotation: corrRotation,
      scale: 1,
    });
  }

  if (cropMode === "auto" && maxDisplacement > 0) {
    const scaleFactor = 1 + maxDisplacement * 0.005;
    const clampedScale = Math.min(scaleFactor, 1.15);
    for (const correction of corrections) {
      correction.scale = clampedScale;
    }
  }

  return corrections;
}
