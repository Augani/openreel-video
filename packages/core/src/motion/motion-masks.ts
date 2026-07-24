import { EASING_FUNCTIONS, type EasingName } from "../animation/easing-functions";
import type { EasingType, Keyframe } from "../types/timeline";
import type {
  MotionComposition,
  MotionLayer,
  MotionMask,
  MotionMaskShape,
  MotionVector2,
} from "./types";
import { evaluateMotionPropertyValueAtTime } from "./motion-expressions";
import {
  getMotionMaskKeyframeProperty,
  getMotionMaskPathKeyframeProperty,
  parseMotionMaskKeyframeProperty,
  parseMotionMaskPathKeyframeProperty,
  type MotionMaskPropertyName,
} from "./motion-keyframes";
import {
  buildMotionPathData,
  getMotionPathDrawCommands,
  interpolateMotionPathPoints,
  parseMotionPathSegments,
  type MotionShapePathPoint,
} from "./motion-shape-path";
import { getMotionParticleEmitterBounds } from "./motion-particles";

const MASK_PATH_SNAP_TOLERANCE = 1 / 1000;

export type MotionMaskPresetShape = Exclude<MotionMaskShape, "path">;

export interface MotionMaskPreset {
  readonly shape: MotionMaskPresetShape;
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionMask;
}

export interface MotionLayerVisualBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const createMaskId = (): string =>
  `motion-mask-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const MOTION_MASK_PRESETS: readonly MotionMaskPreset[] = [
  {
    shape: "rectangle",
    name: "Rectangle Mask",
    description: "Reveals a boxed region for wipes, crops, and UI panels.",
    create: (id = createMaskId()) => ({
      id,
      name: "Rectangle Mask",
      enabled: true,
      shape: "rectangle",
      mode: "add",
      inverted: false,
      x: 0.15,
      y: 0.15,
      width: 0.7,
      height: 0.7,
      rotation: 0,
      expansion: 0,
      feather: 0,
      opacity: 1,
    }),
  },
  {
    shape: "ellipse",
    name: "Ellipse Mask",
    description: "Creates circular reveals, spotlight crops, and soft framing.",
    create: (id = createMaskId()) => ({
      id,
      name: "Ellipse Mask",
      enabled: true,
      shape: "ellipse",
      mode: "add",
      inverted: false,
      x: 0.15,
      y: 0.15,
      width: 0.7,
      height: 0.7,
      rotation: 0,
      expansion: 0,
      feather: 0,
      opacity: 1,
    }),
  },
  {
    shape: "polygon",
    name: "Polygon Mask",
    description: "Freeform straight-edged mask for custom reveal shapes.",
    create: (id = createMaskId()) => ({
      id,
      name: "Polygon Mask",
      enabled: true,
      shape: "polygon",
      mode: "add",
      inverted: false,
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
      rotation: 0,
      expansion: 0,
      feather: 0,
      opacity: 1,
      points: DEFAULT_MOTION_MASK_POLYGON_POINTS,
    }),
  },
];

export const DEFAULT_MOTION_MASK_POLYGON_POINTS: readonly MotionVector2[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.38 },
  { x: 0.82, y: 1 },
  { x: 0.18, y: 1 },
  { x: 0, y: 0.38 },
];

export function getMotionMaskPolygonPoints(
  mask: MotionMask,
): readonly MotionVector2[] {
  const points = mask.points;
  if (!points || points.length < 3) {
    return DEFAULT_MOTION_MASK_POLYGON_POINTS;
  }
  return points;
}

function isFiniteHandle(value: number | undefined): boolean {
  return value === undefined || Number.isFinite(value);
}

function isValidMotionMaskPathPoint(point: MotionShapePathPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    isFiniteHandle(point.inX) &&
    isFiniteHandle(point.inY) &&
    isFiniteHandle(point.outX) &&
    isFiniteHandle(point.outY)
  );
}

export function getMotionMaskPathPoints(
  mask: MotionMask,
  _layer: MotionLayer,
  localTime?: number,
): MotionShapePathPoint[] | undefined {
  if (mask.shape !== "path") return undefined;
  if (localTime !== undefined && (mask.pathKeyframes?.length ?? 0) > 0) {
    return getMotionMaskPathPointsAtTime(mask, localTime);
  }
  const points = mask.pathPoints;
  if (!points || points.length < 3) return undefined;
  if (!points.every(isValidMotionMaskPathPoint)) return undefined;
  return points.map((point) => ({ ...point }));
}

function getMotionMaskPathKeyframes(mask: MotionMask): Keyframe[] {
  return (mask.pathKeyframes ?? [])
    .filter(
      (keyframe) =>
        typeof keyframe.value === "string" && keyframe.value.trim().length > 0,
    )
    .sort((a, b) => a.time - b.time);
}

export function normalizeMaskKeyframeTime(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Number(time.toFixed(4)));
}

function easeMaskProgress(progress: number, easing: EasingType): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const easingFn =
    easing in EASING_FUNCTIONS
      ? EASING_FUNCTIONS[easing as EasingName]
      : EASING_FUNCTIONS.ease;
  return Math.min(1, Math.max(0, easingFn(clamped)));
}

function readMaskPathKeyframeValue(keyframe: Keyframe): string | undefined {
  return typeof keyframe.value === "string" && keyframe.value.trim().length > 0
    ? keyframe.value
    : undefined;
}

function parseMaskPathKeyframePoints(
  keyframe: Keyframe,
): MotionShapePathPoint[] | undefined {
  const pathData = readMaskPathKeyframeValue(keyframe);
  if (!pathData) return undefined;
  const points = parseMotionPathSegments(pathData);
  return points.length >= 3 ? points : undefined;
}

export function getMotionMaskPathPointsAtTime(
  mask: MotionMask,
  localTime: number,
): MotionShapePathPoint[] | undefined {
  if (mask.shape !== "path") return undefined;
  const keyframes = getMotionMaskPathKeyframes(mask);
  if (keyframes.length === 0) {
    const points = mask.pathPoints;
    if (!points || points.length < 3) return undefined;
    if (!points.every(isValidMotionMaskPathPoint)) return undefined;
    return points.map((point) => ({ ...point }));
  }

  const time = Number.isFinite(localTime) ? localTime : 0;
  if (keyframes.length === 1 || time <= keyframes[0].time) {
    return parseMaskPathKeyframePoints(keyframes[0]);
  }
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) {
    return parseMaskPathKeyframePoints(last);
  }

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (time < from.time || time > to.time) continue;
    const fromPoints = parseMaskPathKeyframePoints(from);
    const toPoints = parseMaskPathKeyframePoints(to);
    if (!fromPoints || !toPoints) return undefined;
    const span = Math.max(0.001, to.time - from.time);
    const progress = Math.min(1, Math.max(0, (time - from.time) / span));
    const eased = easeMaskProgress(progress, from.easing);
    return interpolateMotionPathPoints(fromPoints, toPoints, eased);
  }

  return parseMaskPathKeyframePoints(last);
}

export function upsertMotionMaskPathKeyframe<T extends MotionLayer>(
  layer: T,
  maskId: string,
  time: number,
  pathData?: string,
  easing?: EasingType,
): T {
  const masks = layer.masks;
  if (!masks || !masks.some((mask) => mask.id === maskId)) return layer;

  const keyframeTime = normalizeMaskKeyframeTime(time);
  return {
    ...layer,
    masks: masks.map((mask) => {
      if (mask.id !== maskId) return mask;
      const resolved = (
        pathData ??
        (mask.pathPoints && mask.pathPoints.length >= 3
          ? buildMotionPathData(mask.pathPoints)
          : undefined)
      )?.trim();
      if (!resolved) return mask;

      const existing = getMotionMaskPathKeyframes(mask).find(
        (keyframe) =>
          Math.abs(keyframe.time - keyframeTime) <= MASK_PATH_SNAP_TOLERANCE,
      );
      const nextKeyframe: Keyframe = {
        id:
          existing?.id ??
          `motion-mask-path-kf-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
        time: keyframeTime,
        property: `mask.${maskId}.path`,
        value: resolved,
        easing: easing ?? existing?.easing ?? "ease",
      };
      const nextKeyframes = existing
        ? (mask.pathKeyframes ?? []).map((keyframe) =>
            keyframe.id === existing.id ? nextKeyframe : keyframe,
          )
        : [...(mask.pathKeyframes ?? []), nextKeyframe];
      return {
        ...mask,
        pathKeyframes: [...nextKeyframes].sort((a, b) => a.time - b.time),
      };
    }),
  } as T;
}

export function removeMotionMaskPathKeyframe<T extends MotionLayer>(
  layer: T,
  maskId: string,
  keyframeId: string,
): T {
  const masks = layer.masks;
  if (!masks || !masks.some((mask) => mask.id === maskId)) return layer;
  return {
    ...layer,
    masks: masks.map((mask) => {
      if (mask.id !== maskId) return mask;
      if (!mask.pathKeyframes || mask.pathKeyframes.length === 0) return mask;
      return {
        ...mask,
        pathKeyframes: mask.pathKeyframes.filter(
          (keyframe) => keyframe.id !== keyframeId,
        ),
      };
    }),
  } as T;
}

export function createMotionMask(
  shape: MotionMaskPresetShape,
  id?: string,
): MotionMask {
  const preset = MOTION_MASK_PRESETS.find((item) => item.shape === shape);
  if (!preset) {
    throw new Error(`Unsupported motion mask shape: ${shape}`);
  }
  return preset.create(id);
}

export function addMotionLayerMask<T extends MotionLayer>(
  layer: T,
  mask: MotionMask,
): T {
  return {
    ...layer,
    masks: [...(layer.masks ?? []), sanitizeMotionMask(mask)],
  } as T;
}

export type MotionMaskStackPasteMode = "append" | "replace";

export interface MotionMaskStackTransferResult<T extends MotionLayer> {
  readonly layer: T;
  readonly pastedMaskIds: readonly string[];
}

/**
 * Copies an ordered mask stack and its animation to another layer. Mask,
 * keyframe, and expression identities are regenerated and property paths are
 * remapped so the pasted stack remains independently editable.
 */
export function transferMotionMaskStack<T extends MotionLayer>(
  source: Pick<MotionLayer, "masks" | "keyframes" | "expressions">,
  target: T,
  mode: MotionMaskStackPasteMode = "append",
  createId: (
    kind: "mask" | "keyframe" | "expression",
    sourceId: string,
  ) => string = (kind) =>
    `motion-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
): MotionMaskStackTransferResult<T> {
  const sourceMasks = source.masks ?? [];
  if (sourceMasks.length === 0) return { layer: target, pastedMaskIds: [] };
  const sourceMaskIds = new Set(sourceMasks.map((mask) => mask.id));
  const idMap = new Map(
    sourceMasks.map((mask) => [mask.id, createId("mask", mask.id)]),
  );
  const clonedMasks = sourceMasks.map((mask) => {
    const nextMaskId = idMap.get(mask.id)!;
    return {
      ...structuredClone(mask),
      id: nextMaskId,
      pathKeyframes: mask.pathKeyframes?.map((keyframe) => ({
        ...structuredClone(keyframe),
        id: createId("keyframe", keyframe.id),
        property: getMotionMaskPathKeyframeProperty(nextMaskId),
        time: Math.max(0, Math.min(target.duration, keyframe.time)),
      })),
    };
  });

  const parseMaskProperty = (property: string) => {
    const standard = parseMotionMaskKeyframeProperty(property);
    if (standard) return { maskId: standard.maskId, property: standard.property };
    const path = parseMotionMaskPathKeyframeProperty(property);
    return path ? { maskId: path.maskId, property: "path" as const } : null;
  };
  const belongsTo = (property: string, ids: ReadonlySet<string>): boolean => {
    const parsed = parseMaskProperty(property);
    return parsed ? ids.has(parsed.maskId) : false;
  };
  const remapProperty = (property: string): string => {
    const parsed = parseMaskProperty(property);
    if (!parsed) return property;
    const nextMaskId = idMap.get(parsed.maskId);
    if (!nextMaskId) return property;
    return parsed.property === "path"
      ? getMotionMaskPathKeyframeProperty(nextMaskId)
      : getMotionMaskKeyframeProperty(nextMaskId, parsed.property);
  };

  const targetMaskIds = new Set((target.masks ?? []).map((mask) => mask.id));
  const retainedKeyframes =
    mode === "replace"
      ? target.keyframes.filter(
          (keyframe) => !belongsTo(keyframe.property, targetMaskIds),
        )
      : target.keyframes;
  const clonedKeyframes = source.keyframes
    .filter((keyframe) => belongsTo(keyframe.property, sourceMaskIds))
    .map((keyframe) => ({
      ...structuredClone(keyframe),
      id: createId("keyframe", keyframe.id),
      property: remapProperty(keyframe.property),
      time: Math.max(0, Math.min(target.duration, keyframe.time)),
    }));
  const retainedExpressions =
    mode === "replace"
      ? (target.expressions ?? []).filter(
          (expression) => !belongsTo(expression.property, targetMaskIds),
        )
      : (target.expressions ?? []);
  const clonedExpressions = (source.expressions ?? [])
    .filter((expression) => belongsTo(expression.property, sourceMaskIds))
    .map((expression) => ({
      ...structuredClone(expression),
      id: createId("expression", expression.id),
      property: remapProperty(expression.property),
    }));

  return {
    layer: {
      ...target,
      masks:
        mode === "replace"
          ? clonedMasks
          : [...(target.masks ?? []), ...clonedMasks],
      keyframes: [...retainedKeyframes, ...clonedKeyframes],
      expressions: [...retainedExpressions, ...clonedExpressions],
    } as T,
    pastedMaskIds: clonedMasks.map((mask) => mask.id),
  };
}

export function updateMotionLayerMask<T extends MotionLayer>(
  layer: T,
  maskId: string,
  updater: (mask: MotionMask) => MotionMask,
): T {
  return {
    ...layer,
    masks: (layer.masks ?? []).map((mask) =>
      mask.id === maskId ? sanitizeMotionMask(updater(mask)) : mask,
    ),
  } as T;
}

export function removeMotionLayerMask<T extends MotionLayer>(
  layer: T,
  maskId: string,
): T {
  return {
    ...layer,
    masks: (layer.masks ?? []).filter((mask) => mask.id !== maskId),
  } as T;
}

export function toggleMotionLayerMask<T extends MotionLayer>(
  layer: T,
  maskId: string,
  enabled: boolean,
): T {
  return updateMotionLayerMask(layer, maskId, (mask) => ({ ...mask, enabled }));
}

export function reorderMotionLayerMask<T extends MotionLayer>(
  layer: T,
  maskId: string,
  direction: -1 | 1,
): T {
  const masks = [...(layer.masks ?? [])];
  const index = masks.findIndex((mask) => mask.id === maskId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= masks.length) {
    return layer;
  }
  const [mask] = masks.splice(index, 1);
  masks.splice(nextIndex, 0, mask);
  return { ...layer, masks } as T;
}

export function getEnabledMotionMasks(layer: MotionLayer): MotionMask[] {
  return (layer.masks ?? []).filter((mask) => mask.enabled);
}

export function isAdvancedMotionMask(mask: MotionMask): boolean {
  return (
    mask.shape === "path" ||
    (mask.feather ?? 0) > 0.001 ||
    (mask.opacity ?? 1) < 0.999
  );
}

export function layerUsesAdvancedMotionMasks(layer: MotionLayer): boolean {
  return getEnabledMotionMasks(layer).some(isAdvancedMotionMask);
}

export function layerMayUseAdvancedMotionMasks(layer: MotionLayer): boolean {
  if (layerUsesAdvancedMotionMasks(layer)) return true;
  const isAdvancedProperty = (property: string): boolean => {
    const parsed = parseMotionMaskKeyframeProperty(property);
    return parsed?.property === "feather" || parsed?.property === "opacity";
  };
  return (
    layer.keyframes.some((keyframe) => isAdvancedProperty(keyframe.property)) ||
    (layer.expressions ?? []).some((expression) =>
      isAdvancedProperty(expression.property),
    )
  );
}

export function evaluateMotionLayerMasksAtTime<T extends MotionLayer>(
  layer: T,
  localTime: number,
  composition?: MotionComposition,
): T {
  if (!layer.masks || layer.masks.length === 0) return layer;
  return {
    ...layer,
    masks: layer.masks.map((mask) =>
      sanitizeMotionMask({
        ...mask,
        pathPoints: evaluateMaskPathPoints(mask, localTime),
        x: evaluateMaskProperty(layer, mask, "x", mask.x, localTime, composition),
        y: evaluateMaskProperty(layer, mask, "y", mask.y, localTime, composition),
        width: evaluateMaskProperty(
          layer,
          mask,
          "width",
          mask.width,
          localTime,
          composition,
        ),
        height: evaluateMaskProperty(
          layer,
          mask,
          "height",
          mask.height,
          localTime,
          composition,
        ),
        rotation: evaluateMaskProperty(
          layer,
          mask,
          "rotation",
          mask.rotation,
          localTime,
          composition,
        ),
        expansion: evaluateMaskProperty(
          layer,
          mask,
          "expansion",
          mask.expansion ?? 0,
          localTime,
          composition,
        ),
        feather: evaluateMaskProperty(
          layer,
          mask,
          "feather",
          mask.feather ?? 0,
          localTime,
          composition,
        ),
        opacity: evaluateMaskProperty(
          layer,
          mask,
          "opacity",
          mask.opacity ?? 1,
          localTime,
          composition,
        ),
      }),
    ),
  } as T;
}

export function getMotionLayerVisualBounds(
  layer: MotionLayer,
): MotionLayerVisualBounds {
  if (layer.type === "shape") {
    return {
      x: -layer.width / 2,
      y: -layer.height / 2,
      width: layer.width,
      height: layer.height,
    };
  }

  if (layer.type === "image" || layer.type === "video") {
    const width = layer.width ?? 320;
    const height = layer.height ?? 180;
    return { x: -width / 2, y: -height / 2, width, height };
  }

  if (layer.type === "composition") {
    return {
      x: -layer.width / 2,
      y: -layer.height / 2,
      width: layer.width,
      height: layer.height,
    };
  }

  if (layer.type === "adjustment") {
    return {
      x: -layer.width / 2,
      y: -layer.height / 2,
      width: layer.width,
      height: layer.height,
    };
  }

  if (layer.type === "particle") {
    return getMotionParticleEmitterBounds(layer.emitter);
  }

  if (layer.type === "scene3d") {
    const width = layer.width ?? 720;
    const height = layer.height ?? 720;
    return { x: -width / 2, y: -height / 2, width, height };
  }

  if (layer.type === "group") {
    return { x: -8, y: -8, width: 16, height: 16 };
  }

  if (layer.type === "null") {
    const size = Math.max(12, layer.guideSize ?? 48);
    return { x: -size / 2, y: -size / 2, width: size, height: size };
  }

  const lines = layer.text.split("\n");
  const fontSize = layer.style.fontSize;
  const lineHeight = layer.style.lineHeight ?? 1.1;
  const letterSpacing = layer.style.letterSpacing ?? 0;
  const widestLine = Math.max(...lines.map((line) => line.length), 1);
  const width = Math.max(1, widestLine * fontSize * 0.58 + letterSpacing * widestLine);
  const height = Math.max(1, lines.length * fontSize * lineHeight);
  return {
    x: -width / 2,
    y: -height / 2,
    width,
    height,
  };
}

export function buildMotionCssClipPath(
  layer: MotionLayer,
): string | undefined {
  if (layerUsesAdvancedMotionMasks(layer)) return undefined;

  const mask = getEnabledMotionMasks(layer).find(
    (candidate) =>
      candidate.mode === "add" &&
      !candidate.inverted &&
      candidate.shape !== "path" &&
      Math.abs(candidate.rotation) < 0.001,
  );
  if (!mask) return undefined;

  const bounds = getMotionLayerVisualBounds(layer);
  const rect = getExpandedMaskRect(bounds, mask);
  const left = clampPercent(rect.x);
  const top = clampPercent(rect.y);
  const right = clampPercent(1 - rect.x - rect.width);
  const bottom = clampPercent(1 - rect.y - rect.height);

  if (mask.shape === "rectangle") {
    return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  }

  if (mask.shape === "polygon") {
    const vertices = getMotionMaskPolygonPoints(mask)
      .map((point) => {
        const px = clampPercent(rect.x + point.x * rect.width);
        const py = clampPercent(rect.y + point.y * rect.height);
        return `${px}% ${py}%`;
      })
      .join(", ");
    return `polygon(${vertices})`;
  }

  const cx = clampPercent(rect.x + rect.width / 2);
  const cy = clampPercent(rect.y + rect.height / 2);
  const rx = clampPercent(rect.width / 2);
  const ry = clampPercent(rect.height / 2);
  return `ellipse(${rx}% ${ry}% at ${cx}% ${cy}%)`;
}

export function applyMotionLayerMasksToCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: MotionLayer,
): void {
  const masks = getEnabledMotionMasks(layer);
  if (masks.length === 0) return;

  const bounds = getMotionLayerVisualBounds(layer);
  const addPath = new Path2D();
  let hasAddMask = false;

  for (const mask of masks) {
    if (mask.mode === "add" && !mask.inverted) {
      if (appendMaskPath(addPath, bounds, mask, layer)) {
        hasAddMask = true;
      }
    }
  }

  if (hasAddMask) {
    ctx.clip(addPath);
  }

  for (const mask of masks) {
    if (mask.mode === "subtract" || mask.inverted) {
      const subtractPath = new Path2D();
      subtractPath.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      if (appendMaskPath(subtractPath, bounds, mask, layer)) {
        ctx.clip(subtractPath, "evenodd");
      }
    }
  }
}

export function paintMotionLayerMaskAlphaToCanvas(
  ctx: OffscreenCanvasRenderingContext2D,
  layer: MotionLayer,
): void {
  const masks = getEnabledMotionMasks(layer);
  if (masks.length === 0) return;

  const bounds = getMotionLayerVisualBounds(layer);
  const addPaths: { readonly mask: MotionMask; readonly path: Path2D }[] = [];
  for (const mask of masks) {
    if (mask.mode !== "add" || mask.inverted) continue;
    const path = new Path2D();
    if (!appendMaskPath(path, bounds, mask, layer)) continue;
    addPaths.push({ mask, path });
  }

  if (addPaths.length === 0) {
    const fullBoundsPath = new Path2D();
    fullBoundsPath.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    paintMaskPath(ctx, fullBoundsPath, 1, 0, "source-over");
  } else {
    for (const { mask, path } of addPaths) {
      paintMaskPath(
        ctx,
        path,
        clampAlpha(mask.opacity ?? 1),
        clampFeather(mask.feather ?? 0),
        "source-over",
      );
    }
  }

  for (const mask of masks) {
    if (mask.mode !== "subtract" && !mask.inverted) continue;
    const path = new Path2D();
    if (!appendMaskPath(path, bounds, mask, layer)) continue;
    paintMaskPath(
      ctx,
      path,
      clampAlpha(mask.opacity ?? 1),
      clampFeather(mask.feather ?? 0),
      "destination-out",
    );
  }
}

function appendMotionMaskPathCommands(
  path: Path2D,
  points: readonly MotionShapePathPoint[],
): void {
  const commands = getMotionPathDrawCommands(points);
  for (const command of commands) {
    if (command.type === "move") {
      path.moveTo(command.x, command.y);
    } else if (command.type === "line") {
      path.lineTo(command.x, command.y);
    } else {
      path.bezierCurveTo(
        command.c1x,
        command.c1y,
        command.c2x,
        command.c2y,
        command.x,
        command.y,
      );
    }
  }
  path.closePath();
}

function appendMaskPath(
  path: Path2D,
  bounds: MotionLayerVisualBounds,
  mask: MotionMask,
  layer: MotionLayer,
): boolean {
  if (mask.shape === "path") {
    const points = getMotionMaskPathPoints(mask, layer);
    if (!points) return false;
    appendMotionMaskPathCommands(path, points);
    return true;
  }

  const rect = getExpandedMaskRect(bounds, mask);
  const x = bounds.x + rect.x * bounds.width;
  const y = bounds.y + rect.y * bounds.height;
  const width = Math.max(0, rect.width * bounds.width);
  const height = Math.max(0, rect.height * bounds.height);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rotation = (mask.rotation * Math.PI) / 180;

  if (mask.shape === "ellipse") {
    path.ellipse(cx, cy, width / 2, height / 2, rotation, 0, Math.PI * 2);
    return true;
  }

  if (mask.shape === "polygon") {
    const points = getMotionMaskPolygonPoints(mask);
    if (points.length < 3) {
      path.rect(x, y, width, height);
      return true;
    }
    points.forEach((point, index) => {
      const vertex = rotatePoint(
        x + point.x * width,
        y + point.y * height,
        cx,
        cy,
        rotation,
      );
      if (index === 0) {
        path.moveTo(vertex.x, vertex.y);
      } else {
        path.lineTo(vertex.x, vertex.y);
      }
    });
    path.closePath();
    return true;
  }

  if (Math.abs(mask.rotation) < 0.001) {
    path.rect(x, y, width, height);
    return true;
  }

  const corners = [
    rotatePoint(x, y, cx, cy, rotation),
    rotatePoint(x + width, y, cx, cy, rotation),
    rotatePoint(x + width, y + height, cx, cy, rotation),
    rotatePoint(x, y + height, cx, cy, rotation),
  ];
  path.moveTo(corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) {
    path.lineTo(corner.x, corner.y);
  }
  path.closePath();
  return true;
}

function sanitizeMotionMask(mask: MotionMask): MotionMask {
  return {
    ...mask,
    x: clamp(mask.x, -4, 4),
    y: clamp(mask.y, -4, 4),
    width: clamp(mask.width, 0, 8),
    height: clamp(mask.height, 0, 8),
    rotation: normalizeRotation(mask.rotation),
    expansion: clamp(mask.expansion ?? 0, -100_000, 100_000),
    feather: clampFeather(mask.feather ?? 0),
    opacity: clampAlpha(mask.opacity ?? 1),
  };
}

function evaluateMaskPathPoints(
  mask: MotionMask,
  localTime: number,
): readonly MotionShapePathPoint[] | undefined {
  if (mask.shape !== "path") return mask.pathPoints;
  if ((mask.pathKeyframes?.length ?? 0) === 0) return mask.pathPoints;
  return getMotionMaskPathPointsAtTime(mask, localTime) ?? mask.pathPoints;
}

function evaluateMaskProperty(
  layer: MotionLayer,
  mask: MotionMask,
  property: MotionMaskPropertyName,
  fallback: number,
  localTime: number,
  composition?: MotionComposition,
): number {
  return evaluateMotionPropertyValueAtTime({
    keyframes: layer.keyframes,
    expressions: layer.expressions,
    property: getMotionMaskKeyframeProperty(mask.id, property),
    localTime,
    fallback,
    duration: layer.duration,
    context: composition ? { composition, layer } : undefined,
  });
}

function getExpandedMaskRect(
  bounds: MotionLayerVisualBounds,
  mask: MotionMask,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const expansion = clamp(mask.expansion ?? 0, -100_000, 100_000);
  const xExpansion = expansion / Math.max(0.001, bounds.width);
  const yExpansion = expansion / Math.max(0.001, bounds.height);
  return {
    x: clamp(mask.x, -4, 4) - xExpansion,
    y: clamp(mask.y, -4, 4) - yExpansion,
    width: Math.max(0, clamp(mask.width, 0, 8) + xExpansion * 2),
    height: Math.max(0, clamp(mask.height, 0, 8) + yExpansion * 2),
  };
}

function rotatePoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rotation: number,
): { readonly x: number; readonly y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  };
}

function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

function clampPercent(value: number): number {
  return Math.round(clamp(value, -4, 4) * 10_000) / 100;
}

function paintMaskPath(
  ctx: OffscreenCanvasRenderingContext2D,
  path: Path2D,
  opacity: number,
  feather: number,
  operation: GlobalCompositeOperation,
): void {
  if (opacity <= 0) return;

  if (feather <= 0) {
    ctx.save();
    ctx.globalCompositeOperation = operation;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = "#ffffff";
    ctx.fill(path);
    ctx.restore();
    return;
  }

  const maskCanvas = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
  const maskCtx = maskCanvas.getContext("2d", {
    alpha: true,
    willReadFrequently: false,
  });
  if (!maskCtx) return;

  maskCtx.setTransform(ctx.getTransform());
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fill(path);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = operation;
  ctx.globalAlpha = opacity;
  ctx.filter = `blur(${feather}px)`;
  ctx.drawImage(maskCanvas, 0, 0);
  ctx.restore();
}

function clampAlpha(value: number): number {
  return clamp(value, 0, 1);
}

function clampFeather(value: number): number {
  return clamp(value, 0, 100_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
