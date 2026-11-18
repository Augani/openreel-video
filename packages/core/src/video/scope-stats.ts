import {
  downsampleForScopes,
  rec709Luma,
  rgbToCbCr,
  type ScopeImageLike,
} from "./scopes";

/**
 * Numeric read-out of what the video scopes display, so an agent can do colour
 * QA without looking at pixels: luma range, clipping, saturation and the
 * dominant hue. Pure and deterministic; runs on any ImageData-like frame.
 */

/** Code values at or below this count as crushed black (of 255). */
export const SCOPE_BLACK_CLIP_LEVEL = 2;
/** Code values at or above this count as clipped white (of 255). */
export const SCOPE_WHITE_CLIP_LEVEL = 253;
/** Share of clipped pixels (percent) above which a warning is raised. */
export const SCOPE_CLIP_WARN_PCT = 1;
/** Approximate HSV hue of the vectorscope skin-tone (I) line. */
export const SKIN_TONE_HSV_HUE_DEG = 20;
const HUE_BINS = 36;
const MIN_HUE_SATURATION = 0.15;
const MIN_HUE_VALUE = 0.1;
const STATS_WIDTH = 256;

export interface ScopeChannelStats {
  /** 0..100 (percent of full scale). */
  readonly min: number;
  readonly max: number;
  readonly average: number;
  /** Percent of pixels at or below the black clip level. */
  readonly blackClipPct: number;
  /** Percent of pixels at or above the white clip level. */
  readonly whiteClipPct: number;
}

export interface ScopeStats {
  /** Opaque pixels analysed (after downsampling). */
  readonly pixels: number;
  readonly width: number;
  readonly height: number;
  /** Rec.709 luma, 0..100 percent of full scale. */
  readonly luma: {
    readonly min: number;
    readonly max: number;
    readonly average: number;
    readonly median: number;
    /** 1st and 99th percentile: robust black and white points. */
    readonly p1: number;
    readonly p99: number;
    readonly blackClipPct: number;
    readonly whiteClipPct: number;
  };
  readonly red: ScopeChannelStats;
  readonly green: ScopeChannelStats;
  readonly blue: ScopeChannelStats;
  readonly saturation: {
    /** HSV saturation, 0..100. */
    readonly average: number;
    readonly max: number;
  };
  /** Hue of the most represented colour; null for neutral/near-black frames. */
  readonly dominantHue: {
    readonly degrees: number;
    readonly name: string;
    /** Share (0..1) of the chroma-weighted hue mass in this band. */
    readonly share: number;
  } | null;
  /** Mean vectorscope offset (Cb/Cr, -0.5..0.5); 0,0 is neutral. */
  readonly cast: { readonly cb: number; readonly cr: number };
  /** Degrees between the dominant hue and the skin-tone line, or null. */
  readonly skinToneOffsetDegrees: number | null;
  readonly warnings: readonly string[];
}

const HUE_NAMES: ReadonlyArray<readonly [number, string]> = [
  [15, "red"],
  [45, "orange"],
  [70, "yellow"],
  [150, "green"],
  [195, "cyan"],
  [255, "blue"],
  [285, "violet"],
  [330, "magenta"],
  [360, "red"],
];

export function hueName(degrees: number): string {
  const d = ((degrees % 360) + 360) % 360;
  for (const [limit, name] of HUE_NAMES) if (d < limit) return name;
  return "red";
}

const round = (value: number, places = 2): number => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

interface ChannelAccumulator {
  min: number;
  max: number;
  sum: number;
  black: number;
  white: number;
}

const newChannel = (): ChannelAccumulator => ({
  min: 255,
  max: 0,
  sum: 0,
  black: 0,
  white: 0,
});

function addSample(acc: ChannelAccumulator, value: number): void {
  if (value < acc.min) acc.min = value;
  if (value > acc.max) acc.max = value;
  acc.sum += value;
  if (value <= SCOPE_BLACK_CLIP_LEVEL) acc.black++;
  if (value >= SCOPE_WHITE_CLIP_LEVEL) acc.white++;
}

function channelStats(acc: ChannelAccumulator, n: number): ScopeChannelStats {
  const pct = (v: number) => round((v / 255) * 100);
  return {
    min: pct(acc.min),
    max: pct(acc.max),
    average: pct(acc.sum / n),
    blackClipPct: round((acc.black / n) * 100),
    whiteClipPct: round((acc.white / n) * 100),
  };
}

/** Smallest signed difference between two angles in degrees (-180..180]. */
function angleDelta(a: number, b: number): number {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function computeScopeStats(source: ScopeImageLike): ScopeStats | null {
  const img = downsampleForScopes(source, STATS_WIDTH);
  const { data, width, height } = img;
  const total = width * height;
  if (total <= 0 || data.length < total * 4) return null;

  const luma = newChannel();
  const red = newChannel();
  const green = newChannel();
  const blue = newChannel();
  const lumaHist = new Uint32Array(256);
  const hueMass = new Float64Array(HUE_BINS);
  const hueSin = new Float64Array(HUE_BINS);
  const hueCos = new Float64Array(HUE_BINS);
  let n = 0;
  let satSum = 0;
  let satMax = 0;
  let cbSum = 0;
  let crSum = 0;
  let hueTotal = 0;

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    n++;
    const y = Math.min(255, Math.round(rec709Luma(r, g, b)));
    addSample(luma, y);
    lumaHist[y]++;
    addSample(red, r);
    addSample(green, g);
    addSample(blue, b);
    const { cb, cr } = rgbToCbCr(r, g, b);
    cbSum += cb;
    crSum += cr;
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const delta = max - min;
    const s = max === 0 ? 0 : delta / max;
    satSum += s;
    if (s > satMax) satMax = s;
    if (s >= MIN_HUE_SATURATION && max >= MIN_HUE_VALUE && delta > 0) {
      const rf = r / 255;
      const gf = g / 255;
      const bf = b / 255;
      let h: number;
      if (max === rf) h = ((gf - bf) / delta) % 6;
      else if (max === gf) h = (bf - rf) / delta + 2;
      else h = (rf - gf) / delta + 4;
      const degrees = (((h * 60) % 360) + 360) % 360;
      const bin = Math.min(HUE_BINS - 1, Math.floor(degrees / (360 / HUE_BINS)));
      hueMass[bin] += delta;
      hueSin[bin] += delta * Math.sin((degrees * Math.PI) / 180);
      hueCos[bin] += delta * Math.cos((degrees * Math.PI) / 180);
      hueTotal += delta;
    }
  }
  if (n === 0) return null;

  const percentile = (p: number): number => {
    const target = Math.max(1, Math.ceil(n * p));
    let seen = 0;
    for (let level = 0; level < 256; level++) {
      seen += lumaHist[level];
      if (seen >= target) return level;
    }
    return 255;
  };
  const pct = (v: number) => round((v / 255) * 100);

  let dominantHue: ScopeStats["dominantHue"] = null;
  let skinToneOffsetDegrees: number | null = null;
  if (hueTotal > 0) {
    // Strongest band, widened by its two neighbours so a hue straddling a bin
    // edge is not split.
    let best = 0;
    let bestMass = -1;
    for (let b = 0; b < HUE_BINS; b++) {
      const m =
        hueMass[b] +
        hueMass[(b + 1) % HUE_BINS] +
        hueMass[(b + HUE_BINS - 1) % HUE_BINS];
      if (m > bestMass) {
        bestMass = m;
        best = b;
      }
    }
    let sx = 0;
    let sy = 0;
    for (const b of [best, (best + 1) % HUE_BINS, (best + HUE_BINS - 1) % HUE_BINS]) {
      sx += hueCos[b];
      sy += hueSin[b];
    }
    const degrees = ((((Math.atan2(sy, sx) * 180) / Math.PI) % 360) + 360) % 360;
    dominantHue = {
      degrees: round(degrees, 1),
      name: hueName(degrees),
      share: round(bestMass / hueTotal, 3),
    };
    skinToneOffsetDegrees = round(
      Math.abs(angleDelta(degrees, SKIN_TONE_HSV_HUE_DEG)),
      1,
    );
  }

  const stats: Omit<ScopeStats, "warnings"> = {
    pixels: n,
    width,
    height,
    luma: {
      min: pct(luma.min),
      max: pct(luma.max),
      average: pct(luma.sum / n),
      median: pct(percentile(0.5)),
      p1: pct(percentile(0.01)),
      p99: pct(percentile(0.99)),
      blackClipPct: round((luma.black / n) * 100),
      whiteClipPct: round((luma.white / n) * 100),
    },
    red: channelStats(red, n),
    green: channelStats(green, n),
    blue: channelStats(blue, n),
    saturation: { average: round((satSum / n) * 100), max: round(satMax * 100) },
    dominantHue,
    cast: { cb: round(cbSum / n, 4), cr: round(crSum / n, 4) },
    skinToneOffsetDegrees,
  };
  return { ...stats, warnings: scopeWarnings(stats) };
}

function scopeWarnings(stats: Omit<ScopeStats, "warnings">): string[] {
  const warnings: string[] = [];
  const { luma } = stats;
  if (luma.whiteClipPct > SCOPE_CLIP_WARN_PCT)
    warnings.push(
      `Highlights clipped: ${luma.whiteClipPct}% of pixels are at full white. Lower exposure/highlights.`,
    );
  if (luma.blackClipPct > SCOPE_CLIP_WARN_PCT)
    warnings.push(
      `Shadows crushed: ${luma.blackClipPct}% of pixels are at full black. Lift shadows/blacks.`,
    );
  for (const [name, c] of [
    ["red", stats.red],
    ["green", stats.green],
    ["blue", stats.blue],
  ] as const)
    if (c.whiteClipPct > SCOPE_CLIP_WARN_PCT && c.whiteClipPct > luma.whiteClipPct + 0.5)
      warnings.push(`The ${name} channel clips in ${c.whiteClipPct}% of pixels.`);
  if (luma.max - luma.min < 40 && luma.max > 0)
    warnings.push(
      `Low contrast: luma spans only ${round(luma.max - luma.min, 1)}% of the range.`,
    );
  if (luma.average < 15) warnings.push("The frame is very dark (average luma under 15%).");
  if (luma.average > 85) warnings.push("The frame is very bright (average luma over 85%).");
  if (stats.saturation.average > 70)
    warnings.push("Oversaturated: average saturation is above 70%.");
  if (Math.hypot(stats.cast.cb, stats.cast.cr) > 0.06 && stats.saturation.average < 40)
    warnings.push("A colour cast is present in a low-saturation frame; check white balance.");
  return warnings;
}
