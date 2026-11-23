/**
 * Harmonic (overtone-following) selection: pick a fundamental (a click, or the strongest peak inside a box) and the tool
 * follows its pitch through time and selects its overtones as ONE region.
 *
 * Tracking. A 2048-point STFT with a 256-sample hop (a pitch frame every 5 ms at 48 kHz). For every frame the fundamental
 * is the f0 that maximises a harmonic salience, the sum over the first partials h of sqrt(|X(h * f0)|), searched on a 1-cent
 * grid around a prediction (the previous f0 extended by its slope, so a glide is followed and a vibrato is not lost) and
 * refined with a parabola through the three best grid points. Every partial votes at its own multiple of f0, so the estimate
 * is as sharp as the highest partials are, not as coarse as the fundamental's bin. Tracking runs from the seed to both ends
 * and stops where the partials fade (total partial magnitude 30 dB below the seed's, or no longer standing above the
 * between-partial floor) for a few frames in a row.
 *
 * The track is simplified (Douglas-Peucker, in cents) to a few hundred points and stored as the region's `points`; the band of
 * every partial is derived from the track when rendering, so a stored region never depends on this tracker again.
 */
import { MAX_SPECTRAL_POINTS, DEFAULT_SPECTRAL_HARMONICS, type SpectralPoint } from "./spectral-regions";
import { analyseFrame, getStftPlan, stftFrameRange, type StftPlan } from "./spectral-stft";

const TRACK_SIZE = 2048;
const TRACK_HOP = 256;
/** Partials that vote on the pitch (more gives a sharper estimate but costs more, and high partials of a voice are weak). */
const VOTING_PARTIALS = 12;
/** Half-width of the per-frame search around the prediction, cents. */
const STEP_SEARCH_CENTS = 60;
/** Half-width of the search around the seed, cents. */
const SEED_SEARCH_CENTS = 200;
/** Total partial magnitude (dB below the seed frame's) at which the sound counts as having ended. */
const STOP_DB = 30;
/** Peak-to-between-partials magnitude ratio below which a frame no longer counts as harmonic. */
const MIN_CONTRAST = 1.5;
/** Cosine similarity of the partial-magnitude profile (sqrt-compressed) with the track's running reference below which a frame is not the same sound. */
const MIN_PROFILE_SIMILARITY = 0.8;
/** A partial counts as standing out when it is this many times above the spectrum two to three bins either side of it. */
const PARTIAL_PROMINENCE = 2;
/** Weak frames in a row that end the track. */
const MAX_WEAK_FRAMES = 4;

export interface HarmonicTrackOptions {
  /** Partials the region will select (the fundamental counts as 1). Tracking itself uses up to 12. */
  readonly harmonics?: number;
  readonly maxHz?: number;
  /** Limit the track to this source-time window (a box selection's span). Default: the whole source. */
  readonly startTime?: number;
  readonly endTime?: number;
  /** Longest stretch tracked each side of the seed, seconds (default 60), so a click in a long recording cannot stall the editor. */
  readonly maxSeconds?: number;
}

export type HarmonicTrackResult =
  | { readonly ok: true; readonly points: SpectralPoint[]; readonly seed: SpectralPoint; readonly frames: number }
  | { readonly ok: false; readonly reason: "no-signal" | "out-of-range" };

class Spectra {
  readonly plan: StftPlan = getStftPlan(TRACK_SIZE, TRACK_HOP);
  private readonly cache = new Map<number, Float32Array>();
  private readonly scratch = new Float32Array(TRACK_SIZE);
  constructor(readonly signal: Float32Array, readonly sampleRate: number) {}
  get binHz(): number {
    return this.sampleRate / TRACK_SIZE;
  }
  centre(m: number): number {
    return (m * TRACK_HOP + TRACK_SIZE / 2) / this.sampleRate;
  }
  frameAt(t: number): number {
    return Math.round((t * this.sampleRate - TRACK_SIZE / 2) / TRACK_HOP);
  }
  mags(m: number): Float32Array {
    let out = this.cache.get(m);
    if (!out) {
      const { real, imag } = analyseFrame(this.plan, this.signal, m * TRACK_HOP, this.scratch);
      out = new Float32Array(TRACK_SIZE / 2 + 1);
      for (let k = 0; k < out.length; k += 1) out[k] = Math.hypot(real[k], imag[k]);
      if (this.cache.size > 4096) this.cache.clear();
      this.cache.set(m, out);
    }
    return out;
  }
  /** Linear interpolation of the magnitude spectrum at a frequency. */
  at(mags: Float32Array, hz: number): number {
    const p = hz / this.binHz;
    const i = Math.floor(p);
    if (i < 0 || i + 1 >= mags.length) return 0;
    const f = p - i;
    return mags[i] * (1 - f) + mags[i + 1] * f;
  }
}

/** Number of partials that vote for an f0, bounded by the partial count wanted, the ceiling and Nyquist. */
const votingPartials = (f0: number, wanted: number, maxHz: number, sampleRate: number): number =>
  Math.max(1, Math.min(VOTING_PARTIALS, wanted, Math.floor(Math.min(maxHz, sampleRate * 0.45) / f0)));

function salience(sp: Spectra, mags: Float32Array, f0: number, partials: number): number {
  let sum = 0;
  for (let h = 1; h <= partials; h += 1) sum += Math.sqrt(sp.at(mags, h * f0));
  return sum;
}

function strength(sp: Spectra, mags: Float32Array, f0: number, partials: number): { total: number; contrast: number } {
  let peaks = 0;
  let between = 0;
  for (let h = 1; h <= partials; h += 1) {
    peaks += sp.at(mags, h * f0);
    between += 0.5 * (sp.at(mags, (h - 0.5) * f0) + sp.at(mags, (h + 0.5) * f0));
  }
  return { total: peaks, contrast: peaks / (between + 1e-12) };
}

/** Square-rooted magnitudes of the first `partials` partials of an f0, and how many of them stand out from their flanks. */
function profile(sp: Spectra, mags: Float32Array, f0: number, partials: number): { values: Float64Array; prominent: number } {
  const values = new Float64Array(partials);
  let prominent = 0;
  for (let h = 1; h <= partials; h += 1) {
    const centre = sp.at(mags, h * f0);
    values[h - 1] = Math.sqrt(centre);
    const flank = 0.5 * (sp.at(mags, h * f0 - 3 * sp.binHz) + sp.at(mags, h * f0 + 3 * sp.binHz));
    if (centre > PARTIAL_PROMINENCE * flank) prominent += 1;
  }
  return { values, prominent };
}

const cosine = (a: Float64Array, b: Float64Array): number => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / (Math.sqrt(aa * bb) + 1e-12);
};

/** Best f0 within +-`cents` of `centre` Hz on a 1-cent grid, parabola-refined; returns its salience too. */
function searchF0(sp: Spectra, mags: Float32Array, centre: number, cents: number, wanted: number, maxHz: number): { f0: number; score: number } {
  const n = 2 * cents + 1;
  const scores = new Float64Array(n);
  let bestI = 0;
  let best = -1;
  for (let i = 0; i < n; i += 1) {
    const f = centre * Math.pow(2, (i - cents) / 1200);
    scores[i] = salience(sp, mags, f, votingPartials(f, wanted, maxHz, sp.sampleRate));
    if (scores[i] > best) {
      best = scores[i];
      bestI = i;
    }
  }
  let offset = 0;
  if (bestI > 0 && bestI < n - 1) {
    const a = scores[bestI - 1];
    const b = scores[bestI];
    const c = scores[bestI + 1];
    const d = a - 2 * b + c;
    if (d < 0) offset = Math.max(-1, Math.min(1, (0.5 * (a - c)) / d));
  }
  return { f0: centre * Math.pow(2, (bestI + offset - cents) / 1200), score: best };
}

/** Douglas-Peucker on (t, log2 f0 in cents scaled to the same unit) so a vibrato keeps its turning points. */
function simplify(points: SpectralPoint[], epsilonCents: number): SpectralPoint[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const u = (points[i].t - points[a].t) / (points[b].t - points[a].t);
      const interp = points[a].hz * Math.pow(points[b].hz / points[a].hz, u);
      const err = Math.abs(1200 * Math.log2(points[i].hz / interp));
      if (err > worst) {
        worst = err;
        at = i;
      }
    }
    if (at >= 0 && worst > epsilonCents) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplifies a track to at most MAX_SPECTRAL_POINTS points, with the smallest tolerance that fits. */
export function simplifyTrack(points: SpectralPoint[]): SpectralPoint[] {
  let epsilon = 0.75;
  let out = simplify(points, epsilon);
  while (out.length > MAX_SPECTRAL_POINTS && epsilon < 400) {
    epsilon *= 1.5;
    out = simplify(points, epsilon);
  }
  return out;
}

/**
 * The strongest spectral peak inside a box as a seed (time and Hz of its loudest cell), or null when the box is silent. Peaks are
 * located on the finer tracking STFT and refined with a parabola.
 */
export function findBoxSeed(signal: Float32Array, sampleRate: number, box: { startTime: number; endTime: number; lowHz: number; highHz: number }): SpectralPoint | null {
  const sp = new Spectra(signal, sampleRate);
  const m0 = Math.max(0, sp.frameAt(box.startTime));
  const m1 = Math.min(stftFrameRange(signal.length, sp.plan).last, sp.frameAt(box.endTime));
  const k0 = Math.max(1, Math.floor(box.lowHz / sp.binHz));
  const k1 = Math.min(TRACK_SIZE / 2 - 1, Math.ceil(box.highHz / sp.binHz));
  let best = 0;
  let bm = -1;
  let bk = -1;
  for (let m = m0; m <= m1; m += 1) {
    const mags = sp.mags(m);
    for (let k = k0; k <= k1; k += 1) {
      if (mags[k] > best && mags[k] >= mags[k - 1] && mags[k] >= mags[k + 1]) {
        best = mags[k];
        bm = m;
        bk = k;
      }
    }
  }
  if (bm < 0 || best <= 1e-9) return null;
  const mags = sp.mags(bm);
  const a = Math.log(mags[bk - 1] + 1e-12);
  const b = Math.log(mags[bk] + 1e-12);
  const c = Math.log(mags[bk + 1] + 1e-12);
  const d = a - 2 * b + c;
  const offset = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
  return { t: sp.centre(bm), hz: (bk + offset) * sp.binHz };
}

export function trackHarmonics(signal: Float32Array, sampleRate: number, seed: SpectralPoint, options: HarmonicTrackOptions = {}): HarmonicTrackResult {
  if (signal.length === 0) return { ok: false, reason: "no-signal" };
  const wanted = Math.max(1, Math.round(options.harmonics ?? DEFAULT_SPECTRAL_HARMONICS));
  const maxHz = options.maxHz ?? 20000;
  const sp = new Spectra(signal, sampleRate);
  const range = stftFrameRange(signal.length, sp.plan);
  const lastFrame = Math.max(0, range.last);
  const reach = Math.ceil(((options.maxSeconds ?? 60) * sampleRate) / TRACK_HOP);
  const seedAt = sp.frameAt(seed.t);
  const lo = Math.max(0, seedAt - reach, options.startTime !== undefined ? sp.frameAt(options.startTime) : 0);
  const hi = Math.min(lastFrame, seedAt + reach, options.endTime !== undefined ? sp.frameAt(options.endTime) : lastFrame);
  const seedFrame = Math.max(lo, Math.min(hi, seedAt));
  if (seed.hz < 20 || seed.hz * 1.2 > sampleRate / 2 || hi < lo) return { ok: false, reason: "out-of-range" };

  const refined = searchF0(sp, sp.mags(seedFrame), seed.hz, SEED_SEARCH_CENTS, wanted, maxHz);
  const seedPartials = votingPartials(refined.f0, wanted, maxHz, sampleRate);
  const seedStrength = strength(sp, sp.mags(seedFrame), refined.f0, seedPartials).total;
  if (seedStrength <= 1e-9) return { ok: false, reason: "no-signal" };
  const floor = seedStrength * Math.pow(10, -STOP_DB / 20);

  const seedProfile = profile(sp, sp.mags(seedFrame), refined.f0, seedPartials);
  const walk = (step: 1 | -1): SpectralPoint[] => {
    const out: SpectralPoint[] = [];
    const reference = Float64Array.from(seedProfile.values);
    let logPrev = Math.log2(refined.f0);
    let slope = 0;
    let weak = 0;
    for (let m = seedFrame + step; m >= lo && m <= hi; m += step) {
      const predicted = Math.pow(2, logPrev + slope * 0.8);
      const mags = sp.mags(m);
      const { f0 } = searchF0(sp, mags, predicted, STEP_SEARCH_CENTS, wanted, maxHz);
      const partials = votingPartials(f0, wanted, maxHz, sampleRate);
      const s = strength(sp, mags, f0, partials);
      const p = profile(sp, mags, f0, partials);
      const sameShape = partials === seedPartials ? cosine(p.values, reference) : 1;
      if (s.total < floor || s.contrast < MIN_CONTRAST || sameShape < MIN_PROFILE_SIMILARITY || p.prominent < Math.ceil(partials / 2)) {
        weak += 1;
        if (weak >= MAX_WEAK_FRAMES) break;
        // Hold the prediction through a brief dropout.
        logPrev += slope * 0.8;
        out.push({ t: sp.centre(m), hz: predicted });
        continue;
      }
      weak = 0;
      if (partials === seedPartials && sameShape > 0.9) for (let i = 0; i < reference.length; i += 1) reference[i] = 0.9 * reference[i] + 0.1 * p.values[i];
      const logNow = Math.log2(f0);
      slope = 0.5 * slope + 0.5 * (logNow - logPrev);
      logPrev = logNow;
      out.push({ t: sp.centre(m), hz: f0 });
    }
    return out.slice(0, Math.max(0, out.length - weak));
  };
  const after = walk(1);
  const before = walk(-1).reverse();
  const all = [...before, { t: sp.centre(seedFrame), hz: refined.f0 }, ...after];
  if (all.length < 2) {
    // A seed whose neighbours are silent: widen to the seed frame's own span so a region can still be made.
    return { ok: false, reason: "no-signal" };
  }
  return { ok: true, points: simplifyTrack(all), seed: { t: sp.centre(seedFrame), hz: refined.f0 }, frames: all.length };
}
