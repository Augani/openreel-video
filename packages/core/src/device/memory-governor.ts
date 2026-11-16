/**
 * Global memory governor: one place that watches how much memory decoded media holds and degrades the
 * preview in steps, instead of letting the caches, decoders and canvases grow until the tab dies.
 *
 * What it can see from a web page (measured on the 4K soak, docs/known-limitations.md "Memory"):
 *  - the byte-budgeted caches (decoded audio, video frames, scrub frames, bitmaps), which register as
 *    consumers and report their size;
 *  - live decoder pools: a 4K long-GOP decoder keeps a pool of frames in the renderer that no JS counter
 *    reports, so each open decoder is registered with an estimated cost derived from its resolution;
 *  - the JS heap (`performance.memory`) and, where the page is cross-origin isolated, the user-agent memory
 *    estimate (`performance.measureUserAgentSpecificMemory`, polled slowly because it is expensive).
 * The estimate is the larger of the measured figure and the sum of the registered consumers, plus the heap.
 *
 * Pressure is the estimate over a limit derived from system RAM and has hysteresis, so the policy does not
 * flap while a cache is trimming itself. Each level maps to a policy that the app applies:
 *  - normal:   everything as budgeted;
 *  - elevated: decoded-media caches at 60 %, preview resolution x0.75, at most two decoder elements,
 *              audio decoded ahead only for the clips about to play;
 *  - critical: caches at 30 %, preview resolution x0.5, one decoder element, no read-ahead decoding.
 * The policy only changes what the preview holds in memory. Export reads the project at full resolution and
 * ignores it, so preview and export stay consistent in what they render.
 */
const MB = 1024 * 1024;
const GB = 1024 * MB;

export type MemoryPressure = "normal" | "elevated" | "critical";

export interface MemoryPolicy {
  pressure: MemoryPressure;
  /** Multiplier on every decoded-media cache budget. */
  cacheScale: number;
  /** Multiplier on the preview canvas long edge. */
  previewScale: number;
  /** Decoder elements the video engine may keep open. */
  maxDecoderElements: number;
  /** Whether audio and anchors may be decoded ahead of need. */
  readAhead: boolean;
}

const POLICIES: Record<MemoryPressure, MemoryPolicy> = {
  normal: { pressure: "normal", cacheScale: 1, previewScale: 1, maxDecoderElements: 3, readAhead: true },
  elevated: { pressure: "elevated", cacheScale: 0.6, previewScale: 0.75, maxDecoderElements: 2, readAhead: true },
  critical: { pressure: "critical", cacheScale: 0.3, previewScale: 0.5, maxDecoderElements: 1, readAhead: false },
};

export function policyFor(pressure: MemoryPressure): MemoryPolicy {
  return POLICIES[pressure];
}

/** Share of the limit at which each level is entered, and the lower share at which it is left again. */
export const PRESSURE_THRESHOLDS = {
  elevated: { enter: 0.65, leave: 0.5 },
  critical: { enter: 0.9, leave: 0.75 },
} as const;

const MIN_LIMIT_BYTES = 1 * GB;
const MAX_LIMIT_BYTES = 3 * GB;
const LIMIT_RAM_FRACTION = 0.3;
const DEFAULT_SYSTEM_MEMORY_BYTES = 8 * GB;

/**
 * Bytes the renderer may spend on decoded media before the preview degrades. 30 % of RAM, between 1 and
 * 3 GB: a 16 GB machine gets 3 GB (the 4 GB total-browser target minus the GPU and utility processes).
 */
export function computeGovernorLimit(systemMemoryBytes: number | null | undefined): number {
  const ram = systemMemoryBytes && systemMemoryBytes > 0 ? systemMemoryBytes : DEFAULT_SYSTEM_MEMORY_BYTES;
  return Math.floor(Math.min(MAX_LIMIT_BYTES, Math.max(MIN_LIMIT_BYTES, ram * LIMIT_RAM_FRACTION)));
}

/** Pure level transition with hysteresis. */
export function nextPressure(current: MemoryPressure, usageBytes: number, limitBytes: number): MemoryPressure {
  const share = limitBytes > 0 ? usageBytes / limitBytes : 0;
  const t = PRESSURE_THRESHOLDS;
  if (current === "critical") {
    if (share >= t.critical.leave) return "critical";
    return share >= t.elevated.leave ? "elevated" : "normal";
  }
  if (share >= t.critical.enter) return "critical";
  if (current === "elevated") return share >= t.elevated.leave ? "elevated" : "normal";
  return share >= t.elevated.enter ? "elevated" : "normal";
}

/**
 * Estimated memory held by one open decoder, per source pixel. Calibrated from the soak, not derived:
 * the first model (12 NV12 frames = 18 bytes per pixel, 149 MB at 4K) undercounted by roughly 7x.
 * In the layered 4K runs (docs/known-limitations.md, "Memory": two overlapping 4K long-GOP layers from
 * 10-minute sources) renderer RSS rose from ~1.4 GB to 3.1-3.6 GB while both layers decoded, and the
 * total peaked at 3.7-4.0 GB, i.e. 0.85-1.1 GB per 4K decoder once the decoder's reorder/surface pool,
 * the per-layer sink canvas and the GPU upload copies are counted. 120 bytes per pixel puts a 4K decoder
 * at ~995 MB (the upper middle of that range, so the estimate errs towards degrading early) and a 1080p
 * decoder at ~249 MB.
 */
export const DECODER_BYTES_PER_PIXEL = 120;

/** Share of the limit that open decoders alone may claim: the level at which pressure turns critical. */
export const DECODER_BUDGET_SHARE = PRESSURE_THRESHOLDS.critical.enter;

export function estimateDecoderBytes(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0;
  return Math.round(width * height * DECODER_BYTES_PER_PIXEL);
}

/**
 * How many decoders of this size may be open at once before decoders alone exceed their share of the
 * limit. Never below 1: one source must always be playable (the pressure policy then degrades the rest).
 * Unknown sizes are not capped here.
 */
export function maxConcurrentDecoders(width: number, height: number, limitBytes: number): number {
  const each = estimateDecoderBytes(width, height);
  if (each <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor((limitBytes * DECODER_BUDGET_SHARE) / each));
}

/**
 * Renderer footprint that no page API reports: the browser runtime, compositor/GPU surfaces, WASM and
 * codec libraries and the V8 code space. In the 4K soak renderer RSS sat at ~1.4 GB before any layered
 * 4K decode started, while `performance.memory` showed a few hundred MB and `measureUserAgentSpecificMemory`
 * (JS, DOM and workers only) is of the same order. The page figure is therefore floored at this value, so a
 * small reported heap cannot make an 8 GB machine look like it has room for a second 4K decoder.
 */
export const RENDERER_BASELINE_BYTES = 1.4 * GB;

export interface MemoryConsumer {
  /** Bytes currently held. */
  bytes: () => number;
  /**
   * The bytes are already part of what the page reports about itself (`performance.memory` and
   * `measureUserAgentSpecificMemory` both include AudioBuffer and ArrayBuffer data; probe-memory-signals.mjs
   * shows it), so they must not be added to it again. They still count when the page figure is unavailable.
   */
  inPageMemory?: boolean;
}

export interface MemoryGovernorOptions {
  systemMemoryBytes?: number | null;
  /** Page-reported heap in bytes (default: `performance.memory`). */
  heapBytes?: () => number | null;
  /** Slow, precise page memory in bytes, or null (default: `measureUserAgentSpecificMemory` when isolated). */
  measure?: () => Promise<number | null>;
  /** Floor for the page figure (default RENDERER_BASELINE_BYTES); tests that model a bare page pass 0. */
  rendererBaselineBytes?: number;
  /** Milliseconds between samples while started (default 2000). */
  intervalMs?: number;
  /** Milliseconds between precise measurements (default 20000). */
  measureEveryMs?: number;
}

export interface MemoryReading {
  pressure: MemoryPressure;
  usageBytes: number;
  limitBytes: number;
  consumersBytes: number;
  decodersBytes: number;
  heapBytes: number;
  measuredBytes: number | null;
  /**
   * What decoders have to fit on top of: the page figure floored at RENDERER_BASELINE_BYTES, plus frame
   * caches. Used only for decoder admission; pressure levels use usageBytes (the measured figure).
   */
  decoderBaselineBytes: number;
  consumers: Record<string, number>;
  decoders: number;
}

type Listener = (policy: MemoryPolicy, reading: MemoryReading) => void;

function defaultHeapBytes(): number | null {
  const mem = (globalThis as unknown as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory;
  return typeof mem?.usedJSHeapSize === "number" ? mem.usedJSHeapSize : null;
}

async function defaultMeasure(): Promise<number | null> {
  const g = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    performance?: { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  };
  if (!g.crossOriginIsolated || typeof g.performance?.measureUserAgentSpecificMemory !== "function") return null;
  try {
    return (await g.performance.measureUserAgentSpecificMemory()).bytes;
  } catch {
    return null;
  }
}

export class MemoryGovernor {
  private readonly consumers = new Map<string, MemoryConsumer>();
  private readonly decoders = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private limit: number;
  private pressure: MemoryPressure = "normal";
  private measured: number | null = null;
  private lastMeasureAt = 0;
  private measuring = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private forced: MemoryPressure | null = null;
  private rebase = false;
  private notifiedMaxDecoders = POLICIES.normal.maxDecoderElements;
  private notifiedPressure: MemoryPressure = "normal";
  private notifying = false;
  private changeEpoch = 0;
  private last: MemoryReading;

  constructor(private readonly options: MemoryGovernorOptions = {}) {
    this.limit = computeGovernorLimit(options.systemMemoryBytes);
    this.last = this.read();
  }

  /** The pressure policy, with the decoder cap lowered to what the budget allows for the largest open decoder. */
  get policy(): MemoryPolicy {
    return this.effectivePolicy(this.pressure);
  }

  /**
   * Bytes in use that are not open decoders: the page figure (heap or precise measurement) plus the frame
   * caches. This is the renderer baseline (~1.4 GB in the soak) that decoders have to fit on top of.
   */
  private get baselineBytes(): number {
    return this.last.decoderBaselineBytes;
  }

  /**
   * Decoders of the largest registered size that may be open at once: what is left of the critical share of
   * the limit once the non-decoder baseline is subtracted, divided by the largest decoder. Never below 1
   * (one source must stay playable), Infinity while no decoder is registered.
   */
  get decoderCap(): number {
    let largest = 0;
    for (const b of this.decoders.values()) if (b > largest) largest = b;
    if (largest <= 0) return Number.POSITIVE_INFINITY;
    const room = this.limit * DECODER_BUDGET_SHARE - this.baselineBytes;
    return Math.max(1, Math.floor(room / largest));
  }

  /**
   * Whether one more decoder of this size fits under the critical share of the limit given everything
   * currently held. The first decoder is always allowed. Callers that open decoders outside the video
   * engine (the playback layers in the preview) ask before opening one and degrade instead when it is false.
   */
  canOpenDecoder(bytes: number): boolean {
    if (this.decoders.size === 0 || !(bytes > 0)) return true;
    const reading = this.read();
    return reading.decoderBaselineBytes + reading.decodersBytes + bytes <= this.limit * DECODER_BUDGET_SHARE;
  }

  private effectivePolicy(pressure: MemoryPressure): MemoryPolicy {
    const base = POLICIES[pressure];
    const cap = this.decoderCap;
    if (cap >= base.maxDecoderElements) return base;
    // Stable identity per (level, cap): `policy` is a useSyncExternalStore snapshot, and a fresh object on every
    // read makes React re-render forever ("Maximum update depth exceeded") while the cap is below the level's.
    const cached = this.cappedPolicy;
    if (cached && cached.pressure === pressure && cached.maxDecoderElements === cap) return cached;
    return (this.cappedPolicy = { ...base, maxDecoderElements: cap });
  }
  private cappedPolicy: MemoryPolicy | null = null;

  /**
   * Increments whenever the room for decoders may have changed (a decoder opened or closed, the limit moved).
   * Callers that were refused a decoder retry only once this changes.
   */
  get epoch(): number {
    return this.changeEpoch;
  }

  get reading(): MemoryReading {
    return this.last;
  }

  setSystemMemory(bytes: number | null | undefined): void {
    this.limit = computeGovernorLimit(bytes);
    this.changeEpoch++;
    this.evaluate();
  }

  /** Overrides the limit directly (tests, the e2e hook). */
  setLimitBytes(bytes: number): void {
    this.limit = Math.max(1, bytes);
    this.changeEpoch++;
    this.evaluate();
  }

  /** Pins the level regardless of usage; null returns to measuring. */
  force(pressure: MemoryPressure | null): void {
    // Un-pinning re-measures from "normal", so the hysteresis band of a level the usage never reached does not hold it.
    this.rebase = pressure === null && this.forced !== null;
    this.forced = pressure;
    this.evaluate();
  }

  /** A cache or pool that holds decoded media. The returned function unregisters it. */
  registerConsumer(name: string, consumer: MemoryConsumer): () => void {
    this.consumers.set(name, consumer);
    return () => {
      if (this.consumers.get(name) === consumer) this.consumers.delete(name);
    };
  }

  /** An open decoder with its estimated cost. The returned function releases it (idempotent). */
  registerDecoder(id: string, bytes: number): () => void {
    this.decoders.set(id, Math.max(0, bytes));
    this.changeEpoch++;
    this.evaluate();
    return () => {
      if (this.decoders.delete(id)) {
        this.changeEpoch++;
        this.evaluate();
      }
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs ?? 2000);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sampling step; exposed for tests and for callers that just allocated something large. */
  tick(now: number = Date.now()): MemoryPressure {
    const every = this.options.measureEveryMs ?? 20_000;
    if (!this.measuring && now - this.lastMeasureAt >= every) {
      this.measuring = true;
      this.lastMeasureAt = now;
      void (this.options.measure ?? defaultMeasure)()
        .then((bytes) => {
          this.measured = bytes;
          this.evaluate();
        })
        .catch(() => undefined)
        .finally(() => {
          this.measuring = false;
        });
    }
    return this.evaluate();
  }

  private read(): MemoryReading {
    let consumersBytes = 0;
    let inPageBytes = 0;
    const byConsumer: Record<string, number> = {};
    for (const [name, c] of this.consumers) {
      let n = 0;
      try {
        n = Math.max(0, c.bytes());
      } catch {
        n = 0;
      }
      byConsumer[name] = n;
      if (c.inPageMemory) inPageBytes += n;
      else consumersBytes += n;
    }
    let decodersBytes = 0;
    for (const b of this.decoders.values()) decodersBytes += b;
    const heapBytes = (this.options.heapBytes ?? defaultHeapBytes)() ?? 0;
    // Frame caches and decoder pools are not in the heap or the precise measurement, so they add to it; decoded
    // audio is (inPageMemory) and only backs the page figure up. The precise figure replaces the heap when larger.
    // The renderer floor applies to decoder admission only: pressure (cache and preview scaling) keeps
    // following what the page reports, so ordinary 1080p playback on an 8 GB machine is not degraded.
    const floor = this.options.rendererBaselineBytes ?? RENDERER_BASELINE_BYTES;
    const pageBytes = Math.max(this.measured ?? 0, heapBytes, inPageBytes);
    const usageBytes = pageBytes + consumersBytes + decodersBytes;
    const decoderBaselineBytes = Math.max(pageBytes, floor) + consumersBytes;
    return {
      pressure: this.pressure,
      usageBytes,
      limitBytes: this.limit,
      consumersBytes,
      decodersBytes,
      heapBytes,
      measuredBytes: this.measured,
      decoderBaselineBytes,
      consumers: byConsumer,
      decoders: this.decoders.size,
    };
  }

  private evaluate(): MemoryPressure {
    const reading = this.read();
    const from = this.rebase ? "normal" : this.pressure;
    this.rebase = false;
    const next = this.forced ?? nextPressure(from, reading.usageBytes, reading.limitBytes);
    this.pressure = next;
    this.last = { ...reading, pressure: next };
    this.notifyChanges();
    return this.pressure;
  }

  /**
   * Tells listeners about a new level or decoder cap (opening or closing a big decoder moves the cap without
   * moving the level). A listener may release a decoder, which re-enters evaluate(): that call only updates the
   * state, and this loop then delivers the newest policy once, so no listener sees an older policy after a newer one.
   */
  private notifyChanges(): void {
    if (this.notifying) return;
    this.notifying = true;
    try {
      for (let pass = 0; pass < 8; pass++) {
        const policy = this.effectivePolicy(this.pressure);
        if (this.pressure === this.notifiedPressure && policy.maxDecoderElements === this.notifiedMaxDecoders) break;
        this.notifiedPressure = this.pressure;
        this.notifiedMaxDecoders = policy.maxDecoderElements;
        const reading = this.last;
        for (const l of [...this.listeners]) {
          try {
            l(policy, reading);
          } catch {
            // A listener must not stop the others from degrading.
          }
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

let instance: MemoryGovernor | null = null;

export function getMemoryGovernor(): MemoryGovernor {
  if (!instance) instance = new MemoryGovernor();
  return instance;
}

/** Tests. */
export function resetMemoryGovernorForTests(): void {
  instance?.stop();
  instance = null;
}
