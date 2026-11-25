import { BLEND_MODES, type BlendMode } from "./types";
import { BLEND_MODE_GROUPS } from "./blend-reference";

/** Every blend mode, in the order of Premiere's grouped menu. */
export function getAvailableBlendModes(): BlendMode[] {
  const grouped = BLEND_MODE_GROUPS.flatMap((group) => group.modes);
  const missing = BLEND_MODES.filter((mode) => !grouped.includes(mode));
  return [...grouped, ...missing];
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
    "linear-burn": "Linear Burn",
    "darker-color": "Darker Color",
    "lighter-color": "Lighter Color",
    "linear-light": "Linear Light",
    "vivid-light": "Vivid Light",
    "pin-light": "Pin Light",
    "hard-mix": "Hard Mix",
    subtract: "Subtract",
    divide: "Divide",
    dissolve: "Dissolve",
  };
  return names[mode] || mode;
}
