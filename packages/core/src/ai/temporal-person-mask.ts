export interface MaskCentroid {
  x: number;
  y: number;
  weight: number;
}

export interface TemporalPersonMaskState {
  values: Float32Array;
  width: number;
  height: number;
  centroid: MaskCentroid | null;
}

const FOREGROUND_FLOOR = 0.15;
const MAX_FRAME_TRANSLATION = 0.18;

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value));

function measureCentroid(
  values: Float32Array,
  width: number,
  height: number,
): MaskCentroid | null {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const confidence = Math.max(0, values[row + x] - FOREGROUND_FLOOR);
      weightedX += x * confidence;
      weightedY += y * confidence;
      weight += confidence;
    }
  }

  if (weight < width * height * 0.001) return null;
  return { x: weightedX / weight, y: weightedY / weight, weight };
}

/**
 * Stabilize a person confidence mask without making a moving subject lag.
 *
 * The previous mask is first translated by the foreground centroid movement.
 * Rising confidence is taken immediately so newly occupied pixels occlude on
 * the same inference. Pixels the model now reads as decisive background are
 * released immediately so an old arm or leg does not remain as an oversized
 * trailing silhouette. Only uncertain edge confidence is lightly damped.
 */
export function stabilizePersonMask(
  currentValues: Float32Array,
  width: number,
  height: number,
  previous: TemporalPersonMaskState | null,
): TemporalPersonMaskState {
  const current = new Float32Array(currentValues.length);
  for (let i = 0; i < currentValues.length; i++) {
    current[i] = clamp01(currentValues[i]);
  }

  const centroid = measureCentroid(current, width, height);
  if (
    !previous ||
    previous.width !== width ||
    previous.height !== height ||
    previous.values.length !== current.length
  ) {
    return { values: current, width, height, centroid };
  }

  let offsetX = 0;
  let offsetY = 0;
  if (centroid && previous.centroid) {
    const rawOffsetX = Math.round(centroid.x - previous.centroid.x);
    const rawOffsetY = Math.round(centroid.y - previous.centroid.y);
    const maxOffsetX = Math.max(2, Math.round(width * MAX_FRAME_TRANSLATION));
    const maxOffsetY = Math.max(2, Math.round(height * MAX_FRAME_TRANSLATION));

    // A larger jump is a cut/seek or a different subject. Starting from the
    // current mask avoids dragging the old silhouette across the new frame.
    if (
      Math.abs(rawOffsetX) > maxOffsetX ||
      Math.abs(rawOffsetY) > maxOffsetY
    ) {
      return { values: current, width, height, centroid };
    }
    offsetX = rawOffsetX;
    offsetY = rawOffsetY;
  }

  const stabilized = new Float32Array(current.length);
  for (let y = 0; y < height; y++) {
    const previousY = y - offsetY;
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const previousX = x - offsetX;
      const prior =
        previousX >= 0 &&
        previousX < width &&
        previousY >= 0 &&
        previousY < height
          ? previous.values[previousY * width + previousX]
          : 0;
      const value = current[index];
      const difference = value - prior;

      if (Math.abs(difference) <= 0.04) {
        stabilized[index] = prior + difference * 0.55;
      } else if (difference > 0 || value <= 0.2) {
        stabilized[index] = value;
      } else {
        stabilized[index] = prior + difference * 0.85;
      }
    }
  }

  return {
    values: stabilized,
    width,
    height,
    centroid: measureCentroid(stabilized, width, height),
  };
}

/**
 * Returns the stabilized matte without moving or enlarging the silhouette.
 */
export function createProtectivePersonMask(
  current: TemporalPersonMaskState,
  _previous: TemporalPersonMaskState | null,
): Float32Array {
  return new Float32Array(current.values);
}

/**
 * Smooths a coarse model mask while respecting strong color boundaries in the
 * source frame. This reduces stair-stepping without bleeding the matte across
 * a contrasting background.
 */
export function refinePersonMaskEdges(
  values: Float32Array,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
): Float32Array {
  if (
    values.length !== width * height ||
    rgba.length !== sourceWidth * sourceHeight * 4
  ) {
    return new Float32Array(values);
  }

  const refined = new Float32Array(values.length);
  const radius = 2;
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((y + 0.5) * sourceHeight) / height),
    );
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((x + 0.5) * sourceWidth) / width),
      );
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4;
      const centerR = rgba[sourceIndex];
      const centerG = rgba[sourceIndex + 1];
      const centerB = rgba[sourceIndex + 2];
      let weightedMask = 0;
      let totalWeight = 0;

      for (let offsetY = -radius; offsetY <= radius; offsetY++) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offsetY));
        const sampleSourceY = Math.min(
          sourceHeight - 1,
          Math.floor(((sampleY + 0.5) * sourceHeight) / height),
        );
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          const sampleX = Math.max(0, Math.min(width - 1, x + offsetX));
          const sampleSourceX = Math.min(
            sourceWidth - 1,
            Math.floor(((sampleX + 0.5) * sourceWidth) / width),
          );
          const sampleSourceIndex =
            (sampleSourceY * sourceWidth + sampleSourceX) * 4;
          const deltaR = rgba[sampleSourceIndex] - centerR;
          const deltaG = rgba[sampleSourceIndex + 1] - centerG;
          const deltaB = rgba[sampleSourceIndex + 2] - centerB;
          const colorDistance =
            deltaR * deltaR + deltaG * deltaG + deltaB * deltaB;
          const spatialWeight =
            1 / (1 + offsetX * offsetX + offsetY * offsetY);
          const colorWeight = 1 / (1 + colorDistance / 1800);
          const weight = spatialWeight * colorWeight;
          weightedMask += values[sampleY * width + sampleX] * weight;
          totalWeight += weight;
        }
      }
      refined[y * width + x] = totalWeight > 0
        ? weightedMask / totalWeight
        : values[y * width + x];
    }
  }
  return refined;
}

/**
 * Converts confidence to a coverage-first occlusion alpha.
 *
 * This curve does not grow the silhouette. It only makes likely foreground
 * opaque soon enough that text cannot bleed through lower-confidence moving
 * limbs while retaining a short antialiased transition at the model edge.
 */
export function shapePersonMaskAlpha(
  values: Float32Array,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(values.length);
  const low = 0.28;
  const high = 0.52;
  for (let index = 0; index < values.length; index++) {
    const normalized = clamp01((values[index] - low) / (high - low));
    const shaped = 1 - (1 - normalized) * (1 - normalized);
    alpha[index] = Math.round(shaped * 255);
  }
  return alpha;
}

const FLOW_SAMPLE_ALPHA = 96;
const LOCAL_FLOW_RADIUS = 8;

interface OcclusionFlow {
  x: number;
  y: number;
}

interface FlowSample {
  x: number;
  y: number;
}

function maskAlphaAtReference(
  maskRgba: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  referenceWidth: number,
  referenceHeight: number,
  x: number,
  y: number,
): number {
  const maskX = Math.max(
    0,
    Math.min(maskWidth - 1, Math.floor((x * maskWidth) / referenceWidth)),
  );
  const maskY = Math.max(
    0,
    Math.min(maskHeight - 1, Math.floor((y * maskHeight) / referenceHeight)),
  );
  return maskRgba[(maskY * maskWidth + maskX) * 4 + 3];
}

function scoreFlowOffset(
  referenceRgba: Uint8ClampedArray,
  currentRgba: Uint8ClampedArray,
  width: number,
  height: number,
  samples: readonly FlowSample[],
  offsetX: number,
  offsetY: number,
): number {
  let score = 0;
  let count = 0;
  for (const sample of samples) {
    const targetX = sample.x + offsetX;
    const targetY = sample.y + offsetY;
    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) {
      continue;
    }
    const referenceIndex = (sample.y * width + sample.x) * 4;
    const currentIndex = (targetY * width + targetX) * 4;
    const deltaR = currentRgba[currentIndex] - referenceRgba[referenceIndex];
    const deltaG =
      currentRgba[currentIndex + 1] - referenceRgba[referenceIndex + 1];
    const deltaB =
      currentRgba[currentIndex + 2] - referenceRgba[referenceIndex + 2];
    // A hand can be partially occluded or motion-blurred. Cap individual
    // outliers so a few changed pixels do not overpower the rest of a tile.
    score += Math.min(
      deltaR * deltaR + deltaG * deltaG + deltaB * deltaB,
      27_648,
    );
    count++;
  }
  if (count < Math.max(1, samples.length * 0.65)) {
    return Number.POSITIVE_INFINITY;
  }
  return score / count;
}

function findBestFlow(
  referenceRgba: Uint8ClampedArray,
  currentRgba: Uint8ClampedArray,
  width: number,
  height: number,
  samples: readonly FlowSample[],
  center: OcclusionFlow,
  radius: number,
  regularization: number,
  step = 1,
): { flow: OcclusionFlow; score: number } {
  let bestFlow = center;
  let bestScore = Number.POSITIVE_INFINITY;
  for (
    let offsetY = center.y - radius;
    offsetY <= center.y + radius;
    offsetY += step
  ) {
    for (
      let offsetX = center.x - radius;
      offsetX <= center.x + radius;
      offsetX += step
    ) {
      const rawScore = scoreFlowOffset(
        referenceRgba,
        currentRgba,
        width,
        height,
        samples,
        offsetX,
        offsetY,
      );
      const deltaX = offsetX - center.x;
      const deltaY = offsetY - center.y;
      const score = rawScore +
        (deltaX * deltaX + deltaY * deltaY) * regularization;
      if (score < bestScore) {
        bestScore = score;
        bestFlow = { x: offsetX, y: offsetY };
      }
    }
  }
  return { flow: bestFlow, score: bestScore };
}

function findBestFlowHierarchical(
  referenceRgba: Uint8ClampedArray,
  currentRgba: Uint8ClampedArray,
  width: number,
  height: number,
  samples: readonly FlowSample[],
  center: OcclusionFlow,
  radius: number,
  regularization: number,
): { flow: OcclusionFlow; score: number } {
  const coarseStep = radius >= 20 ? 4 : radius >= 10 ? 2 : 1;
  const coarse = findBestFlow(
    referenceRgba,
    currentRgba,
    width,
    height,
    samples,
    center,
    radius,
    regularization,
    coarseStep,
  );
  if (coarseStep === 1) return coarse;
  return findBestFlow(
    referenceRgba,
    currentRgba,
    width,
    height,
    samples,
    coarse.flow,
    coarseStep,
    regularization,
  );
}

function limitFlowSamples(
  samples: readonly FlowSample[],
  maximum: number,
): readonly FlowSample[] {
  if (samples.length <= maximum) return samples;
  const limited: FlowSample[] = [];
  const stride = samples.length / maximum;
  for (let index = 0; index < maximum; index++) {
    limited.push(samples[Math.floor(index * stride)]);
  }
  return limited;
}

function sampleMaskAlphaBilinear(
  maskRgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || x > width - 1 || y < 0 || y > height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fractionX = x - x0;
  const fractionY = y - y0;
  const top =
    maskRgba[(y0 * width + x0) * 4 + 3] * (1 - fractionX) +
    maskRgba[(y0 * width + x1) * 4 + 3] * fractionX;
  const bottom =
    maskRgba[(y1 * width + x0) * 4 + 3] * (1 - fractionX) +
    maskRgba[(y1 * width + x1) * 4 + 3] * fractionX;
  return Math.round(top * (1 - fractionY) + bottom * fractionY);
}

/**
 * Backward-warps the previous occlusion matte onto matching current pixels.
 * Every output alpha is sampled from the original matte rather than produced
 * by dilation, avoiding both forward-splat holes and a synthetic outer halo.
 */
export function createMotionAwareOcclusionMask(
  maskRgba: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  referenceRgba: Uint8ClampedArray,
  currentRgba: Uint8ClampedArray,
  referenceWidth: number,
  referenceHeight: number,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(maskRgba);
  if (maskRgba.length !== maskWidth * maskHeight * 4) return result;
  if (
    referenceWidth <= 0 ||
    referenceHeight <= 0 ||
    referenceRgba.length !== referenceWidth * referenceHeight * 4 ||
    currentRgba.length !== referenceRgba.length
  ) {
    return result;
  }

  const samplingStep = Math.max(
    1,
    Math.min(4, Math.floor(Math.min(referenceWidth, referenceHeight) / 48)),
  );
  const samples: FlowSample[] = [];
  for (let y = 0; y < referenceHeight; y += samplingStep) {
    for (let x = 0; x < referenceWidth; x += samplingStep) {
      if (
        maskAlphaAtReference(
          maskRgba,
          maskWidth,
          maskHeight,
          referenceWidth,
          referenceHeight,
          x,
          y,
        ) >= FLOW_SAMPLE_ALPHA
      ) {
        samples.push({ x, y });
      }
    }
  }
  if (samples.length === 0) return result;

  const globalRadius = Math.min(
    48,
    Math.max(8, Math.round(Math.max(referenceWidth, referenceHeight) * 0.12)),
  );
  const globalSamples = limitFlowSamples(samples, 512);
  const zeroScore = scoreFlowOffset(
    referenceRgba,
    currentRgba,
    referenceWidth,
    referenceHeight,
    globalSamples,
    0,
    0,
  );
  const globalMatch = findBestFlowHierarchical(
    referenceRgba,
    currentRgba,
    referenceWidth,
    referenceHeight,
    globalSamples,
    { x: 0, y: 0 },
    globalRadius,
    2,
  );
  const globalFlow =
    globalMatch.flow.x !== 0 || globalMatch.flow.y !== 0
      ? globalMatch.score < zeroScore * 0.985
        ? globalMatch.flow
        : { x: 0, y: 0 }
      : globalMatch.flow;

  const tileSize = Math.max(
    12,
    Math.min(24, Math.round(Math.min(referenceWidth, referenceHeight) / 8)),
  );
  const tileSamples = new Map<string, FlowSample[]>();
  for (const sample of samples) {
    const key = `${Math.floor(sample.x / tileSize)}:${Math.floor(sample.y / tileSize)}`;
    const existing = tileSamples.get(key);
    if (existing) existing.push(sample);
    else tileSamples.set(key, [sample]);
  }
  const tileFlows = new Map<string, OcclusionFlow>();
  for (const [key, points] of tileSamples) {
    if (points.length < 3) {
      tileFlows.set(key, globalFlow);
      continue;
    }
    const baselineScore = scoreFlowOffset(
      referenceRgba,
      currentRgba,
      referenceWidth,
      referenceHeight,
      points,
      globalFlow.x,
      globalFlow.y,
    );
    const localRadius = Math.min(
      32,
      Math.max(8, Math.round(Math.max(referenceWidth, referenceHeight) * 0.08)),
    );
    const localMatch = findBestFlowHierarchical(
      referenceRgba,
      currentRgba,
      referenceWidth,
      referenceHeight,
      points,
      globalFlow,
      Math.max(LOCAL_FLOW_RADIUS, localRadius),
      4,
    );
    tileFlows.set(
      key,
      localMatch.score < baselineScore * 0.98
        ? localMatch.flow
        : globalFlow,
    );
  }

  let hasMotion = globalFlow.x !== 0 || globalFlow.y !== 0;
  for (const flow of tileFlows.values()) {
    hasMotion ||= flow.x !== 0 || flow.y !== 0;
  }
  if (!hasMotion) return result;

  interface FlowAnchor {
    x: number;
    y: number;
    flow: OcclusionFlow;
    warped: boolean;
  }
  const flowAnchors = new Map<string, FlowAnchor[]>();
  const addFlowAnchor = (anchor: FlowAnchor): void => {
    const key = `${Math.floor(anchor.x / tileSize)}:${Math.floor(anchor.y / tileSize)}`;
    const existing = flowAnchors.get(key);
    if (existing) existing.push(anchor);
    else flowAnchors.set(key, [anchor]);
  };
  for (const [key, flow] of tileFlows) {
    const [tileX, tileY] = key.split(":").map(Number);
    const sourceX = (tileX + 0.5) * tileSize;
    const sourceY = (tileY + 0.5) * tileSize;
    // Index both ends of the motion. The target anchor discovers a locally
    // moved limb even when it travelled into another grid cell; the source
    // anchor makes the old location sample away from stale foreground.
    addFlowAnchor({ x: sourceX, y: sourceY, flow, warped: false });
    addFlowAnchor({
      x: sourceX + flow.x,
      y: sourceY + flow.y,
      flow,
      warped: true,
    });
  }

  const estimateFlowAtTarget = (
    referenceX: number,
    referenceY: number,
  ): OcclusionFlow => {
    const tileX = Math.floor(referenceX / tileSize);
    const tileY = Math.floor(referenceY / tileSize);
    const candidates: Array<{ anchor: FlowAnchor; distanceSquared: number }> = [];
    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        const anchors = flowAnchors.get(
          `${tileX + offsetX}:${tileY + offsetY}`,
        );
        if (!anchors) continue;
        for (const anchor of anchors) {
          const deltaX = anchor.x - referenceX;
          const deltaY = anchor.y - referenceY;
          candidates.push({
            anchor,
            distanceSquared: deltaX * deltaX + deltaY * deltaY,
          });
        }
      }
    }
    if (candidates.length === 0) return globalFlow;
    candidates.sort((a, b) =>
      a.distanceSquared === b.distanceSquared
        ? Number(b.anchor.warped) - Number(a.anchor.warped)
        : a.distanceSquared - b.distanceSquared,
    );
    const nearest = candidates[0];
    const maximumDistance = tileSize * 1.75;
    if (nearest.distanceSquared > maximumDistance * maximumDistance) {
      return globalFlow;
    }

    const compatibilityRadius = Math.max(4, Math.round(tileSize * 0.25));
    const compatibilitySquared = compatibilityRadius * compatibilityRadius;
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    for (const candidate of candidates) {
      if (candidate.distanceSquared > tileSize * tileSize * 1.5) continue;
      const deltaX = candidate.anchor.flow.x - nearest.anchor.flow.x;
      const deltaY = candidate.anchor.flow.y - nearest.anchor.flow.y;
      if (deltaX * deltaX + deltaY * deltaY > compatibilitySquared) continue;
      const weight = 1 / (1 + Math.sqrt(candidate.distanceSquared));
      weightedX += candidate.anchor.flow.x * weight;
      weightedY += candidate.anchor.flow.y * weight;
      totalWeight += weight;
    }
    return totalWeight > 0
      ? { x: weightedX / totalWeight, y: weightedY / totalWeight }
      : nearest.anchor.flow;
  };

  // Resolve the anchor search once per target grid cell. Looking through the
  // nearby anchors for every output pixel is visually identical at this mask
  // resolution but far too expensive for realtime playback.
  const targetGridWidth = Math.ceil(referenceWidth / tileSize);
  const targetGridHeight = Math.ceil(referenceHeight / tileSize);
  const targetFlowGrid: OcclusionFlow[] = new Array(
    targetGridWidth * targetGridHeight,
  );
  for (let gridY = 0; gridY < targetGridHeight; gridY++) {
    for (let gridX = 0; gridX < targetGridWidth; gridX++) {
      targetFlowGrid[gridY * targetGridWidth + gridX] = estimateFlowAtTarget(
        Math.min(referenceWidth - 1, (gridX + 0.5) * tileSize),
        Math.min(referenceHeight - 1, (gridY + 0.5) * tileSize),
      );
    }
  }
  const flowAtTarget = (referenceX: number, referenceY: number): OcclusionFlow => {
    const gridX = Math.max(
      0,
      Math.min(targetGridWidth - 1, Math.floor(referenceX / tileSize)),
    );
    const gridY = Math.max(
      0,
      Math.min(targetGridHeight - 1, Math.floor(referenceY / tileSize)),
    );
    return targetFlowGrid[gridY * targetGridWidth + gridX] ?? globalFlow;
  };

  result.fill(0);
  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      const targetReferenceX =
        ((x + 0.5) * referenceWidth) / maskWidth - 0.5;
      const targetReferenceY =
        ((y + 0.5) * referenceHeight) / maskHeight - 0.5;
      const flow = flowAtTarget(targetReferenceX, targetReferenceY);
      const sourceReferenceX = targetReferenceX - flow.x;
      const sourceReferenceY = targetReferenceY - flow.y;
      const sourceMaskX =
        ((sourceReferenceX + 0.5) * maskWidth) / referenceWidth - 0.5;
      const sourceMaskY =
        ((sourceReferenceY + 0.5) * maskHeight) / referenceHeight - 0.5;
      const targetIndex = (y * maskWidth + x) * 4;
      result[targetIndex] = 255;
      result[targetIndex + 1] = 255;
      result[targetIndex + 2] = 255;
      result[targetIndex + 3] = sampleMaskAlphaBilinear(
        maskRgba,
        maskWidth,
        maskHeight,
        sourceMaskX,
        sourceMaskY,
      );
    }
  }

  // Fill only enclosed one-pixel warp holes; never grow the outer silhouette.
  const closed = new Uint8ClampedArray(result);
  for (let y = 1; y < maskHeight - 1; y++) {
    for (let x = 1; x < maskWidth - 1; x++) {
      const alphaIndex = (y * maskWidth + x) * 4 + 3;
      if (result[alphaIndex] !== 0) continue;
      const left = result[(y * maskWidth + x - 1) * 4 + 3];
      const right = result[(y * maskWidth + x + 1) * 4 + 3];
      const top = result[((y - 1) * maskWidth + x) * 4 + 3];
      const bottom = result[((y + 1) * maskWidth + x) * 4 + 3];
      if (left > 0 && right > 0) closed[alphaIndex] = Math.min(left, right);
      else if (top > 0 && bottom > 0) {
        closed[alphaIndex] = Math.min(top, bottom);
      }
    }
  }
  return closed;
}
