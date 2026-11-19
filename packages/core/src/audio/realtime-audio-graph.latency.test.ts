import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import type { Effect } from "../types";
import { RealtimeAudioGraph, SCHEDULE_START_LOOKAHEAD_SECONDS as LEAD, type AudioClipSchedule } from "./realtime-audio-graph";

const SR = 48000;

function fixture() {
  const sources: Array<{ start: ReturnType<typeof vi.fn> }> = [];
  const param = () => ({
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  });
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
    createBufferSource: () => {
      const source = { ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: param(), buffer: null, onended: null };
      sources.push(source);
      return source;
    },
  };
  const state = { position: 0 };
  const clock = {
    getAudioContext: () => context,
    get currentTime() {
      return state.position;
    },
    get isPlaying() {
      return true;
    },
  } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), state, sources, context };
}

const compressor: Effect = { id: "c", type: "compressor", enabled: true, params: {} } as unknown as Effect;
const clip = (extra: Partial<AudioClipSchedule> = {}): AudioClipSchedule => ({
  clipId: "clip",
  trackId: "t",
  audioBuffer: { duration: 20 } as AudioBuffer,
  startTime: 2,
  endTime: 12,
  mediaOffset: 0,
  volume: 1,
  volumeAutomation: [],
  pan: 0,
  effects: [],
  speed: 1,
  ...extra,
});

describe("realtime scheduling compensates lookahead effects", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a clip with no latent effects is scheduled exactly where it always was", () => {
    const { graph, state, sources } = fixture();
    state.position = 0;
    graph.scheduleClip(clip());
    // 2 s ahead of the playhead, on the context clock.
    expect(sources[0].start).toHaveBeenCalledWith(12, 0, 10);
    expect(graph.getPlaybackLatencySeconds()).toBe(0);
  });

  it("a clip effect with a 6 ms lookahead starts its source 6 ms early", () => {
    const { graph, state, sources } = fixture();
    state.position = 0;
    graph.scheduleClip(clip({ effects: [compressor] }));
    const lookahead = Math.floor(0.006 * SR) / SR;
    const [when, offset] = sources[0].start.mock.calls[0];
    expect(when).toBeCloseTo(12 - lookahead, 9);
    expect(offset).toBe(0);
  });

  it("a clip that is already playing starts that much further into the media instead", () => {
    const { graph, state, sources } = fixture();
    state.position = 5;
    graph.scheduleClip(clip({ effects: [compressor] }));
    const lookahead = Math.floor(0.006 * SR) / SR;
    const [when, offset] = sources[0].start.mock.calls[0];
    expect(when).toBeCloseTo(10 + LEAD, 9); // context time (10) plus the start lead
    expect(offset).toBeCloseTo(3 + lookahead + LEAD, 9);
  });

  it("a track rack with a limiter shifts every clip on every track by the graph latency", () => {
    const { graph, state, sources } = fixture();
    state.position = 0;
    graph.createTrack({ trackId: "t", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    graph.createTrack({ trackId: "u", volume: 1, pan: 0, muted: false, solo: false, effects: [] });
    expect(graph.getPlaybackLatencySeconds()).toBe(0);
    // Compensation applies to the whole graph: both tracks align to the limiter's 6 ms.
    graph.setTrackRack("t", { effects: [{ id: "l", type: "limiter", params: {}, bypassed: false }] });
    const lookahead = Math.floor(0.006 * SR) / SR;
    expect(graph.getPlaybackLatencySeconds()).toBeCloseTo(lookahead, 9);
    graph.scheduleClip(clip({ trackId: "u" }));
    const [when] = sources[sources.length - 1].start.mock.calls[0];
    expect(when).toBeCloseTo(12 - lookahead, 9);
    // A bypassed limiter is no latency at all.
    graph.setTrackRack("t", { effects: [{ id: "l", type: "limiter", params: {}, bypassed: true }] });
    expect(graph.getPlaybackLatencySeconds()).toBe(0);
  });
});
