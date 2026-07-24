import { BLEND_MODES, type BlendMode } from "../video/types";

export interface MotionBlendModeOption {
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
  const modeMap: Record<BlendMode, GlobalCompositeOperation> = {
    normal: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    "color-dodge": "color-dodge",
    "color-burn": "color-burn",
    "hard-light": "hard-light",
    "soft-light": "soft-light",
    difference: "difference",
    exclusion: "exclusion",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    luminosity: "luminosity",
    add: "lighter",
    "linear-dodge": "lighter",
  };
  return modeMap[mode] ?? "source-over";
}

export type MotionCssBlendMode =
  | Exclude<BlendMode, "normal" | "add" | "linear-dodge">
  | "plus-lighter";

export function buildMotionCssBlendMode(
  blendMode: BlendMode | undefined,
): MotionCssBlendMode | undefined {
  if (!blendMode || blendMode === "normal") return undefined;
  if (blendMode === "add" || blendMode === "linear-dodge") {
    return "plus-lighter";
  }
  return blendMode;
}

function formatBlendModeName(mode: BlendMode): string {
  return mode
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
