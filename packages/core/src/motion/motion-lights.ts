import type {
  MotionComposition,
  MotionLight,
  MotionLightType,
  MotionTransform,
  MotionVector2,
} from "./types";
import type { EasingType, Keyframe } from "../types/timeline";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";

export const MOTION_LIGHT_PROPERTY_IDS = [
  "light.intensity",
  "light.position.x",
  "light.position.y",
  "light.position.z",
  "light.radius",
  "light.falloff",
  "light.angle",
  "light.shadowOpacity",
  "light.shadowSoftness",
] as const;

export type MotionLightProperty = (typeof MOTION_LIGHT_PROPERTY_IDS)[number];

export interface MotionLightPropertyDescriptor {
  readonly property: MotionLightProperty;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step: number;
  readonly unit?: string;
}

export interface CreateMotionLightOptions {
  readonly id?: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly color?: string;
  readonly intensity?: number;
  readonly position?: Partial<MotionVector2>;
  readonly radius?: number;
  readonly falloff?: number;
  readonly angle?: number;
  readonly castsShadow?: boolean;
  readonly shadowOpacity?: number;
  readonly shadowSoftness?: number;
  readonly keyframes?: readonly Keyframe[];
}

export interface UpsertMotionLightKeyframeOptions {
  readonly value?: number;
  readonly easing?: EasingType;
  readonly snapTolerance?: number;
  readonly idFactory?: () => string;
}

export interface MotionLightingShadow {
  readonly color: string;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MotionLightingSample {
  readonly brightness: number;
  readonly shadow?: MotionLightingShadow;
}

const DEFAULT_SNAP_TOLERANCE = 1 / 1000;
const NEUTRAL_LIGHTING: MotionLightingSample = { brightness: 1 };

const createLightId = (): string =>
  `motion-light-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const createKeyframeId = (): string =>
  `motion-light-kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_LIGHT_PROPERTY_DESCRIPTORS: readonly MotionLightPropertyDescriptor[] =
  [
    { property: "light.intensity", label: "Intensity", min: 0, max: 10, step: 0.05 },
    {
      property: "light.position.x",
      label: "Position X",
      step: 1,
      unit: "px",
    },
    {
      property: "light.position.y",
      label: "Position Y",
      step: 1,
      unit: "px",
    },
    {
      property: "light.position.z",
      label: "Depth",
      step: 10,
      unit: "px",
    },
    {
      property: "light.radius",
      label: "Radius",
      min: 1,
      max: 20000,
      step: 10,
      unit: "px",
    },
    { property: "light.falloff", label: "Falloff", min: 0.1, max: 8, step: 0.1 },
    { property: "light.angle", label: "Angle", step: 1, unit: "deg" },
    {
      property: "light.shadowOpacity",
      label: "Shadow",
      min: 0,
      max: 1,
      step: 0.01,
    },
    {
      property: "light.shadowSoftness",
      label: "Softness",
      min: 0,
      max: 400,
      step: 1,
      unit: "px",
    },
  ];

export function createMotionLight(
  type: MotionLightType,
  composition: Pick<MotionComposition, "width" | "height"> = {
    width: 1920,
    height: 1080,
  },
  options: CreateMotionLightOptions = {},
): MotionLight {
  const defaults = getMotionLightDefaults(type, composition);
  return normalizeMotionLight(
    {
      ...defaults,
      ...options,
      id: options.id ?? createLightId(),
      type,
      name: options.name ?? defaults.name,
      position: {
        ...defaults.position,
        ...(options.position ?? {}),
      },
      keyframes: options.keyframes ? [...options.keyframes] : defaults.keyframes,
    },
    composition,
  );
}

export function normalizeMotionLight(
  light: MotionLight,
  composition: Pick<MotionComposition, "width" | "height">,
): MotionLight {
  const type = isMotionLightType(light.type) ? light.type : "point";
  const defaults = getMotionLightDefaults(type, composition);
  const position = light.position ?? defaults.position;
  return {
    id: light.id || createLightId(),
    type,
    name: light.name?.trim() || defaults.name,
    enabled: Boolean(light.enabled),
    color: normalizeColor(light.color, defaults.color),
    intensity: clamp(finite(light.intensity, defaults.intensity), 0, 10),
    position: {
      x: finite(position.x, defaults.position.x),
      y: finite(position.y, defaults.position.y),
      z: finite(position.z, defaults.position.z ?? 0),
    },
    radius: clamp(finite(light.radius, defaults.radius), 1, 20000),
    falloff: clamp(finite(light.falloff, defaults.falloff), 0.1, 8),
    angle: finite(light.angle, defaults.angle),
    castsShadow: Boolean(light.castsShadow),
    shadowOpacity: clamp(
      finite(light.shadowOpacity, defaults.shadowOpacity),
      0,
      1,
    ),
    shadowSoftness: clamp(
      finite(light.shadowSoftness, defaults.shadowSoftness),
      0,
      400,
    ),
    keyframes: sanitizeLightKeyframes(light.keyframes ?? []),
  };
}

export function normalizeMotionLights(
  composition: Pick<MotionComposition, "width" | "height" | "lights">,
): MotionLight[] {
  return (composition.lights ?? []).map((light) =>
    normalizeMotionLight(light, composition),
  );
}

export function hasActiveMotionLights(
  composition: Pick<MotionComposition, "width" | "height" | "lights">,
): boolean {
  return normalizeMotionLights(composition).some(
    (light) =>
      light.enabled &&
      (light.type !== "ambient" || Math.abs(light.intensity - 1) > 0.001),
  );
}

export function addMotionCompositionLight(
  composition: MotionComposition,
  light: MotionLight,
): MotionComposition {
  return {
    ...composition,
    lights: [...normalizeMotionLights(composition), normalizeMotionLight(light, composition)],
    modifiedAt: Date.now(),
  };
}

export function updateMotionCompositionLight(
  composition: MotionComposition,
  lightId: string,
  updater: (light: MotionLight) => MotionLight,
): MotionComposition {
  let changed = false;
  const lights = normalizeMotionLights(composition).map((light) => {
    if (light.id !== lightId) return light;
    changed = true;
    return normalizeMotionLight(updater(light), composition);
  });
  return changed ? { ...composition, lights, modifiedAt: Date.now() } : composition;
}

export function removeMotionCompositionLight(
  composition: MotionComposition,
  lightId: string,
): MotionComposition {
  const lights = normalizeMotionLights(composition).filter(
    (light) => light.id !== lightId,
  );
  if (lights.length === (composition.lights ?? []).length) return composition;
  return { ...composition, lights, modifiedAt: Date.now() };
}

export function toggleMotionCompositionLight(
  composition: MotionComposition,
  lightId: string,
  enabled: boolean,
): MotionComposition {
  return updateMotionCompositionLight(composition, lightId, (light) => ({
    ...light,
    enabled,
  }));
}

export function getMotionLightAtTime(
  light: MotionLight,
  composition: Pick<MotionComposition, "width" | "height" | "duration">,
  localTime: number,
): MotionLight {
  const normalized = normalizeMotionLight(light, composition);
  const value = (property: MotionLightProperty, fallback: number): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes: normalized.keyframes ?? [],
      property,
      localTime,
      fallback,
      duration: Math.max(0.001, composition.duration),
    });

  return {
    ...normalized,
    intensity: clamp(value("light.intensity", normalized.intensity), 0, 10),
    position: {
      x: value("light.position.x", normalized.position.x),
      y: value("light.position.y", normalized.position.y),
      z: value("light.position.z", normalized.position.z ?? 0),
    },
    radius: clamp(value("light.radius", normalized.radius), 1, 20000),
    falloff: clamp(value("light.falloff", normalized.falloff), 0.1, 8),
    angle: value("light.angle", normalized.angle),
    shadowOpacity: clamp(
      value("light.shadowOpacity", normalized.shadowOpacity),
      0,
      1,
    ),
    shadowSoftness: clamp(
      value("light.shadowSoftness", normalized.shadowSoftness),
      0,
      400,
    ),
  };
}

export function getMotionLightingForLayer(
  composition: Pick<MotionComposition, "width" | "height" | "duration" | "lights">,
  transform: MotionTransform,
  localTime = 0,
): MotionLightingSample {
  const lights = normalizeMotionLights(composition)
    .map((light) => getMotionLightAtTime(light, composition, localTime))
    .filter((light) => light.enabled && light.intensity > 0);
  if (lights.length === 0) return NEUTRAL_LIGHTING;

  const hasAmbient = lights.some((light) => light.type === "ambient");
  let brightness = hasAmbient ? 0 : 0.72;
  let strongestShadow: MotionLightingShadow | undefined;
  let strongestShadowOpacity = 0;

  for (const light of lights) {
    if (light.type === "ambient") {
      brightness += light.intensity;
      continue;
    }

    const attenuation =
      light.type === "point"
        ? getPointLightAttenuation(light, transform.position)
        : 1;
    const contribution =
      light.type === "point"
        ? light.intensity * attenuation * 0.55
        : light.intensity * 0.28;
    brightness += contribution;

    const shadow = getMotionLightShadow(light, transform.position, attenuation);
    if (shadow && shadow.opacity > strongestShadowOpacity) {
      strongestShadow = shadow.shadow;
      strongestShadowOpacity = shadow.opacity;
    }
  }

  return {
    brightness: clamp(round(brightness), 0, 4),
    shadow: strongestShadow,
  };
}

export function buildMotionLightingCanvasFilter(
  lighting: MotionLightingSample,
): string {
  if (Math.abs(lighting.brightness - 1) < 0.005) return "none";
  return `brightness(${round(clamp(lighting.brightness, 0, 4))})`;
}

export function isMotionLightProperty(
  property: string,
): property is MotionLightProperty {
  return MOTION_LIGHT_PROPERTY_IDS.includes(property as MotionLightProperty);
}

export function getMotionLightPropertyDescriptor(
  property: MotionLightProperty,
): MotionLightPropertyDescriptor {
  return (
    MOTION_LIGHT_PROPERTY_DESCRIPTORS.find(
      (descriptor) => descriptor.property === property,
    ) ?? MOTION_LIGHT_PROPERTY_DESCRIPTORS[0]
  );
}

export function getMotionLightPropertyValue(
  light: MotionLight,
  property: MotionLightProperty,
): number {
  switch (property) {
    case "light.intensity":
      return light.intensity;
    case "light.position.x":
      return light.position.x;
    case "light.position.y":
      return light.position.y;
    case "light.position.z":
      return light.position.z ?? 0;
    case "light.radius":
      return light.radius;
    case "light.falloff":
      return light.falloff;
    case "light.angle":
      return light.angle;
    case "light.shadowOpacity":
      return light.shadowOpacity;
    case "light.shadowSoftness":
      return light.shadowSoftness;
  }
}

export function setMotionLightPropertyValue(
  light: MotionLight,
  property: MotionLightProperty,
  value: number,
): MotionLight {
  switch (property) {
    case "light.intensity":
      return { ...light, intensity: clamp(value, 0, 10) };
    case "light.position.x":
      return { ...light, position: { ...light.position, x: finite(value, 0) } };
    case "light.position.y":
      return { ...light, position: { ...light.position, y: finite(value, 0) } };
    case "light.position.z":
      return { ...light, position: { ...light.position, z: finite(value, 0) } };
    case "light.radius":
      return { ...light, radius: clamp(value, 1, 20000) };
    case "light.falloff":
      return { ...light, falloff: clamp(value, 0.1, 8) };
    case "light.angle":
      return { ...light, angle: finite(value, light.angle) };
    case "light.shadowOpacity":
      return { ...light, shadowOpacity: clamp(value, 0, 1) };
    case "light.shadowSoftness":
      return { ...light, shadowSoftness: clamp(value, 0, 400) };
  }
}

export function getMotionLightPropertyKeyframes(
  light: MotionLight,
  property: MotionLightProperty,
): Keyframe[] {
  return sanitizeLightKeyframes(light.keyframes ?? []).filter(
    (keyframe) => keyframe.property === property,
  );
}

export function findMotionLightKeyframeAtTime(
  light: MotionLight,
  property: MotionLightProperty,
  time: number,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): Keyframe | undefined {
  return sanitizeLightKeyframes(light.keyframes ?? []).find(
    (keyframe) =>
      keyframe.property === property &&
      Math.abs(keyframe.time - time) <= snapTolerance,
  );
}

export function upsertMotionLightKeyframe(
  light: MotionLight,
  property: MotionLightProperty,
  time: number,
  options: UpsertMotionLightKeyframeOptions = {},
): MotionLight {
  const keyframeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  const snapTolerance = options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  const value = options.value ?? getMotionLightPropertyValue(light, property);
  const keyframes = sanitizeLightKeyframes(light.keyframes ?? []);
  let replaced = false;
  const nextKeyframes = keyframes.map((keyframe) => {
    if (
      keyframe.property === property &&
      Math.abs(keyframe.time - keyframeTime) <= snapTolerance
    ) {
      replaced = true;
      return {
        ...keyframe,
        time: keyframeTime,
        value,
        easing: options.easing ?? keyframe.easing,
      };
    }
    return keyframe;
  });

  if (!replaced) {
    nextKeyframes.push({
      id: options.idFactory?.() ?? createKeyframeId(),
      property,
      time: keyframeTime,
      value,
      easing: options.easing ?? "ease",
    });
  }

  return {
    ...light,
    keyframes: nextKeyframes.sort((a, b) => a.time - b.time),
  };
}

export function removeMotionLightKeyframe(
  light: MotionLight,
  keyframeId: string,
): MotionLight {
  return {
    ...light,
    keyframes: sanitizeLightKeyframes(light.keyframes ?? []).filter(
      (keyframe) => keyframe.id !== keyframeId,
    ),
  };
}

export function removeMotionLightPropertyKeyframes(
  light: MotionLight,
  property: MotionLightProperty,
): MotionLight {
  return {
    ...light,
    keyframes: sanitizeLightKeyframes(light.keyframes ?? []).filter(
      (keyframe) => keyframe.property !== property,
    ),
  };
}

export function moveMotionLightKeyframe(
  light: MotionLight,
  keyframeId: string,
  time: number,
  duration = Number.POSITIVE_INFINITY,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): MotionLight {
  const keyframes = sanitizeLightKeyframes(light.keyframes ?? []);
  const target = keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (!target) return light;

  const keyframeTime = Math.min(
    Math.max(0, duration),
    Math.max(0, Number.isFinite(time) ? time : 0),
  );
  const existingAtTime = keyframes.find(
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

  const nextKeyframes = existingAtTime
    ? keyframes
        .filter((keyframe) => keyframe.id !== target.id)
        .map((keyframe) =>
          keyframe.id === existingAtTime.id ? nextKeyframe : keyframe,
        )
    : keyframes.map((keyframe) =>
        keyframe.id === keyframeId ? nextKeyframe : keyframe,
      );

  return {
    ...light,
    keyframes: sanitizeLightKeyframes(nextKeyframes),
  };
}

function getMotionLightDefaults(
  type: MotionLightType,
  composition: Pick<MotionComposition, "width" | "height">,
): MotionLight {
  const radius = Math.max(composition.width, composition.height) * 0.8;
  const center = {
    x: composition.width / 2,
    y: composition.height / 2,
    z: 320,
  };
  const base = {
    id: "motion-light-default",
    type,
    name: "Light",
    enabled: true,
    color: "#ffffff",
    intensity: 1,
    position: center,
    radius,
    falloff: 2,
    angle: 135,
    castsShadow: true,
    shadowOpacity: 0.22,
    shadowSoftness: 30,
    keyframes: [],
  };

  if (type === "ambient") {
    return {
      ...base,
      name: "Ambient Light",
      intensity: 1,
      position: { ...center, z: 0 },
      castsShadow: false,
      shadowOpacity: 0,
    };
  }

  if (type === "directional") {
    return {
      ...base,
      name: "Directional Light",
      intensity: 0.8,
      radius,
      angle: 135,
      shadowOpacity: 0.18,
      shadowSoftness: 34,
    };
  }

  return {
    ...base,
    name: "Point Light",
    position: {
      x: composition.width * 0.35,
      y: composition.height * 0.32,
      z: 420,
    },
  };
}

function getPointLightAttenuation(
  light: MotionLight,
  position: MotionVector2,
): number {
  const dx = position.x - light.position.x;
  const dy = position.y - light.position.y;
  const dz = (position.z ?? 0) - (light.position.z ?? 0);
  const distance = Math.hypot(dx, dy, dz * 0.45);
  const normalized = clamp(1 - distance / Math.max(1, light.radius), 0, 1);
  return Math.pow(normalized, light.falloff);
}

function getMotionLightShadow(
  light: MotionLight,
  position: MotionVector2,
  attenuation: number,
):
  | {
      readonly shadow: MotionLightingShadow;
      readonly opacity: number;
    }
  | undefined {
  if (!light.castsShadow || light.shadowOpacity <= 0) return undefined;
  const strength =
    light.type === "point"
      ? light.shadowOpacity * Math.max(0.18, attenuation) * light.intensity
      : light.shadowOpacity * light.intensity;
  const opacity = clamp(strength, 0, 0.8);
  if (opacity <= 0.001) return undefined;

  const vector =
    light.type === "point"
      ? getPointShadowVector(light, position, attenuation)
      : getDirectionalShadowVector(light);

  return {
    opacity,
    shadow: {
      color: `rgba(0, 0, 0, ${round(opacity)})`,
      blur: round(light.shadowSoftness * (light.type === "point" ? 1.15 : 1)),
      offsetX: round(vector.x),
      offsetY: round(vector.y),
    },
  };
}

function getPointShadowVector(
  light: MotionLight,
  position: MotionVector2,
  attenuation: number,
): MotionVector2 {
  const dx = position.x - light.position.x;
  const dy = position.y - light.position.y;
  const distance = Math.hypot(dx, dy);
  const angle = distance > 0.001 ? Math.atan2(dy, dx) : degreesToRadians(light.angle);
  const length = clamp(10 + light.intensity * (18 + 34 * attenuation), 0, 96);
  return {
    x: Math.cos(angle) * length,
    y: Math.sin(angle) * length,
  };
}

function getDirectionalShadowVector(light: MotionLight): MotionVector2 {
  const angle = degreesToRadians(light.angle + 180);
  const length = clamp(14 + light.intensity * 28, 0, 96);
  return {
    x: Math.cos(angle) * length,
    y: Math.sin(angle) * length,
  };
}

function sanitizeLightKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  return keyframes
    .filter((keyframe) => isMotionLightProperty(keyframe.property))
    .map((keyframe) => ({
      ...keyframe,
      time: Math.max(0, finite(keyframe.time, 0)),
      value: finite(keyframe.value, 0),
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizeColor(color: string | undefined, fallback: string): string {
  const normalized = color?.trim();
  if (!normalized) return fallback;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return normalized;
  if (/^rgba?\(/i.test(normalized)) return normalized;
  return fallback;
}

function isMotionLightType(type: string): type is MotionLightType {
  return type === "ambient" || type === "point" || type === "directional";
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function finite(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safe));
}
