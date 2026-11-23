/**
 * AudioWorklet entry of a live plugin insert. It runs a LiveInsertDsp and talks to the plugin host over a MessagePort that
 * the page transferred in (the other end of that port is in the Electron main process, which owns the helper processes), so
 * audio blocks never touch the page's main thread. Loaded lazily by `ensureLiveInsertWorklet` the first time a rack goes live.
 */
import { LiveInsertDsp } from "./live-insert-dsp";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options?: never) => AudioWorkletProcessor): void;

export const LIVE_INSERT_PROCESSOR = "openreel-live-insert";

interface Options {
  readonly processorOptions?: { channels?: number; blockFrames?: number; prefillBlocks?: number; pluginLatencyFrames?: number; fadeFrames?: number };
}

/** Control messages from the page (the node's own port). */
type ControlMessage =
  | { type: "host"; port: MessagePort }
  | { type: "start"; seconds: number }
  | { type: "stop" }
  | { type: "bypass"; on: boolean }
  | { type: "latency"; frames: number }
  | { type: "dispose" };

/** Messages from the plugin host. */
type HostMessage = { t: "out"; epoch: number; seq: number; data: Float32Array } | { t: "status"; state: string; reason?: string };

const STATS_INTERVAL_FRAMES = 12_000;

class OpenReelLiveInsertProcessor extends AudioWorkletProcessor {
  private readonly dsp: LiveInsertDsp;
  private host: MessagePort | null = null;
  private disposed = false;
  private framesSinceStats = 0;
  private hostBypass = false;
  private userBypass = false;

  constructor(options?: Options) {
    super(options);
    const o = options?.processorOptions ?? {};
    this.dsp = new LiveInsertDsp({
      channels: o.channels ?? 2,
      blockFrames: o.blockFrames ?? 256,
      prefillBlocks: o.prefillBlocks ?? 3,
      pluginLatencyFrames: o.pluginLatencyFrames ?? 0,
      ...(o.fadeFrames ? { fadeFrames: o.fadeFrames } : {}),
      // Cloned, not transferred: the other end is an Electron MessagePortMain, which does not accept transferred ArrayBuffers.
      onBlock: (epoch, seq, data) => this.host?.postMessage({ t: "in", epoch, seq, data }),
    });
    this.dsp.setStreaming(false);
    this.port.onmessage = (event: MessageEvent) => this.onControl(event.data as ControlMessage);
  }

  private applyBypass(): void {
    this.dsp.setBypassed(this.hostBypass || this.userBypass);
  }

  private onControl(message: ControlMessage): void {
    switch (message.type) {
      case "host": {
        this.host?.close();
        this.host = message.port;
        this.host.onmessage = (event: MessageEvent) => this.onHost(event.data as HostMessage);
        break;
      }
      case "start": {
        if (this.dsp.isStreaming) this.dsp.startEpoch(this.dsp.epoch + 1);
        else this.dsp.setStreaming(true);
        this.host?.postMessage({ t: "epoch", epoch: this.dsp.epoch, seconds: message.seconds });
        break;
      }
      case "stop":
        this.dsp.setStreaming(false);
        this.host?.postMessage({ t: "idle" });
        break;
      case "bypass":
        this.userBypass = message.on;
        this.applyBypass();
        break;
      case "latency":
        this.dsp.setPluginLatency(message.frames);
        break;
      case "dispose":
        this.disposed = true;
        this.host?.close();
        this.host = null;
        break;
    }
  }

  private onHost(message: HostMessage): void {
    if (message.t === "out") this.dsp.pushWet(message.epoch, message.seq, message.data);
    else if (message.t === "status") {
      if (message.state === "crashed" || message.state === "failed") {
        this.hostBypass = true;
        this.applyBypass();
      }
      this.port.postMessage({ type: "host-status", state: message.state, reason: message.reason });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const frames = output[0].length;
    this.dsp.process(inputs[0] ?? [], output, frames);
    this.framesSinceStats += frames;
    if (this.framesSinceStats >= STATS_INTERVAL_FRAMES) {
      this.framesSinceStats = 0;
      this.port.postMessage({ type: "stats", stats: this.dsp.stats(), latencyFrames: this.dsp.latencyFrames, epoch: this.dsp.epoch, sampleRate });
    }
    return true;
  }
}

registerProcessor(LIVE_INSERT_PROCESSOR, OpenReelLiveInsertProcessor);
