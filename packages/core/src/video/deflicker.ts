/**
 * Deflicker: temporal luma / colour normalisation with scene-cut detection.
 *
 * Deflicker is a pixel effect (a per-channel gain) whose gain depends on the
 * NEIGHBOUR frames of the clip, so the decision is made here, as a pure function
 * of the clip's own frames and the effect parameters:
 *
 *  1. planDeflickerWindow: the clip-local times of the window frames. The centre
 *     is snapped to the source frame grid and the window never reaches outside
 *     the clip, so preview, scrubbing and export read the same frames.
 *  2. frameStats / statsFromRgba: the mean luma, mean R / G / B and a 16x9 luma
 *     thumbnail of one frame (taken after the effects stacked above Deflicker).
 *  3. deflickerGains: finds scene cuts in the window (a structural change that a
 *     global brightness change cannot cause: thumbnails are compared after being
 *     divided by their own mean), keeps only the frames of the centre frame's
 *     shot, fits the trend of the window and returns the per-channel gain that
 *     moves the centre frame onto it. Frames across a cut never contribute, so a
 *     cut is neither smoothed nor lagged.
 *
 * The pixel pass (CPU applyDeflicker here, the GLSL shader in
 * pro-effect-shaders-repair.ts) multiplies each channel by that gain. Without
 * gains it is the identity, so a stand-alone render of the effect never changes
 * a frame it knows nothing about.
 */

export const DEFLICKER_MIN_WINDOW = 3;
export const DEFLICKER_MAX_WINDOW = 31;
export const THUMB_W = 16;
export const THUMB_H = 9;
/** Stats are measured on this reduced frame (box-averaged), never on the full-resolution one. */
export const STATS_W = 64;
export const STATS_H = 36;

const MIN_MEAN = 0.02;

export interface DeflickerParams {
  /** Frames in the window (odd, 3..31). */
  readonly window: number;
  /** Luma correction, 0..1. */
  readonly luma: number;
  /** Colour (channel balance) correction, 0..1. */
  readonly color: number;
  /** Scene-cut sensitivity, 0..1: higher splits the window on smaller structural changes. */
  readonly sensitivity: number;
  /** Largest gain change either way, 0..1 (0.5 = gains stay within 0.5..1.5). */
  readonly limit: number;
}

const finite = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Reads stored (possibly keyframed, possibly partial) params into valid values. */
export function resolveDeflicker(params: Readonly<Record<string, unknown>>): DeflickerParams {
  const w = Math.round(clamp(finite(params.window, 15), DEFLICKER_MIN_WINDOW, DEFLICKER_MAX_WINDOW));
  return {
    window: w % 2 === 0 ? w + 1 : w,
    luma: clamp(finite(params.luma, 0), 0, 100) / 100,
    color: clamp(finite(params.color, 0), 0, 100) / 100,
    sensitivity: clamp(finite(params.sensitivity, 50), 0, 100) / 100,
    limit: clamp(finite(params.limit, 50), 0, 100) / 100,
  };
}

export function isDeflickerNeutral(params: Readonly<Record<string, unknown>>): boolean {
  const p = resolveDeflicker(params);
  return p.luma === 0 && p.color === 0;
}

/** Half the window: how many frames are read on each side of the current frame. */
export function deflickerHalfWindow(window: number): number {
  return Math.floor(window / 2);
}

/* -------------------------------------------------------------------------- */
/* Window planning                                                             */
/* -------------------------------------------------------------------------- */

export interface DeflickerWindowFrame {
  /** Offset in frames from the current frame (negative = earlier). */
  readonly offset: number;
  /** Clip-local time of the frame, seconds. */
  readonly localTime: number;
}

/** Tolerance that keeps `n / fps` products from dropping a frame at the clip end. */
const EPS = 1e-6;

/**
 * Frames the window covers around clip-local `localTime`. The time is snapped to
 * the nearest frame of a `fps` grid; frames before the clip or past its last
 * frame are not part of the window. Always contains offset 0.
 */
export function planDeflickerWindow(
  localTime: number,
  clipDuration: number,
  fps: number,
  window: number,
): DeflickerWindowFrame[] {
  const rate = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const half = deflickerHalfWindow(window);
  const centre = Math.round(localTime * rate);
  const lastFrame = Math.max(0, Math.ceil(clipDuration * rate - EPS) - 1);
  const out: DeflickerWindowFrame[] = [];
  for (let k = -half; k <= half; k++) {
    const index = centre + k;
    if (k !== 0 && (index < 0 || index > lastFrame)) continue;
    out.push({ offset: k, localTime: Math.max(0, index / rate) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Frame statistics                                                            */
/* -------------------------------------------------------------------------- */

export interface FrameStats {
  readonly y: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** THUMB_W x THUMB_H mean luma, 0..1. */
  readonly thumb: Float32Array;
}

const lumaOf = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Box-averages straight RGBA `data` (width x height) down to tw x th, returned as
 * 0..1 floats (RGBA, alpha untouched by the average). Pixel `(x, y)` belongs to
 * the cell `floor(x * tw / width)`, so every pixel counts exactly once.
 */
export function boxDownsample(
  data: ArrayLike<number>,
  width: number,
  height: number,
  tw: number,
  th: number,
): Float32Array {
  const sum = new Float64Array(tw * th * 3);
  const count = new Float64Array(tw * th);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(th - 1, Math.floor((y * th) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(tw - 1, Math.floor((x * tw) / width));
      const c = cy * tw + cx;
      const i = (y * width + x) * 4;
      sum[c * 3] += data[i];
      sum[c * 3 + 1] += data[i + 1];
      sum[c * 3 + 2] += data[i + 2];
      count[c]++;
    }
  }
  const out = new Float32Array(tw * th * 4);
  for (let c = 0; c < tw * th; c++) {
    const n = Math.max(1, count[c]) * 255;
    out[c * 4] = sum[c * 3] / n;
    out[c * 4 + 1] = sum[c * 3 + 1] / n;
    out[c * 4 + 2] = sum[c * 3 + 2] / n;
    out[c * 4 + 3] = 1;
  }
  return out;
}

/** Stats of an already reduced RGBA frame (any size that is a multiple of the thumbnail grid, e.g. STATS_W x STATS_H). */
export function statsFromRgba(
  data: ArrayLike<number>,
  width: number,
  height: number,
): FrameStats {
  const small = boxDownsample(data, width, height, STATS_W, STATS_H);
  let r = 0;
  let g = 0;
  let b = 0;
  const cells = STATS_W * STATS_H;
  for (let c = 0; c < cells; c++) {
    r += small[c * 4];
    g += small[c * 4 + 1];
    b += small[c * 4 + 2];
  }
  r /= cells;
  g /= cells;
  b /= cells;
  const thumb = new Float32Array(THUMB_W * THUMB_H);
  const bx = STATS_W / THUMB_W;
  const by = STATS_H / THUMB_H;
  for (let ty = 0; ty < THUMB_H; ty++) {
    for (let tx = 0; tx < THUMB_W; tx++) {
      let acc = 0;
      for (let y = 0; y < by; y++) {
        for (let x = 0; x < bx; x++) {
          const c = (ty * by + y) * STATS_W + tx * bx + x;
          acc += lumaOf(small[c * 4], small[c * 4 + 1], small[c * 4 + 2]);
        }
      }
      thumb[ty * THUMB_W + tx] = acc / (bx * by);
    }
  }
  return { y: lumaOf(r, g, b), r, g, b, thumb };
}

/* -------------------------------------------------------------------------- */
/* Scene cuts                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Structural difference of two frames: the mean absolute difference of their
 * thumbnails after each is divided by its own mean, so a uniform brightness
 * change (flicker) scores 0 and a different picture scores high.
 */
export function structuralDifference(a: FrameStats, b: FrameStats): number {
  const ma = Math.max(a.y, MIN_MEAN);
  const mb = Math.max(b.y, MIN_MEAN);
  let acc = 0;
  for (let i = 0; i < a.thumb.length; i++) acc += Math.abs(a.thumb[i] / ma - b.thumb[i] / mb);
  return acc / a.thumb.length;
}

/** Structural difference above which two consecutive frames belong to different shots. */
export function cutThreshold(sensitivity: number): number {
  // A missed cut lags the correction across two shots; a false cut only shortens a window, so lean towards cutting.
  return 0.3 - 0.26 * clamp(sensitivity, 0, 1);
}

export function isSceneCut(a: FrameStats, b: FrameStats, sensitivity: number): boolean {
  return structuralDifference(a, b) > cutThreshold(sensitivity);
}

/* -------------------------------------------------------------------------- */
/* Gains                                                                       */
/* -------------------------------------------------------------------------- */

export interface DeflickerGains {
  /** Final multiplier per channel (luma and colour correction combined). */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Number of frames of the centre frame's shot inside the window (1 = nothing to compare with). */
  readonly frames: number;
}

export const IDENTITY_GAINS: DeflickerGains = { r: 1, g: 1, b: 1, frames: 1 };

/**
 * The frames of the window that belong to the centre frame's shot. `stats` are
 * the window frames in time order and `centre` the index of the current frame;
 * the shot grows outwards from the centre until a scene cut.
 */
export function shotRange(
  stats: readonly FrameStats[],
  centre: number,
  sensitivity: number,
): { readonly start: number; readonly end: number } {
  let start = centre;
  while (start > 0 && !isSceneCut(stats[start - 1], stats[start], sensitivity)) start--;
  let end = centre;
  while (end < stats.length - 1 && !isSceneCut(stats[end], stats[end + 1], sensitivity)) end++;
  return { start, end };
}

/**
 * Value of the least-squares line through (offset, value) at offset 0: it follows
 * a fade or a slow exposure change exactly while averaging flicker away. Shots too
 * short to fit a line use the mean.
 */
function trendAtCentre(offsets: readonly number[], values: readonly number[]): number {
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;
  if (n < 5) return mean;
  let mo = 0;
  for (const o of offsets) mo += o;
  mo /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (offsets[i] - mo) * (offsets[i] - mo);
    sxy += (offsets[i] - mo) * (values[i] - mean);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return mean - slope * mo;
}

/**
 * Gains that move the centre frame onto the trend of its shot. `offsets[i]` is the
 * frame offset of `stats[i]` from the current frame.
 */
export function deflickerGains(
  stats: readonly FrameStats[],
  offsets: readonly number[],
  params: Readonly<Record<string, unknown>>,
): DeflickerGains {
  const p = resolveDeflicker(params);
  const centre = offsets.indexOf(0);
  if (centre < 0 || stats.length === 0) return IDENTITY_GAINS;
  const { start, end } = shotRange(stats, centre, p.sensitivity);
  const frames = end - start + 1;
  if (frames < 2) return IDENTITY_GAINS;
  const shot = stats.slice(start, end + 1);
  const off = offsets.slice(start, end + 1);
  const target = (pick: (s: FrameStats) => number): number =>
    trendAtCentre(off, shot.map(pick));
  const cur = stats[centre];
  const gy = target((s) => s.y) / Math.max(cur.y, MIN_MEAN);
  const gr = target((s) => s.r) / Math.max(cur.r, MIN_MEAN);
  const gg = target((s) => s.g) / Math.max(cur.g, MIN_MEAN);
  const gb = target((s) => s.b) / Math.max(cur.b, MIN_MEAN);
  const mix = (g: number, amount: number): number => 1 + (g - 1) * amount;
  const lim = (g: number): number => clamp(g, 1 - p.limit, 1 + p.limit);
  const channel = (gc: number): number => {
    // Colour correction is the channel's gain relative to the luma gain, so luma and colour strength are independent.
    const rel = gc / Math.max(gy, 1e-3);
    return lim(mix(gy, p.luma) * mix(rel, p.color));
  };
  return { r: channel(gr), g: channel(gg), b: channel(gb), frames };
}

/* -------------------------------------------------------------------------- */
/* Pixel pass                                                                  */
/* -------------------------------------------------------------------------- */

/** Raw (non-spec) params the render path adds to a Deflicker effect once it has the gains. */
export const DEFLICKER_GAIN_KEYS = ["gainR", "gainG", "gainB"] as const;

export function deflickerGainParams(g: DeflickerGains): Record<string, number> {
  return { gainR: g.r, gainG: g.g, gainB: g.b };
}

export function readDeflickerGains(raw: Readonly<Record<string, unknown>>): [number, number, number] {
  const f = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1);
  return [f(raw.gainR), f(raw.gainG), f(raw.gainB)];
}

/** CPU reference: multiplies the colour channels by the gains (alpha untouched). */
export function applyDeflicker(
  data: Uint8ClampedArray,
  gains: readonly [number, number, number],
): void {
  if (gains[0] === 1 && gains[1] === 1 && gains[2] === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * gains[0]);
    data[i + 1] = Math.round(data[i + 1] * gains[1]);
    data[i + 2] = Math.round(data[i + 2] * gains[2]);
  }
}

/* -------------------------------------------------------------------------- */
/* Render routing                                                              */
/* -------------------------------------------------------------------------- */

interface EffectLike {
  readonly id?: string;
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** The first enabled, non-neutral Deflicker of a stack, with its index. */
export function findActiveDeflicker(
  effects: readonly EffectLike[],
): { readonly index: number } | null {
  for (let index = 0; index < effects.length; index++) {
    const e = effects[index];
    if (e.type === "deflicker" && e.enabled !== false && !isDeflickerNeutral(e.params ?? {})) return { index };
  }
  return null;
}

/**
 * Does the clip need neighbour frames to render? True for an enabled, non-neutral
 * Deflicker, or for keyframes on a Deflicker (which can switch it on).
 */
export function clipHasDeflicker(clip: {
  readonly effects?: readonly EffectLike[];
  readonly keyframes?: readonly { readonly property: string }[];
}): boolean {
  const effects = clip.effects ?? [];
  if (findActiveDeflicker(effects)) return true;
  const ids = new Set(effects.filter((e) => e.type === "deflicker" && e.id).map((e) => e.id));
  return (
    clip.keyframes?.some((k) => {
      if (k.property.startsWith("effect.deflicker.")) return true;
      if (!k.property.startsWith("fx:")) return false;
      const body = k.property.slice(3);
      const split = body.lastIndexOf(":");
      return split > 0 && ids.has(body.slice(0, split));
    }) ?? false
  );
}
