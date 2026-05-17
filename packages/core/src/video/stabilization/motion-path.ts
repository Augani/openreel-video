import type { FlowField } from "../frame-interpolation/types";
import type { MotionSample, CorrectionTransform } from "./types";

export function extractDominantMotion(
  flowField: FlowField,
  frameTime: number,
): MotionSample {
  const { width, height, vectors } = flowField;
  const totalBlocks = width * height;
  const motionVectors: Array<{ dx: number; dy: number; magnitude: number }> = [];

  for (let i = 0; i < totalBlocks; i++) {
    const dx = vectors[i * 2];
    const dy = vectors[i * 2 + 1];
    if (dx !== 0 || dy !== 0) {
      motionVectors.push({
        dx,
        dy,
        magnitude: Math.hypot(dx, dy),
      });
    }
  }

  if (motionVectors.length === 0) {
    return { time: frameTime, dx: 0, dy: 0, rotation: 0 };
  }

  const dominantMotion = findDominantMotionCluster(motionVectors);
  return {
    time: frameTime,
    dx: dominantMotion.dx,
    dy: dominantMotion.dy,
    rotation: 0,
  };
}

function findDominantMotionCluster(
  motionVectors: Array<{ dx: number; dy: number; magnitude: number }>,
): { dx: number; dy: number } {
  const bins = new Map<
    string,
    {
      qdx: number;
      qdy: number;
      totalDx: number;
      totalDy: number;
      totalMagnitude: number;
      count: number;
    }
  >();

  for (const vector of motionVectors) {
    const qdx = Math.round(vector.dx);
    const qdy = Math.round(vector.dy);
    const key = `${qdx},${qdy}`;
    const bin = bins.get(key) ?? {
      qdx,
      qdy,
      totalDx: 0,
      totalDy: 0,
      totalMagnitude: 0,
      count: 0,
    };

    bin.totalDx += vector.dx;
    bin.totalDy += vector.dy;
    bin.totalMagnitude += vector.magnitude;
    bin.count += 1;
    bins.set(key, bin);
  }

  let bestBin:
    | {
        qdx: number;
        qdy: number;
        totalDx: number;
        totalDy: number;
        totalMagnitude: number;
        count: number;
      }
    | undefined;

  for (const bin of bins.values()) {
    if (
      !bestBin ||
      bin.count > bestBin.count ||
      (bin.count === bestBin.count &&
        bin.totalMagnitude > bestBin.totalMagnitude)
    ) {
      bestBin = bin;
    }
  }

  if (!bestBin) {
    return { dx: 0, dy: 0 };
  }

  let clusteredDx = 0;
  let clusteredDy = 0;
  let clusteredWeight = 0;

  for (const vector of motionVectors) {
    if (
      Math.abs(vector.dx - bestBin.qdx) <= 1 &&
      Math.abs(vector.dy - bestBin.qdy) <= 1
    ) {
      const weight = Math.max(vector.magnitude, 1);
      clusteredDx += vector.dx * weight;
      clusteredDy += vector.dy * weight;
      clusteredWeight += weight;
    }
  }

  if (clusteredWeight === 0) {
    return {
      dx: bestBin.totalDx / bestBin.count,
      dy: bestBin.totalDy / bestBin.count,
    };
  }

  return {
    dx: clusteredDx / clusteredWeight,
    dy: clusteredDy / clusteredWeight,
  };
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
  if (values.length <= 1) {
    return [...values];
  }

  const maxRadius = Math.max(1, Math.floor((values.length - 1) / 2));
  const radius = Math.min(
    maxRadius,
    Math.max(1, Math.round((strength / 100) * 60)),
  );
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
  analysisWidth: number,
  analysisHeight: number,
): CorrectionTransform[] {
  const corrections: CorrectionTransform[] = [];
  let maxAbsDx = 0;
  let maxAbsDy = 0;

  for (let i = 0; i < cumDx.length; i++) {
    const corrDx = smoothedDx[i] - cumDx[i];
    const corrDy = smoothedDy[i] - cumDy[i];
    const corrRotation = smoothedRotation[i] - cumRotation[i];

    maxAbsDx = Math.max(maxAbsDx, Math.abs(corrDx));
    maxAbsDy = Math.max(maxAbsDy, Math.abs(corrDy));

    corrections.push({
      dx: corrDx,
      dy: corrDy,
      rotation: corrRotation,
      scale: 1,
    });
  }

  if (cropMode === "auto" && (maxAbsDx > 0 || maxAbsDy > 0)) {
    const safeWidth = Math.max(analysisWidth - maxAbsDx * 2, 1);
    const safeHeight = Math.max(analysisHeight - maxAbsDy * 2, 1);
    const scaleFactor = Math.max(
      analysisWidth / safeWidth,
      analysisHeight / safeHeight,
    );
    const clampedScale = Math.min(scaleFactor, 1.15);
    for (const correction of corrections) {
      correction.scale = clampedScale;
    }
  }

  return corrections;
}
