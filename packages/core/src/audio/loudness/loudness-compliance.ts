import type { LoudnessSnapshot } from "./loudness-meter";
import type { LoudnessGating, LoudnessTargetSettings } from "./loudness-normalizer";
import { LOUDNESS_PRESETS } from "./loudness-normalizer";

/** Slack on the true-peak ceiling for meter / encoder rounding, dB. */
export const TRUE_PEAK_TOLERANCE_DB = 0.1;
export const DEFAULT_TOLERANCE_LU = 1;

export type ComplianceCheckId = "loudness" | "truePeak" | "loudnessRange";

export interface ComplianceCheck {
  readonly id: ComplianceCheckId;
  readonly label: string;
  /** Measured value (LUFS, dBTP or LU); -Infinity for silence. */
  readonly measured: number;
  /** Human-readable requirement, e.g. "-23 ±0.5 LUFS". */
  readonly requirement: string;
  readonly pass: boolean;
}

export interface ComplianceResult {
  readonly specId?: string;
  readonly specLabel: string;
  readonly basis: LoudnessGating;
  /** A dialogue-gated spec found no dialogue; the program loudness was checked instead. */
  readonly dialogueFallback: boolean;
  readonly pass: boolean;
  readonly checks: readonly ComplianceCheck[];
}

export type ComplianceTarget = Pick<LoudnessTargetSettings, "targetLufs" | "truePeakCeilingDb"> &
  Partial<Pick<LoudnessTargetSettings, "specId" | "toleranceLu" | "gating" | "maxLoudnessRange">>;

export type ComplianceMeasurement = Pick<LoudnessSnapshot, "integrated" | "loudnessRange" | "truePeak"> &
  Partial<Pick<LoudnessSnapshot, "dialogueIntegrated">>;

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

/** Pass / fail of a measured mix against a delivery spec: loudness, true peak and (when the spec has one) loudness range. */
export function evaluateCompliance(target: ComplianceTarget, measured: ComplianceMeasurement): ComplianceResult {
  const preset = LOUDNESS_PRESETS.find((p) => p.id === target.specId);
  const tolerance = target.toleranceLu ?? preset?.toleranceLu ?? DEFAULT_TOLERANCE_LU;
  const wantsDialogue = (target.gating ?? preset?.gating) === "dialogue";
  const dialogue = measured.dialogueIntegrated;
  const useDialogue = wantsDialogue && dialogue !== undefined && Number.isFinite(dialogue);
  const basis: LoudnessGating = useDialogue ? "dialogue" : "program";
  const loudness = useDialogue ? (dialogue as number) : measured.integrated;
  const maxLra = target.maxLoudnessRange ?? preset?.maxLoudnessRange;
  const unit = useDialogue ? "LUFS (dialogue)" : "LUFS";

  const checks: ComplianceCheck[] = [
    {
      id: "loudness",
      label: useDialogue ? "Dialogue loudness" : "Integrated loudness",
      measured: loudness,
      requirement: `${fmt(target.targetLufs)} ±${fmt(tolerance)} ${unit}`,
      pass: Number.isFinite(loudness) && Math.abs(loudness - target.targetLufs) <= tolerance + 1e-9,
    },
    {
      id: "truePeak",
      label: "True peak",
      measured: measured.truePeak,
      requirement: `≤ ${fmt(target.truePeakCeilingDb)} dBTP`,
      pass: measured.truePeak <= target.truePeakCeilingDb + TRUE_PEAK_TOLERANCE_DB,
    },
  ];
  if (maxLra !== undefined) {
    checks.push({
      id: "loudnessRange",
      label: "Loudness range",
      measured: measured.loudnessRange,
      requirement: `≤ ${fmt(maxLra)} LU`,
      pass: measured.loudnessRange <= maxLra + 1e-9,
    });
  }
  return {
    ...(target.specId ? { specId: target.specId } : {}),
    specLabel: preset?.standard ?? `Custom ${fmt(target.targetLufs)} LUFS`,
    basis,
    dialogueFallback: wantsDialogue && !useDialogue,
    pass: checks.every((c) => c.pass),
    checks,
  };
}
