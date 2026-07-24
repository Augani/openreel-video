import {
  buildMotionPathData,
  parseMotionPathData,
  type MotionShapePathPoint,
} from "./motion-shape-path";
import type { MotionPuppetPin, MotionShapeLayer, MotionVector2 } from "./types";

export interface CreateMotionPuppetPinInput {
  readonly id?: string;
  readonly name?: string;
  readonly bindPosition?: MotionVector2;
  readonly position?: MotionVector2;
  readonly radius?: number;
  readonly strength?: number;
  readonly enabled?: boolean;
  readonly color?: string;
  readonly idFactory?: () => string;
}

const DEFAULT_PIN_RADIUS = 180;
const DEFAULT_PIN_STRENGTH = 1;
const MAX_PIN_STRENGTH = 2;

export function createMotionPuppetPin(
  input: CreateMotionPuppetPinInput = {},
): MotionPuppetPin {
  const bindPosition = sanitizeVector(input.bindPosition ?? { x: 0, y: 0 });
  return normalizeMotionPuppetPin({
    id: input.id ?? input.idFactory?.() ?? createMotionPuppetPinId(),
    name: input.name ?? "Puppet Pin",
    bindPosition,
    position: sanitizeVector(input.position ?? bindPosition),
    radius: input.radius ?? DEFAULT_PIN_RADIUS,
    strength: input.strength ?? DEFAULT_PIN_STRENGTH,
    enabled: input.enabled ?? true,
    color: input.color,
  });
}

export function addMotionPuppetPin<T extends MotionShapeLayer>(
  layer: T,
  pin: MotionPuppetPin,
): T {
  return {
    ...layer,
    puppetPins: [
      ...normalizeMotionPuppetPins(layer.puppetPins),
      normalizeMotionPuppetPin(pin),
    ],
  } as T;
}

export function updateMotionPuppetPin<T extends MotionShapeLayer>(
  layer: T,
  pinId: string,
  updater: (pin: MotionPuppetPin) => MotionPuppetPin,
): T {
  return {
    ...layer,
    puppetPins: normalizeMotionPuppetPins(layer.puppetPins).map((pin) =>
      pin.id === pinId ? normalizeMotionPuppetPin(updater(pin)) : pin,
    ),
  } as T;
}

export function removeMotionPuppetPin<T extends MotionShapeLayer>(
  layer: T,
  pinId: string,
): T {
  return {
    ...layer,
    puppetPins: normalizeMotionPuppetPins(layer.puppetPins).filter(
      (pin) => pin.id !== pinId,
    ),
  } as T;
}

export function clearMotionPuppetPins<T extends MotionShapeLayer>(layer: T): T {
  return {
    ...layer,
    puppetPins: [],
  } as T;
}

export function normalizeMotionPuppetPins(
  pins: readonly MotionPuppetPin[] | undefined,
): MotionPuppetPin[] {
  return (pins ?? []).map(normalizeMotionPuppetPin);
}

export function normalizeMotionPuppetPin(pin: MotionPuppetPin): MotionPuppetPin {
  return {
    ...pin,
    name: pin.name.trim() || "Puppet Pin",
    bindPosition: sanitizeVector(pin.bindPosition),
    position: sanitizeVector(pin.position),
    radius: Math.max(1, finite(pin.radius, DEFAULT_PIN_RADIUS)),
    strength: clamp(
      finite(pin.strength, DEFAULT_PIN_STRENGTH),
      0,
      MAX_PIN_STRENGTH,
    ),
    enabled: pin.enabled,
  };
}

export function applyMotionPuppetPinsToPathData(
  pathData: string | undefined,
  pins: readonly MotionPuppetPin[] | undefined,
): string | undefined {
  if (!pathData) return pathData;
  const points = parseMotionPathData(pathData);
  if (points.length === 0) return pathData;
  return buildMotionPathData(applyMotionPuppetPinsToPoints(points, pins));
}

export function applyMotionPuppetPinsToPoints(
  points: readonly MotionShapePathPoint[],
  pins: readonly MotionPuppetPin[] | undefined,
): MotionShapePathPoint[] {
  const activePins = normalizeMotionPuppetPins(pins).filter(
    (pin) => pin.enabled && pin.radius > 0 && pin.strength > 0,
  );
  if (activePins.length === 0) return [...points];

  return points.map((point) => {
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (const pin of activePins) {
      const distanceToBind = Math.hypot(
        point.x - pin.bindPosition.x,
        point.y - pin.bindPosition.y,
      );
      if (distanceToBind > pin.radius) continue;

      const falloff = Math.pow(1 - distanceToBind / pin.radius, 2);
      const weight = falloff * pin.strength;
      weightedX += (pin.position.x - pin.bindPosition.x) * weight;
      weightedY += (pin.position.y - pin.bindPosition.y) * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) return { ...point };

    const influence = Math.min(1, totalWeight);
    return {
      x: point.x + (weightedX / totalWeight) * influence,
      y: point.y + (weightedY / totalWeight) * influence,
    };
  });
}

function createMotionPuppetPinId(): string {
  return `motion-puppet-pin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeVector(vector: MotionVector2): MotionVector2 {
  return {
    x: finite(vector.x, 0),
    y: finite(vector.y, 0),
    z: vector.z === undefined ? undefined : finite(vector.z, 0),
  };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
