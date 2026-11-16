import { describe, expect, it, vi } from "vitest";
import type { RealtimeAudioGraph } from "@openreel/core";
import { SURROUND_CHANNEL_NAMES } from "@openreel/core";
import { createMixerSignalMeter, meterChannelNames, silentLevels } from "./audio-mixer-meter";

/** Per-channel sample values of the tap; the analyser of channel c reads samples[c]. */
function fixture(initialChannels: number, samples: number[]) {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const master = node();
  const state = { channels: initialChannels };
  const gains: Array<Record<string, unknown>> = [];
  const splitters: number[] = [];
  const analysers: Array<{ channel: number }> = [];
  let currentSplitter = -1;
  const context = {
    state: "running",
    createGain: () => {
      const gain = { ...node(), channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers" };
      gains.push(gain);
      return gain;
    },
    createChannelSplitter: (count: number) => {
      splitters.push(count);
      currentSplitter = splitters.length - 1;
      return node();
    },
    createAnalyser: () => {
      const channel = analysers.filter((a) => (a as { group?: number }).group === currentSplitter).length;
      const analyser = {
        ...node(),
        group: currentSplitter,
        channel,
        fftSize: 0,
        getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(samples[channel] ?? 0),
      };
      analysers.push(analyser);
      return analyser;
    },
  };
  const graph = {
    getAudioContext: () => context,
    getMasterGain: () => master,
    getTrackOutputGain: vi.fn(() => undefined),
    getMixChannelCount: () => state.channels,
  } as unknown as RealtimeAudioGraph;
  return { graph, state, master, gains, splitters, analysers };
}

describe("six-channel mixer metering", () => {
  it("names the 5.1 meters L R C LFE Ls Rs and the stereo ones L R", () => {
    expect(meterChannelNames(6)).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
    expect(meterChannelNames(6)).toEqual([...SURROUND_CHANNEL_NAMES]);
    expect(meterChannelNames(2)).toEqual(["L", "R"]);
    expect(silentLevels(6)).toHaveLength(6);
    expect(silentLevels(2)).toHaveLength(2);
  });

  it("reads peak and RMS of every channel of a 5.1 mix from a discrete six-channel tap", () => {
    const f = fixture(6, [0.1, 0.2, 0.9, 0.05, 0.4, 0.8]);
    const meter = createMixerSignalMeter(f.graph);
    const levels = meter.read();
    expect(levels.map((l) => l.peak)).toEqual([0.1, 0.2, 0.9, 0.05, 0.4, 0.8].map((v) => Math.fround(v)));
    levels.forEach((l) => expect(l.rms).toBeCloseTo(l.peak, 6)); // constant samples: rms = |peak|
    expect(f.splitters).toEqual([6]);
    const tap = f.gains.at(-1)!;
    expect([tap.channelCount, tap.channelCountMode, tap.channelInterpretation]).toEqual([6, "explicit", "discrete"]);
    expect(f.master.connect).toHaveBeenCalledOnce();
    meter.dispose();
  });

  it("only the channel the panner feeds is active: a signal on Rs alone leaves every other meter at zero", () => {
    const f = fixture(6, [0, 0, 0, 0, 0, 0.5]);
    const meter = createMixerSignalMeter(f.graph);
    const peaks = meter.read().map((l) => l.peak);
    expect(peaks).toEqual([0, 0, 0, 0, 0, 0.5]);
    meter.dispose();
  });

  it("rebinds the tap when the layout switches between stereo and 5.1 while the meter is open", () => {
    const f = fixture(2, [0.25, 0.5, 0.9, 0.1, 0.1, 0.1]);
    const meter = createMixerSignalMeter(f.graph);
    expect(meter.read()).toHaveLength(2);
    expect(f.splitters).toEqual([2]);
    const stereoTap = f.gains.at(-1)!;
    expect(stereoTap.channelInterpretation).toBe("speakers");

    f.state.channels = 6;
    expect(meter.read()).toHaveLength(6);
    expect(f.splitters).toEqual([2, 6]);
    expect(f.master.disconnect).toHaveBeenCalledWith(stereoTap);

    f.state.channels = 2;
    expect(meter.read()).toHaveLength(2);
    expect(f.splitters).toEqual([2, 6, 2]);
    meter.dispose();
  });

  it("reports silence with the right number of meters while the context is not running", () => {
    const f = fixture(6, [1, 1, 1, 1, 1, 1]);
    (f.graph.getAudioContext() as unknown as { state: string }).state = "suspended";
    const meter = createMixerSignalMeter(f.graph);
    expect(meter.read()).toEqual(silentLevels(6));
  });
});
