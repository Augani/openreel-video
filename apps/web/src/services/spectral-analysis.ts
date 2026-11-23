import type { SpectralHarmonicSpec, SpectralPoint, SpectralWandMask } from "@openreel/core";

/**
 * Click-to-select analysis for the spectral editor (magic wand, harmonic tracking). Loaded on first use so the analysis
 * code stays out of the editor's own chunk. The analysed signal is the mono mix of the decoded source.
 */

/** Longest source the wand and tracker will analyse (the agent tools use the same limit). */
export const MAX_ANALYSIS_SECONDS = 600;

const monoMixes = new WeakMap<AudioBuffer, Float32Array>();

/** The mono mix of a decoded buffer (cached per buffer). */
export function monoMix(buffer: AudioBuffer): Float32Array {
  const cached = monoMixes.get(buffer);
  if (cached) return cached;
  const mono = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i += 1) mono[i] += data[i] / channels;
  }
  monoMixes.set(buffer, mono);
  return mono;
}

export type WandOutcome = { ok: true; wand: SpectralWandMask; cells: number } | { ok: false; message: string };
export type HarmonicOutcome = { ok: true; points: SpectralPoint[]; seed: SpectralPoint } | { ok: false; message: string };

export async function runMagicWand(buffer: AudioBuffer, seed: SpectralPoint, toleranceDb: number, localContrast: boolean): Promise<WandOutcome> {
  if (buffer.duration > MAX_ANALYSIS_SECONDS) return { ok: false, message: `The magic wand analyses sources up to ${MAX_ANALYSIS_SECONDS / 60} minutes; trim the media first.` };
  const { computeMagicWand, wandFailureMessage } = await import("@openreel/core/audio/spectral/spectral-wand");
  const result = computeMagicWand(monoMix(buffer), buffer.sampleRate, seed, { toleranceDb, localContrast });
  return result.ok ? { ok: true, wand: result.wand, cells: result.cells } : { ok: false, message: wandFailureMessage(result.reason) };
}

export interface HarmonicRequest {
  /** A clicked fundamental. */
  readonly seed?: SpectralPoint;
  /** Or a box: the strongest peak in it is the seed and the track stays inside its time span. */
  readonly box?: { startTime: number; endTime: number; lowHz: number; highHz: number };
  readonly harmonics: number;
  readonly maxHz: number;
}

export async function runHarmonicTrack(buffer: AudioBuffer, request: HarmonicRequest): Promise<HarmonicOutcome> {
  if (buffer.duration > MAX_ANALYSIS_SECONDS) return { ok: false, message: `The harmonic tracker analyses sources up to ${MAX_ANALYSIS_SECONDS / 60} minutes; trim the media first.` };
  const { findBoxSeed, trackHarmonics } = await import("@openreel/core/audio/spectral/spectral-harmonic");
  const mono = monoMix(buffer);
  const seed = request.seed ?? (request.box ? findBoxSeed(mono, buffer.sampleRate, request.box) : null);
  if (!seed) return { ok: false, message: "There is no audible peak in that box to follow." };
  const result = trackHarmonics(mono, buffer.sampleRate, seed, { harmonics: request.harmonics, maxHz: request.maxHz, startTime: request.box?.startTime, endTime: request.box?.endTime });
  if (!result.ok) return { ok: false, message: result.reason === "out-of-range" ? "That point is outside the audio, or too high to carry overtones." : "No steady harmonic sound was found there. Click on the fundamental (the lowest line of the stack)." };
  return { ok: true, points: result.points, seed: result.seed };
}

export type { SpectralHarmonicSpec };
