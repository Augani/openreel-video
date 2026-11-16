import { Film, Volume2, Image, Type, Shapes, Layers } from "@/icons/lucide-compat";
import type { Track } from "@openreel/core";
import type {
  SnapPoint,
  SnapResult,
  SnapSettings,
  ClipStyle,
  TrackInfo,
} from "./types";

export const calculateSnap = (
  rawTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  pixelsPerSecond: number,
  clipDuration?: number,
): SnapResult => {
  if (!snapSettings.enabled) {
    return { time: rawTime, snapped: false };
  }

  const thresholdSeconds = snapSettings.snapThreshold / pixelsPerSecond;
  const snapPoints: SnapPoint[] = [];

  if (snapSettings.snapToClips) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) continue;
        snapPoints.push({ time: clip.startTime, type: "clip-start" });
        snapPoints.push({
          time: clip.startTime + clip.duration,
          type: "clip-end",
        });
      }
    }
  }

  if (snapSettings.snapToPlayhead) {
    snapPoints.push({ time: playheadPosition, type: "playhead" });
  }

  if (snapSettings.snapToGrid) {
    const nearestGrid =
      Math.round(rawTime / snapSettings.gridSize) * snapSettings.gridSize;
    snapPoints.push({ time: nearestGrid, type: "grid" });
    if (clipDuration) {
      const endTime = rawTime + clipDuration;
      const nearestEndGrid =
        Math.round(endTime / snapSettings.gridSize) * snapSettings.gridSize;
      snapPoints.push({ time: nearestEndGrid, type: "grid" });
    }
  }

  const priorityOrder: Record<string, number> = {
    "clip-start": 0,
    "clip-end": 0,
    "playhead": 1,
    "grid": 2,
  };

  let closestPoint: SnapPoint | undefined;
  let closestDistance = Infinity;
  let closestPriority = Infinity;
  let snapFromEnd = false;

  for (const point of snapPoints) {
    const pointPriority = priorityOrder[point.type] ?? 2;

    const startDistance = Math.abs(point.time - rawTime);
    if (startDistance < thresholdSeconds) {
      const isBetter =
        pointPriority < closestPriority ||
        (pointPriority === closestPriority && startDistance < closestDistance);
      if (isBetter) {
        closestDistance = startDistance;
        closestPriority = pointPriority;
        closestPoint = point;
        snapFromEnd = false;
      }
    }

    if (clipDuration) {
      const clipEndTime = rawTime + clipDuration;
      const endDistance = Math.abs(point.time - clipEndTime);
      if (endDistance < thresholdSeconds) {
        const isBetter =
          pointPriority < closestPriority ||
          (pointPriority === closestPriority && endDistance < closestDistance);
        if (isBetter) {
          closestDistance = endDistance;
          closestPriority = pointPriority;
          closestPoint = point;
          snapFromEnd = true;
        }
      }
    }
  }

  if (closestPoint) {
    const snappedTime = snapFromEnd
      ? closestPoint.time - (clipDuration ?? 0)
      : closestPoint.time;
    return {
      time: Math.max(0, snappedTime),
      snapped: true,
      snapPoint: { ...closestPoint, time: closestPoint.time },
    };
  }

  return { time: rawTime, snapped: false };
};

interface ClipWaveformBarOptions {
  barCount: number;
  startBar?: number;
  endBar?: number;
  mediaDuration: number;
  inPoint: number;
  outPoint: number;
  reversed?: boolean;
}

/**
 * Samples the source-media waveform over the range represented by a timeline
 * clip. Each bar uses the highest peak in its source-time bucket so short
 * transients remain visible while genuinely silent buckets stay at zero.
 */
export const getClipWaveformBarAmplitudes = (
  waveformData: Float32Array | number[] | null | undefined,
  options: ClipWaveformBarOptions,
): number[] => {
  const barCount = Math.max(0, Math.floor(options.barCount));
  if (barCount === 0) return [];
  const startBar = Math.max(0, Math.min(barCount, Math.floor(options.startBar ?? 0)));
  const endBar = Math.max(startBar, Math.min(barCount, Math.ceil(options.endBar ?? barCount)));
  const visibleCount = endBar - startBar;
  if (visibleCount === 0) return [];

  if (
    !waveformData ||
    waveformData.length === 0 ||
    !Number.isFinite(options.mediaDuration) ||
    options.mediaDuration <= 0
  ) {
    return Array.from({ length: visibleCount }, () => 0);
  }

  const mediaDuration = options.mediaDuration;
  const sourceStart = Math.max(0, Math.min(mediaDuration, options.inPoint));
  const sourceEnd = Math.max(
    sourceStart,
    Math.min(mediaDuration, options.outPoint),
  );
  const sourceDuration = sourceEnd - sourceStart;

  if (sourceDuration <= 0) {
    return Array.from({ length: visibleCount }, () => 0);
  }

  return Array.from({ length: visibleCount }, (_, visibleIndex) => {
    const barIndex = startBar + visibleIndex;
    const displayIndex = options.reversed
      ? barCount - barIndex - 1
      : barIndex;
    const bucketStartTime =
      sourceStart + (displayIndex / barCount) * sourceDuration;
    const bucketEndTime =
      sourceStart + ((displayIndex + 1) / barCount) * sourceDuration;
    const startSample = Math.max(
      0,
      Math.min(
        waveformData.length - 1,
        Math.floor((bucketStartTime / mediaDuration) * waveformData.length),
      ),
    );
    const endSample = Math.max(
      startSample + 1,
      Math.min(
        waveformData.length,
        Math.ceil((bucketEndTime / mediaDuration) * waveformData.length),
      ),
    );

    let peak = 0;
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      const sample = Number(waveformData[sampleIndex]);
      if (Number.isFinite(sample)) {
        peak = Math.max(peak, Math.abs(sample));
      }
    }

    return Math.min(1, peak);
  });
};

export const formatTimecode = (
  timeInSeconds: number,
  frameRate: number = 30,
): string => {
  if (!isFinite(timeInSeconds) || isNaN(timeInSeconds) || timeInSeconds < 0) {
    return "00:00:00:00";
  }
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  const frames = Math.floor((timeInSeconds % 1) * frameRate);
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${frames
    .toString()
    .padStart(2, "0")}`;
};

export const getTrackInfo = (track: Track, index: number): TrackInfo => {
  if (track.mode === "standard") {
    return {
      label: `T${index + 1}`,
      icon: Layers,
      color: "bg-fg-muted",
      textColor: "text-fg-2",
      bgLight: "bg-fg-muted/10",
    };
  }
  switch (track.type) {
    case "video":
      return {
        label: `V${index + 1}`,
        icon: Film,
        color: "bg-primary",
        textColor: "text-primary",
        bgLight: "bg-primary/20",
      };
    case "audio":
      return {
        label: `A${index + 1}`,
        icon: Volume2,
        color: "bg-blue-500",
        textColor: "text-blue-400",
        bgLight: "bg-blue-500/20",
      };
    case "image":
      return {
        label: `I${index + 1}`,
        icon: Image,
        color: "bg-primary",
        textColor: "text-primary",
        bgLight: "bg-primary/20",
      };
    case "text":
      return {
        label: `T${index + 1}`,
        icon: Type,
        color: "bg-amber-500",
        textColor: "text-amber-400",
        bgLight: "bg-amber-500/20",
      };
    case "graphics":
      return {
        label: `G${index + 1}`,
        icon: Shapes,
        color: "bg-green-500",
        textColor: "text-green-400",
        bgLight: "bg-green-500/20",
      };
    default:
      return {
        label: `?${index + 1}`,
        icon: Layers,
        color: "bg-gray-500",
        textColor: "text-gray-400",
        bgLight: "bg-gray-500/20",
      };
  }
};

export const getClipStyle = (trackType: string): ClipStyle => {
  switch (trackType) {
    case "video":
      return {
        bg: "bg-[var(--c-video)]",
        border: "border-transparent",
        text: "text-white",
        selectedText: "text-white",
      };
    case "audio":
      return {
        bg: "bg-[var(--c-audio)]",
        border: "border-[#308e71]",
        text: "text-[#c5eddf]",
        selectedText: "text-[#c5eddf]",
      };
    case "image":
      return {
        bg: "bg-[var(--c-text)]",
        border: "border-transparent",
        text: "text-white",
        selectedText: "text-white",
      };
    default:
      return {
        bg: "bg-[var(--c-text)]",
        border: "border-transparent",
        text: "text-white",
        selectedText: "text-white",
      };
  }
};
