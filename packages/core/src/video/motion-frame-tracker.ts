import type { Point, Rectangle, TrackingOptions } from "./motion-tracking-engine";
import { OpticalFlowCPU } from "./frame-interpolation/optical-flow-cpu";

/** Decoded RGBA pixels. No DOM/canvas ownership is transferred to the tracker. */
export interface TrackingPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface Match { from: Point; to: Point; score: number }
interface FrameMotion {
  position: Point;
  scale: number;
  rotation: number;
  confidence: number;
}

export function grayscale(frame: TrackingPixels): Float32Array {
  const output = new Float32Array(frame.width * frame.height);
  for (let i = 0; i < output.length; i++) {
    const offset = i * 4;
    output[i] = frame.data[offset] * .299 + frame.data[offset + 1] * .587 + frame.data[offset + 2] * .114;
  }
  return output;
}

function patch(image: Float32Array, width: number, height: number, x: number, y: number, radius = 3): Float32Array | null {
  x = Math.round(x); y = Math.round(y);
  if (x - radius < 0 || y - radius < 0 || x + radius >= width || y + radius >= height) return null;
  const values = new Float32Array((radius * 2 + 1) ** 2);
  let sum = 0, index = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const value = image[(y + dy) * width + x + dx];
    values[index++] = value; sum += value;
  }
  const mean = sum / values.length;
  let variance = 0;
  for (let i = 0; i < values.length; i++) { values[i] -= mean; variance += values[i] ** 2; }
  // A flat patch has no identifiable location; never invent motion for it.
  if (variance / values.length < 16) return null;
  const length = Math.sqrt(variance);
  for (let i = 0; i < values.length; i++) values[i] /= length;
  return values;
}

function correlation(template: Float32Array, image: Float32Array, width: number, height: number, x: number, y: number): number {
  const radius = (Math.sqrt(template.length) - 1) / 2;
  if (x - radius < 0 || y - radius < 0 || x + radius >= width || y + radius >= height) return -1;
  let sum = 0, squared = 0, dot = 0, index = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const value = image[(y + dy) * width + x + dx];
    sum += value; squared += value * value; dot += template[index++] * value;
  }
  const variance = squared - sum * sum / template.length;
  return variance > 1e-6 ? dot / Math.sqrt(variance) : -1;
}

function matchPatch(template: Float32Array, image: Float32Array, width: number, height: number, point: Point, search: number, shift: Point = { x: 0, y: 0 }): Match {
  let x = Math.round(point.x + shift.x), y = Math.round(point.y + shift.y), best = -1;
  let distance = Infinity;
  const consider = (candidateX: number, candidateY: number) => {
    const score = correlation(template, image, width, height, candidateX, candidateY);
    const delta = (candidateX - point.x - shift.x) ** 2 + (candidateY - point.y - shift.y) ** 2;
    if (score > best + 1e-6 || (Math.abs(score - best) < 1e-6 && delta < distance)) {
      x = candidateX; y = candidateY; best = score; distance = delta;
    }
  };
  const centerX = Math.round(point.x + shift.x), centerY = Math.round(point.y + shift.y);
  consider(centerX, centerY);
  // Search every pixel, nearest first. A coarse grid can miss an odd-pixel peak.
  for (let radius = 1; radius <= search; radius++) {
    if (best >= .99999 && radius * radius > distance) break;
    for (let offset = -radius; offset <= radius; offset++) {
      consider(centerX + offset, centerY - radius); consider(centerX + offset, centerY + radius);
    }
    for (let offset = -radius + 1; offset < radius; offset++) {
      consider(centerX - radius, centerY + offset); consider(centerX + radius, centerY + offset);
    }
  }
  const refined = refineSubpixel(best, (dx, dy) => correlation(template, image, width, height, x + dx, y + dy));
  return { from: point, to: { x: x + refined.x, y: y + refined.y }, score: Math.max(0, Math.min(1, best)) };
}

/**
 * Parabolic peak interpolation of a score surface around its integer maximum (offsets in [-0.5, 0.5]).
 * `at(dx, dy)` samples the surface one pixel away; an edge peak or a flat/convex neighbourhood gives no refinement.
 */
export function refineSubpixel(center: number, at: (dx: number, dy: number) => number): Point {
  const axis = (minus: number, plus: number): number => {
    if (minus < 0 || plus < 0 || center < minus || center < plus) return 0;
    const denominator = minus - 2 * center + plus;
    return denominator < -1e-9 ? Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * denominator)) + 0) : 0;
  };
  return { x: axis(at(-1, 0), at(1, 0)), y: axis(at(0, -1), at(0, 1)) };
}

const PYRAMID_ABOVE = 20;

/** 2x2 box average, so a half-resolution patch sees the same scene at twice the footprint. */
function halve(image: Float32Array, width: number, height: number): Float32Array {
  const w = Math.floor(width / 2), h = Math.floor(height / 2), output = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * 2 * width + x * 2;
    output[y * w + x] = (image[at] + image[at + 1] + image[at + width] + image[at + width + 1]) / 4;
  }
  return output;
}

function pointsInRegion(image: Float32Array, width: number, height: number, region: Rectangle, feature: boolean): Point[] {
  const candidates: Array<Point & { score: number }> = [];
  const step = feature ? 3 : Math.max(4, Math.floor(Math.min(region.width, region.height) / 6));
  for (let y = Math.max(4, Math.ceil(region.y)); y < Math.min(height - 4, region.y + region.height); y += step) {
    for (let x = Math.max(4, Math.ceil(region.x)); x < Math.min(width - 4, region.x + region.width); x += step) {
      const values = patch(image, width, height, x, y);
      if (!values) continue;
      let xx = 0, yy = 0, xy = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const at = (y + dy) * width + x + dx;
        const gx = image[at + 1] - image[at - 1], gy = image[at + width] - image[at - width];
        xx += gx * gx; yy += gy * gy; xy += gx * gy;
      }
      const score = (xx + yy - Math.sqrt((xx - yy) ** 2 + 4 * xy * xy)) / 2;
      candidates.push({ x, y, score });
    }
  }
  if (feature) candidates.sort((a, b) => b.score - a.score);
  const selected: Point[] = [];
  for (const candidate of candidates) {
    if (selected.every(other => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= 6)) selected.push(candidate);
    if (selected.length === 36) break;
  }
  return selected;
}

function cropPixels(frame: TrackingPixels, box: Rectangle): TrackingPixels {
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const source = ((box.y + y) * frame.width + box.x) * 4;
    data.set(frame.data.subarray(source, source + box.width * 4), y * box.width * 4);
  }
  return { width: box.width, height: box.height, data };
}

function fitSimilarity(matches: Match[]) {
  const count = matches.length;
  const source = { x: 0, y: 0 }, target = { x: 0, y: 0 };
  for (const match of matches) {
    source.x += match.from.x / count; source.y += match.from.y / count;
    target.x += match.to.x / count; target.y += match.to.y / count;
  }
  let denominator = 0, a = 0, b = 0;
  for (const match of matches) {
    const x = match.from.x - source.x, y = match.from.y - source.y;
    const u = match.to.x - target.x, v = match.to.y - target.y;
    denominator += x * x + y * y; a += x * u + y * v; b += x * v - y * u;
  }
  a = denominator > 1e-6 ? a / denominator : 1;
  b = denominator > 1e-6 ? b / denominator : 0;
  return { a, b, map: (point: Point) => ({
    x: target.x + a * (point.x - source.x) - b * (point.y - source.y),
    y: target.y + b * (point.x - source.x) + a * (point.y - source.y),
  }) };
}

/** Pixel-based frame registration; all algorithms return measured correspondences. */
export async function trackMotionFramePair(
  previous: TrackingPixels, current: TrackingPixels, region: Rectangle,
  algorithm: NonNullable<TrackingOptions["algorithm"]> = "correlation", searchRadius = 16, hint: Point = { x: 0, y: 0 },
): Promise<FrameMotion> {
  if (previous.width !== current.width || previous.height !== current.height
    || previous.data.length !== previous.width * previous.height * 4 || current.data.length !== current.width * current.height * 4) {
    throw new Error("Tracking frames must have equal, valid dimensions");
  }
  const before = grayscale(previous), after = grayscale(current);
  const points = pointsInRegion(before, previous.width, previous.height, region, algorithm === "feature");
  let matches: Match[];
  if (algorithm === "optical-flow") {
    const left = Math.max(0, Math.floor(region.x - searchRadius)), top = Math.max(0, Math.floor(region.y - searchRadius));
    const box = { x: left, y: top, width: Math.min(previous.width - left, Math.ceil(region.width + searchRadius * 2)), height: Math.min(previous.height - top, Math.ceil(region.height + searchRadius * 2)) };
    const first = cropPixels(previous, box), next = cropPixels(current, box);
    const flow = await new OpticalFlowCPU({ quality: "medium", blockSize: 8, searchRadius, pyramidLevels: 1 })
      .computeFlowField(first as ImageData, next as ImageData);
    matches = points.map(point => {
      const index = (Math.min(flow.height - 1, Math.floor((point.y - top) / 8)) * flow.width + Math.min(flow.width - 1, Math.floor((point.x - left) / 8))) * 2;
      const x = Math.round(point.x + flow.vectors[index]), y = Math.round(point.y + flow.vectors[index + 1]);
      return { from: point, to: { x, y }, score: correlation(patch(before, previous.width, previous.height, point.x, point.y)!, after, current.width, current.height, x, y) };
    });
  } else if (searchRadius > PYRAMID_ABOVE) {
    // Wide search, coarse to fine: match distinctive half-resolution patches over the whole window,
    // then refine each hit at full resolution. A single full-resolution pass over a window this large
    // finds look-alike texture elsewhere; the half-resolution patch covers twice the area.
    const w2 = Math.floor(previous.width / 2), h2 = Math.floor(previous.height / 2);
    const coarseBefore = halve(before, previous.width, previous.height), coarseAfter = halve(after, current.width, current.height);
    matches = points.map(point => {
      const full = patch(before, previous.width, previous.height, point.x, point.y)!;
      const coarse = patch(coarseBefore, w2, h2, point.x / 2, point.y / 2);
      let shift = hint;
      let radius = searchRadius;
      if (coarse) {
        const hit = matchPatch(coarse, coarseAfter, w2, h2, { x: point.x / 2, y: point.y / 2 }, Math.ceil(searchRadius / 2), { x: hint.x / 2, y: hint.y / 2 });
        if (hit.score >= .5) { shift = { x: hit.to.x * 2 - point.x, y: hit.to.y * 2 - point.y }; radius = 3; }
      }
      return matchPatch(full, after, current.width, current.height, point, radius, shift);
    });
  } else {
    matches = points.map(point => matchPatch(patch(before, previous.width, previous.height, point.x, point.y)!, after, current.width, current.height, point, searchRadius, hint));
  }
  const center = { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  matches = matches.filter(match => match.score >= .65);
  if (matches.length < 3) return { position: center, scale: 1, rotation: 0, confidence: 0 };
  // Several motions can be present (a partly covered target next to a static background): keep the largest agreeing group.
  const tolerance = 2 + .04 * Math.max(region.width, region.height);
  let densest: Match[] = matches;
  let densestWeight = -1;
  for (const seed of matches) {
    const group = matches.filter(match => Math.hypot((match.to.x - match.from.x) - (seed.to.x - seed.from.x), (match.to.y - match.from.y) - (seed.to.y - seed.from.y)) <= tolerance);
    const weight = group.reduce((sum, match) => sum + match.score, 0);
    if (weight > densestWeight) { densest = group; densestWeight = weight; }
  }
  matches = densest;
  if (matches.length < 3) return { position: center, scale: 1, rotation: 0, confidence: 0 };
  let fit = fitSimilarity(matches);
  for (let iteration = 0; iteration < 2; iteration++) {
    const filtered = matches.filter(match => { const predicted = fit.map(match.from); return Math.hypot(predicted.x - match.to.x, predicted.y - match.to.y) <= 2.5; });
    if (filtered.length < 3) return { position: center, scale: 1, rotation: 0, confidence: 0 };
    matches = filtered; fit = fitSimilarity(matches);
  }
  const scale = Math.hypot(fit.a, fit.b);
  if (scale < .7 || scale > 1.4) return { position: center, scale: 1, rotation: 0, confidence: 0 };
  let position = fit.map(center);
  // Partly hidden target: the matched points sit on one side, so a similarity fit amplifies noise into the
  // far side of the region. With near-unit scale the median displacement of the visible points is the better centre.
  if (matches.length < points.length * .7 && Math.abs(scale - 1) < .04) {
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    position = { x: center.x + median(matches.map(match => match.to.x - match.from.x)), y: center.y + median(matches.map(match => match.to.y - match.from.y)) };
  }
  return { position, scale, rotation: Math.atan2(fit.b, fit.a) * 180 / Math.PI,
    confidence: Math.min(1, matches.reduce((sum, match) => sum + match.score, 0) / matches.length * Math.min(1, matches.length / Math.max(3, points.length * .6))) };
}
