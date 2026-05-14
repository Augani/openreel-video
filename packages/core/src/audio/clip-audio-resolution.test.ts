import { describe, expect, it } from "vitest";
import type { Clip, Timeline, Track } from "../types/timeline";
import {
  resolveAudibleAudioTarget,
  resolveClipAudioEffects,
  resolveClipVolumeAutomation,
} from "./clip-audio-resolution";

const createClip = (overrides: Partial<Clip>): Clip => ({
  id: "clip",
  mediaId: "media-1",
  trackId: "video-track",
  startTime: 0,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
  effects: [],
  audioEffects: [],
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    anchor: { x: 0.5, y: 0.5 },
    opacity: 1,
  },
  volume: 1,
  keyframes: [],
  ...overrides,
});

const createTrack = (overrides: Partial<Track>): Track => ({
  id: "track",
  type: "video",
  name: "Track",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const createSeparatedAudioTimeline = (): {
  timeline: Timeline;
  videoClip: Clip;
  audioClip: Clip;
} => {
  const noiseEffect = {
    id: "noise-1",
    type: "noiseReduction",
    enabled: true,
    params: { reduction: 0.8 },
  };
  const duckingPoints = [
    { time: 0, value: 1, curve: "linear" as const },
    { time: 1, value: 0.35, curve: "linear" as const },
  ];
  const videoClip = createClip({
    id: "video-clip",
    trackId: "video-track",
    volume: 0,
    audioEffects: [noiseEffect],
    automation: { volume: duckingPoints },
  });
  const audioClip = createClip({
    id: "audio-clip",
    trackId: "audio-track",
    volume: 1,
  });
  const timeline: Timeline = {
    tracks: [
      createTrack({ id: "video-track", type: "video", clips: [videoClip] }),
      createTrack({ id: "audio-track", type: "audio", clips: [audioClip] }),
    ],
    subtitles: [],
    duration: 10,
    markers: [],
  };

  return { timeline, videoClip, audioClip };
};

describe("clip audio resolution", () => {
  it("resolves noise reduction effects from a linked separated video clip", () => {
    const { timeline, audioClip } = createSeparatedAudioTimeline();

    expect(resolveClipAudioEffects(audioClip, timeline)).toEqual([
      expect.objectContaining({ id: "noise-1" }),
    ]);
  });

  it("resolves ducking automation from a linked separated video clip", () => {
    const { timeline, audioClip } = createSeparatedAudioTimeline();

    expect(resolveClipVolumeAutomation(audioClip, timeline)).toEqual([
      expect.objectContaining({ value: 1 }),
      expect.objectContaining({ value: 0.35 }),
    ]);
  });

  it("uses the audible linked audio clip as the target for silent separated video", () => {
    const { timeline, videoClip, audioClip } = createSeparatedAudioTimeline();

    expect(resolveAudibleAudioTarget(videoClip, timeline).id).toBe(audioClip.id);
  });
});