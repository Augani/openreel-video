/**
 * The Web Audio side of a live plugin insert: a node pair the graph splices in (see RealtimeAudioGraph.setLiveInsert) around an
 * AudioWorkletNode that runs LiveInsertDsp. Until the worklet module has loaded the pair is a plain pass-through, so a rack that
 * goes live never mutes the track while it opens.
 *
 * Nothing here is imported at startup: the editor loads this module (and the worklet) the first time a rack with live
 * preview has plugins, through a dynamic import.
 */
/// <reference path="../../repair/vite-worker-url.d.ts" />
import type { LiveInsertSlot } from "../../realtime-audio-graph";
import { liveInsertLatencyFrames } from "./live-latency";
import type { LiveInsertStats } from "./live-insert-dsp";

const processorName = "openreel-live-insert";
const loaded = new WeakSet<BaseAudioContext>();
const loading = new WeakMap<BaseAudioContext, Promise<boolean>>();

export function ensureLiveInsertWorklet(ctx: BaseAudioContext): Promise<boolean> {
  if (loaded.has(ctx)) return Promise.resolve(true);
  const existing = loading.get(ctx);
  if (existing) return existing;
  const worklet = (ctx as { audioWorklet?: { addModule(url: string): Promise<void> } }).audioWorklet;
  if (!worklet || typeof worklet.addModule !== "function") return Promise.resolve(false);
  // The bundler-specific URL import lives here, not in a module of its own: this file is itself only ever loaded lazily, and a separate
  // tiny url module would be a dynamic entry that the bundler may merge into a chunk the startup path already loads.
  const promise = import("./live-insert-worklet?worker&url")
    .then((mod) => worklet.addModule(mod.default))
    .then(() => {
      loaded.add(ctx);
      return true;
    })
    .catch((error: unknown) => {
      loading.delete(ctx);
      console.warn("[live-insert] could not load the live insert worklet; the insert plays dry.", error);
      return false;
    });
  loading.set(ctx, promise);
  return promise;
}

export interface LiveInsertNodeOptions {
  readonly channels?: number;
  readonly blockFrames: number;
  readonly prefillBlocks: number;
  readonly pluginLatencyFrames: number;
  readonly fadeFrames?: number;
  readonly onStats?: (stats: LiveInsertStats, latencyFrames: number) => void;
  readonly onHostStatus?: (state: string, reason?: string) => void;
}

export interface LiveInsertNode extends LiveInsertSlot {
  /** True once the worklet is processing (before that the pair passes the signal through). */
  readonly ready: boolean;
  readonly latencyFrames: number;
  /** Hands the worklet the port that reaches the plugin host (the page transfers it; the page keeps no copy). */
  connectHost(port: MessagePort): void;
  /** Playback started or the playhead moved: restart the block stream. `seconds` is the timeline time of the signal at the insert. */
  start(seconds: number): void;
  stop(): void;
  setBypassed(bypassed: boolean): void;
  setPluginLatency(frames: number): void;
  whenReady(): Promise<boolean>;
  dispose(): void;
}

export function createLiveInsertNode(ctx: BaseAudioContext, options: LiveInsertNodeOptions): LiveInsertNode {
  const channels = options.channels ?? 2;
  const input = ctx.createGain();
  const output = ctx.createGain();
  input.connect(output);
  let node: AudioWorkletNode | null = null;
  let disposed = false;
  let pluginLatency = options.pluginLatencyFrames;
  let hostPort: MessagePort | null = null;
  let pendingStart: number | null = null;
  let bypassed = false;
  let streaming = false;

  const attach = (): void => {
    if (disposed || node) return;
    node = new AudioWorkletNode(ctx, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
      channelCount: channels,
      channelCountMode: "explicit",
      processorOptions: { channels, blockFrames: options.blockFrames, prefillBlocks: options.prefillBlocks, pluginLatencyFrames: pluginLatency, ...(options.fadeFrames ? { fadeFrames: options.fadeFrames } : {}) },
    });
    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; stats?: LiveInsertStats; latencyFrames?: number; state?: string; reason?: string };
      if (data.type === "stats" && data.stats) options.onStats?.(data.stats, data.latencyFrames ?? 0);
      else if (data.type === "host-status" && data.state) options.onHostStatus?.(data.state, data.reason);
    };
    if (hostPort) node.port.postMessage({ type: "host", port: hostPort }, [hostPort]);
    hostPort = null;
    if (bypassed) node.port.postMessage({ type: "bypass", on: true });
    if (streaming && pendingStart !== null) node.port.postMessage({ type: "start", seconds: pendingStart });
    input.disconnect(output);
    input.connect(node);
    node.connect(output);
  };

  const ready = ensureLiveInsertWorklet(ctx).then((ok) => {
    if (ok) attach();
    return ok;
  });

  const handle: LiveInsertNode = {
    input,
    output,
    get ready() {
      return node !== null;
    },
    get latencyFrames() {
      return liveInsertLatencyFrames(options.blockFrames, options.prefillBlocks, pluginLatency);
    },
    get latencySeconds() {
      return handle.latencyFrames / (ctx.sampleRate || 48000);
    },
    connectHost(port) {
      if (node) node.port.postMessage({ type: "host", port }, [port]);
      else hostPort = port;
    },
    start(seconds) {
      streaming = true;
      pendingStart = seconds;
      node?.port.postMessage({ type: "start", seconds });
    },
    stop() {
      streaming = false;
      node?.port.postMessage({ type: "stop" });
    },
    setBypassed(next) {
      bypassed = next;
      node?.port.postMessage({ type: "bypass", on: next });
    },
    setPluginLatency(frames) {
      pluginLatency = Math.max(0, Math.round(frames));
      node?.port.postMessage({ type: "latency", frames: pluginLatency });
    },
    whenReady: () => ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      node?.port.postMessage({ type: "dispose" });
      try {
        input.disconnect();
        node?.disconnect();
        output.disconnect();
      } catch {
        /* already disconnected */
      }
      node = null;
    },
  };
  return handle;
}
