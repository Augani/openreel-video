import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { createSpectralRepairEffect, type SpectralRegion } from "./spectral/spectral-regions";
import { createEnhanceSpeechEffect } from "./enhance/enhance-effect";
import { createReduceReverbEffect } from "./reverb/reverb-effect";
import { createInlineReverbBackend, type ReverbBackend } from "./reverb/reverb-worker-client";
import { fftConvolve } from "./reverb/reverb-metrics";
import { resample } from "./enhance/resample";
import { readPcm16Wav, roomImpulseResponse } from "./enhance/enhance-test-signals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EnhanceBackend } from "./enhance/enhance-worker-client";
import { setSpectralBackend } from "./spectral/spectral-worker-client";
import { applySpectralRegions } from "./spectral/spectral-dsp";

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
const tone = (seconds: number): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 500 * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const peakOf = (buffer: AudioBuffer): number => Math.max(...Array.from(buffer.getChannelData(0).subarray(2000, 6000), Math.abs));

/** A backend whose jobs finish when the test says so; the "enhancement" quarters the level. */
const manualBackend = () => {
  const jobs: Array<() => void> = [];
  const enhance = vi.fn(
    (channels: Float32Array[]) => new Promise<Float32Array[]>((resolve) => jobs.push(() => resolve(channels.map((c) => c.map((v) => v * 0.25))))),
  );
  const backend: EnhanceBackend = { enhance };
  return { backend, jobs, enhance };
};

describe("Enhance Speech in the realtime graph", () => {
  it("plays the clip at once, swaps in the enhanced source when ready, and never gives the effect to the live chain", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, enhance } = manualBackend();
    graph.setEnhanceBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const effects = [createEnhanceSpeechEffect("es", 100)];
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects }));
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer).toBe(audioBuffer);
    expect(enhance).toHaveBeenCalledTimes(1);
    graph.scheduleClip(schedule("c2", { audioBuffer, endTime: 2, effects }));
    expect(enhance).toHaveBeenCalledTimes(1);

    jobs[0]();
    await flush();
    expect(sources[0].stop).toHaveBeenCalled();
    expect(sources).toHaveLength(4);
    const enhanced = sources[2].buffer!;
    expect(enhanced).not.toBe(audioBuffer);
    expect(peakOf(enhanced)).toBeCloseTo(peakOf(audioBuffer) * 0.25, 4);
    expect(sources[3].buffer).toBe(enhanced);

    graph.scheduleClip(schedule("c3", { audioBuffer, endTime: 2, effects }));
    expect(sources[4].buffer).toBe(enhanced);
    expect(enhance).toHaveBeenCalledTimes(1);
    graph.dispose();
  });

  it("blends by Mix from the one cached enhancement without another model run", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, enhance } = manualBackend();
    graph.setEnhanceBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("full", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100)] }));
    jobs[0]();
    await flush();
    graph.scheduleClip(schedule("half", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 50)] }));
    expect(enhance).toHaveBeenCalledTimes(1);
    const half = sources[sources.length - 1].buffer!;
    expect(peakOf(half)).toBeCloseTo(peakOf(audioBuffer) * 0.625, 3);
    graph.dispose();
  });

  it("leaves Mix 0 and disabled effects on the original source and starts no job", () => {
    const { graph, sources } = fixture();
    const { backend, enhance } = manualBackend();
    graph.setEnhanceBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("zero", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("a", 0)] }));
    graph.scheduleClip(schedule("off", { audioBuffer, endTime: 2, effects: [{ ...createEnhanceSpeechEffect("b", 100), enabled: false }] }));
    expect(sources.every((source) => source.buffer === audioBuffer)).toBe(true);
    expect(enhance).not.toHaveBeenCalled();
    graph.dispose();
  });

  it("keeps playing the original when the enhancement fails", async () => {
    const { graph, sources } = fixture();
    graph.setEnhanceBackend({ enhance: () => Promise.reject(new Error("model missing")) });
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100)] }));
    await flush();
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer).toBe(audioBuffer);
    graph.dispose();
  });

  it("prepareEnhanceSpeech awaits the shared job and strips the effect (what the editor preview uses)", async () => {
    const { graph } = fixture();
    const { backend, jobs } = manualBackend();
    graph.setEnhanceBackend(backend);
    const audioBuffer = tone(2);
    const pending = graph.prepareEnhanceSpeech(audioBuffer, [createEnhanceSpeechEffect("es", 100)]);
    jobs[0]();
    const prepared = await pending;
    expect(prepared.buffer).not.toBe(audioBuffer);
    expect(prepared.effects).toEqual([]);
    expect(prepared.key).toBe("enhance:100");
    const off = await graph.prepareEnhanceSpeech(audioBuffer, [createEnhanceSpeechEffect("es", 0)]);
    expect(off).toMatchObject({ buffer: audioBuffer, effects: [], key: "" });
    const none = await graph.prepareEnhanceSpeech(audioBuffer, [{ id: "g", type: "gain", enabled: true, params: {} }]);
    expect(none.effects).toHaveLength(1);
    graph.dispose();
  });

  it("waits for spectral repair first, then enhances the repaired source", async () => {
    const { graph, sources } = fixture();
    const { backend: enhanceBackend, jobs: enhanceJobs, enhance } = manualBackend();
    graph.setEnhanceBackend(enhanceBackend);
    const spectralJobs: Array<() => void> = [];
    graph.setSpectralBackend({
      repair: (channels, sampleRate, regions) => new Promise((resolve) => spectralJobs.push(() => resolve(applySpectralRegions(channels, sampleRate, regions)))),
      load: async () => undefined,
      view: async () => { throw new Error("unused"); },
      drop: async () => undefined,
    });
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const region: SpectralRegion = { id: "r", mode: "attenuate", startTime: 0, endTime: 2, lowHz: 400, highHz: 600, gainDb: -30, enabled: true };
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createSpectralRepairEffect("sr", [region]), createEnhanceSpeechEffect("es", 100)] }));
    expect(enhance).not.toHaveBeenCalled();
    spectralJobs[0]();
    await flush();
    expect(enhance).toHaveBeenCalledTimes(1);
    enhanceJobs[0]();
    await flush();
    const last = sources[sources.length - 1].buffer!;
    expect(peakOf(last)).toBeLessThan(peakOf(audioBuffer) * 0.25 * 0.1);
    graph.dispose();
    setSpectralBackend(null);
  });
});


describe("Speech / Background balance in the realtime graph", () => {
  it("remixes the cached enhancement without another model run: background only plays original minus enhanced", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, enhance } = manualBackend();
    graph.setEnhanceBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("speech", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100)] }));
    jobs[0]();
    await flush();
    graph.scheduleClip(schedule("bg", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100, 0)] }));
    graph.scheduleClip(schedule("orig", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100, 50)] }));
    expect(enhance).toHaveBeenCalledTimes(1);
    const background = sources[sources.length - 2].buffer!;
    const original = sources[sources.length - 1].buffer!;
    expect(peakOf(background)).toBeCloseTo(peakOf(audioBuffer) * 0.75, 3);
    expect(peakOf(original)).toBeCloseTo(peakOf(audioBuffer), 3);
    graph.dispose();
  });

  it("prepareEnhanceSpeech keys the balance, so the editor preview rebuilds when it moves", async () => {
    const { graph } = fixture();
    const { backend, jobs } = manualBackend();
    graph.setEnhanceBackend(backend);
    const audioBuffer = tone(2);
    const pending = graph.prepareEnhanceSpeech(audioBuffer, [createEnhanceSpeechEffect("es", 100, 30)]);
    jobs[0]();
    const prepared = await pending;
    expect(prepared.key).toBe("enhance:100:b30");
    expect((await graph.prepareEnhanceSpeech(audioBuffer, [createEnhanceSpeechEffect("es", 100)])).key).toBe("enhance:100");
    graph.dispose();
  });
});

const speechFixture = fileURLToPath(new URL("./enhance/fixtures/speech-16k.wav", import.meta.url));
const roomySource = (seconds: number): AudioBuffer => {
  const wav = readPcm16Wav(readFileSync(speechFixture));
  const dry = resample(wav.samples.subarray(0, wav.sampleRate * seconds), wav.sampleRate, SR);
  const wet = fftConvolve(dry, roomImpulseResponse(SR, 0.6, 0));
  return { numberOfChannels: 1, sampleRate: SR, length: wet.length, duration: seconds, getChannelData: () => wet } as unknown as AudioBuffer;
};

/** Reverb jobs the test finishes by hand; the "dereverberation" halves the level. */
const manualReverb = () => {
  const jobs: Array<() => void> = [];
  const reduce = vi.fn(
    (channels: Float32Array[]) => new Promise<{ channels: Float32Array[]; rt60: number; confidence: number }>((resolve) => jobs.push(() => resolve({ channels: channels.map((c) => c.map((v) => v * 0.5)), rt60: 0.6, confidence: 1 }))),
  );
  const backend: ReverbBackend = { reduce };
  return { backend, jobs, reduce };
};

describe("Reduce Reverb in the realtime graph", () => {
  it("plays the clip at once, swaps in the processed source when ready, and never gives the effect to the live chain", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, reduce } = manualReverb();
    graph.setReverbBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const effects = [createReduceReverbEffect("rr", 60, 50)];
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects }));
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer).toBe(audioBuffer);
    graph.scheduleClip(schedule("c2", { audioBuffer, endTime: 2, effects }));
    expect(reduce).toHaveBeenCalledTimes(1);
    jobs[0]();
    await flush();
    expect(sources[0].stop).toHaveBeenCalled();
    const processed = sources[sources.length - 1].buffer!;
    expect(processed).not.toBe(audioBuffer);
    expect(peakOf(processed)).toBeCloseTo(peakOf(audioBuffer) * 0.5, 4);
    graph.scheduleClip(schedule("c3", { audioBuffer, endTime: 2, effects }));
    expect(sources[sources.length - 1].buffer).toBe(processed);
    expect(reduce).toHaveBeenCalledTimes(1);
    graph.dispose();
  });

  it("starts no job for Amount 0 or a disabled effect, and keeps playing the original when the job fails", async () => {
    const { graph, sources } = fixture();
    const { backend, reduce } = manualReverb();
    graph.setReverbBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("zero", { audioBuffer, endTime: 2, effects: [createReduceReverbEffect("a", 0)] }));
    graph.scheduleClip(schedule("off", { audioBuffer, endTime: 2, effects: [{ ...createReduceReverbEffect("b", 60), enabled: false }] }));
    expect(sources.every((source) => source.buffer === audioBuffer)).toBe(true);
    expect(reduce).not.toHaveBeenCalled();
    graph.setReverbBackend({ reduce: () => Promise.reject(new Error("worker missing")) });
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    graph.scheduleClip(schedule("bad", { audioBuffer, endTime: 2, effects: [createReduceReverbEffect("c", 60)] }));
    await flush();
    expect(sources[sources.length - 1].buffer).toBe(audioBuffer);
    graph.dispose();
  });

  it("runs before Enhance Speech: the enhancement waits for the dereverberation and enhances its output", async () => {
    const { graph, sources } = fixture();
    const enhancer = manualBackend();
    const reverb = manualReverb();
    graph.setEnhanceBackend(enhancer.backend);
    graph.setReverbBackend(reverb.backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("c", { audioBuffer, endTime: 2, effects: [createEnhanceSpeechEffect("es", 100), createReduceReverbEffect("rr", 60)] }));
    expect(reverb.reduce).toHaveBeenCalledTimes(1);
    expect(enhancer.enhance).not.toHaveBeenCalled();
    reverb.jobs[0]();
    await flush();
    expect(enhancer.enhance).toHaveBeenCalledTimes(1);
    const seen = enhancer.enhance.mock.calls[0][0][0];
    expect(Math.max(...Array.from(seen.subarray(2000, 6000), Math.abs))).toBeCloseTo(peakOf(audioBuffer) * 0.5, 4);
    enhancer.jobs[0]();
    await flush();
    const last = sources[sources.length - 1].buffer!;
    expect(peakOf(last)).toBeCloseTo(peakOf(audioBuffer) * 0.5 * 0.25, 4);
    graph.dispose();
  });

  it("waits for spectral repair, then Reduce Reverb, then Enhance Speech, in that order", async () => {
    const { graph } = fixture();
    const enhancer = manualBackend();
    const reverb = manualReverb();
    graph.setEnhanceBackend(enhancer.backend);
    graph.setReverbBackend(reverb.backend);
    const spectralJobs: Array<() => void> = [];
    graph.setSpectralBackend({
      repair: (channels, sampleRate, regions) => new Promise((resolve) => spectralJobs.push(() => resolve(applySpectralRegions(channels, sampleRate, regions)))),
      load: async () => undefined,
      view: async () => { throw new Error("unused"); },
      drop: async () => undefined,
    });
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const region: SpectralRegion = { id: "r", mode: "attenuate", startTime: 0, endTime: 2, lowHz: 400, highHz: 600, gainDb: -30, enabled: true };
    graph.scheduleClip(schedule("c", { audioBuffer: tone(2), endTime: 2, effects: [createReduceReverbEffect("rr", 60), createEnhanceSpeechEffect("es", 100), createSpectralRepairEffect("sr", [region])] }));
    expect(enhancer.enhance).not.toHaveBeenCalled();
    expect(reverb.reduce).not.toHaveBeenCalled();
    spectralJobs[0]();
    await flush();
    expect(reverb.reduce).toHaveBeenCalledTimes(1);
    expect(enhancer.enhance).not.toHaveBeenCalled();
    reverb.jobs[0]();
    await flush();
    expect(enhancer.enhance).toHaveBeenCalledTimes(1);
    graph.dispose();
    setSpectralBackend(null);
  });

  it("prepareReduceReverb awaits the shared job and strips the effect, keyed by its settings (what the editor preview uses)", async () => {
    const { graph } = fixture();
    const { backend, jobs } = manualReverb();
    graph.setReverbBackend(backend);
    const audioBuffer = tone(2);
    const pending = graph.prepareReduceReverb(audioBuffer, [createReduceReverbEffect("rr", 60, 30)]);
    jobs[0]();
    const prepared = await pending;
    expect(prepared.buffer).not.toBe(audioBuffer);
    expect(prepared.effects).toEqual([]);
    expect(prepared.key).toBe("reverb:60:30");
    expect(await graph.prepareReduceReverb(audioBuffer, [createReduceReverbEffect("rr", 0)])).toMatchObject({ buffer: audioBuffer, effects: [], key: "" });
    expect((await graph.prepareReduceReverb(audioBuffer, [{ id: "g", type: "gain", enabled: true, params: {} }])).effects).toHaveLength(1);
    graph.dispose();
  });

  it("real DSP: the preview source for a reverberant clip is the same samples the shared cache holds for the export", async () => {
    const { graph, sources } = fixture();
    graph.setReverbBackend(createInlineReverbBackend());
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const source = roomySource(5);
    graph.scheduleClip(schedule("c", { audioBuffer: source, endTime: 5, effects: [createReduceReverbEffect("rr", 70, 40)] }));
    for (let i = 0; i < 400 && sources[sources.length - 1].buffer === source; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    const played = sources[sources.length - 1].buffer!;
    expect(played).not.toBe(source);
    const again = await graph.getReduceReverbCache().request({ buffer: source, params: { amount: 70, sensitivity: 40 } });
    expect(again).toBe(played);
    graph.dispose();
  }, 60_000);
});
