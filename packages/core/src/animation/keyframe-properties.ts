import { EFFECT_DEFINITIONS } from "../types/effects";

export type KeyframeFamily = "transform" | "crop" | "effect" | "colorGrade" | "audio";

export interface KeyframePropertyDescriptor {
  property: string;
  label: string;
  family: KeyframeFamily;
  min: number;
  max: number;
  step: number;
  unit: string;
  defaultValue: number;
  displayScale: number;
}

const STATIC: Record<string, KeyframePropertyDescriptor> = {
  "transform.position.x": { property: "transform.position.x", label: "Position X", family: "transform", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.position.y": { property: "transform.position.y", label: "Position Y", family: "transform", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.scale.x": { property: "transform.scale.x", label: "Scale X", family: "transform", min: 0, max: 10, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.scale.y": { property: "transform.scale.y", label: "Scale Y", family: "transform", min: 0, max: 10, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.rotation": { property: "transform.rotation", label: "Rotation", family: "transform", min: -360, max: 360, step: 1, unit: "deg", defaultValue: 0, displayScale: 1 },
  "transform.opacity": { property: "transform.opacity", label: "Opacity", family: "transform", min: 0, max: 1, step: 0.01, unit: "%", defaultValue: 1, displayScale: 100 },
  "transform.anchor.x": { property: "transform.anchor.x", label: "Anchor X", family: "transform", min: 0, max: 1, step: 0.01, unit: "", defaultValue: 0.5, displayScale: 1 },
  "transform.anchor.y": { property: "transform.anchor.y", label: "Anchor Y", family: "transform", min: 0, max: 1, step: 0.01, unit: "", defaultValue: 0.5, displayScale: 1 },
  "transform.borderRadius": { property: "transform.borderRadius", label: "Border Radius", family: "transform", min: 0, max: 200, step: 1, unit: "px", defaultValue: 0, displayScale: 1 },
  "transform.crop.x": { property: "transform.crop.x", label: "Crop X", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 0, displayScale: 1 },
  "transform.crop.y": { property: "transform.crop.y", label: "Crop Y", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 0, displayScale: 1 },
  "transform.crop.width": { property: "transform.crop.width", label: "Crop W", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 1, displayScale: 1 },
  "transform.crop.height": { property: "transform.crop.height", label: "Crop H", family: "crop", min: 0, max: 1, step: 0.001, unit: "", defaultValue: 1, displayScale: 1 },
  "audio.volume": { property: "audio.volume", label: "Volume", family: "audio", min: 0, max: 2, step: 0.01, unit: "", defaultValue: 1, displayScale: 1 },
  "audio.pan": { property: "audio.pan", label: "Pan", family: "audio", min: -1, max: 1, step: 0.01, unit: "", defaultValue: 0, displayScale: 1 },
  "colorGrade.temperature": { property: "colorGrade.temperature", label: "Temperature", family: "colorGrade", min: -100, max: 100, step: 1, unit: "", defaultValue: 0, displayScale: 1 },
  "colorGrade.tint": { property: "colorGrade.tint", label: "Tint", family: "colorGrade", min: -100, max: 100, step: 1, unit: "", defaultValue: 0, displayScale: 1 },
};

export const COLOR_GRADE_SCALAR_PROPS = ["colorGrade.temperature", "colorGrade.tint"];

export function getStaticDescriptor(property: string): KeyframePropertyDescriptor | undefined {
  return STATIC[property];
}

export function deriveEffectDescriptor(
  effectId: string,
  effectType: string,
  paramKey: string,
): KeyframePropertyDescriptor | undefined {
  const def = EFFECT_DEFINITIONS.find((d) => d.type === effectType);
  const param = def?.params.find((p) => p.key === paramKey);
  if (!param) return undefined;
  return {
    property: `effect.${effectId}.${paramKey}`,
    label: param.label,
    family: "effect",
    min: param.min ?? 0,
    max: param.max ?? 1,
    step: param.step ?? 0.01,
    unit: param.unit ?? "",
    defaultValue: typeof param.default === "number" ? param.default : 0,
    displayScale: 1,
  };
}
