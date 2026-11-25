import type { BezierPath, MaskKeyframe } from "../mask-engine";

export interface SimplifyKeyframeOptions {
  /** The largest distance (in pixels of the composition) any outline point, handle included, may move from the original track. */
  readonly tolerance: number;
  /** Composition size the normalised paths are measured in. */
  readonly width: number;
  readonly height: number;
}

/** Flat pixel vector of a path: every point and handle, so the error covers the curve and not only its vertices. */
function vectorOf(path: BezierPath, width: number, height: number): Float64Array {
  const out = new Float64Array(path.points.length * 6);
  path.points.forEach((p, i) => {
    const hi = p.handleIn ?? p;
    const ho = p.handleOut ?? p;
    out.set([p.x * width, p.y * height, hi.x * width, hi.y * height, ho.x * width, ho.y * height], i * 6);
  });
  return out;
}

/** Largest point distance (px) between two vectors made by `vectorOf`. */
function worstPointDistance(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 2) worst = Math.max(worst, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
  return worst;
}

/**
 * Ramer-Douglas-Peucker over time. A tracked mask has one keyframe per frame; most of them lie on the straight
 * line (in outline space) between their neighbours. The keyframe whose outline is furthest from the linear
 * interpolation of the kept ones is kept, recursively, until nothing is further than `tolerance` px. The first and
 * last keyframe always stay, so a track keeps its range. Tracks the engine would not interpolate linearly (mixed
 * point counts, eased keyframes) come back unchanged.
 */
export function simplifyMaskKeyframes(keyframes: readonly MaskKeyframe[], options: SimplifyKeyframeOptions): MaskKeyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const n = sorted.length;
  if (n <= 2 || !(options.tolerance > 0)) return sorted;
  const count = sorted[0].path.points.length;
  if (count === 0 || sorted.some((k) => k.path.points.length !== count || k.path.closed !== sorted[0].path.closed || k.easing !== "linear")) return sorted;
  const vectors = sorted.map((k) => vectorOf(k.path, options.width, options.height));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const scratch = new Float64Array(vectors[0].length);
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    const t0 = sorted[from].time;
    const span = sorted[to].time - t0;
    let worst = -1;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const t = span > 0 ? (sorted[i].time - t0) / span : 0;
      const a = vectors[from];
      const b = vectors[to];
      for (let k = 0; k < scratch.length; k++) scratch[k] = a[k] + (b[k] - a[k]) * t;
      const d = worstPointDistance(scratch, vectors[i]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > options.tolerance && at > 0) {
      keep[at] = 1;
      stack.push([from, at], [at, to]);
    }
  }
  return sorted.filter((_, i) => keep[i] === 1);
}
