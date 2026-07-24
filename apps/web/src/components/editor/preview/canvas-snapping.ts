export interface CanvasSnapCandidate {
  readonly value: number;
  readonly guide: number;
}

export interface CanvasSnapResult {
  readonly x: number;
  readonly y: number;
  readonly guideX: number | null;
  readonly guideY: number | null;
}

function snapAxis(
  value: number,
  candidates: readonly CanvasSnapCandidate[],
  threshold: number,
): { value: number; guide: number | null } {
  let nearest: CanvasSnapCandidate | null = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.value - value);
    if (distance <= threshold && distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest
    ? { value: nearest.value, guide: nearest.guide }
    : { value, guide: null };
}

export function snapCanvasPosition({
  x,
  y,
  xCandidates,
  yCandidates,
  thresholdX,
  thresholdY,
  enabled = true,
}: {
  x: number;
  y: number;
  xCandidates: readonly CanvasSnapCandidate[];
  yCandidates: readonly CanvasSnapCandidate[];
  thresholdX: number;
  thresholdY: number;
  enabled?: boolean;
}): CanvasSnapResult {
  if (!enabled) return { x, y, guideX: null, guideY: null };
  const snappedX = snapAxis(x, xCandidates, thresholdX);
  const snappedY = snapAxis(y, yCandidates, thresholdY);
  return {
    x: snappedX.value,
    y: snappedY.value,
    guideX: snappedX.guide,
    guideY: snappedY.guide,
  };
}
