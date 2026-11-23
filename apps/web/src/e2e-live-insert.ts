/**
 * End-to-end probe for live plugin inserts, used by the Electron test only (loaded through the e2e hook, never in a normal build).
 * It runs the real thing: a real AudioContext, the real worklet node, the MessagePort the main process hands over, the real helper
 * processes; the test feeds it a signal and gets the recorded output and the timing back.
 */
import { openLiveInsertNode } from "./services/live-plugin-inserts";

export interface LiveProbeOptions {
  readonly pluginId: string;
  readonly effectId: string;
  readonly values: Record<string, number>;
  readonly blockFrames: 128 | 256 | 512;
  /** Stereo input samples (planar). */
  readonly input: number[][];
  /** Change `values` to `changeTo` this many ms after the stream starts. */
  readonly changeAtMs?: number;
  readonly changeTo?: Record<string, number>;
  /** Report the helper process ids once playing (so the test can kill one). */
  readonly reportPidsAtMs?: number;
}

export interface LiveProbeResult {
  readonly sampleRate: number;
  readonly latencyFrames: number;
  readonly prefillBlocks: number;
  readonly pluginLatencyFrames: number;
  readonly output: number[][];
  /** Context time at which input frame 0 starts, and the context time of the first recorded frame (sample exact: recorder frame counter / sample rate). */
  readonly sourceStartTime: number;
  readonly recorderStartTime: number;
  readonly changeContextTime: number | null;
  readonly hostStatuses: Array<{ state: string; reason?: string }>;
  readonly stats: { underruns: number; lateBlocks: number; wetBlocks: number; dryBlocks: number; blocksSent: number } | null;
  readonly main: unknown;
  readonly openRoundTripMs: { p50: number; p95: number; max: number };
  readonly pids: number[];
}

const RECORDER_PROCESSOR = "openreel-probe-recorder";
const RECORDER_SOURCE = `
class ProbeRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 8192;
    this.fill = 0;
    this.frame = 0;
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
    this.port.onmessage = () => {
      this.post();
      this.port.postMessage({ done: true });
    };
  }
  post() {
    if (this.fill === 0) return;
    const channels = this.buffers.map((b) => b.slice(0, this.fill));
    this.port.postMessage({ frame: this.frame, channels }, channels.map((c) => c.buffer));
    this.fill = 0;
  }
  process(inputs) {
    const input = inputs[0] || [];
    const quantum = (input[0] && input[0].length) || 128;
    if (this.fill === 0) this.frame = currentFrame;
    for (let c = 0; c < 2; c += 1) {
      const data = input[c] || input[0];
      for (let i = 0; i < quantum; i += 1) this.buffers[c][this.fill + i] = data ? data[i] : 0;
    }
    this.fill += quantum;
    if (this.fill + 128 > this.size) this.post();
    return true;
  }
}
registerProcessor("${RECORDER_PROCESSOR}", ProbeRecorder);
`;
const recorderModuleUrl = (): string => URL.createObjectURL(new Blob([RECORDER_SOURCE], { type: "text/javascript" }));

export async function liveInsertProbe(options: LiveProbeOptions): Promise<LiveProbeResult> {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
  await ctx.resume();
  const hostStatuses: Array<{ state: string; reason?: string }> = [];
  let stats: LiveProbeResult["stats"] = null;
  const { node, sessionId, open } = await openLiveInsertNode(
    ctx,
    [{ effectId: options.effectId, pluginId: options.pluginId, values: options.values, automation: {} }],
    options.blockFrames,
    {
      onStats: (s) => {
        stats = { underruns: s.underruns, lateBlocks: s.lateBlocks, wetBlocks: s.wetBlocks, dryBlocks: s.dryBlocks, blocksSent: s.blocksSent };
      },
      onHostStatus: (state, reason) => hostStatuses.push({ state, reason }),
    },
  );
  const frames = options.input[0].length;
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  buffer.copyToChannel(Float32Array.from(options.input[0]), 0);
  buffer.copyToChannel(Float32Array.from(options.input[1]), 1);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // The recorder: an AudioWorklet on the audio thread. A ScriptProcessor (the main-thread tap used before) loses whole 128 or
  // 256 frame buffers whenever the page's main thread is busy (measured: a dry tap of a plain input drifted by 128 to 2700
  // frames over 3 s), which looked like a live-insert mismatch in 1 to 2 runs of 7. A worklet sees every quantum and stamps its
  // chunks with the context's frame counter, so a late message cannot shift the recording.
  await ctx.audioWorklet.addModule(recorderModuleUrl());
  const recorder = new AudioWorkletNode(ctx, RECORDER_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
  const chunks: Array<{ frame: number; channels: Float32Array[] }> = [];
  let flushed: (() => void) | null = null;
  recorder.port.onmessage = (event: MessageEvent<{ frame?: number; channels?: Float32Array[]; done?: boolean }>) => {
    if (event.data.channels && event.data.frame !== undefined) chunks.push({ frame: event.data.frame, channels: event.data.channels });
    if (event.data.done) flushed?.();
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node.input);
  node.output.connect(recorder);
  recorder.connect(mute);
  mute.connect(ctx.destination);
  node.start(0);
  const startAt = ctx.currentTime + 0.1;
  source.start(startAt);
  let changeContextTime: number | null = null;
  let pids: number[] = [];
  const bridge = window.openreel!.plughost!;
  const seconds = frames / ctx.sampleRate + 0.3;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const t0 = performance.now();
  if (options.changeAtMs !== undefined && options.changeTo) {
    await wait(Math.max(0, options.changeAtMs - (performance.now() - t0)));
    changeContextTime = ctx.currentTime;
    await bridge.liveSet?.(sessionId, options.effectId, options.changeTo);
  }
  if (options.reportPidsAtMs !== undefined) {
    await wait(Math.max(0, options.reportPidsAtMs - (performance.now() - t0)));
    pids = (await bridge.liveStats?.(sessionId))?.pids ?? [];
  }
  await wait(Math.max(0, seconds * 1000 - (performance.now() - t0)));
  const main = await bridge.liveStats?.(sessionId);
  node.stop();
  node.dispose();
  await bridge.liveClose?.(sessionId);
  const done = new Promise<void>((resolve) => {
    flushed = resolve;
  });
  recorder.port.postMessage("flush");
  await Promise.race([done, wait(2000)]);
  recorder.disconnect();
  await ctx.close();
  // Place every chunk by its frame stamp; the first recorded frame is where the context's recorder started.
  chunks.sort((x, y) => x.frame - y.frame);
  const firstFrame = chunks[0]?.frame ?? 0;
  const totalFrames = chunks.length > 0 ? chunks[chunks.length - 1].frame - firstFrame + chunks[chunks.length - 1].channels[0].length : 0;
  const placed = [new Float32Array(totalFrames), new Float32Array(totalFrames)];
  for (const chunk of chunks) for (let c = 0; c < 2; c += 1) placed[c].set(chunk.channels[c], chunk.frame - firstFrame);
  const output = placed.map((channel) => Array.from(channel));
  const firstFrameContextTime = firstFrame / ctx.sampleRate;
  return {
    sampleRate: ctx.sampleRate,
    latencyFrames: node.latencyFrames,
    prefillBlocks: open.prefillBlocks,
    pluginLatencyFrames: open.pluginLatencyFrames,
    output,
    sourceStartTime: startAt,
    recorderStartTime: firstFrameContextTime,
    changeContextTime,
    hostStatuses,
    stats,
    main,
    openRoundTripMs: open.roundTripMs,
    pids,
  };
}
