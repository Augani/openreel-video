import { EASING_FUNCTIONS, type EasingName } from "../animation/easing-functions";
import type { EasingType, Keyframe } from "../types/timeline";
import type { MotionShapeLayer } from "./types";

export interface MotionShapePathPoint {
  readonly x: number;
  readonly y: number;
  /** Absolute coordinates of the outgoing bezier control handle (toward the next point). */
  readonly outX?: number;
  readonly outY?: number;
  /** Absolute coordinates of the incoming bezier control handle (from the previous point). */
  readonly inX?: number;
  readonly inY?: number;
}

export type MotionPathDrawCommand =
  | { readonly type: "move"; readonly x: number; readonly y: number }
  | { readonly type: "line"; readonly x: number; readonly y: number }
  | {
      readonly type: "cubic";
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    };

export interface MotionPathBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CenteredMotionPath {
  readonly pathData: string;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly closed: boolean;
}

interface CubicControlState {
  readonly x: number;
  readonly y: number;
}

interface QuadraticControlState {
  readonly x: number;
  readonly y: number;
}

interface PathCursor {
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastCubicControl: CubicControlState | null;
  lastQuadraticControl: QuadraticControlState | null;
}

interface ArcParameters {
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
  readonly largeArc: boolean;
  readonly sweep: boolean;
  readonly end: MotionShapePathPoint;
}

const PATH_TOKEN_RE = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const CURVE_SAMPLES = 16;
const DEFAULT_MORPH_POINT_COUNT = 96;
const DEFAULT_SNAP_TOLERANCE = 1 / 1000;

export const MOTION_SHAPE_PATH_DATA_PROPERTY = "shape.pathData";

export interface MotionShapePathKeyframeOptions {
  readonly pathData?: string;
  readonly easing?: EasingType;
  readonly snapTolerance?: number;
  readonly idFactory?: () => string;
}

export interface SetMotionShapePathPointsOptions
  extends Omit<MotionShapePathKeyframeOptions, "pathData"> {
  readonly localTime?: number;
  readonly keyframe?: boolean;
}

export function parseMotionPathData(
  pathData: string | undefined,
  samples = CURVE_SAMPLES,
): MotionShapePathPoint[] {
  if (!pathData?.trim()) return [];
  const tokens = pathData.match(PATH_TOKEN_RE) ?? [];
  const points: MotionShapePathPoint[] = [];
  const cursor: PathCursor = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    lastCubicControl: null,
    lastQuadraticControl: null,
  };
  let index = 0;
  let command = "";

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }
    if (!command) break;

    const lowerCommand = command.toLowerCase();
    const relative = command === lowerCommand;

    if (lowerCommand === "z") {
      closeCurrentSubpath(points, cursor);
      command = "";
      continue;
    }

    if (lowerCommand === "m") {
      if (!hasNumbers(tokens, index, 2)) break;
      const point = readPoint(tokens, index, cursor, relative);
      index += 2;
      moveCursor(cursor, point.x, point.y);
      addPoint(points, point);
      command = relative ? "l" : "L";
      continue;
    }

    const parameterCount = getPathCommandParameterCount(lowerCommand);
    if (parameterCount === 0) {
      index += 1;
      continue;
    }

    while (hasNumbers(tokens, index, parameterCount)) {
      switch (lowerCommand) {
        case "l": {
          const point = readPoint(tokens, index, cursor, relative);
          index += 2;
          lineTo(points, cursor, point.x, point.y);
          break;
        }
        case "h": {
          const x = readNumber(tokens[index++], cursor.x);
          lineTo(points, cursor, relative ? cursor.x + x : x, cursor.y);
          break;
        }
        case "v": {
          const y = readNumber(tokens[index++], cursor.y);
          lineTo(points, cursor, cursor.x, relative ? cursor.y + y : y);
          break;
        }
        case "c": {
          const c1 = readPoint(tokens, index, cursor, relative);
          const c2 = readPoint(tokens, index + 2, cursor, relative);
          const end = readPoint(tokens, index + 4, cursor, relative);
          index += 6;
          cubicTo(points, cursor, c1, c2, end, samples);
          break;
        }
        case "s": {
          const c1 = reflectCubicControl(cursor);
          const c2 = readPoint(tokens, index, cursor, relative);
          const end = readPoint(tokens, index + 2, cursor, relative);
          index += 4;
          cubicTo(points, cursor, c1, c2, end, samples);
          break;
        }
        case "q": {
          const control = readPoint(tokens, index, cursor, relative);
          const end = readPoint(tokens, index + 2, cursor, relative);
          index += 4;
          quadraticTo(points, cursor, control, end, samples);
          break;
        }
        case "t": {
          const control = reflectQuadraticControl(cursor);
          const end = readPoint(tokens, index, cursor, relative);
          index += 2;
          quadraticTo(points, cursor, control, end, samples);
          break;
        }
        case "a": {
          const arc = readArcParameters(tokens, index, cursor, relative);
          index += 7;
          arcTo(points, cursor, arc, samples);
          break;
        }
        default:
          index += parameterCount;
          break;
      }

      if (index >= tokens.length || isCommand(tokens[index])) break;
    }
  }

  return points;
}

export function parseMotionPathSegments(
  pathData: string | undefined,
): MotionShapePathPoint[] {
  if (!pathData?.trim()) return [];
  const tokens = pathData.match(PATH_TOKEN_RE) ?? [];
  const points: MotionShapePathPoint[] = [];
  const cursor: PathCursor = {
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    lastCubicControl: null,
    lastQuadraticControl: null,
  };
  let index = 0;
  let command = "";

  const pushCorner = (x: number, y: number): void => {
    points.push({ x: finite(x, 0), y: finite(y, 0) });
  };
  const pushCurveEnd = (
    out: MotionShapePathPoint,
    inControl: MotionShapePathPoint,
    end: MotionShapePathPoint,
  ): void => {
    const last = points[points.length - 1];
    if (last) {
      points[points.length - 1] = { ...last, outX: out.x, outY: out.y };
    }
    points.push({
      x: finite(end.x, 0),
      y: finite(end.y, 0),
      inX: inControl.x,
      inY: inControl.y,
    });
  };
  const quadraticToCubic = (
    start: MotionShapePathPoint,
    control: MotionShapePathPoint,
    end: MotionShapePathPoint,
  ): { c1: MotionShapePathPoint; c2: MotionShapePathPoint } => ({
    c1: {
      x: start.x + (2 / 3) * (control.x - start.x),
      y: start.y + (2 / 3) * (control.y - start.y),
    },
    c2: {
      x: end.x + (2 / 3) * (control.x - end.x),
      y: end.y + (2 / 3) * (control.y - end.y),
    },
  });

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    if (!command) break;
    const lowerCommand = command.toLowerCase();
    const relative = command === lowerCommand;

    if (lowerCommand === "z") {
      pushCorner(cursor.startX, cursor.startY);
      cursor.x = cursor.startX;
      cursor.y = cursor.startY;
      cursor.lastCubicControl = null;
      cursor.lastQuadraticControl = null;
      command = "";
      continue;
    }
    if (lowerCommand === "m") {
      if (!hasNumbers(tokens, index, 2)) break;
      const point = readPoint(tokens, index, cursor, relative);
      index += 2;
      moveCursor(cursor, point.x, point.y);
      pushCorner(point.x, point.y);
      command = relative ? "l" : "L";
      continue;
    }

    const parameterCount = getPathCommandParameterCount(lowerCommand);
    if (parameterCount === 0) {
      index += 1;
      continue;
    }

    while (hasNumbers(tokens, index, parameterCount)) {
      switch (lowerCommand) {
        case "l": {
          const point = readPoint(tokens, index, cursor, relative);
          index += 2;
          pushCorner(point.x, point.y);
          cursor.x = point.x;
          cursor.y = point.y;
          cursor.lastCubicControl = null;
          cursor.lastQuadraticControl = null;
          break;
        }
        case "h": {
          const x = readNumber(tokens[index++], cursor.x);
          const nextX = relative ? cursor.x + x : x;
          pushCorner(nextX, cursor.y);
          cursor.x = nextX;
          cursor.lastCubicControl = null;
          cursor.lastQuadraticControl = null;
          break;
        }
        case "v": {
          const y = readNumber(tokens[index++], cursor.y);
          const nextY = relative ? cursor.y + y : y;
          pushCorner(cursor.x, nextY);
          cursor.y = nextY;
          cursor.lastCubicControl = null;
          cursor.lastQuadraticControl = null;
          break;
        }
        case "c":
        case "s": {
          const c1 =
            lowerCommand === "s"
              ? reflectCubicControl(cursor)
              : readPoint(tokens, index, cursor, relative);
          const offset = lowerCommand === "s" ? 0 : 2;
          const c2 = readPoint(tokens, index + offset, cursor, relative);
          const end = readPoint(tokens, index + offset + 2, cursor, relative);
          index += lowerCommand === "s" ? 4 : 6;
          pushCurveEnd(c1, c2, end);
          cursor.x = end.x;
          cursor.y = end.y;
          cursor.lastCubicControl = c2;
          cursor.lastQuadraticControl = null;
          break;
        }
        case "q":
        case "t": {
          const control =
            lowerCommand === "t"
              ? reflectQuadraticControl(cursor)
              : readPoint(tokens, index, cursor, relative);
          const endOffset = lowerCommand === "t" ? 0 : 2;
          const end = readPoint(tokens, index + endOffset, cursor, relative);
          index += lowerCommand === "t" ? 2 : 4;
          const { c1, c2 } = quadraticToCubic(
            { x: cursor.x, y: cursor.y },
            control,
            end,
          );
          pushCurveEnd(c1, c2, end);
          cursor.x = end.x;
          cursor.y = end.y;
          cursor.lastQuadraticControl = control;
          cursor.lastCubicControl = null;
          break;
        }
        case "a": {
          const arc = readArcParameters(tokens, index, cursor, relative);
          index += 7;
          const flat: MotionShapePathPoint[] = [];
          arcTo(flat, cursor, arc, CURVE_SAMPLES);
          for (const flatPoint of flat) {
            pushCorner(flatPoint.x, flatPoint.y);
          }
          cursor.lastCubicControl = null;
          cursor.lastQuadraticControl = null;
          break;
        }
        default:
          index += parameterCount;
          break;
      }
      if (index >= tokens.length || isCommand(tokens[index])) break;
    }
  }

  return points;
}

export function getMotionPathDrawCommands(
  points: readonly MotionShapePathPoint[],
): MotionPathDrawCommand[] {
  if (points.length === 0) return [];
  const [first, ...rest] = points;
  const commands: MotionPathDrawCommand[] = [
    { type: "move", x: first.x, y: first.y },
  ];
  let previous = first;
  for (const point of rest) {
    if (segmentHasCurve(previous, point)) {
      commands.push({
        type: "cubic",
        c1x: previous.outX ?? previous.x,
        c1y: previous.outY ?? previous.y,
        c2x: point.inX ?? point.x,
        c2y: point.inY ?? point.y,
        x: point.x,
        y: point.y,
      });
    } else {
      commands.push({ type: "line", x: point.x, y: point.y });
    }
    previous = point;
  }
  return commands;
}

function segmentHasCurve(
  from: MotionShapePathPoint,
  to: MotionShapePathPoint,
): boolean {
  return (
    from.outX !== undefined ||
    from.outY !== undefined ||
    to.inX !== undefined ||
    to.inY !== undefined
  );
}

export function getMotionShapePathKeyframes(
  layer: MotionShapeLayer,
): Keyframe[] {
  return layer.keyframes
    .filter(
      (keyframe) =>
        keyframe.property === MOTION_SHAPE_PATH_DATA_PROPERTY &&
        typeof keyframe.value === "string" &&
        keyframe.value.trim().length > 0,
    )
    .sort((a, b) => a.time - b.time);
}

export function findMotionShapePathKeyframeAtTime(
  layer: MotionShapeLayer,
  time: number,
  snapTolerance = DEFAULT_SNAP_TOLERANCE,
): Keyframe | undefined {
  return getMotionShapePathKeyframes(layer).find(
    (keyframe) => Math.abs(keyframe.time - normalizeKeyframeTime(time)) <= snapTolerance,
  );
}

export function upsertMotionShapePathKeyframe<T extends MotionShapeLayer>(
  layer: T,
  time: number,
  options: MotionShapePathKeyframeOptions = {},
): T {
  const pathData = (options.pathData ?? layer.pathData)?.trim();
  if (!pathData) return layer;

  const keyframeTime = normalizeKeyframeTime(time);
  const snapTolerance = options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  const existing = findMotionShapePathKeyframeAtTime(
    layer,
    keyframeTime,
    snapTolerance,
  );
  const nextKeyframe: Keyframe = {
    id:
      existing?.id ??
      options.idFactory?.() ??
      `motion-path-kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    time: keyframeTime,
    property: MOTION_SHAPE_PATH_DATA_PROPERTY,
    value: pathData,
    easing: options.easing ?? existing?.easing ?? "ease",
  };
  const keyframes = existing
    ? layer.keyframes.map((keyframe) =>
        keyframe.id === existing.id ? nextKeyframe : keyframe,
      )
    : [...layer.keyframes, nextKeyframe];

  return {
    ...layer,
    keyframes: sortKeyframes(keyframes),
  } as T;
}

export function getMotionShapePathDataAtTime(
  layer: MotionShapeLayer,
  localTime: number,
): string | undefined {
  if (layer.shapeType !== "path") return layer.pathData;
  const keyframes = getMotionShapePathKeyframes(layer);
  if (keyframes.length === 0) return layer.pathData;
  const sorted = keyframes;
  if (localTime <= sorted[0].time) {
    return readPathKeyframeValue(sorted[0]) ?? layer.pathData;
  }
  const last = sorted[sorted.length - 1];
  if (localTime >= last.time) {
    return readPathKeyframeValue(last) ?? layer.pathData;
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (localTime < from.time || localTime > to.time) continue;

    const fromPath = readPathKeyframeValue(from);
    const toPath = readPathKeyframeValue(to);
    if (!fromPath || !toPath) return layer.pathData;
    const span = Math.max(0.001, to.time - from.time);
    const progress = clamp01((localTime - from.time) / span);
    const easedProgress = easeProgress(progress, from.easing);
    return morphMotionPathData(fromPath, toPath, easedProgress);
  }

  return layer.pathData;
}

export function getEditableMotionShapePathPoints(
  layer: MotionShapeLayer,
  localTime?: number,
): MotionShapePathPoint[] {
  if (layer.shapeType !== "path") return [];
  const pathData =
    localTime === undefined
      ? layer.pathData
      : getMotionShapePathDataAtTime(layer, localTime);
  return removeDuplicateClosingPoint(parseMotionPathSegments(pathData));
}

export function setMotionShapePathPoints<T extends MotionShapeLayer>(
  layer: T,
  points: readonly MotionShapePathPoint[],
  options: SetMotionShapePathPointsOptions = {},
): T {
  if (layer.shapeType !== "path") return layer;
  const normalizedPoints = normalizeEditablePathPoints(points);
  if (normalizedPoints.length === 0) return layer;
  const pathData = buildMotionPathData(normalizedPoints);

  if (options.keyframe && options.localTime !== undefined) {
    return upsertMotionShapePathKeyframe(layer, options.localTime, {
      pathData,
      easing: options.easing,
      snapTolerance: options.snapTolerance,
      idFactory: options.idFactory,
    });
  }

  return {
    ...layer,
    pathData,
  } as T;
}

export function setMotionShapePathPoint<T extends MotionShapeLayer>(
  layer: T,
  pointIndex: number,
  point: MotionShapePathPoint,
  options: SetMotionShapePathPointsOptions = {},
): T {
  const points = getEditableMotionShapePathPoints(layer, options.localTime);
  if (points.length === 0) return layer;
  const index = clampIndex(pointIndex, points.length);
  const existing = points[index];
  const deltaX = point.x - existing.x;
  const deltaY = point.y - existing.y;
  const moved: MotionShapePathPoint = {
    x: finite(point.x, 0),
    y: finite(point.y, 0),
    ...(existing.inX !== undefined && existing.inY !== undefined
      ? { inX: existing.inX + deltaX, inY: existing.inY + deltaY }
      : {}),
    ...(existing.outX !== undefined && existing.outY !== undefined
      ? { outX: existing.outX + deltaX, outY: existing.outY + deltaY }
      : {}),
  };
  const nextPoints = points.map((candidate, candidateIndex) =>
    candidateIndex === index ? moved : candidate,
  );
  return setMotionShapePathPoints(layer, nextPoints, options);
}

export function setMotionShapePathPointHandle<T extends MotionShapeLayer>(
  layer: T,
  pointIndex: number,
  handle: "in" | "out",
  position: { readonly x: number; readonly y: number },
  options: SetMotionShapePathPointsOptions = {},
): T {
  const points = getEditableMotionShapePathPoints(layer, options.localTime);
  if (points.length === 0) return layer;
  const index = clampIndex(pointIndex, points.length);
  const nextPoints = points.map((candidate, candidateIndex) => {
    if (candidateIndex !== index) return candidate;
    return handle === "in"
      ? { ...candidate, inX: finite(position.x, 0), inY: finite(position.y, 0) }
      : { ...candidate, outX: finite(position.x, 0), outY: finite(position.y, 0) };
  });
  return setMotionShapePathPoints(layer, nextPoints, options);
}

export function insertMotionShapePathPoint<T extends MotionShapeLayer>(
  layer: T,
  afterPointIndex: number,
  point?: MotionShapePathPoint,
  options: SetMotionShapePathPointsOptions = {},
): T {
  const points = getEditableMotionShapePathPoints(layer, options.localTime);
  if (points.length === 0) return layer;
  const index = clampIndex(afterPointIndex, points.length);
  const nextPoint = point
    ? normalizePathPoint(point)
    : getInsertedPathPoint(points, index, layer.pathClosed ?? false);
  const nextPoints = [
    ...points.slice(0, index + 1),
    nextPoint,
    ...points.slice(index + 1),
  ];
  return setMotionShapePathPoints(layer, nextPoints, options);
}

export function removeMotionShapePathPoint<T extends MotionShapeLayer>(
  layer: T,
  pointIndex: number,
  options: SetMotionShapePathPointsOptions = {},
): T {
  const points = getEditableMotionShapePathPoints(layer, options.localTime);
  const minimumPoints = layer.pathClosed ? 3 : 2;
  if (points.length <= minimumPoints) return layer;
  const index = clampIndex(pointIndex, points.length);
  return setMotionShapePathPoints(
    layer,
    points.filter((_, candidateIndex) => candidateIndex !== index),
    options,
  );
}

export function interpolateMotionPathPoints(
  from: readonly MotionShapePathPoint[],
  to: readonly MotionShapePathPoint[],
  progress: number,
  pointCount = DEFAULT_MORPH_POINT_COUNT,
): MotionShapePathPoint[] {
  const amount = clamp01(progress);
  if (from.length === 0) return to.map(normalizePathPoint);
  if (to.length === 0) return from.map(normalizePathPoint);

  if (from.length === to.length) {
    return from.map((point, index) =>
      lerpMotionPathPoint(point, to[index], amount),
    );
  }

  const resampledFrom = resampleMotionPathPoints(from, pointCount);
  const resampledTo = resampleMotionPathPoints(to, pointCount);
  return resampledFrom.map((point, index) => ({
    x: lerp(point.x, resampledTo[index].x, amount),
    y: lerp(point.y, resampledTo[index].y, amount),
  }));
}

export function morphMotionPathData(
  fromPathData: string,
  toPathData: string,
  progress: number,
  pointCount = DEFAULT_MORPH_POINT_COUNT,
): string {
  const from = parseMotionPathSegments(fromPathData);
  const to = parseMotionPathSegments(toPathData);
  if (from.length === 0 || to.length === 0) {
    return progress < 0.5 ? fromPathData : toPathData;
  }
  return buildMotionPathData(
    interpolateMotionPathPoints(from, to, progress, pointCount),
  );
}

function lerpMotionPathPoint(
  from: MotionShapePathPoint,
  to: MotionShapePathPoint,
  amount: number,
): MotionShapePathPoint {
  const result: {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
  } = {
    x: lerp(from.x, to.x, amount),
    y: lerp(from.y, to.y, amount),
  };

  const fromHasIn = from.inX !== undefined && from.inY !== undefined;
  const toHasIn = to.inX !== undefined && to.inY !== undefined;
  if (fromHasIn || toHasIn) {
    const fromInX = from.inX !== undefined ? from.inX : from.x;
    const fromInY = from.inY !== undefined ? from.inY : from.y;
    const toInX = to.inX !== undefined ? to.inX : to.x;
    const toInY = to.inY !== undefined ? to.inY : to.y;
    result.inX = lerp(fromInX, toInX, amount);
    result.inY = lerp(fromInY, toInY, amount);
  }

  const fromHasOut = from.outX !== undefined && from.outY !== undefined;
  const toHasOut = to.outX !== undefined && to.outY !== undefined;
  if (fromHasOut || toHasOut) {
    const fromOutX = from.outX !== undefined ? from.outX : from.x;
    const fromOutY = from.outY !== undefined ? from.outY : from.y;
    const toOutX = to.outX !== undefined ? to.outX : to.x;
    const toOutY = to.outY !== undefined ? to.outY : to.y;
    result.outX = lerp(fromOutX, toOutX, amount);
    result.outY = lerp(fromOutY, toOutY, amount);
  }

  return result;
}

export function resampleMotionPathPoints(
  points: readonly MotionShapePathPoint[],
  count: number,
): MotionShapePathPoint[] {
  const sampleCount = Math.max(2, Math.round(count));
  if (points.length === 0) return [];
  if (points.length === 1) {
    return Array.from({ length: sampleCount }, () => points[0]);
  }
  const closed = isClosedPath(points);
  const source = closed ? points : [...points];
  const totalLength = getPathLength(source);
  if (totalLength <= 0) {
    return Array.from({ length: sampleCount }, () => source[0]);
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    const ratio = closed
      ? index / Math.max(1, sampleCount - 1)
      : index / (sampleCount - 1);
    return getPointAtPathDistance(source, totalLength * ratio);
  });
}

export function buildMotionPathData(
  points: readonly MotionShapePathPoint[],
): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const commands = [`M ${round(first.x)} ${round(first.y)}`];
  let previous = first;
  for (const point of rest) {
    if (segmentHasCurve(previous, point)) {
      const c1x = previous.outX ?? previous.x;
      const c1y = previous.outY ?? previous.y;
      const c2x = point.inX ?? point.x;
      const c2y = point.inY ?? point.y;
      commands.push(
        `C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(
          point.x,
        )} ${round(point.y)}`,
      );
    } else {
      commands.push(`L ${round(point.x)} ${round(point.y)}`);
    }
    previous = point;
  }
  return commands.join(" ");
}

export function getMotionPathBounds(
  points: readonly MotionShapePathPoint[],
): MotionPathBounds | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function centerMotionPathData(
  pathData: string,
  options: {
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly translateX?: number;
    readonly translateY?: number;
  } = {},
): CenteredMotionPath | null {
  const scaleX = finite(options.scaleX, 1);
  const scaleY = finite(options.scaleY, 1);
  const translateX = finite(options.translateX, 0);
  const translateY = finite(options.translateY, 0);
  const scale = (x: number, y: number): { x: number; y: number } => ({
    x: x * scaleX + translateX,
    y: y * scaleY + translateY,
  });
  const flattened = parseMotionPathData(pathData).map((point) =>
    scale(point.x, point.y),
  );
  const bounds = getMotionPathBounds(flattened);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const centeredPoints = parseMotionPathSegments(pathData).map((point) =>
    transformMotionPathPoint(point, (px, py) => {
      const scaled = scale(px, py);
      return { x: scaled.x - centerX, y: scaled.y - centerY };
    }),
  );

  return {
    pathData: buildMotionPathData(centeredPoints),
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    centerX,
    centerY,
    closed: isClosedPath(flattened),
  };
}

function transformMotionPathPoint(
  point: MotionShapePathPoint,
  map: (x: number, y: number) => { x: number; y: number },
): MotionShapePathPoint {
  const base = map(point.x, point.y);
  const result: {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
  } = { x: base.x, y: base.y };
  if (point.inX !== undefined && point.inY !== undefined) {
    const mappedIn = map(point.inX, point.inY);
    result.inX = mappedIn.x;
    result.inY = mappedIn.y;
  }
  if (point.outX !== undefined && point.outY !== undefined) {
    const mappedOut = map(point.outX, point.outY);
    result.outX = mappedOut.x;
    result.outY = mappedOut.y;
  }
  return result;
}

export function isClosedPath(points: readonly MotionShapePathPoint[]): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001;
}

function closeCurrentSubpath(
  points: MotionShapePathPoint[],
  cursor: PathCursor,
): void {
  lineTo(points, cursor, cursor.startX, cursor.startY);
}

function cubicTo(
  points: MotionShapePathPoint[],
  cursor: PathCursor,
  control1: MotionShapePathPoint,
  control2: MotionShapePathPoint,
  end: MotionShapePathPoint,
  samples: number,
): void {
  const start = { x: cursor.x, y: cursor.y };
  const count = Math.max(2, Math.round(samples));
  for (let step = 1; step <= count; step += 1) {
    const t = step / count;
    addPoint(points, {
      x:
        (1 - t) ** 3 * start.x +
        3 * (1 - t) ** 2 * t * control1.x +
        3 * (1 - t) * t ** 2 * control2.x +
        t ** 3 * end.x,
      y:
        (1 - t) ** 3 * start.y +
        3 * (1 - t) ** 2 * t * control1.y +
        3 * (1 - t) * t ** 2 * control2.y +
        t ** 3 * end.y,
    });
  }
  cursor.x = end.x;
  cursor.y = end.y;
  cursor.lastCubicControl = control2;
  cursor.lastQuadraticControl = null;
}

function quadraticTo(
  points: MotionShapePathPoint[],
  cursor: PathCursor,
  control: MotionShapePathPoint,
  end: MotionShapePathPoint,
  samples: number,
): void {
  const start = { x: cursor.x, y: cursor.y };
  const count = Math.max(2, Math.round(samples));
  for (let step = 1; step <= count; step += 1) {
    const t = step / count;
    addPoint(points, {
      x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
      y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
    });
  }
  cursor.x = end.x;
  cursor.y = end.y;
  cursor.lastQuadraticControl = control;
  cursor.lastCubicControl = null;
}

function lineTo(
  points: MotionShapePathPoint[],
  cursor: PathCursor,
  x: number,
  y: number,
): void {
  addPoint(points, { x, y });
  cursor.x = x;
  cursor.y = y;
  cursor.lastCubicControl = null;
  cursor.lastQuadraticControl = null;
}

function moveCursor(cursor: PathCursor, x: number, y: number): void {
  cursor.x = x;
  cursor.y = y;
  cursor.startX = x;
  cursor.startY = y;
  cursor.lastCubicControl = null;
  cursor.lastQuadraticControl = null;
}

function addPoint(
  points: MotionShapePathPoint[],
  point: MotionShapePathPoint,
): void {
  const previous = points[points.length - 1];
  if (
    previous &&
    Math.abs(previous.x - point.x) < 0.001 &&
    Math.abs(previous.y - point.y) < 0.001
  ) {
    return;
  }
  points.push({ x: finite(point.x, 0), y: finite(point.y, 0) });
}

function readPoint(
  tokens: readonly string[],
  index: number,
  cursor: PathCursor,
  relative: boolean,
): MotionShapePathPoint {
  const x = readNumber(tokens[index], 0);
  const y = readNumber(tokens[index + 1], 0);
  return {
    x: relative ? cursor.x + x : x,
    y: relative ? cursor.y + y : y,
  };
}

function readArcParameters(
  tokens: readonly string[],
  index: number,
  cursor: PathCursor,
  relative: boolean,
): ArcParameters {
  const endX = readNumber(tokens[index + 5], cursor.x);
  const endY = readNumber(tokens[index + 6], cursor.y);
  return {
    rx: Math.abs(readNumber(tokens[index], 0)),
    ry: Math.abs(readNumber(tokens[index + 1], 0)),
    rotation: (readNumber(tokens[index + 2], 0) * Math.PI) / 180,
    largeArc: readNumber(tokens[index + 3], 0) !== 0,
    sweep: readNumber(tokens[index + 4], 0) !== 0,
    end: {
      x: relative ? cursor.x + endX : endX,
      y: relative ? cursor.y + endY : endY,
    },
  };
}

function arcTo(
  points: MotionShapePathPoint[],
  cursor: PathCursor,
  arc: ArcParameters,
  samples: number,
): void {
  const start = { x: cursor.x, y: cursor.y };
  const { end } = arc;

  if (
    arc.rx <= 0 ||
    arc.ry <= 0 ||
    (Math.abs(start.x - end.x) < 0.000001 && Math.abs(start.y - end.y) < 0.000001)
  ) {
    lineTo(points, cursor, end.x, end.y);
    return;
  }

  const cosRotation = Math.cos(arc.rotation);
  const sinRotation = Math.sin(arc.rotation);

  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1Prime = cosRotation * dx + sinRotation * dy;
  const y1Prime = -sinRotation * dx + cosRotation * dy;

  let rx = arc.rx;
  let ry = arc.ry;
  const radiiCheck =
    (x1Prime * x1Prime) / (rx * rx) + (y1Prime * y1Prime) / (ry * ry);
  if (radiiCheck > 1) {
    const scale = Math.sqrt(radiiCheck);
    rx *= scale;
    ry *= scale;
  }

  const rxSquared = rx * rx;
  const rySquared = ry * ry;
  const numerator =
    rxSquared * rySquared -
    rxSquared * y1Prime * y1Prime -
    rySquared * x1Prime * x1Prime;
  const denominator =
    rxSquared * y1Prime * y1Prime + rySquared * x1Prime * x1Prime;
  let coefficient = denominator <= 0 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
  if (arc.largeArc === arc.sweep) {
    coefficient = -coefficient;
  }

  const cxPrime = (coefficient * (rx * y1Prime)) / ry;
  const cyPrime = (coefficient * -(ry * x1Prime)) / rx;
  const centerX =
    cosRotation * cxPrime - sinRotation * cyPrime + (start.x + end.x) / 2;
  const centerY =
    sinRotation * cxPrime + cosRotation * cyPrime + (start.y + end.y) / 2;

  const startAngle = angleBetween(
    1,
    0,
    (x1Prime - cxPrime) / rx,
    (y1Prime - cyPrime) / ry,
  );
  let deltaAngle = angleBetween(
    (x1Prime - cxPrime) / rx,
    (y1Prime - cyPrime) / ry,
    (-x1Prime - cxPrime) / rx,
    (-y1Prime - cyPrime) / ry,
  );
  if (!arc.sweep && deltaAngle > 0) {
    deltaAngle -= Math.PI * 2;
  } else if (arc.sweep && deltaAngle < 0) {
    deltaAngle += Math.PI * 2;
  }

  const count = Math.max(
    2,
    Math.ceil((Math.abs(deltaAngle) / (Math.PI / 2)) * Math.max(2, Math.round(samples))),
  );
  for (let step = 1; step <= count; step += 1) {
    const angle = startAngle + (deltaAngle * step) / count;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    addPoint(points, {
      x: centerX + cosRotation * rx * cosAngle - sinRotation * ry * sinAngle,
      y: centerY + sinRotation * rx * cosAngle + cosRotation * ry * sinAngle,
    });
  }

  cursor.x = end.x;
  cursor.y = end.y;
  cursor.lastCubicControl = null;
  cursor.lastQuadraticControl = null;
}

function angleBetween(
  ux: number,
  uy: number,
  vx: number,
  vy: number,
): number {
  const dot = ux * vx + uy * vy;
  const magnitude = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (magnitude <= 0) return 0;
  const cosine = clamp01ToRange(dot / magnitude, -1, 1);
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(cosine);
}

function clamp01ToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reflectCubicControl(cursor: PathCursor): MotionShapePathPoint {
  if (!cursor.lastCubicControl) return { x: cursor.x, y: cursor.y };
  return {
    x: cursor.x * 2 - cursor.lastCubicControl.x,
    y: cursor.y * 2 - cursor.lastCubicControl.y,
  };
}

function reflectQuadraticControl(cursor: PathCursor): MotionShapePathPoint {
  if (!cursor.lastQuadraticControl) return { x: cursor.x, y: cursor.y };
  return {
    x: cursor.x * 2 - cursor.lastQuadraticControl.x,
    y: cursor.y * 2 - cursor.lastQuadraticControl.y,
  };
}

function getPathCommandParameterCount(command: string): number {
  switch (command) {
    case "h":
    case "v":
      return 1;
    case "m":
    case "l":
    case "t":
      return 2;
    case "s":
    case "q":
      return 4;
    case "c":
      return 6;
    case "a":
      return 7;
    default:
      return 0;
  }
}

function hasNumbers(
  tokens: readonly string[],
  index: number,
  count: number,
): boolean {
  if (index + count > tokens.length) return false;
  for (let offset = 0; offset < count; offset += 1) {
    if (isCommand(tokens[index + offset])) return false;
  }
  return true;
}

function isCommand(token: string | undefined): boolean {
  return Boolean(token && /^[a-zA-Z]$/.test(token));
}

function readPathKeyframeValue(keyframe: Keyframe): string | undefined {
  return typeof keyframe.value === "string" && keyframe.value.trim().length > 0
    ? keyframe.value
    : undefined;
}

function removeDuplicateClosingPoint(
  points: readonly MotionShapePathPoint[],
): MotionShapePathPoint[] {
  if (points.length < 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (Math.abs(first.x - last.x) > 0.001 || Math.abs(first.y - last.y) > 0.001) {
    return [...points];
  }
  return points.slice(0, -1);
}

function normalizeEditablePathPoints(
  points: readonly MotionShapePathPoint[],
): MotionShapePathPoint[] {
  return removeDuplicateClosingPoint(points).map(normalizePathPoint);
}

function normalizePathPoint(point: MotionShapePathPoint): MotionShapePathPoint {
  const result: {
    x: number;
    y: number;
    inX?: number;
    inY?: number;
    outX?: number;
    outY?: number;
  } = { x: finite(point.x, 0), y: finite(point.y, 0) };
  if (point.inX !== undefined && point.inY !== undefined) {
    result.inX = finite(point.inX, 0);
    result.inY = finite(point.inY, 0);
  }
  if (point.outX !== undefined && point.outY !== undefined) {
    result.outX = finite(point.outX, 0);
    result.outY = finite(point.outY, 0);
  }
  return result;
}

function getInsertedPathPoint(
  points: readonly MotionShapePathPoint[],
  index: number,
  closed: boolean,
): MotionShapePathPoint {
  const current = points[index];
  const next = points[index + 1] ?? (closed ? points[0] : undefined);
  if (!next) {
    return { x: current.x + 48, y: current.y };
  }
  return {
    x: (current.x + next.x) / 2,
    y: (current.y + next.y) / 2,
  };
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.round(finite(index, 0))));
}

function sortKeyframes(keyframes: readonly Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    return a.property.localeCompare(b.property);
  });
}

function normalizeKeyframeTime(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Number(time.toFixed(4)));
}

function easeProgress(progress: number, easing: EasingType): number {
  const easingFn =
    easing in EASING_FUNCTIONS
      ? EASING_FUNCTIONS[easing as EasingName]
      : EASING_FUNCTIONS.ease;
  return clamp01(easingFn(clamp01(progress)));
}

function getPathLength(points: readonly MotionShapePathPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

function getPointAtPathDistance(
  points: readonly MotionShapePathPoint[],
  targetDistance: number,
): MotionShapePathPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (targetDistance <= 0) return points[0];
  let traveled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLength = distance(from, to);
    if (segmentLength <= 0) continue;
    if (traveled + segmentLength >= targetDistance) {
      const amount = clamp01((targetDistance - traveled) / segmentLength);
      return {
        x: lerp(from.x, to.x, amount),
        y: lerp(from.y, to.y, amount),
      };
    }
    traveled += segmentLength;
  }
  return points[points.length - 1];
}

function distance(a: MotionShapePathPoint, b: MotionShapePathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, finite(value, 0)));
}

function readNumber(value: string | undefined, fallback: number): number {
  return finite(Number(value), fallback);
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}
