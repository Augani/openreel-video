import { EFFECT_DEFINITIONS } from "../types/effects";

export type KeyframePropertyFamily =
  | "transform"
  | "crop"
  | "effect"
  | "colorGrade"
  | "audio"
  | "motion";

export interface KeyframePropertyDescriptor {
  readonly property: string;
  readonly label: string;
  readonly family: KeyframePropertyFamily;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly defaultValue: number;
  readonly displayScale?: number;
}

const staticDescriptors: Record<string, KeyframePropertyDescriptor> = {
  "transform.position.x": {
    property: "transform.position.x",
    label: "Position X",
    family: "transform",
    min: -4000,
    max: 4000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  "transform.position.y": {
    property: "transform.position.y",
    label: "Position Y",
    family: "transform",
    min: -4000,
    max: 4000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  "transform.position.z": {
    property: "transform.position.z",
    label: "Position Z",
    family: "transform",
    min: -4000,
    max: 4000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  "transform.scale.x": {
    property: "transform.scale.x",
    label: "Scale X",
    family: "transform",
    min: 0,
    max: 10,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
  "transform.scale.y": {
    property: "transform.scale.y",
    label: "Scale Y",
    family: "transform",
    min: 0,
    max: 10,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
  "transform.rotation": {
    property: "transform.rotation",
    label: "Rotation Z",
    family: "transform",
    min: -360,
    max: 360,
    step: 1,
    unit: "deg",
    defaultValue: 0,
  },
  "transform.rotation.x": {
    property: "transform.rotation.x",
    label: "Rotation X",
    family: "transform",
    min: -360,
    max: 360,
    step: 1,
    unit: "deg",
    defaultValue: 0,
  },
  "transform.rotation.y": {
    property: "transform.rotation.y",
    label: "Rotation Y",
    family: "transform",
    min: -360,
    max: 360,
    step: 1,
    unit: "deg",
    defaultValue: 0,
  },
  "transform.perspective": {
    property: "transform.perspective",
    label: "Perspective",
    family: "transform",
    min: 100,
    max: 5000,
    step: 25,
    unit: "px",
    defaultValue: 1000,
  },
  "transform.opacity": {
    property: "transform.opacity",
    label: "Opacity",
    family: "transform",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
  "transform.anchor.x": {
    property: "transform.anchor.x",
    label: "Anchor X",
    family: "transform",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
  },
  "transform.anchor.y": {
    property: "transform.anchor.y",
    label: "Anchor Y",
    family: "transform",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
  },
  "transform.borderRadius": {
    property: "transform.borderRadius",
    label: "Border Radius",
    family: "transform",
    min: 0,
    max: 240,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  "transform.crop.x": {
    property: "transform.crop.x",
    label: "Crop X",
    family: "crop",
    min: 0,
    max: 1,
    step: 0.001,
    defaultValue: 0,
  },
  "transform.crop.y": {
    property: "transform.crop.y",
    label: "Crop Y",
    family: "crop",
    min: 0,
    max: 1,
    step: 0.001,
    defaultValue: 0,
  },
  "transform.crop.width": {
    property: "transform.crop.width",
    label: "Crop Width",
    family: "crop",
    min: 0,
    max: 1,
    step: 0.001,
    defaultValue: 1,
  },
  "transform.crop.height": {
    property: "transform.crop.height",
    label: "Crop Height",
    family: "crop",
    min: 0,
    max: 1,
    step: 0.001,
    defaultValue: 1,
  },
  "audio.volume": {
    property: "audio.volume",
    label: "Volume",
    family: "audio",
    min: 0,
    max: 2,
    step: 0.01,
    defaultValue: 1,
  },
  "audio.pan": {
    property: "audio.pan",
    label: "Pan",
    family: "audio",
    min: -1,
    max: 1,
    step: 0.01,
    defaultValue: 0,
  },
  "colorGrade.temperature": {
    property: "colorGrade.temperature",
    label: "Temperature",
    family: "colorGrade",
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
  },
  "colorGrade.tint": {
    property: "colorGrade.tint",
    label: "Tint",
    family: "colorGrade",
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
  },
};

export const COLOR_GRADE_SCALAR_PROPS = [
  "colorGrade.temperature",
  "colorGrade.tint",
] as const;

export function getStaticDescriptor(
  property: string,
): KeyframePropertyDescriptor | undefined {
  return staticDescriptors[property];
}

export function listStaticDescriptors(): KeyframePropertyDescriptor[] {
  return Object.values(staticDescriptors);
}

export function deriveEffectDescriptor(
  effectId: string,
  effectType: string,
  paramKey: string,
): KeyframePropertyDescriptor | undefined {
  const effect = EFFECT_DEFINITIONS.find((definition) => definition.type === effectType);
  const param = effect?.params.find((definition) => definition.key === paramKey);
  if (!param || param.type !== "number") {
    return undefined;
  }

  return {
    property: `effect.${effectId}.${paramKey}`,
    label: param.label,
    family: "effect",
    min: param.min ?? 0,
    max: param.max ?? 1,
    step: param.step ?? 0.01,
    unit: param.unit,
    defaultValue: typeof param.default === "number" ? param.default : 0,
  };
}

export function parseEffectKeyframeProperty(
  property: string,
): { effectId: string; paramKey: string } | null {
  const match = /^effect\.([^.]+)\.(.+)$/.exec(property);
  if (!match) {
    return null;
  }
  return { effectId: match[1], paramKey: match[2] };
}
