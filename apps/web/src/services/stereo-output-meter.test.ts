import { describe, expect, it, vi } from "vitest";
import type { RealtimeAudioGraph } from "@openreel/core";
import { createStereoOutputMeter } from "./stereo-output-meter";

function fixture() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const output = node();
  const stereo = node();
  const splitter = node();
  const samples = [
    [0, 0.5, -0.25],
    [0.125, -0.25, 0],
  ];
  let nextChannel = 0;
  const analysers: Array<ReturnType<typeof node>> = [];
  const context = {
    state: "running",
    createGain: () => stereo,
    createChannelSplitter: vi.fn(() => splitter),
    createAnalyser: () => {
      const channel = nextChannel++;
      const analyser = {
        ...node(),
        fftSize: 0,
        getFloatTimeDomainData: (buffer: Float32Array) => {
          buffer.fill(0);
          buffer.set(samples[channel]);
        },
      };
      analysers.push(analyser);
      return analyser;
    },
  };
  const graph = {
    getAudioContext: () => context,
    getMasterGain: () => output,
  } as unknown as RealtimeAudioGraph;
  return { graph, context, output, stereo, splitter, samples, analysers };
}

describe("stereo output metering", () => {
  it("measures separate sample peaks after master gain without creating another audible output", () => {
    const f = fixture();
    const meter = createStereoOutputMeter(f.graph);
    expect(meter.read()).toEqual([-6, -12]);
    expect(f.stereo).toMatchObject({
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    expect(f.output.connect).toHaveBeenCalledOnce();
    expect(f.output.connect).toHaveBeenCalledWith(f.stereo);
    expect(f.stereo.connect).toHaveBeenCalledOnce();
    expect(f.stereo.connect).toHaveBeenCalledWith(f.splitter);
    expect(f.splitter.connect).toHaveBeenNthCalledWith(1, f.analysers[0], 0);
    expect(f.splitter.connect).toHaveBeenNthCalledWith(2, f.analysers[1], 1);
    expect(
      f.analysers.every((node) => node.connect.mock.calls.length === 0),
    ).toBe(true);
    meter.dispose();
  });
  it("reports silence for suspended output and clamps silence, invalid samples and clipping", () => {
    const f = fixture();
    const meter = createStereoOutputMeter(f.graph);
    f.context.state = "suspended";
    expect(meter.read()).toEqual([-60, -60]);
    f.context.state = "running";
    f.samples[0] = [0, NaN, Infinity];
    f.samples[1] = [2, -1, 0];
    expect(meter.read()).toEqual([-60, 0]);
    meter.dispose();
  });
  it("disconnects only the analysis tap and is safe after preview graph disposal", () => {
    const f = fixture();
    const meter = createStereoOutputMeter(f.graph);
    f.output.disconnect.mockImplementation(() => {
      throw new Error("Already disconnected");
    });
    meter.dispose();
    meter.dispose();
    expect(f.output.disconnect).toHaveBeenCalledOnce();
    expect(f.output.disconnect).toHaveBeenCalledWith(f.stereo);
    expect(f.stereo.disconnect).toHaveBeenCalledOnce();
    expect(f.splitter.disconnect).toHaveBeenCalledOnce();
    expect(
      f.analysers.every((node) => node.disconnect.mock.calls.length === 1),
    ).toBe(true);
    expect(meter.read()).toEqual([-60, -60]);
  });
});
