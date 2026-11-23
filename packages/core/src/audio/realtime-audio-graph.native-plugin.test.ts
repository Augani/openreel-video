import { describe, expect, it, vi } from "vitest";
import { RealtimeAudioGraph, type AudioClipSchedule } from "./realtime-audio-graph";
import type { MasterTimelineClock } from "../playback/master-timeline-clock";
import { createNativePluginEffect } from "./native-plugin/native-plugin-effect";
import type { NativePluginBackend } from "./native-plugin/native-plugin-types";

function fixture() {
  const sources: Array<{ buffer: AudioBuffer | null; stop: ReturnType<typeof vi.fn> }> = [];
  const parameter = () => ({ value: 1, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    currentTime: 0, destination: {}, sampleRate: 8000,
    createGain: () => ({ ...node(), gain: parameter() }),
    createStereoPanner: () => ({ ...node(), pan: parameter() }),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const value = { ...node(), buffer: null as AudioBuffer | null, playbackRate: parameter(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
      sources.push(value);
      return value;
    },
  };
  const clock = { getAudioContext: () => context, get currentTime() { return 0; }, isPlaying: true } as unknown as MasterTimelineClock;
  return { graph: new RealtimeAudioGraph(clock), sources };
}
const SR = 8000;
const tone = (seconds: number): AudioBuffer => {
  const data = Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 500 * i) / SR));
  return { numberOfChannels: 1, sampleRate: SR, length: data.length, duration: seconds, getChannelData: () => data } as unknown as AudioBuffer;
};
const schedule = (id: string, overrides: Partial<AudioClipSchedule> = {}): AudioClipSchedule => ({
  clipId: id, trackId: "root", audioBuffer: tone(2), startTime: 0, endTime: 2, mediaOffset: 0, volume: 1, volumeAutomation: [], pan: 0, effects: [], speed: 1, ...overrides,
});
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const plugin = { id: "au:aufx:dely:appl", format: "au" as const, name: "AUDelay", vendor: "Apple" };
const manual = () => {
  const jobs: Array<() => void> = [];
  const render = vi.fn((request: { channels: readonly Float32Array[] }) => new Promise<{ channels: Float32Array[]; latencySamples: number }>((resolve) => jobs.push(() => resolve({ channels: request.channels.map((c) => c.map((v) => v * 0.25)), latencySamples: 0 }))));
  return { backend: { render } as NativePluginBackend, jobs, render };
};

describe("hosted plugins in the realtime graph", () => {
  it("plays the original at once, swaps the rendered source in when ready, and keeps the effect out of the live chain", async () => {
    const { graph, sources } = fixture();
    const { backend, jobs, render } = manual();
    graph.setNativePluginBackend(backend);
    (graph as unknown as { isPlaying: boolean }).isPlaying = true;
    const audioBuffer = tone(2);
    const effects = [createNativePluginEffect("p1", plugin, { values: { gain: 1 } })];
    graph.scheduleClip(schedule("c", { audioBuffer, effects }));
    expect(sources[0].buffer).toBe(audioBuffer);
    expect(render).toHaveBeenCalledTimes(1);
    jobs[0]();
    await flush();
    expect(sources[0].stop).toHaveBeenCalled();
    const processed = sources[sources.length - 1].buffer!;
    expect(processed).not.toBe(audioBuffer);
    expect(processed.getChannelData(0)[100]).toBeCloseTo(audioBuffer.getChannelData(0)[100] * 0.25, 6);
    graph.scheduleClip(schedule("c2", { audioBuffer, effects }));
    expect(sources[sources.length - 1].buffer).toBe(processed);
    expect(render).toHaveBeenCalledTimes(1);
    graph.dispose();
  });

  it("keeps the original for a disabled effect and without a host (bypass, no job)", async () => {
    const { graph, sources } = fixture();
    const { backend, render } = manual();
    graph.setNativePluginBackend(backend);
    const audioBuffer = tone(2);
    graph.scheduleClip(schedule("off", { audioBuffer, effects: [{ ...createNativePluginEffect("p", plugin), enabled: false }] }));
    expect(render).not.toHaveBeenCalled();
    expect(sources[0].buffer).toBe(audioBuffer);
    graph.setNativePluginBackend({ render: async () => { throw new Error("boom"); } });
    graph.scheduleClip(schedule("fail", { audioBuffer, effects: [createNativePluginEffect("p", plugin)] }));
    await flush();
    expect(sources.every((s) => s.buffer === audioBuffer)).toBe(true);
    graph.dispose();
  });

  it("prepareNativePlugins awaits the job and strips the effect (what the editor preview uses)", async () => {
    const { graph } = fixture();
    const { backend, jobs } = manual();
    graph.setNativePluginBackend(backend);
    const audioBuffer = tone(2);
    const pending = graph.prepareNativePlugins(audioBuffer, [createNativePluginEffect("p1", plugin), { id: "g", type: "gain", enabled: true, params: {} }]);
    jobs[0]();
    const prepared = await pending;
    expect(prepared.buffer).not.toBe(audioBuffer);
    expect(prepared.effects.map((e) => e.type)).toEqual(["gain"]);
    expect(prepared.key).toBe("native:p1");
    const none = await graph.prepareNativePlugins(audioBuffer, [{ id: "g", type: "gain", enabled: true, params: {} }]);
    expect(none).toMatchObject({ buffer: audioBuffer, key: "" });
    graph.dispose();
  });
});
