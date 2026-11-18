import { describe, expect, it } from "vitest";
import type { RealtimeAudioGraph } from "@openreel/core";
import { createLiveLoudnessTap } from "./live-loudness-meter";

const FFT = 32768;

function fakeGraph(mixChannels = 2) {
  const analyserReads: number[] = [];
  const created = { analysers: 0, splitter: 0, interpretation: "" };
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  const context = {
    sampleRate: 48000,
    currentTime: 0,
    state: "running" as "running" | "suspended",
    createGain: () => {
      const gain = { ...node(), channelCount: 2, channelCountMode: "", channelInterpretation: "" };
      return new Proxy(gain, {
        set(target, key, value) {
          if (key === "channelInterpretation") created.interpretation = value as string;
          (target as Record<string | symbol, unknown>)[key] = value;
          return true;
        },
      });
    },
    createChannelSplitter: (count: number) => {
      created.splitter = count;
      return node();
    },
    createAnalyser: () => ({
      ...(created.analysers++, node()),
      fftSize: 0,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: (buf: Float32Array) => {
        analyserReads.push(buf.length);
        // A constant loud signal: stale audio left in the analyser.
        buf.fill(0.5);
      },
    }),
  };
  const master = node();
  const graph = {
    getAudioContext: () => context,
    getMasterGain: () => master,
    getMixChannelCount: () => mixChannels,
  } as unknown as RealtimeAudioGraph;
  return { graph, context, analyserReads, created };
}

describe("live loudness tap", () => {
  it("does not count stale analyser audio when the context resumes from suspension", () => {
    const { graph, context } = fakeGraph();
    const tap = createLiveLoudnessTap(graph);
    tap.read(); // bind while running
    context.state = "suspended";
    context.currentTime = 30; // time passes while no audio is rendered
    tap.read();
    context.state = "running";
    context.currentTime = 30.1; // 100 ms after resume
    const snapshot = tap.read();
    // Only 100 ms (4800 samples) may be added, not the capped 32768 stale ones.
    expect(snapshot.duration).toBeCloseTo(0.1, 2);
    expect(snapshot.duration).toBeLessThan(FFT / 48000);
  });

  it("meters six discrete channels in a 5.1 sequence (BS.1770 surround weights), two in stereo", () => {
    const stereo = fakeGraph(2);
    createLiveLoudnessTap(stereo.graph).read();
    expect(stereo.created.analysers).toBe(2);
    expect(stereo.created.splitter).toBe(2);
    expect(stereo.created.interpretation).toBe("speakers");

    const surround = fakeGraph(6);
    const tap = createLiveLoudnessTap(surround.graph);
    tap.read(); // binds the tap at t = 0
    surround.context.currentTime = 0.1;
    const snapshot = tap.read();
    expect(surround.created.analysers).toBe(6);
    expect(surround.created.splitter).toBe(6);
    expect(surround.created.interpretation).toBe("discrete");
    expect(snapshot.duration).toBeCloseTo(0.1, 2);
  });
});
