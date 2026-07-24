export interface OpticalFlowFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array | readonly number[];
}

export interface OpticalFlowPoint {
  readonly x: number;
  readonly y: number;
}

export interface OpticalFlowOptions {
  readonly blockRadius?: number;
  readonly searchRadius?: number;
}

export interface OpticalFlowSample extends OpticalFlowPoint {
  readonly confidence: number;
}

const luminanceAt = (
  frame: OpticalFlowFrame,
  x: number,
  y: number,
): number | null => {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
  const index = (y * frame.width + x) * 4;
  const r = frame.data[index] ?? 0;
  const g = frame.data[index + 1] ?? 0;
  const b = frame.data[index + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

function blockDifference(
  previous: OpticalFlowFrame,
  next: OpticalFlowFrame,
  centerX: number,
  centerY: number,
  offsetX: number,
  offsetY: number,
  blockRadius: number,
): number {
  let total = 0;
  let count = 0;
  for (let dy = -blockRadius; dy <= blockRadius; dy += 1) {
    for (let dx = -blockRadius; dx <= blockRadius; dx += 1) {
      const reference = luminanceAt(previous, centerX + dx, centerY + dy);
      const candidate = luminanceAt(
        next,
        centerX + dx + offsetX,
        centerY + dy + offsetY,
      );
      if (reference === null || candidate === null) {
        return Number.POSITIVE_INFINITY;
      }
      total += Math.abs(reference - candidate);
      count += 1;
    }
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

export function trackOpticalFlowStep(
  previous: OpticalFlowFrame,
  next: OpticalFlowFrame,
  position: OpticalFlowPoint,
  options: OpticalFlowOptions = {},
): OpticalFlowSample {
  const blockRadius = Math.max(1, Math.round(options.blockRadius ?? 6));
  const searchRadius = Math.max(1, Math.round(options.searchRadius ?? 12));
  const centerX = Math.round(position.x);
  const centerY = Math.round(position.y);

  let bestScore = blockDifference(
    previous,
    next,
    centerX,
    centerY,
    0,
    0,
    blockRadius,
  );
  let secondBestScore = Number.POSITIVE_INFINITY;
  let bestOffsetX = 0;
  let bestOffsetY = 0;

  for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 1) {
    for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const score = blockDifference(
        previous,
        next,
        centerX,
        centerY,
        offsetX,
        offsetY,
        blockRadius,
      );
      if (score < bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestOffsetX = offsetX;
        bestOffsetY = offsetY;
      } else if (score < secondBestScore) {
        secondBestScore = score;
      }
    }
  }

  if (!Number.isFinite(bestScore)) {
    return { x: position.x, y: position.y, confidence: 0 };
  }

  const confidence = Number.isFinite(secondBestScore)
    ? clamp01((secondBestScore - bestScore) / (secondBestScore + 1))
    : clamp01(bestScore < 4 ? 1 : 1 - bestScore / 255);

  return {
    x: position.x + bestOffsetX,
    y: position.y + bestOffsetY,
    confidence,
  };
}

export function trackOpticalFlowPath(
  frames: readonly OpticalFlowFrame[],
  startPosition: OpticalFlowPoint,
  options: OpticalFlowOptions = {},
): OpticalFlowSample[] {
  if (frames.length === 0) return [];
  const samples: OpticalFlowSample[] = [
    { x: startPosition.x, y: startPosition.y, confidence: 1 },
  ];
  let current: OpticalFlowPoint = startPosition;
  for (let index = 1; index < frames.length; index += 1) {
    const sample = trackOpticalFlowStep(
      frames[index - 1],
      frames[index],
      current,
      options,
    );
    samples.push(sample);
    current = { x: sample.x, y: sample.y };
  }
  return samples;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
