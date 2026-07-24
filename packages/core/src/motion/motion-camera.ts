import type { MotionCamera, MotionComposition, MotionTransform } from "./types";
import type { EasingType, Keyframe } from "../types/timeline";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";

export const DEFAULT_MOTION_CAMERA_PERSPECTIVE = 1000;
export const MOTION_CAMERA_PROPERTY_IDS = [
  "camera.position.x",
  "camera.position.y",
  "camera.position.z",
  "camera.zoom",
  "camera.rotation",
  "camera.perspective",
  "camera.focusDistance",
  "camera.aperture",
  "camera.maxBlur",
] as const;

export type MotionCameraProperty = (typeof MOTION_CAMERA_PROPERTY_IDS)[number];

export interface MotionCameraPropertyDescriptor {
  readonly property: MotionCameraProperty;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step: number;
  readonly unit?: string;
}

export interface UpsertMotionCameraKeyframeOptions {
  readonly value?: number;
  readonly easing?: EasingType;
  readonly snapTolerance?: number;
  readonly idFactory?: () => string;
}

const DEFAULT_SNAP_TOLERANCE = 1 / 1000;

const createKeyframeId = (): string =>
  `motion-camera-kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_CAMERA_PROPERTY_DESCRIPTORS: readonly MotionCameraPropertyDescriptor[] =
  [
    {
      property: "camera.position.x",
      label: "Camera X",
      step: 1,
      unit: "px",
    },
    {
      property: "camera.position.y",
      label: "Camera Y",
      step: 1,
      unit: "px",
    },
    {
      property: "camera.position.z",
      label: "Camera Depth",
      step: 10,
      unit: "px",
    },
    {
      property: "camera.zoom",
      label: "Camera Zoom",
      min: 0.01,
      max: 100,
      step: 0.05,
    },
    {
      property: "camera.rotation",
      label: "Camera Roll",
      step: 1,
      unit: "deg",
    },
    {
      property: "camera.perspective",
      label: "Perspective",
      min: 1,
      max: 10000,
      step: 25,
      unit: "px",
    },
    {
      property: "camera.focusDistance",
      label: "Focus Distance",
      min: -10000,
      max: 10000,
      step: 10,
      unit: "px",
    },
    {
      property: "camera.aperture",
      label: "Aperture",
      min: 0,
      max: 10,
      step: 0.1,
    },
    {
      property: "camera.maxBlur",
      label: "Max Blur",
      min: 0,
      max: 100,
      step: 1,
      unit: "px",
    },
  ];

export function createDefaultMotionCamera(
  composition: Pick<MotionComposition, "width" | "height">,
): MotionCamera {
  return {
    enabled: true,
    position: {
      x: composition.width / 2,
      y: composition.height / 2,
      z: 0,
    },
    zoom: 1,
    rotation: 0,
    perspective: DEFAULT_MOTION_CAMERA_PERSPECTIVE,
    depthOfField: {
      enabled: false,
      focusDistance: 0,
      aperture: 1,
      maxBlur: 24,
    },
    keyframes: [],
  };
}

export function normalizeMotionCamera(
  composition: Pick<MotionComposition, "width" | "height" | "camera">,
): MotionCamera {
  const defaults = createDefaultMotionCamera(composition);
  const camera = composition.camera;
  if (!camera) {
    return { ...defaults, enabled: false };
  }

  return {
    enabled: camera.enabled,
    position: {
      x: finite(camera.position?.x, defaults.position.x),
      y: finite(camera.position?.y, defaults.position.y),
      z: finite(camera.position?.z, defaults.position.z ?? 0),
    },
    zoom: clamp(finite(camera.zoom, defaults.zoom), 0.01, 100),
    rotation: finite(camera.rotation, defaults.rotation),
    perspective: Math.max(
      1,
      finite(camera.perspective, defaults.perspective),
    ),
    depthOfField: normalizeMotionCameraDepthOfField(camera, defaults),
    keyframes: sanitizeCameraKeyframes(camera.keyframes ?? []),
  };
}

export function getMotionCameraAtTime(
  composition: Pick<MotionComposition, "width" | "height" | "camera" | "duration">,
  localTime: number,
): MotionCamera {
  const camera = normalizeMotionCamera(composition);
  const value = (property: MotionCameraProperty, fallback: number): number =>
    evaluateMotionPropertyValueAtTime({
      keyframes: camera.keyframes ?? [],
      property,
      localTime,
      fallback,
      duration: Math.max(0.001, composition.duration),
    });

  return {
    ...camera,
    position: {
      x: value("camera.position.x", camera.position.x),
      y: value("camera.position.y", camera.position.y),
      z: value("camera.position.z", camera.position.z ?? 0),
    },
    zoom: clamp(value("camera.zoom", camera.zoom), 0.01, 100),
    rotation: value("camera.rotation", camera.rotation),
    perspective: Math.max(1, value("camera.perspective", camera.perspective)),
    depthOfField: {
      ...(camera.depthOfField ?? createDefaultMotionCamera(composition).depthOfField!),
      focusDistance: value(
        "camera.focusDistance",
        camera.depthOfField?.focusDistance ?? 0,
      ),
      aperture: clamp(
        value("camera.aperture", camera.depthOfField?.aperture ?? 1),
        0,
        10,
      ),
      maxBlur: clamp(
        value("camera.maxBlur", camera.depthOfField?.maxBlur ?? 24),
        0,
        100,
      ),
    },
  };
}

export function hasActiveMotionCamera(
  composition: Pick<MotionComposition, "width" | "height" | "camera">,
): boolean {
  return normalizeMotionCamera(composition).enabled;
}

export function applyMotionCameraToTransform(
  composition: Pick<MotionComposition, "width" | "height" | "camera" | "duration">,
  transform: MotionTransform,
  localTime = 0,
): MotionTransform {
  const camera = getMotionCameraAtTime(composition, localTime);
  if (!camera.enabled) return transform;
  const cameraZ = camera.position.z ?? 0;

  const rollRadians = (-camera.rotation * Math.PI) / 180;
  const cos = Math.cos(rollRadians);
  const sin = Math.sin(rollRadians);
  const relativeX = (transform.position.x - camera.position.x) * camera.zoom;
  const relativeY = (transform.position.y - camera.position.y) * camera.zoom;
  const rolledX = relativeX * cos - relativeY * sin;
  const rolledY = relativeX * sin + relativeY * cos;

  return {
    ...transform,
    position: {
      x: composition.width / 2 + rolledX,
      y: composition.height / 2 + rolledY,
      z: (transform.position.z ?? 0) - cameraZ,
    },
    scale: {
      x: transform.scale.x * camera.zoom,
      y: transform.scale.y * camera.zoom,
    },
    rotation: transform.rotation - camera.rotation,
    perspective: camera.perspective,
  };
}

export function getMotionCameraWorldDelta(
  composition: Pick<MotionComposition, "width" | "height" | "camera" | "duration">,
  delta: { readonly x: number; readonly y: number },
  localTime = 0,
): { readonly x: number; readonly y: number } {
  const camera = getMotionCameraAtTime(composition, localTime);
  if (!camera.enabled) return delta;
  return {
    x: delta.x / camera.zoom,
    y: delta.y / camera.zoom,
  };
}

export function isMotionCameraProperty(
  property: string,
): property is MotionCameraProperty {
  return MOTION_CAMERA_PROPERTY_IDS.includes(property as MotionCameraProperty);
}

export function getMotionCameraPropertyDescriptor(
  property: MotionCameraProperty,
): MotionCameraPropertyDescriptor {
  return (
    MOTION_CAMERA_PROPERTY_DESCRIPTORS.find(
      (descriptor) => descriptor.property === property,
    ) ?? MOTION_CAMERA_PROPERTY_DESCRIPTORS[0]
  );
}

export function getMotionCameraPropertyValue(
  camera: MotionCamera,
  property: MotionCameraProperty,
): number {
  switch (property) {
    case "camera.position.x":
      return camera.position.x;
    case "camera.position.y":
      return camera.position.y;
    case "camera.position.z":
      return camera.position.z ?? 0;
    case "camera.zoom":
      return camera.zoom;
    case "camera.rotation":
      return camera.rotation;
    case "camera.perspective":
      return camera.perspective;
    case "camera.focusDistance":
      return camera.depthOfField?.focusDistance ?? 0;
    case "camera.aperture":
      return camera.depthOfField?.aperture ?? 1;
    case "camera.maxBlur":
      return camera.depthOfField?.maxBlur ?? 24;
  }
}

export function setMotionCameraPropertyValue(
  camera: MotionCamera,
  property: MotionCameraProperty,
  value: number,
): MotionCamera {
  switch (property) {
    case "camera.position.x":
      return {
        ...camera,
        position: { ...camera.position, x: value },
      };
    case "camera.position.y":
      return {
        ...camera,
        position: { ...camera.position, y: value },
      };
    case "camera.position.z":
      return {
        ...camera,
        position: { ...camera.position, z: value },
      };
    case "camera.zoom":
      return {
        ...camera,
        zoom: clamp(value, 0.01, 100),
      };
    case "camera.rotation":
      return {
        ...camera,
        rotation: value,
      };
    case "camera.perspective":
      return {
        ...camera,
        perspective: Math.max(1, value),
      };
    case "camera.focusDistance":
      return {
        ...camera,
        depthOfField: {
          ...getCameraDepthOfField(camera),
          focusDistance: value,
        },
      };
    case "camera.aperture":
      return {
        ...camera,
        depthOfField: {
          ...getCameraDepthOfField(camera),
          aperture: clamp(value, 0, 10),
        },
      };
    case "camera.maxBlur":
      return {
        ...camera,
        depthOfField: {
          ...getCameraDepthOfField(camera),
          maxBlur: clamp(value, 0, 100),
        },
      };
  }
}

export function setMotionCameraDepthOfFieldEnabled(
  camera: MotionCamera,
  enabled: boolean,
): MotionCamera {
  return {
    ...camera,
    depthOfField: {
      ...getCameraDepthOfField(camera),
      enabled,
    },
  };
}

export function getMotionCameraDepthOfFieldBlur(
  composition: Pick<MotionComposition, "width" | "height" | "camera" | "duration">,
  transform: MotionTransform,
  localTime = 0,
): number {
  const camera = getMotionCameraAtTime(composition, localTime);
  const depthOfField = camera.depthOfField;
  if (!camera.enabled || !depthOfField?.enabled) return 0;

  const cameraZ = camera.position.z ?? 0;
  const layerCameraZ = (transform.position.z ?? 0) - cameraZ;
  const defocusDistance = Math.abs(layerCameraZ - depthOfField.focusDistance);
  const normalizedDistance = defocusDistance / Math.max(1, camera.perspective);
  return clamp(
    normalizedDistance * depthOfField.aperture * depthOfField.maxBlur,
    0,
    depthOfField.maxBlur,
  );
}

export function buildMotionCameraDepthOfFieldCanvasFilter(
  composition: Pick<MotionComposition, "width" | "height" | "camera" | "duration">,
  transform: MotionTransform,
  localTime = 0,
): string {
  const blur = getMotionCameraDepthOfFieldBlur(composition, transform, localTime);
  return blur > 0.001 ? `blur(${roundFilterValue(blur)}px)` : "none";
}

export function getMotionCameraPropertyKeyframes(
  camera: MotionCamera,
  property: MotionCameraProperty,
): Keyframe[] {
  return sanitizeCameraKeyframes(camera.keyframes ?? []).filter(
    (keyframe) => keyframe.property === property,
  );
}

export function findMotionCameraKeyframeAtTime(
  camera: MotionCamera,
  property: MotionCameraProperty,
  time: number,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): Keyframe | undefined {
  return sanitizeCameraKeyframes(camera.keyframes ?? []).find(
    (keyframe) =>
      keyframe.property === property &&
      Math.abs(keyframe.time - time) <= snapTolerance,
  );
}

export function upsertMotionCameraKeyframe(
  camera: MotionCamera,
  property: MotionCameraProperty,
  time: number,
  options: UpsertMotionCameraKeyframeOptions = {},
): MotionCamera {
  const keyframeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  const snapTolerance = options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  const value = options.value ?? getMotionCameraPropertyValue(camera, property);
  const keyframes = sanitizeCameraKeyframes(camera.keyframes ?? []);
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
      time: keyframeTime,
      property,
      value,
      easing: options.easing ?? "ease",
    });
  }

  return {
    ...camera,
    keyframes: sanitizeCameraKeyframes(nextKeyframes),
  };
}

export function removeMotionCameraKeyframe(
  camera: MotionCamera,
  keyframeId: string,
): MotionCamera {
  return {
    ...camera,
    keyframes: sanitizeCameraKeyframes(camera.keyframes ?? []).filter(
      (keyframe) => keyframe.id !== keyframeId,
    ),
  };
}

export function removeMotionCameraPropertyKeyframes(
  camera: MotionCamera,
  property: MotionCameraProperty,
): MotionCamera {
  return {
    ...camera,
    keyframes: sanitizeCameraKeyframes(camera.keyframes ?? []).filter(
      (keyframe) => keyframe.property !== property,
    ),
  };
}

export function moveMotionCameraKeyframe(
  camera: MotionCamera,
  keyframeId: string,
  time: number,
  duration = Number.POSITIVE_INFINITY,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): MotionCamera {
  const keyframes = sanitizeCameraKeyframes(camera.keyframes ?? []);
  const target = keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (!target) return camera;

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
    ...camera,
    keyframes: sanitizeCameraKeyframes(nextKeyframes),
  };
}

function sanitizeCameraKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  return [...keyframes]
    .filter((keyframe) => isMotionCameraProperty(keyframe.property))
    .map((keyframe) => ({
      ...keyframe,
      time: Math.max(0, finite(keyframe.time, 0)),
      value: finite(keyframe.value, 0),
    }))
    .sort((a, b) => a.time - b.time);
}

function normalizeMotionCameraDepthOfField(
  camera: MotionCamera,
  defaults: MotionCamera,
): NonNullable<MotionCamera["depthOfField"]> {
  const fallback = getCameraDepthOfField(defaults);
  return {
    enabled: camera.depthOfField?.enabled ?? fallback.enabled,
    focusDistance: finite(
      camera.depthOfField?.focusDistance,
      fallback.focusDistance,
    ),
    aperture: clamp(finite(camera.depthOfField?.aperture, fallback.aperture), 0, 10),
    maxBlur: clamp(finite(camera.depthOfField?.maxBlur, fallback.maxBlur), 0, 100),
  };
}

function getCameraDepthOfField(
  camera: MotionCamera,
): NonNullable<MotionCamera["depthOfField"]> {
  return (
    camera.depthOfField ?? {
      enabled: false,
      focusDistance: 0,
      aperture: 1,
      maxBlur: 24,
    }
  );
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function roundFilterValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}
