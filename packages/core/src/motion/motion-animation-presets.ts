import type { EasingType, Keyframe } from "../types/timeline";
import type { MotionLayer, MotionShapeLayer } from "./types";
import {
  getMotionLayerPropertyValueAtTime,
  sortMotionKeyframes,
  type MotionAnimatableProperty,
} from "./motion-keyframes";

export type MotionAnimationPresetCategory =
  | "entrance"
  | "exit"
  | "emphasis"
  | "loop"
  | "shape";

export type MotionAnimationPresetId =
  | "fade-in"
  | "fade-out"
  | "slide-up-in"
  | "slide-left-in"
  | "scale-pop"
  | "rotate-in"
  | "pulse"
  | "float-loop"
  | "stroke-draw-on"
  | "stroke-pop"
  | "gradient-sweep"
  | "corner-bloom"
  | "lift-to-3d"
  | "flip-in-3d"
  | "click-press";

export interface ApplyMotionAnimationPresetOptions {
  readonly startTime?: number;
  readonly duration?: number;
  readonly distance?: number;
  readonly intensity?: number;
  readonly idFactory?: (
    presetId: MotionAnimationPresetId,
    property: MotionAnimatableProperty,
    time: number,
    index: number,
  ) => string;
}

export interface MotionAnimationPreset {
  readonly id: MotionAnimationPresetId;
  readonly name: string;
  readonly category: MotionAnimationPresetCategory;
  readonly description: string;
  readonly defaultDuration: number;
  readonly properties: readonly MotionAnimatableProperty[];
  readonly supportsLayer?: (layer: MotionLayer) => boolean;
  readonly prepareLayer?: (
    layer: MotionLayer,
    context: MotionAnimationPresetSetupContext,
  ) => MotionLayer;
  readonly keyframes: (
    context: MotionAnimationPresetContext,
  ) => readonly MotionAnimationPresetKeyframe[];
}

interface MotionAnimationPresetSetupContext {
  readonly startTime: number;
  readonly duration: number;
  readonly distance: number;
  readonly intensity: number;
}

interface MotionAnimationPresetContext extends MotionAnimationPresetSetupContext {
  readonly value: (property: MotionAnimatableProperty) => number;
}

interface MotionAnimationPresetKeyframe {
  readonly property: MotionAnimatableProperty;
  readonly time: number;
  readonly value: number;
  readonly easing: EasingType;
}

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const at = (
  context: MotionAnimationPresetContext,
  ratio: number,
): number => Number((context.startTime + context.duration * ratio).toFixed(4));

const scale = (value: number, multiplier: number): number =>
  Number((value * multiplier).toFixed(4));

const isShapeLayer = (layer: MotionLayer): layer is MotionShapeLayer =>
  layer.type === "shape";

const shapePerimeterEstimate = (layer: MotionShapeLayer): number => {
  if (layer.shapeType === "circle" || layer.shapeType === "ellipse") {
    const radiusX = Math.max(1, layer.width / 2);
    const radiusY = Math.max(1, layer.height / 2);
    return Number(
      (Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)))).toFixed(2),
    );
  }
  return Number((Math.max(1, layer.width) * 2 + Math.max(1, layer.height) * 2).toFixed(2));
};

const prepareStrokeLayer = (
  layer: MotionLayer,
  context: MotionAnimationPresetSetupContext,
): MotionLayer => {
  if (!isShapeLayer(layer)) return layer;
  const length = shapePerimeterEstimate(layer);
  return {
    ...layer,
    style: {
      ...layer.style,
      stroke: {
        ...layer.style.stroke,
        width:
          layer.style.stroke.width > 0
            ? layer.style.stroke.width
            : Math.max(2, Number((4 * Math.max(0.5, context.intensity)).toFixed(2))),
        opacity: layer.style.stroke.opacity > 0 ? layer.style.stroke.opacity : 1,
        dashArray:
          layer.style.stroke.dashArray && layer.style.stroke.dashArray.length > 0
            ? layer.style.stroke.dashArray
            : [length],
        dashOffset:
          layer.style.stroke.dashOffset && layer.style.stroke.dashOffset > 0
            ? layer.style.stroke.dashOffset
            : length,
        lineCap: layer.style.stroke.lineCap ?? "round",
        lineJoin: layer.style.stroke.lineJoin ?? "round",
      },
    },
  };
};

const prepareGradientLayer = (layer: MotionLayer): MotionLayer => {
  if (!isShapeLayer(layer) || layer.style.fill.type === "gradient") {
    return layer;
  }

  const baseColor = layer.style.fill.color ?? "#14b8a6";
  return {
    ...layer,
    style: {
      ...layer.style,
      fill: {
        type: "gradient",
        opacity: layer.style.fill.opacity,
        color: baseColor,
        gradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: baseColor },
            { offset: 1, color: "#ffffff" },
          ],
        },
      },
    },
  };
};

export const MOTION_ANIMATION_PRESETS: readonly MotionAnimationPreset[] = [
  {
    id: "fade-in",
    name: "Fade In",
    category: "entrance",
    description: "Brings the layer in with a clean opacity ramp.",
    defaultDuration: 0.45,
    properties: ["transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: 0,
        easing: "ease-out",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: context.value("transform.opacity"),
        easing: "ease-out",
      },
    ],
  },
  {
    id: "fade-out",
    name: "Fade Out",
    category: "exit",
    description: "Fades the selected layer out over the preset duration.",
    defaultDuration: 0.45,
    properties: ["transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: context.value("transform.opacity"),
        easing: "ease-in",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: 0,
        easing: "ease-in",
      },
    ],
  },
  {
    id: "click-press",
    name: "Click Press",
    category: "emphasis",
    description: "Quick button-press feedback — scale down then spring back.",
    defaultDuration: 0.24,
    properties: ["transform.scale.x", "transform.scale.y"],
    keyframes: (context) => [
      {
        property: "transform.scale.x",
        time: at(context, 0),
        value: context.value("transform.scale.x"),
        easing: "ease-out",
      },
      {
        property: "transform.scale.y",
        time: at(context, 0),
        value: context.value("transform.scale.y"),
        easing: "ease-out",
      },
      {
        property: "transform.scale.x",
        time: at(context, 0.45),
        value: scale(context.value("transform.scale.x"), 0.93),
        easing: "ease-out",
      },
      {
        property: "transform.scale.y",
        time: at(context, 0.45),
        value: scale(context.value("transform.scale.y"), 0.93),
        easing: "ease-out",
      },
      {
        property: "transform.scale.x",
        time: at(context, 1),
        value: context.value("transform.scale.x"),
        easing: "ease-out",
      },
      {
        property: "transform.scale.y",
        time: at(context, 1),
        value: context.value("transform.scale.y"),
        easing: "ease-out",
      },
    ],
  },
  {
    id: "lift-to-3d",
    name: "Lift to 3D",
    category: "emphasis",
    description: "Tilts the layer back and lifts it off the plane in 3D.",
    defaultDuration: 0.6,
    properties: [
      "transform.rotation.x",
      "transform.position.z",
      "transform.scale.x",
      "transform.scale.y",
    ],
    keyframes: (context) => [
      {
        property: "transform.rotation.x",
        time: at(context, 0),
        value: context.value("transform.rotation.x"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.position.z",
        time: at(context, 0),
        value: context.value("transform.position.z"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.scale.x",
        time: at(context, 0),
        value: context.value("transform.scale.x"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.scale.y",
        time: at(context, 0),
        value: context.value("transform.scale.y"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.rotation.x",
        time: at(context, 1),
        value: Number((-24 * Math.max(0.4, context.intensity)).toFixed(2)),
        easing: "easeOutCubic",
      },
      {
        property: "transform.position.z",
        time: at(context, 1),
        value: Number(
          (context.value("transform.position.z") + 140).toFixed(2),
        ),
        easing: "easeOutCubic",
      },
      {
        property: "transform.scale.x",
        time: at(context, 1),
        value: scale(context.value("transform.scale.x"), 1.06),
        easing: "easeOutCubic",
      },
      {
        property: "transform.scale.y",
        time: at(context, 1),
        value: scale(context.value("transform.scale.y"), 1.06),
        easing: "easeOutCubic",
      },
    ],
  },
  {
    id: "flip-in-3d",
    name: "Flip In (3D)",
    category: "entrance",
    description: "Card-flips the layer in around its vertical axis.",
    defaultDuration: 0.55,
    properties: ["transform.rotation.y", "transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.rotation.y",
        time: at(context, 0),
        value: -90,
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: 0,
        easing: "easeOutCubic",
      },
      {
        property: "transform.rotation.y",
        time: at(context, 1),
        value: context.value("transform.rotation.y"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: context.value("transform.opacity"),
        easing: "easeOutCubic",
      },
    ],
  },
  {
    id: "slide-up-in",
    name: "Slide Up In",
    category: "entrance",
    description: "Moves the layer upward into place while fading in.",
    defaultDuration: 0.6,
    properties: ["transform.position.y", "transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.position.y",
        time: at(context, 0),
        value: context.value("transform.position.y") + context.distance,
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: 0,
        easing: "easeOutCubic",
      },
      {
        property: "transform.position.y",
        time: at(context, 1),
        value: context.value("transform.position.y"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: context.value("transform.opacity"),
        easing: "easeOutCubic",
      },
    ],
  },
  {
    id: "slide-left-in",
    name: "Slide Left In",
    category: "entrance",
    description: "Slides the layer horizontally into position.",
    defaultDuration: 0.6,
    properties: ["transform.position.x", "transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.position.x",
        time: at(context, 0),
        value: context.value("transform.position.x") + context.distance,
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: 0,
        easing: "easeOutCubic",
      },
      {
        property: "transform.position.x",
        time: at(context, 1),
        value: context.value("transform.position.x"),
        easing: "easeOutCubic",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: context.value("transform.opacity"),
        easing: "easeOutCubic",
      },
    ],
  },
  {
    id: "scale-pop",
    name: "Scale Pop",
    category: "entrance",
    description: "Pops the layer on with a subtle overshoot.",
    defaultDuration: 0.55,
    properties: [
      "transform.scale.x",
      "transform.scale.y",
      "transform.opacity",
    ],
    keyframes: (context) => {
      const overshoot = 1 + 0.08 * context.intensity;
      return [
        {
          property: "transform.scale.x",
          time: at(context, 0),
          value: scale(context.value("transform.scale.x"), 0.82),
          easing: "easeOutBack",
        },
        {
          property: "transform.scale.y",
          time: at(context, 0),
          value: scale(context.value("transform.scale.y"), 0.82),
          easing: "easeOutBack",
        },
        {
          property: "transform.opacity",
          time: at(context, 0),
          value: 0,
          easing: "ease-out",
        },
        {
          property: "transform.scale.x",
          time: at(context, 0.62),
          value: scale(context.value("transform.scale.x"), overshoot),
          easing: "easeOutBack",
        },
        {
          property: "transform.scale.y",
          time: at(context, 0.62),
          value: scale(context.value("transform.scale.y"), overshoot),
          easing: "easeOutBack",
        },
        {
          property: "transform.opacity",
          time: at(context, 0.62),
          value: context.value("transform.opacity"),
          easing: "ease-out",
        },
        {
          property: "transform.scale.x",
          time: at(context, 1),
          value: context.value("transform.scale.x"),
          easing: "easeOutBack",
        },
        {
          property: "transform.scale.y",
          time: at(context, 1),
          value: context.value("transform.scale.y"),
          easing: "easeOutBack",
        },
      ];
    },
  },
  {
    id: "rotate-in",
    name: "Rotate In",
    category: "entrance",
    description: "Adds a small rotational settle as the layer appears.",
    defaultDuration: 0.55,
    properties: ["transform.rotation", "transform.opacity"],
    keyframes: (context) => [
      {
        property: "transform.rotation",
        time: at(context, 0),
        value: context.value("transform.rotation") - 12 * context.intensity,
        easing: "easeOutBack",
      },
      {
        property: "transform.opacity",
        time: at(context, 0),
        value: 0,
        easing: "ease-out",
      },
      {
        property: "transform.rotation",
        time: at(context, 1),
        value: context.value("transform.rotation"),
        easing: "easeOutBack",
      },
      {
        property: "transform.opacity",
        time: at(context, 1),
        value: context.value("transform.opacity"),
        easing: "ease-out",
      },
    ],
  },
  {
    id: "pulse",
    name: "Pulse",
    category: "emphasis",
    description: "Adds a quick scale pulse for beat accents and CTAs.",
    defaultDuration: 0.5,
    properties: ["transform.scale.x", "transform.scale.y"],
    keyframes: (context) => {
      const amount = 1 + 0.08 * context.intensity;
      return [
        {
          property: "transform.scale.x",
          time: at(context, 0),
          value: context.value("transform.scale.x"),
          easing: "easeOutQuad",
        },
        {
          property: "transform.scale.y",
          time: at(context, 0),
          value: context.value("transform.scale.y"),
          easing: "easeOutQuad",
        },
        {
          property: "transform.scale.x",
          time: at(context, 0.5),
          value: scale(context.value("transform.scale.x"), amount),
          easing: "easeOutBack",
        },
        {
          property: "transform.scale.y",
          time: at(context, 0.5),
          value: scale(context.value("transform.scale.y"), amount),
          easing: "easeOutBack",
        },
        {
          property: "transform.scale.x",
          time: at(context, 1),
          value: context.value("transform.scale.x"),
          easing: "easeInOutQuad",
        },
        {
          property: "transform.scale.y",
          time: at(context, 1),
          value: context.value("transform.scale.y"),
          easing: "easeInOutQuad",
        },
      ];
    },
  },
  {
    id: "float-loop",
    name: "Float Loop",
    category: "loop",
    description: "Creates a seamless vertical float cycle.",
    defaultDuration: 2,
    properties: ["transform.position.y"],
    keyframes: (context) => [
      {
        property: "transform.position.y",
        time: at(context, 0),
        value: context.value("transform.position.y"),
        easing: "easeInOutSine",
      },
      {
        property: "transform.position.y",
        time: at(context, 0.5),
        value: context.value("transform.position.y") - context.distance * 0.28,
        easing: "easeInOutSine",
      },
      {
        property: "transform.position.y",
        time: at(context, 1),
        value: context.value("transform.position.y"),
        easing: "easeInOutSine",
      },
    ],
  },
  {
    id: "stroke-draw-on",
    name: "Stroke Draw On",
    category: "shape",
    description: "Prepares a dashed stroke and reveals it like a vector logo.",
    defaultDuration: 0.8,
    properties: ["shape.stroke.dashOffset", "shape.stroke.opacity"],
    supportsLayer: isShapeLayer,
    prepareLayer: prepareStrokeLayer,
    keyframes: (context) => [
      {
        property: "shape.stroke.dashOffset",
        time: at(context, 0),
        value: context.value("shape.stroke.dashOffset"),
        easing: "easeOutCubic",
      },
      {
        property: "shape.stroke.opacity",
        time: at(context, 0),
        value: 0,
        easing: "ease-out",
      },
      {
        property: "shape.stroke.dashOffset",
        time: at(context, 1),
        value: 0,
        easing: "easeOutCubic",
      },
      {
        property: "shape.stroke.opacity",
        time: at(context, 1),
        value: context.value("shape.stroke.opacity"),
        easing: "ease-out",
      },
    ],
  },
  {
    id: "stroke-pop",
    name: "Stroke Pop",
    category: "shape",
    description: "Adds a quick outline accent for cards and product callouts.",
    defaultDuration: 0.45,
    properties: ["shape.stroke.width", "shape.stroke.opacity"],
    supportsLayer: isShapeLayer,
    prepareLayer: prepareStrokeLayer,
    keyframes: (context) => {
      const baseWidth = Math.max(1, context.value("shape.stroke.width"));
      const peakWidth = Number((baseWidth + 5 * context.intensity).toFixed(4));
      return [
        {
          property: "shape.stroke.width",
          time: at(context, 0),
          value: baseWidth,
          easing: "easeOutQuad",
        },
        {
          property: "shape.stroke.opacity",
          time: at(context, 0),
          value: 0,
          easing: "easeOutQuad",
        },
        {
          property: "shape.stroke.width",
          time: at(context, 0.5),
          value: peakWidth,
          easing: "easeOutBack",
        },
        {
          property: "shape.stroke.opacity",
          time: at(context, 0.5),
          value: context.value("shape.stroke.opacity"),
          easing: "easeOutBack",
        },
        {
          property: "shape.stroke.width",
          time: at(context, 1),
          value: baseWidth,
          easing: "easeInOutQuad",
        },
      ];
    },
  },
  {
    id: "gradient-sweep",
    name: "Gradient Sweep",
    category: "shape",
    description: "Turns the fill into an editable gradient and sweeps its angle.",
    defaultDuration: 0.9,
    properties: ["shape.gradient.angle"],
    supportsLayer: isShapeLayer,
    prepareLayer: prepareGradientLayer,
    keyframes: (context) => {
      const baseAngle = context.value("shape.gradient.angle");
      const sweep = 90 * Math.max(0.25, context.intensity);
      return [
        {
          property: "shape.gradient.angle",
          time: at(context, 0),
          value: Number((baseAngle - sweep / 2).toFixed(4)),
          easing: "easeInOutSine",
        },
        {
          property: "shape.gradient.angle",
          time: at(context, 1),
          value: Number((baseAngle + sweep / 2).toFixed(4)),
          easing: "easeInOutSine",
        },
      ];
    },
  },
  {
    id: "corner-bloom",
    name: "Corner Bloom",
    category: "shape",
    description: "Animates rectangle radius for soft UI-card transitions.",
    defaultDuration: 0.55,
    properties: ["shape.cornerRadius"],
    supportsLayer: isShapeLayer,
    keyframes: (context) => {
      const baseRadius = context.value("shape.cornerRadius");
      const peakRadius = Number(
        (baseRadius + context.distance * 0.16 * context.intensity).toFixed(4),
      );
      return [
        {
          property: "shape.cornerRadius",
          time: at(context, 0),
          value: baseRadius,
          easing: "easeOutQuad",
        },
        {
          property: "shape.cornerRadius",
          time: at(context, 0.58),
          value: peakRadius,
          easing: "easeOutBack",
        },
        {
          property: "shape.cornerRadius",
          time: at(context, 1),
          value: baseRadius,
          easing: "easeInOutQuad",
        },
      ];
    },
  },
];

export function getMotionAnimationPreset(
  id: MotionAnimationPresetId,
): MotionAnimationPreset | undefined {
  return MOTION_ANIMATION_PRESETS.find((preset) => preset.id === id);
}

export function canApplyMotionAnimationPreset(
  layer: MotionLayer,
  preset: MotionAnimationPreset,
): boolean {
  return preset.supportsLayer ? preset.supportsLayer(layer) : true;
}

export function applyMotionAnimationPreset<T extends MotionLayer>(
  layer: T,
  presetId: MotionAnimationPresetId,
  options: ApplyMotionAnimationPresetOptions = {},
): T {
  const preset = getMotionAnimationPreset(presetId);
  if (!preset) {
    throw new Error(`Unsupported motion animation preset: ${presetId}`);
  }
  if (!canApplyMotionAnimationPreset(layer, preset)) {
    throw new Error(
      `Motion animation preset ${presetId} does not support ${layer.type} layers`,
    );
  }

  const maxStart = Math.max(0, layer.duration - 0.001);
  const startTime = clamp(options.startTime ?? 0, 0, maxStart);
  const duration = clamp(
    options.duration ?? preset.defaultDuration,
    0.001,
    Math.max(0.001, layer.duration - startTime),
  );
  const setupContext: MotionAnimationPresetSetupContext = {
    startTime,
    duration,
    distance: Math.max(0, options.distance ?? 120),
    intensity: Math.max(0, options.intensity ?? 1),
  };
  const workingLayer = (preset.prepareLayer?.(layer, setupContext) ?? layer) as T;
  const endTime = Number((startTime + duration).toFixed(4));
  const baseValues = new Map<MotionAnimatableProperty, number>();

  for (const property of preset.properties) {
    baseValues.set(
      property,
      getMotionLayerPropertyValueAtTime(workingLayer, property, startTime),
    );
  }

  const context: MotionAnimationPresetContext = {
    startTime,
    duration,
    distance: setupContext.distance,
    intensity: setupContext.intensity,
    value: (property) =>
      baseValues.get(property) ??
      getMotionLayerPropertyValueAtTime(workingLayer, property, startTime),
  };
  const presetKeyframes = preset.keyframes(context);
  const preservedKeyframes = workingLayer.keyframes.filter((keyframe) => {
    if (!isPresetProperty(preset, keyframe.property)) return true;
    return keyframe.time < startTime - 0.0001 || keyframe.time > endTime + 0.0001;
  });
  const nextKeyframes = presetKeyframes.map<Keyframe>((keyframe, index) => ({
    id:
      options.idFactory?.(presetId, keyframe.property, keyframe.time, index) ??
      uid("motion-kf"),
    property: keyframe.property,
    time: keyframe.time,
    value: keyframe.value,
    easing: keyframe.easing,
  }));

  return {
    ...workingLayer,
    keyframes: sortMotionKeyframes([...preservedKeyframes, ...nextKeyframes]),
  } as T;
}

function isPresetProperty(
  preset: MotionAnimationPreset,
  property: string,
): property is MotionAnimatableProperty {
  return preset.properties.includes(property as MotionAnimatableProperty);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
