import type { Keyframe } from "./composition";

export type LayerEffectType =
  | "blur"
  | "shadow"
  | "glow"
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue-saturation"
  | "color-balance"
  | "curves"
  | "motion-blur"
  | "radial-blur"
  | "vignette"
  | "film-grain"
  | "chromatic-aberration";

export type EffectCategory = "blur" | "color" | "stylize";

export interface EffectParamDefinition {
  key: string;
  label: string;
  type: "number" | "color" | "vector2d" | "curve";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: number | string | { x: number; y: number };
}

export interface EffectDefinition {
  type: LayerEffectType;
  name: string;
  category: EffectCategory;
  params: EffectParamDefinition[];
}

export type EffectParamValue = number | Keyframe[];

export interface LayerEffect {
  id: string;
  type: LayerEffectType;
  name: string;
  enabled: boolean;
  params: Record<string, EffectParamValue>;
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    type: "blur",
    name: "Gaussian Blur",
    category: "blur",
    params: [
      {
        key: "radius",
        label: "Radius",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "px",
        default: 10,
      },
    ],
  },
  {
    type: "shadow",
    name: "Drop Shadow",
    category: "stylize",
    params: [
      {
        key: "offsetX",
        label: "Offset X",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "px",
        default: 5,
      },
      {
        key: "offsetY",
        label: "Offset Y",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "px",
        default: 5,
      },
      {
        key: "blur",
        label: "Blur",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "px",
        default: 10,
      },
      {
        key: "opacity",
        label: "Opacity",
        type: "number",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.8,
      },
      {
        key: "colorR",
        label: "Red",
        type: "number",
        min: 0,
        max: 255,
        step: 1,
        default: 0,
      },
      {
        key: "colorG",
        label: "Green",
        type: "number",
        min: 0,
        max: 255,
        step: 1,
        default: 0,
      },
      {
        key: "colorB",
        label: "Blue",
        type: "number",
        min: 0,
        max: 255,
        step: 1,
        default: 0,
      },
    ],
  },
  {
    type: "glow",
    name: "Glow",
    category: "stylize",
    params: [
      {
        key: "radius",
        label: "Radius",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "px",
        default: 10,
      },
      {
        key: "intensity",
        label: "Intensity",
        type: "number",
        min: 0,
        max: 3,
        step: 0.1,
        default: 1,
      },
    ],
  },
  {
    type: "brightness",
    name: "Brightness",
    category: "color",
    params: [
      {
        key: "value",
        label: "Brightness",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "%",
        default: 0,
      },
    ],
  },
  {
    type: "contrast",
    name: "Contrast",
    category: "color",
    params: [
      {
        key: "value",
        label: "Contrast",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "%",
        default: 0,
      },
    ],
  },
  {
    type: "saturation",
    name: "Saturation",
    category: "color",
    params: [
      {
        key: "value",
        label: "Saturation",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "%",
        default: 0,
      },
    ],
  },
  {
    type: "hue-saturation",
    name: "Hue/Saturation",
    category: "color",
    params: [
      {
        key: "hue",
        label: "Hue",
        type: "number",
        min: -180,
        max: 180,
        step: 1,
        unit: "°",
        default: 0,
      },
      {
        key: "saturation",
        label: "Saturation",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "%",
        default: 0,
      },
      {
        key: "lightness",
        label: "Lightness",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        unit: "%",
        default: 0,
      },
    ],
  },
  {
    type: "color-balance",
    name: "Color Balance",
    category: "color",
    params: [
      {
        key: "shadowsCyanRed",
        label: "Shadows C/R",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "shadowsMagentaGreen",
        label: "Shadows M/G",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "shadowsYellowBlue",
        label: "Shadows Y/B",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "midtonesCyanRed",
        label: "Midtones C/R",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "midtonesMagentaGreen",
        label: "Midtones M/G",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "midtonesYellowBlue",
        label: "Midtones Y/B",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "highlightsCyanRed",
        label: "Highlights C/R",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "highlightsMagentaGreen",
        label: "Highlights M/G",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "highlightsYellowBlue",
        label: "Highlights Y/B",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
    ],
  },
  {
    type: "curves",
    name: "Curves",
    category: "color",
    params: [
      {
        key: "blackPoint",
        label: "Black Point",
        type: "number",
        min: 0,
        max: 255,
        step: 1,
        default: 0,
      },
      {
        key: "whitePoint",
        label: "White Point",
        type: "number",
        min: 0,
        max: 255,
        step: 1,
        default: 255,
      },
      {
        key: "gamma",
        label: "Gamma",
        type: "number",
        min: 0.1,
        max: 3,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "motion-blur",
    name: "Motion Blur",
    category: "blur",
    params: [
      {
        key: "angle",
        label: "Angle",
        type: "number",
        min: 0,
        max: 360,
        step: 1,
        unit: "°",
        default: 0,
      },
      {
        key: "distance",
        label: "Distance",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "px",
        default: 20,
      },
    ],
  },
  {
    type: "radial-blur",
    name: "Radial Blur",
    category: "blur",
    params: [
      {
        key: "amount",
        label: "Amount",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        default: 20,
      },
      {
        key: "centerX",
        label: "Center X",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        default: 50,
      },
      {
        key: "centerY",
        label: "Center Y",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        default: 50,
      },
    ],
  },
  {
    type: "vignette",
    name: "Vignette",
    category: "stylize",
    params: [
      {
        key: "amount",
        label: "Amount",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        default: 50,
      },
      {
        key: "size",
        label: "Size",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        default: 50,
      },
      {
        key: "roundness",
        label: "Roundness",
        type: "number",
        min: -100,
        max: 100,
        step: 1,
        default: 0,
      },
      {
        key: "feather",
        label: "Feather",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        default: 50,
      },
    ],
  },
  {
    type: "film-grain",
    name: "Film Grain",
    category: "stylize",
    params: [
      {
        key: "amount",
        label: "Amount",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        default: 20,
      },
      {
        key: "size",
        label: "Size",
        type: "number",
        min: 0.5,
        max: 3,
        step: 0.1,
        default: 1,
      },
      {
        key: "roughness",
        label: "Roughness",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        default: 50,
      },
    ],
  },
  {
    type: "chromatic-aberration",
    name: "Chromatic Aberration",
    category: "stylize",
    params: [
      {
        key: "amount",
        label: "Amount",
        type: "number",
        min: 0,
        max: 50,
        step: 0.5,
        unit: "px",
        default: 5,
      },
      {
        key: "angle",
        label: "Angle",
        type: "number",
        min: 0,
        max: 360,
        step: 1,
        unit: "°",
        default: 0,
      },
    ],
  },
];

export function getEffectDefinition(
  type: LayerEffectType,
): EffectDefinition | undefined {
  return EFFECT_DEFINITIONS.find((def) => def.type === type);
}

export function getEffectsByCategory(
  category: EffectCategory,
): EffectDefinition[] {
  return EFFECT_DEFINITIONS.filter((def) => def.category === category);
}

export function createDefaultEffect(
  type: LayerEffectType,
  id: string,
): LayerEffect | null {
  const definition = getEffectDefinition(type);
  if (!definition) return null;

  const params: Record<string, number> = {};
  for (const param of definition.params) {
    if (typeof param.default === "number") {
      params[param.key] = param.default;
    }
  }

  return {
    id,
    type,
    name: definition.name,
    enabled: true,
    params,
  };
}

export type VideoFilterType =
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "blur"
  | "sharpen"
  | "vignette"
  | "grain"
  | "colorWheels"
  | "curves"
  | "lut"
  | "hsl"
  | "chromaKey"
  | "mask";
export type AudioEffectType =
  | "gain"
  | "pan"
  | "eq"
  | "compressor"
  | "reverb"
  | "delay"
  | "noiseReduction"
  | "fadeIn"
  | "fadeOut";
export type TransitionType =
  | "crossfade"
  | "dipToBlack"
  | "dipToWhite"
  | "wipe"
  | "slide"
  | "zoom"
  | "push";

// Curve point for color grading
export interface CurvePoint {
  x: number; // 0 to 1 (input)
  y: number; // 0 to 1 (output)
}

// EQ band for audio equalizer
export interface EQBand {
  type: "lowshelf" | "highshelf" | "peaking" | "lowpass" | "highpass" | "notch";
  frequency: number; // 20 to 20000 Hz
  gain: number; // -24 to 24 dB
  q: number; // 0.1 to 18
}

// Complete video filter parameter definitions
export interface VideoFilterParams {
  brightness: {
    value: number; // -1 to 1, default 0
  };
  contrast: {
    value: number; // 0 to 2, default 1
  };
  saturation: {
    value: number; // 0 to 2, default 1
  };
  hue: {
    rotation: number; // -180 to 180 degrees
  };
  blur: {
    radius: number; // 0 to 100 pixels
    type: "gaussian" | "box" | "motion";
    angle?: number; // For motion blur, 0-360
  };
  sharpen: {
    amount: number; // 0 to 2
    radius: number; // 0.1 to 5
    threshold: number; // 0 to 255
  };
  vignette: {
    amount: number; // 0 to 1
    midpoint: number; // 0 to 1
    roundness: number; // 0 to 1
    feather: number; // 0 to 1
  };
  grain: {
    amount: number; // 0 to 1
    size: number; // 0.5 to 3
    roughness: number; // 0 to 1
    colored: boolean;
  };
  colorWheels: {
    shadows: { r: number; g: number; b: number }; // -1 to 1 each
    midtones: { r: number; g: number; b: number };
    highlights: { r: number; g: number; b: number };
    shadowsLift: number; // -1 to 1
    midtonesGamma: number; // 0.1 to 4
    highlightsGain: number; // 0 to 4
  };
  curves: {
    rgb: CurvePoint[]; // Master curve
    red: CurvePoint[];
    green: CurvePoint[];
    blue: CurvePoint[];
  };
  lut: {
    lutData: Uint8Array; // 3D LUT data
    intensity: number; // 0 to 1
  };
  hsl: {
    hue: number[]; // 8 hue ranges, -180 to 180 each
    saturation: number[]; // 8 ranges, -1 to 1 each
    luminance: number[]; // 8 ranges, -1 to 1 each
  };
  chromaKey: {
    keyColor: { r: number; g: number; b: number };
    tolerance: number; // 0 to 1
    edgeSoftness: number; // 0 to 1
    spillSuppression: number; // 0 to 1
  };
  mask: {
    type: "rectangle" | "ellipse" | "polygon" | "bezier";
    points: { x: number; y: number }[];
    feather: number; // 0 to 100 pixels
    inverted: boolean;
    expansion: number; // -100 to 100 pixels
  };
}

// Complete audio effect parameter definitions
export interface AudioEffectParams {
  gain: {
    value: number;
  };
  pan: {
    value: number; // -1 (left) to 1 (right)
  };
  eq: {
    bands: EQBand[];
  };
  compressor: {
    threshold: number; // -60 to 0 dB
    ratio: number; // 1 to 20
    attack: number; // 0.001 to 1 seconds
    release: number; // 0.01 to 3 seconds
    knee: number; // 0 to 40 dB
    makeupGain: number; // 0 to 24 dB
  };
  reverb: {
    roomSize: number; // 0 to 1
    damping: number; // 0 to 1
    wetLevel: number; // 0 to 1
    dryLevel: number; // 0 to 1
    preDelay: number; // 0 to 100 ms
  };
  delay: {
    time: number; // 0 to 2 seconds
    feedback: number; // 0 to 0.95
    wetLevel: number; // 0 to 1
    sync: boolean; // Sync to tempo
  };
  noiseReduction: {
    threshold: number; // -60 to 0 dB
    reduction: number; // 0 to 1
    attack: number; // 0 to 100 ms
    release: number; // 0 to 500 ms
    focus?: "balanced" | "speech" | "heavy" | "wind" | "hum";
    profile?: {
      frequencyBins: number[];
      magnitudes: number[];
      sampleRate: number;
    };
  };
  fadeIn: {
    duration: number; // In seconds
    curve: "linear" | "exponential" | "logarithmic" | "s-curve";
  };
  fadeOut: {
    duration: number;
    curve: "linear" | "exponential" | "logarithmic" | "s-curve";
  };
}

// Complete transition parameter definitions
export interface TransitionParams {
  crossfade: {
    duration: number; // In seconds
    curve: "linear" | "ease" | "ease-in" | "ease-out";
  };
  dipToBlack: {
    duration: number;
    holdDuration: number; // Time at full black
  };
  dipToWhite: {
    duration: number;
    holdDuration: number;
  };
  wipe: {
    duration: number;
    direction: "left" | "right" | "up" | "down" | "diagonal";
    softness: number; // 0 to 1
  };
  slide: {
    duration: number;
    direction: "left" | "right" | "up" | "down";
    pushOut: boolean; // Whether outgoing clip slides too
  };
  zoom: {
    duration: number;
    scale: number; // Final scale factor
    center: { x: number; y: number }; // 0-1 normalized
  };
  push: {
    duration: number;
    direction: "left" | "right" | "up" | "down";
  };
}
