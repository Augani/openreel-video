import type { EasingType, FitMode, Keyframe } from "../types/timeline";
import { resolveCanvasFitDimensions } from "../video/canvas-fit";

/** Premiere-style auto reframe motion: how eagerly the crop follows the subject. */
export type ReframeMotionPreset = "slower" | "default" | "faster";

/** "person" trusts the person matte only; "auto" falls back to the colour heuristic per frame. */
export type ReframeSubjectMode = "person" | "auto";

/** Subject box in normalized source coordinates (0..1). */
export interface SubjectBox {
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Fraction of the frame covered (0..1). */
  area: number;
}

/** Returns the subject in a frame, or null when none is found. May throw when unavailable. */
export type SubjectDetector = (
  frame: ImageBitmap,
  timeSeconds: number,
) => Promise<SubjectBox | null>;

export interface SubjectSample {
  /** Clip-local seconds. */
  time: number;
  subject: SubjectBox | null;
  source: "person" | "heuristic" | "none";
}

interface MotionParams {
  /** Smoothing time constant in seconds. */
  tau: number;
  /** Half width of the dead zone in normalized source units. */
  deadZone: number;
}

export const REFRAME_MOTION_PARAMS: Record<ReframeMotionPreset, MotionParams> = {
  slower: { tau: 1.2, deadZone: 0.12 },
  default: { tau: 0.6, deadZone: 0.07 },
  faster: { tau: 0.25, deadZone: 0.03 },
};

/** Subject sampling rate used for tracking. */
export const REFRAME_SAMPLE_FPS = 3;
const MAX_SAMPLES = 240;
const ALPHA_THRESHOLD = 128;
const MIN_COMPONENT_FRACTION = 0.01;
/** Matte noise (speckle across a flat scene) has a sparse bounding box or a long thin one; a person is neither. */
const MIN_FILL_RATIO = 0.2;
const MAX_BOX_ASPECT = 4;

interface Component {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
  sumX: number;
  sumY: number;
}

/**
 * Reduce a person matte to the dominant subject. Pieces are labelled as connected
 * components; with several people the largest, most central one wins.
 */
export function subjectFromMask(mask: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): SubjectBox | null {
  const { data, width, height } = mask;
  if (width <= 0 || height <= 0) return null;
  const solid = new Uint8Array(width * height);
  let any = false;
  for (let i = 0; i < solid.length; i++) {
    if (data[i * 4 + 3] >= ALPHA_THRESHOLD) {
      solid[i] = 1;
      any = true;
    }
  }
  if (!any) return null;

  const visited = new Uint8Array(width * height);
  const components: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < solid.length; start++) {
    if (!solid[start] || visited[start]) continue;
    const comp: Component = {
      minX: width,
      maxX: 0,
      minY: height,
      maxY: 0,
      count: 0,
      sumX: 0,
      sumY: 0,
    };
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx - x) / width;
      comp.count++;
      comp.sumX += x;
      comp.sumY += y;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      if (x > 0 && solid[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < width - 1 && solid[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && solid[idx - width] && !visited[idx - width]) {
        visited[idx - width] = 1;
        stack.push(idx - width);
      }
      if (y < height - 1 && solid[idx + width] && !visited[idx + width]) {
        visited[idx + width] = 1;
        stack.push(idx + width);
      }
    }
    components.push(comp);
  }

  const minCount = width * height * MIN_COMPONENT_FRACTION;
  const candidates = components.filter((c) => {
    if (c.count < minCount) return false;
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    return c.count / (bw * bh) >= MIN_FILL_RATIO && bw / bh <= MAX_BOX_ASPECT;
  });
  if (candidates.length === 0) return null;

  const boxes = candidates.map((c) => boxFromComponent(c, width, height));
  return pickDominantSubject(boxes);
}

function boxFromComponent(c: Component, width: number, height: number): SubjectBox {
  const bw = (c.maxX - c.minX + 1) / width;
  const bh = (c.maxY - c.minY + 1) / height;
  return {
    cx: (c.minX + (c.maxX - c.minX + 1) / 2) / width,
    cy: (c.minY + (c.maxY - c.minY + 1) / 2) / height,
    width: bw,
    height: bh,
    area: c.count / (width * height),
  };
}

/** Largest subject, nudged toward the frame centre when sizes are comparable. */
export function pickDominantSubject(boxes: readonly SubjectBox[]): SubjectBox | null {
  let best: SubjectBox | null = null;
  let bestScore = -Infinity;
  for (const box of boxes) {
    const dist = Math.hypot(box.cx - 0.5, box.cy - 0.5);
    const score = box.area * (1 - 0.6 * Math.min(1, dist / 0.7071));
    if (score > bestScore) {
      bestScore = score;
      best = box;
    }
  }
  return best;
}

/** Point of interest for a subject: horizontal centre, upper body vertically. */
function focusOf(subject: SubjectBox): { x: number; y: number } {
  return {
    x: subject.cx,
    y: subject.cy - subject.height * 0.5 + subject.height * 0.4,
  };
}

interface MaskProvider {
  isInitialized(): boolean;
  getPersonMask(
    frame: ImageBitmap,
    options: { timestampMs: number; streamId: string },
  ): Promise<{ mask: { data: Uint8ClampedArray; width: number; height: number } } | null>;
}

/**
 * Person detector backed by the segmentation engine. Throws when the model is
 * not available so the caller can fall back to the colour heuristic.
 */
export function createPersonSubjectDetector(
  engine: MaskProvider,
  streamId: string,
): SubjectDetector {
  return async (frame, timeSeconds) => {
    if (!engine.isInitialized()) throw new Error("Person segmentation unavailable");
    const result = await engine.getPersonMask(frame, {
      timestampMs: timeSeconds * 1000,
      streamId,
    });
    if (!result) throw new Error("Person segmentation unavailable");
    return subjectFromMask(result.mask);
  };
}

export interface SampleSubjectsOptions {
  subject: ReframeSubjectMode;
  primary: SubjectDetector | null;
  fallback: SubjectDetector;
}

/**
 * Detect the subject in each sampled frame. The person detector is primary; the
 * colour heuristic is used when the detector is unavailable (throws or absent)
 * and, in "auto" mode, for frames where no person was found.
 */
export async function sampleSubjects(
  frames: ReadonlyArray<{ bitmap: ImageBitmap; time: number }>,
  options: SampleSubjectsOptions,
): Promise<SubjectSample[]> {
  let primary = options.primary;
  const out: SubjectSample[] = [];
  for (const { bitmap, time } of frames) {
    let subject: SubjectBox | null = null;
    let source: SubjectSample["source"] = "none";
    if (primary) {
      try {
        subject = await primary(bitmap, time);
        if (subject) source = "person";
      } catch {
        primary = null;
      }
    }
    if (!subject && (primary === null || options.subject === "auto")) {
      try {
        subject = await options.fallback(bitmap, time);
        if (subject) source = "heuristic";
      } catch {
        subject = null;
      }
    }
    out.push({ time, subject, source });
  }
  return out;
}

export interface FocusPoint {
  time: number;
  /** Camera centre in normalized source coordinates. */
  x: number;
  y: number;
}

/**
 * Smooth the subject track into a camera path. A dead zone keeps the camera
 * still while the subject moves inside it; beyond it the camera eases toward
 * the subject with the preset's time constant.
 */
export function smoothSubjectPath(
  samples: readonly SubjectSample[],
  motion: ReframeMotionPreset,
  options: { follow?: boolean; centerBias?: number } = {},
): FocusPoint[] {
  const { follow = true, centerBias = 0 } = options;
  const params = REFRAME_MOTION_PARAMS[motion];
  const bias = Math.min(1, Math.max(0, centerBias));

  const targets = samples.map((s) => {
    if (!follow || !s.subject) return null;
    const f = focusOf(s.subject);
    return { x: f.x * (1 - bias) + 0.5 * bias, y: f.y * (1 - bias) + 0.5 * bias };
  });

  const firstIdx = targets.findIndex((t) => t !== null);
  const filled: Array<{ x: number; y: number }> = [];
  let last = firstIdx >= 0 ? targets[firstIdx]! : { x: 0.5, y: 0.5 };
  for (const t of targets) {
    if (t) last = t;
    filled.push(last);
  }

  // Median of three drops one-frame detection glitches while keeping steady motion intact.
  const median3 = (a: number, b: number, c: number) =>
    Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  const robust = filled.map((p, i) => {
    const prev = filled[Math.max(0, i - 1)];
    const next = filled[Math.min(filled.length - 1, i + 1)];
    return { x: median3(prev.x, p.x, next.x), y: median3(prev.y, p.y, next.y) };
  });
  filled.splice(0, filled.length, ...robust);

  const path: FocusPoint[] = [];
  let cam = { ...(filled[0] ?? { x: 0.5, y: 0.5 }) };
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) {
      const dt = Math.max(1e-3, samples[i].time - samples[i - 1].time);
      const alpha = 1 - Math.exp(-dt / params.tau);
      cam = {
        x: cam.x + deadZoneStep(filled[i].x - cam.x, params.deadZone) * alpha,
        y: cam.y + deadZoneStep(filled[i].y - cam.y, params.deadZone) * alpha,
      };
    }
    path.push({ time: samples[i].time, x: cam.x, y: cam.y });
  }
  return path;
}

function deadZoneStep(error: number, dead: number): number {
  const mag = Math.abs(error);
  if (mag <= dead) return 0;
  return Math.sign(error) * (mag - dead);
}

export interface ReframeGeometry {
  sourceWidth: number;
  sourceHeight: number;
  projectWidth: number;
  projectHeight: number;
  fitMode?: FitMode;
}

/** Uniform scale that makes the clip cover the project, and the drawn size at that scale. */
export function reframeLayout(g: ReframeGeometry): {
  scale: number;
  drawWidth: number;
  drawHeight: number;
} {
  const mode: FitMode = g.fitMode === "cover" ? "cover" : "contain";
  const fit = resolveCanvasFitDimensions(
    mode,
    g.sourceWidth,
    g.sourceHeight,
    g.projectWidth,
    g.projectHeight,
  );
  const scale = Math.max(
    g.projectWidth / fit.width,
    g.projectHeight / fit.height,
  );
  return { scale, drawWidth: fit.width, drawHeight: fit.height };
}

/** Transform position (project pixels from centre) that puts the focus point at the crop centre. */
export function positionForFocus(
  focus: { x: number; y: number },
  g: ReframeGeometry,
): { x: number; y: number; scale: number } {
  const { scale, drawWidth, drawHeight } = reframeLayout(g);
  const scaledW = drawWidth * scale;
  const scaledH = drawHeight * scale;
  const maxX = Math.max(0, (scaledW - g.projectWidth) / 2);
  const maxY = Math.max(0, (scaledH - g.projectHeight) / 2);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return {
    x: clamp(-(focus.x - 0.5) * scaledW, maxX),
    y: clamp(-(focus.y - 0.5) * scaledH, maxY),
    scale,
  };
}

/** Normalized source rectangle visible in the output for a given transform. */
export function visibleSourceRect(
  position: { x: number; y: number },
  scale: number,
  g: ReframeGeometry,
): { left: number; top: number; right: number; bottom: number } {
  const { drawWidth, drawHeight } = reframeLayout(g);
  const scaledW = drawWidth * scale;
  const scaledH = drawHeight * scale;
  const cx = 0.5 - position.x / scaledW;
  const cy = 0.5 - position.y / scaledH;
  const hw = g.projectWidth / scaledW / 2;
  const hh = g.projectHeight / scaledH / 2;
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

export const REFRAME_PROPERTIES = ["position.x", "position.y", "scale.x", "scale.y"];
const LINEAR: EasingType = "linear";

function reduceTrack(
  points: ReadonlyArray<{ time: number; value: number }>,
  tolerance: number,
): Array<{ time: number; value: number }> {
  if (points.length <= 2) return [...points];
  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = kept[kept.length - 1];
    const b = points[i + 1];
    const t = (points[i].time - a.time) / (b.time - a.time || 1);
    const expected = a.value + (b.value - a.value) * t;
    if (Math.abs(points[i].value - expected) > tolerance) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/**
 * Convert the camera path to clip transform keyframes, replacing any existing
 * position/scale keyframes and keeping every other property's keyframes.
 */
export function buildReframeKeyframes(
  clipId: string,
  path: readonly FocusPoint[],
  geometry: ReframeGeometry,
  existing: readonly Keyframe[] = [],
): Keyframe[] {
  const kept = existing.filter((k) => !REFRAME_PROPERTIES.includes(k.property));
  if (path.length === 0) return [...kept];

  const placed = path.map((p) => ({
    time: p.time,
    ...positionForFocus({ x: p.x, y: p.y }, geometry),
  }));
  const px = reduceTrack(
    placed.map((p) => ({ time: p.time, value: p.x })),
    0.5,
  );
  const py = reduceTrack(
    placed.map((p) => ({ time: p.time, value: p.y })),
    0.5,
  );
  const scale = placed[0].scale;

  const make = (
    property: string,
    time: number,
    value: number,
    i: number,
  ): Keyframe => ({
    id: `reframe-${clipId}-${property}-${i}`,
    time,
    property,
    value,
    easing: LINEAR,
  });

  return [
    ...kept,
    make("scale.x", 0, scale, 0),
    make("scale.y", 0, scale, 0),
    ...px.map((p, i) => make("position.x", p.time, p.value, i)),
    ...py.map((p, i) => make("position.y", p.time, p.value, i)),
  ];
}

/** Clip-local sample times at the tracking rate, always including the last frame. */
export function reframeSampleTimes(duration: number): number[] {
  if (!(duration > 0)) return [0];
  const step = Math.max(1 / REFRAME_SAMPLE_FPS, duration / MAX_SAMPLES);
  const times: number[] = [];
  for (let t = 0; t < duration; t += step) times.push(Number(t.toFixed(4)));
  times.push(duration);
  return times;
}

/** Media time for a clip-local time, honouring speed and reverse. */
export function clipLocalToSourceTime(
  clip: { inPoint: number; outPoint: number; speed?: number; reversed?: boolean },
  localTime: number,
): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const raw = clip.reversed
    ? clip.outPoint - localTime * speed
    : clip.inPoint + localTime * speed;
  return Math.max(clip.inPoint, Math.min(clip.outPoint - 1e-3, raw));
}

/**
 * Merge freshly computed reframe keyframes into the clip's current keyframes, so
 * edits made to other properties while tracking ran are not overwritten.
 */
export function mergeReframeKeyframes(
  current: readonly Keyframe[] | undefined,
  computed: readonly Keyframe[],
): Keyframe[] {
  return [
    ...(current ?? []).filter((k) => !REFRAME_PROPERTIES.includes(k.property)),
    ...computed.filter((k) => REFRAME_PROPERTIES.includes(k.property)),
  ];
}
