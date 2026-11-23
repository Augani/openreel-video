/**
 * Spectral repair regions: the data model stored in a clip's "spectralRepair" audio effect.
 *
 * Regions live in SOURCE time (seconds of the decoded media), not clip time, so trimming, moving,
 * retiming or reversing the clip never shifts an edit off the sound it was painted on. This module
 * is deliberately free of DSP so the realtime graph and the export engine can import it cheaply.
 */
import type { Effect } from "../../types/timeline";

export const SPECTRAL_REPAIR_EFFECT_TYPE = "spectralRepair";
export const MAX_SPECTRAL_REGIONS = 256;
/** Deepest attenuation a region can ask for (below this "remove" is the right tool). */
export const MIN_SPECTRAL_ATTENUATION_DB = -120;
export const DEFAULT_SPECTRAL_ATTENUATION_DB = -12;
const MAX_REGION_HZ = 192000;
const MIN_REGION_SECONDS = 1e-4;

/** Params version of the "spectralRepair" effect. 1 = rectangles with attenuate/remove (the original format); 2 adds lasso / brush masks and heal. */
export const SPECTRAL_REGIONS_VERSION = 2;
/** 3 adds magic-wand cell masks, harmonic (overtone-following) regions and a per-region stereo channel. A list that uses none of them is still written as 1 or 2, so older builds keep opening it. */
export const SPECTRAL_REGIONS_VERSION_3 = 3;
export const MAX_SPECTRAL_HARMONICS = 64;
export const DEFAULT_SPECTRAL_HARMONICS = 8;
export const DEFAULT_HARMONIC_BAND_CENTS = 50;
export const MIN_HARMONIC_BAND_CENTS = 5;
export const MAX_HARMONIC_BAND_CENTS = 400;
/** Largest wand mask grid (cells) and run-length list a stored wand may carry. */
export const MAX_WAND_CELLS = 4_000_000;
export const MAX_WAND_RUNS = 120_000;
/** Version of the stored wand mask layout (separate from the effect version so the cell layout can change on its own). */
export const SPECTRAL_WAND_VERSION = 1;
export const MAX_SPECTRAL_POINTS = 512;
export const MAX_SPECTRAL_FEATHER = 8;
export const DEFAULT_SPECTRAL_FEATHER = 1;
export const DEFAULT_BRUSH_SECONDS = 0.04;
export const DEFAULT_BRUSH_OCTAVES = 0.12;
/** Lowest frequency the log-axis geometry of a mask uses (the axis is logarithmic, so 0 Hz has no position). */
export const MASK_MIN_HZ = 20;

/**
 * attenuate: scale the selection by `gainDb`. remove: replace it by interpolating the surrounding frames/bins with a
 * noise-like phase. heal: refill it with the surrounding background at its own level and texture (power interpolation, phase continuation from both sides,
 * a fixed number of smooth consistency passes), carrying steady partials through short gaps.
 */
export type SpectralRegionMode = "attenuate" | "remove" | "heal";
/**
 * rect: the box startTime..endTime x lowHz..highHz (every region saved before v2 is one). lasso: a free-form polygon. brush: a painted stroke.
 * wand: a stored cell mask on an STFT grid (the result of a magic-wand click). harmonic: a fundamental track plus its overtones.
 */
export type SpectralRegionShape = "rect" | "lasso" | "brush" | "wand" | "harmonic";
/** Which channel of a stereo source a region edits. Absent means both. A mono source is its "left". */
export type SpectralChannel = "both" | "left" | "right";

/**
 * The cell mask a magic wand click produced, stored so the region renders identically after a reload even when the wand algorithm
 * changes: the grid it lives on (sample rate, FFT size, hop), its bounding box in frames and bins, and the selected cells as run lengths.
 * The seed and settings are kept so the editor can show and re-run it, but they are never used to render.
 */
export interface SpectralWandMask {
  readonly version: number;
  readonly seed: SpectralPoint;
  readonly toleranceDb: number;
  readonly localContrast: boolean;
  readonly sampleRate: number;
  readonly fftSize: number;
  readonly hop: number;
  /** First STFT frame / bin of the bounding box and its size. Frame m is centred on (m * hop + fftSize / 2) / sampleRate, bin k on k * sampleRate / fftSize. */
  readonly m0: number;
  readonly k0: number;
  readonly frames: number;
  readonly bins: number;
  /** Run lengths of frames * bins cells in frame-major order, alternating off, on, off, on ... starting with off (may be 0). */
  readonly runs: readonly number[];
}

/** The overtone series of a harmonic region: the fundamental track is the region's `points`. */
export interface SpectralHarmonicSpec {
  /** Partials selected, the fundamental counting as 1. */
  readonly harmonics: number;
  /** Partials above this frequency are not selected. */
  readonly maxHz: number;
  /** Half-width of each partial's band in cents (scaled with the partial's frequency, never narrower than one STFT bin). */
  readonly bandCents: number;
}

export interface SpectralPoint {
  /** Source time, seconds. */
  readonly t: number;
  readonly hz: number;
}

export interface SpectralRegion {
  readonly id: string;
  readonly mode: SpectralRegionMode;
  /** Absent means "rect". */
  readonly shape?: SpectralRegionShape;
  /** lasso: polygon vertices (>= 3). brush: the stroke's path (>= 1). */
  readonly points?: readonly SpectralPoint[];
  /** Absent means both channels. */
  readonly channel?: SpectralChannel;
  /** wand: the stored cell mask. */
  readonly wand?: SpectralWandMask;
  /** harmonic: the overtone series (the fundamental track is `points`). */
  readonly harmonic?: SpectralHarmonicSpec;
  /** brush: the brush's half-size in seconds and in octaves (an ellipse on the time / log-frequency plane). */
  readonly brushSeconds?: number;
  readonly brushOctaves?: number;
  /** Soft edge of a mask in STFT cells (0 = hard). Rectangles that use attenuate / remove keep their original fixed edge. */
  readonly feather?: number;
  /** Source-time bounds in seconds. A frequency-band marquee spans the whole source. For lasso / brush these are the mask's bounding box (derived from the points). */
  readonly startTime: number;
  readonly endTime: number;
  readonly lowHz: number;
  readonly highHz: number;
  /** Attenuate only: gain in dB, <= 0 (a "12 dB cut" is -12). Unused (stored as the minimum) for remove and heal. */
  readonly gainDb: number;
  readonly enabled: boolean;
}

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function sanitizePoints(raw: unknown): SpectralPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: SpectralPoint[] = [];
  for (const item of raw) {
    if (out.length >= MAX_SPECTRAL_POINTS) break;
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const t = finite(p.t);
    const hz = finite(p.hz);
    if (t === null || hz === null) continue;
    out.push({ t: Math.max(0, t), hz: clampN(hz, 0, MAX_REGION_HZ) });
  }
  return out;
}

/** Bounding box of a mask shape in time and frequency (a brush adds its radii). */
export function maskBounds(shape: "lasso" | "brush", points: readonly SpectralPoint[], brushSeconds: number, brushOctaves: number): { startTime: number; endTime: number; lowHz: number; highHz: number } {
  let t0 = Infinity;
  let t1 = -Infinity;
  let f0 = Infinity;
  let f1 = -Infinity;
  const grow = shape === "brush" ? Math.pow(2, brushOctaves) : 1;
  for (const p of points) {
    t0 = Math.min(t0, p.t - (shape === "brush" ? brushSeconds : 0));
    t1 = Math.max(t1, p.t + (shape === "brush" ? brushSeconds : 0));
    const hz = Math.max(p.hz, MASK_MIN_HZ);
    f0 = Math.min(f0, hz / grow);
    f1 = Math.max(f1, hz * grow);
  }
  return { startTime: Math.max(0, t0), endTime: Math.max(0, t1), lowHz: clampN(f0, 0, MAX_REGION_HZ), highHz: clampN(f1, 0, MAX_REGION_HZ) };
}

/** Frame / bin geometry of a stored wand mask as source seconds and Hz (cell edges, so the box covers whole cells). */
export function wandBounds(wand: Pick<SpectralWandMask, "sampleRate" | "fftSize" | "hop" | "m0" | "k0" | "frames" | "bins">): { startTime: number; endTime: number; lowHz: number; highHz: number } {
  const half = wand.fftSize / 2;
  const binHz = wand.sampleRate / wand.fftSize;
  const t0 = (wand.m0 * wand.hop + half) / wand.sampleRate - wand.hop / wand.sampleRate / 2;
  const t1 = ((wand.m0 + wand.frames - 1) * wand.hop + half) / wand.sampleRate + wand.hop / wand.sampleRate / 2;
  return {
    startTime: Math.max(0, t0),
    endTime: Math.max(0, t1),
    lowHz: clampN((wand.k0 - 0.5) * binHz, 0, MAX_REGION_HZ),
    highHz: clampN((wand.k0 + wand.bins - 0.5) * binHz, 0, MAX_REGION_HZ),
  };
}

function sanitizeWand(raw: unknown): SpectralWandMask | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): number | null => {
    const n = finite(v);
    return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  const sampleRate = finite(w.sampleRate);
  const fftSize = int(w.fftSize, 64, 65536);
  const hop = int(w.hop, 1, 65536);
  const m0 = int(w.m0, -64, 100_000_000);
  const k0 = int(w.k0, 0, 40000);
  const frames = int(w.frames, 1, MAX_WAND_CELLS);
  const bins = int(w.bins, 1, MAX_WAND_CELLS);
  if (sampleRate === null || sampleRate < 1000 || sampleRate > 384000 || fftSize === null || hop === null || m0 === null || k0 === null || frames === null || bins === null) return null;
  if (frames * bins > MAX_WAND_CELLS || !Array.isArray(w.runs) || w.runs.length > MAX_WAND_RUNS || w.runs.length === 0) return null;
  let total = 0;
  let on = 0;
  const runs: number[] = [];
  for (let i = 0; i < w.runs.length; i += 1) {
    const n = w.runs[i];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    total += n;
    if (i % 2 === 1) on += n;
    runs.push(n);
  }
  if (total !== frames * bins || on === 0) return null;
  const seed = w.seed && typeof w.seed === "object" ? (w.seed as Record<string, unknown>) : {};
  return {
    version: SPECTRAL_WAND_VERSION,
    seed: { t: Math.max(0, finite(seed.t) ?? 0), hz: clampN(finite(seed.hz) ?? 0, 0, MAX_REGION_HZ) },
    toleranceDb: clampN(finite(w.toleranceDb) ?? 6, 0.1, 60),
    localContrast: w.localContrast === true,
    sampleRate,
    fftSize,
    hop,
    m0,
    k0,
    frames,
    bins,
    runs,
  };
}

/** The fundamental track of a harmonic region: finite, positive-Hz points sorted by time (equal times keep the later point). */
function sanitizeTrack(raw: unknown): SpectralPoint[] {
  const pts = sanitizePoints(raw).filter((p) => p.hz >= MASK_MIN_HZ / 2).sort((a, b) => a.t - b.t);
  const out: SpectralPoint[] = [];
  for (const p of pts) {
    if (out.length && p.t - out[out.length - 1].t < 1e-6) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const centsRatio = (cents: number): number => Math.pow(2, cents / 1200);

/** Bounding box of a harmonic region: the fundamental track's time span and every selected partial's band. */
export function harmonicBounds(track: readonly SpectralPoint[], spec: SpectralHarmonicSpec): { startTime: number; endTime: number; lowHz: number; highHz: number } {
  let f0min = Infinity;
  let f0max = 0;
  for (const p of track) {
    f0min = Math.min(f0min, p.hz);
    f0max = Math.max(f0max, p.hz);
  }
  const grow = centsRatio(spec.bandCents);
  return {
    startTime: track[0].t,
    endTime: track[track.length - 1].t,
    lowHz: clampN(f0min / grow, 0, MAX_REGION_HZ),
    highHz: clampN(Math.min(spec.maxHz, spec.harmonics * f0max) * grow, 0, MAX_REGION_HZ),
  };
}

/** Fundamental (Hz) at source time t, interpolated in log frequency between track points and held at its ends. */
export function harmonicF0At(track: readonly SpectralPoint[], t: number): number {
  const n = track.length;
  if (t <= track[0].t) return track[0].hz;
  if (t >= track[n - 1].t) return track[n - 1].hz;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const u = (t - a.t) / (b.t - a.t);
  return a.hz * Math.pow(b.hz / a.hz, u);
}

/** Normalises untrusted input (saved project, agent call, UI); invalid entries are dropped. Regions saved before v2 (no shape, attenuate / remove) come back unchanged. */
export function sanitizeSpectralRegions(raw: unknown): SpectralRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SpectralRegion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_SPECTRAL_REGIONS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const mode: SpectralRegionMode | null = r.mode === "remove" ? "remove" : r.mode === "attenuate" ? "attenuate" : r.mode === "heal" ? "heal" : null;
    if (!mode) continue;
    const shape: SpectralRegionShape = r.shape === "lasso" ? "lasso" : r.shape === "brush" ? "brush" : r.shape === "wand" ? "wand" : r.shape === "harmonic" ? "harmonic" : "rect";
    let startTime: number;
    let endTime: number;
    let lowHz: number;
    let highHz: number;
    let points: SpectralPoint[] | undefined;
    let brushSeconds: number | undefined;
    let brushOctaves: number | undefined;
    let wand: SpectralWandMask | undefined;
    let harmonic: SpectralHarmonicSpec | undefined;
    if (shape === "wand") {
      const clean = sanitizeWand(r.wand);
      if (!clean) continue;
      wand = clean;
      ({ startTime, endTime, lowHz, highHz } = wandBounds(clean));
    } else if (shape === "harmonic") {
      const track = sanitizeTrack(r.points);
      if (track.length < 2) continue;
      const h = (r.harmonic && typeof r.harmonic === "object" ? r.harmonic : r) as Record<string, unknown>;
      harmonic = {
        harmonics: Math.round(clampN(finite(h.harmonics) ?? DEFAULT_SPECTRAL_HARMONICS, 1, MAX_SPECTRAL_HARMONICS)),
        maxHz: clampN(finite(h.maxHz) ?? 20000, MASK_MIN_HZ, MAX_REGION_HZ),
        bandCents: clampN(finite(h.bandCents) ?? DEFAULT_HARMONIC_BAND_CENTS, MIN_HARMONIC_BAND_CENTS, MAX_HARMONIC_BAND_CENTS),
      };
      points = track;
      ({ startTime, endTime, lowHz, highHz } = harmonicBounds(track, harmonic));
    } else if (shape === "rect") {
      const t0 = finite(r.startTime);
      const t1 = finite(r.endTime);
      const f0 = finite(r.lowHz);
      const f1 = finite(r.highHz);
      if (t0 === null || t1 === null || f0 === null || f1 === null) continue;
      startTime = Math.max(0, Math.min(t0, t1));
      endTime = Math.max(0, Math.max(t0, t1));
      lowHz = Math.max(0, Math.min(f0, f1));
      highHz = Math.min(MAX_REGION_HZ, Math.max(f0, f1));
    } else {
      points = sanitizePoints(r.points);
      if (points.length < (shape === "lasso" ? 3 : 1)) continue;
      if (shape === "brush") {
        brushSeconds = clampN(finite(r.brushSeconds) ?? DEFAULT_BRUSH_SECONDS, 0.001, 5);
        brushOctaves = clampN(finite(r.brushOctaves) ?? DEFAULT_BRUSH_OCTAVES, 0.005, 4);
      }
      ({ startTime, endTime, lowHz, highHz } = maskBounds(shape, points, brushSeconds ?? 0, brushOctaves ?? 0));
    }
    if (endTime - startTime < MIN_REGION_SECONDS || highHz - lowHz <= 0) continue;
    const gain = finite(r.gainDb);
    const gainDb =
      mode === "attenuate"
        ? Math.max(MIN_SPECTRAL_ATTENUATION_DB, Math.min(0, gain ?? DEFAULT_SPECTRAL_ATTENUATION_DB))
        : MIN_SPECTRAL_ATTENUATION_DB;
    let id = typeof r.id === "string" && r.id ? r.id : `region-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    const region: Mutable<SpectralRegion> = { id, mode, startTime, endTime, lowHz, highHz, gainDb, enabled: r.enabled !== false };
    if (shape !== "rect") {
      region.shape = shape;
      if (shape === "wand") region.wand = wand;
      else region.points = points;
      if (shape === "brush") {
        region.brushSeconds = brushSeconds;
        region.brushOctaves = brushOctaves;
      }
      if (shape === "harmonic") region.harmonic = harmonic;
    }
    if (r.channel === "left" || r.channel === "right") region.channel = r.channel;
    const feather = finite(r.feather);
    if (feather !== null) region.feather = Math.round(clampN(feather, 0, MAX_SPECTRAL_FEATHER));
    out.push(region);
  }
  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The region's shape (rect when none is stored). */
export const regionShape = (region: Pick<SpectralRegion, "shape">): SpectralRegionShape => region.shape ?? "rect";

/** The soft-edge width in STFT cells a mask is rasterised with. A harmonic region's bands and a wand's tone line are only a few bins wide and a feather would thin them (the weight of a 3-bin band falls to about 0.7, and a hum wand's removal depth drops from 23 to 17 dB), so those two default to a hard edge. */
export const regionFeather = (region: SpectralRegion): number =>
  region.feather ?? (regionShape(region) === "rect" ? (region.mode === "heal" ? DEFAULT_SPECTRAL_FEATHER : 0) : regionShape(region) === "harmonic" || regionShape(region) === "wand" ? 0 : DEFAULT_SPECTRAL_FEATHER);

/** True when a region needs the mask path (anything but a plain rectangle that attenuates or removes). */
export const regionUsesMask = (region: SpectralRegion): boolean => regionShape(region) !== "rect" || region.mode === "heal";

/** Whether any region needs the v2 format (older builds would drop it). */
export const regionsNeedVersion2 = (regions: readonly SpectralRegion[]): boolean => regions.some(regionUsesMask);

/** Whether a region needs the v3 format: a wand or harmonic shape, or a single-channel edit. */
export const regionNeedsVersion3 = (region: SpectralRegion): boolean => region.shape === "wand" || region.shape === "harmonic" || region.channel !== undefined;

/** The `version` a region list is written with: undefined (v1, rectangles only), 2 (masks, heal) or 3 (wand, harmonic, channel). */
export const spectralRegionsVersion = (regions: readonly SpectralRegion[]): number | undefined =>
  regions.some(regionNeedsVersion3) ? SPECTRAL_REGIONS_VERSION_3 : regionsNeedVersion2(regions) ? SPECTRAL_REGIONS_VERSION : undefined;

/** Whether a region edits the given channel index (0 = left / mono, 1 = right). */
export const regionAppliesToChannel = (region: Pick<SpectralRegion, "channel">, channel: number): boolean =>
  region.channel === undefined || region.channel === "both" || (region.channel === "left" ? channel === 0 : channel === 1);

/** Order-sensitive 32-bit FNV-1a over a list of integers (keys of stored wand masks). */
function hashRuns(runs: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const n of runs) {
    h = Math.imul(h ^ (n & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (n >>> 16), 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The regions that actually process audio (enabled), in order. */
export const activeSpectralRegions = (regions: readonly SpectralRegion[]): SpectralRegion[] => regions.filter((region) => region.enabled);

/** Stable cache key of what the regions do to the audio ("" when nothing is processed). Ids and the enabled flag of off regions do not matter. */
export function spectralRegionsKey(regions: readonly SpectralRegion[]): string {
  return activeSpectralRegions(regions)
    .map((r) => {
      const base = `${r.mode[0]}${r.startTime.toFixed(5)},${r.endTime.toFixed(5)},${r.lowHz.toFixed(2)},${r.highHz.toFixed(2)},${r.gainDb.toFixed(3)}`;
      if (!regionUsesMask(r)) return r.channel === "left" ? `${base}@L` : r.channel === "right" ? `${base}@R` : base;
      const shape = regionShape(r);
      const channel = r.channel === "left" ? "@L" : r.channel === "right" ? "@R" : "";
      if (shape === "wand" && r.wand) {
        const w = r.wand;
        return `${base}#wf${regionFeather(r)}${w.sampleRate}:${w.fftSize}:${w.hop}:${w.m0}:${w.k0}:${w.frames}:${w.bins}:${w.runs.length}:${hashRuns(w.runs)}${channel}`;
      }
      const pts = (r.points ?? []).map((p) => `${p.t.toFixed(5)}:${p.hz.toFixed(2)}`).join("|");
      const harmonic = shape === "harmonic" && r.harmonic ? `h${r.harmonic.harmonics}:${r.harmonic.maxHz.toFixed(1)}:${r.harmonic.bandCents.toFixed(2)}` : "";
      return `${base}#${shape[0]}f${regionFeather(r)}${harmonic}${shape === "brush" ? `b${(r.brushSeconds ?? 0).toFixed(5)}:${(r.brushOctaves ?? 0).toFixed(4)}` : ""}${pts}${channel}`;
    })
    .join(";");
}

interface EffectLike {
  readonly type: string;
  readonly enabled?: boolean;
  readonly params?: Readonly<Record<string, unknown>>;
}

export const isSpectralRepairEffect = (effect: Pick<Effect, "type">): boolean => effect.type === SPECTRAL_REPAIR_EFFECT_TYPE;

/** Active regions of every enabled "spectralRepair" effect in a clip's chain, concatenated in chain order. */
export function getSpectralRepairRegions(effects: readonly EffectLike[] | undefined): SpectralRegion[] {
  const out: SpectralRegion[] = [];
  for (const effect of effects ?? []) {
    if (effect.type !== SPECTRAL_REPAIR_EFFECT_TYPE || effect.enabled === false) continue;
    out.push(...activeSpectralRegions(sanitizeSpectralRegions(effect.params?.regions)));
  }
  return out;
}

export const hasSpectralRepair = (effects: readonly EffectLike[] | undefined): boolean => getSpectralRepairRegions(effects).length > 0;

/** Builds the effect that carries a region list (one per clip; edits replace its `regions`). */
export function createSpectralRepairEffect(id: string, regions: readonly SpectralRegion[] = []): Effect {
  const clean = sanitizeSpectralRegions(regions);
  const version = spectralRegionsVersion(clean);
  return { id, type: SPECTRAL_REPAIR_EFFECT_TYPE, enabled: true, params: version ? { version, regions: clean } : { regions: clean } };
}

let regionCounter = 0;
/** A fresh region id (unique within a session; collisions inside one clip are repaired by sanitize). */
export const newSpectralRegionId = (): string => `sr-${Date.now().toString(36)}-${(regionCounter++).toString(36)}`;
