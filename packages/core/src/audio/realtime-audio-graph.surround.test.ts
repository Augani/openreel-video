import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import type { Timeline } from "../types/timeline";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";

function createFixture() {
  const audioParam = () => ({
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const splitters: number[] = [];
  const mergers: number[] = [];
  const stereoPanners = vi.fn();
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    createGain: () => ({ ...node(), gain: audioParam() }),
    createStereoPanner: () => {
      stereoPanners();
      return { ...node(), pan: audioParam() };
    },
    createChannelSplitter: (count: number) => {
      splitters.push(count);
      return node();
    },
    createChannelMerger: (count: number) => {
      mergers.push(count);
      return node();
    },
    createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: audioParam(), buffer: null, onended: null }),
  };
  const clock = {
    getAudioContext: () => context,
    get currentTime() {
      return 0;
    },
    get isPlaying() {
      return true;
    },
  } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), splitters, mergers, stereoPanners };
}

const schedule = (channels: number): AudioClipSchedule => ({
  clipId: "clip-1",
  trackId: "track-1",
  audioBuffer: { duration: 10, numberOfChannels: channels } as AudioBuffer,
  startTime: 0,
  endTime: 10,
  mediaOffset: 0,
  volume: 1,
  volumeAutomation: [],
  pan: 0,
  effects: [],
  speed: 1,
});

const timeline = (pan?: { x: number; y: number; divergence: number; lfeSend: number }): Pick<Timeline, "tracks" | "audioBuses"> =>
  ({
    tracks: [
      {
        id: "track-1",
        clips: [{ id: "clip-1", ...(pan ? { surroundPan: pan } : {}) }],
        ...(pan ? { surroundPan: pan } : {}),
      },
    ],
  }) as unknown as Pick<Timeline, "tracks" | "audioBuses">;

describe("RealtimeAudioGraph 5.1 layout", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is a two-channel mix with stereo panners until the sequence is 5.1", () => {
    const { graph, splitters, stereoPanners } = createFixture();
    expect(graph.getMixChannelCount()).toBe(2);
    graph.scheduleClip(schedule(2));
    expect(stereoPanners).toHaveBeenCalled(); // the track and the clip pan
    expect(splitters).toHaveLength(0);
    graph.dispose();
  });

  it("builds six-channel buses and a surround panner per clip in a 5.1 sequence, with no stereo panners", () => {
    const { graph, splitters, mergers, stereoPanners } = createFixture();
    graph.setChannelLayout("5.1", timeline());
    expect(graph.getMixChannelCount()).toBe(6);
    stereoPanners.mockClear();
    splitters.length = 0;
    mergers.length = 0;
    graph.scheduleClip(schedule(2));
    expect(stereoPanners).not.toHaveBeenCalled();
    // the clip's panner: a 2-way splitter into the 6-input merger (the track rack's pairs also split 6 ways)
    expect(splitters).toContain(2);
    expect(mergers).toContain(6);
    graph.dispose();
  });

  it("returns to the stereo graph when the layout goes back", () => {
    const { graph, stereoPanners } = createFixture();
    graph.setChannelLayout("5.1", timeline());
    graph.setChannelLayout("stereo", timeline());
    expect(graph.getMixChannelCount()).toBe(2);
    stereoPanners.mockClear();
    graph.scheduleClip(schedule(2));
    expect(stereoPanners).toHaveBeenCalled();
    graph.dispose();
  });

  it("re-aims a playing clip's panner when the mixer moves it (no rebuild)", () => {
    const { graph, splitters } = createFixture();
    graph.setChannelLayout("5.1", timeline());
    graph.scheduleClip(schedule(1));
    const built = splitters.length;
    graph.setChannelLayout("5.1", timeline({ x: -1, y: -1, divergence: 0, lfeSend: 0 }));
    expect(splitters.length).toBe(built);
    graph.dispose();
  });
});
