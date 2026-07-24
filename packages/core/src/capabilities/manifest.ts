import { BLEND_MODES } from "../video/types";
import {
  VIDEO_FILTER_TYPES,
  TRANSITION_TYPES,
  AUDIO_EFFECT_TYPES,
  EFFECT_DEFINITIONS,
} from "../types/effects";
import type { EffectDefinition } from "../types/effects";
import { SHAPE_TYPES } from "../graphics/types";
import { EASING_TYPES } from "../types/timeline";
import { FILTER_PRESETS } from "../video/filter-presets";
import { SPEED_MIN, SPEED_MAX } from "../video/speed-engine";
import { SPEED_CURVE_PRESETS } from "../video/speed-presets";
import { TEXT_ANIMATION_PRESETS } from "../text/text-animation-presets";
import { MOTION_PRESETS } from "../motion/motion-presets";
import { MOTION_ANIMATABLE_PROPERTIES } from "../motion/motion-keyframes";
import { MOTION_TEXT_ANIMATOR_PRESETS } from "../motion/motion-text-animators";
import { MOTION_PARTICLE_PRESETS } from "../motion/motion-particle-presets";
import { MOTION_EXPRESSION_PRESETS } from "../motion/motion-expressions";
import { MOTION_ANIMATION_PRESETS } from "../motion/motion-animation-presets";
import {
  MOTION_UI_COMPONENT_TYPES,
  MOTION_UI_LAYOUT_MODES,
} from "../motion/motion-ui-builder";
import { MOTION_SHAPE_MODIFIER_TYPES } from "../motion/types";
import type {
  MotionEffectType,
  MotionMaskShape,
  MotionMaskMode,
  MotionTrackMatteType,
  MotionShapeModifierType,
  MotionLightType,
  MotionVariableBindingTarget,
} from "../motion/types";

export interface NumericRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  readonly unit?: string;
}

export interface PresetSummary {
  readonly id: string;
  readonly name: string;
  readonly category?: string;
}

export interface MotionAnimatablePropertySummary {
  readonly property: string;
  readonly label: string;
  readonly group: string;
}

export interface MotionCapabilities {
  readonly layerTypes: readonly string[];
  readonly presets: readonly PresetSummary[];
  readonly presetCategories: readonly string[];
  readonly animatableProperties: readonly MotionAnimatablePropertySummary[];
  readonly easings: readonly string[];
  readonly blendModes: readonly string[];
  readonly effectTypes: readonly MotionEffectType[];
  readonly maskShapes: readonly MotionMaskShape[];
  readonly maskModes: readonly MotionMaskMode[];
  readonly trackMatteTypes: readonly MotionTrackMatteType[];
  readonly expressionTypes: readonly string[];
  readonly expressionPresets: readonly PresetSummary[];
  readonly shapeModifierTypes: readonly MotionShapeModifierType[];
  readonly textAnimatorPresets: readonly PresetSummary[];
  readonly particlePresets: readonly PresetSummary[];
  readonly lightTypes: readonly MotionLightType[];
  readonly variableTypes: readonly string[];
  readonly variableBindingTargets: readonly MotionVariableBindingTarget[];
  readonly shapeTypes: readonly string[];
  readonly animationPresets: readonly PresetSummary[];
  readonly uiComponentTypes: readonly string[];
  readonly layoutModes: readonly string[];
  readonly fontFamilies: readonly string[];
  readonly fontImport: boolean;
  readonly shapeStyleFeatures: readonly string[];
  readonly textStyleFeatures: readonly string[];
}

export interface CreationCapabilities {
  readonly assetKinds: readonly string[];
  readonly recipeNodeTypes: readonly string[];
  readonly materialModels: readonly string[];
  readonly cacheKinds: readonly string[];
  readonly cacheStatuses: readonly string[];
  readonly operationTypes: readonly string[];
  readonly renderBindingKinds: readonly string[];
  readonly sceneObjectChannels: readonly string[];
  readonly environmentKinds: readonly string[];
  readonly lightTypes: readonly string[];
}

export interface CapabilityManifest {
  readonly blendModes: readonly string[];
  readonly videoFilterTypes: readonly string[];
  readonly audioEffectTypes: readonly string[];
  readonly transitionTypes: readonly string[];
  readonly easings: readonly string[];
  readonly shapeTypes: readonly string[];
  readonly filterPresets: readonly PresetSummary[];
  readonly textAnimationPresets: readonly PresetSummary[];
  readonly speed: {
    readonly range: NumericRange;
    readonly presets: readonly PresetSummary[];
  };
  readonly colorGrading: Readonly<Record<string, NumericRange>>;
  readonly effects: readonly EffectDefinition[];
  readonly motion: MotionCapabilities;
  readonly creation: CreationCapabilities;
}

const MOTION_LAYER_TYPES: readonly string[] = [
  "text",
  "shape",
  "image",
  "group",
  "null",
  "composition",
  "adjustment",
  "particle",
  "scene3d",
];

const MOTION_EFFECT_TYPES: readonly MotionEffectType[] = [
  "blur",
  "drop-shadow",
  "glow",
  "color-adjust",
  "invert",
  "grayscale",
  "sepia",
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
  "backdrop-blur",
  "shader",
  "slider-control",
  "checkbox-control",
  "angle-control",
];

const MOTION_EXPRESSION_TYPES: readonly string[] = [
  "sine",
  "wiggle",
  "drift",
  "spring",
  "loop",
  "ping-pong",
  "random",
  "posterize",
  "expression",
];

const MOTION_FONT_FAMILIES: readonly string[] = [
  "Inter",
  "Roboto",
  "Montserrat",
  "Poppins",
  "Open Sans",
  "Lato",
  "Playfair Display",
  "Oswald",
  "Raleway",
  "Source Sans Pro",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "Space Grotesk",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Courier New",
];

const MOTION_VARIABLE_BINDING_TARGETS: readonly MotionVariableBindingTarget[] = [
  "layer.visible",
  "transform.opacity",
  "text.content",
  "text.color",
  "shape.fill.color",
  "shape.stroke.color",
  "shape.width",
  "shape.height",
  "image.assetId",
];

const MOTION_CAPABILITIES: MotionCapabilities = {
  layerTypes: MOTION_LAYER_TYPES,
  presets: MOTION_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    category: preset.category,
  })),
  presetCategories: [...new Set(MOTION_PRESETS.map((preset) => preset.category))],
  animatableProperties: MOTION_ANIMATABLE_PROPERTIES.map((descriptor) => ({
    property: descriptor.property,
    label: descriptor.label,
    group: descriptor.group,
  })),
  easings: EASING_TYPES,
  blendModes: BLEND_MODES,
  effectTypes: MOTION_EFFECT_TYPES,
  maskShapes: ["rectangle", "ellipse", "polygon", "path"],
  maskModes: ["add", "subtract"],
  trackMatteTypes: ["alpha", "alpha-inverted", "luma", "luma-inverted"],
  expressionTypes: MOTION_EXPRESSION_TYPES,
  expressionPresets: MOTION_EXPRESSION_PRESETS.map((preset) => ({
    id: preset.type,
    name: preset.name,
  })),
  shapeModifierTypes: MOTION_SHAPE_MODIFIER_TYPES,
  textAnimatorPresets: MOTION_TEXT_ANIMATOR_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
  })),
  particlePresets: MOTION_PARTICLE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
  })),
  lightTypes: ["ambient", "point", "directional"],
  variableTypes: ["text", "number", "color", "boolean", "media"],
  variableBindingTargets: MOTION_VARIABLE_BINDING_TARGETS,
  shapeTypes: SHAPE_TYPES,
  animationPresets: MOTION_ANIMATION_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    category: preset.category,
  })),
  uiComponentTypes: MOTION_UI_COMPONENT_TYPES,
  layoutModes: MOTION_UI_LAYOUT_MODES,
  fontFamilies: MOTION_FONT_FAMILIES,
  fontImport: true,
  shapeStyleFeatures: [
    "per-corner-radius",
    "conic-gradient",
    "gradient-center",
    "gradient-stop-opacity",
    "shadow-spread",
    "shadow-inset",
    "layered-shadows",
    "gradient-stroke",
  ],
  textStyleFeatures: [
    "wrap-max-width",
    "vertical-align",
    "gradient-fill",
    "text-shadow",
    "background-pill",
  ],
};

const COLOR_GRADING_RANGES: Readonly<Record<string, NumericRange>> = {
  temperature: { min: -100, max: 100, step: 1, default: 0 },
  tint: { min: -100, max: 100, step: 1, default: 0 },
  "hsl.hue": { min: -180, max: 180, step: 1, default: 0, unit: "deg" },
  "hsl.saturation": { min: -100, max: 100, step: 1, default: 0 },
  "hsl.luminance": { min: -100, max: 100, step: 1, default: 0 },
  "lut.intensity": { min: 0, max: 1, step: 0.01, default: 1 },
};

const CREATION_CAPABILITIES: CreationCapabilities = {
  assetKinds: ["product", "character", "environment", "prop", "ui", "material", "custom"],
  recipeNodeTypes: [
    "primitive",
    "curve",
    "sdf",
    "boolean",
    "bevel",
    "subdivision",
    "array",
    "scatter",
    "deform",
    "cloth",
    "skeleton",
    "ik-control",
    "material",
    "uv",
    "decal",
    "bake",
    "product-part",
    "cache",
  ],
  materialModels: ["pbr", "screen", "glass", "metal", "plastic", "fabric", "emissive", "procedural"],
  cacheKinds: [
    "preview-mesh",
    "final-mesh",
    "collision-mesh",
    "texture-atlas",
    "animation",
    "thumbnail",
    "render-preview",
  ],
  cacheStatuses: ["missing", "dirty", "ready", "failed"],
  operationTypes: [
    "asset/upsert",
    "asset/remove",
    "scene/upsert",
    "scene/set-active",
    "camera/upsert",
    "scene-object/upsert",
    "scene-object/update-transform",
    "scene-object/update-material",
    "scene-object/remove",
    "animation/upsert-clip",
  ],
  renderBindingKinds: ["motion-scene3d"],
  sceneObjectChannels: [
    "position",
    "rotation",
    "scale",
    "opacity",
    "material",
    "camera.position",
    "camera.fov",
    "camera.focusDistance",
  ],
  environmentKinds: ["none", "studio", "stage", "outdoor", "space", "custom"],
  lightTypes: ["ambient", "directional", "point", "area", "spot"],
};

export const CAPABILITY_MANIFEST: CapabilityManifest = {
  blendModes: BLEND_MODES,
  videoFilterTypes: VIDEO_FILTER_TYPES,
  audioEffectTypes: AUDIO_EFFECT_TYPES,
  transitionTypes: TRANSITION_TYPES,
  easings: EASING_TYPES,
  shapeTypes: SHAPE_TYPES,
  filterPresets: FILTER_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
  })),
  textAnimationPresets: TEXT_ANIMATION_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
  })),
  speed: {
    range: { min: SPEED_MIN, max: SPEED_MAX, step: 0.1, default: 1 },
    presets: SPEED_CURVE_PRESETS.map((p) => ({ id: p.id, name: p.name })),
  },
  colorGrading: COLOR_GRADING_RANGES,
  effects: EFFECT_DEFINITIONS,
  motion: MOTION_CAPABILITIES,
  creation: CREATION_CAPABILITIES,
};
