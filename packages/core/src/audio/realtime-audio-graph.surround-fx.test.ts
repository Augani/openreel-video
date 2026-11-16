import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import type { AudioRack, Effect, Timeline } from "../types";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";

/**
 * A recording stand-in for the AudioContext: every node records its channel configuration so the tests can assert
 * what the graph builds for a stereo and a 5.1 clip chain without a browser.
 */
function createFixture() {
  const audioParam = () => ({
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = (kind: string) => ({ kind, connect: vi.fn(), disconnect: vi.fn() });
  const made: Record<string, number> = {};
  const track = (kind: string) => {
    made[kind] = (made[kind] ?? 0) + 1;
  };
  const convolverBuffers: number[] = [];
  const sources: Array<ReturnType<typeof node> & { stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }> = [];
  const splitters: number[] = [];
  const mergers: number[] = [];
  let now = 0;
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    createGain: () => {
      track("gain");
      return { ...node("gain"), gain: audioParam(), channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
    },
    createStereoPanner: () => {
      track("stereoPanner");
      return { ...node("stereoPanner"), pan: audioParam() };
    },
    createChannelSplitter: (count: number) => {
      splitters.push(count);
      return node("splitter");
    },
    createChannelMerger: (count: number) => {
      mergers.push(count);
      return node("merger");
    },
    createDynamicsCompressor: () => {
      track("dynamicsCompressor");
      return { ...node("dynamicsCompressor"), threshold: audioParam(), ratio: audioParam(), attack: audioParam(), release: audioParam(), knee: audioParam(), reduction: 0 };
    },
    createBiquadFilter: () => {
      track("biquad");
      return { ...node("biquad"), type: "peaking", frequency: audioParam(), gain: audioParam(), Q: audioParam(), channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
    },
    createConvolver: () => {
      track("convolver");
      const convolver = { ...node("convolver"), set buffer(value: { numberOfChannels: number }) { convolverBuffers.push(value.numberOfChannels); } };
      return convolver;
    },
    createDelay: () => {
      track("delay");
      return { ...node("delay"), delayTime: audioParam(), channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
    },
    createWaveShaper: () => {
      track("waveShaper");
      return { ...node("waveShaper"), curve: null, oversample: "none", channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
    },
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      track("bufferSource");
      const source = { ...node("bufferSource"), start: vi.fn(), stop: vi.fn(), playbackRate: audioParam(), buffer: null, onended: null as null | (() => void) };
      sources.push(source);
      return source;
    },
  };
  const clock = {
    getAudioContext: () => context,
    get currentTime() {
      return now;
    },
    get isPlaying() {
      return true;
    },
  } as unknown as MasterTimelineClock;
  return {
    graph: new RealtimeAudioGraph(clock),
    made,
    sources,
    splitters,
    mergers,
    convolverBuffers,
    setNow: (value: number) => {
      now = value;
    },
    reset: () => {
      for (const key of Object.keys(made)) delete made[key];
      convolverBuffers.length = 0;
      splitters.length = 0;
      mergers.length = 0;
    },
  };
}

const effect = (type: string, params: Record<string, unknown> = {}): Effect => ({ id: `fx-${type}`, type, params, enabled: true }) as unknown as Effect;

const schedule = (channels: number, effects: Effect[] = [], extra: Partial<AudioClipSchedule> = {}): AudioClipSchedule => ({
  clipId: "clip-1",
  trackId: "track-1",
  audioBuffer: { duration: 10, numberOfChannels: channels } as AudioBuffer,
  startTime: 0,
  endTime: 10,
  mediaOffset: 0,
  volume: 1,
  volumeAutomation: [],
  pan: 0,
  effects,
  speed: 1,
  ...extra,
});

const timeline = (): Pick<Timeline, "tracks" | "audioBuses"> =>
  ({ tracks: [{ id: "track-1", clips: [{ id: "clip-1" }] }] }) as unknown as Pick<Timeline, "tracks" | "audioBuses">;

describe("clip-level effects follow the clip's channel count", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the native stereo compressor and convolver for a stereo clip (the graph it always built)", () => {
    const f = createFixture();
    f.graph.scheduleClip(schedule(2, [effect("compressor"), effect("reverb")]));
    expect(f.made.dynamicsCompressor).toBe(1);
    expect(f.made.convolver).toBe(1);
    expect(f.convolverBuffers).toEqual([2]);
    f.graph.dispose();
  });

  it("does not fold a 5.1 clip through the two-channel compressor: the linked six-channel stage replaces it", () => {
    const f = createFixture();
    f.graph.setChannelLayout("5.1", timeline());
    f.reset();
    f.graph.scheduleClip(schedule(6, [effect("compressor", { threshold: -30 })]));
    expect(f.made.dynamicsCompressor ?? 0).toBe(0);
    f.graph.dispose();
  });

  it("runs reverb on a 5.1 clip as one mono convolver per channel instead of a stereo ConvolverNode", () => {
    const f = createFixture();
    f.graph.setChannelLayout("5.1", timeline());
    f.reset();
    f.graph.scheduleClip(schedule(6, [effect("reverb", { roomSize: 0.1 })]));
    expect(f.made.convolver).toBe(6);
    expect(f.convolverBuffers).toEqual([1, 1, 1, 1, 1, 1]);
    expect(f.splitters).toContain(6);
    expect(f.mergers).toContain(6);
    f.graph.dispose();
  });

  it("a mono clip in a 5.1 sequence keeps the native compressor (one channel needs no linking)", () => {
    const f = createFixture();
    f.graph.setChannelLayout("5.1", timeline());
    f.reset();
    f.graph.scheduleClip(schedule(1, [effect("compressor")]));
    expect(f.made.dynamicsCompressor).toBe(1);
    f.graph.dispose();
  });
});

describe("5.1 track effect racks run on all six channels at once", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const rack = (): AudioRack => ({
    effects: [
      { id: "c", type: "compressor", bypassed: false, params: {} },
      { id: "l", type: "limiter", bypassed: false, params: {} },
      { id: "r", type: "reverb", bypassed: false, params: {} },
    ],
  }) as unknown as AudioRack;

  it("uses the linked compressor and per-channel convolvers in a 5.1 rack, not three stereo pairs of native nodes", () => {
    const f = createFixture();
    f.graph.setChannelLayout("5.1", timeline());
    f.reset();
    f.graph.setTrackRack("track-1", rack());
    f.graph.createTrack({ trackId: "track-1", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    expect(f.made.dynamicsCompressor ?? 0).toBe(0);
    expect(f.made.convolver).toBe(6);
    // The limiter's hard-clip stage is a single six-channel shaper, not one per pair.
    expect(f.made.waveShaper).toBe(1);
    f.graph.dispose();
  });

  it("keeps the stereo rack on native nodes", () => {
    const f = createFixture();
    f.graph.setTrackRack("track-1", rack());
    f.graph.createTrack({ trackId: "track-1", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    expect(f.made.dynamicsCompressor).toBe(2); // compressor + limiter
    expect(f.made.convolver).toBe(1);
    f.graph.dispose();
  });
});

describe("switching the sequence layout while playing", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const live = (graph: RealtimeAudioGraph) =>
    ((graph as unknown as { scheduledSources: Map<string, Array<{ clipId: string }>> }).scheduledSources.get("track-1") ?? []).map((s) => s.clipId);

  it("stops the old sources, rebuilds the topology and puts the sounding clip back at once, exactly once", () => {
    const f = createFixture();
    f.setNow(2);
    const getClips = () => [schedule(2)];
    f.graph.startScheduler(getClips);
    expect(live(f.graph)).toEqual(["clip-1"]);
    const first = f.sources[0];
    expect(f.sources).toHaveLength(1);

    f.graph.setChannelLayout("5.1", timeline());
    expect(first.stop).toHaveBeenCalled();
    expect(f.graph.getMixChannelCount()).toBe(6);
    // Rescheduled immediately (no waiting for the 100 ms tick), on the new topology, without duplicates.
    expect(f.sources).toHaveLength(2);
    expect(live(f.graph)).toEqual(["clip-1"]);
    expect(f.sources[1].start).toHaveBeenCalled();
    // The new clip really went through the surround panner (a 2-way splitter into the 6-way merger).
    expect(f.splitters).toContain(2);

    f.setNow(2.5);
    f.graph.setChannelLayout("stereo", timeline());
    expect(f.sources[1].stop).toHaveBeenCalled();
    expect(f.graph.getMixChannelCount()).toBe(2);
    expect(f.sources).toHaveLength(3);
    expect(live(f.graph)).toEqual(["clip-1"]);

    // Repeating the same layout is a no-op for the sources: nothing is stopped or restarted.
    f.graph.setChannelLayout("stereo", timeline());
    expect(f.sources).toHaveLength(3);
    f.graph.dispose();
  });

  it("rewinds the scheduling horizon so a clip that was queued ahead of the playhead is not lost", () => {
    const f = createFixture();
    f.setNow(1);
    // The clip starts 150 ms ahead: the scheduler has already queued it when the layout flips.
    const upcoming = [schedule(2, [], { startTime: 1.15, endTime: 3 })];
    f.graph.startScheduler(() => upcoming);
    expect(live(f.graph)).toEqual(["clip-1"]);
    f.graph.setChannelLayout("5.1", timeline());
    expect(live(f.graph)).toEqual(["clip-1"]);
    expect(f.sources).toHaveLength(2);
    f.graph.dispose();
  });

  it("works when nothing is playing: no sources are created by a layout switch", () => {
    const f = createFixture();
    f.graph.setChannelLayout("5.1", timeline());
    f.graph.setChannelLayout("stereo", timeline());
    expect(f.sources).toHaveLength(0);
    f.graph.dispose();
  });
});
