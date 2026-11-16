import { describe, expect, it } from "vitest";
import { PlaybackController } from "./playback-controller";
import type { AudioClipSchedule } from "../audio/realtime-audio-graph";
import type { Clip, Project, Track } from "../types";

const identity = {
  position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1,
};
const clip = (id: string, trackId: string, over: Partial<Clip> = {}): Clip => ({
  id, mediaId: "m", trackId, startTime: 0, duration: 4, inPoint: 0, outPoint: 4, volume: 1,
  transform: identity, effects: [], audioEffects: [], keyframes: [], ...over,
});
const track = (id: string, clips: Clip[]): Track => ({
  id, name: id, type: "audio", clips, transitions: [], locked: false, hidden: false, muted: false, solo: false,
} as unknown as Track);

const schedulesFor = (tracks: Track[]): AudioClipSchedule[] => {
  // Skip the constructor: it creates a real AudioContext-backed master clock.
  const controller: PlaybackController = Object.create(PlaybackController.prototype);
  const buffer = { duration: 10 } as AudioBuffer;
  Object.assign(controller, {
    audioEngine: {},
    project: {
      timeline: { tracks, subtitles: [], markers: [], duration: 4 },
      mediaLibrary: { items: [{ id: "m", blob: new Blob(["x"]), type: "audio", metadata: { duration: 10, hasAudio: true } }] },
    } as unknown as Project,
    audioBufferCache: new Map([["m", buffer]]),
  });
  return (controller as unknown as { getAudioClipsAtTime(t: number): AudioClipSchedule[] }).getAudioClipsAtTime(0);
};

describe("PlaybackController audio schedules", () => {
  const pan = [{ time: 0, value: -1 }, { time: 4, value: 1 }];

  it("passes an explicit pitchCorrection=false and the pan lane through", () => {
    const c = clip("a", "ta", { speed: 2, pitchCorrection: false, automation: { pan } });
    const [schedule] = schedulesFor([track("ta", [c])]);
    expect(schedule.pitchCorrection).toBe(false);
    expect(schedule.panAutomation).toEqual(pan);
  });

  it("defaults pitchCorrection on and falls back to the linked clip's lane and flag", () => {
    const video = clip("v", "tv");
    const audio = clip("a", "ta", { automation: { pan }, pitchCorrection: false });
    const schedules = schedulesFor([track("tv", [video]), track("ta", [audio])]);
    const v = schedules.find((s) => s.clipId === "v");
    expect(v?.panAutomation).toEqual(pan);
    expect(v?.pitchCorrection).toBe(false);
    const plain = clip("p", "tp");
    expect(schedulesFor([track("tp", [plain])])[0].pitchCorrection).toBe(true);
  });
});
