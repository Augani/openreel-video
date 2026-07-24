import {
  getStaticDescriptor,
  type KeyframePropertyDescriptor,
} from "../animation/keyframe-properties";
import type { EasingType, Keyframe } from "../types/timeline";
import type {
  MotionComposition,
  MotionEffect,
  MotionLayer,
  MotionParticleEmitter,
  MotionPuppetPin,
  MotionShapeGroupItem,
  MotionShapeItem,
  MotionShapeLayer,
  MotionShapeOperator,
  MotionShapePathItem,
} from "./types";
import {
  getMotionShapeContents,
  hasExplicitShapeContents,
} from "./motion-shape-contents";
import { morphMotionPathData } from "./motion-shape-path";
import {
  evaluateMotionPropertyValueAtTime,
  registerMotionExpressionBaseValueResolver,
} from "./motion-expressions";
import {
  getMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptor,
  getMotionEffectParameterDescriptors,
  getMotionEffectParameterValue,
  parseMotionEffectKeyframeProperty,
  setMotionEffectParameterValue,
  type MotionEffectParameterName,
} from "./motion-effects";
import { normalizeMotionParticleEmitter } from "./motion-particles";
import { normalizeMotionPuppetPin } from "./motion-puppet";
import { getMotionShaderDef, type MotionShaderDef } from "./shaders";
import {
  getMotionShapeModifierKeyframeProperty,
  getMotionShapeModifierPropertyDescriptor as getShapeModifierParameterDescriptor,
  getMotionShapeModifierPropertyDescriptors,
  getMotionShapeModifierPropertyValue,
  parseMotionShapeModifierKeyframeProperty,
  setMotionShapeModifierPropertyValue,
  type MotionShapeModifierProperty,
  type MotionShapeModifierPropertyName,
} from "./motion-shape-modifiers";

export const MOTION_TRANSFORM_PROPERTY_IDS = [
  "transform.position.x",
  "transform.position.y",
  "transform.position.z",
  "transform.scale.x",
  "transform.scale.y",
  "transform.rotation",
  "transform.rotation.x",
  "transform.rotation.y",
  "transform.rotation.z",
  "transform.opacity",
  "transform.anchor.x",
  "transform.anchor.y",
  "transform.perspective",
] as const;

export const MOTION_SHAPE_STYLE_PROPERTY_IDS = [
  "shape.width",
  "shape.height",
  "shape.cornerRadius",
  "shape.fill.opacity",
  "shape.stroke.width",
  "shape.stroke.opacity",
  "shape.stroke.dashOffset",
  "shape.gradient.angle",
] as const;

export const MOTION_COMPOSITION_PROPERTY_IDS = [
  "composition.time",
] as const;

export const MOTION_PARTICLE_PROPERTY_IDS = [
  "particle.emissionRate",
  "particle.maxParticles",
  "particle.lifetime",
  "particle.speed",
  "particle.spread",
  "particle.gravity",
  "particle.size",
  "particle.sizeRandomness",
  "particle.opacityStart",
  "particle.opacityEnd",
] as const;

export const MOTION_MASK_PROPERTY_NAMES = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "expansion",
  "feather",
  "opacity",
] as const;

export const MOTION_PUPPET_PROPERTY_NAMES = [
  "position.x",
  "position.y",
  "radius",
  "strength",
] as const;

export const MOTION_SCENE_CAMERA_PROPERTY_NAMES = [
  "position.x",
  "position.y",
  "position.z",
  "target.x",
  "target.y",
  "target.z",
  "fov",
  "near",
  "far",
] as const;

export const MOTION_SCENE_OBJECT_PROPERTY_NAMES = [
  "position.x",
  "position.y",
  "position.z",
  "rotation.x",
  "rotation.y",
  "rotation.z",
  "scale.x",
  "scale.y",
  "scale.z",
  "opacity",
  "lid.angle",
] as const;

export type MotionTransformProperty =
  (typeof MOTION_TRANSFORM_PROPERTY_IDS)[number];
export type MotionShapeStyleProperty =
  (typeof MOTION_SHAPE_STYLE_PROPERTY_IDS)[number];
export type MotionCompositionProperty =
  (typeof MOTION_COMPOSITION_PROPERTY_IDS)[number];
export type MotionParticleProperty =
  (typeof MOTION_PARTICLE_PROPERTY_IDS)[number];
export type MotionMaskPropertyName = (typeof MOTION_MASK_PROPERTY_NAMES)[number];
export type MotionMaskProperty = `mask.${string}.${MotionMaskPropertyName}`;
export type MotionMaskPathProperty = `mask.${string}.path`;
export type MotionPuppetPropertyName =
  (typeof MOTION_PUPPET_PROPERTY_NAMES)[number];
export type MotionPuppetProperty =
  `puppet.${string}.${MotionPuppetPropertyName}`;
export type MotionEffectProperty = `effect.${string}.${string}`;
export type MotionShaderFillProperty =
  | `shape.fill.shader.${string}`
  | `text.fillShader.${string}`;
export type MotionSceneCameraPropertyName =
  (typeof MOTION_SCENE_CAMERA_PROPERTY_NAMES)[number];
export type MotionSceneCameraProperty =
  `scene.camera.${MotionSceneCameraPropertyName}`;
export type MotionSceneObjectPropertyName =
  (typeof MOTION_SCENE_OBJECT_PROPERTY_NAMES)[number];
export type MotionSceneObjectProperty =
  `scene.object.${string}.${MotionSceneObjectPropertyName}`;

export const MOTION_CONTENTS_TRANSFORM_FIELDS = [
  "positionX",
  "positionY",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
] as const;

export type MotionContentsTransformField =
  (typeof MOTION_CONTENTS_TRANSFORM_FIELDS)[number];

export type MotionContentsProperty =
  | `contents.${string}.transform.${MotionContentsTransformField}`
  | `contents.${string}.pathData`
  | `contents.${string}.operator.${string}.${string}`;

export type MotionContentsChannel =
  | { readonly type: "transform"; readonly field: MotionContentsTransformField }
  | { readonly type: "pathData" }
  | { readonly type: "operator"; readonly operatorId: string; readonly param: string };

export type MotionAnimatableProperty =
  | MotionTransformProperty
  | MotionShapeStyleProperty
  | MotionCompositionProperty
  | MotionParticleProperty
  | MotionMaskProperty
  | MotionMaskPathProperty
  | MotionPuppetProperty
  | MotionEffectProperty
  | MotionShaderFillProperty
  | MotionShapeModifierProperty
  | MotionSceneCameraProperty
  | MotionSceneObjectProperty
  | MotionContentsProperty;

export interface MotionAnimatablePropertyDescriptor
  extends Omit<KeyframePropertyDescriptor, "property" | "family"> {
  readonly property: MotionAnimatableProperty;
  readonly family: "motion";
  readonly group:
    | "Transform"
    | "Shape"
    | "Text"
    | "Precomp"
    | "Particles"
    | "Mask"
    | "Deform"
    | "Shape Modifiers"
    | "Shape Contents"
    | "Effects"
    | "3D Scene";
}

export interface UpsertMotionKeyframeOptions {
  readonly value?: number;
  readonly easing?: EasingType;
  readonly bezierHandles?: Keyframe["bezierHandles"];
  readonly snapTolerance?: number;
  readonly idFactory?: () => string;
}

export interface DuplicateMotionKeyframesOptions {
  readonly duration?: number;
  readonly idFactory?: (source: Keyframe, index: number) => string;
}

export interface ScaleMotionKeyframesOptions {
  readonly anchorTime?: number;
  readonly duration?: number;
}

export interface MotionKeyframeClipboardEntry {
  readonly timeOffset: number;
  readonly value: Keyframe["value"];
  readonly easing: EasingType;
}

export interface MotionKeyframeClipboard {
  readonly sourceProperty: string;
  readonly sourceStartTime: number;
  readonly span: number;
  readonly entries: readonly MotionKeyframeClipboardEntry[];
}

export interface PasteMotionKeyframesOptions {
  readonly duration?: number;
  readonly idFactory?: (
    source: MotionKeyframeClipboardEntry,
    index: number,
  ) => string;
}

const DEFAULT_SNAP_TOLERANCE = 1 / 1000;

const createKeyframeId = (): string =>
  `motion-kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const MOTION_MASK_PROPERTY_DESCRIPTOR_BY_NAME: Record<
  MotionMaskPropertyName,
  Omit<MotionAnimatablePropertyDescriptor, "label" | "property">
> = {
  x: {
    family: "motion",
    group: "Mask",
    min: -4,
    max: 4,
    step: 0.01,
    unit: "%",
    defaultValue: 0,
    displayScale: 100,
  },
  y: {
    family: "motion",
    group: "Mask",
    min: -4,
    max: 4,
    step: 0.01,
    unit: "%",
    defaultValue: 0,
    displayScale: 100,
  },
  width: {
    family: "motion",
    group: "Mask",
    min: 0,
    max: 8,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
  height: {
    family: "motion",
    group: "Mask",
    min: 0,
    max: 8,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
  rotation: {
    family: "motion",
    group: "Mask",
    min: -360,
    max: 360,
    step: 1,
    unit: "deg",
    defaultValue: 0,
  },
  expansion: {
    family: "motion",
    group: "Mask",
    min: -1000,
    max: 1000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  feather: {
    family: "motion",
    group: "Mask",
    min: 0,
    max: 1000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  opacity: {
    family: "motion",
    group: "Mask",
    min: 0,
    max: 1,
    step: 0.01,
    unit: "%",
    defaultValue: 1,
    displayScale: 100,
  },
};

const MOTION_PUPPET_PROPERTY_DESCRIPTOR_BY_NAME: Record<
  MotionPuppetPropertyName,
  Omit<MotionAnimatablePropertyDescriptor, "label" | "property">
> = {
  "position.x": {
    family: "motion",
    group: "Deform",
    min: -4000,
    max: 4000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  "position.y": {
    family: "motion",
    group: "Deform",
    min: -4000,
    max: 4000,
    step: 1,
    unit: "px",
    defaultValue: 0,
  },
  radius: {
    family: "motion",
    group: "Deform",
    min: 1,
    max: 4000,
    step: 5,
    unit: "px",
    defaultValue: 180,
  },
  strength: {
    family: "motion",
    group: "Deform",
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: 1,
  },
};

export const MOTION_ANIMATABLE_PROPERTIES: readonly MotionAnimatablePropertyDescriptor[] =
  [
    ...MOTION_TRANSFORM_PROPERTY_IDS.map((property) => {
      const descriptor = getStaticDescriptor(property);
      return {
        property,
        label: descriptor?.label ?? property,
        family: "motion" as const,
        group: "Transform" as const,
        min: descriptor?.min ?? 0,
        max: descriptor?.max ?? 1,
        step: descriptor?.step ?? 0.01,
        unit: descriptor?.unit,
        defaultValue: descriptor?.defaultValue ?? 0,
        displayScale: descriptor?.displayScale,
      };
    }),
    {
      property: "shape.width",
      label: "Shape Width",
      family: "motion",
      group: "Shape",
      min: 1,
      max: 4000,
      step: 1,
      unit: "px",
      defaultValue: 100,
    },
    {
      property: "shape.height",
      label: "Shape Height",
      family: "motion",
      group: "Shape",
      min: 1,
      max: 4000,
      step: 1,
      unit: "px",
      defaultValue: 100,
    },
    {
      property: "shape.cornerRadius",
      label: "Corner Radius",
      family: "motion",
      group: "Shape",
      min: 0,
      max: 500,
      step: 1,
      unit: "px",
      defaultValue: 0,
    },
    {
      property: "shape.fill.opacity",
      label: "Fill Opacity",
      family: "motion",
      group: "Shape",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "%",
      defaultValue: 1,
      displayScale: 100,
    },
    {
      property: "shape.stroke.width",
      label: "Stroke Width",
      family: "motion",
      group: "Shape",
      min: 0,
      max: 500,
      step: 1,
      unit: "px",
      defaultValue: 0,
    },
    {
      property: "shape.stroke.opacity",
      label: "Stroke Opacity",
      family: "motion",
      group: "Shape",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "%",
      defaultValue: 1,
      displayScale: 100,
    },
    {
      property: "shape.stroke.dashOffset",
      label: "Dash Offset",
      family: "motion",
      group: "Shape",
      min: -1000,
      max: 1000,
      step: 1,
      unit: "px",
      defaultValue: 0,
    },
    {
      property: "shape.gradient.angle",
      label: "Gradient Angle",
      family: "motion",
      group: "Shape",
      min: -360,
      max: 360,
      step: 1,
      unit: "deg",
      defaultValue: 0,
    },
    {
      property: "composition.time",
      label: "Source Time",
      family: "motion",
      group: "Precomp",
      min: 0,
      max: 60,
      step: 0.05,
      unit: "s",
      defaultValue: 0,
    },
    {
      property: "particle.emissionRate",
      label: "Emission Rate",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 1000,
      step: 1,
      unit: "/s",
      defaultValue: 48,
    },
    {
      property: "particle.maxParticles",
      label: "Max Particles",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 5000,
      step: 1,
      defaultValue: 240,
    },
    {
      property: "particle.lifetime",
      label: "Lifetime",
      family: "motion",
      group: "Particles",
      min: 0.01,
      max: 60,
      step: 0.05,
      unit: "s",
      defaultValue: 2.4,
    },
    {
      property: "particle.speed",
      label: "Speed",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 5000,
      step: 10,
      defaultValue: 220,
    },
    {
      property: "particle.spread",
      label: "Spread",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 360,
      step: 1,
      unit: "deg",
      defaultValue: 120,
    },
    {
      property: "particle.gravity",
      label: "Gravity",
      family: "motion",
      group: "Particles",
      min: -5000,
      max: 5000,
      step: 10,
      defaultValue: 120,
    },
    {
      property: "particle.size",
      label: "Particle Size",
      family: "motion",
      group: "Particles",
      min: 0.1,
      max: 1000,
      step: 1,
      unit: "px",
      defaultValue: 10,
    },
    {
      property: "particle.sizeRandomness",
      label: "Size Randomness",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "%",
      defaultValue: 0.55,
      displayScale: 100,
    },
    {
      property: "particle.opacityStart",
      label: "Start Opacity",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "%",
      defaultValue: 1,
      displayScale: 100,
    },
    {
      property: "particle.opacityEnd",
      label: "End Opacity",
      family: "motion",
      group: "Particles",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "%",
      defaultValue: 0,
      displayScale: 100,
    },
  ];

export function getMotionMaskKeyframeProperty(
  maskId: string,
  property: MotionMaskPropertyName,
): MotionMaskProperty {
  return `mask.${maskId}.${property}`;
}

export function getMotionMaskPathKeyframeProperty(
  maskId: string,
): MotionMaskPathProperty {
  return `mask.${maskId}.path`;
}

export function getMotionPuppetPinKeyframeProperty(
  pinId: string,
  property: MotionPuppetPropertyName,
): MotionPuppetProperty {
  return `puppet.${pinId}.${property}`;
}

export function parseMotionMaskKeyframeProperty(
  property: string,
): { readonly maskId: string; readonly property: MotionMaskPropertyName } | null {
  const match = /^mask\.([^.]+)\.([a-zA-Z]+)$/.exec(property);
  if (!match) return null;
  const maskProperty = match[2] as MotionMaskPropertyName;
  if (!MOTION_MASK_PROPERTY_NAMES.includes(maskProperty)) return null;
  return { maskId: match[1], property: maskProperty };
}

export function parseMotionMaskPathKeyframeProperty(
  property: string,
): { readonly maskId: string } | null {
  const match = /^mask\.([^.]+)\.path$/.exec(property);
  if (!match) return null;
  return { maskId: match[1] };
}

export function parseMotionPuppetKeyframeProperty(
  property: string,
): {
  readonly pinId: string;
  readonly property: MotionPuppetPropertyName;
} | null {
  const match = /^puppet\.([^.]+)\.(position\.x|position\.y|radius|strength)$/.exec(
    property,
  );
  if (!match) return null;
  const puppetProperty = match[2] as MotionPuppetPropertyName;
  if (!MOTION_PUPPET_PROPERTY_NAMES.includes(puppetProperty)) return null;
  return { pinId: match[1], property: puppetProperty };
}

export function parseMotionSceneCameraKeyframeProperty(
  property: string,
): { readonly property: MotionSceneCameraPropertyName } | null {
  const match =
    /^scene\.camera\.(position\.[xyz]|target\.[xyz]|fov|near|far)$/.exec(property);
  if (!match) return null;
  const name = match[1] as MotionSceneCameraPropertyName;
  if (!MOTION_SCENE_CAMERA_PROPERTY_NAMES.includes(name)) return null;
  return { property: name };
}

export function parseMotionSceneObjectKeyframeProperty(
  property: string,
): {
  readonly objectId: string;
  readonly property: MotionSceneObjectPropertyName;
} | null {
  const match =
    /^scene\.object\.([^.]+)\.(position\.[xyz]|rotation\.[xyz]|scale\.[xyz]|opacity|lid\.angle)$/.exec(
      property,
    );
  if (!match) return null;
  const name = match[2] as MotionSceneObjectPropertyName;
  if (!MOTION_SCENE_OBJECT_PROPERTY_NAMES.includes(name)) return null;
  return { objectId: match[1], property: name };
}

export function parseMotionShaderFillKeyframeProperty(
  property: string,
):
  | { readonly surface: "shape" | "text"; readonly param: string }
  | undefined {
  const shapeMatch = /^shape\.fill\.shader\.([^.]+)$/.exec(property);
  if (shapeMatch) return { surface: "shape", param: shapeMatch[1] };
  const textMatch = /^text\.fillShader\.([^.]+)$/.exec(property);
  if (textMatch) return { surface: "text", param: textMatch[1] };
  return undefined;
}

function getMotionLayerShaderFill(
  layer: MotionLayer,
  surface: "shape" | "text",
):
  | { readonly shaderId: string; readonly params: Record<string, number | string> }
  | undefined {
  if (surface === "shape") {
    if (layer.type !== "shape") return undefined;
    const fill = layer.style.fill;
    return fill.type === "shader" && fill.shader ? fill.shader : undefined;
  }
  if (layer.type !== "text") return undefined;
  return layer.style.fillShader;
}

function getMotionShaderFillBaseValue(
  layer: MotionLayer,
  surface: "shape" | "text",
  param: string,
): number {
  const fill = getMotionLayerShaderFill(layer, surface);
  if (!fill) return 0;
  const stored = fill.params[param];
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  const def = getMotionShaderDef(fill.shaderId);
  const paramDef = def?.params.find((entry) => entry.name === param);
  return typeof paramDef?.default === "number" && Number.isFinite(paramDef.default)
    ? paramDef.default
    : 0;
}

export function getMotionLayerShaderFillPropertyDescriptors(
  layer: MotionLayer,
): readonly MotionAnimatablePropertyDescriptor[] {
  const shapeFill = getMotionLayerShaderFill(layer, "shape");
  const textFill = getMotionLayerShaderFill(layer, "text");
  const active = shapeFill
    ? { fill: shapeFill, prefix: "shape.fill.shader" as const }
    : textFill
      ? { fill: textFill, prefix: "text.fillShader" as const }
      : undefined;
  if (!active) return [];
  const def = getMotionShaderDef(active.fill.shaderId);
  if (!def) return [];
  return def.params.map((paramDef) =>
    getMotionShaderFillPropertyDescriptor(
      `${active.prefix}.${paramDef.name}` as MotionShaderFillProperty,
      def,
    ),
  );
}

export function getMotionLayerMaskPropertyDescriptors(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return (layer.masks ?? []).flatMap((mask) => {
    const descriptors = MOTION_MASK_PROPERTY_NAMES.map((property) =>
      getMotionMaskPropertyDescriptor(
        getMotionMaskKeyframeProperty(mask.id, property),
        mask.name,
      ),
    );
    if (mask.shape === "path") {
      descriptors.push(
        getMotionMaskPathPropertyDescriptor(
          getMotionMaskPathKeyframeProperty(mask.id),
          mask.name,
        ),
      );
    }
    return descriptors;
  });
}

export function getMotionLayerPuppetPropertyDescriptors(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return layer.type === "shape"
    ? (layer.puppetPins ?? []).flatMap((pin) =>
        MOTION_PUPPET_PROPERTY_NAMES.map((property) =>
          getMotionPuppetPropertyDescriptor(
            getMotionPuppetPinKeyframeProperty(pin.id, property),
            pin.name,
          ),
        ),
      )
    : [];
}

export function getMotionLayerEffectPropertyDescriptors(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return (layer.effects ?? []).flatMap((effect) =>
    getMotionEffectParameterDescriptors(effect).map((paramDescriptor) =>
      getMotionEffectPropertyDescriptor(
        getMotionEffectKeyframeProperty(
          effect.id,
          paramDescriptor.param,
        ) as MotionEffectProperty,
        effect.name,
        effect,
      ),
    ),
  );
}

export function getMotionLayerShapeModifierPropertyDescriptors(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  return layer.type === "shape"
    ? (layer.modifiers ?? []).flatMap((modifier) =>
        getMotionShapeModifierPropertyDescriptors(modifier).map((descriptor) =>
          getMotionShapeModifierPropertyDescriptor(
            getMotionShapeModifierKeyframeProperty(
              modifier.id,
              descriptor.property,
            ),
            modifier.name,
            layer,
          ),
        ),
      )
    : [];
}

export function parseContentsPropertyId(
  propertyId: string,
): { readonly itemId: string; readonly channel: MotionContentsChannel } | null {
  const transformMatch =
    /^contents\.([^.]+)\.transform\.(positionX|positionY|scaleX|scaleY|rotation|opacity)$/.exec(
      propertyId,
    );
  if (transformMatch) {
    const field = transformMatch[2] as MotionContentsTransformField;
    if (!MOTION_CONTENTS_TRANSFORM_FIELDS.includes(field)) return null;
    return { itemId: transformMatch[1], channel: { type: "transform", field } };
  }
  const pathMatch = /^contents\.([^.]+)\.pathData$/.exec(propertyId);
  if (pathMatch) {
    return { itemId: pathMatch[1], channel: { type: "pathData" } };
  }
  const operatorMatch =
    /^contents\.([^.]+)\.operator\.([^.]+)\.([A-Za-z][A-Za-z0-9.]*)$/.exec(
      propertyId,
    );
  if (operatorMatch) {
    const param = operatorMatch[3];
    if (param.endsWith(".") || param.includes("..")) return null;
    return {
      itemId: operatorMatch[1],
      channel: {
        type: "operator",
        operatorId: operatorMatch[2],
        param,
      },
    };
  }
  return null;
}

const CONTENTS_TRANSFORM_LABELS: Record<MotionContentsTransformField, string> = {
  positionX: "Position X",
  positionY: "Position Y",
  scaleX: "Scale X",
  scaleY: "Scale Y",
  rotation: "Rotation",
  opacity: "Opacity",
};

function toOperatorParamName(
  operator: MotionShapeOperator,
  param: string,
): MotionShapeModifierPropertyName | null {
  const descriptor = getMotionShapeModifierPropertyDescriptors(operator).find(
    (candidate) => candidate.property === param,
  );
  return descriptor ? descriptor.property : null;
}

function collectOperatorNumericParams(
  operator: MotionShapeOperator,
): readonly string[] {
  return getMotionShapeModifierPropertyDescriptors(operator).map(
    (descriptor) => descriptor.property,
  );
}

function getOperatorNumericParamValue(
  operator: MotionShapeOperator,
  param: string,
): number {
  const name = toOperatorParamName(operator, param);
  return name === null ? 0 : getMotionShapeModifierPropertyValue(operator, name);
}

function withOperatorNumericParam(
  operator: MotionShapeOperator,
  param: string,
  value: number,
): MotionShapeOperator {
  const name = toOperatorParamName(operator, param);
  if (name === null) return operator;
  return setMotionShapeModifierPropertyValue(operator, name, value);
}

function readPathDataKeyframeValue(keyframe: Keyframe): string | undefined {
  return typeof keyframe.value === "string" && keyframe.value.trim().length > 0
    ? keyframe.value
    : undefined;
}

function resolveContentsPathDataAtTime(
  layer: MotionShapeLayer,
  itemId: string,
  fallback: string | undefined,
  localTime: number,
): string | undefined {
  const propertyId = `contents.${itemId}.pathData`;
  const keyframes = getMotionLayerPropertyKeyframes(layer, propertyId);
  if (keyframes.length === 0) return fallback;

  const time = Number.isFinite(localTime) ? localTime : 0;
  if (keyframes.length === 1 || time <= keyframes[0].time) {
    return readPathDataKeyframeValue(keyframes[0]) ?? fallback;
  }
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return readPathDataKeyframeValue(last) ?? fallback;
  }
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (time < from.time || time > to.time) continue;
    const fromData = readPathDataKeyframeValue(from);
    const toData = readPathDataKeyframeValue(to);
    if (fromData === undefined || toData === undefined) return fallback;
    const span = Math.max(0.001, to.time - from.time);
    const progress = Math.min(1, Math.max(0, (time - from.time) / span));
    return morphMotionPathData(fromData, toData, progress);
  }
  return readPathDataKeyframeValue(last) ?? fallback;
}

function resolveContentsNumericAtTime(
  layer: MotionShapeLayer,
  propertyId: string,
  fallback: number,
  localTime: number,
  composition?: MotionComposition,
): number {
  return evaluateMotionPropertyValueAtTime({
    keyframes: layer.keyframes,
    expressions: layer.expressions,
    property: propertyId,
    localTime,
    fallback,
    duration: layer.duration,
    context: composition ? { composition, layer } : undefined,
  });
}

function resolveShapeGroupAtTime(
  layer: MotionShapeLayer,
  group: MotionShapeGroupItem,
  localTime: number,
  composition?: MotionComposition,
): MotionShapeGroupItem {
  const transform = {
    anchor: { ...group.transform.anchor },
    position: {
      x: resolveContentsNumericAtTime(
        layer,
        `contents.${group.id}.transform.positionX`,
        group.transform.position.x,
        localTime,
        composition,
      ),
      y: resolveContentsNumericAtTime(
        layer,
        `contents.${group.id}.transform.positionY`,
        group.transform.position.y,
        localTime,
        composition,
      ),
    },
    scale: {
      x: resolveContentsNumericAtTime(
        layer,
        `contents.${group.id}.transform.scaleX`,
        group.transform.scale.x,
        localTime,
        composition,
      ),
      y: resolveContentsNumericAtTime(
        layer,
        `contents.${group.id}.transform.scaleY`,
        group.transform.scale.y,
        localTime,
        composition,
      ),
    },
    rotation: resolveContentsNumericAtTime(
      layer,
      `contents.${group.id}.transform.rotation`,
      group.transform.rotation,
      localTime,
      composition,
    ),
    opacity: resolveContentsNumericAtTime(
      layer,
      `contents.${group.id}.transform.opacity`,
      group.transform.opacity,
      localTime,
      composition,
    ),
  };

  const operators = group.operators?.map((operator) => {
    let next = operator;
    for (const param of collectOperatorNumericParams(operator)) {
      const resolvedValue = resolveContentsNumericAtTime(
        layer,
        `contents.${group.id}.operator.${operator.id}.${param}`,
        getOperatorNumericParamValue(operator, param),
        localTime,
        composition,
      );
      next = withOperatorNumericParam(next, param, resolvedValue);
    }
    return next;
  });

  return {
    ...group,
    transform,
    items: resolveShapeItemsAtTime(layer, group.items, localTime, composition),
    ...(operators ? { operators } : {}),
  };
}

function resolveShapePathItemAtTime(
  layer: MotionShapeLayer,
  item: MotionShapePathItem,
  localTime: number,
): MotionShapePathItem {
  const pathData = resolveContentsPathDataAtTime(
    layer,
    item.id,
    item.pathData,
    localTime,
  );
  if (pathData === item.pathData) return item;
  return { ...item, pathData };
}

function resolveShapeItemsAtTime(
  layer: MotionShapeLayer,
  items: readonly MotionShapeItem[],
  localTime: number,
  composition?: MotionComposition,
): readonly MotionShapeItem[] {
  return items.map((item) =>
    item.kind === "group"
      ? resolveShapeGroupAtTime(layer, item, localTime, composition)
      : resolveShapePathItemAtTime(layer, item, localTime),
  );
}

export function resolveShapeContentsAtTime(
  layer: MotionShapeLayer,
  localTime: number,
  composition?: MotionComposition,
): readonly MotionShapeItem[] {
  const contents = getMotionShapeContents(layer);
  return resolveShapeItemsAtTime(layer, contents, localTime, composition);
}

function getContentsGroupDescriptors(
  group: MotionShapeGroupItem,
): MotionAnimatablePropertyDescriptor[] {
  const descriptors: MotionAnimatablePropertyDescriptor[] =
    MOTION_CONTENTS_TRANSFORM_FIELDS.map((field) => ({
      property: `contents.${group.id}.transform.${field}` as const,
      family: "motion",
      group: "Shape Contents",
      label: `${group.name} › ${CONTENTS_TRANSFORM_LABELS[field]}`,
      min: field === "opacity" ? 0 : field === "rotation" ? -3600 : -10000,
      max: field === "opacity" ? 1 : field === "rotation" ? 3600 : 10000,
      step: field === "opacity" || field.startsWith("scale") ? 0.01 : 1,
      unit: field === "rotation" ? "deg" : undefined,
      defaultValue:
        field === "opacity" || field.startsWith("scale") ? 1 : 0,
      displayScale: field === "opacity" ? 100 : undefined,
    }));

  for (const operator of group.operators ?? []) {
    for (const param of collectOperatorNumericParams(operator)) {
      descriptors.push({
        property:
          `contents.${group.id}.operator.${operator.id}.${param}` as const,
        family: "motion",
        group: "Shape Contents",
        label: `${group.name} › ${operator.name} ${formatGenericParamName(param)}`,
        min: -3600,
        max: 3600,
        step: 0.1,
        defaultValue: getOperatorNumericParamValue(operator, param),
      });
    }
  }
  return descriptors;
}

function getContentsItemDescriptors(
  item: MotionShapeItem,
): MotionAnimatablePropertyDescriptor[] {
  if (item.kind === "group") {
    return [
      ...getContentsGroupDescriptors(item),
      ...item.items.flatMap((child) => getContentsItemDescriptors(child)),
    ];
  }
  return [
    {
      property: `contents.${item.id}.pathData` as const,
      family: "motion",
      group: "Shape Contents",
      label: `${item.name} › Path`,
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
    },
  ];
}

export function getMotionLayerContentsPropertyDescriptors(
  layer: MotionLayer,
): MotionAnimatablePropertyDescriptor[] {
  if (layer.type !== "shape" || !hasExplicitShapeContents(layer)) {
    return [];
  }
  return getMotionShapeContents(layer).flatMap((item) =>
    getContentsItemDescriptors(item),
  );
}

export function getMotionPropertyDescriptor(
  property: string,
): MotionAnimatablePropertyDescriptor | undefined {
  const staticDescriptor = MOTION_ANIMATABLE_PROPERTIES.find(
    (descriptor) => descriptor.property === property,
  );
  if (staticDescriptor) return staticDescriptor;

  if (parseMotionMaskKeyframeProperty(property)) {
    return getMotionMaskPropertyDescriptor(property as MotionMaskProperty);
  }
  if (parseMotionPuppetKeyframeProperty(property)) {
    return getMotionPuppetPropertyDescriptor(property as MotionPuppetProperty);
  }
  if (parseMotionEffectKeyframeProperty(property)) {
    return getMotionEffectPropertyDescriptor(property as MotionEffectProperty);
  }
  if (parseMotionShapeModifierKeyframeProperty(property)) {
    return getMotionShapeModifierPropertyDescriptor(
      property as MotionShapeModifierProperty,
    );
  }
  if (
    parseMotionSceneCameraKeyframeProperty(property) ||
    parseMotionSceneObjectKeyframeProperty(property)
  ) {
    return getMotionScenePropertyDescriptor(property);
  }
  if (parseContentsPropertyId(property)) {
    return getMotionContentsPropertyDescriptor(property as MotionContentsProperty);
  }
  return undefined;
}

function getMotionContentsPropertyDescriptor(
  property: MotionContentsProperty,
): MotionAnimatablePropertyDescriptor {
  const parsed = parseContentsPropertyId(property);
  if (parsed?.channel.type === "transform") {
    const field = parsed.channel.field;
    return {
      property,
      family: "motion",
      group: "Shape Contents",
      label: CONTENTS_TRANSFORM_LABELS[field],
      min: field === "opacity" ? 0 : field === "rotation" ? -3600 : -10000,
      max: field === "opacity" ? 1 : field === "rotation" ? 3600 : 10000,
      step: field === "opacity" || field.startsWith("scale") ? 0.01 : 1,
      unit: field === "rotation" ? "deg" : undefined,
      defaultValue: field === "opacity" || field.startsWith("scale") ? 1 : 0,
      displayScale: field === "opacity" ? 100 : undefined,
    };
  }
  if (parsed?.channel.type === "pathData") {
    return {
      property,
      family: "motion",
      group: "Shape Contents",
      label: "Path",
      min: 0,
      max: 1,
      step: 1,
      defaultValue: 0,
    };
  }
  return {
    property,
    family: "motion",
    group: "Shape Contents",
    label: parsed
      ? formatGenericParamName(
          parsed.channel.type === "operator" ? parsed.channel.param : "Param",
        )
      : "Param",
    min: -3600,
    max: 3600,
    step: 0.1,
    defaultValue: 0,
  };
}

function getMotionScenePropertyDescriptor(
  property: string,
): MotionAnimatablePropertyDescriptor {
  const isAngle = /(rotation\.[xyz]|fov|lid\.angle)$/.test(property);
  const isOpacity = property.endsWith(".opacity");
  const isScale = /scale\.[xyz]$/.test(property);
  const label = property
    .replace(/^scene\.camera\./, "Camera ")
    .replace(/^scene\.object\.[^.]+\./, "Object ")
    .replace(/\./g, " ");
  return {
    property: property as MotionAnimatableProperty,
    family: "motion",
    group: "3D Scene",
    label,
    min: isOpacity ? 0 : isAngle ? -3600 : -1000,
    max: isOpacity ? 1 : isAngle ? 3600 : 1000,
    step: isOpacity || isScale ? 0.01 : 0.1,
    defaultValue: isOpacity || isScale ? 1 : 0,
  };
}

export function isMotionAnimatableProperty(
  property: string,
): property is MotionAnimatableProperty {
  return (
    MOTION_TRANSFORM_PROPERTY_IDS.includes(
      property as MotionTransformProperty,
    ) ||
    MOTION_SHAPE_STYLE_PROPERTY_IDS.includes(
      property as MotionShapeStyleProperty,
    ) ||
    MOTION_COMPOSITION_PROPERTY_IDS.includes(
      property as MotionCompositionProperty,
    ) ||
    MOTION_PARTICLE_PROPERTY_IDS.includes(
      property as MotionParticleProperty,
    ) ||
    parseMotionMaskKeyframeProperty(property) !== null ||
    parseMotionMaskPathKeyframeProperty(property) !== null ||
    parseMotionPuppetKeyframeProperty(property) !== null ||
    parseMotionEffectKeyframeProperty(property) !== null ||
    parseMotionShaderFillKeyframeProperty(property) !== undefined ||
    parseMotionShapeModifierKeyframeProperty(property) !== null ||
    parseMotionSceneCameraKeyframeProperty(property) !== null ||
    parseMotionSceneObjectKeyframeProperty(property) !== null ||
    parseContentsPropertyId(property) !== null
  );
}

function getMotionSceneCameraBaseValue(
  layer: MotionLayer,
  name: MotionSceneCameraPropertyName,
): number {
  const camera = layer.type === "scene3d" ? layer.camera : undefined;
  const fovFallback =
    (layer.type === "scene3d" ? layer.fov : undefined) ?? 38;
  switch (name) {
    case "position.x":
      return camera?.position?.x ?? 0;
    case "position.y":
      return camera?.position?.y ?? 3;
    case "position.z":
      return camera?.position?.z ?? 14;
    case "target.x":
      return camera?.target?.x ?? 0;
    case "target.y":
      return camera?.target?.y ?? 0;
    case "target.z":
      return camera?.target?.z ?? 0;
    case "fov":
      return camera?.fov ?? fovFallback;
    case "near":
      return camera?.near ?? 0.1;
    case "far":
      return camera?.far ?? 100;
    default:
      return 0;
  }
}

function getMotionSceneObjectBaseValue(
  layer: MotionLayer,
  objectId: string,
  name: MotionSceneObjectPropertyName,
): number {
  const object =
    layer.type === "scene3d"
      ? layer.objects?.find((entry) => entry.id === objectId)
      : undefined;
  const transform = object?.transform3d;
  switch (name) {
    case "position.x":
      return transform?.position?.x ?? 0;
    case "position.y":
      return transform?.position?.y ?? 0;
    case "position.z":
      return transform?.position?.z ?? 0;
    case "rotation.x":
      return transform?.rotation?.x ?? 0;
    case "rotation.y":
      return transform?.rotation?.y ?? 0;
    case "rotation.z":
      return transform?.rotation?.z ?? 0;
    case "scale.x":
      return transform?.scale?.x ?? 1;
    case "scale.y":
      return transform?.scale?.y ?? 1;
    case "scale.z":
      return transform?.scale?.z ?? 1;
    case "opacity":
      return object?.opacity ?? 1;
    case "lid.angle":
      return object?.lidAngle ?? 0;
    default:
      return 0;
  }
}

export function getMotionLayerPropertyValue(
  layer: MotionLayer,
  property: MotionAnimatableProperty,
): number {
  if (parseMotionMaskPathKeyframeProperty(property) !== null) {
    return 0;
  }

  const puppetProperty = parseMotionPuppetKeyframeProperty(property);
  if (puppetProperty) {
    return getMotionLayerPuppetPropertyValue(
      layer,
      puppetProperty.pinId,
      puppetProperty.property,
    );
  }

  const effectProperty = parseMotionEffectKeyframeProperty(property);
  if (effectProperty) {
    return getMotionLayerEffectPropertyValue(
      layer,
      effectProperty.effectId,
      effectProperty.param,
    );
  }

  const shaderFillProperty = parseMotionShaderFillKeyframeProperty(property);
  if (shaderFillProperty) {
    return getMotionShaderFillBaseValue(
      layer,
      shaderFillProperty.surface,
      shaderFillProperty.param,
    );
  }

  const maskProperty = parseMotionMaskKeyframeProperty(property);
  if (maskProperty) {
    return getMotionLayerMaskPropertyValue(
      layer,
      maskProperty.maskId,
      maskProperty.property,
    );
  }

  const modifierProperty = parseMotionShapeModifierKeyframeProperty(property);
  if (modifierProperty) {
    return getMotionLayerShapeModifierPropertyValue(
      layer,
      modifierProperty.modifierId,
      modifierProperty.property,
    );
  }

  const sceneCameraProperty = parseMotionSceneCameraKeyframeProperty(property);
  if (sceneCameraProperty) {
    return getMotionSceneCameraBaseValue(layer, sceneCameraProperty.property);
  }

  const sceneObjectProperty = parseMotionSceneObjectKeyframeProperty(property);
  if (sceneObjectProperty) {
    return getMotionSceneObjectBaseValue(
      layer,
      sceneObjectProperty.objectId,
      sceneObjectProperty.property,
    );
  }

  switch (property) {
    case "transform.position.x":
      return layer.transform.position.x;
    case "transform.position.y":
      return layer.transform.position.y;
    case "transform.position.z":
      return layer.transform.position.z ?? 0;
    case "transform.scale.x":
      return layer.transform.scale.x;
    case "transform.scale.y":
      return layer.transform.scale.y;
    case "transform.rotation":
      return layer.transform.rotation;
    case "transform.rotation.x":
      return layer.transform.rotation3d?.x ?? 0;
    case "transform.rotation.y":
      return layer.transform.rotation3d?.y ?? 0;
    case "transform.opacity":
      return layer.transform.opacity;
    case "transform.anchor.x":
      return layer.transform.anchor.x;
    case "transform.anchor.y":
      return layer.transform.anchor.y;
    case "transform.perspective":
      return layer.transform.perspective ?? 1000;
    case "shape.width":
      return layer.type === "shape" ? layer.width : 0;
    case "shape.height":
      return layer.type === "shape" ? layer.height : 0;
    case "shape.cornerRadius":
      return layer.type === "shape" ? (layer.style.cornerRadius ?? 0) : 0;
    case "shape.fill.opacity":
      return layer.type === "shape" ? layer.style.fill.opacity : 0;
    case "shape.stroke.width":
      return layer.type === "shape" ? layer.style.stroke.width : 0;
    case "shape.stroke.opacity":
      return layer.type === "shape" ? layer.style.stroke.opacity : 0;
    case "shape.stroke.dashOffset":
      return layer.type === "shape" ? (layer.style.stroke.dashOffset ?? 0) : 0;
    case "shape.gradient.angle":
      return layer.type === "shape" && layer.style.fill.type === "gradient"
        ? (layer.style.fill.gradient?.angle ?? 0)
        : 0;
    case "composition.time":
      return layer.type === "composition" ? layer.timeOffset : 0;
    case "particle.emissionRate":
      return layer.type === "particle" ? layer.emitter.emissionRate : 0;
    case "particle.maxParticles":
      return layer.type === "particle" ? layer.emitter.maxParticles : 0;
    case "particle.lifetime":
      return layer.type === "particle" ? layer.emitter.lifetime : 0;
    case "particle.speed":
      return layer.type === "particle" ? layer.emitter.speed : 0;
    case "particle.spread":
      return layer.type === "particle" ? layer.emitter.spread : 0;
    case "particle.gravity":
      return layer.type === "particle" ? layer.emitter.gravity : 0;
    case "particle.size":
      return layer.type === "particle" ? layer.emitter.size : 0;
    case "particle.sizeRandomness":
      return layer.type === "particle" ? layer.emitter.sizeRandomness : 0;
    case "particle.opacityStart":
      return layer.type === "particle" ? layer.emitter.opacityStart : 0;
    case "particle.opacityEnd":
      return layer.type === "particle" ? layer.emitter.opacityEnd : 0;
  }
  return 0;
}

registerMotionExpressionBaseValueResolver((layer, property) =>
  isMotionAnimatableProperty(property)
    ? getMotionLayerPropertyValue(layer, property)
    : 0,
);

export function getMotionLayerPropertyValueAtTime(
  layer: MotionLayer,
  property: MotionAnimatableProperty,
  localTime: number,
  composition?: MotionComposition,
): number {
  if (parseMotionMaskPathKeyframeProperty(property) !== null) {
    return 0;
  }
  const context = composition ? { composition, layer } : undefined;
  if (property === "composition.time" && layer.type === "composition") {
    return evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property,
      localTime,
      fallback: getMotionCompositionLayerLinearTime(layer, localTime),
      duration: layer.duration,
      context,
    });
  }
  return evaluateMotionPropertyValueAtTime({
    keyframes: layer.keyframes,
    expressions: layer.expressions,
    property,
    localTime,
    fallback: getMotionLayerPropertyValue(layer, property),
    duration: layer.duration,
    context,
  });
}

export function setMotionLayerPropertyValue<T extends MotionLayer>(
  layer: T,
  property: MotionAnimatableProperty,
  value: number,
): T {
  if (parseMotionMaskPathKeyframeProperty(property) !== null) {
    return layer;
  }

  const puppetProperty = parseMotionPuppetKeyframeProperty(property);
  if (puppetProperty) {
    return setMotionLayerPuppetPropertyValue(
      layer,
      puppetProperty.pinId,
      puppetProperty.property,
      value,
    );
  }

  const effectProperty = parseMotionEffectKeyframeProperty(property);
  if (effectProperty) {
    return setMotionLayerEffectPropertyValue(
      layer,
      effectProperty.effectId,
      effectProperty.param,
      value,
    );
  }

  const shaderFillProperty = parseMotionShaderFillKeyframeProperty(property);
  if (shaderFillProperty) {
    return setMotionLayerShaderFillPropertyValue(
      layer,
      shaderFillProperty.surface,
      shaderFillProperty.param,
      value,
    );
  }

  const maskProperty = parseMotionMaskKeyframeProperty(property);
  if (maskProperty) {
    return setMotionLayerMaskPropertyValue(
      layer,
      maskProperty.maskId,
      maskProperty.property,
      value,
    );
  }

  const modifierProperty = parseMotionShapeModifierKeyframeProperty(property);
  if (modifierProperty) {
    return setMotionLayerShapeModifierPropertyValue(
      layer,
      modifierProperty.modifierId,
      modifierProperty.property,
      value,
    );
  }

  const transform = layer.transform;
  switch (property) {
    case "transform.position.x":
      return {
        ...layer,
        transform: {
          ...transform,
          position: { ...transform.position, x: value },
        },
      } as T;
    case "transform.position.y":
      return {
        ...layer,
        transform: {
          ...transform,
          position: { ...transform.position, y: value },
        },
      } as T;
    case "transform.position.z":
      return {
        ...layer,
        transform: {
          ...transform,
          position: { ...transform.position, z: value },
        },
      } as T;
    case "transform.scale.x":
      return {
        ...layer,
        transform: {
          ...transform,
          scale: { ...transform.scale, x: value },
        },
      } as T;
    case "transform.scale.y":
      return {
        ...layer,
        transform: {
          ...transform,
          scale: { ...transform.scale, y: value },
        },
      } as T;
    case "transform.rotation":
      return {
        ...layer,
        transform: { ...transform, rotation: value },
      } as T;
    case "transform.rotation.x":
      return {
        ...layer,
        transform: {
          ...transform,
          rotation3d: {
            x: value,
            y: transform.rotation3d?.y ?? 0,
            z: transform.rotation3d?.z ?? 0,
          },
        },
      } as T;
    case "transform.rotation.y":
      return {
        ...layer,
        transform: {
          ...transform,
          rotation3d: {
            x: transform.rotation3d?.x ?? 0,
            y: value,
            z: transform.rotation3d?.z ?? 0,
          },
        },
      } as T;
    case "transform.rotation.z":
      return {
        ...layer,
        transform: {
          ...transform,
          rotation3d: {
            x: transform.rotation3d?.x ?? 0,
            y: transform.rotation3d?.y ?? 0,
            z: value,
          },
        },
      } as T;
    case "transform.opacity":
      return {
        ...layer,
        transform: { ...transform, opacity: value },
      } as T;
    case "transform.anchor.x":
      return {
        ...layer,
        transform: {
          ...transform,
          anchor: { ...transform.anchor, x: value },
        },
      } as T;
    case "transform.anchor.y":
      return {
        ...layer,
        transform: {
          ...transform,
          anchor: { ...transform.anchor, y: value },
        },
      } as T;
    case "transform.perspective":
      return {
        ...layer,
        transform: { ...transform, perspective: Math.max(1, value) },
      } as T;
    case "shape.width":
      return layer.type === "shape"
        ? ({ ...layer, width: Math.max(1, value) } as T)
        : layer;
    case "shape.height":
      return layer.type === "shape"
        ? ({ ...layer, height: Math.max(1, value) } as T)
        : layer;
    case "shape.cornerRadius":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              cornerRadius: Math.max(0, value),
            },
          } as T)
        : layer;
    case "shape.fill.opacity":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              fill: {
                ...layer.style.fill,
                opacity: clamp01(value),
              },
            },
          } as T)
        : layer;
    case "shape.stroke.width":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              stroke: {
                ...layer.style.stroke,
                width: Math.max(0, value),
              },
            },
          } as T)
        : layer;
    case "shape.stroke.opacity":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              stroke: {
                ...layer.style.stroke,
                opacity: clamp01(value),
              },
            },
          } as T)
        : layer;
    case "shape.stroke.dashOffset":
      return layer.type === "shape"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              stroke: {
                ...layer.style.stroke,
                dashOffset: value,
              },
            },
          } as T)
        : layer;
    case "shape.gradient.angle":
      return layer.type === "shape" && layer.style.fill.type === "gradient"
        ? ({
            ...layer,
            style: {
              ...layer.style,
              fill: {
                ...layer.style.fill,
                gradient: {
                  ...(layer.style.fill.gradient ?? {
                    type: "linear",
                    stops: [
                      { offset: 0, color: layer.style.fill.color ?? "#14b8a6" },
                      { offset: 1, color: "#ffffff" },
                    ],
                  }),
                  angle: value,
                },
              },
            },
          } as T)
        : layer;
    case "composition.time":
      return layer.type === "composition"
        ? ({ ...layer, timeOffset: Math.max(0, value) } as T)
        : layer;
    case "particle.emissionRate":
    case "particle.maxParticles":
    case "particle.lifetime":
    case "particle.speed":
    case "particle.spread":
    case "particle.gravity":
    case "particle.size":
    case "particle.sizeRandomness":
    case "particle.opacityStart":
    case "particle.opacityEnd":
      return layer.type === "particle"
        ? ({
            ...layer,
            emitter: setMotionParticleEmitterProperty(
              layer.emitter,
              property,
              value,
            ),
          } as T)
        : layer;
  }
  return layer;
}

export function getMotionParticleEmitterAtTime(
  layer: Extract<MotionLayer, { type: "particle" }>,
  localTime: number,
): MotionParticleEmitter {
  const emitter = normalizeMotionParticleEmitter(layer.emitter);
  const value = (property: MotionParticleProperty): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes: layer.keyframes,
      expressions: layer.expressions,
      property,
      localTime,
      fallback: getMotionLayerPropertyValue(layer, property),
      duration: layer.duration,
    });

  return normalizeMotionParticleEmitter({
    ...emitter,
    emissionRate: value("particle.emissionRate"),
    maxParticles: value("particle.maxParticles"),
    lifetime: value("particle.lifetime"),
    speed: value("particle.speed"),
    spread: value("particle.spread"),
    gravity: value("particle.gravity"),
    size: value("particle.size"),
    sizeRandomness: value("particle.sizeRandomness"),
    opacityStart: value("particle.opacityStart"),
    opacityEnd: value("particle.opacityEnd"),
  });
}

export function evaluateMotionPuppetPinsAtTime<T extends MotionLayer>(
  layer: T,
  localTime: number,
): T {
  if (layer.type !== "shape" || !layer.puppetPins?.length) return layer;
  return {
    ...layer,
    puppetPins: layer.puppetPins.map((pin) =>
      normalizeMotionPuppetPin({
        ...pin,
        position: {
          ...pin.position,
          x: evaluatePuppetProperty(
            layer,
            pin,
            "position.x",
            pin.position.x,
            localTime,
          ),
          y: evaluatePuppetProperty(
            layer,
            pin,
            "position.y",
            pin.position.y,
            localTime,
          ),
        },
        radius: evaluatePuppetProperty(
          layer,
          pin,
          "radius",
          pin.radius,
          localTime,
        ),
        strength: evaluatePuppetProperty(
          layer,
          pin,
          "strength",
          pin.strength,
          localTime,
        ),
      }),
    ),
  } as T;
}

function setMotionParticleEmitterProperty(
  emitter: MotionParticleEmitter,
  property: MotionParticleProperty,
  value: number,
): MotionParticleEmitter {
  const normalized = normalizeMotionParticleEmitter(emitter);
  switch (property) {
    case "particle.emissionRate":
      return normalizeMotionParticleEmitter({ ...normalized, emissionRate: value });
    case "particle.maxParticles":
      return normalizeMotionParticleEmitter({ ...normalized, maxParticles: value });
    case "particle.lifetime":
      return normalizeMotionParticleEmitter({ ...normalized, lifetime: value });
    case "particle.speed":
      return normalizeMotionParticleEmitter({ ...normalized, speed: value });
    case "particle.spread":
      return normalizeMotionParticleEmitter({ ...normalized, spread: value });
    case "particle.gravity":
      return normalizeMotionParticleEmitter({ ...normalized, gravity: value });
    case "particle.size":
      return normalizeMotionParticleEmitter({ ...normalized, size: value });
    case "particle.sizeRandomness":
      return normalizeMotionParticleEmitter({
        ...normalized,
        sizeRandomness: value,
      });
    case "particle.opacityStart":
      return normalizeMotionParticleEmitter({ ...normalized, opacityStart: value });
    case "particle.opacityEnd":
      return normalizeMotionParticleEmitter({ ...normalized, opacityEnd: value });
  }
}

function getMotionMaskPropertyDescriptor(
  property: MotionMaskProperty,
  maskName = "Mask",
): MotionAnimatablePropertyDescriptor {
  const parsed = parseMotionMaskKeyframeProperty(property);
  const maskProperty = parsed?.property ?? "x";
  const descriptor = MOTION_MASK_PROPERTY_DESCRIPTOR_BY_NAME[maskProperty];
  return {
    ...descriptor,
    property,
    label: `${maskName} ${formatMaskPropertyName(maskProperty)}`,
  };
}

function getMotionMaskPathPropertyDescriptor(
  property: MotionMaskPathProperty,
  maskName = "Mask",
): MotionAnimatablePropertyDescriptor {
  return {
    property,
    label: `${maskName} Path`,
    family: "motion",
    group: "Mask",
    min: 0,
    max: 1,
    step: 1,
    defaultValue: 0,
  };
}

function getMotionPuppetPropertyDescriptor(
  property: MotionPuppetProperty,
  pinName = "Pin",
): MotionAnimatablePropertyDescriptor {
  const parsed = parseMotionPuppetKeyframeProperty(property);
  const puppetProperty = parsed?.property ?? "position.x";
  const descriptor = MOTION_PUPPET_PROPERTY_DESCRIPTOR_BY_NAME[puppetProperty];
  return {
    ...descriptor,
    property,
    label: `${pinName} ${formatPuppetPropertyName(puppetProperty)}`,
  };
}

function getMotionEffectPropertyDescriptor(
  property: MotionEffectProperty,
  effectName = "Effect",
  effect?: MotionEffect,
): MotionAnimatablePropertyDescriptor {
  const parsed = parseMotionEffectKeyframeProperty(property);
  const param = parsed?.param ?? "radius";
  const descriptor = parsed
    ? effect
      ? getMotionEffectParameterDescriptor(effect, parsed.param)
      : getMotionEffectDescriptorByParam(parsed.param)
    : undefined;
  return {
    property,
    family: "motion",
    group: "Effects",
    label: `${effectName} ${descriptor?.label ?? formatEffectParamName(param)}`,
    min: descriptor?.min ?? 0,
    max: descriptor?.max ?? 1,
    step: descriptor?.step ?? 0.01,
    unit: descriptor?.unit,
    defaultValue: 0,
  };
}

function getMotionShaderFillPropertyDescriptor(
  property: MotionShaderFillProperty,
  def: MotionShaderDef,
): MotionAnimatablePropertyDescriptor {
  const parsed = parseMotionShaderFillKeyframeProperty(property);
  const paramDef = parsed
    ? def.params.find((entry) => entry.name === parsed.param)
    : undefined;
  return {
    property,
    family: "motion",
    group: parsed?.surface === "text" ? "Text" : "Shape",
    label: paramDef?.label ?? parsed?.param ?? def.name,
    min: paramDef?.min ?? 0,
    max: paramDef?.max ?? 1,
    step: paramDef?.step ?? 0.01,
    defaultValue:
      typeof paramDef?.default === "number" && Number.isFinite(paramDef.default)
        ? paramDef.default
        : 0,
  };
}

function getMotionShapeModifierPropertyDescriptor(
  property: MotionShapeModifierProperty,
  modifierName = "Modifier",
  layer?: MotionLayer,
): MotionAnimatablePropertyDescriptor {
  const parsed = parseMotionShapeModifierKeyframeProperty(property);
  const modifier =
    parsed && layer?.type === "shape"
      ? layer.modifiers?.find((candidate) => candidate.id === parsed.modifierId)
      : undefined;
  const modifierProperty = parsed?.property ?? "start";
  const descriptor =
    modifier && parsed
      ? getShapeModifierParameterDescriptor(modifier, parsed.property)
      : undefined;
  return {
    property,
    family: "motion",
    group: "Shape Modifiers",
    label: `${modifierName} ${descriptor?.label ?? formatShapeModifierPropertyName(modifierProperty)}`,
    min: descriptor?.min ?? 0,
    max: descriptor?.max ?? 1,
    step: descriptor?.step ?? 0.01,
    unit: descriptor?.unit,
    defaultValue: descriptor?.defaultValue ?? 0,
    displayScale: descriptor?.unit === "%" && modifierProperty === "opacity" ? 100 : undefined,
  };
}

function getMotionLayerShapeModifierPropertyValue(
  layer: MotionLayer,
  modifierId: string,
  property: MotionShapeModifierPropertyName,
): number {
  if (layer.type !== "shape") return 0;
  const modifier = layer.modifiers?.find(
    (candidate) => candidate.id === modifierId,
  );
  return modifier ? getMotionShapeModifierPropertyValue(modifier, property) : 0;
}

function setMotionLayerShapeModifierPropertyValue<T extends MotionLayer>(
  layer: T,
  modifierId: string,
  property: MotionShapeModifierPropertyName,
  value: number,
): T {
  if (
    layer.type !== "shape" ||
    !layer.modifiers?.some((modifier) => modifier.id === modifierId)
  ) {
    return layer;
  }
  return {
    ...layer,
    modifiers: layer.modifiers.map((modifier) =>
      modifier.id === modifierId
        ? setMotionShapeModifierPropertyValue(modifier, property, value)
        : modifier,
    ),
  } as T;
}

function getMotionLayerEffectPropertyValue(
  layer: MotionLayer,
  effectId: string,
  param: MotionEffectParameterName,
): number {
  const effect = layer.effects?.find((candidate) => candidate.id === effectId);
  return effect ? getMotionEffectParameterValue(effect, param) : 0;
}

function setMotionLayerEffectPropertyValue<T extends MotionLayer>(
  layer: T,
  effectId: string,
  param: MotionEffectParameterName,
  value: number,
): T {
  const effects = layer.effects ?? [];
  if (!effects.some((effect) => effect.id === effectId)) return layer;
  return {
    ...layer,
    effects: effects.map((effect) =>
      effect.id === effectId
        ? setMotionEffectParameterValue(effect, param, value)
        : effect,
    ),
  } as T;
}

function setMotionLayerShaderFillPropertyValue<T extends MotionLayer>(
  layer: T,
  surface: "shape" | "text",
  param: string,
  value: number,
): T {
  const fill = getMotionLayerShaderFill(layer, surface);
  if (!fill) return layer;
  const def = getMotionShaderDef(fill.shaderId);
  if (!def) return layer;
  const paramDef = def.params.find((entry) => entry.name === param);
  if (!paramDef) return layer;
  const clamped = clamp(value, paramDef.min, paramDef.max);
  if (surface === "shape") {
    if (layer.type !== "shape" || layer.style.fill.type !== "shader") {
      return layer;
    }
    const shader = layer.style.fill.shader;
    if (!shader) return layer;
    return {
      ...layer,
      style: {
        ...layer.style,
        fill: {
          ...layer.style.fill,
          shader: {
            ...shader,
            params: { ...shader.params, [param]: clamped },
          },
        },
      },
    } as T;
  }
  if (layer.type !== "text" || !layer.style.fillShader) return layer;
  return {
    ...layer,
    style: {
      ...layer.style,
      fillShader: {
        ...layer.style.fillShader,
        params: { ...layer.style.fillShader.params, [param]: clamped },
      },
    },
  } as T;
}

function getMotionEffectDescriptorByParam(
  param: MotionEffectParameterName,
) {
  for (const effectType of [
    "blur",
    "drop-shadow",
    "glow",
    "color-adjust",
  ] as const) {
    const effect = { type: effectType } as Parameters<
      typeof getMotionEffectParameterDescriptor
    >[0];
    const descriptor = getMotionEffectParameterDescriptor(effect, param);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function evaluatePuppetProperty(
  layer: MotionShapeLayer,
  pin: MotionPuppetPin,
  property: MotionPuppetPropertyName,
  fallback: number,
  localTime: number,
): number {
  return evaluateMotionPropertyValueAtTime({
    keyframes: layer.keyframes,
    expressions: layer.expressions,
    property: getMotionPuppetPinKeyframeProperty(pin.id, property),
    localTime,
    fallback,
    duration: layer.duration,
  });
}

function getMotionLayerPuppetPropertyValue(
  layer: MotionLayer,
  pinId: string,
  property: MotionPuppetPropertyName,
): number {
  if (layer.type !== "shape") {
    return MOTION_PUPPET_PROPERTY_DESCRIPTOR_BY_NAME[property].defaultValue;
  }
  const pin = layer.puppetPins?.find((candidate) => candidate.id === pinId);
  if (!pin) {
    return MOTION_PUPPET_PROPERTY_DESCRIPTOR_BY_NAME[property].defaultValue;
  }
  switch (property) {
    case "position.x":
      return pin.position.x;
    case "position.y":
      return pin.position.y;
    case "radius":
      return pin.radius;
    case "strength":
      return pin.strength;
  }
}

function setMotionLayerPuppetPropertyValue<T extends MotionLayer>(
  layer: T,
  pinId: string,
  property: MotionPuppetPropertyName,
  value: number,
): T {
  if (
    layer.type !== "shape" ||
    !layer.puppetPins?.some((pin) => pin.id === pinId)
  ) {
    return layer;
  }
  return {
    ...layer,
    puppetPins: layer.puppetPins.map((pin) => {
      if (pin.id !== pinId) return pin;
      switch (property) {
        case "position.x":
          return normalizeMotionPuppetPin({
            ...pin,
            position: { ...pin.position, x: value },
          });
        case "position.y":
          return normalizeMotionPuppetPin({
            ...pin,
            position: { ...pin.position, y: value },
          });
        case "radius":
          return normalizeMotionPuppetPin({ ...pin, radius: value });
        case "strength":
          return normalizeMotionPuppetPin({ ...pin, strength: value });
      }
    }),
  } as T;
}

function getMotionLayerMaskPropertyValue(
  layer: MotionLayer,
  maskId: string,
  property: MotionMaskPropertyName,
): number {
  const mask = layer.masks?.find((candidate) => candidate.id === maskId);
  if (!mask) return MOTION_MASK_PROPERTY_DESCRIPTOR_BY_NAME[property].defaultValue;
  switch (property) {
    case "x":
      return mask.x;
    case "y":
      return mask.y;
    case "width":
      return mask.width;
    case "height":
      return mask.height;
    case "rotation":
      return mask.rotation;
    case "expansion":
      return mask.expansion ?? 0;
    case "feather":
      return mask.feather ?? 0;
    case "opacity":
      return mask.opacity ?? 1;
  }
}

function setMotionLayerMaskPropertyValue<T extends MotionLayer>(
  layer: T,
  maskId: string,
  property: MotionMaskPropertyName,
  value: number,
): T {
  const masks = layer.masks ?? [];
  if (!masks.some((mask) => mask.id === maskId)) return layer;
  return {
    ...layer,
    masks: masks.map((mask) => {
      if (mask.id !== maskId) return mask;
      switch (property) {
        case "x":
          return { ...mask, x: clamp(value, -4, 4) };
        case "y":
          return { ...mask, y: clamp(value, -4, 4) };
        case "width":
          return { ...mask, width: clamp(value, 0, 8) };
        case "height":
          return { ...mask, height: clamp(value, 0, 8) };
        case "rotation":
          return { ...mask, rotation: normalizeRotation(value) };
        case "expansion":
          return { ...mask, expansion: clamp(value, -100_000, 100_000) };
        case "feather":
          return { ...mask, feather: clamp(value, 0, 100_000) };
        case "opacity":
          return { ...mask, opacity: clamp01(value) };
      }
    }),
  } as T;
}

export function getMotionCompositionLayerLinearTime(
  layer: Extract<MotionLayer, { type: "composition" }>,
  layerLocalTime: number,
): number {
  const localTime = Number.isFinite(layerLocalTime) ? layerLocalTime : 0;
  const playbackRate = Number.isFinite(layer.playbackRate)
    ? layer.playbackRate
    : 1;
  return Math.max(0, layer.timeOffset + Math.max(0, localTime) * playbackRate);
}

export function getMotionLayerPropertyKeyframes(
  layer: MotionLayer,
  property: string,
): Keyframe[] {
  return layer.keyframes
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.time - b.time);
}

export function findMotionLayerKeyframeAtTime(
  layer: MotionLayer,
  property: string,
  time: number,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): Keyframe | undefined {
  return layer.keyframes.find(
    (keyframe) =>
      keyframe.property === property &&
      Math.abs(keyframe.time - time) <= snapTolerance,
  );
}

export function upsertMotionLayerKeyframe<T extends MotionLayer>(
  layer: T,
  property: string,
  time: number,
  options: UpsertMotionKeyframeOptions = {},
): T {
  const keyframeTime = normalizeKeyframeTime(time);
  const snapTolerance = options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  const existing = findMotionLayerKeyframeAtTime(
    layer,
    property,
    keyframeTime,
    snapTolerance,
  );
  const value =
    options.value ??
    (typeof existing?.value === "number"
      ? existing.value
      : isMotionAnimatableProperty(property)
        ? getMotionLayerPropertyValue(layer, property)
        : 0);
  const easing = options.easing ?? existing?.easing ?? "ease";
  const bezierHandles = options.bezierHandles ?? existing?.bezierHandles;
  const nextKeyframe: Keyframe = {
    id: existing?.id ?? options.idFactory?.() ?? createKeyframeId(),
    time: keyframeTime,
    property,
    value,
    easing,
    ...(bezierHandles ? { bezierHandles } : {}),
  };

  const keyframes = existing
    ? layer.keyframes.map((keyframe) =>
        keyframe.id === existing.id ? nextKeyframe : keyframe,
      )
    : [...layer.keyframes, nextKeyframe];

  return {
    ...layer,
    keyframes: applyRovingRedistribution(keyframes, property),
  } as T;
}

export function removeMotionLayerKeyframe<T extends MotionLayer>(
  layer: T,
  keyframeId: string,
): T {
  const removed = layer.keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (!removed) return layer;
  const keyframes = layer.keyframes.filter(
    (keyframe) => keyframe.id !== keyframeId,
  );
  return {
    ...layer,
    keyframes: applyRovingRedistribution(keyframes, removed.property),
  } as T;
}

export function moveMotionLayerKeyframe<T extends MotionLayer>(
  layer: T,
  keyframeId: string,
  time: number,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): T {
  const target = layer.keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (!target) return layer;

  const keyframeTime = Math.min(
    Math.max(0, layer.duration),
    normalizeKeyframeTime(time),
  );
  const existingAtTime = layer.keyframes.find(
    (keyframe) =>
      keyframe.id !== keyframeId &&
      keyframe.property === target.property &&
      Math.abs(keyframe.time - keyframeTime) <= snapTolerance,
  );

  const nextKeyframe: Keyframe = {
    ...target,
    id: existingAtTime?.id ?? target.id,
    time: keyframeTime,
  };

  const keyframes = existingAtTime
    ? layer.keyframes
        .filter((keyframe) => keyframe.id !== target.id)
        .map((keyframe) =>
          keyframe.id === existingAtTime.id ? nextKeyframe : keyframe,
        )
    : layer.keyframes.map((keyframe) =>
        keyframe.id === keyframeId ? nextKeyframe : keyframe,
      );

  return {
    ...layer,
    keyframes: applyRovingRedistribution(keyframes, target.property),
  } as T;
}

export function removeMotionLayerPropertyKeyframes<T extends MotionLayer>(
  layer: T,
  property: string,
): T {
  return {
    ...layer,
    keyframes: layer.keyframes.filter(
      (keyframe) => keyframe.property !== property,
    ),
  } as T;
}

export function copyMotionPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
): MotionKeyframeClipboard | null {
  const propertyKeyframes = getPropertyKeyframes(keyframes, property);
  if (propertyKeyframes.length === 0) return null;

  const sourceStartTime = propertyKeyframes[0].time;
  const sourceEndTime = propertyKeyframes[propertyKeyframes.length - 1].time;

  return {
    sourceProperty: property,
    sourceStartTime,
    span: normalizeKeyframeTime(sourceEndTime - sourceStartTime),
    entries: propertyKeyframes.map((keyframe) => ({
      timeOffset: normalizeKeyframeTime(keyframe.time - sourceStartTime),
      value: keyframe.value,
      easing: keyframe.easing,
    })),
  };
}

export function pasteMotionPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
  clipboard: MotionKeyframeClipboard,
  startTime: number,
  options: PasteMotionKeyframesOptions = {},
): Keyframe[] {
  if (clipboard.entries.length === 0) return sortMotionKeyframes(keyframes);

  const pasteStartTime = clampKeyframeTime(startTime, options.duration);
  const pasted = clipboard.entries.map((entry, index) => ({
    id: options.idFactory?.(entry, index) ?? createKeyframeId(),
    property,
    time: clampKeyframeTime(pasteStartTime + entry.timeOffset, options.duration),
    value: entry.value,
    easing: entry.easing,
  }));

  return applyRovingRedistribution(
    mergeMotionPropertyKeyframes(keyframes, property, pasted, {
      replaceExistingProperty: false,
    }),
    property,
  );
}

export function pasteMotionLayerPropertyKeyframes<T extends MotionLayer>(
  layer: T,
  property: string,
  clipboard: MotionKeyframeClipboard,
  startTime: number,
  options: PasteMotionKeyframesOptions = {},
): T {
  return {
    ...layer,
    keyframes: pasteMotionPropertyKeyframes(
      layer.keyframes,
      property,
      clipboard,
      startTime,
      { duration: layer.duration, ...options },
    ),
  } as T;
}

export function duplicateMotionPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
  offset: number,
  options: DuplicateMotionKeyframesOptions = {},
): Keyframe[] {
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  const propertyKeyframes = keyframes.filter(
    (keyframe) => keyframe.property === property,
  );
  if (propertyKeyframes.length === 0 || Math.abs(safeOffset) <= 1 / 10000) {
    return sortMotionKeyframes(keyframes);
  }

  const copies = propertyKeyframes.map((keyframe, index) => ({
    ...keyframe,
    id: options.idFactory?.(keyframe, index) ?? createKeyframeId(),
    time: clampKeyframeTime(keyframe.time + safeOffset, options.duration),
  }));

  return applyRovingRedistribution(
    mergeMotionPropertyKeyframes(keyframes, property, copies, {
      replaceExistingProperty: false,
    }),
    property,
  );
}

export function duplicateMotionLayerPropertyKeyframes<T extends MotionLayer>(
  layer: T,
  property: string,
  offset: number,
  options: DuplicateMotionKeyframesOptions = {},
): T {
  return {
    ...layer,
    keyframes: duplicateMotionPropertyKeyframes(
      layer.keyframes,
      property,
      offset,
      { duration: layer.duration, ...options },
    ),
  } as T;
}

export function reverseMotionPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
): Keyframe[] {
  const propertyKeyframes = getPropertyKeyframes(keyframes, property);
  if (propertyKeyframes.length < 2) return sortMotionKeyframes(keyframes);

  const firstTime = propertyKeyframes[0].time;
  const lastTime = propertyKeyframes[propertyKeyframes.length - 1].time;
  const reversed = propertyKeyframes.map((keyframe) => ({
    ...keyframe,
    time: normalizeKeyframeTime(lastTime - (keyframe.time - firstTime)),
  }));

  return applyRovingRedistribution(
    mergeMotionPropertyKeyframes(keyframes, property, reversed),
    property,
  );
}

export function reverseMotionLayerPropertyKeyframes<T extends MotionLayer>(
  layer: T,
  property: string,
): T {
  return {
    ...layer,
    keyframes: reverseMotionPropertyKeyframes(layer.keyframes, property),
  } as T;
}

export function scaleMotionPropertyKeyframeTimes(
  keyframes: readonly Keyframe[],
  property: string,
  scale: number,
  options: ScaleMotionKeyframesOptions = {},
): Keyframe[] {
  const propertyKeyframes = getPropertyKeyframes(keyframes, property);
  if (propertyKeyframes.length < 2) return sortMotionKeyframes(keyframes);

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const anchorTime = Number.isFinite(options.anchorTime)
    ? options.anchorTime!
    : propertyKeyframes[0].time;
  const scaled = propertyKeyframes.map((keyframe) => ({
    ...keyframe,
    time: clampKeyframeTime(
      anchorTime + (keyframe.time - anchorTime) * safeScale,
      options.duration,
    ),
  }));

  return applyRovingRedistribution(
    mergeMotionPropertyKeyframes(keyframes, property, scaled),
    property,
  );
}

export function scaleMotionLayerPropertyKeyframeTimes<T extends MotionLayer>(
  layer: T,
  property: string,
  scale: number,
  options: ScaleMotionKeyframesOptions = {},
): T {
  return {
    ...layer,
    keyframes: scaleMotionPropertyKeyframeTimes(
      layer.keyframes,
      property,
      scale,
      { duration: layer.duration, ...options },
    ),
  } as T;
}

const ROVING_ZERO_DELTA_EPSILON = 1e-6;

function toNumericKeyframeValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function redistributeRovingKeyframeTimes(
  keyframes: readonly Keyframe[],
): Keyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length < 3) {
    return sorted.map((keyframe) => stripEndpointRoving(keyframe));
  }

  const result = sorted.map((keyframe, index) =>
    index === 0 || index === sorted.length - 1
      ? stripEndpointRoving(keyframe)
      : keyframe,
  );

  let runStart = 0;
  while (runStart < result.length - 1) {
    if (!result[runStart + 1]?.roving) {
      runStart += 1;
      continue;
    }
    let runEnd = runStart + 1;
    while (runEnd < result.length - 1 && result[runEnd]?.roving) {
      runEnd += 1;
    }
    redistributeRun(result, runStart, runEnd);
    runStart = runEnd;
  }

  return result;
}

function redistributeRun(
  keyframes: Keyframe[],
  anchorStart: number,
  anchorEnd: number,
): void {
  const startTime = keyframes[anchorStart].time;
  const endTime = keyframes[anchorEnd].time;
  const span = endTime - startTime;
  const count = anchorEnd - anchorStart;
  if (count < 2) return;

  const cumulative: number[] = [0];
  for (let index = anchorStart; index < anchorEnd; index += 1) {
    const delta = Math.abs(
      toNumericKeyframeValue(keyframes[index + 1].value) -
        toNumericKeyframeValue(keyframes[index].value),
    );
    cumulative.push(cumulative[cumulative.length - 1] + delta);
  }

  const total = cumulative[cumulative.length - 1];
  for (let offset = 1; offset < count; offset += 1) {
    const fraction =
      total < ROVING_ZERO_DELTA_EPSILON
        ? offset / count
        : cumulative[offset] / total;
    const nextTime = normalizeKeyframeTime(startTime + span * fraction);
    keyframes[anchorStart + offset] = {
      ...keyframes[anchorStart + offset],
      time: nextTime,
    };
  }
}

function stripEndpointRoving(keyframe: Keyframe): Keyframe {
  if (!keyframe.roving) return keyframe;
  const { roving: _roving, ...rest } = keyframe;
  return rest;
}

function applyRovingRedistribution(
  keyframes: readonly Keyframe[],
  property: string,
): Keyframe[] {
  const propertyKeyframes = keyframes.filter(
    (keyframe) => keyframe.property === property,
  );
  if (propertyKeyframes.length < 2) {
    return sortMotionKeyframes(
      keyframes.map((keyframe) =>
        keyframe.property === property
          ? stripEndpointRoving(keyframe)
          : keyframe,
      ),
    );
  }
  const redistributed = redistributeRovingKeyframeTimes(propertyKeyframes);
  const byId = new Map(redistributed.map((keyframe) => [keyframe.id, keyframe]));
  return sortMotionKeyframes(
    keyframes.map((keyframe) =>
      keyframe.property === property
        ? (byId.get(keyframe.id) ?? keyframe)
        : keyframe,
    ),
  );
}

export function setMotionKeyframeRoving<T extends MotionLayer>(
  layer: T,
  property: string,
  keyframeId: string,
  roving: boolean,
): T {
  const propertyKeyframes = getPropertyKeyframes(layer.keyframes, property);
  const index = propertyKeyframes.findIndex(
    (keyframe) => keyframe.id === keyframeId,
  );
  if (index < 0) return layer;
  if (index === 0 || index === propertyKeyframes.length - 1) return layer;

  const target = propertyKeyframes[index];
  const nextRoving = roving === true;
  if ((target.roving ?? false) === nextRoving) return layer;

  const updated = layer.keyframes.map((keyframe) => {
    if (keyframe.id !== keyframeId) return keyframe;
    if (nextRoving) return { ...keyframe, roving: true };
    const { roving: _roving, ...rest } = keyframe;
    return rest;
  });

  return {
    ...layer,
    keyframes: applyRovingRedistribution(updated, property),
  } as T;
}

export function sortMotionKeyframes(
  keyframes: readonly Keyframe[],
): Keyframe[] {
  return [...keyframes].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.property.localeCompare(b.property);
  });
}

function getPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
): Keyframe[] {
  return keyframes
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.time - b.time);
}

function mergeMotionPropertyKeyframes(
  keyframes: readonly Keyframe[],
  property: string,
  propertyKeyframes: readonly Keyframe[],
  options: { readonly replaceExistingProperty?: boolean } = {},
): Keyframe[] {
  const merged = new Map<string, Keyframe>();
  const baseKeyframes = options.replaceExistingProperty === false
    ? keyframes
    : keyframes.filter((keyframe) => keyframe.property !== property);
  for (const keyframe of baseKeyframes) {
    merged.set(
      `${keyframe.property}:${normalizeKeyframeTime(keyframe.time)}`,
      {
        ...keyframe,
        time: normalizeKeyframeTime(keyframe.time),
      },
    );
  }

  for (const keyframe of propertyKeyframes) {
    merged.set(
      `${keyframe.property}:${normalizeKeyframeTime(keyframe.time)}`,
      {
        ...keyframe,
        time: normalizeKeyframeTime(keyframe.time),
      },
    );
  }

  return sortMotionKeyframes([...merged.values()]);
}

function clampKeyframeTime(time: number, duration?: number): number {
  const normalized = normalizeKeyframeTime(time);
  if (duration === undefined || !Number.isFinite(duration)) {
    return normalized;
  }
  return Math.min(Math.max(0, duration), normalized);
}

function normalizeKeyframeTime(time: number): number {
  if (!Number.isFinite(time)) {
    return 0;
  }
  return Math.max(0, Number(time.toFixed(4)));
}

function formatMaskPropertyName(property: MotionMaskPropertyName): string {
  switch (property) {
    case "x":
      return "X";
    case "y":
      return "Y";
    case "width":
      return "Width";
    case "height":
      return "Height";
    case "rotation":
      return "Rotation";
    case "expansion":
      return "Expansion";
    case "feather":
      return "Feather";
    case "opacity":
      return "Opacity";
  }
}

function formatPuppetPropertyName(property: MotionPuppetPropertyName): string {
  switch (property) {
    case "position.x":
      return "Position X";
    case "position.y":
      return "Position Y";
    case "radius":
      return "Radius";
    case "strength":
      return "Strength";
  }
}

function formatEffectParamName(param: MotionEffectParameterName): string {
  switch (param) {
    case "offsetX":
      return "Offset X";
    case "offsetY":
      return "Offset Y";
    case "radius":
      return "Radius";
    case "opacity":
      return "Opacity";
    case "blur":
      return "Blur";
    case "intensity":
      return "Intensity";
    case "brightness":
      return "Brightness";
    case "contrast":
      return "Contrast";
    case "saturation":
      return "Saturation";
    case "hue":
      return "Hue";
    case "amount":
      return "Amount";
    case "inputBlack":
      return "Input Black";
    case "inputWhite":
      return "Input White";
    case "gamma":
      return "Gamma";
    case "outputBlack":
      return "Output Black";
    case "outputWhite":
      return "Output White";
    case "levels":
      return "Levels";
    case "angle":
      return "Angle";
    case "distance":
      return "Distance";
    case "seed":
      return "Seed";
    case "centerX":
      return "Center X";
    case "centerY":
      return "Center Y";
    case "scale":
      return "Scale";
    default:
      return formatGenericParamName(param);
  }
}

function formatGenericParamName(param: string): string {
  if (param.length === 0) return "Param";
  const spaced = param
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (spaced.length === 0) return "Param";
  return spaced
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatShapeModifierPropertyName(
  property: MotionShapeModifierPropertyName,
): string {
  switch (property) {
    case "start":
      return "Start";
    case "end":
      return "End";
    case "offset":
      return "Offset";
    case "copies":
      return "Copies";
    case "position.x":
      return "Position X";
    case "position.y":
      return "Position Y";
    case "scale.x":
      return "Scale X";
    case "scale.y":
      return "Scale Y";
    case "rotation":
      return "Rotation";
    case "opacity":
      return "Opacity";
    case "size":
      return "Size";
    case "ridgesPerSegment":
      return "Ridges";
    case "radius":
      return "Radius";
    case "segments":
      return "Samples";
    case "detail":
      return "Detail";
    case "speed":
      return "Speed";
    case "seed":
      return "Seed";
    case "amount":
      return "Amount";
    case "angle":
      return "Angle";
  }
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
