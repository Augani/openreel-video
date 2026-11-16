import type { Clip, Track } from "../../types/timeline";
import type { MediaItem, Project } from "../../types/project";
import { fpsOf, resolveFrameRate, secondsToFrames } from "../timecode";

/**
 * Deterministic project used by the interchange tests and golden fixtures.
 * All times are authored in frames so every frame rate stays frame-aligned.
 */

export const media = (
  id: string,
  name: string,
  type: MediaItem["type"],
  durationSec: number,
  frameRate: number,
  hasAudio: boolean,
): MediaItem => ({
  id,
  name,
  type,
  fileHandle: null,
  blob: null,
  metadata: {
    duration: durationSec,
    width: type === "audio" ? 0 : 1920,
    height: type === "audio" ? 0 : 1080,
    frameRate: type === "audio" ? 0 : frameRate,
    codec: "",
    sampleRate: 48000,
    channels: hasAudio ? 2 : 0,
    fileSize: 1000,
    hasVideo: type !== "audio",
    hasAudio,
  },
  thumbnailUrl: null,
  waveformData: null,
  sourceFile: { name, size: 1000, lastModified: 0 },
});

export interface ClipSpec {
  id: string;
  mediaId: string;
  /** Frames of the project rate. */
  start: number;
  length: number;
  inFrame: number;
  speed?: number;
  reversed?: boolean;
  opacity?: number;
  volume?: number;
}

export function clipOf(spec: ClipSpec, trackId: string, fps: number): Clip {
  const speed = spec.speed ?? 1;
  const inPoint = spec.inFrame / fps;
  const outPoint = inPoint + (spec.length * speed) / fps;
  return {
    id: spec.id,
    mediaId: spec.mediaId,
    trackId,
    startTime: spec.start / fps,
    duration: spec.length / fps,
    inPoint,
    outPoint,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: spec.opacity ?? 1,
      fitMode: "contain",
    },
    volume: spec.volume ?? 1,
    keyframes: [],
    ...(speed !== 1 ? { speed } : {}),
    ...(spec.reversed ? { reversed: true } : {}),
  };
}

const track = (
  id: string,
  type: Track["type"],
  name: string,
  clips: Clip[],
  extra: Partial<Track> = {},
): Track => ({
  id,
  type,
  name,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...extra,
});

/** A three-clip main track with a cross dissolve, an overlay, music and markers. */
export function buildProject(frameRate: number): Project {
  const fps = fpsOf(resolveFrameRate(frameRate));
  const f = (n: number): number => n; // frames are authored directly
  const mainClips = [
    clipOf({ id: "A", mediaId: "m-interview", start: 0, length: f(60), inFrame: 30 }, "t-main", fps),
    clipOf({ id: "B", mediaId: "m-broll", start: 60, length: f(40), inFrame: 100, speed: 2 }, "t-main", fps),
    clipOf({ id: "C", mediaId: "m-interview", start: 100, length: f(50), inFrame: 0, volume: 0.5 }, "t-main", fps),
  ];
  const overlayClips = [
    clipOf({ id: "D", mediaId: "m-broll", start: 20, length: f(30), inFrame: 10, opacity: 0.5 }, "t-over", fps),
  ];
  const musicClips = [
    clipOf({ id: "E", mediaId: "m-music", start: 0, length: f(150), inFrame: 0, volume: 0.8 }, "t-music", fps),
  ];
  const reversedClip = clipOf(
    { id: "F", mediaId: "m-broll", start: 150, length: f(24), inFrame: 200, reversed: true },
    "t-main",
    fps,
  );
  const main = track("t-main", "video", "Main", [...mainClips, reversedClip], {
    transitions: [
      {
        id: "tr-1",
        clipAId: "A",
        clipBId: "B",
        type: "crossfade",
        duration: 20 / fps,
        params: {},
      },
    ],
  });
  const project: Project = {
    id: "p1",
    name: "Interchange Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate, sampleRate: 48000, channels: 2 },
    mediaLibrary: {
      items: [
        media("m-interview", "interview.mp4", "video", 600, frameRate, true),
        media("m-broll", "broll clip.mov", "video", 600, frameRate, false),
        media("m-music", "music.wav", "audio", 300, 0, true),
      ],
    },
    timeline: {
      tracks: [
        track("t-over", "video", "V2", overlayClips),
        main,
        track("t-music", "audio", "A1", musicClips),
      ],
      subtitles: [],
      duration: 174 / fps,
      markers: [
        { id: "mk1", time: 30 / fps, label: "Intro", color: "#3b82f6" },
        { id: "mk2", time: 125 / fps, label: "Beat & Drop <b>", color: "#3b82f6" },
      ],
    },
  };
  return project;
}

export const frames = (seconds: number, frameRate: number): number =>
  secondsToFrames(seconds, resolveFrameRate(frameRate));
