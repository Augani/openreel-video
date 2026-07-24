import type {
  MotionComposition,
  MotionOffsetPathsModifier,
  MotionPuckerBloatModifier,
  MotionRepeaterModifier,
  MotionRoundCornersModifier,
  MotionShapeLayer,
  MotionShapeModifier,
  MotionShapeModifierType,
  MotionTrimPathsModifier,
  MotionTwistModifier,
  MotionVector2,
  MotionWigglePathsModifier,
  MotionZigZagModifier,
} from "./types";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";
import {
  buildMotionPathData,
  getMotionShapePathDataAtTime,
  parseMotionPathData,
  type MotionShapePathPoint,
} from "./motion-shape-path";
import { applyMotionPuppetPinsToPoints } from "./motion-puppet";
import { mergeMotionShapeRings } from "./motion-shape-boolean";

const OFFSET_MITER_LIMIT = 4;

export type { MotionShapePathPoint } from "./motion-shape-path";

export interface MotionShapeModifierPreset {
  readonly type: MotionShapeModifier["type"];
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionShapeModifier;
}

export const MOTION_SHAPE_MODIFIER_PROPERTY_NAMES = [
  "start",
  "end",
  "offset",
  "copies",
  "position.x",
  "position.y",
  "scale.x",
  "scale.y",
  "rotation",
  "opacity",
  "size",
  "ridgesPerSegment",
  "radius",
  "segments",
  "detail",
  "speed",
  "seed",
  "amount",
  "angle",
] as const;

export type MotionShapeModifierPropertyName =
  (typeof MOTION_SHAPE_MODIFIER_PROPERTY_NAMES)[number];

export type MotionShapeModifierProperty =
  `modifier.${string}.${MotionShapeModifierPropertyName}`;

export interface MotionShapeModifierPropertyDescriptor {
  readonly property: MotionShapeModifierPropertyName;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly defaultValue: number;
}

export interface MotionRepeaterCopyTransform {
  readonly index: number;
  readonly amount: number;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly scale: {
    readonly x: number;
    readonly y: number;
  };
  readonly rotation: number;
  readonly opacity: number;
}

const createShapeModifierId = (): string =>
  `motion-shape-mod-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const MOTION_SHAPE_MODIFIER_PROPERTY_DESCRIPTORS: Record<
  MotionShapeModifierType,
  readonly MotionShapeModifierPropertyDescriptor[]
> = {
  "trim-paths": [
    { property: "start", label: "Start", min: 0, max: 100, step: 1, unit: "%", defaultValue: 0 },
    { property: "end", label: "End", min: 0, max: 100, step: 1, unit: "%", defaultValue: 100 },
    { property: "offset", label: "Offset", min: -3600, max: 3600, step: 1, unit: "deg", defaultValue: 0 },
  ],
  repeater: [
    { property: "copies", label: "Copies", min: 1, max: 256, step: 1, defaultValue: 5 },
    { property: "offset", label: "Offset", min: -256, max: 256, step: 0.1, defaultValue: 0 },
    { property: "position.x", label: "Position X", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 72 },
    { property: "position.y", label: "Position Y", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 0 },
    { property: "scale.x", label: "Scale X", min: 0.001, max: 64, step: 0.05, defaultValue: 1 },
    { property: "scale.y", label: "Scale Y", min: 0.001, max: 64, step: 0.05, defaultValue: 1 },
    { property: "rotation", label: "Rotation", min: -3600, max: 3600, step: 1, unit: "deg", defaultValue: 0 },
    { property: "opacity", label: "Opacity", min: 0, max: 1, step: 0.05, unit: "%", defaultValue: 0.85 },
  ],
  "zig-zag": [
    { property: "size", label: "Size", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 16 },
    { property: "ridgesPerSegment", label: "Ridges", min: 0, max: 128, step: 1, defaultValue: 3 },
  ],
  "round-corners": [
    { property: "radius", label: "Radius", min: 0, max: 4000, step: 1, unit: "px", defaultValue: 24 },
    { property: "segments", label: "Samples", min: 1, max: 48, step: 1, defaultValue: 8 },
  ],
  "wiggle-paths": [
    { property: "size", label: "Size", min: 0, max: 4000, step: 1, unit: "px", defaultValue: 12 },
    { property: "detail", label: "Detail", min: 0, max: 32, step: 1, defaultValue: 2 },
    { property: "speed", label: "Speed", min: 0, max: 60, step: 0.1, defaultValue: 1 },
    { property: "seed", label: "Seed", min: -100000, max: 100000, step: 1, defaultValue: 1 },
  ],
  "offset-paths": [
    { property: "amount", label: "Amount", min: -4000, max: 4000, step: 1, unit: "px", defaultValue: 10 },
  ],
  "pucker-bloat": [
    { property: "amount", label: "Amount", min: -100, max: 100, step: 1, unit: "%", defaultValue: 0 },
  ],
  twist: [
    { property: "angle", label: "Angle", min: -3600, max: 3600, step: 1, unit: "deg", defaultValue: 0 },
  ],
};

export const MOTION_SHAPE_MODIFIER_PRESETS: readonly MotionShapeModifierPreset[] = [
  {
    type: "trim-paths",
    name: "Trim Paths",
    description: "Animates the visible portion of a shape stroke.",
    create: (id = createShapeModifierId()): MotionTrimPathsModifier => ({
      id,
      type: "trim-paths",
      name: "Trim Paths",
      enabled: true,
      start: 0,
      end: 100,
      offset: 0,
    }),
  },
  {
    type: "repeater",
    name: "Repeater",
    description: "Duplicates a shape with per-copy transform offsets.",
    create: (id = createShapeModifierId()): MotionRepeaterModifier => ({
      id,
      type: "repeater",
      name: "Repeater",
      enabled: true,
      copies: 5,
      offset: 0,
      transform: {
        position: { x: 72, y: 0 },
        scale: { x: 1, y: 1 },
        rotation: 0,
        opacity: 0.85,
      },
    }),
  },
  {
    type: "zig-zag",
    name: "Zig Zag",
    description: "Adds alternating peaks along shape segments for bursts and jagged logo accents.",
    create: (id = createShapeModifierId()): MotionZigZagModifier => ({
      id,
      type: "zig-zag",
      name: "Zig Zag",
      enabled: true,
      size: 16,
      ridgesPerSegment: 3,
    }),
  },
  {
    type: "round-corners",
    name: "Round Corners",
    description: "Rounds arbitrary shape and SVG path corners with export-safe geometry.",
    create: (id = createShapeModifierId()): MotionRoundCornersModifier => ({
      id,
      type: "round-corners",
      name: "Round Corners",
      enabled: true,
      radius: 24,
      segments: 8,
    }),
  },
  {
    type: "wiggle-paths",
    name: "Wiggle Paths",
    description: "Adds seeded animated path jitter for organic motion accents.",
    create: (id = createShapeModifierId()): MotionWigglePathsModifier => ({
      id,
      type: "wiggle-paths",
      name: "Wiggle Paths",
      enabled: true,
      size: 12,
      detail: 2,
      speed: 1,
      seed: 1,
    }),
  },
  {
    type: "offset-paths",
    name: "Offset Paths",
    description: "Insets or expands closed outlines along their outward normals.",
    create: (id = createShapeModifierId()): MotionOffsetPathsModifier => ({
      id,
      type: "offset-paths",
      name: "Offset Paths",
      enabled: true,
      amount: 10,
      lineJoin: "miter",
    }),
  },
  {
    type: "pucker-bloat",
    name: "Pucker & Bloat",
    description: "Pulls vertices toward or away from the shape centroid.",
    create: (id = createShapeModifierId()): MotionPuckerBloatModifier => ({
      id,
      type: "pucker-bloat",
      name: "Pucker & Bloat",
      enabled: true,
      amount: 0,
    }),
  },
  {
    type: "twist",
    name: "Twist",
    description: "Rotates vertices around a center with center-weighted falloff.",
    create: (id = createShapeModifierId()): MotionTwistModifier => ({
      id,
      type: "twist",
      name: "Twist",
      enabled: true,
      angle: 0,
      center: { x: 0, y: 0 },
    }),
  },
];

export function createMotionShapeModifier(
  type: MotionShapeModifier["type"],
  id?: string,
  center?: MotionVector2,
): MotionShapeModifier {
  const preset = MOTION_SHAPE_MODIFIER_PRESETS.find((item) => item.type === type);
  if (!preset) {
    throw new Error(`Unsupported motion shape modifier: ${type}`);
  }
  const created = preset.create(id);
  if (created.type === "twist" && center) {
    return {
      ...created,
      center: {
        x: finite(center.x, 0),
        y: finite(center.y, 0),
      },
    };
  }
  return created;
}

export function addMotionShapeModifier<T extends MotionShapeLayer>(
  layer: T,
  modifier: MotionShapeModifier,
): T {
  const modifiers = (layer.modifiers ?? []).filter(
    (candidate) => candidate.type !== modifier.type,
  );
  return {
    ...layer,
    modifiers: [...modifiers, sanitizeMotionShapeModifier(modifier)],
  } as T;
}

export function updateMotionShapeModifier<T extends MotionShapeLayer>(
  layer: T,
  modifierId: string,
  updater: (modifier: MotionShapeModifier) => MotionShapeModifier,
): T {
  return {
    ...layer,
    modifiers: (layer.modifiers ?? []).map((modifier) =>
      modifier.id === modifierId
        ? sanitizeMotionShapeModifier(updater(modifier))
        : modifier,
    ),
  } as T;
}

export function removeMotionShapeModifier<T extends MotionShapeLayer>(
  layer: T,
  modifierId: string,
): T {
  return {
    ...layer,
    modifiers: (layer.modifiers ?? []).filter(
      (modifier) => modifier.id !== modifierId,
    ),
  } as T;
}

export function toggleMotionShapeModifier<T extends MotionShapeLayer>(
  layer: T,
  modifierId: string,
  enabled: boolean,
): T {
  return updateMotionShapeModifier(layer, modifierId, (modifier) => ({
    ...modifier,
    enabled,
  }));
}

export function getMotionTrimPathsModifier(
  layer: MotionShapeLayer,
): MotionTrimPathsModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionTrimPathsModifier =>
      modifier.type === "trim-paths",
  );
}

export function getMotionRepeaterModifier(
  layer: MotionShapeLayer,
): MotionRepeaterModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionRepeaterModifier =>
      modifier.type === "repeater",
  );
}

export function getMotionZigZagModifier(
  layer: MotionShapeLayer,
): MotionZigZagModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionZigZagModifier =>
      modifier.type === "zig-zag",
  );
}

export function getMotionRoundCornersModifier(
  layer: MotionShapeLayer,
): MotionRoundCornersModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionRoundCornersModifier =>
      modifier.type === "round-corners",
  );
}

export function getMotionWigglePathsModifier(
  layer: MotionShapeLayer,
): MotionWigglePathsModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionWigglePathsModifier =>
      modifier.type === "wiggle-paths",
  );
}

export function getMotionOffsetPathsModifier(
  layer: MotionShapeLayer,
): MotionOffsetPathsModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionOffsetPathsModifier =>
      modifier.type === "offset-paths",
  );
}

export function getMotionPuckerBloatModifier(
  layer: MotionShapeLayer,
): MotionPuckerBloatModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionPuckerBloatModifier =>
      modifier.type === "pucker-bloat",
  );
}

export function getMotionTwistModifier(
  layer: MotionShapeLayer,
): MotionTwistModifier | undefined {
  return (layer.modifiers ?? []).find(
    (modifier): modifier is MotionTwistModifier => modifier.type === "twist",
  );
}

export function getMotionShapeModifierKeyframeProperty(
  modifierId: string,
  property: MotionShapeModifierPropertyName,
): MotionShapeModifierProperty {
  return `modifier.${modifierId}.${property}`;
}

export function parseMotionShapeModifierKeyframeProperty(
  property: string,
): {
  readonly modifierId: string;
  readonly property: MotionShapeModifierPropertyName;
} | null {
  const match =
    /^modifier\.([^.]+)\.(start|end|offset|copies|position\.x|position\.y|scale\.x|scale\.y|rotation|opacity|size|ridgesPerSegment|radius|segments|detail|speed|seed|amount|angle)$/.exec(
      property,
    );
  if (!match) return null;
  const modifierProperty = match[2] as MotionShapeModifierPropertyName;
  if (!MOTION_SHAPE_MODIFIER_PROPERTY_NAMES.includes(modifierProperty)) {
    return null;
  }
  return { modifierId: match[1], property: modifierProperty };
}

export function getMotionShapeModifierPropertyDescriptors(
  modifier: MotionShapeModifier,
): readonly MotionShapeModifierPropertyDescriptor[] {
  return MOTION_SHAPE_MODIFIER_PROPERTY_DESCRIPTORS[modifier.type];
}

export function getMotionShapeModifierPropertyDescriptor(
  modifier: MotionShapeModifier,
  property: MotionShapeModifierPropertyName,
): MotionShapeModifierPropertyDescriptor | undefined {
  return getMotionShapeModifierPropertyDescriptors(modifier).find(
    (descriptor) => descriptor.property === property,
  );
}

export function getMotionShapeModifierPropertyValue(
  modifier: MotionShapeModifier,
  property: MotionShapeModifierPropertyName,
): number {
  const descriptor = getMotionShapeModifierPropertyDescriptor(modifier, property);
  switch (modifier.type) {
    case "trim-paths":
      if (property === "start") return modifier.start;
      if (property === "end") return modifier.end;
      if (property === "offset") return modifier.offset;
      break;
    case "repeater":
      if (property === "copies") return modifier.copies;
      if (property === "offset") return modifier.offset;
      if (property === "position.x") return modifier.transform.position.x;
      if (property === "position.y") return modifier.transform.position.y;
      if (property === "scale.x") return modifier.transform.scale.x;
      if (property === "scale.y") return modifier.transform.scale.y;
      if (property === "rotation") return modifier.transform.rotation;
      if (property === "opacity") return modifier.transform.opacity;
      break;
    case "zig-zag":
      if (property === "size") return modifier.size;
      if (property === "ridgesPerSegment") return modifier.ridgesPerSegment;
      break;
    case "round-corners":
      if (property === "radius") return modifier.radius;
      if (property === "segments") return modifier.segments;
      break;
    case "wiggle-paths":
      if (property === "size") return modifier.size;
      if (property === "detail") return modifier.detail;
      if (property === "speed") return modifier.speed;
      if (property === "seed") return modifier.seed;
      break;
    case "offset-paths":
      if (property === "amount") return modifier.amount;
      break;
    case "pucker-bloat":
      if (property === "amount") return modifier.amount;
      break;
    case "twist":
      if (property === "angle") return modifier.angle;
      break;
  }
  return descriptor?.defaultValue ?? 0;
}

export function setMotionShapeModifierPropertyValue(
  modifier: MotionShapeModifier,
  property: MotionShapeModifierPropertyName,
  value: number,
): MotionShapeModifier {
  switch (modifier.type) {
    case "trim-paths":
      if (property === "start") {
        return sanitizeMotionShapeModifier({ ...modifier, start: value });
      }
      if (property === "end") {
        return sanitizeMotionShapeModifier({ ...modifier, end: value });
      }
      if (property === "offset") {
        return sanitizeMotionShapeModifier({ ...modifier, offset: value });
      }
      return modifier;
    case "repeater":
      if (property === "copies") {
        return sanitizeMotionShapeModifier({ ...modifier, copies: value });
      }
      if (property === "offset") {
        return sanitizeMotionShapeModifier({ ...modifier, offset: value });
      }
      if (property === "position.x") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: {
            ...modifier.transform,
            position: { ...modifier.transform.position, x: value },
          },
        });
      }
      if (property === "position.y") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: {
            ...modifier.transform,
            position: { ...modifier.transform.position, y: value },
          },
        });
      }
      if (property === "scale.x") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: {
            ...modifier.transform,
            scale: { ...modifier.transform.scale, x: value },
          },
        });
      }
      if (property === "scale.y") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: {
            ...modifier.transform,
            scale: { ...modifier.transform.scale, y: value },
          },
        });
      }
      if (property === "rotation") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: { ...modifier.transform, rotation: value },
        });
      }
      if (property === "opacity") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          transform: { ...modifier.transform, opacity: value },
        });
      }
      return modifier;
    case "zig-zag":
      if (property === "size") {
        return sanitizeMotionShapeModifier({ ...modifier, size: value });
      }
      if (property === "ridgesPerSegment") {
        return sanitizeMotionShapeModifier({
          ...modifier,
          ridgesPerSegment: value,
        });
      }
      return modifier;
    case "round-corners":
      if (property === "radius") {
        return sanitizeMotionShapeModifier({ ...modifier, radius: value });
      }
      if (property === "segments") {
        return sanitizeMotionShapeModifier({ ...modifier, segments: value });
      }
      return modifier;
    case "wiggle-paths":
      if (property === "size") {
        return sanitizeMotionShapeModifier({ ...modifier, size: value });
      }
      if (property === "detail") {
        return sanitizeMotionShapeModifier({ ...modifier, detail: value });
      }
      if (property === "speed") {
        return sanitizeMotionShapeModifier({ ...modifier, speed: value });
      }
      if (property === "seed") {
        return sanitizeMotionShapeModifier({ ...modifier, seed: value });
      }
      return modifier;
    case "offset-paths":
      if (property === "amount") {
        return sanitizeMotionShapeModifier({ ...modifier, amount: value });
      }
      return modifier;
    case "pucker-bloat":
      if (property === "amount") {
        return sanitizeMotionShapeModifier({ ...modifier, amount: value });
      }
      return modifier;
    case "twist":
      if (property === "angle") {
        return sanitizeMotionShapeModifier({ ...modifier, angle: value });
      }
      return modifier;
  }
}

export function evaluateMotionShapeModifiersAtTime<T extends MotionShapeLayer>(
  layer: T,
  localTime: number,
  composition?: MotionComposition,
): T {
  if (!layer.modifiers?.length) return layer;
  const context = composition ? { composition, layer } : undefined;
  return {
    ...layer,
    modifiers: layer.modifiers.map((modifier) =>
      getMotionShapeModifierPropertyDescriptors(modifier).reduce<MotionShapeModifier>(
        (current, descriptor) =>
          setMotionShapeModifierPropertyValue(
            current,
            descriptor.property,
            evaluateMotionPropertyValueAtTime({
              keyframes: layer.keyframes,
              expressions: layer.expressions,
              property: getMotionShapeModifierKeyframeProperty(
                modifier.id,
                descriptor.property,
              ),
              localTime,
              fallback: getMotionShapeModifierPropertyValue(
                modifier,
                descriptor.property,
              ),
              duration: layer.duration,
              context,
            }),
          ),
        modifier,
      ),
    ),
  } as T;
}

export function getMotionRepeaterCopies(
  repeater: MotionRepeaterModifier | undefined,
): MotionRepeaterCopyTransform[] {
  if (!repeater?.enabled) {
    return [createRepeaterCopy(0, 0, undefined)];
  }
  const normalized = normalizeRepeater(repeater);
  return Array.from({ length: normalized.copies }, (_, index) =>
    createRepeaterCopy(index, index + normalized.offset, normalized),
  );
}

export function buildMotionShapePolyline(
  sourceLayer: MotionShapeLayer,
  samples = 96,
  localTime?: number,
): MotionShapePathPoint[] {
  const layer =
    localTime === undefined
      ? sourceLayer
      : evaluateMotionShapeModifiersAtTime(sourceLayer, localTime);
  const width = Math.max(0.001, layer.width);
  const height = Math.max(0.001, layer.height);
  const y = -height / 2;
  const buildFinalPoints = (
    points: readonly MotionShapePathPoint[],
  ): MotionShapePathPoint[] => {
    const shaped = applyMotionWigglePathsToPoints(
      applyMotionRoundCornersToPoints(
        applyMotionZigZagToPoints(points, getMotionZigZagModifier(layer)),
        getMotionRoundCornersModifier(layer),
      ),
      getMotionWigglePathsModifier(layer),
      localTime ?? 0,
    );
    const offset = applyOffsetPathsModifier(
      shaped,
      getMotionOffsetPathsModifier(layer),
    );
    const puckered = applyPuckerBloatModifier(
      offset,
      getMotionPuckerBloatModifier(layer),
    );
    const twisted = applyTwistModifier(puckered, getMotionTwistModifier(layer));
    return applyMotionPuppetPinsToPoints(twisted, layer.puppetPins);
  };

  if (layer.shapeType === "path") {
    const points = parseMotionPathData(
      localTime === undefined
        ? layer.pathData
        : getMotionShapePathDataAtTime(layer, localTime),
    );
    return buildFinalPoints(
      points.length > 1 ? points : rectanglePolyline(width, height),
    );
  }

  if (layer.shapeType === "circle" || layer.shapeType === "ellipse") {
    const count = Math.max(12, samples);
    return buildFinalPoints(
      Array.from({ length: count + 1 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / count;
        return {
          x: Math.cos(angle) * (width / 2),
          y: Math.sin(angle) * (height / 2),
        };
      }),
    );
  }

  if (layer.shapeType === "triangle") {
    return buildFinalPoints([
      { x: 0, y },
      { x: width / 2, y: height / 2 },
      { x: -width / 2, y: height / 2 },
      { x: 0, y },
    ]);
  }

  if (layer.shapeType === "star") {
    const points: MotionShapePathPoint[] = [];
    const outerRadius = Math.min(width, height) / 2;
    const starPointCount = Math.round(clamp(layer.style.points ?? 5, 3, 24));
    const innerRatio = clamp(layer.style.innerRadius ?? 0.45, 0.05, 0.95);
    const innerRadius = outerRadius * innerRatio;
    const vertexCount = starPointCount * 2;
    for (let index = 0; index <= vertexCount; index += 1) {
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / vertexCount;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    return buildFinalPoints(points);
  }

  if (layer.shapeType === "line") {
    return buildFinalPoints([
      { x: -width / 2, y: 0 },
      { x: width / 2, y: 0 },
    ]);
  }

  if (layer.shapeType === "polygon") {
    const sides = Math.round(clamp(layer.style.points ?? 5, 3, 24));
    const radiusX = width / 2;
    const radiusY = height / 2;
    const points: MotionShapePathPoint[] = [];
    for (let index = 0; index <= sides; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / sides;
      points.push({
        x: Math.cos(angle) * radiusX,
        y: Math.sin(angle) * radiusY,
      });
    }
    return buildFinalPoints(points);
  }

  if (layer.shapeType === "arrow") {
    return buildFinalPoints(arrowPolyline(width, height));
  }

  return buildFinalPoints(rectanglePolyline(width, height));
}

export function getTrimmedMotionPathPoints(
  points: readonly MotionShapePathPoint[],
  trim: MotionTrimPathsModifier | undefined,
): MotionShapePathPoint[] {
  if (!trim?.enabled) return [...points];
  const normalized = normalizeTrimPaths(trim);

  const closed = ensureClosedPath(points);
  if (normalized.start === 0 && normalized.end === 100) return closed;
  if (normalized.start === normalized.end) return [];

  const totalLength = getPathLength(closed);
  if (totalLength <= 0) return [];

  const offset = normalized.offset / 360;
  const start = normalizeUnit(normalized.start / 100 + offset);
  const end = normalizeUnit(normalized.end / 100 + offset);

  if (start < end) {
    return getPathRange(closed, start * totalLength, end * totalLength);
  }

  return [
    ...getPathRange(closed, start * totalLength, totalLength),
    ...getPathRange(closed, 0, end * totalLength).slice(1),
  ];
}

export function buildMotionSvgPathData(
  points: readonly MotionShapePathPoint[],
): string {
  return buildMotionPathData(points);
}

export function drawMotionPath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  points: readonly MotionShapePathPoint[],
): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
}

function sanitizeMotionShapeModifier(
  modifier: MotionShapeModifier,
): MotionShapeModifier {
  if (modifier.type === "trim-paths") {
    return normalizeTrimPaths(modifier);
  }
  if (modifier.type === "repeater") {
    return normalizeRepeater(modifier);
  }
  if (modifier.type === "zig-zag") {
    return normalizeZigZag(modifier);
  }
  if (modifier.type === "round-corners") {
    return normalizeRoundCorners(modifier);
  }
  if (modifier.type === "wiggle-paths") {
    return normalizeWigglePaths(modifier);
  }
  if (modifier.type === "offset-paths") {
    return normalizeOffsetPaths(modifier);
  }
  if (modifier.type === "pucker-bloat") {
    return normalizePuckerBloat(modifier);
  }
  return normalizeTwist(modifier);
}

function normalizeOffsetPaths(
  modifier: MotionOffsetPathsModifier,
): MotionOffsetPathsModifier {
  const join =
    modifier.lineJoin === "round" || modifier.lineJoin === "bevel"
      ? modifier.lineJoin
      : "miter";
  return {
    ...modifier,
    amount: clamp(modifier.amount, -4000, 4000),
    lineJoin: join,
  };
}

function normalizePuckerBloat(
  modifier: MotionPuckerBloatModifier,
): MotionPuckerBloatModifier {
  return {
    ...modifier,
    amount: clamp(modifier.amount, -100, 100),
  };
}

function normalizeTwist(modifier: MotionTwistModifier): MotionTwistModifier {
  return {
    ...modifier,
    angle: clamp(modifier.angle, -3600, 3600),
    center: {
      x: finite(modifier.center.x, 0),
      y: finite(modifier.center.y, 0),
    },
  };
}

function normalizeTrimPaths(
  modifier: MotionTrimPathsModifier,
): MotionTrimPathsModifier {
  return {
    ...modifier,
    start: clamp(modifier.start, 0, 100),
    end: clamp(modifier.end, 0, 100),
    offset: finite(modifier.offset, 0),
  };
}

function normalizeRepeater(
  modifier: MotionRepeaterModifier,
): MotionRepeaterModifier {
  return {
    ...modifier,
    copies: Math.round(clamp(modifier.copies, 1, 256)),
    offset: finite(modifier.offset, 0),
    transform: {
      position: {
        x: finite(modifier.transform.position.x, 0),
        y: finite(modifier.transform.position.y, 0),
      },
      scale: {
        x: Math.max(0.001, finite(modifier.transform.scale.x, 1)),
        y: Math.max(0.001, finite(modifier.transform.scale.y, 1)),
      },
      rotation: finite(modifier.transform.rotation, 0),
      opacity: clamp(modifier.transform.opacity, 0, 1),
    },
  };
}

function normalizeZigZag(
  modifier: MotionZigZagModifier,
): MotionZigZagModifier {
  return {
    ...modifier,
    size: clamp(modifier.size, -4000, 4000),
    ridgesPerSegment: Math.round(clamp(modifier.ridgesPerSegment, 0, 128)),
  };
}

function normalizeRoundCorners(
  modifier: MotionRoundCornersModifier,
): MotionRoundCornersModifier {
  return {
    ...modifier,
    radius: clamp(modifier.radius, 0, 4000),
    segments: Math.round(clamp(modifier.segments, 1, 48)),
  };
}

function normalizeWigglePaths(
  modifier: MotionWigglePathsModifier,
): MotionWigglePathsModifier {
  return {
    ...modifier,
    size: clamp(modifier.size, 0, 4000),
    detail: Math.round(clamp(modifier.detail, 0, 32)),
    speed: clamp(modifier.speed, 0, 60),
    seed: Math.round(finite(modifier.seed, 1)),
  };
}

function applyMotionZigZagToPoints(
  points: readonly MotionShapePathPoint[],
  modifier: MotionZigZagModifier | undefined,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizeZigZag(modifier);
  if (
    points.length < 2 ||
    normalized.ridgesPerSegment <= 0 ||
    Math.abs(normalized.size) <= 0.0001
  ) {
    return [...points];
  }

  const result: MotionShapePathPoint[] = [];
  let ridgeIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (result.length === 0) {
      result.push({ ...from });
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) {
      result.push({ ...to });
      continue;
    }

    const normalX = -dy / length;
    const normalY = dx / length;
    for (let ridge = 1; ridge <= normalized.ridgesPerSegment; ridge += 1) {
      const t = ridge / (normalized.ridgesPerSegment + 1);
      const sign = ridgeIndex % 2 === 0 ? 1 : -1;
      result.push({
        x: lerp(from.x, to.x, t) + normalX * normalized.size * sign,
        y: lerp(from.y, to.y, t) + normalY * normalized.size * sign,
      });
      ridgeIndex += 1;
    }
    result.push({ ...to });
  }
  return result;
}

function applyMotionWigglePathsToPoints(
  points: readonly MotionShapePathPoint[],
  modifier: MotionWigglePathsModifier | undefined,
  localTime: number,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizeWigglePaths(modifier);
  if (points.length < 2 || normalized.size <= 0.0001) return [...points];

  const closed = samePoint(points[0], points[points.length - 1]);
  const detailed = addWiggleDetailPoints(points, normalized.detail);
  const result = detailed.map((point, index) => {
    const isOpenEndpoint =
      !closed && (index === 0 || index === detailed.length - 1);
    if (isOpenEndpoint) return { ...point };
    return {
      x:
        point.x +
        smoothSeededOscillation(normalized.seed, index, 0, localTime, normalized.speed) *
          normalized.size,
      y:
        point.y +
        smoothSeededOscillation(normalized.seed, index, 1, localTime, normalized.speed) *
          normalized.size,
    };
  });

  if (closed && result.length > 1) {
    result[result.length - 1] = { ...result[0] };
  }
  return result;
}

function applyMotionRoundCornersToPoints(
  points: readonly MotionShapePathPoint[],
  modifier: MotionRoundCornersModifier | undefined,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizeRoundCorners(modifier);
  if (points.length < 3 || normalized.radius <= 0.0001) return [...points];

  const closed = samePoint(points[0], points[points.length - 1]);
  const vertices = closed ? points.slice(0, -1) : [...points];
  if ((!closed && vertices.length < 3) || (closed && vertices.length < 3)) {
    return [...points];
  }

  const result: MotionShapePathPoint[] = [];
  const lastIndex = vertices.length - 1;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const isOpenEndpoint = !closed && (index === 0 || index === lastIndex);
    if (isOpenEndpoint) {
      pushPoint(result, current);
      continue;
    }

    const previous = vertices[index === 0 ? lastIndex : index - 1];
    const next = vertices[index === lastIndex ? 0 : index + 1];
    const incomingLength = distance(previous, current);
    const outgoingLength = distance(current, next);
    const radius = Math.min(
      normalized.radius,
      incomingLength / 2,
      outgoingLength / 2,
    );

    if (radius <= 0.0001 || incomingLength <= 0.0001 || outgoingLength <= 0.0001) {
      pushPoint(result, current);
      continue;
    }

    const start = offsetPointToward(current, previous, radius);
    const end = offsetPointToward(current, next, radius);
    pushPoint(result, start);
    for (let segment = 1; segment <= normalized.segments; segment += 1) {
      const t = segment / normalized.segments;
      pushPoint(result, quadraticPoint(start, current, end, t));
    }
  }

  if (closed && result.length > 1) {
    pushPoint(result, result[0]);
  }
  return result.length > 0 ? result : [...points];
}

function applyOffsetPathsModifier(
  points: readonly MotionShapePathPoint[],
  modifier: MotionOffsetPathsModifier | undefined,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizeOffsetPaths(modifier);
  return applyMotionOffsetPathsToPoints(
    points,
    normalized.amount,
    normalized.lineJoin,
  );
}

function applyPuckerBloatModifier(
  points: readonly MotionShapePathPoint[],
  modifier: MotionPuckerBloatModifier | undefined,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizePuckerBloat(modifier);
  return applyMotionPuckerBloatToPoints(points, normalized.amount);
}

function applyTwistModifier(
  points: readonly MotionShapePathPoint[],
  modifier: MotionTwistModifier | undefined,
): MotionShapePathPoint[] {
  if (!modifier?.enabled) return [...points];
  const normalized = normalizeTwist(modifier);
  return applyMotionTwistToPoints(points, normalized.angle, normalized.center);
}

function signedArea(vertices: readonly MotionShapePathPoint[]): number {
  let sum = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function polygonCentroid(
  vertices: readonly MotionShapePathPoint[],
): MotionShapePathPoint {
  let x = 0;
  let y = 0;
  for (const vertex of vertices) {
    x += vertex.x;
    y += vertex.y;
  }
  return { x: x / vertices.length, y: y / vertices.length };
}

export function applyMotionOffsetPathsToPoints(
  points: readonly MotionShapePathPoint[],
  amount: number,
  join: "miter" | "round" | "bevel",
): MotionShapePathPoint[] {
  if (points.length < 3 || !Number.isFinite(amount) || Math.abs(amount) <= 0.0001) {
    return points.map((point) => ({ ...point }));
  }
  const closed = samePoint(points[0], points[points.length - 1]);
  if (!closed) {
    return points.map((point) => ({ ...point }));
  }

  const vertices = points.slice(0, -1);
  if (vertices.length < 3) {
    return points.map((point) => ({ ...point }));
  }

  const orientation = signedArea(vertices) >= 0 ? 1 : -1;
  const count = vertices.length;
  const edgeNormals: MotionShapePathPoint[] = vertices.map((current, index) => {
    const next = vertices[(index + 1) % count];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.0001) return { x: 0, y: 0 };
    return {
      x: (dy / length) * orientation,
      y: (-dx / length) * orientation,
    };
  });

  const displaced: MotionShapePathPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const current = vertices[index];
    const incoming = edgeNormals[(index - 1 + count) % count];
    const outgoing = edgeNormals[index];
    const bisectorX = incoming.x + outgoing.x;
    const bisectorY = incoming.y + outgoing.y;
    const bisectorLength = Math.hypot(bisectorX, bisectorY);

    if (bisectorLength <= 0.0001) {
      displaced.push({
        x: current.x + incoming.x * amount,
        y: current.y + incoming.y * amount,
      });
      continue;
    }

    const unitX = bisectorX / bisectorLength;
    const unitY = bisectorY / bisectorLength;
    const cosHalf = unitX * incoming.x + unitY * incoming.y;
    const miter = cosHalf > 0.0001 ? 1 / cosHalf : OFFSET_MITER_LIMIT;

    if (join === "miter" && miter <= OFFSET_MITER_LIMIT) {
      displaced.push({
        x: current.x + unitX * amount * miter,
        y: current.y + unitY * amount * miter,
      });
      continue;
    }

    if (join === "round") {
      const near = {
        x: current.x + incoming.x * amount,
        y: current.y + incoming.y * amount,
      };
      const far = {
        x: current.x + outgoing.x * amount,
        y: current.y + outgoing.y * amount,
      };
      displaced.push(near);
      displaced.push({
        x: current.x + unitX * amount,
        y: current.y + unitY * amount,
      });
      displaced.push(far);
      continue;
    }

    displaced.push({
      x: current.x + incoming.x * amount,
      y: current.y + incoming.y * amount,
    });
    displaced.push({
      x: current.x + outgoing.x * amount,
      y: current.y + outgoing.y * amount,
    });
  }

  const ring = displaced.map((point) => ({ x: point.x, y: point.y }));
  const cleaned = mergeMotionShapeRings([[ring]], "union");
  const largest = pickLargestRingSet(cleaned);
  if (!largest) {
    displaced.push({ ...displaced[0] });
    return displaced;
  }

  const outerRing = largest[0];
  const result = outerRing.map((point) => ({ x: point.x, y: point.y }));
  if (result.length > 0) {
    result.push({ ...result[0] });
  }
  return result;
}

function pickLargestRingSet(
  ringSets: MotionVector2[][][],
): MotionVector2[][] | null {
  let best: MotionVector2[][] | null = null;
  let bestArea = -Infinity;
  for (const ringSet of ringSets) {
    if (ringSet.length === 0) continue;
    const area = Math.abs(signedArea(ringSet[0]));
    if (area > bestArea) {
      bestArea = area;
      best = ringSet;
    }
  }
  return best;
}

export function applyMotionPuckerBloatToPoints(
  points: readonly MotionShapePathPoint[],
  amount: number,
): MotionShapePathPoint[] {
  if (points.length === 0 || !Number.isFinite(amount) || Math.abs(amount) <= 0.0001) {
    return points.map((point) => ({ ...point }));
  }
  const closed = points.length > 1 && samePoint(points[0], points[points.length - 1]);
  const vertices = closed ? points.slice(0, -1) : [...points];
  if (vertices.length === 0) {
    return points.map((point) => ({ ...point }));
  }

  const centroid = polygonCentroid(vertices);
  const factor = amount / 100;
  const moved = vertices.map((vertex) => ({
    x: vertex.x + (vertex.x - centroid.x) * factor,
    y: vertex.y + (vertex.y - centroid.y) * factor,
  }));

  if (closed && moved.length > 0) {
    moved.push({ ...moved[0] });
  }
  return moved;
}

export function applyMotionTwistToPoints(
  points: readonly MotionShapePathPoint[],
  angleDeg: number,
  center: MotionVector2,
): MotionShapePathPoint[] {
  if (points.length === 0 || !Number.isFinite(angleDeg) || Math.abs(angleDeg) <= 0.0001) {
    return points.map((point) => ({ ...point }));
  }

  const centerX = Number.isFinite(center.x) ? center.x : 0;
  const centerY = Number.isFinite(center.y) ? center.y : 0;

  let maxDist = 0;
  for (const point of points) {
    const dist = Math.hypot(point.x - centerX, point.y - centerY);
    if (dist > maxDist) maxDist = dist;
  }
  if (maxDist <= 0.0001) {
    return points.map((point) => ({ ...point }));
  }

  const angleRad = (angleDeg * Math.PI) / 180;
  return points.map((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const dist = Math.hypot(dx, dy);
    const localAngle = angleRad * (1 - dist / maxDist);
    const cos = Math.cos(localAngle);
    const sin = Math.sin(localAngle);
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos,
    };
  });
}

export function applyMotionShapeOperatorStack(
  ringSets: MotionVector2[][][],
  operators: readonly MotionShapeModifier[],
  options: { readonly localTime?: number } = {},
): MotionVector2[][][] {
  const localTime = options.localTime ?? 0;
  let current: MotionVector2[][][] = ringSets.map((set) =>
    set.map((ring) => ring.map((point) => ({ x: point.x, y: point.y }))),
  );

  for (const operator of operators) {
    if (operator.type !== "trim-paths" && !operator.enabled) {
      continue;
    }

    if (operator.type === "repeater") {
      current = applyRepeaterToRingSets(current, operator);
      continue;
    }

    current = current.map((set) =>
      applyOperatorToRingSet(set, operator, localTime),
    );
  }

  return current;
}

function applyOperatorToRingSet(
  set: MotionVector2[][],
  operator: MotionShapeModifier,
  localTime: number,
): MotionVector2[][] {
  return set
    .map((ring) => applyOperatorToRing(ring, operator, localTime))
    .filter((ring) => ring.length > 0);
}

function applyOperatorToRing(
  ring: MotionVector2[],
  operator: MotionShapeModifier,
  localTime: number,
): MotionVector2[] {
  const points: MotionShapePathPoint[] = ring.map((point) => ({
    x: point.x,
    y: point.y,
  }));

  switch (operator.type) {
    case "trim-paths":
      return operator.enabled
        ? getTrimmedMotionPathPoints(points, operator).map((point) => ({
            x: point.x,
            y: point.y,
          }))
        : points;
    case "zig-zag":
      return applyMotionZigZagToPoints(points, operator);
    case "round-corners":
      return applyMotionRoundCornersToPoints(points, operator);
    case "wiggle-paths":
      return applyMotionWigglePathsToPoints(points, operator, localTime);
    case "offset-paths":
      return applyMotionOffsetPathsToPoints(
        points,
        operator.amount,
        operator.lineJoin,
      );
    case "pucker-bloat":
      return applyMotionPuckerBloatToPoints(points, operator.amount);
    case "twist":
      return applyMotionTwistToPoints(points, operator.angle, operator.center);
    case "repeater":
      return points;
  }
}

function applyRepeaterToRingSets(
  ringSets: MotionVector2[][][],
  repeater: MotionRepeaterModifier,
): MotionVector2[][][] {
  const copies = getMotionRepeaterCopies(repeater);
  const expanded: MotionVector2[][][] = [];
  for (const set of ringSets) {
    for (const copy of copies) {
      expanded.push(set.map((ring) => bakeRepeaterCopy(ring, copy)));
    }
  }
  return expanded;
}

function bakeRepeaterCopy(
  ring: MotionVector2[],
  copy: MotionRepeaterCopyTransform,
): MotionVector2[] {
  const rotationRad = (copy.rotation * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return ring.map((point) => {
    const scaledX = point.x * copy.scale.x;
    const scaledY = point.y * copy.scale.y;
    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;
    return {
      x: rotatedX + copy.position.x,
      y: rotatedY + copy.position.y,
    };
  });
}

function addWiggleDetailPoints(
  points: readonly MotionShapePathPoint[],
  detail: number,
): MotionShapePathPoint[] {
  if (detail <= 0 || points.length < 2) return [...points];
  const result: MotionShapePathPoint[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (result.length === 0) {
      result.push({ ...from });
    }
    for (let segment = 1; segment <= detail; segment += 1) {
      result.push(lerpPoint(from, to, segment / (detail + 1)));
    }
    result.push({ ...to });
  }
  return result;
}

function createRepeaterCopy(
  index: number,
  amount: number,
  repeater: MotionRepeaterModifier | undefined,
): MotionRepeaterCopyTransform {
  if (!repeater) {
    return {
      index,
      amount,
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      opacity: 1,
    };
  }

  return {
    index,
    amount,
    position: {
      x: repeater.transform.position.x * amount,
      y: repeater.transform.position.y * amount,
    },
    scale: {
      x: Math.pow(repeater.transform.scale.x, amount),
      y: Math.pow(repeater.transform.scale.y, amount),
    },
    rotation: repeater.transform.rotation * amount,
    opacity: Math.pow(repeater.transform.opacity, index),
  };
}

function getPathRange(
  points: readonly MotionShapePathPoint[],
  startDistance: number,
  endDistance: number,
): MotionShapePathPoint[] {
  const result: MotionShapePathPoint[] = [];
  let traveled = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLength = distance(from, to);
    const segmentStart = traveled;
    const segmentEnd = traveled + segmentLength;
    traveled = segmentEnd;

    if (segmentLength <= 0 || segmentEnd < startDistance || segmentStart > endDistance) {
      continue;
    }

    const startRatio = clamp((startDistance - segmentStart) / segmentLength, 0, 1);
    const endRatio = clamp((endDistance - segmentStart) / segmentLength, 0, 1);
    const startPoint = lerpPoint(from, to, startRatio);
    const endPoint = lerpPoint(from, to, endRatio);

    if (result.length === 0 || !samePoint(result[result.length - 1], startPoint)) {
      result.push(startPoint);
    }
    if (!samePoint(result[result.length - 1], endPoint)) {
      result.push(endPoint);
    }
  }

  return result;
}

function ensureClosedPath(
  points: readonly MotionShapePathPoint[],
): MotionShapePathPoint[] {
  if (points.length <= 1) return [...points];
  const last = points[points.length - 1];
  const first = points[0];
  if (samePoint(first, last)) return [...points];
  return [...points, first];
}

function getPathLength(points: readonly MotionShapePathPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

function distance(a: MotionShapePathPoint, b: MotionShapePathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(
  a: MotionShapePathPoint,
  b: MotionShapePathPoint,
  amount: number,
): MotionShapePathPoint {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

function quadraticPoint(
  start: MotionShapePathPoint,
  control: MotionShapePathPoint,
  end: MotionShapePathPoint,
  amount: number,
): MotionShapePathPoint {
  const inverse = 1 - amount;
  return {
    x:
      inverse * inverse * start.x +
      2 * inverse * amount * control.x +
      amount * amount * end.x,
    y:
      inverse * inverse * start.y +
      2 * inverse * amount * control.y +
      amount * amount * end.y,
  };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function offsetPointToward(
  from: MotionShapePathPoint,
  toward: MotionShapePathPoint,
  amount: number,
): MotionShapePathPoint {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0.0001) return { ...from };
  return {
    x: from.x + (dx / length) * amount,
    y: from.y + (dy / length) * amount,
  };
}

function smoothSeededOscillation(
  seed: number,
  index: number,
  channel: number,
  localTime: number,
  speed: number,
): number {
  if (speed <= 0) {
    return centeredHash(seed, index, channel);
  }
  const phase = centeredHash(seed, index, channel) * Math.PI * 2;
  const drift = centeredHash(seed + 73, index, channel) * Math.PI;
  const time = localTime * speed * Math.PI * 2;
  return clamp(
    Math.sin(time + phase) * 0.68 +
      Math.sin(time * 0.47 + phase * 1.7 + drift) * 0.32,
    -1,
    1,
  );
}

function centeredHash(seed: number, index: number, channel: number): number {
  const value =
    Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233 + channel * 37.719) *
    43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function pushPoint(
  points: MotionShapePathPoint[],
  point: MotionShapePathPoint,
): void {
  if (points.length === 0 || !samePoint(points[points.length - 1], point)) {
    points.push({ ...point });
  }
}

function samePoint(
  a: MotionShapePathPoint,
  b: MotionShapePathPoint,
): boolean {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function normalizeUnit(value: number): number {
  return ((value % 1) + 1) % 1;
}

function rectanglePolyline(width: number, height: number): MotionShapePathPoint[] {
  const x = -width / 2;
  const y = -height / 2;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
}

function arrowPolyline(width: number, height: number): MotionShapePathPoint[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const headLength = Math.min(width, height) * 0.6;
  const tailEndX = halfWidth - headLength;
  const shaftHalfHeight = halfHeight * 0.4;
  return [
    { x: -halfWidth, y: -shaftHalfHeight },
    { x: tailEndX, y: -shaftHalfHeight },
    { x: tailEndX, y: -halfHeight },
    { x: halfWidth, y: 0 },
    { x: tailEndX, y: halfHeight },
    { x: tailEndX, y: shaftHalfHeight },
    { x: -halfWidth, y: shaftHalfHeight },
    { x: -halfWidth, y: -shaftHalfHeight },
  ];
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finite(value, min)));
}
