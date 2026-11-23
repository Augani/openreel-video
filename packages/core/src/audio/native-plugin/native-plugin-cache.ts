import { fingerprintAudioBuffer, type EnhanceBufferFactory } from "../enhance/enhance-cache";
import {
  NativePluginCancelledError,
  NativePluginUnavailableError,
  type NativePluginBackend,
  type NativePluginStep,
} from "./native-plugin-types";

/**
 * Cached, off-thread rendering of a decoded clip source through its hosted plugins, shared by the live preview and the
 * export mixdown (the same design as the Enhance Speech cache).
 *
 * Each plugin in the clip's chain is one cache entry keyed by the content of its input, the plugin, its state chunk, its
 * parameter values and its automation lanes, so editing one plugin only re-renders from that plugin on, and the preview
 * and the export of the same clip play identical samples. The preview uses {@link peek} and swaps the processed buffer in
 * when {@link request} resolves; the export awaits it.
 *
 * A plugin the host cannot run (not installed, blocked, no host at all) is BYPASSED for that step and reported through
 * {@link bypassed}; a plugin that fails while rendering makes the request reject (the export fails loudly rather than
 * silently changing the audio) and is remembered for {@link NATIVE_PLUGIN_FAILURE_TTL_MS}.
 */

export const NATIVE_PLUGIN_FAILURE_TTL_MS = 30_000;
export const NATIVE_PLUGIN_BYPASS_TTL_MS = 5_000;
export const NATIVE_PLUGIN_MAX_ENTRIES = 12;

export type NativePluginJobState = "idle" | "running" | "ready" | "failed";
export interface NativePluginJobStatus {
  readonly state: NativePluginJobState;
  readonly fraction: number;
  readonly error?: string;
}

export interface NativePluginRequestResult {
  /** The processed buffer (the input itself when every step was bypassed). */
  readonly buffer: AudioBuffer;
  /** Effect ids that were bypassed because the plugin is unavailable, with the reason. */
  readonly bypassed: ReadonlyMap<string, string>;
}

interface Entry {
  readonly key: string;
  buffer?: AudioBuffer;
  latencySamples?: number;
  bypass?: { until: number; reason: string };
  failure?: { until: number; message: string };
  job?: { controller: AbortController; promise: Promise<void>; fraction: number };
}

export interface NativePluginCacheOptions {
  readonly backend?: NativePluginBackend;
  readonly makeBuffer: EnhanceBufferFactory;
  readonly now?: () => number;
  readonly maxEntries?: number;
}

/** 53-bit string hash (cyrb53): collision odds are negligible for the few dozen keys held at once. */
function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export const stepSignature = (step: NativePluginStep): string =>
  hashString(JSON.stringify([step.pluginId, step.state ?? "", Object.entries(step.values).sort(([a], [b]) => (a < b ? -1 : 1)), Object.entries(step.automation).sort(([a], [b]) => (a < b ? -1 : 1))]));

let sharedBackend: NativePluginBackend | undefined;

/** The host the process-wide cache renders through (the desktop bridge). Without one every plugin step is bypassed and reported. */
export function setNativePluginBackend(backend: NativePluginBackend | undefined): void {
  sharedBackend = backend;
}
export const getNativePluginBackend = (): NativePluginBackend | undefined => sharedBackend;

export class NativePluginRenderCache {
  private readonly explicitBackend: NativePluginBackend | undefined;
  private makeBuffer: EnhanceBufferFactory;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly fingerprints = new WeakMap<AudioBuffer, string>();
  private readonly labels = new WeakMap<AudioBuffer, string>();
  private readonly entries = new Map<string, Entry>();
  private readonly readyListeners = new Set<(buffer: AudioBuffer) => void>();
  private readonly statusListeners = new Set<(buffer: AudioBuffer, status: NativePluginJobStatus) => void>();

  constructor(options: NativePluginCacheOptions) {
    this.explicitBackend = options.backend;
    this.makeBuffer = options.makeBuffer;
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? NATIVE_PLUGIN_MAX_ENTRIES;
  }

  setBufferFactory(factory: EnhanceBufferFactory): void {
    this.makeBuffer = factory;
  }

  private get backend(): NativePluginBackend | undefined {
    return this.explicitBackend ?? sharedBackend;
  }

  private inputKey(buffer: AudioBuffer): string {
    let fingerprint = this.fingerprints.get(buffer);
    if (!fingerprint) this.fingerprints.set(buffer, (fingerprint = fingerprintAudioBuffer(buffer)));
    return fingerprint;
  }

  private touch(entry: Entry): void {
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    const ready = [...this.entries.values()].filter((candidate) => candidate.buffer && !candidate.job);
    for (let i = 0; i < ready.length - this.maxEntries; i += 1) this.entries.delete(ready[i].key);
  }

  private liveBypass(entry: Entry | undefined): string | undefined {
    if (entry?.bypass && entry.bypass.until > this.now()) return entry.bypass.reason;
    return undefined;
  }

  /** The fully processed buffer when every step is cached (bypassed steps count as done), else null. Never computes anything. */
  peek(buffer: AudioBuffer, steps: readonly NativePluginStep[]): AudioBuffer | null {
    let key = this.inputKey(buffer);
    let current = buffer;
    for (const step of steps) {
      const next = `${key}>${stepSignature(step)}`;
      const entry = this.entries.get(next);
      if (entry?.buffer) {
        current = entry.buffer;
        key = next;
      } else if (this.liveBypass(entry)) {
        // the step passes the audio through unchanged; keep the key chain moving so later steps still match
        key = next;
      } else return null;
    }
    return current;
  }

  /** Where the job for the first not-yet-ready step stands (for progress UI). */
  status(buffer: AudioBuffer, steps: readonly NativePluginStep[]): NativePluginJobStatus {
    let key = this.inputKey(buffer);
    for (const step of steps) {
      key = `${key}>${stepSignature(step)}`;
      const entry = this.entries.get(key);
      if (entry?.job) return { state: "running", fraction: entry.job.fraction };
      if (entry?.failure && entry.failure.until > this.now()) return { state: "failed", fraction: 0, error: entry.failure.message };
      if (!entry?.buffer && !this.liveBypass(entry)) return { state: "idle", fraction: 0 };
    }
    return { state: "ready", fraction: 1 };
  }

  /** Latency (samples) the plugin reported the last time `step` rendered, if it has. */
  reportedLatency(buffer: AudioBuffer, steps: readonly NativePluginStep[], index: number): number | undefined {
    let key = this.inputKey(buffer);
    for (let i = 0; i <= index && i < steps.length; i += 1) key = `${key}>${stepSignature(steps[i])}`;
    return this.entries.get(key)?.latencySamples;
  }

  /** The reason a step is being bypassed right now, if it is. */
  bypassReason(buffer: AudioBuffer, steps: readonly NativePluginStep[], index: number): string | undefined {
    let key = this.inputKey(buffer);
    for (let i = 0; i <= index && i < steps.length; i += 1) key = `${key}>${stepSignature(steps[i])}`;
    return this.liveBypass(this.entries.get(key));
  }

  /** What a source buffer is being rendered for (a track or bus name), when the requester said so. For progress UI only. */
  labelFor(buffer: AudioBuffer): string | undefined {
    return this.labels.get(buffer);
  }

  onReady(listener: (buffer: AudioBuffer) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  onStatus(listener: (buffer: AudioBuffer, status: NativePluginJobStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(buffer: AudioBuffer, status: NativePluginJobStatus): void {
    for (const listener of [...this.statusListeners]) listener(buffer, status);
  }

  /** Cancels the running jobs for this source. The request rejects with {@link NativePluginCancelledError}. */
  cancel(buffer: AudioBuffer, steps: readonly NativePluginStep[]): boolean {
    let key = this.inputKey(buffer);
    let any = false;
    for (const step of steps) {
      key = `${key}>${stepSignature(step)}`;
      const job = this.entries.get(key)?.job;
      if (job) {
        job.controller.abort();
        any = true;
      }
    }
    return any;
  }

  /**
   * Cancels every running job for this source buffer, whichever chain asked for it (the background-task panel
   * knows the source but not the step list). Emits "idle" once the jobs have unwound.
   */
  cancelSource(buffer: AudioBuffer): boolean {
    const prefix = `${this.inputKey(buffer)}>`;
    const settled: Promise<void>[] = [];
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix) && entry.job) {
        entry.job.controller.abort();
        settled.push(entry.job.promise);
      }
    }
    if (!settled.length) return false;
    void Promise.all(settled).then(() => this.emitStatus(buffer, { state: "idle", fraction: 0 }));
    return true;
  }

  /** Forgets remembered failures and bypasses so the next request tries again straight away (after the user fixed or unblocked a plugin). */
  clearFailures(): void {
    for (const entry of this.entries.values()) {
      entry.failure = undefined;
      entry.bypass = undefined;
    }
    for (const [key, entry] of this.entries) if (!entry.buffer && !entry.job) this.entries.delete(key);
  }

  /**
   * Runs (or joins) the chain. Resolves with the processed buffer and the steps that were bypassed; rejects when a
   * plugin failed (the message says why) or the job was cancelled.
   */
  async request(buffer: AudioBuffer, steps: readonly NativePluginStep[], options: { onProgress?: (fraction: number) => void; label?: string } = {}): Promise<NativePluginRequestResult> {
    if (options.label) this.labels.set(buffer, options.label);
    let key = this.inputKey(buffer);
    let current = buffer;
    const bypassed = new Map<string, string>();
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const next = `${key}>${stepSignature(step)}`;
      let entry = this.entries.get(next);
      const reason = this.liveBypass(entry);
      if (entry?.buffer) {
        this.touch(entry);
        current = entry.buffer;
      } else if (reason) {
        bypassed.set(step.effectId, reason);
      } else {
        if (entry?.failure && entry.failure.until > this.now()) throw new Error(entry.failure.message);
        if (!entry || (!entry.job && !entry.buffer)) this.entries.set(next, (entry = { key: next }));
        const target = entry;
        if (!target.job) this.startJob(target, current, step, buffer, steps, index, options.onProgress);
        await target.job?.promise;
        if (target.buffer) current = target.buffer;
        else if (this.liveBypass(target)) bypassed.set(step.effectId, this.liveBypass(target) as string);
        else if (target.failure) throw new Error(target.failure.message);
        else throw new NativePluginCancelledError();
      }
      key = next;
    }
    const final = steps.length === 0 ? buffer : current;
    this.emitStatus(buffer, { state: "ready", fraction: 1 });
    for (const listener of [...this.readyListeners]) listener(buffer);
    return { buffer: final, bypassed };
  }

  private startJob(entry: Entry, input: AudioBuffer, step: NativePluginStep, source: AudioBuffer, steps: readonly NativePluginStep[], index: number, onProgress?: (fraction: number) => void): void {
    const controller = new AbortController();
    const job = { controller, fraction: 0, promise: Promise.resolve() };
    entry.job = job;
    const channels: Float32Array[] = [];
    for (let c = 0; c < input.numberOfChannels; c += 1) channels.push(input.getChannelData(c));
    const backend = this.backend;
    const run = async (): Promise<void> => {
      if (!backend) throw new NativePluginUnavailableError(step.pluginId, "plugin hosting needs the OpenReel desktop app");
      const result = await backend.render(
        { pluginId: step.pluginId, ...(step.state ? { state: step.state } : {}), values: step.values, automation: step.automation, channels, sampleRate: input.sampleRate },
        {
          signal: controller.signal,
          onProgress: (fraction) => {
            job.fraction = (index + fraction) / Math.max(1, steps.length);
            onProgress?.(job.fraction);
            this.emitStatus(source, { state: "running", fraction: job.fraction });
          },
        },
      );
      entry.buffer = this.makeBuffer(result.channels, input.sampleRate);
      entry.latencySamples = result.latencySamples;
      entry.failure = undefined;
    };
    this.emitStatus(source, { state: "running", fraction: index / Math.max(1, steps.length) });
    job.promise = run()
      .catch((error: unknown) => {
        if (error instanceof NativePluginUnavailableError) {
          entry.bypass = { until: this.now() + NATIVE_PLUGIN_BYPASS_TTL_MS, reason: error.message };
        } else if (!(error instanceof NativePluginCancelledError) && !controller.signal.aborted) {
          entry.failure = { until: this.now() + NATIVE_PLUGIN_FAILURE_TTL_MS, message: error instanceof Error ? error.message : String(error) };
        }
      })
      .finally(() => {
        entry.job = undefined;
        if (!entry.buffer && !entry.failure && !entry.bypass) this.entries.delete(entry.key);
        else this.touch(entry);
        if (entry.failure) this.emitStatus(source, { state: "failed", fraction: 0, error: entry.failure.message });
      });
  }
}

let sharedCache: NativePluginRenderCache | null = null;
const createdListeners = new Set<(cache: NativePluginRenderCache) => void>();

/** Calls `listener` with the shared cache now (if it exists) and when it is created. Returns an unsubscribe. */
export function onSharedNativePluginCache(listener: (cache: NativePluginRenderCache) => void): () => void {
  if (sharedCache) listener(sharedCache);
  else createdListeners.add(listener);
  return () => createdListeners.delete(listener);
}

/** The process-wide cache used by preview and export, so a render computed for one is reused by the other. */
export function getSharedNativePluginCache(makeBuffer: EnhanceBufferFactory): NativePluginRenderCache {
  if (!sharedCache) {
    sharedCache = new NativePluginRenderCache({ makeBuffer });
    const created = sharedCache;
    for (const listener of [...createdListeners]) listener(created);
    createdListeners.clear();
  } else sharedCache.setBufferFactory(makeBuffer);
  return sharedCache;
}

export const peekSharedNativePluginCache = (): NativePluginRenderCache | null => sharedCache;
