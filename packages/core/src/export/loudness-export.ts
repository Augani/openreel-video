import {
  LoudnessMeter,
  LoudnessNormalizer,
  evaluateCompliance,
  isValidLoudnessTarget,
  measureLoudness,
  planNormalization,
  type ComplianceResult,
  type LoudnessGating,
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
  /** Delivery spec the target came from, when one was chosen. */
  readonly specId?: string;
  /** Measurement the gain was derived from. */
  readonly basis: LoudnessGating;
  /** Integrated loudness of the dialogue only in the mixdown, when the spec gates on dialogue. */
  readonly measuredDialogueLufs?: number;
  /** A dialogue-gated spec found no dialogue, so the program loudness was normalized instead. */
  readonly dialogueFallback: boolean;
  /** The normalized output as measured after processing (what is encoded, before codec rounding). */
  readonly output?: {
    readonly integrated: number;
    readonly dialogueIntegrated?: number;
    readonly loudnessRange: number;
    readonly truePeak: number;
  };
  /** Pass / fail of `output` against the delivery spec. */
  readonly compliance?: ComplianceResult;
}

/** True when the target's spec is measured on dialogue, so the meters must run the speech gate. */
export const targetNeedsDialogueGate = (target: Pick<LoudnessTargetSettings, "gating">): boolean =>
  target.gating === "dialogue";

/** A meter configured to measure the normalized output the way the target is specified. */
export function createOutputMeter(
  target: Pick<LoudnessTargetSettings, "gating">,
  sampleRate: number,
  channels: number,
): LoudnessMeter {
  return new LoudnessMeter(sampleRate, channels, { dialogueGate: targetNeedsDialogueGate(target) });
}

/** Adds the measured output and its pass / fail readout to a report. */
export function completeLoudnessReport(
  report: LoudnessExportReport,
  target: LoudnessTargetSettings,
  output: LoudnessSnapshot,
): LoudnessExportReport {
  return {
    ...report,
    output: {
      integrated: output.integrated,
      ...(output.dialogueIntegrated !== undefined ? { dialogueIntegrated: output.dialogueIntegrated } : {}),
      loudnessRange: output.loudnessRange,
      truePeak: output.truePeak,
    },
    compliance: evaluateCompliance(target, output),
  };
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
    ...(target.specId ? { specId: target.specId } : {}),
    basis: plan.basis,
    ...(measured.dialogueIntegrated !== undefined ? { measuredDialogueLufs: measured.dialogueIntegrated } : {}),
    dialogueFallback: plan.dialogueFallback,
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
  const dialogueGate = targetNeedsDialogueGate(target);
  const measured = measureLoudness(channels, buffer.sampleRate, { dialogueGate });
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
  const outputMeter = createOutputMeter(target, buffer.sampleRate, merged.length);
  outputMeter.process(merged);
  const report = completeLoudnessReport(buildLoudnessReport(target, measured, plan, normalizer), target, outputMeter.snapshot());
  return { buffer: normalized, report };
}
