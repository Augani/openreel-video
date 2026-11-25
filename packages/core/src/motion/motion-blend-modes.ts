import { BLEND_MODES, type BlendMode } from "../video/types";
import { getNativeCanvasBlendOperation, needsCpuBlend } from "../video/blend-reference";

interface MotionBlendModeOption {
  readonly id: BlendMode;
  readonly name: string;
}

export const MOTION_BLEND_MODE_OPTIONS: readonly MotionBlendModeOption[] =
  BLEND_MODES.map((id) => ({
    id,
    name: formatBlendModeName(id),
  }));

export function getMotionCanvasBlendMode(
  blendMode: BlendMode | undefined,
): GlobalCompositeOperation {
  const mode = blendMode ?? "normal";
  return getNativeCanvasBlendOperation(mode) ?? "source-over";
}

type MotionCssBlendMode =
  | Exclude<
      BlendMode,
      | "normal"
      | "add"
      | "linear-dodge"
      | "linear-burn"
      | "darker-color"
      | "lighter-color"
      | "linear-light"
      | "vivid-light"
      | "pin-light"
      | "hard-mix"
      | "subtract"
      | "divide"
      | "dissolve"
    >
  | "plus-lighter";

export function buildMotionCssBlendMode(
  blendMode: BlendMode | undefined,
): MotionCssBlendMode | undefined {
  if (!blendMode || blendMode === "normal") return undefined;
  if (blendMode === "add" || blendMode === "linear-dodge") {
    return "plus-lighter";
  }
  if (needsCpuBlend(blendMode)) return undefined;
  return blendMode as MotionCssBlendMode;
}

function formatBlendModeName(mode: BlendMode): string {
  return mode
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
