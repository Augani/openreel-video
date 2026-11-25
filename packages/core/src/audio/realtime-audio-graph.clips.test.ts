import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeAudioGraph,
  SCHEDULE_START_LOOKAHEAD_SECONDS as LEAD,
  type AudioClipSchedule,
} from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";

function fixture() {
  const nodes: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const gains: Array<{ gain: ReturnType<typeof parameter> }> = [];
  const panners: Array<{ pan: { value: number } }> = [];
  const sources: Array<ReturnType<typeof sourceNode>> = [];
  const parameter = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
  const node = () => {
    const result = { connect: vi.fn(), disconnect: vi.fn() };
    nodes.push(result);
    return result;
  };
  const sourceNode = () => ({
    ...node(),
    buffer: null as AudioBuffer | null,
    playbackRate: parameter(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  });
  const context = {
    currentTime: 0,
    destination: {},
    sampleRate: 8000,
    createGain: () => {
      const value = { ...node(), gain: parameter() };
      gains.push(value);
      return value;
    },
    createStereoPanner: () => {
      const value = { ...node(), pan: parameter() };
      panners.push(value);
      return value;
    },
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const value = sourceNode();
      sources.push(value);
      return value;
    },
  };
  const state = { time: 0 };
  const clock = {
    getAudioContext: () => context,
    get currentTime() {
      return state.time;
    },
    isPlaying: true,
  } as unknown as MasterTimelineClock;
  return {
    graph: new RealtimeAudioGraph(clock),
    state,
    context,
    sources,
    nodes,
    panners,
    gains,
  };
}
function schedule(
  id: string,
  overrides: Partial<AudioClipSchedule> = {},
): AudioClipSchedule {
  return {
    clipId: id,
    trackId: "root",
    audioBuffer: { duration: 20 } as AudioBuffer,
    startTime: 0,
    endTime: 5,
    mediaOffset: 0,
    volume: 1,
    volumeAutomation: [],
    pan: 0,
    effects: [],
    speed: 1,
    ...overrides,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("each scheduled clip owns its effects and nodes", () => {
  it("schedules overlapping fades without losing their audible peak", () => {
    const { graph, gains } = fixture();
    graph.scheduleClip(schedule("overlap", { fadeIn: 5, fadeOut: 5 }));
    const ramps = gains.map(({ gain }) => gain.linearRampToValueAtTime.mock.calls as number[][]).find((calls) => calls.length === 2);
    expect(ramps).toBeDefined();
    expect(ramps![0][0]).toBeCloseTo(0.5, 9);
    expect(ramps![0][1]).toBeCloseTo(2.5, 9);
    expect(ramps![1][0]).toBeCloseTo(0, 9);
    expect(ramps![1][1]).toBeCloseTo(5, 9);
  });

  it("keeps original-clock fades and local transition timing after a seek", () => {
    const { graph, gains, state } = fixture();
    state.time = 0.5 - LEAD; // the clip starts LEAD ahead of the clock, i.e. at 0.5 on the timeline
    graph.scheduleClip(schedule("piece", { endTime: 2, fadeIn: 5, fadeOut: 4, fadeOrigin: { offset: 4, duration: 10 }, transitionFadeIn: 1 }));
    const fade = gains.find(({ gain }) => gain.setValueAtTime.mock.calls.some(([value, time]) => Math.abs(value - 0.5) < 1e-8 && Math.abs(time - LEAD) < 1e-8));
    expect(fade).toBeDefined();
    expect(fade!.gain.linearRampToValueAtTime.mock.calls.some(([value, time]) => Math.abs(value - 1) < 1e-8 && Math.abs(time - (0.5 + LEAD)) < 1e-8)).toBe(true);
  });

  it("keeps overlapping sources and the root mixer tap while applying independent clip pan", () => {
    const { graph, sources, panners } = fixture();
    graph.createTrack({
      trackId: "root",
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
    });
    const meter = graph.getTrackOutputGain("root");
    graph.scheduleClip(
      schedule("left", {
        effects: [
          {
            id: "left-pan",
            type: "pan",
            enabled: true,
            params: { value: -0.5 },
          },
        ],
      }),
    );
    graph.scheduleClip(
      schedule("right", {
        effects: [
          {
            id: "right-pan",
            type: "pan",
            enabled: true,
            params: { value: 0.5 },
          },
        ],
      }),
    );
    expect(sources[0].stop).not.toHaveBeenCalled();
    expect(graph.getTrackOutputGain("root")).toBe(meter);
    expect(panners.map((item) => item.pan.value)).toContain(-0.5);
    expect(panners.map((item) => item.pan.value)).toContain(0.5);
    graph.dispose();
  });
  it("does not apply clip volume a second time through an implicitly created track", () => {
    const { graph } = fixture();
    graph.scheduleClip(schedule("quiet", { volume: 0.5 }));
    expect(graph.getTrackVolume("root")).toBe(1);
    graph.dispose();
  });
  it("seeks source audio using clip speed and keeps the requested timeline duration", () => {
    const { graph, state, sources } = fixture();
    state.time = 3 - LEAD; // the clip starts LEAD ahead of the clock, i.e. at 3 on the timeline
    graph.scheduleClip(
      schedule("fast", { startTime: 1, endTime: 6, mediaOffset: 2, speed: 2, pitchCorrection: false }),
    );
    expect(sources[0].start).toHaveBeenCalledWith(LEAD, expect.closeTo(6, 9), expect.closeTo(6, 9));
    expect(sources[0].stop).not.toHaveBeenCalled();
    graph.dispose();
  });
  it("starts every clip of one batch from the same instant even while the clock advances between clips", () => {
    const { graph, state, sources } = fixture();
    // A starved main thread: the audio clock moves 5 ms each time it is read.
    let now = 0.2;
    Object.defineProperty(state, "time", { get: () => (now += 0.005) });
    graph.scheduleClips([
      schedule("dialogue", { startTime: 0, endTime: 4 }),
      schedule("music", { startTime: 0, endTime: 4, trackId: "t2" }),
    ]);
    const offsets = sources.map((source) => source.start.mock.calls[0][1]);
    expect(offsets).toHaveLength(2);
    expect(offsets[1]).toBe(offsets[0]);
    graph.dispose();
  });
  const bigBuffer = (seconds: number, rate = 8000) => ({
    numberOfChannels: 1, sampleRate: rate, length: rate * seconds, duration: seconds,
    getChannelData: () => new Float32Array(rate * seconds),
  }) as unknown as AudioBuffer;
  // Stretch jobs finish when the test says so; the output is just the right length (speed 2 halves it).
  const manualRunner = () => {
    const jobs: Array<{ resolve: () => void; calls: number }> = [];
    const runner = vi.fn((channels: Float32Array[]) => new Promise<Float32Array[]>((resolve) => {
      jobs.push({ calls: 1, resolve: () => resolve(channels.map((c) => new Float32Array(Math.round(c.length / 2)))) });
    }));
    return { runner, jobs };
  };
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("plays resampled at once (no waiting, no silence), then switches to the cached stretch at 1x", async () => {
    const { graph, sources } = fixture();
    const { runner, jobs } = manualRunner();
    graph.setStretchRunner(runner);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = bigBuffer(2);
    graph.scheduleClip(schedule("fast", { audioBuffer, endTime: 1, speed: 2, mediaOffset: 0 }));
    expect(sources).toHaveLength(1);
    expect(sources[0].playbackRate.value).toBe(2);
    expect(sources[0].buffer).toBe(audioBuffer);
    expect(sources[0].start).toHaveBeenCalled();
    expect(runner).toHaveBeenCalledTimes(1);
    // Another schedule of the same range joins the running job instead of starting another.
    graph.scheduleClip(schedule("fast2", { audioBuffer, endTime: 1, speed: 2, mediaOffset: 0 }));
    expect(runner).toHaveBeenCalledTimes(1);

    jobs[0].resolve();
    await flush();
    // Both resampled sources were retired with a fade and rebuilt on the stretch.
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources).toHaveLength(4);
    expect(sources[2].playbackRate.value).toBe(1);
    expect(sources[2].buffer?.duration).toBeCloseTo(1, 3);
    expect(sources[3].buffer).toBe(sources[2].buffer);

    // A later schedule of the same range uses the cache straight away.
    graph.scheduleClip(schedule("fast3", { audioBuffer, endTime: 1, speed: 2, mediaOffset: 0 }));
    expect(sources[4].playbackRate.value).toBe(1);
    expect(sources[4].buffer).toBe(sources[2].buffer);
    expect(runner).toHaveBeenCalledTimes(1);
    graph.dispose();
  });
  it("stretches only the clip's used source range, offset into the buffer", async () => {
    const { graph, sources } = fixture();
    const seen: number[] = [];
    graph.setStretchRunner(async (channels) => {
      seen.push(channels[0].length);
      return channels.map((c) => new Float32Array(Math.round(c.length / 2)));
    });
    const audioBuffer = bigBuffer(600);
    graph.scheduleClip(schedule("fast", { audioBuffer, endTime: 1, speed: 2, mediaOffset: 100 }));
    await flush();
    expect(seen).toEqual([16000]);
    graph.scheduleClip(schedule("fast-again", { audioBuffer, endTime: 1, speed: 2, mediaOffset: 100 }));
    expect(sources.at(-1)!.buffer?.duration).toBeCloseTo(1, 3);
    const [when, offset, duration] = sources.at(-1)!.start.mock.calls[0];
    expect(when).toBe(LEAD);
    expect(offset).toBeCloseTo(LEAD, 9); // the stretched render begins at the clip's first used sample, plus the start lead
    expect(duration).toBeCloseTo(1 - LEAD, 9);
    graph.dispose();
  });
  it("lets a clip effect tail ring out when the resampled source is retired for the stretch", async () => {
    const { graph, sources, nodes, context } = fixture();
    const { runner, jobs } = manualRunner();
    graph.setStretchRunner(runner);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const tailNode = context.createGain();
    const passthrough = context.createGain();
    (graph as unknown as { buildEffectChain: () => unknown }).buildEffectChain = () => ({
      allNodes: [passthrough, tailNode], tailSeconds: 1, creativeChains: [], effectChainInput: passthrough, effectChainOutput: tailNode,
      compressor: null, eqFilters: [], noiseReductionNodes: [], reverbNodes: null, delayNodes: null,
    });
    const effects = [{ id: "r", type: "reverb", enabled: true, params: {} }] as unknown as AudioClipSchedule["effects"];
    graph.scheduleClip(schedule("verb", { audioBuffer: bigBuffer(2), endTime: 1, speed: 2, mediaOffset: 0, effects }));
    jobs[0].resolve();
    await flush();
    expect(sources[0].stop).toHaveBeenCalled();
    // The old source ends: the effect nodes must stay connected while the tail rings out.
    sources[0].onended?.();
    expect(tailNode.disconnect).not.toHaveBeenCalled();
    expect(nodes.length).toBeGreaterThan(0);
    graph.dispose();
  });

  it("keeps the resampled clip when the stretch fails", async () => {
    const { graph, sources } = fixture();
    graph.setStretchRunner(() => Promise.reject(new Error("boom")));
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = bigBuffer(2);
    graph.scheduleClip(schedule("fast", { audioBuffer, endTime: 1, speed: 2 }));
    await flush();
    expect(sources).toHaveLength(1);
    expect(sources[0].stop).not.toHaveBeenCalled();
    graph.dispose();
  });
  it("keeps resampling when pitchCorrection is off", () => {
    const { graph, sources } = fixture();
    graph.scheduleClip(schedule("fast", { speed: 2, pitchCorrection: false }));
    expect(sources[0].playbackRate.value).toBe(2);
    graph.dispose();
  });
  it("applies clip pan automation to the clip panner", () => {
    const { graph, panners } = fixture();
    graph.scheduleClip(schedule("sweep", { panAutomation: [{ time: 0, value: -1 }, { time: 5, value: 1 }] }));
    const calls = (panners.at(-1)!.pan as unknown as { linearRampToValueAtTime: { mock: { calls: number[][] } } })
      .linearRampToValueAtTime.mock.calls;
    expect(calls.at(-1)).toEqual([1, 5]);
    graph.dispose();
  });
  it("releases all owned clip nodes after completion while keeping the track available", () => {
    const { graph, sources, nodes } = fixture();
    graph.createTrack({
      trackId: "root",
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
    });
    const rootNodes = nodes.length,
      meter = graph.getTrackOutputGain("root");
    graph.scheduleClip(schedule("one"));
    sources[0].onended!();
    for (const node of nodes.slice(rootNodes))
      expect(node.disconnect).toHaveBeenCalledOnce();
    expect(graph.getTrackOutputGain("root")).toBe(meter);
    graph.dispose();
  });
  it("applies each gain effect and releases intermediate effect nodes", () => {
    const { graph, sources, nodes, gains } = fixture();
    graph.createTrack({
      trackId: "root",
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [],
    });
    const rootNodes = nodes.length;
    graph.scheduleClip(
      schedule("quiet", {
        effects: [
          { id: "first", type: "gain", enabled: true, params: { value: 0.25 } },
          {
            id: "second",
            type: "gain",
            enabled: true,
            params: { value: 0.75 },
          },
        ],
      }),
    );
    expect(gains.map((node) => node.gain.value)).toEqual(
      expect.arrayContaining([0.25, 0.75]),
    );
    sources[0].onended!();
    for (const node of nodes.slice(rootNodes))
      expect(node.disconnect).toHaveBeenCalledOnce();
    graph.dispose();
  });
  it("releases every root effect node when removing the track", () => {
    const { graph, nodes } = fixture();
    const masterNodes = nodes.length;
    graph.createTrack({
      trackId: "root",
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      effects: [
        { id: "first", type: "gain", enabled: true, params: { value: 0.25 } },
        { id: "second", type: "gain", enabled: true, params: { value: 0.75 } },
      ],
    });
    graph.removeTrack("root");
    for (const node of nodes.slice(masterNodes))
      expect(node.disconnect).toHaveBeenCalledOnce();
    graph.dispose();
  });
});
