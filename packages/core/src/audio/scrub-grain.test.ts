import { describe, expect, it, vi } from "vitest";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";
import { SCRUB_MAX_GRAINS, ScrubGrainThrottle, planScrubGrains } from "./scrub-grain";

const clip = (overrides: Partial<AudioClipSchedule> = {}): AudioClipSchedule => ({
  clipId: "c",
  trackId: "t",
  audioBuffer: { duration: 20 } as AudioBuffer,
  startTime: 2,
  endTime: 12,
  mediaOffset: 1,
  volume: 1,
  volumeAutomation: [],
  pan: 0,
  effects: [],
  speed: 1,
  ...overrides,
});

describe("planScrubGrains", () => {
  it("picks clips under the playhead and maps the timeline time into the source", () => {
    const grains = planScrubGrains([clip(), clip({ clipId: "later", startTime: 20, endTime: 30 })], 5, 0.1);
    expect(grains).toHaveLength(1);
    expect(grains[0].sourceOffset).toBeCloseTo(1 + 3, 9);
    expect(grains[0].sourceDuration).toBeCloseTo(0.1, 9);
  });

  it("scales by clip speed and never runs past the clip end or the media end", () => {
    const [fast] = planScrubGrains([clip({ speed: 2 })], 5, 0.1);
    expect(fast.sourceOffset).toBeCloseTo(1 + 6, 9);
    expect(fast.sourceDuration).toBeCloseTo(0.2, 9);
    expect(fast.duration).toBeCloseTo(0.1, 9);
    const [tail] = planScrubGrains([clip()], 11.95, 0.1);
    expect(tail.duration).toBeCloseTo(0.05, 6);
    expect(planScrubGrains([clip({ audioBuffer: { duration: 4.0005 } as AudioBuffer })], 5, 0.1)).toHaveLength(0);
    expect(planScrubGrains([clip()], 12, 0.1)).toHaveLength(0);
    expect(planScrubGrains([clip()], 1, 0.1)).toHaveLength(0);
  });
});

describe("ScrubGrainThrottle", () => {
  it("limits the rate and ignores a playhead that did not move", () => {
    const throttle = new ScrubGrainThrottle(0.05);
    expect(throttle.take(0, 1)).toBe(true);
    expect(throttle.take(0.01, 1.2)).toBe(false);
    expect(throttle.take(0.06, 1.2)).toBe(true);
    expect(throttle.take(0.2, 1.2)).toBe(false);
    throttle.reset();
    expect(throttle.take(0.21, 1.2)).toBe(true);
  });
});

function fixture() {
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; playbackRate: { value: number }; connect: ReturnType<typeof vi.fn> }> = [];
  const gains: Array<{ gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn> }> = [];
  const context = {
    currentTime: 5,
    sampleRate: 48000,
    destination: {},
    createGain: () => { const g = { ...node(), gain: param() }; gains.push(g); return g; },
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createBufferSource: () => {
      const s = { ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: { value: 1 }, buffer: null, onended: null as (() => void) | null };
      sources.push(s);
      return s;
    },
  };
  const clock = { getAudioContext: () => context, currentTime: 0, isPlaying: false } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), sources, gains };
}

describe("RealtimeAudioGraph.playScrubGrains", () => {
  it("plays an enveloped grain through the track and leaves the scheduler alone", () => {
    const { graph, sources, gains } = fixture();
    graph.createTrack({ trackId: "t", volume: 0.5, pan: 0, muted: false, solo: false, effects: [] });
    expect(graph.playScrubGrains([clip({ volume: 0.8 })], 5)).toBe(1);
    expect(sources).toHaveLength(1);
    const [offset, length] = [sources[0].start.mock.calls[0][1], sources[0].start.mock.calls[0][2]];
    expect(sources[0].start.mock.calls[0][0]).toBe(5);
    expect(offset).toBeCloseTo(4, 9);
    expect(length).toBeCloseTo(0.09, 9);
    const envelope = gains.at(-1)!.gain;
    expect(envelope.setValueAtTime).toHaveBeenCalledWith(0, 5);
    expect(envelope.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(5.09, 9));
    expect(envelope.linearRampToValueAtTime.mock.calls[0][0]).toBeCloseTo(0.8, 9);
    // The track fader is untouched and applies downstream.
    expect(graph.getTrackVolume("t")).toBe(0.5);
    graph.dispose();
  });

  it("plays nothing when no clip is under the playhead and caps simultaneous grains", () => {
    const { graph, sources } = fixture();
    expect(graph.playScrubGrains([clip()], 50)).toBe(0);
    for (let i = 0; i < SCRUB_MAX_GRAINS + 3; i++) graph.playScrubGrains([clip()], 3 + i * 0.01);
    expect(sources.filter((s) => s.stop.mock.calls.length === 0)).toHaveLength(SCRUB_MAX_GRAINS);
    graph.stopScrubGrains();
    expect(sources.every((s) => s.stop.mock.calls.length > 0)).toBe(true);
    graph.dispose();
  });

  it("honours solo set through syncTrackStates before any playback created the tracks", () => {
    const { graph } = fixture();
    graph.syncTrackStates([
      { trackId: "t", muted: false, solo: false },
      { trackId: "other", muted: false, solo: true },
    ]);
    const out = graph.getTrackOutputGain("t") as unknown as { gain: { setValueAtTime: ReturnType<typeof vi.fn> } };
    graph.playScrubGrains([clip()], 5);
    expect(out.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 5);
    // Clearing the solo makes the track audible again.
    graph.syncTrackStates([
      { trackId: "t", muted: false, solo: false },
      { trackId: "other", muted: false, solo: false },
    ]);
    expect(out.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 5);
    graph.dispose();
  });

  it("goes through a muted track's silent fader (mute still applies)", () => {
    const { graph, gains } = fixture();
    graph.createTrack({ trackId: "t", volume: 1, pan: 0, muted: true, solo: false, effects: [] });
    const out = graph.getTrackOutputGain("t") as unknown as { gain: { setValueAtTime: ReturnType<typeof vi.fn> } };
    graph.playScrubGrains([clip()], 5);
    expect(out.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 5);
    expect(gains.length).toBeGreaterThan(0);
    graph.dispose();
  });
});
