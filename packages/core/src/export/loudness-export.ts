import {
  LoudnessNormalizer,
  isValidLoudnessTarget,
  measureLoudness,
  planNormalization,
  type LoudnessSnapshot,
  type LoudnessTargetSettings,
  type NormalizationPlan,
} from "../audio/loudness";

/** What loudness normalization did to an export, reported in `ExportStats`. */
export interface LoudnessExportReport {
  readonly targetLufs: number;
  readonly truePeakCeilingDb: number;
  /** Mixdown before normalization. */
  readonly measuredLufs: number;
  readonly measuredTruePeakDb: number;
  readonly measuredLoudnessRange: number;
  readonly gainDb: number;
  /** The true-peak limiter had to engage to respect the ceiling. */
  readonly limiterEngaged: boolean;
  /** Deepest limiter gain reduction, dB (<= 0). */
  readonly maxGainReductionDb: number;
  /** The mixdown was silent, so nothing could be normalized. */
  readonly silent: boolean;
}

export function activeLoudnessTarget(
  target: LoudnessTargetSettings | undefined,
): LoudnessTargetSettings | undefined {
  return target?.enabled && isValidLoudnessTarget(target) ? target : undefined;
}

export function buildLoudnessReport(
  target: LoudnessTargetSettings,
  measured: LoudnessSnapshot,
  plan: NormalizationPlan,
  normalizer: LoudnessNormalizer,
): LoudnessExportReport {
  return {
    targetLufs: target.targetLufs,
    truePeakCeilingDb: target.truePeakCeilingDb,
    measuredLufs: measured.integrated,
    measuredTruePeakDb: measured.truePeak,
    measuredLoudnessRange: measured.loudnessRange,
    gainDb: plan.gainDb,
    limiterEngaged: plan.limiterRequired,
    maxGainReductionDb: normalizer.maxGainReductionDb,
    silent: plan.silent,
  };
}

export function audioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

export function createAudioBufferFromChannels(
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer | null {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return null;
  const buffer = new AudioBuffer({ length, numberOfChannels: channels.length, sampleRate });
  channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
  return buffer;
}

/** Normalizes one fully rendered buffer (single-file audio export). */
export function normalizeAudioBuffer(
  buffer: AudioBuffer,
  target: LoudnessTargetSettings,
): { buffer: AudioBuffer; report: LoudnessExportReport } {
  const channels = audioBufferChannels(buffer);
  const measured = measureLoudness(channels, buffer.sampleRate);
  const plan = planNormalization(measured, target);
  const normalizer = new LoudnessNormalizer(plan, target, buffer.sampleRate, channels.length);
  const head = normalizer.process(channels);
  const tail = normalizer.flush();
  const merged = head.map((data, c) => {
    const out = new Float32Array(data.length + (tail[c]?.length ?? 0));
    out.set(data, 0);
    if (tail[c]) out.set(tail[c], data.length);
    return out;
  });
  const normalized = createAudioBufferFromChannels(merged, buffer.sampleRate) ?? buffer;
  return { buffer: normalized, report: buildLoudnessReport(target, measured, plan, normalizer) };
}
