import type { FitMode } from "../types/timeline";

interface CanvasFitDimensions {
  width: number;
  height: number;
}

/**
 * Resolve the size used to draw a source into a canvas. The source dimensions
 * should describe the visible source rectangle, after cropping when present.
 */
export function resolveCanvasFitDimensions(
  fitMode: FitMode | undefined,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): CanvasFitDimensions {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return {
      width: Math.max(0, Number.isFinite(canvasWidth) ? canvasWidth : 0),
      height: Math.max(0, Number.isFinite(canvasHeight) ? canvasHeight : 0),
    };
  }

  const mode = !fitMode || fitMode === "none" ? "contain" : fitMode;
  if (mode === "stretch") {
    return { width: canvasWidth, height: canvasHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  const fitByHeight =
    mode === "cover"
      ? sourceAspect > canvasAspect
      : sourceAspect <= canvasAspect;

  if (fitByHeight) {
    return {
      width: canvasHeight * sourceAspect,
      height: canvasHeight,
    };
  }

  return {
    width: canvasWidth,
    height: canvasWidth / sourceAspect,
  };
}
