export type FilterEffectType =
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "blur"
  | "sharpen"
  | "vignette"
  | "grain";

export interface FilterEffectParams {
  brightness: { value: number };
  contrast: { value: number };
  saturation: { value: number };
  hue: { rotation: number };
  blur: { radius: number; type: "gaussian" | "box" | "motion"; angle?: number };
  sharpen: { amount: number; radius: number; threshold: number };
  vignette: {
    amount: number;
    midpoint: number;
    roundness: number;
    feather: number;
  };
  grain: { amount: number; size: number; roughness: number; colored: boolean };
}

export interface FilterEffect {
  readonly type: FilterEffectType;
  readonly params: FilterEffectParams[FilterEffectType];
}

export interface FilterPreset {
  readonly id: string;
  readonly name: string;
  readonly category: "cinematic" | "vintage" | "mood" | "color" | "stylized";
  readonly description: string;
  readonly effects: FilterEffect[];
  readonly thumbnail?: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: "cinematic-teal-orange",
    name: "Teal & Orange",
    category: "cinematic",
    description: "Classic Hollywood color grade",
    effects: [
      { type: "contrast", params: { value: 1.15 } },
      { type: "saturation", params: { value: 1.1 } },
      {
        type: "vignette",
        params: { amount: 0.25, midpoint: 0.5, roundness: 0.5, feather: 0.8 },
      },
    ],
  },
  {
    id: "cinematic-noir",
    name: "Film Noir",
    category: "cinematic",
    description: "High contrast black & white",
    effects: [
      { type: "saturation", params: { value: 0 } },
      { type: "contrast", params: { value: 1.4 } },
      { type: "brightness", params: { value: -0.05 } },
      {
        type: "vignette",
        params: { amount: 0.4, midpoint: 0.4, roundness: 0.5, feather: 0.6 },
      },
      {
        type: "grain",
        params: { amount: 0.15, size: 1.5, roughness: 0.5, colored: false },
      },
    ],
  },
  {
    id: "cinematic-blockbuster",
    name: "Blockbuster",
    category: "cinematic",
    description: "Bold, punchy Hollywood look",
    effects: [
      { type: "contrast", params: { value: 1.2 } },
      { type: "saturation", params: { value: 1.15 } },
      { type: "brightness", params: { value: 0.05 } },
      { type: "sharpen", params: { amount: 0.3, radius: 1, threshold: 10 } },
    ],
  },
  {
    id: "vintage-70s",
    name: "70s Retro",
    category: "vintage",
    description: "Warm, faded 1970s aesthetic",
    effects: [
      { type: "saturation", params: { value: 0.85 } },
      { type: "contrast", params: { value: 0.9 } },
      { type: "brightness", params: { value: 0.05 } },
      {
        type: "grain",
        params: { amount: 0.2, size: 2, roughness: 0.6, colored: true },
      },
    ],
  },
  {
    id: "vintage-polaroid",
    name: "Polaroid",
    category: "vintage",
    description: "Classic instant photo look",
    effects: [
      { type: "contrast", params: { value: 1.1 } },
      { type: "saturation", params: { value: 0.9 } },
      {
        type: "vignette",
        params: { amount: 0.3, midpoint: 0.5, roundness: 0.3, feather: 0.85 },
      },
    ],
  },
  {
    id: "vintage-vhs",
    name: "VHS",
    category: "vintage",
    description: "Nostalgic VHS tape effect",
    effects: [
      { type: "saturation", params: { value: 0.8 } },
      { type: "contrast", params: { value: 1.15 } },
      { type: "blur", params: { radius: 0.5, type: "gaussian" } },
      {
        type: "grain",
        params: { amount: 0.25, size: 2.5, roughness: 0.7, colored: true },
      },
    ],
  },
  {
    id: "vintage-sepia",
    name: "Sepia",
    category: "vintage",
    description: "Classic sepia tone",
    effects: [
      { type: "saturation", params: { value: 0.3 } },
      { type: "contrast", params: { value: 1.05 } },
      { type: "brightness", params: { value: 0.1 } },
    ],
  },
  {
    id: "mood-dreamy",
    name: "Dreamy",
    category: "mood",
    description: "Soft, ethereal atmosphere",
    effects: [
      { type: "brightness", params: { value: 0.1 } },
      { type: "saturation", params: { value: 0.85 } },
      { type: "blur", params: { radius: 1, type: "gaussian" } },
      { type: "contrast", params: { value: 0.9 } },
    ],
  },
  {
    id: "mood-moody",
    name: "Moody",
    category: "mood",
    description: "Dark, atmospheric feel",
    effects: [
      { type: "brightness", params: { value: -0.15 } },
      { type: "contrast", params: { value: 1.25 } },
      { type: "saturation", params: { value: 0.75 } },
      {
        type: "vignette",
        params: { amount: 0.35, midpoint: 0.4, roundness: 0.5, feather: 0.7 },
      },
    ],
  },
  {
    id: "mood-golden-hour",
    name: "Golden Hour",
    category: "mood",
    description: "Warm sunset lighting",
    effects: [
      { type: "brightness", params: { value: 0.1 } },
      { type: "saturation", params: { value: 1.2 } },
      { type: "contrast", params: { value: 1.05 } },
    ],
  },
  {
    id: "mood-cold",
    name: "Cold Blue",
    category: "mood",
    description: "Cool, icy atmosphere",
    effects: [
      { type: "saturation", params: { value: 0.9 } },
      { type: "brightness", params: { value: 0.05 } },
      { type: "contrast", params: { value: 1.1 } },
    ],
  },
  {
    id: "color-vibrant",
    name: "Vibrant",
    category: "color",
    description: "Punchy, saturated colors",
    effects: [
      { type: "saturation", params: { value: 1.4 } },
      { type: "contrast", params: { value: 1.15 } },
      { type: "brightness", params: { value: 0.05 } },
    ],
  },
  {
    id: "color-muted",
    name: "Muted",
    category: "color",
    description: "Soft, desaturated palette",
    effects: [
      { type: "saturation", params: { value: 0.6 } },
      { type: "contrast", params: { value: 0.95 } },
      { type: "brightness", params: { value: 0.05 } },
    ],
  },
  {
    id: "color-bw-classic",
    name: "B&W Classic",
    category: "color",
    description: "Timeless black & white",
    effects: [
      { type: "saturation", params: { value: 0 } },
      { type: "contrast", params: { value: 1.1 } },
    ],
  },
  {
    id: "color-bw-high-contrast",
    name: "B&W High Contrast",
    category: "color",
    description: "Dramatic black & white",
    effects: [
      { type: "saturation", params: { value: 0 } },
      { type: "contrast", params: { value: 1.5 } },
      { type: "brightness", params: { value: -0.05 } },
    ],
  },
  {
    id: "stylized-cyberpunk",
    name: "Cyberpunk",
    category: "stylized",
    description: "Neon-lit futuristic look",
    effects: [
      { type: "saturation", params: { value: 1.3 } },
      { type: "contrast", params: { value: 1.3 } },
      {
        type: "vignette",
        params: { amount: 0.3, midpoint: 0.45, roundness: 0.5, feather: 0.75 },
      },
    ],
  },
  {
    id: "stylized-comic",
    name: "Comic Book",
    category: "stylized",
    description: "Bold, graphic novel style",
    effects: [
      { type: "contrast", params: { value: 1.5 } },
      { type: "saturation", params: { value: 1.4 } },
      { type: "sharpen", params: { amount: 0.5, radius: 1.5, threshold: 5 } },
    ],
  },
  {
    id: "stylized-soft-glow",
    name: "Soft Glow",
    category: "stylized",
    description: "Romantic soft focus effect",
    effects: [
      { type: "brightness", params: { value: 0.15 } },
      { type: "blur", params: { radius: 1.5, type: "gaussian" } },
      { type: "contrast", params: { value: 0.85 } },
      { type: "saturation", params: { value: 0.9 } },
    ],
  },
  {
    id: "cinematic-bleach-bypass",
    name: "Bleach Bypass",
    category: "cinematic",
    description: "Gritty, desaturated high contrast",
    effects: [
      { type: "saturation", params: { value: 0.45 } },
      { type: "contrast", params: { value: 1.35 } },
      { type: "sharpen", params: { amount: 0.35, radius: 1, threshold: 8 } },
      { type: "vignette", params: { amount: 0.3, midpoint: 0.5, roundness: 0.5, feather: 0.7 } },
    ],
  },
  {
    id: "cinematic-day-for-night",
    name: "Day for Night",
    category: "cinematic",
    description: "Cool moonlit night look",
    effects: [
      { type: "brightness", params: { value: -0.18 } },
      { type: "contrast", params: { value: 1.2 } },
      { type: "saturation", params: { value: 0.7 } },
      { type: "hue", params: { rotation: 210 } },
      { type: "vignette", params: { amount: 0.45, midpoint: 0.4, roundness: 0.5, feather: 0.6 } },
    ],
  },
  {
    id: "vintage-faded-film",
    name: "Faded Film",
    category: "vintage",
    description: "Washed-out lifted blacks",
    effects: [
      { type: "contrast", params: { value: 0.82 } },
      { type: "saturation", params: { value: 0.8 } },
      { type: "brightness", params: { value: 0.08 } },
      { type: "grain", params: { amount: 0.12, size: 1.4, roughness: 0.5, colored: false } },
      { type: "vignette", params: { amount: 0.2, midpoint: 0.5, roundness: 0.5, feather: 0.8 } },
    ],
  },
  {
    id: "vintage-super8",
    name: "Super 8",
    category: "vintage",
    description: "Warm grainy home-movie feel",
    effects: [
      { type: "hue", params: { rotation: 18 } },
      { type: "saturation", params: { value: 1.1 } },
      { type: "contrast", params: { value: 1.08 } },
      { type: "grain", params: { amount: 0.22, size: 1.8, roughness: 0.6, colored: true } },
      { type: "vignette", params: { amount: 0.35, midpoint: 0.45, roundness: 0.5, feather: 0.7 } },
    ],
  },
  {
    id: "mood-sunset",
    name: "Sunset",
    category: "mood",
    description: "Warm golden glow",
    effects: [
      { type: "hue", params: { rotation: 20 } },
      { type: "saturation", params: { value: 1.2 } },
      { type: "brightness", params: { value: 0.06 } },
      { type: "contrast", params: { value: 1.08 } },
      { type: "vignette", params: { amount: 0.2, midpoint: 0.55, roundness: 0.6, feather: 0.85 } },
    ],
  },
  {
    id: "mood-winter-chill",
    name: "Winter Chill",
    category: "mood",
    description: "Cold, crisp blue tone",
    effects: [
      { type: "hue", params: { rotation: 200 } },
      { type: "saturation", params: { value: 0.78 } },
      { type: "brightness", params: { value: 0.1 } },
      { type: "contrast", params: { value: 1.1 } },
    ],
  },
  {
    id: "mood-dramatic",
    name: "Dramatic",
    category: "mood",
    description: "Moody high-contrast with vignette",
    effects: [
      { type: "contrast", params: { value: 1.3 } },
      { type: "saturation", params: { value: 0.85 } },
      { type: "brightness", params: { value: -0.06 } },
      { type: "vignette", params: { amount: 0.5, midpoint: 0.4, roundness: 0.5, feather: 0.6 } },
    ],
  },
  {
    id: "color-pop",
    name: "Pop",
    category: "color",
    description: "Vivid, punchy colors",
    effects: [
      { type: "saturation", params: { value: 1.45 } },
      { type: "contrast", params: { value: 1.18 } },
      { type: "sharpen", params: { amount: 0.25, radius: 1, threshold: 10 } },
    ],
  },
  {
    id: "color-pastel",
    name: "Pastel",
    category: "color",
    description: "Soft, airy low-contrast tones",
    effects: [
      { type: "contrast", params: { value: 0.82 } },
      { type: "saturation", params: { value: 0.82 } },
      { type: "brightness", params: { value: 0.14 } },
    ],
  },
  {
    id: "stylized-dreamscape",
    name: "Dreamscape",
    category: "stylized",
    description: "Hazy, glowing dream look",
    effects: [
      { type: "blur", params: { radius: 2.5, type: "gaussian" } },
      { type: "brightness", params: { value: 0.18 } },
      { type: "saturation", params: { value: 1.15 } },
      { type: "contrast", params: { value: 0.9 } },
    ],
  },
  {
    id: "stylized-hdr",
    name: "Crisp HDR",
    category: "stylized",
    description: "Hyper-detailed punchy clarity",
    effects: [
      { type: "contrast", params: { value: 1.25 } },
      { type: "saturation", params: { value: 1.2 } },
      { type: "sharpen", params: { amount: 0.6, radius: 1.5, threshold: 4 } },
    ],
  },
  {
    id: "stylized-matrix",
    name: "Matrix",
    category: "stylized",
    description: "Green-tinted digital dystopia",
    effects: [
      { type: "hue", params: { rotation: 95 } },
      { type: "saturation", params: { value: 1.1 } },
      { type: "contrast", params: { value: 1.2 } },
      { type: "brightness", params: { value: -0.05 } },
    ],
  },
];

export const FILTER_CATEGORIES = [
  { id: "cinematic", name: "Cinematic", icon: "film" },
  { id: "vintage", name: "Vintage", icon: "camera" },
  { id: "mood", name: "Mood", icon: "moon" },
  { id: "color", name: "Color", icon: "palette" },
  { id: "stylized", name: "Stylized", icon: "sparkles" },
] as const;

export type FilterCategory = (typeof FILTER_CATEGORIES)[number]["id"];

export function getPresetsByCategory(category: FilterCategory): FilterPreset[] {
  return FILTER_PRESETS.filter((preset) => preset.category === category);
}

export function getPresetById(id: string): FilterPreset | undefined {
  return FILTER_PRESETS.find((preset) => preset.id === id);
}

export function getAllCategories(): typeof FILTER_CATEGORIES {
  return FILTER_CATEGORIES;
}

export function getAllPresets(): FilterPreset[] {
  return FILTER_PRESETS;
}
