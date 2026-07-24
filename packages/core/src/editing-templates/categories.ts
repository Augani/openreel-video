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
  {
    id: "ads",
    name: "Ads",
    description: "Reusable ad cards, product promos, and launch scenes.",
    icon: "megaphone",
  },
  {
    id: "app-ui-demos",
    name: "App UI Demos",
    description: "Animated interface walkthroughs and product UI moments.",
    icon: "monitor",
  },
  {
    id: "lower-thirds",
    name: "Lower Thirds",
    description: "Name straps, titles, and branded information bands.",
    icon: "panel-bottom",
  },
  {
    id: "product-shots",
    name: "Product Shots",
    description: "Media placeholders, feature callouts, and polished showcases.",
    icon: "box",
  },
  {
    id: "social-hooks",
    name: "Social Hooks",
    description: "Fast opening beats for short-form social videos.",
    icon: "sparkles",
  },
  {
    id: "kinetic-typography",
    name: "Kinetic Typography",
    description: "Animated type systems for captions, quotes, and slogans.",
    icon: "type",
  },
  {
    id: "logo-reveals",
    name: "Logo Reveals",
    description: "Logo animation starters for brand intros and outros.",
    icon: "badge",
  },
  {
    id: "end-screens",
    name: "End Screens",
    description: "Animated end cards, CTAs, and subscribe prompts.",
    icon: "flag",
  },
] as const;
