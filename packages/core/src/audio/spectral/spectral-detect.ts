/**
 * Finds what is worth removing in a spectrogram: steady tones (a whistle, a carrier, hum) and clicks. Both return
 * regions in SOURCE time that the agent tools add as "heal" regions. Pure and deterministic.
 */
import { getStftPlan, stftForward } from "./spectral-stft";
import type { SpectralRegion } from "./spectral-regions";

export interface SpectralTone {
  readonly hz: number;
  readonly startTime: number;
  readonly endTime: number;
  /** How far the tone stands above its surroundings, dB. */
  readonly prominenceDb: number;
}

export interface FindTonesOptions {
  /** Shortest tone to report (default 0.25 s). */
  readonly minSeconds?: number;
  /** Least prominence above the neighbouring bins, dB (default 15). */
  readonly minProminenceDb?: number;
  readonly maxTones?: number;
  /** Lowest frequency considered (default 60 Hz). */
  readonly minHz?: number;
}

const FFT = 4096;
const HOP = 1024;

/** Steady tones: bins whose level stays well above the neighbouring bins for a continuous stretch of time. */
export function findSpectralTones(mono: Float32Array, sampleRate: number, options: FindTonesOptions = {}): SpectralTone[] {
  const minSeconds = options.minSeconds ?? 0.25;
  const minProminence = options.minProminenceDb ?? 15;
  const maxTones = options.maxTones ?? 4;
  const minHz = options.minHz ?? 60;
  if (mono.length < FFT * 2) return [];
  const plan = getStftPlan(FFT, HOP);
  const frames = stftForward(mono, plan);
  const half = FFT / 2;
  const binHz = sampleRate / FFT;
  const kMin = Math.max(3, Math.ceil(minHz / binHz));
  const kMax = Math.min(half - 3, Math.floor(0.95 * (sampleRate / 2) / binHz));
  const count = frames.real.length;
  // dB magnitude per frame (frames fully inside the signal only).
  const first = Math.max(0, -frames.first);
  const inside: Float32Array[] = [];
  const frameTimes: number[] = [];
  for (let f = 0; f < count; f += 1) {
    const m = frames.first + f;
    if (m < 0 || m * HOP + FFT > mono.length) continue;
    const row = new Float32Array(half + 1);
    for (let k = 0; k <= half; k += 1) row[k] = 20 * Math.log10(Math.hypot(frames.real[f][k], frames.imag[f][k]) + 1e-9);
    inside.push(row);
    frameTimes.push((m * HOP + FFT / 2) / sampleRate);
  }
  void first;
  if (inside.length < 3) return [];
  const medianOf = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  // Prominence of a bin in a frame: its level over the median of the bins 6..16 away on both sides.
  const prominence = (row: Float32Array, k: number): number => {
    const side: number[] = [];
    for (let d = 6; d <= 16; d += 1) {
      if (k - d >= 0) side.push(row[k - d]);
      if (k + d <= half) side.push(row[k + d]);
    }
    return row[k] - medianOf(side);
  };
  // Persistence per bin: frames in which the bin is prominent.
  const prominent = new Uint8Array(inside.length * (half + 1));
  for (let f = 0; f < inside.length; f += 1) for (let k = kMin; k <= kMax; k += 1) if (inside[f][k] >= inside[f][k - 1] && inside[f][k] >= inside[f][k + 1] && prominence(inside[f], k) >= minProminence) prominent[f * (half + 1) + k] = 1;
  const found: Array<SpectralTone & { score: number }> = [];
  const used = new Uint8Array(half + 1);
  const hopSeconds = HOP / sampleRate;
  for (let k = kMin; k <= kMax; k += 1) {
    if (used[k]) continue;
    // Allow +-1 bin of wander between frames.
    let runStart = -1;
    let bestRun: [number, number] | null = null;
    let level = 0;
    for (let f = 0; f <= inside.length; f += 1) {
      const on = f < inside.length && (prominent[f * (half + 1) + k] || prominent[f * (half + 1) + k - 1] || prominent[f * (half + 1) + k + 1]);
      if (on && runStart < 0) runStart = f;
      if (!on && runStart >= 0) {
        if (!bestRun || f - runStart > bestRun[1] - bestRun[0]) bestRun = [runStart, f];
        runStart = -1;
      }
    }
    if (!bestRun) continue;
    const seconds = (bestRun[1] - bestRun[0]) * hopSeconds + FFT / sampleRate;
    if (seconds < minSeconds) continue;
    // Frame-by-frame frequency of the peak near k (parabolic); a tone holds still, a gliding harmonic does not.
    const freqs: number[] = [];
    for (let f = bestRun[0]; f < bestRun[1]; f += 1) {
      let peak = k;
      for (const j of [k - 1, k + 1]) if (inside[f][j] > inside[f][peak]) peak = j;
      const lo = inside[f][peak - 1];
      const mid = inside[f][peak];
      const hi = inside[f][peak + 1];
      const d = lo - 2 * mid + hi;
      freqs.push(peak + (d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / d)) : 0));
    }
    const mean = freqs.reduce((x, y) => x + y, 0) / freqs.length;
    const spread = Math.sqrt(freqs.reduce((x, y) => x + (y - mean) ** 2, 0) / freqs.length);
    let drift = 0;
    {
      const n = freqs.length;
      const half2 = Math.floor(n / 2);
      const head = freqs.slice(0, half2).reduce((x, y) => x + y, 0) / Math.max(1, half2);
      const tail = freqs.slice(n - half2).reduce((x, y) => x + y, 0) / Math.max(1, half2);
      drift = Math.abs(tail - head);
    }
    if (spread > 0.22 || drift > 0.3) continue;
    let sum = 0;
    for (let f = bestRun[0]; f < bestRun[1]; f += 1) sum += prominence(inside[f], k);
    level = sum / (bestRun[1] - bestRun[0]);
    // Refine the frequency with a parabola through the time-averaged log magnitudes.
    let a = 0;
    let b = 0;
    let c = 0;
    for (let f = bestRun[0]; f < bestRun[1]; f += 1) {
      a += inside[f][k - 1];
      b += inside[f][k];
      c += inside[f][k + 1];
    }
    const n = bestRun[1] - bestRun[0];
    a /= n;
    b /= n;
    c /= n;
    const denom = a - 2 * b + c;
    const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    found.push({
      hz: (k + offset) * binHz,
      startTime: Math.max(0, frameTimes[bestRun[0]] - FFT / 2 / sampleRate),
      endTime: Math.min(mono.length / sampleRate, frameTimes[bestRun[1] - 1] + FFT / 2 / sampleRate),
      prominenceDb: level,
      score: level * seconds,
    });
    for (let d = -3; d <= 3; d += 1) if (k + d >= 0 && k + d <= half) used[k + d] = 1;
  }
  found.sort((x, y) => y.score - x.score);
  return found.slice(0, maxTones).map(({ hz, startTime, endTime, prominenceDb }) => ({ hz: Math.round(hz * 10) / 10, startTime, endTime, prominenceDb: Math.round(prominenceDb * 10) / 10 }));
}

/** The region that heals a tone: a thin band (`widthHz` wide, at least 4 bins of the edit STFT) over the tone's span. */
export function toneRegion(tone: SpectralTone, id: string, sampleRate: number, padSeconds = 0.02, mode: SpectralRegion["mode"] = "heal"): SpectralRegion {
  const bin = sampleRate / 2048;
  const half = Math.max(2.5 * bin, tone.hz * 0.012);
  return {
    id,
    mode,
    startTime: Math.max(0, tone.startTime - padSeconds),
    endTime: tone.endTime + padSeconds,
    lowHz: Math.max(0, tone.hz - half),
    highHz: tone.hz + half,
    gainDb: -120,
    enabled: true,
  };
}

export interface SpectralClick {
  readonly time: number;
}

/**
 * Clicks (impulsive transients) in a mono source, in seconds. A click is a sample where the second difference (which
 * suppresses voiced and tonal content) jumps far above its neighbourhood's typical level.
 */
export function findSpectralClicks(mono: Float32Array, sampleRate: number, sensitivity = 0.5, maxClicks = 64): SpectralClick[] {
  const n = mono.length;
  if (n < 4096) return [];
  const block = 256;
  const blocks = Math.floor(n / block);
  const d = new Float32Array(n);
  for (let i = 2; i < n; i += 1) d[i] = mono[i] - 2 * mono[i - 1] + mono[i - 2];
  const level = new Float32Array(blocks);
  for (let b = 0; b < blocks; b += 1) {
    let e = 0;
    for (let i = b * block; i < (b + 1) * block; i += 1) e += d[i] * d[i];
    level[b] = Math.sqrt(e / block);
  }
  const factor = 14 - 8 * Math.max(0, Math.min(1, sensitivity)); // 0.5 -> 10x the typical level
  const floor = 0.01;
  const out: SpectralClick[] = [];
  let last = -Infinity;
  for (let b = 0; b < blocks && out.length < maxClicks; b += 1) {
    const around: number[] = [];
    for (let j = Math.max(0, b - 8); j <= Math.min(blocks - 1, b + 8); j += 1) if (Math.abs(j - b) > 1) around.push(level[j]);
    around.sort((x, y) => x - y);
    const typical = around.length ? around[Math.floor(around.length / 2)] : 0;
    let peakAt = -1;
    let peak = 0;
    for (let i = b * block; i < (b + 1) * block; i += 1) {
      const v = Math.abs(d[i]);
      if (v > peak) {
        peak = v;
        peakAt = i;
      }
    }
    if (peakAt < 0 || peak < floor || peak < factor * typical) continue;
    const time = Math.max(0, peakAt - 1) / sampleRate;
    if (time - last < 0.03) continue;
    last = time;
    out.push({ time });
  }
  return out;
}

/** The region that heals a click: a 50 ms box above 2.5 kHz (below that, speech and music harmonics mask the click and are best left alone). */
export function clickRegion(click: SpectralClick, id: string, sampleRate: number, durationSeconds: number, mode: SpectralRegion["mode"] = "heal"): SpectralRegion {
  return {
    id,
    mode,
    startTime: Math.max(0, click.time - 0.025),
    endTime: Math.min(durationSeconds, click.time + 0.025),
    lowHz: Math.min(2500, sampleRate / 4),
    highHz: sampleRate / 2,
    gainDb: -120,
    enabled: true,
  };
}
