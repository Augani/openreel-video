/** Pure mapping between pixels and (source time, frequency) for the spectral editor; the frequency axis is logarithmic. */

export interface SpectralViewport {
  /** Visible source-time window, seconds. */
  readonly startTime: number;
  readonly endTime: number;
  /** Visible frequency window, Hz (log axis). */
  readonly minHz: number;
  readonly maxHz: number;
  readonly width: number;
  readonly height: number;
}

export interface TimeFrequencyRect {
  readonly startTime: number;
  readonly endTime: number;
  readonly lowHz: number;
  readonly highHz: number;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const MIN_VIEW_SECONDS = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const timeToX = (view: SpectralViewport, t: number): number => ((t - view.startTime) / (view.endTime - view.startTime)) * view.width;
export const xToTime = (view: SpectralViewport, x: number): number => view.startTime + (x / view.width) * (view.endTime - view.startTime);

export const freqToY = (view: SpectralViewport, hz: number): number => {
  const span = Math.log(view.maxHz / view.minHz);
  return (1 - Math.log(clamp(hz, 1e-3, 1e9) / view.minHz) / span) * view.height;
};
export const yToFreq = (view: SpectralViewport, y: number): number => view.minHz * Math.exp((1 - y / view.height) * Math.log(view.maxHz / view.minHz));

/** A dragged pixel box as a time-frequency rectangle clamped to the source and the audible range. */
export function pixelsToRect(view: SpectralViewport, a: { x: number; y: number }, b: { x: number; y: number }, duration: number, nyquist: number): TimeFrequencyRect {
  const t0 = clamp(xToTime(view, Math.min(a.x, b.x)), 0, duration);
  const t1 = clamp(xToTime(view, Math.max(a.x, b.x)), 0, duration);
  const f0 = clamp(yToFreq(view, Math.max(a.y, b.y)), 0, nyquist);
  const f1 = clamp(yToFreq(view, Math.min(a.y, b.y)), 0, nyquist);
  return { startTime: t0, endTime: t1, lowHz: f0, highHz: f1 };
}

/** A frequency-band marquee: the dragged vertical extent over the whole source. */
export function bandFromPixels(view: SpectralViewport, y0: number, y1: number, duration: number, nyquist: number): TimeFrequencyRect {
  return {
    startTime: 0,
    endTime: duration,
    lowHz: clamp(yToFreq(view, Math.max(y0, y1)), 0, nyquist),
    highHz: clamp(yToFreq(view, Math.min(y0, y1)), 0, nyquist),
  };
}

export function rectToPixels(view: SpectralViewport, rect: TimeFrequencyRect): PixelRect {
  const x0 = timeToX(view, rect.startTime);
  const x1 = timeToX(view, rect.endTime);
  const y0 = freqToY(view, rect.highHz);
  const y1 = freqToY(view, Math.max(rect.lowHz, view.minHz * 0.5));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Zooms the time window by `factor` (< 1 zooms in) around `anchor` (seconds), staying inside [0, duration]. */
export function zoomTime(startTime: number, endTime: number, duration: number, factor: number, anchor: number): { startTime: number; endTime: number } {
  const span = clamp((endTime - startTime) * factor, Math.min(MIN_VIEW_SECONDS, duration), Math.max(duration, MIN_VIEW_SECONDS));
  const ratio = endTime > startTime ? clamp((anchor - startTime) / (endTime - startTime), 0, 1) : 0.5;
  let start = anchor - span * ratio;
  start = clamp(start, 0, Math.max(0, duration - span));
  return { startTime: start, endTime: Math.min(duration, start + span) };
}

/** Pans the window by `delta` seconds, staying inside [0, duration]. */
export function panTime(startTime: number, endTime: number, duration: number, delta: number): { startTime: number; endTime: number } {
  const span = endTime - startTime;
  const start = clamp(startTime + delta, 0, Math.max(0, duration - span));
  return { startTime: start, endTime: start + span };
}

export const FREQUENCY_RANGES = [
  { id: "full", label: "Full range", minHz: 30, maxHz: Infinity },
  { id: "low", label: "Low (30 Hz - 1 kHz)", minHz: 30, maxHz: 1000 },
  { id: "voice", label: "Voice (80 Hz - 8 kHz)", minHz: 80, maxHz: 8000 },
  { id: "high", label: "High (1 kHz - Nyquist)", minHz: 1000, maxHz: Infinity },
] as const;
export type FrequencyRangeId = (typeof FREQUENCY_RANGES)[number]["id"];

export function frequencyRange(id: FrequencyRangeId, nyquist: number): { minHz: number; maxHz: number } {
  const range = FREQUENCY_RANGES.find((item) => item.id === id) ?? FREQUENCY_RANGES[0];
  return { minHz: Math.min(range.minHz, nyquist / 4), maxHz: Math.min(range.maxHz, nyquist) };
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2).replace(/\.?0+$/, "")} kHz` : `${Math.round(hz)} Hz`;
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, seconds);
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}` : `${s.toFixed(2)} s`;
}

export type ColourMapId = "heat" | "viridis" | "mono";
export const COLOUR_MAPS: ReadonlyArray<{ id: ColourMapId; label: string }> = [
  { id: "heat", label: "Heat" },
  { id: "viridis", label: "Viridis" },
  { id: "mono", label: "Grey" },
];

const STOPS: Record<ColourMapId, Array<[number, number, number, number]>> = {
  heat: [[0, 8, 10, 24], [0.3, 52, 36, 120], [0.55, 170, 52, 120], [0.8, 244, 150, 40], [1, 255, 248, 214]],
  viridis: [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]],
  mono: [[0, 0, 0, 0], [1, 255, 255, 255]],
};

const tables = new Map<ColourMapId, Uint8ClampedArray>();
/** 256-entry RGB table for a colour map. */
export function colourTable(id: ColourMapId): Uint8ClampedArray {
  const cached = tables.get(id);
  if (cached) return cached;
  const stops = STOPS[id];
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k += 1;
    const [t0, r0, g0, b0] = stops[k];
    const [t1, r1, g1, b1] = stops[k + 1];
    const f = (t - t0) / (t1 - t0);
    out[i * 3] = r0 + (r1 - r0) * f;
    out[i * 3 + 1] = g0 + (g1 - g0) * f;
    out[i * 3 + 2] = b0 + (b1 - b0) * f;
  }
  tables.set(id, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Lasso, brush and region editing                                     */
/* ------------------------------------------------------------------ */

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}
export interface TimeFrequencyPoint {
  readonly t: number;
  readonly hz: number;
}

/** A drawn pixel path as (source time, Hz) points clamped to the source and the audible range. */
export function pixelsToPoints(view: SpectralViewport, path: readonly PixelPoint[], duration: number, nyquist: number): TimeFrequencyPoint[] {
  return path.map((p) => ({ t: clamp(xToTime(view, p.x), 0, duration), hz: clamp(yToFreq(view, p.y), 0, nyquist) }));
}

export const pointToPixel = (view: SpectralViewport, p: TimeFrequencyPoint): PixelPoint => ({ x: timeToX(view, p.t), y: freqToY(view, Math.max(p.hz, 1)) });

/** Drops path samples closer than `minDistance` pixels to the previous kept one (keeps the first and last). */
export function thinPath(path: readonly PixelPoint[], minDistance: number): PixelPoint[] {
  const out: PixelPoint[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) out.push(p);
  }
  const end = path[path.length - 1];
  if (end && out[out.length - 1] !== end && out.length > 1) out[out.length - 1] = end;
  return out;
}

/** Area enclosed by a pixel polygon (absolute shoelace). */
export function polygonArea(path: readonly PixelPoint[]): number {
  let sum = 0;
  for (let i = 0; i < path.length; i += 1) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** A brush radius in pixels as the (seconds, octaves) half-size stored with the region (an ellipse on the time / log-frequency plane). */
export function brushRadiiFromPixels(view: SpectralViewport, radiusPx: number): { brushSeconds: number; brushOctaves: number } {
  const secondsPerPx = (view.endTime - view.startTime) / view.width;
  const octavesPerPx = Math.log2(view.maxHz / view.minHz) / view.height;
  return { brushSeconds: Math.max(0.001, radiusPx * secondsPerPx), brushOctaves: Math.max(0.005, radiusPx * octavesPerPx) };
}

export type RectHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const RECT_HANDLES: readonly RectHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The rectangle moved by (dt seconds, dOct octaves), staying inside [0, duration] x [0, nyquist]. */
export function moveRect(rect: TimeFrequencyRect, dt: number, dOct: number, duration: number, nyquist: number): TimeFrequencyRect {
  const span = rect.endTime - rect.startTime;
  const start = clamp(rect.startTime + dt, 0, Math.max(0, duration - span));
  const ratio = Math.pow(2, dOct);
  const lowBound = Math.max(rect.lowHz, 1);
  const factor = clamp(ratio, 1 / lowBound, Math.max(1e-9, nyquist / Math.max(rect.highHz, 1)));
  return { startTime: start, endTime: start + span, lowHz: rect.lowHz * factor, highHz: Math.min(nyquist, rect.highHz * factor) };
}

/** The rectangle with one handle dragged to a new (time, Hz) position; edges cannot cross. */
export function resizeRect(rect: TimeFrequencyRect, handle: RectHandle, t: number, hz: number, duration: number, nyquist: number): TimeFrequencyRect {
  let { startTime, endTime, lowHz, highHz } = rect;
  const time = clamp(t, 0, duration);
  const freq = clamp(hz, 0, nyquist);
  if (handle.includes("w")) startTime = Math.min(time, endTime - 1e-3);
  if (handle.includes("e")) endTime = Math.max(time, startTime + 1e-3);
  if (handle.includes("n")) highHz = Math.max(freq, lowHz + 1);
  if (handle.includes("s")) lowHz = Math.min(freq, highHz - 1);
  return { startTime, endTime, lowHz, highHz };
}

/** All points moved by (dt seconds, dOct octaves), clamped to the source and the audible range. */
export function movePoints(points: readonly TimeFrequencyPoint[], dt: number, dOct: number, duration: number, nyquist: number): TimeFrequencyPoint[] {
  const factor = Math.pow(2, dOct);
  return points.map((p) => ({ t: clamp(p.t + dt, 0, duration), hz: clamp(p.hz * factor, 0, nyquist) }));
}
