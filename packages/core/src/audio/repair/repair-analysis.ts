/**
 * Audio issue detection for dialogue (hum, clipping, clicks, sibilance) and the
 * settings it suggests for the repair effects, plus a spectrogram for looking
 * at the same problems. Pure functions on decoded PCM.
 */
import { FFT } from "../fft";
import { RepairBiquad, bandpassCoefficients, detectClicks, type RepairEffectType } from "./repair-dsp";

export interface HumFinding {
  readonly present: boolean;
  /** 50 or 60 (refined to the strongest bin within +-1 Hz). */
  readonly frequency: number;
  /** Fundamental/harmonic peak above its spectral surroundings, dB. */
  readonly prominenceDb: number;
  /** Number of harmonics (including the fundamental) that stand out. */
  readonly harmonics: number;
}

export interface ClippingFinding {
  readonly present: boolean;
  readonly clippedSamples: number;
  readonly runs: number;
  readonly peak: number;
  /** Suggested DeClip threshold, dBFS. */
  readonly thresholdDb: number;
}

export interface ClicksFinding {
  readonly present: boolean;
  readonly count: number;
  readonly perMinute: number;
}

export interface SibilanceFinding {
  readonly present: boolean;
  readonly centerHz: number;
  /** Sibilance-band peak level (dBFS, as the DeEsser sees it). */
  readonly peakDb: number;
  /** Suggested DeEss threshold, dBFS. */
  readonly thresholdDb: number;
  /** Fraction of non-silent windows where the band is within 12 dB of the speech body. */
  readonly fraction: number;
}

export interface AudioIssueReport {
  readonly durationSec: number;
  readonly sampleRate: number;
  readonly peakDb: number;
  readonly hum: HumFinding;
  readonly clipping: ClippingFinding;
  readonly clicks: ClicksFinding;
  readonly sibilance: SibilanceFinding;
}

export interface RepairSuggestion {
  readonly type: RepairEffectType;
  readonly params: Record<string, number>;
  readonly reason: string;
}

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i += 1) out[i] += c[i] / channels.length;
  return out;
}

/** Average power spectrum (Welch, Hann) with `fftSize` bins/2. */
export function averagePowerSpectrum(samples: Float32Array, fftSize: number, maxFrames = 400): Float64Array {
  const fft = new FFT(fftSize);
  const bins = fftSize / 2;
  const acc = new Float64Array(bins);
  const hop = Math.max(fftSize / 2, Math.floor((samples.length - fftSize) / maxFrames));
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const frame = new Float32Array(fftSize);
  let frames = 0;
  for (let at = 0; at + fftSize <= samples.length; at += hop) {
    for (let i = 0; i < fftSize; i += 1) frame[i] = samples[at + i] * window[i];
    const { real, imag } = fft.forward(frame);
    for (let k = 0; k < bins; k += 1) acc[k] += real[k] * real[k] + imag[k] * imag[k];
    frames += 1;
  }
  if (frames > 0) for (let k = 0; k < bins; k += 1) acc[k] /= frames;
  return acc;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

export function detectHum(samples: Float32Array, sampleRate: number): HumFinding {
  const none: HumFinding = { present: false, frequency: 60, prominenceDb: 0, harmonics: 0 };
  const fftSize = 16384;
  if (samples.length < fftSize) return none;
  const spectrum = averagePowerSpectrum(samples, fftSize);
  const binHz = sampleRate / fftSize;
  const prominence = (freq: number): { db: number; freq: number } => {
    const center = Math.round(freq / binHz);
    const reach = Math.max(1, Math.round(1.2 / binHz));
    let peak = 0;
    let peakBin = center;
    for (let k = center - reach; k <= center + reach; k += 1) {
      if (spectrum[k] > peak) {
        peak = spectrum[k];
        peakBin = k;
      }
    }
    const around: number[] = [];
    const lo = Math.round(14 / binHz);
    const hi = Math.round(4 / binHz);
    for (let k = center - lo; k <= center + lo; k += 1) {
      if (Math.abs(k - center) > hi && k > 0) around.push(spectrum[k]);
    }
    const floor = median(around) + 1e-18;
    return { db: 10 * Math.log10(peak / floor), freq: peakBin * binHz };
  };
  let best: HumFinding = none;
  for (const base of [50, 60]) {
    const harmonicHits: number[] = [];
    let fundamentalDb = 0;
    for (let h = 1; h <= 6; h += 1) {
      if (base * h > sampleRate * 0.4) break;
      const p = prominence(base * h);
      if (h === 1) {
        fundamentalDb = p.db;
      }
      if (p.db >= 12) harmonicHits.push(p.db);
    }
    const strongest = harmonicHits.length ? Math.max(...harmonicHits) : fundamentalDb;
    // Two harmonics of the same fundamental is far more convincing than one lone tone.
    const present = harmonicHits.length >= 2 || fundamentalDb >= 20;
    if (present && strongest > best.prominenceDb) {
      best = { present, frequency: base, prominenceDb: strongest, harmonics: harmonicHits.length };
    }
  }
  return best;
}

export function detectClipping(channels: readonly Float32Array[]): ClippingFinding {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i += 1) peak = Math.max(peak, Math.abs(c[i]));
  const none: ClippingFinding = { present: false, clippedSamples: 0, runs: 0, peak, thresholdDb: db(Math.max(peak * 0.98, 1e-6)) };
  if (peak < 0.2) return none;
  const level = peak * 0.995;
  let clipped = 0;
  let runs = 0;
  for (const c of channels) {
    let run = 0;
    let sign = 0;
    for (let i = 0; i < c.length; i += 1) {
      const s = c[i] >= level ? 1 : c[i] <= -level ? -1 : 0;
      if (s !== 0 && (run === 0 || s === sign)) {
        run += 1;
        sign = s;
      } else {
        if (run >= 3) {
          runs += 1;
          clipped += run;
        }
        run = s !== 0 ? 1 : 0;
        sign = s;
      }
    }
    if (run >= 3) {
      runs += 1;
      clipped += run;
    }
  }
  return { present: runs >= 3, clippedSamples: clipped, runs, peak, thresholdDb: Math.min(-0.05, db(peak * 0.98)) };
}

export function detectSibilance(samples: Float32Array, sampleRate: number): SibilanceFinding {
  const none: SibilanceFinding = { present: false, centerHz: 6500, peakDb: -90, thresholdDb: -30, fraction: 0 };
  if (samples.length < sampleRate * 0.2) return none;
  // Locate the strongest part of the sibilance region from the average spectrum.
  const spectrum = averagePowerSpectrum(samples, 2048);
  const binHz = sampleRate / 2048;
  let centerHz = 6500;
  let bestPower = 0;
  for (let k = Math.round(4000 / binHz); k < Math.min(spectrum.length, Math.round(10000 / binHz)); k += 1) {
    if (spectrum[k] > bestPower) {
      bestPower = spectrum[k];
      centerHz = k * binHz;
    }
  }
  centerHz = Math.min(Math.max(centerHz, 4500), 9500);
  const band = new RepairBiquad(bandpassCoefficients(sampleRate, centerHz, 1.5));
  const body = new RepairBiquad(bandpassCoefficients(sampleRate, 400, 0.6));
  const win = Math.round(sampleRate * 0.01);
  const bandPeaks: number[] = [];
  const bandRms: number[] = [];
  const bodyRms: number[] = [];
  for (let at = 0; at + win <= samples.length; at += win) {
    let peak = 0;
    let bs = 0;
    let bb = 0;
    for (let i = at; i < at + win; i += 1) {
      const b = band.process(samples[i]);
      const d = body.process(samples[i]);
      peak = Math.max(peak, Math.abs(b));
      bs += b * b;
      bb += d * d;
    }
    bandPeaks.push(peak);
    bandRms.push(Math.sqrt(bs / win));
    bodyRms.push(Math.sqrt(bb / win));
  }
  const active = bodyRms.map((v, i) => (v > 1e-3 || bandRms[i] > 1e-3 ? i : -1)).filter((i) => i >= 0);
  if (active.length < 5) return none;
  const loud = active.filter((i) => db(bandRms[i]) > db(bodyRms[i]) - 12 && bandRms[i] > 3e-3);
  const fraction = loud.length / active.length;
  const peaksDb = bandPeaks.map(db).sort((a, b) => a - b);
  const p95 = peaksDb[Math.floor(peaksDb.length * 0.95)] ?? -90;
  const strongest = peaksDb[peaksDb.length - 1] ?? -90;
  return {
    present: loud.length >= 4 && fraction >= 0.02 && strongest > -30,
    centerHz: Math.round(centerHz / 50) * 50,
    peakDb: strongest,
    thresholdDb: Math.round(Math.max(-60, Math.min(-10, p95 - 6))),
    fraction,
  };
}

/**
 * `segmentFrames` (optional) lists the lengths of back-to-back excerpts the
 * samples were stitched from (a long clip is analysed from a few windows). The
 * joins are discontinuities that look exactly like clicks, so click detection
 * runs on each excerpt on its own.
 */
export function analyzeAudioIssues(
  channels: readonly Float32Array[],
  sampleRate: number,
  segmentFrames?: readonly number[],
): AudioIssueReport {
  const mono = mixToMono(channels);
  const durationSec = mono.length / sampleRate;
  let peak = 0;
  for (let i = 0; i < mono.length; i += 1) peak = Math.max(peak, Math.abs(mono[i]));
  const clickPositions: number[] = [];
  const total = segmentFrames?.reduce((sum, n) => sum + n, 0) ?? 0;
  if (segmentFrames && segmentFrames.length > 1 && total === mono.length) {
    let at = 0;
    for (const length of segmentFrames) {
      for (const position of detectClicks(mono.subarray(at, at + length), 0.5)) clickPositions.push(at + position);
      at += length;
    }
  } else {
    clickPositions.push(...detectClicks(mono, 0.5));
  }
  const clicksPerMinute = durationSec > 0 ? (clickPositions.length / durationSec) * 60 : 0;
  return {
    durationSec,
    sampleRate,
    peakDb: db(peak),
    hum: detectHum(mono, sampleRate),
    clipping: detectClipping(channels),
    clicks: { present: clickPositions.length >= 3, count: clickPositions.length, perMinute: clicksPerMinute },
    sibilance: detectSibilance(mono, sampleRate),
  };
}

/** Effects (in signal-chain order) that would address what was found. */
export function suggestRepairs(report: AudioIssueReport): RepairSuggestion[] {
  const out: RepairSuggestion[] = [];
  if (report.clipping.present) {
    out.push({
      type: "deClip",
      params: { threshold: Math.round(report.clipping.thresholdDb * 10) / 10, maxRun: 64 },
      reason: `${report.clipping.runs} clipped peak${report.clipping.runs === 1 ? "" : "s"} (${report.clipping.clippedSamples} samples) at ${report.clipping.peak.toFixed(2)} full scale`,
    });
  }
  if (report.clicks.present) {
    out.push({
      type: "deClick",
      params: { sensitivity: report.clicks.perMinute > 120 ? 0.7 : 0.5, maxWidth: 24 },
      reason: `${report.clicks.count} click${report.clicks.count === 1 ? "" : "s"} detected (${report.clicks.perMinute.toFixed(0)}/min)`,
    });
  }
  if (report.hum.present) {
    out.push({
      type: "deHum",
      params: { frequency: report.hum.frequency, harmonics: Math.max(3, Math.min(6, report.hum.harmonics + 2)), q: 30, depth: 1 },
      reason: `${report.hum.frequency} Hz mains hum, ${report.hum.prominenceDb.toFixed(0)} dB above its surroundings (${report.hum.harmonics} harmonic${report.hum.harmonics === 1 ? "" : "s"})`,
    });
  }
  if (report.sibilance.present) {
    out.push({
      type: "deEss",
      params: { frequency: report.sibilance.centerHz, threshold: report.sibilance.thresholdDb, ratio: 5, bandwidthQ: 1.5 },
      reason: `Harsh sibilance around ${(report.sibilance.centerHz / 1000).toFixed(1)} kHz in ${(report.sibilance.fraction * 100).toFixed(0)}% of speech`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Spectrogram                                                          */
/* ------------------------------------------------------------------ */

export interface Spectrogram {
  readonly frames: number;
  readonly bins: number;
  readonly sampleRate: number;
  readonly fftSize: number;
  /** frames x bins, row-major; 0 (floor) .. 255 (loudest) over a 90 dB range. */
  readonly data: Uint8Array;
  readonly maxDb: number;
}

export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  options: { fftSize?: number; maxFrames?: number } = {},
): Spectrogram {
  const fftSize = options.fftSize ?? 2048;
  const maxFrames = options.maxFrames ?? 640;
  const fft = new FFT(fftSize);
  const bins = fftSize / 2;
  const hop = Math.max(fftSize / 4, Math.ceil((samples.length - fftSize) / Math.max(1, maxFrames - 1)));
  const frames = Math.max(1, Math.floor((samples.length - fftSize) / hop) + 1);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  const frame = new Float32Array(fftSize);
  const dbs = new Float32Array(frames * bins);
  let maxDb = -200;
  for (let f = 0; f < frames; f += 1) {
    const at = f * hop;
    for (let i = 0; i < fftSize; i += 1) frame[i] = (samples[at + i] ?? 0) * window[i];
    const { real, imag } = fft.forward(frame);
    for (let k = 0; k < bins; k += 1) {
      const value = 10 * Math.log10((real[k] * real[k] + imag[k] * imag[k]) / (fftSize * fftSize * 0.375) + 1e-14);
      dbs[f * bins + k] = value;
      if (value > maxDb) maxDb = value;
    }
  }
  const data = new Uint8Array(frames * bins);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.max(0, Math.min(255, Math.round(((dbs[i] - (maxDb - 90)) / 90) * 255)));
  }
  return { frames, bins, sampleRate, fftSize, data, maxDb };
}
