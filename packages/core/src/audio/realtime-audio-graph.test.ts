import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";

function createAudioFixture() {
  const sources: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const audioParam = () => ({
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    currentTime: 0,
    destination: {},
    createGain: () => ({ ...node(), gain: audioParam() }),
    createStereoPanner: () => ({ ...node(), pan: audioParam() }),
    createBufferSource: () => {
      const source = { ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: audioParam(), buffer: null, onended: null };
      sources.push(source);
      return source;
    },
  };
  const state = { position: 0, playing: true };
  const clock = {
    getAudioContext: () => context,
    get currentTime() { return state.position; },
    get isPlaying() { return state.playing; },
  } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), state, sources };
}

const clip = (clipId = "audio", startTime = 0, endTime = 10): AudioClipSchedule => ({
  clipId,
  trackId: "track-1",
  audioBuffer: { duration: 10 } as AudioBuffer,
  startTime,
  endTime,
  mediaOffset: 0,
  volume: 1,
  volumeAutomation: [],
  pan: 0,
  effects: [],
  speed: 1,
});

describe("RealtimeAudioGraph seek scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reschedules a loop seek immediately without waiting for the periodic tick", () => {
    const { graph, state, sources } = createAudioFixture();
    state.position = 3.9;
    const provider = vi.fn(() => [clip()]);
    graph.startScheduler(provider);
    expect(sources).toHaveLength(1);

    state.position = 2;
    graph.seekTo(2);

    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenLastCalledWith(2);
    expect(sources).toHaveLength(2);
    expect(sources[1].start).toHaveBeenCalledWith(0, 2, 8);
    graph.dispose();
  });

  it("seeks across clips immediately and keeps a single scheduler without duplicating sources", () => {
    const { graph, state, sources } = createAudioFixture();
    const interval = vi.spyOn(window, "setInterval");
    state.position = 1;
    const provider = vi.fn(() => [clip("first", 0, 2), clip("second", 2, 10)]);
    graph.startScheduler(provider);
    graph.startScheduler(provider);
    expect(interval).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(1);

    state.position = 2.5;
    graph.seekTo(2.5);
    expect(sources).toHaveLength(2);
    expect(sources[1].start).toHaveBeenCalledWith(0, 0.5, 7.5);
    state.position = 2.6;
    vi.advanceTimersByTime(100);
    expect(sources).toHaveLength(2);
    expect(interval).toHaveBeenCalledOnce();
    graph.dispose();
  });

  it("keeps paused scrubbing silent and retains the new offset for resuming", () => {
    const { graph, state, sources } = createAudioFixture();
    const provider = vi.fn(() => [clip()]);
    graph.startScheduler(provider);
    state.playing = false;
    state.position = 4;
    graph.seekTo(4);
    vi.advanceTimersByTime(100);

    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(1);
    expect(provider).toHaveBeenCalledOnce();
    graph.stopScheduler();
    state.playing = true;
    graph.startScheduler(provider);
    expect(sources).toHaveLength(2);
    expect(sources[1].start).toHaveBeenCalledWith(0, 4, 6);
    graph.dispose();
  });

  it("does not revive a stopped or disposed scheduler when seeking", () => {
    const { graph, state, sources } = createAudioFixture();
    const provider = vi.fn(() => [clip()]);
    graph.startScheduler(provider);
    graph.stopScheduler();
    state.position = 2;
    graph.seekTo(2);
    graph.dispose();
    state.position = 3;
    graph.seekTo(3);
    vi.advanceTimersByTime(1_000);

    expect(provider).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(1);
  });
});
