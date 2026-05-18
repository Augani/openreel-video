import type { EditingTemplateCategoryDefinition } from "./types";

export const EDITING_TEMPLATE_CATEGORIES: readonly EditingTemplateCategoryDefinition[] = [
  {
    id: "cinema",
    name: "Cinema",
    description: "Letterbox, grain, and dramatic finishing touches.",
    icon: "clapperboard",
  },
  {
    id: "glitch",
    name: "Glitch",
    description: "Digital breakup, scanlines, and signal drift.",
    icon: "zap",
  },
  {
    id: "retro",
    name: "Retro",
    description: "Tape, CRT, and old-film inspired looks.",
    icon: "tv",
  },
  {
    id: "social",
    name: "Social",
    description: "Recording overlays, countdowns, and creator framing.",
    icon: "smartphone",
  },
  {
    id: "branding",
    name: "Branding",
    description: "Watermarks, lower thirds, and copyright overlays.",
    icon: "badge",
  },
  {
    id: "color",
    name: "Color",
    description: "Fast mood changes through stacked correction presets.",
    icon: "palette",
  },
  {
    id: "overlay",
    name: "Overlay",
    description: "Frames, focus markers, and atmospheric graphic layers.",
    icon: "layers",
  },
  {
    id: "text-effects",
    name: "Text Effects",
    description: "Stylized motion captions and title accents.",
    icon: "type",
  },
  {
    id: "transitions",
    name: "Transitions",
    description: "Reserved for clip-to-clip recipe transitions.",
    icon: "shuffle",
  },
] as const;