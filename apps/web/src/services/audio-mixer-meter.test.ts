import { describe, expect, it, vi } from "vitest";
import type { RealtimeAudioGraph } from "@openreel/core";
import {
  createMixerSignalMeter,
  SILENT_SIGNAL_LEVELS,
} from "./audio-mixer-meter";

function fixture() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const master = node();
  let track: ReturnType<typeof node> | undefined = node();
  const samples = [0.25, -0.5];
  const analysers: Array<ReturnType<typeof node>> = [];
  const context = {
    state: "running",
    createGain: () => node(),
    createChannelSplitter: () => node(),
    createAnalyser: () => {
      const channel = analysers.length % 2;
      const analyser = {
        ...node(),
        fftSize: 0,
        getFloatTimeDomainData: (buffer: Float32Array) =>
          buffer.fill(samples[channel]),
      };
      analysers.push(analyser);
      return analyser;
    },
  };
  const graph = {
    getAudioContext: () => context,
    getMasterGain: () => master,
    getTrackOutputGain: vi.fn(() => track),
  } as unknown as RealtimeAudioGraph;
  return {
    graph,
    context,
    master,
    samples,
    analysers,
    get track() {
      return track;
    },
    setTrack: (value: typeof track) => {
      track = value;
    },
    node,
  };
}

describe("actual mixer signal metering", () => {
  it("measures independent stereo peak and RMS samples at the track output", () => {
    const f = fixture();
    const meter = createMixerSignalMeter(f.graph, "dialogue");
    expect(meter.read()).toEqual([
      { peak: 0.25, rms: 0.25 },
      { peak: 0.5, rms: 0.5 },
    ]);
    expect(f.graph.getTrackOutputGain).toHaveBeenCalledWith("dialogue");
    expect(f.track!.connect).toHaveBeenCalledOnce();
    expect(f.master.connect).not.toHaveBeenCalled();
    expect(
      f.analysers.every((node) => node.connect.mock.calls.length === 0),
    ).toBe(true);
    meter.dispose();
  });

  it("reads the post-master output and reports genuine silence and invalid samples as zero", () => {
    const f = fixture();
    f.samples[0] = 0;
    f.samples[1] = NaN;
    const meter = createMixerSignalMeter(f.graph);
    expect(meter.read()).toEqual(SILENT_SIGNAL_LEVELS);
    expect(f.master.connect).toHaveBeenCalledOnce();
    f.context.state = "suspended";
    f.samples[0] = 1;
    expect(meter.read()).toEqual(SILENT_SIGNAL_LEVELS);
    meter.dispose();
  });

  it("reconnects after seek replaces track nodes and disconnects only its own analysis branch", () => {
    const f = fixture();
    const original = f.track!;
    const meter = createMixerSignalMeter(f.graph, "dialogue");
    meter.read();
    const tap = original.connect.mock.calls[0][0];
    const replacement = f.node();
    f.setTrack(replacement);
    meter.read();
    expect(original.disconnect).toHaveBeenCalledOnce();
    expect(original.disconnect).toHaveBeenCalledWith(tap);
    expect(replacement.connect).toHaveBeenCalledOnce();
    f.setTrack(undefined);
    expect(meter.read()).toEqual(SILENT_SIGNAL_LEVELS);
    expect(replacement.disconnect).toHaveBeenCalledOnce();
    meter.dispose();
    meter.dispose();
    expect(meter.read()).toEqual(SILENT_SIGNAL_LEVELS);
    expect(
      f.analysers.every((node) => node.disconnect.mock.calls.length === 1),
    ).toBe(true);
  });


  it("waits for a track to exist and tolerates playback cleanup before disposal", () => {
    const f = fixture();
    f.setTrack(undefined);
    const meter = createMixerSignalMeter(f.graph, "dialogue");
    expect(meter.read()).toEqual(SILENT_SIGNAL_LEVELS);
    expect(f.analysers).toHaveLength(0);
    const output = f.node();
    f.setTrack(output);
    expect(meter.read()[1].peak).toBe(0.5);
    output.disconnect.mockImplementation(() => {
      throw new Error("Playback removed the track");
    });
    expect(() => meter.dispose()).not.toThrow();
    expect(output.disconnect).toHaveBeenCalledOnce();
  });
});
