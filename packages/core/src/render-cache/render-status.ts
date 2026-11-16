import type { Project } from "../types/project";
import type { Clip, Effect } from "../types/timeline";
import {
  framesInRange,
  normalizeRanges,
  type FrameRange,
  type TimeRange,
} from "./time-ranges";

/**
 * none   - plain media, plays without rendering (no bar)
 * cached - a render exists for the segment (green)
 * light  - needs a render but should play in real time (yellow)
 * heavy  - effects-heavy, unlikely to play in real time (red)
 */
export type RenderStatusLevel = "none" | "cached" | "light" | "heavy";

export interface RenderStatusSegment {
  readonly start: number;
  readonly end: number;
  readonly level: RenderStatusLevel;
  /** Estimated ms to produce one frame live (0 for none/cached). */
  readonly estimatedMs: number;
  readonly reasons: readonly string[];
}

const REFERENCE_PIXELS = 1920 * 1080;

/** Estimated GPU/CPU milliseconds per 1080p frame for each effect type at neutral-ish params. */
const EFFECT_BASE_MS: Readonly<Record<string, number>> = {
  brightness: 0.8,
  contrast: 0.8,
  saturation: 0.8,
  hue: 0.8,
  temperature: 0.8,
  tint: 0.8,
  tonal: 1,
  exposure: 0.8,
  vibrance: 1,
  "hsl-secondary": 6,
  grayscale: 0.6,
  sepia: 0.6,
  invert: 0.6,
  vignette: 1.5,
  grain: 2,
  sharpen: 3,
  "unsharp-mask": 4,
  blur: 5,
  "gaussian-blur": 5,
  "directional-blur": 6,
  "motion-blur": 8,
  "radial-blur": 10,
  "chromatic-aberration": 3,
  glow: 6,
  shadow: 4,
  chromaKey: 4,
  mosaic: 1.5,
  posterize: 1.2,
  mirror: 1.2,
  threshold: 1.2,
  "lens-distortion": 3,
  "find-edges": 4,
  emboss: 4,
  halftone: 5,
  "vhs-glitch": 6,
  crop: 1,
  skew: 1.5,
  // wave 7 effects: measured 1080p GPU cost, rounded up (heavier = multi-tap)
  "camera-blur": 9,
  "channel-blur": 12,
  "tilt-shift": 9,
  "turbulent-displace": 7,
  "lens-flare": 6,
  noise: 7,
  "color-emboss": 7,
};

function paramNumber(params: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/** Cost of one enabled effect, scaled by the parameters that dominate its work. */
export function estimateEffectMs(effect: Effect): number {
  if (!effect.enabled) return 0;
  const type = effect.type;
  const params = effect.params ?? {};
  let ms = EFFECT_BASE_MS[type] ?? (type.startsWith("shader") ? 6 : 4);
  if (type === "blur" || type === "gaussian-blur" || type === "directional-blur" || type === "glow") {
    ms += Math.min(40, Math.max(0, paramNumber(params, "radius", "amount", "size", "blur"))) * 0.55;
  } else if (type === "motion-blur") {
    ms += Math.min(80, paramNumber(params, "distance")) * 0.2;
  } else if (type === "radial-blur") {
    ms += Math.min(60, paramNumber(params, "amount")) * 0.2;
  } else if (type === "shadow") {
    ms += Math.min(40, paramNumber(params, "blur")) * 0.4;
  }
  return ms;
}

function gradingMs(clip: Clip): number {
  const grading = clip.colorGrading;
  if (!grading) return 0;
  let ms = 0;
  if (grading.colorWheels) ms += 1.5;
  if (grading.curves) ms += 1.5;
  if (grading.hsl) ms += 1.5;
  if (typeof grading.temperature === "number" && grading.temperature !== 0) ms += 0.8;
  if (typeof grading.tint === "number" && grading.tint !== 0) ms += 0.8;
  if (grading.tone) ms += 0.5;
  if (grading.vignette && grading.vignette.amount !== 0) ms += 1;
  if (grading.lut) ms += 4;
  return ms;
}

function isVisualClip(clip: Clip, project: Project): boolean {
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  return !(media?.type === "audio" && !clip.mediaId.startsWith("compound:"));
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

interface IntervalCost {
  readonly processing: boolean;
  readonly estimatedMs: number;
  readonly reasons: string[];
}

function mid(interval: Interval): number {
  return (interval.start + interval.end) / 2;
}

function costAt(project: Project, t: number): IntervalCost {
  const reasons: string[] = [];
  let ms = 0;
  let processing = false;
  let layers = 0;
  const pixelScale = Math.max(0.1, (project.settings.width * project.settings.height) / REFERENCE_PIXELS);
  const masks = project.masks ?? [];

  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (t < clip.startTime || t >= clip.startTime + clip.duration) continue;
      if (!isVisualClip(clip, project)) continue;
      layers++;
      ms += 2;
      for (const effect of clip.effects) {
        const cost = estimateEffectMs(effect);
        if (cost <= 0) continue;
        processing = true;
        ms += cost * pixelScale;
        reasons.push(effect.type);
      }
      const grade = gradingMs(clip);
      if (grade > 0) {
        processing = true;
        ms += grade * pixelScale;
        reasons.push(clip.colorGrading?.lut ? "LUT" : "color grade");
      }
      if (clip.chromaKey?.enabled) {
        processing = true;
        ms += 4 * pixelScale;
        reasons.push("chroma key");
      }
      if (clip.blendMode && clip.blendMode !== "normal") {
        processing = true;
        ms += 1.5 * pixelScale;
        reasons.push("blend mode");
      }
      if (clip.stabilization?.enabled) {
        processing = true;
        ms += 8 * pixelScale;
        reasons.push("stabilization");
      }
      if (clip.smoothSlowMo || clip.interpolationQuality === "high") {
        processing = true;
        ms += 40 * pixelScale;
        reasons.push("frame interpolation");
      }
      if ((clip.speed ?? 1) !== 1 || (clip.speedKeyframes?.length ?? 0) > 0) {
        processing = true;
        ms += 1.5;
        reasons.push("retime");
      }
      const clipMasks = masks.filter((mask) => mask.clipId === clip.id);
      for (const mask of clipMasks) {
        processing = true;
        ms += (4 + Math.min(100, mask.feathering) * 0.2) * pixelScale;
        reasons.push("mask");
      }
      if (clip.keyframes.length > 0 || clip.emphasisAnimation) {
        processing = true;
        ms += 0.5;
        reasons.push("animation");
      }
    }
    for (const transition of track.transitions ?? []) {
      const clipA = track.clips.find((c) => c.id === transition.clipAId);
      const clipB = transition.clipBId ? track.clips.find((c) => c.id === transition.clipBId) : undefined;
      if (!clipA) continue;
      const d = Math.max(0, transition.duration);
      const cut = clipB ? clipB.startTime : clipA.startTime + clipA.duration;
      const windows: Interval[] =
        transition.edge === "in"
          ? [{ start: clipA.startTime - d, end: clipA.startTime + d }]
          : [{ start: cut - d, end: cut + d }];
      if (windows.some((w) => t >= w.start && t < w.end)) {
        processing = true;
        ms += 5 * pixelScale;
        reasons.push("transition");
      }
    }
  }

  for (const layer of project.adjustmentLayers ?? []) {
    if (!layer.enabled || t < layer.startTime || t >= layer.startTime + layer.duration) continue;
    processing = true;
    ms += 2;
    for (const effect of layer.effects) {
      ms += estimateEffectMs(effect) * pixelScale;
      reasons.push(`adjustment ${effect.type}`);
    }
  }
  for (const instance of project.motionInstances ?? []) {
    if (t >= instance.startTime && t < instance.startTime + instance.duration) {
      processing = true;
      ms += 8 * pixelScale;
      reasons.push("motion graphics");
    }
  }
  for (const particle of project.particleEffects ?? []) {
    if (particle.enabled && t >= particle.startTime && t < particle.startTime + particle.duration) {
      processing = true;
      ms += 6;
      reasons.push("particles");
    }
  }
  for (const nested of project.nestedInstances ?? []) {
    if (t >= nested.startTime && t < nested.startTime + nested.duration) {
      processing = true;
      ms += 6 * pixelScale;
      reasons.push("nested sequence");
    }
  }
  if (layers >= 2) {
    processing = true;
    ms += (layers - 1) * 1.5 * pixelScale;
    reasons.push("multi-layer composite");
  }
  return { processing, estimatedMs: ms, reasons: Array.from(new Set(reasons)) };
}

function intervalBoundaries(project: Project, end: number): number[] {
  const points = new Set<number>([0, end]);
  const add = (a: number, b: number) => {
    if (Number.isFinite(a)) points.add(Math.max(0, Math.min(end, a)));
    if (Number.isFinite(b)) points.add(Math.max(0, Math.min(end, b)));
  };
  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) add(clip.startTime, clip.startTime + clip.duration);
    for (const transition of track.transitions ?? []) {
      const a = track.clips.find((c) => c.id === transition.clipAId);
      const b = transition.clipBId ? track.clips.find((c) => c.id === transition.clipBId) : undefined;
      const d = Math.max(0, transition.duration);
      if (a) {
        const cut = b ? b.startTime : a.startTime + a.duration;
        if (transition.edge === "in") add(a.startTime - d, a.startTime + d);
        else add(cut - d, cut + d);
      }
    }
  }
  for (const layer of project.adjustmentLayers ?? []) add(layer.startTime, layer.startTime + layer.duration);
  for (const inst of project.motionInstances ?? []) add(inst.startTime, inst.startTime + inst.duration);
  for (const inst of project.nestedInstances ?? []) add(inst.startTime, inst.startTime + inst.duration);
  for (const fx of project.particleEffects ?? []) add(fx.startTime, fx.startTime + fx.duration);
  return Array.from(points).sort((a, b) => a - b);
}

export interface RenderStatusOptions {
  readonly cachedRuns: readonly FrameRange[];
  /** Mean measured live frame cost (ms) for a time range, when playback has sampled it. */
  readonly measuredMs?: (range: TimeRange) => number | undefined;
  /** Segments at or below this fraction of the frame budget count as real-time. Default 0.6. */
  readonly heavyFraction?: number;
}

/** Classify an estimated/measured per-frame cost against the frame budget. */
export function classifyCost(
  estimatedMs: number,
  measuredMs: number | undefined,
  frameRate: number,
  heavyFraction = 0.6,
): "light" | "heavy" {
  const budget = 1000 / Math.max(1, frameRate);
  if (measuredMs !== undefined) return measuredMs > budget * 1.15 ? "heavy" : "light";
  return estimatedMs > budget * heavyFraction ? "heavy" : "light";
}

/**
 * Build the render-status bar: the timeline split into segments whose cost
 * class is constant, with fully cached stretches reported green. Pure.
 */
export function buildRenderStatusSegments(
  project: Project,
  options: RenderStatusOptions,
): RenderStatusSegment[] {
  const fps = project.settings.frameRate;
  const duration = Math.max(project.timeline.duration, 0);
  if (!(duration > 0) || !(fps > 0)) return [];
  const bounds = intervalBoundaries(project, duration);
  const cachedTimeRanges = normalizeRanges(
    options.cachedRuns.map((run) => ({ start: run.start / fps, end: (run.end + 1) / fps })),
  );
  const out: RenderStatusSegment[] = [];

  for (let i = 0; i + 1 < bounds.length; i++) {
    const interval: Interval = { start: bounds[i], end: bounds[i + 1] };
    if (interval.end - interval.start < 1e-6) continue;
    const cost = costAt(project, mid(interval));
    if (!cost.processing) {
      out.push({ ...interval, level: "none", estimatedMs: 0, reasons: [] });
      continue;
    }
    const measured = options.measuredMs?.(interval);
    const level = classifyCost(cost.estimatedMs, measured, fps, options.heavyFraction);
    const span = framesInRange(interval, fps);
    const frameCount = span ? span.end - span.start + 1 : 0;
    // A segment is green only over frames that are actually cached.
    const cachedHere: TimeRange[] = [];
    for (const run of cachedTimeRanges) {
      const start = Math.max(run.start, interval.start);
      const end = Math.min(run.end, interval.end);
      if (end > start) cachedHere.push({ start, end });
    }
    if (frameCount === 0 || cachedHere.length === 0) {
      out.push({ ...interval, level, estimatedMs: cost.estimatedMs, reasons: cost.reasons });
      continue;
    }
    let cursor = interval.start;
    for (const piece of cachedHere) {
      const start = Math.max(piece.start, interval.start);
      if (start - cursor > 1e-6) {
        out.push({ start: cursor, end: start, level, estimatedMs: cost.estimatedMs, reasons: cost.reasons });
      }
      out.push({ start, end: piece.end, level: "cached", estimatedMs: 0, reasons: cost.reasons });
      cursor = piece.end;
    }
    if (interval.end - cursor > 1e-6) {
      out.push({ start: cursor, end: interval.end, level, estimatedMs: cost.estimatedMs, reasons: cost.reasons });
    }
  }
  return mergeAdjacent(out);
}

function mergeAdjacent(segments: RenderStatusSegment[]): RenderStatusSegment[] {
  const out: RenderStatusSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (
      last &&
      last.level === segment.level &&
      Math.abs(last.end - segment.start) < 1e-6 &&
      (segment.level === "none" || segment.level === "cached" || last.estimatedMs === segment.estimatedMs)
    ) {
      out[out.length - 1] = {
        ...last,
        end: segment.end,
        reasons: Array.from(new Set([...last.reasons, ...segment.reasons])),
      };
    } else {
      out.push(segment);
    }
  }
  return out;
}

/** Running mean of live preview frame cost, bucketed by timeline position. */
export class PlaybackFrameStats {
  private readonly buckets = new Map<number, { mean: number; samples: number }>();

  constructor(
    private readonly bucketSeconds = 0.5,
    private readonly minSamples = 4,
  ) {}

  get size(): number {
    return this.buckets.size;
  }

  record(time: number, ms: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(ms) || ms < 0) return;
    const key = Math.floor(time / this.bucketSeconds);
    const bucket = this.buckets.get(key) ?? { mean: 0, samples: 0 };
    const samples = Math.min(bucket.samples + 1, 24);
    bucket.mean += (ms - bucket.mean) / samples;
    bucket.samples = samples;
    this.buckets.set(key, bucket);
  }

  /** Mean over the range's buckets that have enough samples, else undefined. */
  mean(range: TimeRange): number | undefined {
    const first = Math.floor(range.start / this.bucketSeconds);
    const last = Math.floor((range.end - 1e-9) / this.bucketSeconds);
    let sum = 0;
    let n = 0;
    for (let key = first; key <= last; key++) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.samples >= this.minSamples) {
        sum += bucket.mean;
        n++;
      }
    }
    return n > 0 ? sum / n : undefined;
  }

  /** Measurements for edited ranges are stale: forget them. */
  invalidate(ranges: readonly TimeRange[]): void {
    for (const range of ranges) {
      const first = Math.floor(range.start / this.bucketSeconds);
      const last = Math.floor((range.end - 1e-9) / this.bucketSeconds);
      for (let key = first; key <= last; key++) this.buckets.delete(key);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}
