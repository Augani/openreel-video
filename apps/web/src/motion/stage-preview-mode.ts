export type MotionStagePreviewMode = "draft" | "final";
export type MotionStagePreviewResolution = "full" | "half" | "quarter";

interface MotionStagePreviewSettings {
  readonly mode: MotionStagePreviewMode;
  readonly resolution: MotionStagePreviewResolution;
}

export function normalizeMotionStagePreviewSettings(
  settings: Partial<MotionStagePreviewSettings>,
): MotionStagePreviewSettings {
  return {
    mode: settings.mode === "draft" ? "draft" : "final",
    resolution:
      settings.resolution === "quarter" || settings.resolution === "half"
        ? settings.resolution
        : "full",
  };
}
