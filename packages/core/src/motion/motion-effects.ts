import type {
  MotionAngleControlEffect,
  MotionBackdropBlurEffect,
  MotionBlurEffect,
  MotionCheckboxControlEffect,
  MotionChromaticAberrationEffect,
  MotionColorAdjustEffect,
  MotionComposition,
  MotionDirectionalBlurEffect,
  MotionDropShadowEffect,
  MotionEffect,
  MotionEffectType,
  MotionGlowEffect,
  MotionGrayscaleEffect,
  MotionInvertEffect,
  MotionLayer,
  MotionDisplaceEffect,
  MotionMosaicEffect,
  MotionLevelsEffect,
  MotionNoiseEffect,
  MotionPosterizeEffect,
  MotionRadialBlurEffect,
  MotionSepiaEffect,
  MotionShaderEffect,
  MotionSharpenEffect,
  MotionSliderControlEffect,
  MotionThresholdEffect,
  MotionVignetteEffect,
} from "./types";
import type { Keyframe } from "../types/timeline";
import { getMotionShaderDef } from "./shaders";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";
import {
  applyMotionDirectionalBlur,
  applyMotionChromaticAberration,
  applyMotionDisplace,
  applyMotionLevels,
  applyMotionNoise,
  applyMotionMosaic,
  applyMotionPosterize,
  applyMotionRadialBlur,
  applyMotionSharpen,
  applyMotionThreshold,
  applyMotionVignette,
  type MotionPixelBuffer,
} from "./motion-pixel-effects";

export interface MotionEffectPreset {
  readonly type: MotionEffectType;
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionEffect;
}

export type MotionEffectNumericParameter =
  | "radius"
  | "opacity"
  | "blur"
  | "offsetX"
  | "offsetY"
  | "intensity"
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "amount"
  | "inputBlack"
  | "inputWhite"
  | "gamma"
  | "outputBlack"
  | "outputWhite"
  | "levels"
  | "angle"
  | "distance"
  | "seed"
  | "centerX"
  | "centerY"
  | "scale"
  | "level"
  | "blockSize"
  | "softness"
  | "value";

export type MotionEffectParameterName =
  | MotionEffectNumericParameter
  | (string & { readonly __shaderParam?: never });

export interface MotionEffectParameterDescriptor {
  readonly param: MotionEffectParameterName;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

const createEffectId = (): string =>
  `motion-fx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const EFFECT_PARAMETER_DESCRIPTORS: Record<
  MotionEffectType,
  readonly MotionEffectParameterDescriptor[]
> = {
  blur: [
    { param: "radius", label: "Radius", min: 0, max: 200, step: 1, unit: "px" },
  ],
  "drop-shadow": [
    { param: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01 },
    { param: "blur", label: "Blur", min: 0, max: 200, step: 1, unit: "px" },
    { param: "offsetX", label: "Offset X", min: -1000, max: 1000, step: 1, unit: "px" },
    { param: "offsetY", label: "Offset Y", min: -1000, max: 1000, step: 1, unit: "px" },
  ],
  glow: [
    { param: "intensity", label: "Intensity", min: 0, max: 1, step: 0.01 },
    { param: "radius", label: "Radius", min: 0, max: 240, step: 1, unit: "px" },
  ],
  "color-adjust": [
    { param: "brightness", label: "Brightness", min: 0, max: 4, step: 0.01 },
    { param: "contrast", label: "Contrast", min: 0, max: 4, step: 0.01 },
    { param: "saturation", label: "Saturation", min: 0, max: 4, step: 0.01 },
    { param: "hue", label: "Hue", min: -360, max: 360, step: 1, unit: "deg" },
  ],
  invert: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 }],
  grayscale: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 }],
  sepia: [{ param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 }],
  levels: [
    { param: "inputBlack", label: "Input Black", min: 0, max: 255, step: 1 },
    { param: "inputWhite", label: "Input White", min: 0, max: 255, step: 1 },
    { param: "gamma", label: "Gamma", min: 0.1, max: 4, step: 0.01 },
    { param: "outputBlack", label: "Output Black", min: 0, max: 255, step: 1 },
    { param: "outputWhite", label: "Output White", min: 0, max: 255, step: 1 },
  ],
  sharpen: [{ param: "amount", label: "Amount", min: 0, max: 4, step: 0.05 }],
  posterize: [{ param: "levels", label: "Levels", min: 2, max: 64, step: 1 }],
  "directional-blur": [
    { param: "angle", label: "Angle", min: -180, max: 180, step: 1, unit: "deg" },
    { param: "distance", label: "Distance", min: 0, max: 100, step: 1, unit: "px" },
  ],
  noise: [
    { param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 },
    { param: "seed", label: "Seed", min: 1, max: 9999, step: 1 },
  ],
  "radial-blur": [
    { param: "centerX", label: "Center X", min: 0, max: 1, step: 0.01 },
    { param: "centerY", label: "Center Y", min: 0, max: 1, step: 0.01 },
    { param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 },
  ],
  displace: [
    { param: "amount", label: "Amount", min: 0, max: 100, step: 1, unit: "px" },
    { param: "scale", label: "Scale", min: 1, max: 200, step: 1 },
    { param: "seed", label: "Seed", min: 1, max: 9999, step: 1 },
  ],
  threshold: [
    { param: "level", label: "Threshold", min: 0, max: 255, step: 1 },
  ],
  mosaic: [
    { param: "blockSize", label: "Block Size", min: 1, max: 200, step: 1, unit: "px" },
  ],
  "chromatic-aberration": [
    { param: "amount", label: "Separation", min: 0, max: 100, step: 0.5, unit: "px" },
    { param: "angle", label: "Angle", min: -180, max: 180, step: 1, unit: "deg" },
  ],
  vignette: [
    { param: "amount", label: "Amount", min: 0, max: 1, step: 0.01 },
    { param: "softness", label: "Softness", min: 0.01, max: 1, step: 0.01 },
  ],
  "backdrop-blur": [
    { param: "radius", label: "Radius", min: 0, max: 100, step: 1, unit: "px" },
  ],
  shader: [],
  "slider-control": [
    {
      param: "value",
      label: "Slider",
      min: Number.NEGATIVE_INFINITY,
      max: Number.POSITIVE_INFINITY,
      step: 0.01,
    },
  ],
  "checkbox-control": [
    { param: "value", label: "Checkbox", min: 0, max: 1, step: 1 },
  ],
  "angle-control": [
    {
      param: "value",
      label: "Angle",
      min: Number.NEGATIVE_INFINITY,
      max: Number.POSITIVE_INFINITY,
      step: 1,
      unit: "deg",
    },
  ],
};

export const MOTION_EFFECT_PRESETS: readonly MotionEffectPreset[] = [
  {
    type: "blur",
    name: "Gaussian Blur",
    description: "Softens a layer with an animatable blur radius.",
    create: (id = createEffectId()): MotionBlurEffect => ({
      id,
      type: "blur",
      name: "Gaussian Blur",
      enabled: true,
      radius: 8,
    }),
  },
  {
    type: "drop-shadow",
    name: "Drop Shadow",
    description: "Adds depth with offset, blur, opacity, and color controls.",
    create: (id = createEffectId()): MotionDropShadowEffect => ({
      id,
      type: "drop-shadow",
      name: "Drop Shadow",
      enabled: true,
      color: "#000000",
      opacity: 0.32,
      blur: 24,
      offsetX: 0,
      offsetY: 18,
    }),
  },
  {
    type: "glow",
    name: "Outer Glow",
    description: "Creates a luminous edge for logo reveals and highlights.",
    create: (id = createEffectId()): MotionGlowEffect => ({
      id,
      type: "glow",
      name: "Outer Glow",
      enabled: true,
      color: "#14b8a6",
      intensity: 0.55,
      radius: 28,
    }),
  },
  {
    type: "color-adjust",
    name: "Color Adjust",
    description: "Adjusts brightness, contrast, saturation, and hue.",
    create: (id = createEffectId()): MotionColorAdjustEffect => ({
      id,
      type: "color-adjust",
      name: "Color Adjust",
      enabled: true,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      hue: 0,
    }),
  },
  {
    type: "invert",
    name: "Invert",
    description: "Inverts the layer colors with an animatable amount.",
    create: (id = createEffectId()): MotionInvertEffect => ({
      id,
      type: "invert",
      name: "Invert",
      enabled: true,
      amount: 1,
    }),
  },
  {
    type: "grayscale",
    name: "Black & White",
    description: "Desaturates the layer toward grayscale.",
    create: (id = createEffectId()): MotionGrayscaleEffect => ({
      id,
      type: "grayscale",
      name: "Black & White",
      enabled: true,
      amount: 1,
    }),
  },
  {
    type: "sepia",
    name: "Sepia",
    description: "Applies a warm vintage sepia tone.",
    create: (id = createEffectId()): MotionSepiaEffect => ({
      id,
      type: "sepia",
      name: "Sepia",
      enabled: true,
      amount: 1,
    }),
  },
  {
    type: "levels",
    name: "Levels",
    description: "Remaps tonal range with input/output black, white, and gamma.",
    create: (id = createEffectId()): MotionLevelsEffect => ({
      id,
      type: "levels",
      name: "Levels",
      enabled: true,
      inputBlack: 0,
      inputWhite: 255,
      gamma: 1,
      outputBlack: 0,
      outputWhite: 255,
    }),
  },
  {
    type: "sharpen",
    name: "Sharpen",
    description: "Enhances edge contrast with an unsharp convolution.",
    create: (id = createEffectId()): MotionSharpenEffect => ({
      id,
      type: "sharpen",
      name: "Sharpen",
      enabled: true,
      amount: 0.6,
    }),
  },
  {
    type: "posterize",
    name: "Posterize",
    description: "Quantizes colors into a limited number of tonal levels.",
    create: (id = createEffectId()): MotionPosterizeEffect => ({
      id,
      type: "posterize",
      name: "Posterize",
      enabled: true,
      levels: 6,
    }),
  },
  {
    type: "directional-blur",
    name: "Directional Blur",
    description: "Streaks the layer along an angle for motion-blur looks.",
    create: (id = createEffectId()): MotionDirectionalBlurEffect => ({
      id,
      type: "directional-blur",
      name: "Directional Blur",
      enabled: true,
      angle: 0,
      distance: 12,
    }),
  },
  {
    type: "noise",
    name: "Noise",
    description: "Adds animatable film-grain noise.",
    create: (id = createEffectId()): MotionNoiseEffect => ({
      id,
      type: "noise",
      name: "Noise",
      enabled: true,
      amount: 0.15,
      seed: 1,
    }),
  },
  {
    type: "radial-blur",
    name: "Radial Blur",
    description: "Zoom-blurs the layer outward from a center point.",
    create: (id = createEffectId()): MotionRadialBlurEffect => ({
      id,
      type: "radial-blur",
      name: "Radial Blur",
      enabled: true,
      centerX: 0.5,
      centerY: 0.5,
      amount: 0.4,
    }),
  },
  {
    type: "displace",
    name: "Turbulent Displace",
    description: "Warps the layer with seeded turbulent noise displacement.",
    create: (id = createEffectId()): MotionDisplaceEffect => ({
      id,
      type: "displace",
      name: "Turbulent Displace",
      enabled: true,
      amount: 12,
      scale: 40,
      seed: 1,
    }),
  },
  {
    type: "backdrop-blur",
    name: "Backdrop Blur",
    description: "Frosts the content behind the layer for glass panels.",
    create: (id = createEffectId()): MotionBackdropBlurEffect => ({
      id,
      type: "backdrop-blur",
      name: "Backdrop Blur",
      enabled: true,
      radius: 16,
    }),
  },
  {
    type: "threshold",
    name: "Threshold",
    description: "Converts luminance into a sharp, graphic black-and-white image.",
    create: (id = createEffectId()): MotionThresholdEffect => ({
      id, type: "threshold", name: "Threshold", enabled: true, level: 128,
    }),
  },
  {
    type: "mosaic",
    name: "Mosaic",
    description: "Pixelates the layer into adjustable square color blocks.",
    create: (id = createEffectId()): MotionMosaicEffect => ({
      id, type: "mosaic", name: "Mosaic", enabled: true, blockSize: 16,
    }),
  },
  {
    type: "chromatic-aberration",
    name: "Chromatic Aberration",
    description: "Separates red and blue channels for lens and glitch treatments.",
    create: (id = createEffectId()): MotionChromaticAberrationEffect => ({
      id, type: "chromatic-aberration", name: "Chromatic Aberration", enabled: true,
      amount: 6, angle: 0,
    }),
  },
  {
    type: "vignette",
    name: "Vignette",
    description: "Darkens frame edges with an adjustable feathered falloff.",
    create: (id = createEffectId()): MotionVignetteEffect => ({
      id, type: "vignette", name: "Vignette", enabled: true, amount: 0.65, softness: 0.55,
    }),
  },
  {
    type: "slider-control",
    name: "Slider Control",
    description: "Expression control exposing a numeric slider value.",
    create: (id = createEffectId()): MotionSliderControlEffect => ({
      id,
      type: "slider-control",
      name: "Slider Control",
      enabled: true,
      value: 0,
    }),
  },
  {
    type: "checkbox-control",
    name: "Checkbox Control",
    description: "Expression control exposing a 0/1 checkbox value.",
    create: (id = createEffectId()): MotionCheckboxControlEffect => ({
      id,
      type: "checkbox-control",
      name: "Checkbox Control",
      enabled: true,
      value: 0,
    }),
  },
  {
    type: "angle-control",
    name: "Angle Control",
    description: "Expression control exposing an angle value in degrees.",
    create: (id = createEffectId()): MotionAngleControlEffect => ({
      id,
      type: "angle-control",
      name: "Angle Control",
      enabled: true,
      value: 0,
    }),
  },
];

export function createMotionEffect(
  type: MotionEffectType,
  id?: string,
): MotionEffect {
  const preset = MOTION_EFFECT_PRESETS.find((item) => item.type === type);
  if (!preset) {
    throw new Error(`Unsupported motion effect type: ${type}`);
  }
  return preset.create(id);
}

export function createMotionShaderEffect(
  shaderId: string,
  id?: string,
): MotionShaderEffect {
  const def = getMotionShaderDef(shaderId);
  if (!def) {
    throw new Error(`Unsupported motion shader effect: ${shaderId}`);
  }
  return {
    id: id ?? createEffectId(),
    type: "shader",
    name: def.name,
    enabled: true,
    shaderId: def.id,
    params: Object.fromEntries(def.params.map((param) => [param.name, param.default])),
  };
}

export function addMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effect: MotionEffect,
): T {
  return {
    ...layer,
    effects: [...(layer.effects ?? []), effect],
  } as T;
}

export function updateMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effectId: string,
  updater: (effect: MotionEffect) => MotionEffect,
): T {
  return {
    ...layer,
    effects: (layer.effects ?? []).map((effect) =>
      effect.id === effectId ? updater(effect) : effect,
    ),
  } as T;
}

export function removeMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effectId: string,
): T {
  return {
    ...layer,
    effects: (layer.effects ?? []).filter((effect) => effect.id !== effectId),
  } as T;
}

export type MotionEffectStackPasteMode = "append" | "replace";

export interface MotionEffectStackTransferResult<T extends MotionLayer> {
  readonly layer: T;
  readonly pastedEffectIds: readonly string[];
}

/**
 * Copies an ordered effect stack plus its animated parameters to another layer.
 * Effect identities are regenerated and keyframe/expression property paths are
 * remapped so pasted stacks never alias the source layer.
 */
export function transferMotionEffectStack<T extends MotionLayer>(
  source: Pick<MotionLayer, "effects" | "keyframes" | "expressions">,
  target: T,
  mode: MotionEffectStackPasteMode = "append",
  createId: (kind: "effect" | "keyframe" | "expression", sourceId: string) => string =
    (kind) => `motion-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
): MotionEffectStackTransferResult<T> {
  const sourceEffects = source.effects ?? [];
  if (sourceEffects.length === 0) return { layer: target, pastedEffectIds: [] };
  const sourceEffectIds = new Set(sourceEffects.map((effect) => effect.id));
  const idMap = new Map(
    sourceEffects.map((effect) => [effect.id, createId("effect", effect.id)]),
  );
  const clonedEffects = sourceEffects.map((effect) => ({
    ...effect,
    id: idMap.get(effect.id)!,
    ...(effect.type === "shader" ? { params: { ...effect.params } } : {}),
  })) as MotionEffect[];

  const isEffectPropertyFor = (property: string, ids: ReadonlySet<string>): boolean => {
    const parsed = parseMotionEffectKeyframeProperty(property);
    return parsed ? ids.has(parsed.effectId) : false;
  };
  const remapProperty = (property: string): string => {
    const parsed = parseMotionEffectKeyframeProperty(property);
    if (!parsed) return property;
    const nextId = idMap.get(parsed.effectId);
    return nextId ? getMotionEffectKeyframeProperty(nextId, parsed.param) : property;
  };

  const retainedKeyframes = mode === "replace"
    ? target.keyframes.filter((keyframe) =>
        !isEffectPropertyFor(
          keyframe.property,
          new Set((target.effects ?? []).map((effect) => effect.id)),
        ),
      )
    : target.keyframes;
  const clonedKeyframes = source.keyframes
    .filter((keyframe) => isEffectPropertyFor(keyframe.property, sourceEffectIds))
    .map((keyframe) => ({
      ...keyframe,
      id: createId("keyframe", keyframe.id),
      property: remapProperty(keyframe.property),
      time: Math.max(0, Math.min(target.duration, keyframe.time)),
    }));

  const targetEffectIds = new Set((target.effects ?? []).map((effect) => effect.id));
  const retainedExpressions = mode === "replace"
    ? (target.expressions ?? []).filter((expression) =>
        !isEffectPropertyFor(expression.property, targetEffectIds),
      )
    : (target.expressions ?? []);
  const clonedExpressions = (source.expressions ?? [])
    .filter((expression) => isEffectPropertyFor(expression.property, sourceEffectIds))
    .map((expression) => ({
      ...expression,
      id: createId("expression", expression.id),
      property: remapProperty(expression.property),
    }));

  return {
    layer: {
      ...target,
      effects: mode === "replace"
        ? clonedEffects
        : [...(target.effects ?? []), ...clonedEffects],
      keyframes: [...retainedKeyframes, ...clonedKeyframes],
      expressions: [...retainedExpressions, ...clonedExpressions],
    } as T,
    pastedEffectIds: clonedEffects.map((effect) => effect.id),
  };
}

/** Duplicates one effect beside its source, including parameter animation. */
export function duplicateMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effectId: string,
  createId: (kind: "effect" | "keyframe" | "expression", sourceId: string) => string =
    (kind) => `motion-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
): MotionEffectStackTransferResult<T> {
  const effect = (layer.effects ?? []).find((candidate) => candidate.id === effectId);
  if (!effect) return { layer, pastedEffectIds: [] };

  const duplicated = transferMotionEffectStack(
    {
      effects: [effect],
      keyframes: layer.keyframes,
      expressions: layer.expressions,
    },
    layer,
    "append",
    createId,
  );
  const duplicateId = duplicated.pastedEffectIds[0];
  if (!duplicateId) return duplicated;

  const effects = [...(duplicated.layer.effects ?? [])];
  const duplicateIndex = effects.findIndex((candidate) => candidate.id === duplicateId);
  const sourceIndex = effects.findIndex((candidate) => candidate.id === effectId);
  if (duplicateIndex >= 0 && sourceIndex >= 0) {
    if (
      effect.type === "slider-control" ||
      effect.type === "checkbox-control" ||
      effect.type === "angle-control"
    ) {
      effects[duplicateIndex] = {
        ...effects[duplicateIndex],
        name: nextMotionControlName(layer.effects ?? [], effect.name),
      } as MotionEffect;
    }
    const [copy] = effects.splice(duplicateIndex, 1);
    effects.splice(sourceIndex + 1, 0, copy);
  }

  return {
    ...duplicated,
    layer: { ...duplicated.layer, effects } as T,
  };
}

export function clearMotionEffectStack<T extends MotionLayer>(layer: T): T {
  const effectIds = new Set((layer.effects ?? []).map((effect) => effect.id));
  if (effectIds.size === 0) return layer;
  const belongsToStack = (property: string): boolean => {
    const parsed = parseMotionEffectKeyframeProperty(property);
    return parsed ? effectIds.has(parsed.effectId) : false;
  };
  return {
    ...layer,
    effects: [],
    keyframes: layer.keyframes.filter((keyframe) => !belongsToStack(keyframe.property)),
    expressions: (layer.expressions ?? []).filter(
      (expression) => !belongsToStack(expression.property),
    ),
  } as T;
}

export function toggleMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effectId: string,
  enabled: boolean,
): T {
  return updateMotionLayerEffect(layer, effectId, (effect) => ({
    ...effect,
    enabled,
  }));
}

export function reorderMotionLayerEffect<T extends MotionLayer>(
  layer: T,
  effectId: string,
  direction: -1 | 1,
): T {
  const effects = [...(layer.effects ?? [])];
  const index = effects.findIndex((effect) => effect.id === effectId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= effects.length) {
    return layer;
  }
  const [effect] = effects.splice(index, 1);
  effects.splice(nextIndex, 0, effect);
  return { ...layer, effects } as T;
}

export function getEnabledMotionEffects(
  layer: MotionLayer,
): MotionEffect[] {
  return (layer.effects ?? []).filter((effect) => effect.enabled);
}

const MOTION_EXPRESSION_CONTROL_EFFECT_TYPES: ReadonlySet<MotionEffectType> =
  new Set(["slider-control", "checkbox-control", "angle-control"]);

export function isMotionExpressionControlEffect(
  effect: Pick<MotionEffect, "type">,
): boolean {
  return MOTION_EXPRESSION_CONTROL_EFFECT_TYPES.has(effect.type);
}

export function nextMotionControlName(
  effects: readonly Pick<MotionEffect, "name">[],
  baseName: string,
): string {
  const taken = new Set(effects.map((effect) => effect.name));
  if (!taken.has(baseName)) return baseName;
  let index = 2;
  while (taken.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

const MOTION_PIXEL_EFFECT_TYPES: ReadonlySet<MotionEffectType> = new Set([
  "levels",
  "sharpen",
  "posterize",
  "directional-blur",
  "noise",
  "radial-blur",
  "displace",
  "threshold",
  "mosaic",
  "chromatic-aberration",
  "vignette",
]);

export function isMotionPixelEffect(type: MotionEffectType): boolean {
  return MOTION_PIXEL_EFFECT_TYPES.has(type);
}

export function layerHasMotionPixelEffects(layer: MotionLayer): boolean {
  return (layer.effects ?? []).some(
    (effect) => effect.enabled && isMotionPixelEffect(effect.type),
  );
}

export function layerHasMotionShaderEffects(layer: MotionLayer): boolean {
  return (layer.effects ?? []).some(
    (effect) => effect.enabled && effect.type === "shader",
  );
}

export function layerHasMotionShaderFill(layer: MotionLayer): boolean {
  if (layer.type === "shape") {
    return layer.style.fill.type === "shader";
  }
  if (layer.type === "text") {
    return Boolean(layer.style.fillShader);
  }
  return false;
}

export function layerNeedsBufferedEffects(layer: MotionLayer): boolean {
  return layerHasMotionPixelEffects(layer) || layerHasMotionShaderEffects(layer);
}

export function getMotionBackdropBlurRadius(
  effects: readonly MotionEffect[] | undefined,
): number {
  let radius = 0;
  for (const effect of effects ?? []) {
    if (effect.enabled && effect.type === "backdrop-blur") {
      radius = Math.max(radius, Math.max(0, effect.radius));
    }
  }
  return radius;
}

export function layerHasMotionBackdropBlur(layer: MotionLayer): boolean {
  return getMotionBackdropBlurRadius(layer.effects) > 0;
}

export function applyMotionPixelEffectsToBuffer(
  buffer: MotionPixelBuffer,
  layer: MotionLayer,
  localTime: number,
  composition?: MotionComposition,
): void {
  for (const effect of getEnabledMotionEffects(layer)) {
    if (!isMotionPixelEffect(effect.type)) continue;
    const value = (param: MotionEffectNumericParameter): number =>
      getMotionEffectParameterValueAtTime(
        effect,
        layer.keyframes,
        param,
        localTime,
        layer.expressions,
        layer.duration,
        composition,
        layer,
      );
    switch (effect.type) {
      case "levels":
        applyMotionLevels(buffer, {
          inputBlack: value("inputBlack"),
          inputWhite: value("inputWhite"),
          gamma: value("gamma"),
          outputBlack: value("outputBlack"),
          outputWhite: value("outputWhite"),
        });
        break;
      case "sharpen":
        applyMotionSharpen(buffer, value("amount"));
        break;
      case "posterize":
        applyMotionPosterize(buffer, value("levels"));
        break;
      case "directional-blur":
        applyMotionDirectionalBlur(buffer, value("angle"), value("distance"));
        break;
      case "noise":
        applyMotionNoise(buffer, value("amount"), value("seed"));
        break;
      case "radial-blur":
        applyMotionRadialBlur(
          buffer,
          value("centerX"),
          value("centerY"),
          value("amount"),
        );
        break;
      case "displace":
        applyMotionDisplace(buffer, value("amount"), value("scale"), value("seed"));
        break;
      case "threshold":
        applyMotionThreshold(buffer, value("level"));
        break;
      case "mosaic":
        applyMotionMosaic(buffer, value("blockSize"));
        break;
      case "chromatic-aberration":
        applyMotionChromaticAberration(buffer, value("amount"), value("angle"));
        break;
      case "vignette":
        applyMotionVignette(buffer, value("amount"), value("softness"));
        break;
      default:
        break;
    }
  }
}

export function getMotionShaderParameterDescriptors(
  shaderId: string,
): readonly MotionEffectParameterDescriptor[] {
  const def = getMotionShaderDef(shaderId);
  if (!def) return [];
  return def.params.map((param) => ({
    param: param.name,
    label: param.label,
    min: param.min,
    max: param.max,
    step: param.step,
  }));
}

export function getMotionEffectParameterDescriptors(
  effect: MotionEffect,
): readonly MotionEffectParameterDescriptor[] {
  if (effect.type === "shader") {
    return getMotionShaderParameterDescriptors(effect.shaderId);
  }
  return EFFECT_PARAMETER_DESCRIPTORS[effect.type];
}

export function getMotionEffectParameterDescriptor(
  effect: MotionEffect,
  param: MotionEffectParameterName,
): MotionEffectParameterDescriptor | undefined {
  return getMotionEffectParameterDescriptors(effect).find(
    (descriptor) => descriptor.param === param,
  );
}

export function getMotionEffectKeyframeProperty(
  effectId: string,
  param: MotionEffectParameterName,
): `effect.${string}.${string}` {
  return `effect.${effectId}.${param}`;
}

export function parseMotionEffectKeyframeProperty(
  property: string,
):
  | { readonly effectId: string; readonly param: MotionEffectParameterName }
  | null {
  const match = /^effect\.([^.]+)\.([a-zA-Z0-9]+)$/.exec(property);
  if (!match) return null;
  const param: MotionEffectParameterName = match[2];
  if (param.length === 0) return null;
  return { effectId: match[1], param };
}

export function getMotionEffectParameterValue(
  effect: MotionEffect,
  param: MotionEffectParameterName,
): number {
  switch (effect.type) {
    case "shader": {
      const stored = effect.params[param];
      return typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
    }
    case "blur":
    case "backdrop-blur":
      return param === "radius" ? effect.radius : 0;
    case "drop-shadow":
      if (param === "opacity") return effect.opacity;
      if (param === "blur") return effect.blur;
      if (param === "offsetX") return effect.offsetX;
      if (param === "offsetY") return effect.offsetY;
      return 0;
    case "glow":
      if (param === "intensity") return effect.intensity;
      if (param === "radius") return effect.radius;
      return 0;
    case "color-adjust":
      if (param === "brightness") return effect.brightness;
      if (param === "contrast") return effect.contrast;
      if (param === "saturation") return effect.saturation;
      if (param === "hue") return effect.hue;
      return 0;
    case "invert":
    case "grayscale":
    case "sepia":
      return param === "amount" ? effect.amount : 0;
    case "levels":
      if (param === "inputBlack") return effect.inputBlack;
      if (param === "inputWhite") return effect.inputWhite;
      if (param === "gamma") return effect.gamma;
      if (param === "outputBlack") return effect.outputBlack;
      if (param === "outputWhite") return effect.outputWhite;
      return 0;
    case "sharpen":
      return param === "amount" ? effect.amount : 0;
    case "posterize":
      return param === "levels" ? effect.levels : 0;
    case "directional-blur":
      if (param === "angle") return effect.angle;
      if (param === "distance") return effect.distance;
      return 0;
    case "noise":
      if (param === "amount") return effect.amount;
      if (param === "seed") return effect.seed;
      return 0;
    case "radial-blur":
      if (param === "centerX") return effect.centerX;
      if (param === "centerY") return effect.centerY;
      if (param === "amount") return effect.amount;
      return 0;
    case "displace":
      if (param === "amount") return effect.amount;
      if (param === "scale") return effect.scale;
      if (param === "seed") return effect.seed;
      return 0;
    case "threshold":
      return param === "level" ? effect.level : 0;
    case "mosaic":
      return param === "blockSize" ? effect.blockSize : 0;
    case "chromatic-aberration":
      if (param === "amount") return effect.amount;
      if (param === "angle") return effect.angle;
      return 0;
    case "vignette":
      if (param === "amount") return effect.amount;
      if (param === "softness") return effect.softness;
      return 0;
    case "slider-control":
    case "checkbox-control":
    case "angle-control":
      return param === "value" ? effect.value : 0;
  }
}

export function getMotionEffectParameterValueAtTime(
  effect: MotionEffect,
  keyframes: readonly Keyframe[],
  param: MotionEffectParameterName,
  localTime: number,
  expressions: MotionLayer["expressions"] = [],
  duration = Number.POSITIVE_INFINITY,
  composition?: MotionComposition,
  layer?: MotionLayer,
): number {
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const context =
    composition && layer ? { composition, layer } : undefined;
  return evaluateMotionPropertyValueAtTime({
    keyframes,
    expressions,
    property,
    localTime,
    fallback: getMotionEffectParameterValue(effect, param),
    duration,
    context,
  });
}

export function setMotionEffectParameterValue<T extends MotionEffect>(
  effect: T,
  param: MotionEffectParameterName,
  value: number,
): T {
  if (effect.type === "shader") {
    return {
      ...effect,
      params: {
        ...effect.params,
        [param]: clampShaderParam(effect, param, value),
      },
    };
  }

  if (
    effect.type === "slider-control" ||
    effect.type === "angle-control"
  ) {
    return (param === "value"
      ? { ...effect, value: Number.isFinite(value) ? value : 0 }
      : effect) as T;
  }
  if (effect.type === "checkbox-control") {
    return (param === "value"
      ? { ...effect, value: value >= 0.5 ? 1 : 0 }
      : effect) as T;
  }

  const descriptor = getMotionEffectParameterDescriptor(effect, param);
  const nextValue = descriptor
    ? clamp(value, descriptor.min, descriptor.max)
    : Number.isFinite(value)
      ? value
      : 0;

  switch (effect.type) {
    case "blur":
    case "backdrop-blur":
      return (param === "radius"
        ? { ...effect, radius: nextValue }
        : effect) as T;
    case "drop-shadow":
      if (param === "opacity") return { ...effect, opacity: nextValue } as T;
      if (param === "blur") return { ...effect, blur: nextValue } as T;
      if (param === "offsetX") return { ...effect, offsetX: nextValue } as T;
      if (param === "offsetY") return { ...effect, offsetY: nextValue } as T;
      return effect;
    case "glow":
      if (param === "intensity") return { ...effect, intensity: nextValue } as T;
      if (param === "radius") return { ...effect, radius: nextValue } as T;
      return effect;
    case "color-adjust":
      if (param === "brightness") return { ...effect, brightness: nextValue } as T;
      if (param === "contrast") return { ...effect, contrast: nextValue } as T;
      if (param === "saturation") return { ...effect, saturation: nextValue } as T;
      if (param === "hue") return { ...effect, hue: nextValue } as T;
      return effect;
    case "invert":
    case "grayscale":
    case "sepia":
      return (param === "amount"
        ? { ...effect, amount: nextValue }
        : effect) as T;
    case "levels":
      if (param === "inputBlack") return { ...effect, inputBlack: nextValue } as T;
      if (param === "inputWhite") return { ...effect, inputWhite: nextValue } as T;
      if (param === "gamma") return { ...effect, gamma: nextValue } as T;
      if (param === "outputBlack") return { ...effect, outputBlack: nextValue } as T;
      if (param === "outputWhite") return { ...effect, outputWhite: nextValue } as T;
      return effect;
    case "sharpen":
      return (param === "amount"
        ? { ...effect, amount: nextValue }
        : effect) as T;
    case "posterize":
      return (param === "levels"
        ? { ...effect, levels: nextValue }
        : effect) as T;
    case "directional-blur":
      if (param === "angle") return { ...effect, angle: nextValue } as T;
      if (param === "distance") return { ...effect, distance: nextValue } as T;
      return effect;
    case "noise":
      if (param === "amount") return { ...effect, amount: nextValue } as T;
      if (param === "seed") return { ...effect, seed: nextValue } as T;
      return effect;
    case "radial-blur":
      if (param === "centerX") return { ...effect, centerX: nextValue } as T;
      if (param === "centerY") return { ...effect, centerY: nextValue } as T;
      if (param === "amount") return { ...effect, amount: nextValue } as T;
      return effect;
    case "displace":
      if (param === "amount") return { ...effect, amount: nextValue } as T;
      if (param === "scale") return { ...effect, scale: nextValue } as T;
      if (param === "seed") return { ...effect, seed: nextValue } as T;
      return effect;
    case "threshold":
      return (param === "level" ? { ...effect, level: nextValue } : effect) as T;
    case "mosaic":
      return (param === "blockSize" ? { ...effect, blockSize: nextValue } : effect) as T;
    case "chromatic-aberration":
      if (param === "amount") return { ...effect, amount: nextValue } as T;
      if (param === "angle") return { ...effect, angle: nextValue } as T;
      return effect;
    case "vignette":
      if (param === "amount") return { ...effect, amount: nextValue } as T;
      if (param === "softness") return { ...effect, softness: nextValue } as T;
      return effect;
  }
}

export function evaluateMotionEffectAtTime<T extends MotionEffect>(
  effect: T,
  keyframes: readonly Keyframe[],
  localTime: number,
  expressions: MotionLayer["expressions"] = [],
  duration = Number.POSITIVE_INFINITY,
  composition?: MotionComposition,
  layer?: MotionLayer,
): T {
  return getMotionEffectParameterDescriptors(effect).reduce<T>(
    (currentEffect, descriptor) =>
      setMotionEffectParameterValue(
        currentEffect,
        descriptor.param,
        getMotionEffectParameterValueAtTime(
          currentEffect,
          keyframes,
          descriptor.param,
          localTime,
          expressions,
          duration,
          composition,
          layer,
        ),
      ),
    effect,
  );
}

export function evaluateMotionEffectsAtTime(
  effects: readonly MotionEffect[] | undefined,
  keyframes: readonly Keyframe[],
  localTime: number,
  expressions: MotionLayer["expressions"] = [],
  duration = Number.POSITIVE_INFINITY,
  composition?: MotionComposition,
  layer?: MotionLayer,
): MotionEffect[] {
  return (effects ?? [])
    .filter((effect) => !isMotionExpressionControlEffect(effect))
    .map((effect) =>
      evaluateMotionEffectAtTime(
        effect,
        keyframes,
        localTime,
        expressions,
        duration,
        composition,
        layer,
      ),
    );
}

export function buildMotionCssFilter(
  effects: readonly MotionEffect[] | undefined,
): string | undefined {
  const filters = getFilterParts(effects);
  return filters.length > 0 ? filters.join(" ") : undefined;
}

export function buildMotionCanvasFilter(
  effects: readonly MotionEffect[] | undefined,
): string {
  const filters = getFilterParts(effects);
  return filters.length > 0 ? filters.join(" ") : "none";
}

export function buildMotionCssDropShadow(
  effects: readonly MotionEffect[] | undefined,
): string | undefined {
  const shadows = (effects ?? [])
    .filter((effect) => effect.enabled)
    .flatMap((effect) => {
      if (effect.type === "drop-shadow") {
        return [
          `${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${toRgba(
            effect.color,
            effect.opacity,
          )}`,
        ];
      }
      if (effect.type === "glow") {
        return [
          `0 0 ${effect.radius}px ${toRgba(effect.color, effect.intensity)}`,
        ];
      }
      return [];
    });
  return shadows.length > 0 ? shadows.join(", ") : undefined;
}

export function getPrimaryMotionShadow(
  effects: readonly MotionEffect[] | undefined,
):
  | {
      readonly color: string;
      readonly blur: number;
      readonly offsetX: number;
      readonly offsetY: number;
    }
  | undefined {
  const shadow = [...(effects ?? [])].reverse().find(
    (effect) =>
      effect.enabled && (effect.type === "drop-shadow" || effect.type === "glow"),
  );
  if (!shadow) return undefined;
  if (shadow.type === "drop-shadow") {
    return {
      color: toRgba(shadow.color, shadow.opacity),
      blur: shadow.blur,
      offsetX: shadow.offsetX,
      offsetY: shadow.offsetY,
    };
  }
  if (shadow.type !== "glow") {
    return undefined;
  }
  return {
    color: toRgba(shadow.color, shadow.intensity),
    blur: shadow.radius,
    offsetX: 0,
    offsetY: 0,
  };
}

function getFilterParts(
  effects: readonly MotionEffect[] | undefined,
): string[] {
  return (effects ?? [])
    .filter((effect) => effect.enabled)
    .flatMap((effect) => {
      switch (effect.type) {
        case "blur":
          return effect.radius > 0 ? [`blur(${effect.radius}px)`] : [];
        case "color-adjust":
          return [
            `brightness(${clamp(effect.brightness, 0, 4)})`,
            `contrast(${clamp(effect.contrast, 0, 4)})`,
            `saturate(${clamp(effect.saturation, 0, 4)})`,
            `hue-rotate(${effect.hue}deg)`,
          ];
        case "drop-shadow":
          return [
            `drop-shadow(${effect.offsetX}px ${effect.offsetY}px ${Math.max(
              0,
              effect.blur,
            )}px ${toRgba(effect.color, effect.opacity)})`,
          ];
        case "glow":
          return [
            `drop-shadow(0 0 ${Math.max(0, effect.radius)}px ${toRgba(
              effect.color,
              effect.intensity,
            )})`,
          ];
        case "invert":
          return effect.amount > 0
            ? [`invert(${clamp(effect.amount, 0, 1)})`]
            : [];
        case "grayscale":
          return effect.amount > 0
            ? [`grayscale(${clamp(effect.amount, 0, 1)})`]
            : [];
        case "sepia":
          return effect.amount > 0
            ? [`sepia(${clamp(effect.amount, 0, 1)})`]
            : [];
        case "levels":
        case "sharpen":
        case "posterize":
        case "directional-blur":
        case "noise":
        case "radial-blur":
        case "displace":
        case "threshold":
        case "mosaic":
        case "chromatic-aberration":
        case "vignette":
        case "backdrop-blur":
        case "shader":
        case "slider-control":
        case "checkbox-control":
        case "angle-control":
          return [];
      }
    });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampShaderParam(
  effect: MotionShaderEffect,
  param: MotionEffectParameterName,
  value: number,
): number {
  const def = getMotionShaderDef(effect.shaderId);
  const paramDef = def?.params.find((entry) => entry.name === param);
  if (paramDef) {
    return clamp(value, paramDef.min, paramDef.max);
  }
  return Number.isFinite(value) ? value : 0;
}

function toRgba(color: string, alpha: number): string {
  const normalized = color.trim();
  const opacity = clamp(alpha, 0, 1);
  const shortHex = /^#([0-9a-f]{3})$/i.exec(normalized);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("").map((part) => parseInt(part + part, 16));
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  const fullHex = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (fullHex) {
    const value = fullHex[1];
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  if (normalized.startsWith("rgb(")) {
    return normalized.replace(/^rgb\((.*)\)$/i, `rgba($1, ${opacity})`);
  }
  return normalized;
}
