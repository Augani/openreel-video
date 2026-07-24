import type { MotionLayer, MotionTransform } from "./types";

export interface MotionCanvas3DProjection {
  readonly depthScale: number;
  readonly rotationXScale: number;
  readonly rotationYScale: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

const THREE_D_PROPERTIES = new Set([
  "transform.position.z",
  "transform.rotation.x",
  "transform.rotation.y",
  "transform.rotation.z",
  "transform.perspective",
]);
const DEFAULT_PERSPECTIVE = 1000;
const EPSILON = 1 / 1_000_000;
const MIN_DENOMINATOR = 1;
const MAX_DEPTH_SCALE = 100;

export function getMotionCanvas3DProjection(
  transform: MotionTransform,
): MotionCanvas3DProjection {
  const perspective = normalizePerspective(transform.perspective);
  const depthScale = getMotionDepthScale(transform.position.z ?? 0, perspective);
  const rotationXScale = Math.cos(degreesToRadians(transform.rotation3d?.x ?? 0));
  const rotationYScale = Math.cos(degreesToRadians(transform.rotation3d?.y ?? 0));

  return {
    depthScale,
    rotationXScale,
    rotationYScale,
    scaleX: transform.scale.x * depthScale * rotationYScale,
    scaleY: transform.scale.y * depthScale * rotationXScale,
  };
}

export function projectMotion3DPosition(
  position: { readonly x: number; readonly y: number; readonly z?: number },
  perspective: number | undefined,
  vanishingPoint: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const depthScale = getMotionDepthScale(
    position.z ?? 0,
    normalizePerspective(perspective),
  );
  return {
    x: vanishingPoint.x + (position.x - vanishingPoint.x) * depthScale,
    y: vanishingPoint.y + (position.y - vanishingPoint.y) * depthScale,
  };
}

export function hasMotion3DRotation(transform: MotionTransform): boolean {
  return (
    Math.abs(transform.rotation3d?.x ?? 0) > EPSILON ||
    Math.abs(transform.rotation3d?.y ?? 0) > EPSILON
  );
}

export function projectMotion3DPlanePoint(
  localX: number,
  localY: number,
  transform: MotionTransform,
): { readonly x: number; readonly y: number } {
  const rotX = degreesToRadians(transform.rotation3d?.x ?? 0);
  const rotY = degreesToRadians(transform.rotation3d?.y ?? 0);
  const perspective = normalizePerspective(transform.perspective);

  const rotatedX = localX * Math.cos(rotY);
  const rotatedY = localY * Math.cos(rotX);
  const depthTowardViewer = localX * Math.sin(rotY) - localY * Math.sin(rotX);

  const denominator = perspective - depthTowardViewer;
  const safeDenominator =
    Math.abs(denominator) < MIN_DENOMINATOR
      ? Math.sign(denominator || 1) * MIN_DENOMINATOR
      : denominator;
  const scale = clamp(
    perspective / safeDenominator,
    -MAX_DEPTH_SCALE,
    MAX_DEPTH_SCALE,
  );
  return { x: rotatedX * scale, y: rotatedY * scale };
}

export function hasMotion3DTransform(transform: MotionTransform): boolean {
  return (
    Math.abs(transform.position.z ?? 0) > EPSILON ||
    Math.abs(transform.rotation3d?.x ?? 0) > EPSILON ||
    Math.abs(transform.rotation3d?.y ?? 0) > EPSILON
  );
}

export function motionLayerMayUse3D(layer: MotionLayer): boolean {
  if (hasMotion3DTransform(layer.transform)) return true;
  return (
    layer.keyframes.some((keyframe) => THREE_D_PROPERTIES.has(keyframe.property)) ||
    (layer.expressions ?? []).some((expression) =>
      THREE_D_PROPERTIES.has(expression.property),
    )
  );
}

function getMotionDepthScale(z: number, perspective: number): number {
  const denominator = perspective - z;
  const safeDenominator =
    Math.abs(denominator) < MIN_DENOMINATOR
      ? Math.sign(denominator || 1) * MIN_DENOMINATOR
      : denominator;
  return clamp(perspective / safeDenominator, -MAX_DEPTH_SCALE, MAX_DEPTH_SCALE);
}

function normalizePerspective(value: number | undefined): number {
  return Math.max(1, Number.isFinite(value) ? value ?? DEFAULT_PERSPECTIVE : DEFAULT_PERSPECTIVE);
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
