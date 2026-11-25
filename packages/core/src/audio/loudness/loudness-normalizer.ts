import { LoudnessMeter, type LoudnessSnapshot } from "./loudness-meter";
import { TruePeakLimiter } from "./true-peak-limiter";

/** What a spec's integrated loudness is measured over. */
export type LoudnessGating = "program" | "dialogue";

/** Loudness-targeted delivery settings (export "Normalize to target loudness"). */
export interface LoudnessTargetSettings {
  readonly enabled: boolean;
  /** Integrated loudness to hit, LUFS. */
  readonly targetLufs: number;
  /** True-peak ceiling the output must stay under, dBTP. */
  readonly truePeakCeilingDb: number;
  /** Delivery spec this target came from (LOUDNESS_PRESETS id); absent for a custom target. */
  readonly specId?: string;
  /** Allowed deviation from `targetLufs` for compliance, LU. Default 1. */
  readonly toleranceLu?: number;
  /** Measure integrated loudness over the whole program (default) or the dialogue only. */
  readonly gating?: LoudnessGating;
  /** Loudness range the delivery must not exceed, LU. */
  readonly maxLoudnessRange?: number;
}

export interface LoudnessPreset {
  readonly id: string;
  readonly label: string;
  /** Standard / platform the spec comes from. */
  readonly standard: string;
  readonly targetLufs: number;
  readonly truePeakCeilingDb: number;
  /** Compliance tolerance around the target, LU. */
  readonly toleranceLu: number;
  readonly gating: LoudnessGating;
  readonly maxLoudnessRange?: number;
}

export const LOUDNESS_PRESETS: readonly LoudnessPreset[] = [
  { id: "streaming", label: "Spotify / YouTube (-14 LUFS)", standard: "Spotify / YouTube", targetLufs: -14, truePeakCeilingDb: -1, toleranceLu: 1, gating: "program" },
  { id: "podcast", label: "Apple Podcasts (-16 LUFS)", standard: "Apple Podcasts", targetLufs: -16, truePeakCeilingDb: -1, toleranceLu: 1, gating: "program" },
  { id: "broadcast", label: "EBU R128 (-23 LUFS)", standard: "EBU R128", targetLufs: -23, truePeakCeilingDb: -1, toleranceLu: 0.5, gating: "program" },
  { id: "atsc-a85", label: "ATSC A/85 (-24 LKFS)", standard: "ATSC A/85", targetLufs: -24, truePeakCeilingDb: -2, toleranceLu: 2, gating: "program" },
  { id: "netflix", label: "Netflix (-27 LUFS dialogue)", standard: "Netflix", targetLufs: -27, truePeakCeilingDb: -2, toleranceLu: 2, gating: "dialogue", maxLoudnessRange: 18 },
  { id: "amazon-prime", label: "Amazon Prime (-24 LUFS)", standard: "Amazon Prime Video", targetLufs: -24, truePeakCeilingDb: -2, toleranceLu: 2, gating: "program" },
];

/** The export target a preset resolves to. */
export function loudnessTargetFromPreset(preset: LoudnessPreset, enabled = true): LoudnessTargetSettings {
  return {
    enabled,
    targetLufs: preset.targetLufs,
    truePeakCeilingDb: preset.truePeakCeilingDb,
    specId: preset.id,
    toleranceLu: preset.toleranceLu,
    gating: preset.gating,
    ...(preset.maxLoudnessRange !== undefined ? { maxLoudnessRange: preset.maxLoudnessRange } : {}),
  };
}

export const DEFAULT_LOUDNESS_TARGET: LoudnessTargetSettings = {
  enabled: false,
  targetLufs: -14,
  truePeakCeilingDb: -1,
};

export const MIN_LOUDNESS_TARGET_LUFS = -40;
export const MAX_LOUDNESS_TARGET_LUFS = -5;

export function isValidLoudnessTarget(target: LoudnessTargetSettings): boolean {
  return (
    Number.isFinite(target.targetLufs) &&
    target.targetLufs >= MIN_LOUDNESS_TARGET_LUFS &&
    target.targetLufs <= MAX_LOUDNESS_TARGET_LUFS &&
    Number.isFinite(target.truePeakCeilingDb) &&
    target.truePeakCeilingDb <= 0 &&
    target.truePeakCeilingDb >= -20
  );
}

export interface NormalizationPlan {
  /** Static gain to apply, dB. */
  readonly gainDb: number;
  /** True peak after that gain (before any limiting), dBTP. */
  readonly predictedTruePeakDb: number;
  /** The gain would push peaks over the ceiling, so a limiter is needed. */
  readonly limiterRequired: boolean;
  /** Measured signal contained no gated loudness (silence). */
  readonly silent: boolean;
  /** Which measurement the gain was derived from. */
  readonly basis: LoudnessGating;
  /** A dialogue-gated spec found no dialogue, so the program loudness was used. */
  readonly dialogueFallback: boolean;
}

export function planNormalization(
  measured: Pick<LoudnessSnapshot, "integrated" | "truePeak"> & Partial<Pick<LoudnessSnapshot, "dialogueIntegrated">>,
  target: Pick<LoudnessTargetSettings, "targetLufs" | "truePeakCeilingDb"> & Partial<Pick<LoudnessTargetSettings, "gating">>,
): NormalizationPlan {
  const wantsDialogue = target.gating === "dialogue";
  const dialogue = measured.dialogueIntegrated;
  const useDialogue = wantsDialogue && dialogue !== undefined && Number.isFinite(dialogue);
  const basis: LoudnessGating = useDialogue ? "dialogue" : "program";
  const dialogueFallback = wantsDialogue && !useDialogue;
  const reference = useDialogue ? (dialogue as number) : measured.integrated;
  if (!Number.isFinite(reference)) {
    return { gainDb: 0, predictedTruePeakDb: measured.truePeak, limiterRequired: false, silent: true, basis, dialogueFallback };
  }
  const gainDb = target.targetLufs - reference;
  const predictedTruePeakDb = measured.truePeak + gainDb;
  return {
    gainDb,
    predictedTruePeakDb,
    limiterRequired: predictedTruePeakDb > target.truePeakCeilingDb + 1e-9,
    silent: false,
    basis,
    dialogueFallback,
  };
}

export const dbToLinear = (db: number): number => Math.pow(10, db / 20);

/**
 * Applies the planned static gain, followed by the look-ahead true-peak limiter
 * only when the gain would otherwise exceed the ceiling. Chunk-streaming and
 * length-preserving once `flush()` has been appended to the last chunk.
 */
export class LoudnessNormalizer {
  readonly plan: NormalizationPlan;
  private readonly gain: number;
  private readonly limiter?: TruePeakLimiter;

  constructor(
    plan: NormalizationPlan,
    target: Pick<LoudnessTargetSettings, "truePeakCeilingDb">,
    sampleRate: number,
    channels: number,
  ) {
    this.plan = plan;
    this.gain = dbToLinear(plan.gainDb);
    if (plan.limiterRequired) {
      this.limiter = new TruePeakLimiter(sampleRate, channels, target.truePeakCeilingDb);
    }
  }

  get maxGainReductionDb(): number {
    return this.limiter?.maxGainReductionDb ?? 0;
  }

  process(channels: ArrayLike<number>[], length = channels[0]?.length ?? 0): Float32Array[] {
    const scaled = channels.map((data) => {
      const out = new Float32Array(length);
      for (let i = 0; i < length; i++) out[i] = data[i] * this.gain;
      return out;
    });
    return this.limiter ? this.limiter.process(scaled, length) : scaled;
  }

  flush(): Float32Array[] {
    return this.limiter ? this.limiter.flush() : [];
  }
}

export interface PcmChunk {
  readonly sampleRate: number;
  readonly channels: Float32Array[];
}

export interface MeasureRenderedOptions {
  readonly sampleRate: number;
  readonly channels: number;
  /** Total length to analyse, seconds. */
  readonly duration: number;
  /** Seconds of mix rendered per step. */
  readonly chunkSeconds?: number;
  /** Renders [start, start + duration) of the mix; null means silence. */
  readonly render: (start: number, duration: number) => Promise<PcmChunk | null>;
  /** Also measure dialogue-gated loudness. */
  readonly dialogueGate?: boolean;
  /** 0..1 */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/**
 * Loudness of a mix rendered in chunks (the offline-mixdown path the export
 * pipeline uses), so arbitrarily long timelines never need one huge buffer.
 */
export async function measureRenderedLoudness(options: MeasureRenderedOptions): Promise<LoudnessSnapshot> {
  const chunkSeconds = options.chunkSeconds ?? 15;
  const meter = new LoudnessMeter(options.sampleRate, options.channels, { dialogueGate: options.dialogueGate });
  for (let start = 0; start < options.duration - 1e-9; start += chunkSeconds) {
    if (options.signal?.aborted) throw new DOMException("Loudness analysis cancelled", "AbortError");
    const length = Math.min(chunkSeconds, options.duration - start);
    const chunk = await options.render(start, length);
    if (chunk) {
      const feed = Array.from({ length: options.channels }, (_, c) => chunk.channels[c] ?? chunk.channels[0]);
      meter.process(feed);
    } else {
      const frames = Math.round(length * options.sampleRate);
      meter.process(Array.from({ length: options.channels }, () => new Float32Array(frames)));
    }
    options.onProgress?.(Math.min(1, (start + length) / options.duration));
    // Let the UI breathe between 15 s chunks.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return meter.snapshot();
}
