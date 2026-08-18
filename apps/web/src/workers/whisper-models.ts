export type WhisperModelKey = "accurate" | "fast";

export interface WhisperModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly downloadSize: string;
  readonly description: string;
}

export const WHISPER_MODELS: Record<WhisperModelKey, WhisperModelDefinition> = {
  accurate: {
    id: "onnx-community/whisper-large-v3-turbo_timestamped",
    label: "Accurate · Large V3 Turbo",
    shortLabel: "Large V3 Turbo",
    downloadSize: "About 760 MB",
    description: "Best local accuracy; WebGPU recommended",
  },
  fast: {
    id: "onnx-community/whisper-tiny",
    label: "Fast · Whisper Tiny",
    shortLabel: "Whisper Tiny",
    downloadSize: "About 100 MB",
    description: "Fastest option for drafts and lower-memory devices",
  },
};

export const DEFAULT_WHISPER_MODEL: WhisperModelKey = "accurate";

export function isWhisperModelKey(value: unknown): value is WhisperModelKey {
  return value === "accurate" || value === "fast";
}
