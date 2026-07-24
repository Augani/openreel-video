export const PREVIEW_MAX_DIMENSION = 1920;

export function computePreviewResolution(
  width: number,
  height: number,
  maxDimension: number = PREVIEW_MAX_DIMENSION,
): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      scale: 1,
    };
  }

  const longest = Math.max(width, height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export type PreviewQuality = "auto" | "full" | "half" | "quarter";

export const PREVIEW_QUALITY_OPTIONS: {
  value: PreviewQuality;
  label: string;
}[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "half", label: "½" },
  { value: "quarter", label: "¼" },
];

export function previewQualityScale(
  quality: PreviewQuality,
  width: number,
  height: number,
): number {
  switch (quality) {
    case "full":
      return 1;
    case "half":
      return 0.5;
    case "quarter":
      return 0.25;
    case "auto":
    default:
      return Math.max(width, height) > 2560 ? 0.5 : 1;
  }
}
