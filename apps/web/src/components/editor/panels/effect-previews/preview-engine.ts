import { transitionPosterProgress } from "./preview-params";
import type { ClipColorGrading } from "@openreel/core";
import { CostLruCache } from "./preview-cache";
import { PriorityTaskQueue, TaskCancelledError, whenIdle, type TaskPriority } from "./task-queue";
import { isTemporalCard, planTemporalCard, type TemporalCardPlan } from "./temporal-preview";
import { isSameSource, previewSourceKey, type PreviewSource } from "./source-selection";

/** The part of an effect card the preview needs. Mirrors EditorEffectPreviewDef without importing the panel. */
export type PreviewKind = "effect" | "transition" | "overlay" | "look" | "motion" | "text" | "emphasis" | "particles" | "shader";

/** Time-driven cards: a synthetic loop of `frames` frames over `seconds`, rendered on the footage's poster frame. */
export interface PreviewLoop {
  readonly frames: number;
  readonly seconds: number;
  /** 0..1 position of the poster inside the loop (the most telling moment, not the start). */
  readonly posterProgress: number;
}

export interface PreviewEffectDef {
  readonly id?: string;
  /**
   * "transition" cards blend two moments of the footage with the real TransitionEngine; "look" cards render a chain of
   * effects / a clip grade. "motion", "text", "emphasis", "particles" and "shader" cards are drawn by their own engines
   * (see kind-renderers.ts) from `payload` and play `loop`. Default "effect".
   */
  readonly kind?: PreviewKind;
  readonly type: string;
  readonly pluginId?: string;
  readonly params?: Record<string, unknown>;
  /** Kind specific input of the renderer (preset, text clip ...). Part of the card, so it must be reflected in `id`. */
  readonly payload?: unknown;
  readonly loop?: PreviewLoop;
  /** "look" cards: a chain of effects (a filter preset, or the clip's own under a LUT), rendered in order with the clip-effect engine first. */
  readonly effects?: ReadonlyArray<{ readonly type: string; readonly params: Record<string, unknown> }>;
  /** "look" cards: a clip colour grade (a LUT, a saved look, a preset on a graded clip), run after `effects` with the renderer's own grading routine. */
  readonly grading?: ClipColorGrading;
}

export type PreviewWindowOrigin = "footage" | "still" | "sample";

/** One decoded window of footage, shared by every card. Frames arrive progressively. */
export interface PreviewWindow {
  readonly key: string;
  readonly origin: PreviewWindowOrigin;
  readonly fps: number;
  /** Source timestamp of each frame, seconds. */
  readonly times: readonly number[];
  readonly count: number;
  readonly width: number;
  readonly height: number;
  /** Frame that shows the playhead. */
  readonly posterIndex: number;
  /** More than one frame: hover has something to play. */
  readonly animated: boolean;
  /** Resolves with the decoded frame (never closed by the caller), or null when it could not be decoded. */
  frame(index: number): Promise<ImageBitmap | null>;
  /**
   * The incoming shot of transition cards at window frame `index`: the next clip's frames from its first frame on
   * (moving along with the outgoing footage on hover), else the sample scene. Frame 0 is decoded on first ask;
   * the rest of the incoming window only when a hover asks for a later frame.
   */
  partner(index?: number): Promise<ImageBitmap | null>;
  dispose(): void;
}

export interface WindowLoader {
  load(source: PreviewSource | null, signal: AbortSignal): Promise<PreviewWindow>;
}

export interface RenderInput {
  /** The footage frame the effect applies to (the outgoing frame of a transition). Never closed by the renderer. */
  readonly frame: ImageBitmap;
  /** Transitions only: the incoming shot (the next clip on the timeline, else the sample scene). */
  readonly partner: ImageBitmap | null;
  /** Transitions only: 0..1 progress of the blend. */
  readonly progress: number;
  readonly sourceTime: number;
  /** Echo cards: the footage frames drawn behind `frame` (earlier moments of the window) and their opacity. */
  readonly trail?: readonly { readonly frame: ImageBitmap; readonly weight: number }[];
  /** Echo cards: the parameters the trail was planned with. */
  readonly temporal?: TemporalCardPlan;
  /**
   * True when this render is the card's poster (the at-rest tile), false for a hover frame. Time-driven cards use it
   * to pick the instant, or the set of instants, that shows what the preset does at rest.
   */
  readonly poster?: boolean;
}

export interface EffectRenderer {
  /** Applies one effect (default parameters) to a frame. `slot` is an exclusive lane; the result is a new ImageBitmap. */
  render(slot: number, def: PreviewEffectDef, input: RenderInput): Promise<ImageBitmap>;
  dispose(): void;
}

/** Index that asks for a card's poster rather than a window frame. */
export const POSTER_INDEX = -1;
/** Fraction of the hover loop a transition holds at its start and end (so the loop restart reads as a restart). */
const TRANSITION_HOLD = 0.12;

/** Blend progress shown by window frame `index` of `count` while a transition card plays. */
export function transitionProgress(index: number, count: number): number {
  if (count <= 1) return 0.5;
  const t = Math.min(Math.max(index / (count - 1), 0), 1);
  return Math.min(Math.max((t - TRANSITION_HOLD) / (1 - 2 * TRANSITION_HOLD), 0), 1);
}

/** Progress (0..1, endpoints included) of frame `index` of a `frames` long loop. */
export function loopProgress(index: number, frames: number): number {
  return frames <= 1 ? 0 : Math.min(Math.max(index / (frames - 1), 0), 1);
}

export interface PreviewEngineOptions {
  loader: WindowLoader;
  renderer: EffectRenderer;
  /** Concurrent renders. Default 2. */
  concurrency?: number;
  /** Memory bound for rendered frames (posters + hover frames). Default 48 MB. */
  cacheBytes?: number;
  /** Share of `cacheBytes` reserved for hover frames, so playing one card never evicts the others' posters. Default 1/3. */
  hoverShare?: number;
  /** Yield to the browser before each queued render. Default: requestIdleCallback. */
  beforeStart?: (priority: TaskPriority) => Promise<void>;
}

export const DEFAULT_PREVIEW_CACHE_BYTES = 48 * 1024 * 1024;
export const DEFAULT_PREVIEW_CONCURRENCY = 2;

export const previewDefKey = (def: PreviewEffectDef): string => {
  const prefix = def.kind === "transition" ? "t" : def.kind && def.kind !== "effect" ? def.kind : "";
  return `${prefix ? `${prefix}:` : ""}${def.id ?? def.type}`;
};

/** Cards with their own timeline (a blend, a preset's keyframes): the poster is a moment of it, not the playhead frame. */
const hasOwnTimeline = (def: PreviewEffectDef): boolean =>
  def.kind === "transition" ||
  def.kind === "overlay" ||
  !!def.loop ||
  // Echo rests a few frames into the window so it has footage behind it (see temporal-preview.ts).
  ((def.kind === undefined || def.kind === "effect") && isTemporalCard(def.type));

/**
 * Owns the shared footage window and the rendered-frame cache for the Effects
 * panel. The window is decoded once per source and shared by all cards; each
 * (effect, source window, frame) is rendered at most once while it stays in the
 * LRU. Everything is lazy: nothing is decoded or rendered until a card asks.
 */
const liveEngines = new Set<EffectPreviewEngine>();

/** Re-renders every card of every mounted preview engine from scratch (after a GPU device / context loss). */
export function refreshAllPreviewEngines(): number {
  const engines = [...liveEngines];
  for (const engine of engines) engine.refresh();
  return engines.length;
}

export class EffectPreviewEngine {
  private readonly loader: WindowLoader;
  private readonly renderer: EffectRenderer;
  private readonly queue: PriorityTaskQueue;
  /** Card posters: only ever evicted by other posters (or an invalidation). */
  private readonly posterCache: CostLruCache<string, ImageBitmap>;
  /** Frames rendered for hover playback: a small separate budget. */
  private readonly hoverCache: CostLruCache<string, ImageBitmap>;
  private readonly inflight = new Map<string, Promise<ImageBitmap | null>>();
  /** Frames whose render threw (not a cancellation): cards show an honest error instead of a stand-in image. */
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();

  private source: PreviewSource | null = null;
  private sourceKey = previewSourceKey(null);
  private generation = 0;
  private windowAbort: AbortController | null = null;
  private windowPromise: Promise<PreviewWindow | null> | null = null;
  private currentWindow: PreviewWindow | null = null;
  private initialised = false;
  private disposed = false;

  /** Number of windows decoded and renders executed: observable by tests and the e2e hook. */
  readonly stats = { windowsLoaded: 0, rendersStarted: 0, cacheHits: 0 };

  constructor(options: PreviewEngineOptions) {
    this.loader = options.loader;
    this.renderer = options.renderer;
    liveEngines.add(this);
    this.queue = new PriorityTaskQueue(
      options.concurrency ?? DEFAULT_PREVIEW_CONCURRENCY,
      options.beforeStart ?? ((priority) => (priority === "hover" ? Promise.resolve() : whenIdle())),
      // Posters are background work: one at a time, an idle gap after each.
      1,
    );
    const total = options.cacheBytes ?? DEFAULT_PREVIEW_CACHE_BYTES;
    const hoverBytes = Math.floor(total * (options.hoverShare ?? 1 / 3));
    const release = (bitmap: ImageBitmap) => {
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
    };
    this.posterCache = new CostLruCache(total - hoverBytes, release);
    this.hoverCache = new CostLruCache(hoverBytes, release);
  }

  /** Bumped whenever the source changes: cards re-request their posters. */
  get version(): number {
    return this.generation;
  }

  get currentSource(): PreviewSource | null {
    return this.source;
  }

  get cachedFrames(): number {
    return this.posterCache.size + this.hoverCache.size;
  }

  get cachedBytes(): number {
    return this.posterCache.cost + this.hoverCache.cost;
  }

  get cachedPosters(): number {
    return this.posterCache.size;
  }

  /** True while queued work is held back (the playhead is being scrubbed or played). */
  get held(): boolean {
    return this.queue.isPaused;
  }

  /** Holds new preview work while the user scrubs / plays; running renders finish. Idempotent. */
  hold(): void {
    if (!this.disposed) this.queue.pause();
  }

  release(): void {
    if (!this.disposed) this.queue.resume();
  }

  get peakConcurrency(): number {
    return this.queue.peakRunning;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.generation;

  /** Drops every cached card and re-renders it: the cached frames or the renderer's GPU state may be stale after a device loss. */
  refresh(): void {
    if (this.disposed) return;
    this.invalidate();
  }

  /** Points the cards at new footage. A no-op while the existing window still covers the playhead. */
  setSource(next: PreviewSource | null): void {
    if (this.disposed) return;
    if (this.initialised && isSameSource(this.source, next)) return;
    const first = !this.initialised;
    this.initialised = true;
    // The implicit source before any evaluation is the sample scene: nothing to retarget.
    if (first && next === null) return;
    this.source = next;
    this.sourceKey = previewSourceKey(next);
    this.invalidate();
  }

  /** The shared window for the current source (decoded on first use). Null when it could not be produced. */
  getWindow(): Promise<PreviewWindow | null> {
    if (this.disposed) return Promise.resolve(null);
    if (!this.windowPromise) {
      const abort = new AbortController();
      this.windowAbort = abort;
      const generation = this.generation;
      this.windowPromise = this.loader
        .load(this.source, abort.signal)
        .then((window) => {
          if (this.disposed || generation !== this.generation) {
            window.dispose();
            return null;
          }
          this.stats.windowsLoaded++;
          this.currentWindow = window;
          return window;
        })
        .catch((error: unknown) => {
          if (!abort.signal.aborted) console.warn("[effect-previews] could not prepare footage window:", error);
          return null;
        });
    }
    return this.windowPromise;
  }

  /** Cached rendered frame, without touching recency or starting work. */
  peek(def: PreviewEffectDef, index: number): ImageBitmap | null {
    const key = this.frameKey(def, index);
    return this.posterCache.peek(key) ?? this.hoverCache.peek(key) ?? null;
  }

  /** Cached poster of a card (see renderPoster), without touching recency or starting work. */
  peekPoster(def: PreviewEffectDef): ImageBitmap | null {
    return this.posterCache.peek(this.frameKey(def, this.posterSlot(def))) ?? null;
  }

  /**
   * Renders `def` on window frame `index`. Cached frames resolve immediately;
   * otherwise the render is queued (hover before poster, FIFO). Resolves null
   * when cancelled, superseded by a new source, or when the frame is missing.
   * The bitmap belongs to the cache: draw it, do not close it.
   */
  async render(
    def: PreviewEffectDef,
    index: number,
    priority: TaskPriority,
    signal?: AbortSignal,
  ): Promise<ImageBitmap | null> {
    if (this.disposed || signal?.aborted) return null;
    const key = this.frameKey(def, index);
    const hit = this.lookup(key);
    if (hit) {
      this.stats.cacheHits++;
      return hit;
    }
    const generation = this.generation;
    const flightKey = `${key}|${priority}`;
    let flight = this.inflight.get(flightKey);
    if (!flight) {
      flight = this.queue
        .enqueue({
          priority,
          signal,
          run: (slot) => this.renderNow(slot, def, index, key, generation, priority),
        })
        .catch((error: unknown) => {
          if (!(error instanceof TaskCancelledError)) console.warn("[effect-previews] render failed:", error);
          return null;
        })
        .finally(() => {
          this.inflight.delete(flightKey);
        });
      this.inflight.set(flightKey, flight);
    }
    return flight;
  }

  /** Renders the poster frame (the playhead frame) of a card. */
  async renderPoster(def: PreviewEffectDef, signal?: AbortSignal): Promise<ImageBitmap | null> {
    const window = await this.getWindow();
    if (!window || signal?.aborted) return null;
    return this.render(def, this.posterSlot(def, window), "poster", signal);
  }

  /** Cache index of a card's poster: effects share the playhead frame of the window, timeline cards have their own moment. */
  private posterSlot(def: PreviewEffectDef, window: PreviewWindow | null = this.currentWindow): number {
    return hasOwnTimeline(def) ? POSTER_INDEX : (window?.posterIndex ?? 0);
  }

  /** True when the card's poster could not be rendered (the renderer threw), as opposed to cancelled or superseded. */
  posterFailed(def: PreviewEffectDef): boolean {
    return this.failed.has(this.frameKey(def, this.posterSlot(def)));
  }

  private lookup(key: string): ImageBitmap | undefined {
    return this.posterCache.get(key) ?? this.hoverCache.get(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    liveEngines.delete(this);
    this.windowAbort?.abort();
    this.queue.dispose();
    this.currentWindow?.dispose();
    this.currentWindow = null;
    this.windowPromise = null;
    this.posterCache.clear();
    this.hoverCache.clear();
    this.inflight.clear();
    this.failed.clear();
    this.listeners.clear();
    this.renderer.dispose();
  }

  private frameKey(def: PreviewEffectDef, index: number): string {
    return `${this.sourceKey}|${previewDefKey(def)}|${index}`;
  }

  private invalidate(): void {
    this.generation++;
    this.windowAbort?.abort();
    this.windowAbort = null;
    this.windowPromise = null;
    this.currentWindow?.dispose();
    this.currentWindow = null;
    this.inflight.clear();
    this.failed.clear();
    this.posterCache.clear();
    this.hoverCache.clear();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private async renderNow(
    slot: number,
    def: PreviewEffectDef,
    index: number,
    key: string,
    generation: number,
    priority: TaskPriority,
  ): Promise<ImageBitmap | null> {
    // A hover request may have rendered this frame while the poster task waited its turn.
    const hit = this.lookup(key);
    if (hit) return hit;
    const window = await this.getWindow();
    if (!window || generation !== this.generation) return null;
    const transition = def.kind === "transition";
    const loop = def.loop;
    // Looping cards animate their own clock over the poster frame; everything else walks the footage window.
    // Time effects (Echo, Posterize Time) pick other frames of the window: see temporal-preview.ts.
    const temporal =
      !loop && (def.kind === undefined || def.kind === "effect") && isTemporalCard(def.type)
        ? planTemporalCard(def.type, def.params, window, index === POSTER_INDEX ? -1 : index)
        : null;
    const frameIndex = temporal ? temporal.frameIndex : index === POSTER_INDEX || loop ? window.posterIndex : index;
    const frame = await window.frame(frameIndex);
    if (!frame || generation !== this.generation || this.disposed) return null;
    let trail: { frame: ImageBitmap; weight: number }[] | undefined;
    if (temporal && temporal.trail.length > 0) {
      const frames = await Promise.all(temporal.trail.map((entry) => window.frame(entry.index)));
      if (generation !== this.generation || this.disposed) return null;
      trail = [];
      frames.forEach((trailFrame, at) => {
        if (trailFrame) trail?.push({ frame: trailFrame, weight: temporal.trail[at].weight });
      });
    }
    let partner: ImageBitmap | null = null;
    // Transitions blend by it; overlay cards read it as the position in the window (-1 at the poster).
    let progress = index === POSTER_INDEX ? -1 : frameIndex / Math.max(window.count - 1, 1);
    if (transition) {
      partner = await window.partner(index === POSTER_INDEX ? 0 : frameIndex);
      if (generation !== this.generation || this.disposed) return null;
      progress = index === POSTER_INDEX ? transitionPosterProgress(def) : transitionProgress(frameIndex, window.count);
    } else if (loop) {
      progress = index === POSTER_INDEX ? loop.posterProgress : loopProgress(index, loop.frames);
    }
    this.stats.rendersStarted++;
    let output: ImageBitmap;
    try {
      output = await this.renderer.render(slot, def, {
        frame,
        partner,
        progress,
        sourceTime: loop ? progress * loop.seconds : (window.times[frameIndex] ?? 0),
        trail,
        temporal: temporal ?? undefined,
        poster: index === POSTER_INDEX,
      });
    } catch (error) {
      // The window was replaced (its frames closed) while this render ran: not a failure.
      if (generation !== this.generation || this.disposed) return null;
      this.failed.add(key);
      throw error;
    }
    if (generation !== this.generation || this.disposed) {
      output.close();
      return null;
    }
    this.failed.delete(key);
    const cache = priority === "poster" ? this.posterCache : this.hoverCache;
    cache.set(key, output, output.width * output.height * 4);
    return output;
  }
}
