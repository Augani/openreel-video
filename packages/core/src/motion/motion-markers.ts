import type {
  Marker,
  TimelineBeatAnalysis,
  TimelineBeatMarker,
} from "../types/timeline";
import type { MotionAnimationPresetId } from "./motion-animation-presets";
import { applyMotionAnimationPreset } from "./motion-animation-presets";
import type { MotionComposition, MotionLayer } from "./types";

export interface CreateMotionMarkerOptions {
  readonly id?: string;
  readonly time: number;
  readonly label?: string;
  readonly color?: string;
}

export interface GenerateMotionBeatMarkersOptions {
  readonly bpm: number;
  readonly duration: number;
  readonly startTime?: number;
  readonly beatsPerBar?: number;
}

export interface DetectMotionBeatMarkersOptions {
  readonly duration: number;
  readonly startTime?: number;
  readonly compositionDuration?: number;
  readonly beatsPerBar?: number;
  readonly minSpacing?: number;
  readonly sensitivity?: number;
}

export interface ApplyMotionPresetToBeatsOptions {
  readonly duration?: number;
  readonly distance?: number;
  readonly intensity?: number;
  readonly onlyDownbeats?: boolean;
  readonly startTime?: number;
  readonly endTime?: number;
  readonly maxBeats?: number;
}

export interface SnapMotionTimeOptions {
  readonly markers?: readonly Marker[];
  readonly beatMarkers?: readonly TimelineBeatMarker[];
  readonly threshold?: number;
}

const uid = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function createMotionMarker(
  options: CreateMotionMarkerOptions,
): Marker {
  return {
    id: options.id ?? uid("motion-marker"),
    time: normalizeTime(options.time),
    label: options.label ?? "Marker",
    color: options.color ?? "#3b82f6",
  };
}

export function addMotionCompositionMarker(
  composition: MotionComposition,
  marker: Marker,
): MotionComposition {
  return {
    ...composition,
    markers: sortMarkers([...composition.markers, marker]),
    modifiedAt: Date.now(),
  };
}

export function updateMotionCompositionMarker(
  composition: MotionComposition,
  markerId: string,
  updater: (marker: Marker) => Marker,
): MotionComposition {
  return {
    ...composition,
    markers: sortMarkers(
      composition.markers.map((marker) =>
        marker.id === markerId ? sanitizeMarker(updater(marker)) : marker,
      ),
    ),
    modifiedAt: Date.now(),
  };
}

export function removeMotionCompositionMarker(
  composition: MotionComposition,
  markerId: string,
): MotionComposition {
  return {
    ...composition,
    markers: composition.markers.filter((marker) => marker.id !== markerId),
    modifiedAt: Date.now(),
  };
}

export function generateMotionBeatMarkersAtBpm(
  options: GenerateMotionBeatMarkersOptions,
): TimelineBeatMarker[] {
  const bpm = clamp(options.bpm, 1, 999);
  const duration = Math.max(0, options.duration);
  const startTime = Math.max(0, options.startTime ?? 0);
  const beatsPerBar = Math.max(1, Math.round(options.beatsPerBar ?? 4));
  const interval = 60 / bpm;
  const markers: TimelineBeatMarker[] = [];

  let index = 0;
  for (let time = startTime; time <= duration + 0.0001; time += interval) {
    markers.push({
      time: normalizeTime(time),
      strength: index % beatsPerBar === 0 ? 1 : 0.72,
      index,
      isDownbeat: index % beatsPerBar === 0,
    });
    index++;
  }

  return markers;
}

export function detectMotionBeatMarkersFromPeaks(
  peaks: Float32Array | readonly number[],
  options: DetectMotionBeatMarkersOptions,
): TimelineBeatMarker[] {
  if (peaks.length === 0 || options.duration <= 0) return [];

  const duration = Math.max(0.001, options.duration);
  const startTime = Math.max(0, options.startTime ?? 0);
  const maxTime = Math.max(
    0,
    options.compositionDuration ?? startTime + duration,
  );
  const beatsPerBar = Math.max(1, Math.round(options.beatsPerBar ?? 4));
  const minSpacing = Math.max(0.05, options.minSpacing ?? 0.28);
  const sensitivity = clamp(options.sensitivity ?? 0.65, 0, 1);
  const values = Array.from(peaks, (value) => Math.max(0, Math.abs(value)));
  const stats = getPeakStats(values);
  const threshold = stats.mean + stats.deviation * (1.25 - sensitivity);
  const candidates: TimelineBeatMarker[] = [];
  let lastAcceptedTime = Number.NEGATIVE_INFINITY;

  for (let index = 1; index < values.length - 1; index++) {
    const value = values[index];
    if (value < threshold || value < values[index - 1] || value < values[index + 1]) {
      continue;
    }

    const time =
      startTime + (index / Math.max(1, values.length - 1)) * duration;
    if (time > maxTime || time - lastAcceptedTime < minSpacing) {
      continue;
    }

    const beatIndex = candidates.length;
    candidates.push({
      time: normalizeTime(time),
      strength: clamp(value / Math.max(stats.max, 0.001), 0, 1),
      index: beatIndex,
      isDownbeat: beatIndex % beatsPerBar === 0,
    });
    lastAcceptedTime = time;
  }

  return candidates;
}

export function setMotionBeatMarkers(
  composition: MotionComposition,
  beatMarkers: readonly TimelineBeatMarker[],
  beatAnalysis?: TimelineBeatAnalysis,
): MotionComposition {
  return {
    ...composition,
    beatMarkers: normalizeBeatMarkers(beatMarkers),
    beatAnalysis,
    modifiedAt: Date.now(),
  };
}

export function clearMotionBeatMarkers(
  composition: MotionComposition,
): MotionComposition {
  return {
    ...composition,
    beatMarkers: [],
    beatAnalysis: undefined,
    modifiedAt: Date.now(),
  };
}

export function getMotionBeatMarkersInRange(
  beatMarkers: readonly TimelineBeatMarker[] | undefined,
  startTime: number,
  endTime: number,
): TimelineBeatMarker[] {
  const start = Math.min(startTime, endTime);
  const end = Math.max(startTime, endTime);
  return (beatMarkers ?? []).filter(
    (marker) => marker.time >= start && marker.time <= end,
  );
}

export function applyMotionAnimationPresetToBeats<T extends MotionLayer>(
  layer: T,
  presetId: MotionAnimationPresetId,
  beatMarkers: readonly TimelineBeatMarker[],
  options: ApplyMotionPresetToBeatsOptions = {},
): T {
  const start = Math.max(0, options.startTime ?? 0);
  const end = Math.min(layer.duration, options.endTime ?? layer.duration);
  const markers = beatMarkers
    .filter((marker) => marker.time >= start && marker.time <= end)
    .filter((marker) => !options.onlyDownbeats || marker.isDownbeat)
    .slice(0, options.maxBeats ?? Number.POSITIVE_INFINITY);

  return markers.reduce<T>((currentLayer, marker, index) => {
    const nextMarker = markers[index + 1];
    const maxDuration = nextMarker
      ? Math.max(0.05, nextMarker.time - marker.time - 0.001)
      : Math.max(0.05, currentLayer.duration - marker.time);
    return applyMotionAnimationPreset(currentLayer, presetId, {
      startTime: marker.time,
      duration: Math.min(options.duration ?? maxDuration, maxDuration),
      distance: options.distance,
      intensity: options.intensity,
      idFactory: (id, property, time, keyIndex) =>
        `${currentLayer.id}-${id}-beat-${marker.index}-${property}-${time}-${keyIndex}`,
    });
  }, layer);
}

export function snapMotionTimeToTimingPoint(
  time: number,
  options: SnapMotionTimeOptions,
): number {
  const threshold = Math.max(0, options.threshold ?? 0.08);
  const candidates = [
    ...(options.markers ?? []).map((marker) => marker.time),
    ...(options.beatMarkers ?? []).map((marker) => marker.time),
  ];
  if (candidates.length === 0) return time;

  let nearest = candidates[0];
  let nearestDistance = Math.abs(time - nearest);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(time - candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearestDistance <= threshold ? nearest : time;
}

function sanitizeMarker(marker: Marker): Marker {
  return {
    ...marker,
    time: normalizeTime(marker.time),
    label: marker.label.trim() || "Marker",
    color: marker.color || "#3b82f6",
  };
}

function sortMarkers(markers: readonly Marker[]): Marker[] {
  return [...markers].map(sanitizeMarker).sort((a, b) => a.time - b.time);
}

function normalizeBeatMarkers(
  markers: readonly TimelineBeatMarker[],
): TimelineBeatMarker[] {
  return [...markers]
    .map((marker, index) => ({
      time: normalizeTime(marker.time),
      strength: clamp(marker.strength, 0, 1),
      index,
      isDownbeat: marker.isDownbeat,
    }))
    .sort((a, b) => a.time - b.time)
    .map((marker, index) => ({ ...marker, index }));
}

function getPeakStats(values: readonly number[]): {
  readonly mean: number;
  readonly deviation: number;
  readonly max: number;
} {
  let sum = 0;
  let max = 0;
  for (const value of values) {
    sum += value;
    max = Math.max(max, value);
  }
  const mean = sum / values.length;
  let variance = 0;
  for (const value of values) {
    variance += (value - mean) ** 2;
  }
  return {
    mean,
    deviation: Math.sqrt(variance / values.length),
    max,
  };
}

function normalizeTime(time: number): number {
  return Number(Math.max(0, Number.isFinite(time) ? time : 0).toFixed(4));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
