import type { Keyframe } from "../types/timeline";
import type {
  MotionComposition,
  MotionLayer,
  MotionTrack,
  MotionTrackPoint,
  MotionTrackPointFrame,
  MotionTrackingApplyMode,
  MotionVector2,
} from "./types";
import { sortMotionKeyframes } from "./motion-keyframes";

export interface CreateMotionTrackOptions {
  readonly id?: string;
  readonly name?: string;
  readonly sourceAssetId?: string;
  readonly sourceLayerId?: string;
  readonly points?: readonly Partial<MotionTrackPoint>[];
  readonly smoothing?: number;
}

export interface AddMotionTrackPointFrameOptions {
  readonly pointId: string;
  readonly frame: MotionTrackPointFrame;
}

export interface ApplyMotionTrackToLayerOptions {
  readonly primaryPointId?: string;
  readonly secondaryPointId?: string;
  readonly mode?: MotionTrackingApplyMode;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly preserveOffset?: boolean;
  readonly offset?: MotionVector2;
  readonly smoothWindow?: number;
  readonly minConfidence?: number;
  readonly idFactory?: (
    property: string,
    time: number,
    index: number,
  ) => string;
}

export const DEFAULT_MOTION_TRACK_POINT_COLOR = "#22d3ee";

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionTrack(
  options: CreateMotionTrackOptions = {},
): MotionTrack {
  const now = Date.now();
  return normalizeMotionTrack({
    id: options.id ?? uid("motion-track"),
    name: options.name ?? "Motion Track",
    enabled: true,
    sourceAssetId: options.sourceAssetId,
    sourceLayerId: options.sourceLayerId,
    smoothing: options.smoothing ?? 0,
    points:
      options.points && options.points.length > 0
        ? options.points.map(normalizeMotionTrackPoint)
        : [
            normalizeMotionTrackPoint({
              id: "point-1",
              name: "Track Point 1",
              color: DEFAULT_MOTION_TRACK_POINT_COLOR,
              frames: [],
            }),
          ],
    createdAt: now,
    modifiedAt: now,
  });
}

export function normalizeMotionTracks(
  composition: Pick<MotionComposition, "tracks">,
): MotionTrack[] {
  return (composition.tracks ?? []).map(normalizeMotionTrack);
}

export function addMotionTrack(
  composition: MotionComposition,
  track: MotionTrack,
): MotionComposition {
  return {
    ...composition,
    tracks: [...normalizeMotionTracks(composition), normalizeMotionTrack(track)],
    modifiedAt: Date.now(),
  };
}

export function updateMotionTrack(
  composition: MotionComposition,
  trackId: string,
  updater: (track: MotionTrack) => MotionTrack,
): MotionComposition {
  let changed = false;
  const tracks = normalizeMotionTracks(composition).map((track) => {
    if (track.id !== trackId) return track;
    changed = true;
    return normalizeMotionTrack(updater(track));
  });
  return changed ? { ...composition, tracks, modifiedAt: Date.now() } : composition;
}

export function removeMotionTrack(
  composition: MotionComposition,
  trackId: string,
): MotionComposition {
  const tracks = normalizeMotionTracks(composition).filter(
    (track) => track.id !== trackId,
  );
  if (tracks.length === (composition.tracks ?? []).length) return composition;
  return { ...composition, tracks, modifiedAt: Date.now() };
}

export function addMotionTrackPointFrame(
  track: MotionTrack,
  options: AddMotionTrackPointFrameOptions,
): MotionTrack {
  return normalizeMotionTrack({
    ...track,
    points: track.points.map((point) =>
      point.id === options.pointId
        ? {
            ...point,
            frames: upsertMotionTrackPointFrame(point.frames, options.frame),
          }
        : point,
    ),
    modifiedAt: Date.now(),
  });
}

export function getMotionTrackPointAtTime(
  point: MotionTrackPoint,
  time: number,
): MotionTrackPointFrame | null {
  const frames = normalizeMotionTrackPoint(point).frames;
  if (frames.length === 0) return null;
  const targetTime = normalizeTime(time);
  if (targetTime <= frames[0].time) return frames[0];
  if (targetTime >= frames[frames.length - 1].time) {
    return frames[frames.length - 1];
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (targetTime < current.time || targetTime > next.time) continue;
    const span = Math.max(0.0001, next.time - current.time);
    const progress = (targetTime - current.time) / span;
    return {
      time: targetTime,
      position: {
        x: lerp(current.position.x, next.position.x, progress),
        y: lerp(current.position.y, next.position.y, progress),
        z: lerp(current.position.z ?? 0, next.position.z ?? 0, progress),
      },
      confidence: lerp(current.confidence ?? 1, next.confidence ?? 1, progress),
    };
  }

  return null;
}

export function smoothMotionTrack(
  track: MotionTrack,
  windowSize = track.smoothing ?? 0,
): MotionTrack {
  const radius = Math.max(0, Math.round(windowSize));
  if (radius <= 0) return normalizeMotionTrack(track);
  return normalizeMotionTrack({
    ...track,
    smoothing: radius,
    points: track.points.map((point) => ({
      ...point,
      frames: smoothMotionTrackPointFrames(point.frames, radius),
    })),
  });
}

export function applyMotionTrackToLayer<T extends MotionLayer>(
  layer: T,
  track: MotionTrack,
  options: ApplyMotionTrackToLayerOptions = {},
): T {
  if (!track.enabled) return layer;

  const smoothedTrack = smoothMotionTrack(track, options.smoothWindow ?? track.smoothing ?? 0);
  const primaryPoint = getTrackPoint(
    smoothedTrack,
    options.primaryPointId,
    0,
  );
  if (!primaryPoint || primaryPoint.frames.length === 0) return layer;

  const secondaryPoint =
    options.mode === "position-scale-rotation"
      ? getTrackPoint(smoothedTrack, options.secondaryPointId, 1)
      : null;
  const pairs = getTrackFramePairs(primaryPoint, secondaryPoint, {
    startTime: options.startTime,
    endTime: options.endTime,
    minConfidence: options.minConfidence,
  });
  if (pairs.length === 0) return layer;

  const firstPrimary = pairs[0].primary;
  const offset =
    options.offset ??
    (options.preserveOffset ?? true
      ? {
          x: layer.transform.position.x - firstPrimary.position.x,
          y: layer.transform.position.y - firstPrimary.position.y,
          z: (layer.transform.position.z ?? 0) - (firstPrimary.position.z ?? 0),
        }
      : { x: 0, y: 0, z: 0 });
  const baseScale = layer.transform.scale;
  const baseRotation = layer.transform.rotation;
  const firstSecondary = pairs[0].secondary;
  const initialVector =
    firstSecondary &&
    vectorBetween(firstPrimary.position, firstSecondary.position);
  const initialDistance = initialVector
    ? Math.max(0.0001, vectorLength(initialVector))
    : 1;
  const initialAngle = initialVector ? vectorAngle(initialVector) : 0;
  const keyframes: Keyframe[] = [];
  let keyframeIndex = 0;

  for (const pair of pairs) {
    const localTime = normalizeTime(pair.primary.time - layer.startTime);
    if (localTime < 0 || localTime > layer.duration) continue;
    const position = {
      x: pair.primary.position.x + offset.x,
      y: pair.primary.position.y + offset.y,
      z: (pair.primary.position.z ?? 0) + (offset.z ?? 0),
    };
    keyframes.push(
      createTrackingKeyframe(
        "transform.position.x",
        localTime,
        position.x,
        options.idFactory,
        keyframeIndex++,
      ),
      createTrackingKeyframe(
        "transform.position.y",
        localTime,
        position.y,
        options.idFactory,
        keyframeIndex++,
      ),
    );
    if (position.z !== 0 || layer.transform.position.z !== undefined) {
      keyframes.push(
        createTrackingKeyframe(
          "transform.position.z",
          localTime,
          position.z,
          options.idFactory,
          keyframeIndex++,
        ),
      );
    }

    if (pair.secondary && initialVector) {
      const vector = vectorBetween(pair.primary.position, pair.secondary.position);
      const distanceScale = vectorLength(vector) / initialDistance;
      const rotation = baseRotation + (vectorAngle(vector) - initialAngle);
      keyframes.push(
        createTrackingKeyframe(
          "transform.scale.x",
          localTime,
          baseScale.x * distanceScale,
          options.idFactory,
          keyframeIndex++,
        ),
        createTrackingKeyframe(
          "transform.scale.y",
          localTime,
          baseScale.y * distanceScale,
          options.idFactory,
          keyframeIndex++,
        ),
        createTrackingKeyframe(
          "transform.rotation",
          localTime,
          rotation,
          options.idFactory,
          keyframeIndex++,
        ),
      );
    }
  }

  if (keyframes.length === 0) return layer;
  const trackingProperties = new Set(keyframes.map((keyframe) => keyframe.property));
  return {
    ...layer,
    keyframes: sortMotionKeyframes([
      ...layer.keyframes.filter(
        (keyframe) => !trackingProperties.has(keyframe.property),
      ),
      ...keyframes,
    ]),
  } as T;
}

function getTrackPoint(
  track: MotionTrack,
  pointId: string | undefined,
  fallbackIndex: number,
): MotionTrackPoint | null {
  return (
    (pointId ? track.points.find((point) => point.id === pointId) : undefined) ??
    track.points[fallbackIndex] ??
    null
  );
}

function getTrackFramePairs(
  primaryPoint: MotionTrackPoint,
  secondaryPoint: MotionTrackPoint | null,
  options: Pick<
    ApplyMotionTrackToLayerOptions,
    "startTime" | "endTime" | "minConfidence"
  >,
): Array<{
  readonly primary: MotionTrackPointFrame;
  readonly secondary?: MotionTrackPointFrame;
}> {
  const minConfidence = clamp(options.minConfidence ?? 0, 0, 1);
  const start = Math.max(0, options.startTime ?? 0);
  const end = Math.max(start, options.endTime ?? Number.POSITIVE_INFINITY);
  return primaryPoint.frames.flatMap((primary) => {
    if (
      primary.time < start ||
      primary.time > end ||
      (primary.confidence ?? 1) < minConfidence
    ) {
      return [];
    }
    const secondary = secondaryPoint
      ? getMotionTrackPointAtTime(secondaryPoint, primary.time)
      : null;
    if (secondaryPoint && !secondary) return [];
    if (secondary && (secondary.confidence ?? 1) < minConfidence) return [];
    return [{ primary, ...(secondary ? { secondary } : {}) }];
  });
}

function smoothMotionTrackPointFrames(
  frames: readonly MotionTrackPointFrame[],
  radius: number,
): MotionTrackPointFrame[] {
  const normalized = normalizeMotionTrackPointFrames(frames);
  return normalized.map((frame, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(normalized.length - 1, index + radius);
    let count = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    let confidence = 0;
    for (let sampleIndex = start; sampleIndex <= end; sampleIndex += 1) {
      const sample = normalized[sampleIndex];
      count += 1;
      x += sample.position.x;
      y += sample.position.y;
      z += sample.position.z ?? 0;
      confidence += sample.confidence ?? 1;
    }
    return {
      time: frame.time,
      position: {
        x: roundMotionTrackValue(x / count),
        y: roundMotionTrackValue(y / count),
        z: roundMotionTrackValue(z / count),
      },
      confidence: roundMotionTrackValue(confidence / count),
    };
  });
}

function upsertMotionTrackPointFrame(
  frames: readonly MotionTrackPointFrame[],
  frame: MotionTrackPointFrame,
): MotionTrackPointFrame[] {
  const normalized = normalizeMotionTrackPointFrame(frame);
  const existing = frames.some(
    (candidate) => Math.abs(candidate.time - normalized.time) <= 1 / 10000,
  );
  return normalizeMotionTrackPointFrames(
    existing
      ? frames.map((candidate) =>
          Math.abs(candidate.time - normalized.time) <= 1 / 10000
            ? normalized
            : candidate,
        )
      : [...frames, normalized],
  );
}

function normalizeMotionTrack(track: MotionTrack): MotionTrack {
  const now = Date.now();
  return {
    ...track,
    name: track.name.trim() || "Motion Track",
    enabled: track.enabled ?? true,
    smoothing: Math.max(0, Math.round(finite(track.smoothing, 0))),
    points:
      track.points.length > 0
        ? track.points.map(normalizeMotionTrackPoint)
        : [
            normalizeMotionTrackPoint({
              id: "point-1",
              name: "Track Point 1",
              color: DEFAULT_MOTION_TRACK_POINT_COLOR,
              frames: [],
            }),
          ],
    createdAt: finite(track.createdAt, now),
    modifiedAt: finite(track.modifiedAt, now),
  };
}

function normalizeMotionTrackPoint(
  point: Partial<MotionTrackPoint>,
): MotionTrackPoint {
  return {
    id: point.id?.trim() || uid("motion-track-point"),
    name: point.name?.trim() || "Track Point",
    color: point.color?.trim() || DEFAULT_MOTION_TRACK_POINT_COLOR,
    frames: normalizeMotionTrackPointFrames(point.frames ?? []),
  };
}

function normalizeMotionTrackPointFrames(
  frames: readonly MotionTrackPointFrame[],
): MotionTrackPointFrame[] {
  return [...frames]
    .map(normalizeMotionTrackPointFrame)
    .sort((a, b) => a.time - b.time);
}

function normalizeMotionTrackPointFrame(
  frame: MotionTrackPointFrame,
): MotionTrackPointFrame {
  return {
    time: normalizeTime(frame.time),
    position: {
      x: roundMotionTrackValue(finite(frame.position.x, 0)),
      y: roundMotionTrackValue(finite(frame.position.y, 0)),
      z: roundMotionTrackValue(finite(frame.position.z, 0)),
    },
    confidence: clamp(finite(frame.confidence, 1), 0, 1),
  };
}

function createTrackingKeyframe(
  property: string,
  time: number,
  value: number,
  idFactory: ApplyMotionTrackToLayerOptions["idFactory"],
  index: number,
): Keyframe {
  return {
    id: idFactory?.(property, time, index) ?? uid("motion-track-kf"),
    property,
    time,
    value: roundMotionTrackValue(value),
    easing: "linear",
  };
}

function vectorBetween(
  from: MotionVector2,
  to: MotionVector2,
): { readonly x: number; readonly y: number } {
  return { x: to.x - from.x, y: to.y - from.y };
}

function vectorLength(vector: { readonly x: number; readonly y: number }): number {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y);
}

function vectorAngle(vector: { readonly x: number; readonly y: number }): number {
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
}

function lerp(from: number, to: number, progress: number): number {
  return roundMotionTrackValue(from + (to - from) * progress);
}

function normalizeTime(time: number): number {
  return roundMotionTrackValue(Math.max(0, finite(time, 0)));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundMotionTrackValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}
