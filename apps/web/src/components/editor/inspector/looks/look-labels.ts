import type { FilterPreset } from "@openreel/core";

/** Plain names for the effect types a filter preset is built from (the chips used to show the raw ids). */
const EFFECT_LABELS: Record<string, string> = {
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  hue: "Hue shift",
  blur: "Blur",
  sharpen: "Sharpen",
  vignette: "Vignette",
  grain: "Film grain",
};

export function effectLabel(type: string): string {
  return EFFECT_LABELS[type] ?? type.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Each distinct adjustment of the preset once, in application order. */
export function presetAdjustments(preset: Pick<FilterPreset, "effects">): string[] {
  return [...new Set(preset.effects.map((effect) => effectLabel(effect.type)))];
}

/** "Contrast, Saturation, Vignette". */
export function presetSummary(preset: Pick<FilterPreset, "effects">): string {
  return presetAdjustments(preset).join(", ");
}
