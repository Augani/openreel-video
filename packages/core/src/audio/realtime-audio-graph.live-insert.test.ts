import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { MASTER_LIVE_ID, RealtimeAudioGraph, type LiveInsertSlot } from "./realtime-audio-graph";

const SR = 48000;

function fixture() {
  const param = () => ({ value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    currentTime: 10,
    sampleRate: SR,
    destination: {},
    createGain: () => ({ ...node(), gain: param() }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createWaveShaper: () => ({ ...node(), curve: null, oversample: "none" }),
    createDelay: () => ({ ...node(), delayTime: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), ratio: param(), attack: param(), release: param(), knee: param() }),
    createBufferSource: () => ({ ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: param(), buffer: null, onended: null }),
  };
  const state = { position: 0, playing: true };
  const clock = {
    getAudioContext: () => context,
    get currentTime() {
      return state.position;
    },
    get isPlaying() {
      return state.playing;
    },
  } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), state, context };
}

const slot = (latencySeconds: number): LiveInsertSlot & { input: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }; output: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } } => ({
  input: { connect: vi.fn(), disconnect: vi.fn() } as never,
  output: { connect: vi.fn(), disconnect: vi.fn() } as never,
  latencySeconds,
});

const trackConfig = (trackId: string) => ({ trackId, volume: 1, pan: 0, effects: [], muted: false, solo: false });

describe("live plugin inserts in the realtime graph", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("splices a track's insert in front of its rack and adds its latency to the delay compensation", () => {
    const { graph } = fixture();
    graph.createTrack(trackConfig("t1") as never);
    graph.createTrack(trackConfig("t2") as never);
    expect(graph.getPlaybackLatencySeconds()).toBe(0);
    const insert = slot(0.0213);
    graph.setLiveInsert("track", "t1", insert);
    expect(insert.input.connect).not.toHaveBeenCalled(); // an AudioNode connects the other way round: the chain output connects TO it
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.0213, 9);
    graph.setLiveInsert("track", "t1", null);
    expect(graph.getPlaybackLatencySeconds()).toBe(0);
  });

  it("the insert survives the track being rebuilt (a seek recreates tracks) and is wired again", () => {
    const { graph } = fixture();
    const insert = slot(0.02);
    graph.createTrack(trackConfig("t1") as never);
    graph.setLiveInsert("track", "t1", insert);
    graph.createTrack(trackConfig("t1") as never);
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.02, 9);
    // rebuilt track: the new rack bus input is fed by the insert's output
    expect(insert.output.connect).toHaveBeenCalled();
  });

  it("an insert registered before its track exists is applied when the track is created", () => {
    const { graph } = fixture();
    const insert = slot(0.015);
    graph.setLiveInsert("track", "later", insert);
    graph.createTrack(trackConfig("later") as never);
    expect(insert.output.connect).toHaveBeenCalled();
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.015, 9);
  });

  it("the master's insert latency is common to every path", () => {
    const { graph } = fixture();
    graph.createTrack(trackConfig("t1") as never);
    graph.setLiveInsert("master", MASTER_LIVE_ID, slot(0.03));
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.03, 9);
  });

  it("a changed insert latency is picked up by refreshLiveLatency", () => {
    const { graph } = fixture();
    graph.createTrack(trackConfig("t1") as never);
    const insert = { ...slot(0.01) } as { latencySeconds: number } & LiveInsertSlot;
    graph.setLiveInsert("track", "t1", insert);
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.01, 9);
    (insert as { latencySeconds: number }).latencySeconds = 0.025;
    graph.refreshLiveLatency();
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(0.025, 9);
  });

  it("reports transport events: play, seek and stop", () => {
    const { graph, state } = fixture();
    const events: Array<{ playing: boolean; time: number }> = [];
    const off = graph.onTransport((e) => events.push(e));
    state.position = 3;
    graph.startScheduler(() => []);
    graph.seekTo(7);
    graph.stopScheduler();
    off();
    graph.seekTo(1);
    expect(events).toEqual([
      { playing: true, time: 3 },
      { playing: true, time: 7 },
      { playing: false, time: 3 },
    ]);
  });
});
