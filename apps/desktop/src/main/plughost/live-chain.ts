import {
  blockParameterValues,
  changedParameterValues,
  chainPluginLatencyFrames,
  percentile,
  prefillBlocksForRoundTrip,
  sanitizeLatencySamples,
} from "../../../../../packages/core/src/audio/native-plugin/live-exports";
import type { NativePluginLane } from "../../../../../packages/core/src/audio/native-plugin/native-plugin-types";
import { fromFloat32, toFloat32 } from "../../shared/plughost-protocol";
import { HelperError, HelperProcess, type HelperSpawnOptions } from "./helper-process";

/**
 * The main-process half of a live plugin insert: one helper process per plugin of a rack, and the block pipeline that streams the
 * rack's audio through them while the preview plays.
 *
 *   AudioWorklet (renderer)  --MessagePort-->  LiveChain  --pipe-->  helper 1  --pipe-->  helper 2 ...
 *        'in'  seq, planar f32                   up to `maxInFlight` blocks in the pipes at once
 *        'out' seq, planar f32   <--------------  the block that came out of the last helper
 *
 * Why a MessagePort and a pipe, not shared memory: Chromium only hands an AudioWorklet SharedArrayBuffers on a cross-origin
 * isolated page and the helpers are separate processes, so there is no memory both sides can map without a native addon. The
 * port is a direct line from the audio thread to this process (it never touches the page's main thread) and a block is
 * 256 * 2 * 4 = 2 KB; the measured cost of the hops is in docs/audio-plugin-hosting.md.
 *
 * The chain never throws into the app: a helper that crashes, hangs or answers garbage ends the chain, which tells the worklet
 * (`status: crashed`) so it crossfades to the time-aligned dry signal, and reports the reason.
 */

export interface LiveStepConfig {
  readonly pluginId: string;
  readonly effectId: string;
  readonly state?: string;
  readonly values: Readonly<Record<string, number>>;
  /** Parameter lanes in TIMELINE seconds (a rack's keyframes as they are). */
  readonly automation: Readonly<Record<string, NativePluginLane>>;
  readonly spawn: HelperSpawnOptions;
  /** VST3: the bundle to load. */
  readonly pluginPath?: string;
}

export interface LiveChainOptions {
  readonly steps: readonly LiveStepConfig[];
  readonly sampleRate: number;
  readonly blockFrames: number;
  readonly channels?: number;
  /** Blocks allowed in the pipes at once. Further blocks wait in a queue (the plugins must see an unbroken stream); see `maxQueued`. */
  readonly maxInFlight?: number;
  /** Blocks that may wait behind a slow helper before the oldest is dropped (a drop makes the plugins' input discontinuous, so it resets them). */
  readonly maxQueued?: number;
  readonly openTimeoutMs?: number;
  readonly blockTimeoutMs?: number;
  /** Round trips measured at open to size the worklet's jitter buffer. */
  readonly warmupBlocks?: number;
  readonly headroomBlocks?: number;
  /** Delivers a message to the worklet (the other end of its MessagePort). */
  readonly post: (message: Record<string, unknown>, transfer?: ArrayBuffer[]) => void;
  readonly onFailure?: (reason: string) => void;
  readonly now?: () => number;
}

export interface LiveOpenResult {
  readonly pluginLatencyFrames: number;
  readonly perPluginLatencyFrames: readonly number[];
  readonly prefillBlocks: number;
  readonly blockFrames: number;
  readonly roundTripMs: { readonly p50: number; readonly p95: number; readonly max: number };
}

export interface LiveChainStats {
  readonly blocksIn: number;
  readonly blocksOut: number;
  /** Blocks thrown away because the helpers fell more than `maxQueued` blocks behind (the plugins are reset after one). */
  readonly dropped: number;
  /** Blocks that had to wait for a free slot in the pipes (their wet audio comes back late). */
  readonly queued: number;
  readonly staleDropped: number;
  readonly roundTripMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly failed: string | null;
  readonly pids: readonly number[];
}

interface Stage {
  readonly config: LiveStepConfig;
  readonly helper: HelperProcess;
  base: Record<string, number>;
  automation: Readonly<Record<string, NativePluginLane>>;
  readonly held: Record<string, number>;
  latency: number;
}

const DEFAULT_MAX_IN_FLIGHT = 4;
const RTT_WINDOW = 512;

export const messageSummary = (error: unknown): string => {
  if (error instanceof HelperError) {
    const tail = error.detail ? ` [${error.detail.split("\n").slice(-2).join(" | ")}]` : "";
    return `${error.message}${tail}`;
  }
  return error instanceof Error ? error.message : String(error);
};

export class LiveChain {
  private stages: Stage[] = [];
  private epoch = -1;
  private epochSeconds = 0;
  private dirty = false;
  private inFlight = 0;
  private failedReason: string | null = null;
  private disposed = false;
  private counters = { blocksIn: 0, blocksOut: 0, dropped: 0, queued: 0, staleDropped: 0 };
  private queue: Array<{ epoch: number; seq: number; data: Float32Array }> = [];
  private rtts: number[] = [];
  private readonly channels: number;
  private readonly maxInFlight: number;
  private readonly now: () => number;

  constructor(private readonly options: LiveChainOptions) {
    this.channels = options.channels ?? 2;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.now = options.now ?? (() => Number(process.hrtime.bigint()) / 1e6);
  }

  get failed(): string | null {
    return this.failedReason;
  }

  /** Spawns and opens one helper per plugin (in realtime mode), then measures the round trip of a silent block through the whole chain. */
  async open(): Promise<LiveOpenResult> {
    const { sampleRate, blockFrames } = this.options;
    try {
      for (const config of this.options.steps) {
        const helper = new HelperProcess(config.spawn);
        helper.on("exit", (error: HelperError) => this.fail(messageSummary(error)));
        await helper.start();
        const stage: Stage = { config, helper, base: { ...config.values }, automation: config.automation, held: {}, latency: 0 };
        this.stages.push(stage);
        const opened = await helper.request(
          {
            type: "open",
            id: config.pluginId,
            sampleRate,
            channels: this.channels,
            maxBlock: blockFrames,
            realtime: true,
            ...(config.pluginPath ? { path: config.pluginPath } : {}),
            ...(config.state ? { state: config.state } : {}),
            params: config.values,
          },
          this.options.openTimeoutMs ?? 25_000,
        );
        stage.latency = sanitizeLatencySamples(opened.json.latencySamples, sampleRate);
        for (const [key, value] of Object.entries(config.values)) stage.held[key] = value;
      }
      const silent = new Float32Array(this.channels * blockFrames);
      const rtts: number[] = [];
      const warmup = this.options.warmupBlocks ?? 24;
      for (let i = 0; i < warmup; i += 1) {
        const t0 = this.now();
        await this.runChain(silent, 0, false);
        if (i >= 4) rtts.push(this.now() - t0);
      }
      const rt = summarize(rtts);
      const perPlugin = this.stages.map((s) => s.latency);
      return {
        pluginLatencyFrames: chainPluginLatencyFrames(perPlugin),
        perPluginLatencyFrames: perPlugin,
        prefillBlocks: prefillBlocksForRoundTrip(rt.p95, blockFrames, sampleRate, this.options.headroomBlocks ?? 1),
        blockFrames,
        roundTripMs: rt,
      };
    } catch (error) {
      this.dispose();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private fail(reason: string): void {
    if (this.failedReason || this.disposed) return;
    this.failedReason = reason;
    this.options.post({ t: "status", state: "crashed", reason });
    this.options.onFailure?.(reason);
    for (const stage of this.stages) stage.helper.kill();
  }

  /** Runs one block through every helper in order. */
  private async runChain(data: Float32Array, startFrame: number, automate: boolean): Promise<Float32Array> {
    const { blockFrames, sampleRate } = this.options;
    let current = data;
    for (const stage of this.stages) {
      const wanted = automate ? blockParameterValues(stage.base, stage.automation, startFrame, sampleRate) : stage.base;
      const params = changedParameterValues(wanted, stage.held);
      const reply = await stage.helper.request({ type: "block", frames: blockFrames, params }, this.options.blockTimeoutMs ?? 1500, fromFloat32(current));
      const out = toFloat32(reply.binary);
      if (out.length !== this.channels * blockFrames) throw new HelperError("protocol", `the plugin returned ${out.length} samples for a ${this.channels} x ${blockFrames} block`);
      current = out;
    }
    return current;
  }

  /** A message from the worklet. */
  onMessage(message: { t?: string; epoch?: number; seq?: number; seconds?: number; data?: ArrayBuffer | Float32Array }): void {
    if (this.disposed) return;
    if (message.t === "epoch" && typeof message.epoch === "number") {
      this.epoch = message.epoch;
      this.queue = [];
      this.epochSeconds = typeof message.seconds === "number" && Number.isFinite(message.seconds) ? message.seconds : 0;
      if (this.dirty) void this.flush();
    } else if (message.t === "idle") {
      this.epoch = -1;
      this.queue = [];
    } else if (message.t === "in" && typeof message.epoch === "number" && typeof message.seq === "number" && message.data) {
      const data = message.data instanceof Float32Array ? message.data : new Float32Array(message.data);
      void this.onBlock(message.epoch, message.seq, data);
    }
  }

  /** Silences the plugins' internal history (delay lines, reverb tails) when the playhead moves, like a DAW does on locate. */
  private async flush(): Promise<void> {
    this.dirty = false;
    await Promise.all(this.stages.map((s) => s.helper.request({ type: "reset" }, 2000).catch(() => undefined)));
  }

  private async onBlock(epoch: number, seq: number, data: Float32Array): Promise<void> {
    if (this.failedReason || epoch !== this.epoch) {
      this.counters.staleDropped += 1;
      return;
    }
    this.counters.blocksIn += 1;
    if (this.inFlight >= this.maxInFlight) {
      this.counters.queued += 1;
      this.queue.push({ epoch, seq, data });
      if (this.queue.length > (this.options.maxQueued ?? 32)) {
        this.queue.shift();
        this.counters.dropped += 1;
        this.dirty = true;
        void this.flush();
      }
      return;
    }
    void this.process(epoch, seq, data);
  }

  private async process(epoch: number, seq: number, data: Float32Array): Promise<void> {
    if (this.failedReason || epoch !== this.epoch) {
      this.counters.staleDropped += 1;
      return;
    }
    this.inFlight += 1;
    this.dirty = true;
    const started = this.now();
    try {
      const startFrame = Math.round((this.epochSeconds + (seq * this.options.blockFrames) / this.options.sampleRate) * this.options.sampleRate);
      const out = await this.runChain(data, startFrame, true);
      this.rtts.push(this.now() - started);
      if (this.rtts.length > RTT_WINDOW) this.rtts.shift();
      for (let i = 0; i < out.length; i += 1) {
        if (!Number.isFinite(out[i])) throw new HelperError("plugin", "the plugin produced NaN or infinite samples");
      }
      if (epoch !== this.epoch || this.disposed) {
        this.counters.staleDropped += 1;
        return;
      }
      this.counters.blocksOut += 1;
      this.options.post({ t: "out", epoch, seq, data: out }, [out.buffer as ArrayBuffer]);
    } catch (error) {
      this.fail(messageSummary(error));
    } finally {
      this.inFlight -= 1;
      const next = this.queue.shift();
      if (next) void this.process(next.epoch, next.seq, next.data);
    }
  }

  /** New parameter values for a plugin of the chain (applied with the next block that reaches it). */
  setValues(effectId: string, values?: Readonly<Record<string, number>>, automation?: Readonly<Record<string, NativePluginLane>>): boolean {
    const stage = this.stages.find((s) => s.config.effectId === effectId);
    if (!stage) return false;
    if (values) stage.base = { ...stage.base, ...values };
    if (automation) stage.automation = automation;
    return true;
  }

  stats(): LiveChainStats {
    return { ...this.counters, roundTripMs: summarize(this.rtts), failed: this.failedReason, pids: this.stages.map((s) => s.helper.pid ?? 0) };
  }

  get pids(): number[] {
    return this.stages.map((s) => s.helper.pid ?? 0).filter((pid) => pid > 0);
  }

  get pluginLatencyFrames(): number {
    return chainPluginLatencyFrames(this.stages.map((s) => s.latency));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stage of this.stages) stage.helper.kill();
    this.stages = [];
  }
}

function summarize(values: readonly number[]): { p50: number; p95: number; max: number } {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : 0 };
}
