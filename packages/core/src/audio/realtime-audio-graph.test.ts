import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { RealtimeAudioGraph, SCHEDULE_START_LOOKAHEAD_SECONDS as LEAD, type AudioClipSchedule } from "./realtime-audio-graph";

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
    expect(sources[1].start).toHaveBeenCalledWith(LEAD, expect.closeTo(2 + LEAD, 9), expect.closeTo(8 - LEAD, 9));
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
    expect(sources[1].start).toHaveBeenCalledWith(LEAD, expect.closeTo(0.5 + LEAD, 9), expect.closeTo(7.5 - LEAD, 9));
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
    expect(sources[1].start).toHaveBeenCalledWith(LEAD, expect.closeTo(4 + LEAD, 9), expect.closeTo(6 - LEAD, 9));
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

describe("RealtimeAudioGraph routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval, clearInterval });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const track = (extra: Record<string, unknown> = {}) =>
    ({ id: "track-1", type: "audio", name: "T", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false, ...extra }) as never;
  const priv = (graph: unknown) =>
    graph as { masterPre: unknown; routing: { getBusInput(id: string): unknown } };
  type MockNode = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

  it("plays unrouted tracks into the master exactly as before", () => {
    const { graph } = createAudioFixture();
    graph.scheduleClip(clip());
    const out = graph.getTrackOutputGain("track-1") as unknown as MockNode;
    expect(out.connect).toHaveBeenCalledTimes(1);
    expect(out.connect).toHaveBeenCalledWith(priv(graph).masterPre);
    graph.dispose();
  });

  it("wires a track into its bus, the bus into the master, and rewires on a structural change", () => {
    const { graph } = createAudioFixture();
    graph.scheduleClip(clip());
    const bus = { id: "dlg", name: "Dialogue", muted: false, solo: false };
    graph.setRouting({ tracks: [track({ output: "dlg" })], audioBuses: [bus] });
    const out = graph.getTrackOutputGain("track-1") as unknown as MockNode;
    expect(out.disconnect).toHaveBeenCalled();
    expect(out.connect).toHaveBeenLastCalledWith(priv(graph).routing.getBusInput("dlg"));
    const fader = graph.getBusOutputGain("dlg") as unknown as MockNode;
    expect(fader.connect).toHaveBeenCalledWith(priv(graph).masterPre);

    graph.setRouting({ tracks: [track()] });
    expect(out.connect).toHaveBeenLastCalledWith(priv(graph).masterPre);
    expect(graph.getBusOutputGain("dlg")).toBeUndefined();
    graph.dispose();
  });

  it("taps pre-fader sends after the pan and post-fader sends after the fader", () => {
    const { graph } = createAudioFixture();
    graph.scheduleClip(clip());
    const bus = { id: "fx", name: "FX", muted: false, solo: false };
    const send = { id: "s", busId: "fx", level: 0.5, preFader: true };
    graph.setRouting({ tracks: [track({ sends: [send] })], audioBuses: [bus] });
    const nodes = (graph as unknown as { trackNodes: Map<string, { panNode: MockNode; preFaderGate: unknown; outputGain: MockNode }> }).trackNodes.get("track-1")!;
    expect(nodes.panNode.connect).toHaveBeenCalledWith(nodes.preFaderGate);
    const before = nodes.outputGain.connect.mock.calls.length;
    graph.setRouting({ tracks: [track({ sends: [{ ...send, preFader: false }] })], audioBuses: [bus] });
    // post-fader: the fader now also feeds a send gain besides the main output
    expect(nodes.outputGain.connect.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    graph.dispose();
  });

  it("seeking works with and without routing", () => {
    const { graph, state } = createAudioFixture();
    state.position = 1;
    expect(() => graph.seekTo(1)).not.toThrow();
    graph.setRouting({ tracks: [track()], audioBuses: [{ id: "b", name: "B", muted: false, solo: false, automation: { volume: [{ time: 0, value: 1 }, { time: 2, value: 0.5 }] } }] });
    expect(() => graph.seekTo(1)).not.toThrow();
    graph.dispose();
  });
});
