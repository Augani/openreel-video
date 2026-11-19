import { grayscale, type TrackingPixels } from "./motion-frame-tracker";
import {
  applyHomography, invertHomography, isConvexQuad, pointInQuad, quadArea, ransacHomography, transformQuad,
  type Pt, type Quad,
} from "./planar-homography";

/**
 * Planar (corner-pin) tracking. Shi-Tomasi features inside the surface quad are followed frame to frame with
 * pyramidal Lucas-Kanade (forward-backward checked). Every feature remembers its position on the anchor frame,
 * so a RANSAC homography is fitted anchor -> current rather than chained frame to frame: error does not
 * accumulate, outliers (occluders, moving objects) are rejected, and the four corners are the anchor quad
 * pushed through that homography. Pure and DOM-free; fully deterministic (seeded RANSAC, no clocks).
 */

export type PlanarStatus = "tracked" | "predicted";
/** Eight numbers: x0 y0 (TL) x1 y1 (TR) x2 y2 (BR) x3 y3 (BL), in source pixels. */
export type CornerList = readonly number[];

export interface PlanarSessionFrame extends TrackingPixels { sourceWidth?: number; sourceHeight?: number }
export interface PlanarSessionConfig {
  /** Surface corners at the anchor frame, source pixels, clockwise from the top left. */
  corners: CornerList;
  confidenceThreshold?: number;
  seed?: number;
}
export interface PlanarStep { corners: number[]; confidence: number; inliers: number; status: PlanarStatus; lost: boolean }

export interface PlanarStepper { step(frame: PlanarSessionFrame): Promise<PlanarStep>; dispose(): void }
export type PlanarStepperFactory = (config: PlanarSessionConfig) => PlanarStepper;

export function cornersToQuad(c: CornerList): Quad {
  return [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }, { x: c[4], y: c[5] }, { x: c[6], y: c[7] }];
}
export function quadToCorners(q: Quad): number[] { return q.flatMap(p => [p.x, p.y]); }

/* ----------------------------- image pyramid ----------------------------- */

interface Level { w: number; h: number; d: Float32Array }
const LEVELS = 4;

function buildPyramid(gray: Float32Array, w: number, h: number): Level[] {
  const levels: Level[] = [{ w, h, d: gray }];
  for (let l = 1; l < LEVELS; l++) {
    const p = levels[l - 1], nw = p.w >> 1, nh = p.h >> 1;
    if (nw < 16 || nh < 16) break;
    const d = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const i = (2 * y) * p.w + 2 * x;
      d[y * nw + x] = (p.d[i] + p.d[i + 1] + p.d[i + p.w] + p.d[i + p.w + 1]) * 0.25;
    }
    levels.push({ w: nw, h: nh, d });
  }
  return levels;
}

function bilinear(l: Level, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i = y0 * l.w + x0, d = l.d;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + l.w] * (1 - fx) + d[i + l.w + 1] * fx) * fy;
}

/* ------------------------------- features -------------------------------- */

export interface DetectOptions { maxPoints?: number; cell?: number; quality?: number; avoid?: readonly Pt[]; avoidRadius?: number }

/** Shi-Tomasi corners inside `quad`, at most one per grid cell so they spread over the surface. Deterministic. */
export function detectFeatures(gray: Float32Array, w: number, h: number, quad: Quad, options: DetectOptions = {}): Pt[] {
  const { maxPoints = 160, quality = 0.02, avoid = [], avoidRadius = 6 } = options;
  const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
  const margin = 9;
  const x0 = Math.max(margin, Math.floor(Math.min(...xs))), x1 = Math.min(w - margin - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(margin, Math.floor(Math.min(...ys))), y1 = Math.min(h - margin - 1, Math.ceil(Math.max(...ys)));
  if (x1 - x0 < 8 || y1 - y0 < 8) return [];
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const ix = new Float32Array(bw * bh), iy = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const gx = x0 + x, gy = y0 + y, i = gy * w + gx;
    ix[y * bw + x] = (gray[i + 1] - gray[i - 1]) * 0.5; iy[y * bw + x] = (gray[i + w] - gray[i - w]) * 0.5;
  }
  const score = new Float32Array(bw * bh);
  let top = 0;
  const r = 2;
  for (let y = r; y < bh - r; y++) for (let x = r; x < bw - r; x++) {
    let a = 0, b = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const j = (y + dy) * bw + x + dx, gx = ix[j], gy = iy[j];
      a += gx * gx; b += gx * gy; c += gy * gy;
    }
    const tr = a + c, det = a * c - b * b;
    const min = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    score[y * bw + x] = min; if (min > top) top = min;
  }
  if (top <= 0) return [];
  const cell = options.cell ?? Math.max(8, Math.round(Math.sqrt(bw * bh / maxPoints)));
  const best = new Map<number, { s: number; p: Pt }>();
  for (let y = r; y < bh - r; y++) for (let x = r; x < bw - r; x++) {
    const s = score[y * bw + x];
    if (s < top * quality) continue;
    // Local maximum in a 3x3 so a corner is one point, not a blob.
    let peak = true;
    for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && score[(y + dy) * bw + x + dx] > s) { peak = false; break; }
    if (!peak) continue;
    const p = { x: x0 + x, y: y0 + y };
    if (!pointInQuad(quad, p)) continue;
    if (avoid.some(a => Math.hypot(a.x - p.x, a.y - p.y) < avoidRadius)) continue;
    const key = Math.floor(y / cell) * 4096 + Math.floor(x / cell), held = best.get(key);
    if (!held || s > held.s) best.set(key, { s, p });
  }
  return [...best.values()].sort((a, b) => b.s - a.s || a.p.y - b.p.y || a.p.x - b.p.x).slice(0, maxPoints).map(v => v.p);
}

/* ------------------------- pyramidal Lucas-Kanade ------------------------- */

const WIN = 7;

/** Follow one point from `prev` to `cur`. Returns null when it leaves the image or the system is ill-conditioned. */
export function lucasKanade(prev: Level[], cur: Level[], point: Pt, guess: Pt = { x: 0, y: 0 }): { p: Pt; err: number } | null {
  const levels = Math.min(prev.length, cur.length);
  let gx = guess.x / 2 ** (levels - 1), gy = guess.y / 2 ** (levels - 1);
  let err = 0;
  const side = WIN * 2 + 1;
  const tpl = new Float32Array(side * side), dx = new Float32Array(side * side), dy = new Float32Array(side * side);
  for (let l = levels - 1; l >= 0; l--) {
    const P = prev[l], C = cur[l], s = 2 ** l, px = point.x / s, py = point.y / s;
    if (px < WIN + 2 || py < WIN + 2 || px > P.w - WIN - 3 || py > P.h - WIN - 3) { if (l === 0) return null; gx *= 2; gy *= 2; continue; }
    let sxx = 0, sxy = 0, syy = 0, k = 0;
    for (let y = -WIN; y <= WIN; y++) for (let x = -WIN; x <= WIN; x++, k++) {
      const fx = px + x, fy = py + y;
      tpl[k] = bilinear(P, fx, fy);
      dx[k] = (bilinear(P, fx + 1, fy) - bilinear(P, fx - 1, fy)) * 0.5; dy[k] = (bilinear(P, fx, fy + 1) - bilinear(P, fx, fy - 1)) * 0.5;
      sxx += dx[k] * dx[k]; sxy += dx[k] * dy[k]; syy += dy[k] * dy[k];
    }
    const det = sxx * syy - sxy * sxy;
    if (det < 1e-3 * side * side) return null;
    for (let it = 0; it < 20; it++) {
      const cx = px + gx, cy = py + gy;
      if (cx < WIN + 2 || cy < WIN + 2 || cx > C.w - WIN - 3 || cy > C.h - WIN - 3) return null;
      let bx = 0, by = 0, e = 0;
      k = 0;
      for (let y = -WIN; y <= WIN; y++) for (let x = -WIN; x <= WIN; x++, k++) {
        const diff = tpl[k] - bilinear(C, cx + x, cy + y);
        bx += diff * dx[k]; by += diff * dy[k]; e += Math.abs(diff);
      }
      const ux = (syy * bx - sxy * by) / det, uy = (sxx * by - sxy * bx) / det;
      gx += ux; gy += uy; err = e / (side * side);
      if (ux * ux + uy * uy < 1e-4) break;
    }
    if (l > 0) { gx *= 2; gy *= 2; }
  }
  const out = { x: point.x + gx, y: point.y + gy };
  return Number.isFinite(out.x) && Number.isFinite(out.y) ? { p: out, err } : null;
}

/* --------------------------------- session -------------------------------- */

interface Track { a: Pt; p: Pt }
const TARGET_POINTS = 100;
const MIN_POINTS = 8;
const FB_TOLERANCE = 1.2;
const MAX_ERR = 24;
const RANSAC_THRESHOLD = 1.6;

export class PlanarTrackSession {
  private readonly threshold: number;
  private readonly seed: number;
  private anchor: Quad | null = null;
  private prev: Level[] | null = null;
  private tracks: Track[] = [];
  private last: Quad | null = null;
  private frames = 0;
  private sx = 1;
  private sy = 1;

  constructor(private readonly config: PlanarSessionConfig) {
    if (config.corners.length !== 8 || !config.corners.every(Number.isFinite)) throw new Error("Choose four valid corners");
    this.threshold = config.confidenceThreshold ?? 0.5;
    this.seed = config.seed ?? 1;
  }

  async step(frame: PlanarSessionFrame): Promise<PlanarStep> {
    this.sx = frame.width / (frame.sourceWidth ?? frame.width); this.sy = frame.height / (frame.sourceHeight ?? frame.height);
    if (!Number.isFinite(this.sx) || !Number.isFinite(this.sy) || this.sx <= 0 || this.sy <= 0) throw new Error("Tracking frame dimensions are invalid");
    const gray = grayscale(frame), pyramid = buildPyramid(gray, frame.width, frame.height);
    const emit = (quad: Quad, confidence: number, inliers: number, status: PlanarStatus): PlanarStep => {
      this.frames++;
      return { corners: quad.flatMap(p => [p.x / this.sx, p.y / this.sy]), confidence, inliers, status, lost: confidence < this.threshold };
    };

    if (!this.anchor) {
      const quad = cornersToQuad(this.config.corners).map(p => ({ x: p.x * this.sx, y: p.y * this.sy })) as unknown as Quad;
      if (!isConvexQuad(quad) || Math.abs(quadArea(quad)) < 400) throw new Error("Place the four corners around a visible surface");
      const points = detectFeatures(gray, frame.width, frame.height, quad);
      if (points.length < MIN_POINTS) throw new Error("The surface has too little detail to track; choose a textured area");
      this.anchor = quad; this.last = quad; this.prev = pyramid;
      this.tracks = points.map(p => ({ a: p, p }));
      return emit(quad, 1, points.length, "tracked");
    }

    const anchor = this.anchor, previous = this.prev!;
    const next: Track[] = [];
    for (const t of this.tracks) {
      const fwd = lucasKanade(previous, pyramid, t.p);
      if (!fwd || fwd.err > MAX_ERR) continue;
      const back = lucasKanade(pyramid, previous, fwd.p);
      if (!back || Math.hypot(back.p.x - t.p.x, back.p.y - t.p.y) > FB_TOLERANCE) continue;
      next.push({ a: t.a, p: fwd.p });
    }
    const fit = next.length >= MIN_POINTS
      ? ransacHomography(next.map(t => ({ from: t.a, to: t.p })), { threshold: RANSAC_THRESHOLD, iterations: 150, seed: this.seed + this.frames, minInliers: MIN_POINTS })
      : null;
    const quad = fit ? transformQuad(fit.homography, anchor) : null;
    const prevArea = Math.abs(quadArea(this.last!)), area = quad ? Math.abs(quadArea(quad)) : 0;
    if (!fit || !quad || !isConvexQuad(quad) || area < prevArea * 0.5 || area > prevArea * 2) {
      // Surface not found: hold the last good corners, keep the last good frame and points to recover from.
      return emit(this.last!, 0, fit?.inlierCount ?? 0, "predicted");
    }
    const kept = next.filter((_, i) => fit.inliers[i]);
    const ratio = fit.inlierCount / next.length;
    let confidence = Math.min(1, ratio) * Math.min(1, fit.inlierCount / 15) * (1 - Math.min(0.5, fit.rmsError / RANSAC_THRESHOLD * 0.25));
    confidence = Math.max(0, Math.min(1, confidence));
    this.last = quad;
    if (kept.length < TARGET_POINTS * 0.6) {
      const inverse = invertHomography(fit.homography);
      if (inverse) {
        const fresh = detectFeatures(gray, frame.width, frame.height, quad, { maxPoints: TARGET_POINTS - kept.length, avoid: kept.map(t => t.p) });
        for (const p of fresh) kept.push({ a: applyHomography(inverse, p), p });
      }
    }
    this.tracks = kept; this.prev = pyramid;
    return emit(quad, confidence, fit.inlierCount, "tracked");
  }
}

/* ------------------------------ persisted data ----------------------------- */

export interface PlanarTrackKeyframe { frame: number; corners: number[] }
export interface PlanarTrackData {
  version: 1;
  trackId: string;
  clipId: string;
  frameRate: number;
  anchorFrame: number;
  /** Corners the user placed on the anchor frame, source pixels. */
  anchorCorners: number[];
  keyframes: PlanarTrackKeyframe[];
  confidence: number[];
  lostFrames: number[];
  /** Frames whose corners were edited by hand (always full confidence). */
  manualFrames: number[];
  stats?: { frames: number; elapsedMs: number; framesPerSecond: number };
}

export interface PlanarTrackOptions {
  clipId: string;
  frameRate: number;
  /** Frame where `corners` is defined; tracked up to `endFrame` (forward) or down to `startFrame` (backward). */
  anchorFrame: number;
  startFrame: number;
  endFrame: number;
  direction?: "forward" | "backward";
  corners: CornerList;
  confidenceThreshold?: number;
  readFrame: (frame: number) => Promise<PlanarSessionFrame | null>;
  createStepper?: PlanarStepperFactory;
  signal?: AbortSignal;
  onProgress?: (percent: number, lostFrames: number) => void;
  now?: () => number;
}

function abortError(): Error { return new DOMException("Tracking cancelled", "AbortError"); }

/** Run a planar track over a frame range. Rejects with an AbortError on cancel. Progress is reported per frame. */
export async function trackPlanarSurface(options: PlanarTrackOptions): Promise<PlanarTrackData> {
  const { startFrame, endFrame, anchorFrame, signal } = options;
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame < startFrame || anchorFrame < startFrame || anchorFrame > endFrame) throw new Error("Tracking requires a valid frame range");
  const backward = options.direction === "backward";
  const order: number[] = [];
  if (backward) for (let f = anchorFrame; f >= startFrame; f--) order.push(f); else for (let f = anchorFrame; f <= endFrame; f++) order.push(f);
  const config: PlanarSessionConfig = { corners: options.corners, confidenceThreshold: options.confidenceThreshold };
  const stepper: PlanarStepper = options.createStepper ? options.createStepper(config) : (() => { const s = new PlanarTrackSession(config); return { step: (f: PlanarSessionFrame) => s.step(f), dispose: () => undefined }; })();
  const now = options.now ?? (() => Date.now());
  const began = now();
  const rows: Array<{ frame: number; step: PlanarStep }> = [];
  try {
    let upcoming: Promise<PlanarSessionFrame | null> | null = options.readFrame(order[0]);
    for (let i = 0; i < order.length; i++) {
      if (signal?.aborted) throw abortError();
      const pixels = await upcoming;
      if (signal?.aborted) throw abortError();
      if (!pixels) throw new Error(`Could not decode tracking frame ${order[i]}`);
      upcoming = i + 1 < order.length ? options.readFrame(order[i + 1]) : null;
      upcoming?.catch(() => undefined);
      const step = await stepper.step(pixels);
      rows.push({ frame: order[i], step });
      options.onProgress?.(order.length === 1 ? 100 : i / (order.length - 1) * 100, rows.filter(r => r.step.lost).length);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  } finally { stepper.dispose(); }
  rows.sort((a, b) => a.frame - b.frame);
  const elapsed = Math.max(1, now() - began);
  return {
    version: 1, trackId: `planar-${options.clipId}-${anchorFrame}-${backward ? "b" : "f"}`, clipId: options.clipId, frameRate: options.frameRate,
    anchorFrame, anchorCorners: [...options.corners],
    keyframes: rows.map(r => ({ frame: r.frame, corners: r.step.corners })),
    confidence: rows.map(r => r.step.confidence),
    lostFrames: rows.filter(r => r.step.lost).map(r => r.frame),
    manualFrames: [],
    stats: { frames: rows.length, elapsedMs: elapsed, framesPerSecond: rows.length / (elapsed / 1000) },
  };
}

/** Replace the frames a re-track covered, keeping the rest (partial forward/backward re-tracks refine the path). */
export function mergePlanarTrack(existing: PlanarTrackData | null, incoming: PlanarTrackData): PlanarTrackData {
  if (!existing || existing.clipId !== incoming.clipId || existing.frameRate !== incoming.frameRate || !incoming.keyframes.length) return incoming;
  const first = incoming.keyframes[0].frame, last = incoming.keyframes[incoming.keyframes.length - 1].frame;
  const lostBefore = new Set(existing.lostFrames), lostNow = new Set(incoming.lostFrames);
  const rows: Array<{ key: PlanarTrackKeyframe; c: number; lost: boolean }> = [];
  existing.keyframes.forEach((key, i) => { if (key.frame < first || key.frame > last) rows.push({ key, c: existing.confidence[i] ?? 1, lost: lostBefore.has(key.frame) }); });
  incoming.keyframes.forEach((key, i) => rows.push({ key, c: incoming.confidence[i] ?? 1, lost: lostNow.has(key.frame) }));
  rows.sort((a, b) => a.key.frame - b.key.frame);
  return { ...incoming, anchorFrame: existing.anchorFrame, anchorCorners: existing.anchorCorners, keyframes: rows.map(r => r.key), confidence: rows.map(r => r.c),
    lostFrames: rows.filter(r => r.lost).map(r => r.key.frame), manualFrames: existing.manualFrames.filter(f => f < first || f > last) };
}

/** Corners at a frame, linearly interpolated between samples (this is exactly what the exported keyframes do). */
export function planarCornersAt(data: PlanarTrackData, frame: number): { corners: number[]; confidence: number; exact: boolean; manual: boolean } | null {
  const keys = data.keyframes;
  if (!keys.length) return null;
  let next = keys.findIndex(k => k.frame >= frame);
  if (next < 0) next = keys.length - 1;
  const after = keys[next];
  const manual = data.manualFrames.includes(after.frame);
  if (after.frame === frame || next === 0 || after.frame < frame) return { corners: [...after.corners], confidence: data.confidence[next] ?? 1, exact: after.frame === frame, manual: manual && after.frame === frame };
  const before = keys[next - 1], t = (frame - before.frame) / Math.max(1, after.frame - before.frame);
  return { corners: before.corners.map((v, i) => v + (after.corners[i] - v) * t), confidence: Math.min(data.confidence[next - 1] ?? 1, data.confidence[next] ?? 1), exact: false, manual: false };
}

/** Set one corner (or all four) at a frame by hand. Adds the frame when the track has no sample there. */
export function correctPlanarFrame(data: PlanarTrackData, frame: number, corners: CornerList): PlanarTrackData {
  if (!Number.isInteger(frame) || frame < 0 || corners.length !== 8 || !corners.every(Number.isFinite)) throw new Error("Choose a valid frame and corners");
  const keys = data.keyframes.map(k => ({ frame: k.frame, corners: [...k.corners] })), confidence = [...data.confidence];
  const at = keys.findIndex(k => k.frame === frame);
  if (at >= 0) { keys[at].corners = [...corners]; confidence[at] = 1; }
  else {
    const insert = keys.findIndex(k => k.frame > frame), index = insert < 0 ? keys.length : insert;
    keys.splice(index, 0, { frame, corners: [...corners] }); confidence.splice(index, 0, 1);
  }
  return { ...data, keyframes: keys, confidence, lostFrames: data.lostFrames.filter(f => f !== frame), manualFrames: [...new Set([...data.manualFrames, frame])].sort((a, b) => a - b) };
}
