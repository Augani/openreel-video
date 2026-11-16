import { describe, expect, it, vi } from "vitest";
import { createLinkedCompressorStage, createMultichannelConvolver, needsMultichannelNodes, pinChannels } from "./multichannel-fx";
import { createRackEffect, createRackBus } from "./track-audio-rack";
import { fallbackDecodeChannels } from "./surround";

interface FakeNode {
  kind: string;
  channelCount: number;
  channelCountMode: string;
  channelInterpretation: string;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

function fakeContext() {
  const nodes: FakeNode[] = [];
  const param = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() });
  const make = (kind: string, extra: Record<string, unknown> = {}): FakeNode => {
    const n: FakeNode = { kind, channelCount: 2, channelCountMode: "max", channelInterpretation: "speakers", connect: vi.fn(), disconnect: vi.fn(), ...extra };
    nodes.push(n);
    return n;
  };
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => make("gain", { gain: param() }),
    createBiquadFilter: () => make("biquad", { type: "peaking", frequency: param(), gain: param(), Q: param() }),
    createDelay: () => make("delay", { delayTime: param() }),
    createWaveShaper: () => make("shaper", { curve: null, oversample: "none" }),
    createDynamicsCompressor: () => make("comp", { threshold: param(), ratio: param(), attack: param(), release: param(), knee: param(), reduction: 0 }),
    createConvolver: () => make("convolver", { buffer: null }),
    createChannelSplitter: (n: number) => make("splitter", { outputs: n }),
    createChannelMerger: (n: number) => make("merger", { inputs: n }),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      data: Array.from({ length: channels }, () => new Float32Array(length)),
      getChannelData(c: number) {
        return this.data[c];
      },
    }),
  };
  return { ctx: ctx as unknown as BaseAudioContext, nodes };
}

describe("channel pinning", () => {
  it("fixes a node to N discrete channels above stereo and leaves stereo and mono nodes untouched", () => {
    const { ctx } = fakeContext();
    const six = pinChannels(ctx.createGain(), 6) as unknown as FakeNode;
    expect([six.channelCount, six.channelCountMode, six.channelInterpretation]).toEqual([6, "explicit", "discrete"]);
    for (const channels of [1, 2]) {
      const node = pinChannels(ctx.createGain(), channels) as unknown as FakeNode;
      expect([node.channelCount, node.channelCountMode, node.channelInterpretation]).toEqual([2, "max", "speakers"]);
    }
    expect(needsMultichannelNodes(2)).toBe(false);
    expect(needsMultichannelNodes(4)).toBe(true);
  });
});

describe("multichannel convolver", () => {
  it("builds one mono convolver per channel, alternating the stereo impulse's channels", () => {
    const { ctx, nodes } = fakeContext();
    const impulse = ctx.createBuffer(2, 4, 48000);
    impulse.getChannelData(0).set([1, 1, 1, 1]);
    impulse.getChannelData(1).set([2, 2, 2, 2]);
    const conv = createMultichannelConvolver(ctx, impulse, 6);
    const convolvers = nodes.filter((n) => n.kind === "convolver");
    expect(convolvers).toHaveLength(6);
    expect(nodes.filter((n) => n.kind === "splitter")[0].outputs).toBe(6);
    expect(nodes.filter((n) => n.kind === "merger")[0].inputs).toBe(6);
    const buffers = convolvers.map((c) => c.buffer as AudioBuffer);
    buffers.forEach((b) => expect(b.numberOfChannels).toBe(1));
    expect(buffers.map((b) => b.getChannelData(0)[0])).toEqual([1, 2, 1, 2, 1, 2]);
    // The convolver of each channel is fed from its own splitter output and returns to its own merger input.
    const splitter = nodes.find((n) => n.kind === "splitter")!;
    expect(splitter.connect.mock.calls.map((c) => [c[1], c[2]])).toEqual(convolvers.map((_, i) => [i, 0]));
    convolvers.forEach((c, i) => expect(c.connect.mock.calls[0].slice(1)).toEqual([0, i]));
    conv.setBuffer(impulse);
    expect(convolvers.every((c) => (c.buffer as AudioBuffer).numberOfChannels === 1)).toBe(true);
  });
});

describe("linked compressor stage", () => {
  it("builds a six-channel discrete in/out pair around the worklet (pass-through until the worklet loads)", () => {
    const { ctx } = fakeContext();
    const stage = createLinkedCompressorStage(ctx, { threshold: -20 }, { channels: 6 });
    for (const n of [stage.input, stage.output] as unknown as FakeNode[]) {
      expect([n.channelCount, n.channelCountMode, n.channelInterpretation]).toEqual([6, "explicit", "discrete"]);
    }
    expect(() => stage.update({ threshold: -10 })).not.toThrow();
    stage.dispose();
  });
});

describe("5.1 rack bus", () => {
  it("is one six-channel rack: no native stereo compressor anywhere, a single shaper for the limiter, six convolvers", () => {
    const { ctx, nodes } = fakeContext();
    const bus = createRackBus(
      ctx,
      { effects: [createRackEffect("compressor", { id: "c" }), createRackEffect("limiter", { id: "l" }), createRackEffect("reverb", { id: "r" }), createRackEffect("eq", { id: "q" })] },
      { live: true, surround: true },
    );
    expect(nodes.some((n) => n.kind === "comp")).toBe(false);
    expect(nodes.filter((n) => n.kind === "shaper")).toHaveLength(1);
    expect(nodes.filter((n) => n.kind === "convolver")).toHaveLength(6);
    // Bus ends and the EQ's biquads carry six discrete channels.
    for (const n of [bus.input, bus.output] as unknown as FakeNode[]) expect(n.channelCount).toBe(6);
    const biquads = nodes.filter((n) => n.kind === "biquad");
    expect(biquads.length).toBeGreaterThan(0);
    biquads.forEach((b) => expect([b.channelCount, b.channelCountMode, b.channelInterpretation]).toEqual([6, "explicit", "discrete"]));
    expect(bus.getSlotCount()).toBe(4);
    // Edits stay in place (no rebuild) in a surround rack as well.
    const rebuilds = bus.rebuildCount;
    bus.update({ effects: [createRackEffect("compressor", { id: "c", params: { threshold: -30 } }), createRackEffect("limiter", { id: "l" }), createRackEffect("reverb", { id: "r" }), createRackEffect("eq", { id: "q" })] });
    expect(bus.rebuildCount).toBe(rebuilds);
    bus.dispose();
  });

  it("keeps the stereo rack on the native compressor", () => {
    const { ctx, nodes } = fakeContext();
    createRackBus(ctx, { effects: [createRackEffect("compressor", { id: "c" })] }, { live: true });
    expect(nodes.some((n) => n.kind === "comp")).toBe(true);
    expect(nodes.some((n) => n.kind === "convolver")).toBe(false);
  });
});

describe("fallback decode channels", () => {
  it("keeps the source's channels (up to six) in a 5.1 sequence and the legacy stereo decode otherwise", () => {
    expect(fallbackDecodeChannels("stereo", 6)).toBeUndefined();
    expect(fallbackDecodeChannels("5.1", 6)).toBe(6);
    expect(fallbackDecodeChannels("5.1", 2)).toBe(2); // a stereo source is not upmixed by ffmpeg
    expect(fallbackDecodeChannels("5.1", 1)).toBe(1);
    expect(fallbackDecodeChannels("5.1", 8)).toBe(6); // wider sources fold to 5.1
    expect(fallbackDecodeChannels("5.1", undefined)).toBe(2);
    expect(fallbackDecodeChannels("5.1", 0)).toBe(2);
  });
});
