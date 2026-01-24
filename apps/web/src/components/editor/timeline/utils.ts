import { Film, Volume2, Image, Type, Shapes, Layers } from "lucide-react";
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
  }

  let closestPoint: SnapPoint | undefined;
  let closestDistance = Infinity;

  for (const point of snapPoints) {
    const distance = Math.abs(point.time - rawTime);
    if (distance < thresholdSeconds && distance < closestDistance) {
      closestDistance = distance;
      closestPoint = point;
    }
  }

  if (closestPoint) {
    return { time: closestPoint.time, snapped: true, snapPoint: closestPoint };
  }

  return { time: rawTime, snapped: false };
};

export const generateWaveformPath = (
  waveformData: Float32Array | number[],
  width: number,
): string => {
  if (!waveformData || waveformData.length === 0) {
    return "M0,20 L100,20";
  }

  const samples = Array.from(waveformData);
  const step = Math.max(1, Math.floor(samples.length / width));
  const points: string[] = [];

  for (let i = 0; i < width; i++) {
    const sampleIndex = Math.min(i * step, samples.length - 1);
    const value = Math.abs(samples[sampleIndex] || 0);
    const y = 20 - value * 18;
    points.push(`${i === 0 ? "M" : "L"}${i},${y}`);
  }

  return points.join(" ");
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
        color: "bg-purple-500",
        textColor: "text-purple-400",
        bgLight: "bg-purple-500/20",
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
        bg: "bg-primary/10",
        border: "border-primary/30",
        text: "text-white/90",
        selectedText: "text-white",
      };
    case "audio":
      return {
        bg: "bg-blue-500/10",
        border: "border-blue-500/30",
        text: "text-text-secondary",
        selectedText: "text-blue-400",
      };
    case "image":
      return {
        bg: "bg-purple-500/10",
        border: "border-purple-500/30",
        text: "text-purple-300",
        selectedText: "text-purple-400",
      };
    default:
      return {
        bg: "bg-gray-500/10",
        border: "border-gray-500/30",
        text: "text-text-secondary",
        selectedText: "text-text-primary",
      };
  }
};
