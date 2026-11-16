/**
 * Channel-count aware building blocks for effect chains.
 *
 * Web Audio's DynamicsCompressorNode and ConvolverNode only carry two channels:
 * a 5.1 signal sent through them is folded to stereo. Stereo (and mono) chains
 * keep using the native nodes exactly as before; above two channels the chains
 * use the pieces here, which keep every source channel and link the dynamics
 * across all of them (one detector, one gain).
 *
 * Gain, EQ (biquad), delay and WaveShaper nodes process any channel count
 * natively and only need their channel config pinned so nothing in the graph
 * up- or down-mixes them (`pinChannels`).
 */
import { createRepairChainNode } from "./repair/repair-node";
import type { RepairParams } from "./repair/repair-dsp";

/** True when a chain with this many channels needs the multichannel nodes instead of the stereo-only native ones. */
export const needsMultichannelNodes = (channels: number): boolean => channels > 2;

/** Fixes a node to exactly `channels` discrete channels (no implicit up/down-mix). Stereo and mono are left alone. */
export function pinChannels<T extends AudioNode>(node: T, channels: number): T {
  if (needsMultichannelNodes(channels)) {
    node.channelCount = channels;
    node.channelCountMode = "explicit";
    node.channelInterpretation = "discrete";
  }
  return node;
}

export interface ChannelStage {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly nodes: AudioNode[];
  /** Apply new params in place. */
  update(params: RepairParams): void;
  dispose(): void;
}

export interface LinkedCompressorOptions {
  readonly channels: number;
  /** Publishes the gain reduction (dB) of this stage under the effect id so the rack meter can read it. */
  readonly meterId?: string;
}

/**
 * Compressor linked across `channels` channels (a worklet, 6 ms lookahead like
 * the native node, so delay compensation is unchanged). Until the worklet has
 * loaded the stage passes audio through, like the repair effects.
 */
export function createLinkedCompressorStage(ctx: BaseAudioContext, params: RepairParams, options: LinkedCompressorOptions): ChannelStage {
  const chain = createRepairChainNode(ctx, "linkedCompressor", params, { channels: options.channels, meterId: options.meterId });
  return {
    input: chain.input,
    output: chain.output,
    nodes: chain.nodes,
    update: (next) => chain.update(next),
    dispose: () => chain.dispose(),
  };
}

export interface MultichannelConvolver {
  readonly input: AudioNode;
  readonly output: AudioNode;
  readonly nodes: AudioNode[];
  /** The first per-channel convolver (its buffer is the tail length). */
  readonly primary: ConvolverNode;
  setBuffer(impulse: AudioBuffer): void;
}

function monoImpulse(ctx: BaseAudioContext, impulse: AudioBuffer, channel: number): AudioBuffer {
  const mono = ctx.createBuffer(1, impulse.length, impulse.sampleRate);
  mono.getChannelData(0).set(impulse.getChannelData(channel % Math.max(1, impulse.numberOfChannels)));
  return mono;
}

/**
 * Reverb convolution for N channels: each channel has its own mono convolver
 * (the stereo impulse's two channels alternate so neighbouring speakers get
 * decorrelated tails), split from and merged back to N discrete channels.
 */
export function createMultichannelConvolver(ctx: BaseAudioContext, impulse: AudioBuffer, channels: number): MultichannelConvolver {
  const input = pinChannels(ctx.createGain(), channels);
  const splitter = ctx.createChannelSplitter(channels);
  const merger = ctx.createChannelMerger(channels);
  input.connect(splitter);
  const convolvers: ConvolverNode[] = [];
  for (let c = 0; c < channels; c++) {
    const convolver = ctx.createConvolver();
    convolver.buffer = monoImpulse(ctx, impulse, c);
    splitter.connect(convolver, c, 0);
    convolver.connect(merger, 0, c);
    convolvers.push(convolver);
  }
  return {
    input,
    output: merger,
    nodes: [input, splitter, merger, ...convolvers],
    primary: convolvers[0],
    setBuffer(next) {
      convolvers.forEach((convolver, c) => {
        convolver.buffer = monoImpulse(ctx, next, c);
      });
    },
  };
}
