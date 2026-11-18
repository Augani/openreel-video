import type { BlendMode } from "./types";

export function getAvailableBlendModes(): BlendMode[] {
  return [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
  ];
}

export function getBlendModeName(mode: BlendMode): string {
  const names: Record<BlendMode, string> = {
    normal: "Normal",
    multiply: "Multiply",
    screen: "Screen",
    overlay: "Overlay",
    darken: "Darken",
    lighten: "Lighten",
    "color-dodge": "Color Dodge",
    "color-burn": "Color Burn",
    "hard-light": "Hard Light",
    "soft-light": "Soft Light",
    difference: "Difference",
    exclusion: "Exclusion",
    hue: "Hue",
    saturation: "Saturation",
    color: "Color",
    luminosity: "Luminosity",
    add: "Add",
    "linear-dodge": "Linear Dodge",
  };
  return names[mode] || mode;
}
