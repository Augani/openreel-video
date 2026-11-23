import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import type { SpectralBackend } from "./spectral/spectral-worker-client";
import { applySpectralRegions } from "./spectral/spectral-dsp";
import { createSpectralRepairEffect, sanitizeSpectralRegions, type SpectralRegion } from "./spectral/spectral-regions";
import { computeMagicWand } from "./spectral/spectral-wand";
import { trackHarmonics } from "./spectral/spectral-harmonic";

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

const SR = 8000;
const REGION: SpectralRegion = { id: "r", mode: "attenuate", startTime: 0, endTime: 2, lowHz: 400, highHz: 600, gainDb: -30, enabled: true };

const tone = (seconds: number): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 500 * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A backend whose jobs finish when the test says so; it runs the real DSP. */
const manualBackend = () => {
  const jobs: Array<() => void> = [];
  const repair = vi.fn(
    (channels: Float32Array[], sampleRate: number, regions: SpectralRegion[]) =>
      new Promise<Float32Array[]>((resolve) => jobs.push(() => resolve(applySpectralRegions(channels, sampleRate, regions)))),
  );
  const backend: SpectralBackend = { repair, load: async () => undefined, view: async () => { throw new Error("unused"); }, drop: async () => undefined };
  return { backend, jobs, repair };
};

const peakOf = (buffer: AudioBuffer): number => Math.max(...Array.from(buffer.getChannelData(0).subarray(2000, 6000), Math.abs));

describe("spectral repair in the realtime graph", () => {
  it("plays the clip at once, then swaps in the repaired source and never plays a clip effect for it", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, repair } = manualBackend();
    graph.setSpectralBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const effects = [createSpectralRepairEffect("sr", [REGION])];
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects }));
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer).toBe(audioBuffer);
    expect(repair).toHaveBeenCalledTimes(1);
    // The same range scheduled again joins the running job.
    graph.scheduleClip(schedule("c2", { audioBuffer, endTime: 2, effects }));
    expect(repair).toHaveBeenCalledTimes(1);

    jobs[0]();
    await flush();
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources).toHaveLength(4);
    const repaired = sources[2].buffer!;
    expect(repaired).not.toBe(audioBuffer);
    expect(peakOf(repaired)).toBeLessThan(peakOf(audioBuffer) * 0.1);
    expect(sources[3].buffer).toBe(repaired);

    // Later schedules use the cache at once.
    graph.scheduleClip(schedule("c3", { audioBuffer, endTime: 2, effects }));
    expect(sources[4].buffer).toBe(repaired);
    expect(repair).toHaveBeenCalledTimes(1);
    graph.dispose();
  });

  it("swaps in a lasso / heal repair that is sample-identical to the export's DSP output", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs } = manualBackend();
    graph.setSpectralBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const regions = sanitizeSpectralRegions([{ id: "l", mode: "heal", shape: "lasso", points: [{ t: 0.05, hz: 300 }, { t: 1.95, hz: 300 }, { t: 1.95, hz: 800 }, { t: 0.05, hz: 800 }] }]);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createSpectralRepairEffect("sr", regions)] }));
    jobs[0]();
    await flush();
    const repaired = sources[sources.length - 1].buffer!;
    expect(repaired).not.toBe(audioBuffer);
    expect(Array.from(repaired.getChannelData(0))).toEqual(Array.from(applySpectralRegions([audioBuffer.getChannelData(0)], SR, regions)[0]));
    expect(peakOf(repaired)).toBeLessThan(peakOf(audioBuffer) * 0.3);
    graph.dispose();
  });

  it("swaps in a wand / harmonic / single-channel repair that is sample-identical to the export's DSP output", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs } = manualBackend();
    graph.setSpectralBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const data = audioBuffer.getChannelData(0);
    const wand = computeMagicWand(data, SR, { t: 1, hz: 500 }, { toleranceDb: 6 });
    const track = trackHarmonics(data, SR, { t: 1, hz: 500 }, { harmonics: 2 });
    if (!wand.ok || !track.ok) throw new Error("analysis failed");
    const regions = sanitizeSpectralRegions([
      { id: "w", mode: "remove", shape: "wand", wand: wand.wand, channel: "left" },
      { id: "h", mode: "remove", shape: "harmonic", points: track.points, harmonic: { harmonics: 2, maxHz: 20000, bandCents: 50 } },
    ]);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createSpectralRepairEffect("sr", regions)] }));
    jobs[0]();
    await flush();
    const repaired = sources[sources.length - 1].buffer!;
    expect(repaired).not.toBe(audioBuffer);
    expect(Array.from(repaired.getChannelData(0))).toEqual(Array.from(applySpectralRegions([data], SR, regions)[0]));
    expect(peakOf(repaired)).toBeLessThan(peakOf(audioBuffer) * 0.2);
    graph.dispose();
  });

  it("leaves clips without active regions untouched and does not start a job", () => {
    const { graph, sources } = fixture();
    const { backend, repair } = manualBackend();
    graph.setSpectralBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("plain", { audioBuffer, endTime: 2, effects: [createSpectralRepairEffect("sr", [])] }));
    graph.scheduleClip(schedule("off", { audioBuffer, endTime: 2, effects: [{ ...createSpectralRepairEffect("sr2", [REGION]), enabled: false }] }));
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.buffer === audioBuffer)).toBe(true);
    expect(repair).not.toHaveBeenCalled();
    graph.dispose();
  });

  it("keeps playing the original when the repair fails", async () => {
    const { graph, sources } = fixture();
    const backend: SpectralBackend = { repair: () => Promise.reject(new Error("boom")), load: async () => undefined, view: async () => { throw new Error("x"); }, drop: async () => undefined };
    graph.setSpectralBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createSpectralRepairEffect("sr", [REGION])] }));
    await flush();
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer).toBe(audioBuffer);
    graph.dispose();
  });
});
