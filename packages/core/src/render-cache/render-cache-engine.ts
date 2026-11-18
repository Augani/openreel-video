import type { Project } from "../types/project";
import type { ChunkStore } from "./chunk-store";
import type { EncodedCacheFrame, FrameCodec, FrameCodecOptions } from "./frame-codec";
import { FrameIndex } from "./frame-index";
import { diffPixelModels } from "./invalidation-planner";
import { buildPixelModel, type PixelModel } from "./pixel-entities";
import {
  framesInRange,
  type FrameRange,
  type TimeRange,
} from "./time-ranges";

export const DEFAULT_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CACHE_WIDTH = 1920;
const LOOKAHEAD = 8;
const LOG_LIMIT = 256;

export interface RenderCacheDeps {
  store: ChunkStore;
  createCodec(options: FrameCodecOptions): Promise<FrameCodec>;
  /** Renders one full-quality (export-path) frame at `time` at the requested size. */
  renderFrame(project: Project, time: number, width: number, height: number): Promise<ImageBitmap>;
  /** Lets the UI breathe between frames. Defaults to a macrotask. */
  yieldToUi?: () => Promise<void>;
  now?: () => number;
}

export interface RenderCacheOptions {
  maxBytes?: number;
  /** Prefix for every stored key so several editor tabs can share one store. */
  keyPrefix?: string;
}

export type RenderPhase = "idle" | "rendering";

export interface RenderProgress {
  readonly done: number;
  readonly total: number;
  readonly range: TimeRange;
}

export interface RenderSummary {
  readonly status: "completed" | "canceled" | "failed";
  readonly framesRendered: number;
  readonly framesSkipped: number;
  readonly totalFrames: number;
  readonly elapsedMs: number;
  readonly bytes: number;
  readonly codec: string;
  readonly message?: string;
}

export interface RenderCacheSnapshot {
  readonly phase: RenderPhase;
  readonly progress: RenderProgress | null;
  readonly cachedRuns: readonly FrameRange[];
  readonly frameRate: number;
  readonly bytes: number;
  readonly budget: number;
  readonly frameCount: number;
  readonly codec: string | null;
  /** Bumped on every state change; handy as a memo key. */
  readonly version: number;
  readonly lastSummary: RenderSummary | null;
}

export interface RenderRangeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RenderProgress) => void;
}

interface InvalidationLogEntry {
  readonly version: number;
  readonly all: boolean;
  readonly ranges: readonly TimeRange[];
}

function evenFloor(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/** Cache render size: project size, capped to 1920 wide, even dimensions. */
export function cacheFrameSize(width: number, height: number): { width: number; height: number } {
  if (width <= MAX_CACHE_WIDTH) return { width: evenFloor(width), height: evenFloor(height) };
  const scale = MAX_CACHE_WIDTH / width;
  return { width: evenFloor(MAX_CACHE_WIDTH), height: evenFloor(height * scale) };
}

export class RenderCache {
  private project: Project | null = null;
  private model: PixelModel | null = null;
  private readonly index: FrameIndex;
  private codec: FrameCodec | null = null;
  private codecKey = "";
  private codecPromise: Promise<FrameCodec> | null = null;
  private version = 0;
  private log: InvalidationLogEntry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: RenderCacheSnapshot;
  private job: { abort: AbortController; done: Promise<RenderSummary> } | null = null;
  private progress: RenderProgress | null = null;
  private lastSummary: RenderSummary | null = null;
  private readonly decoded = new Map<number, Promise<ImageBitmap | null>>();
  private runId = 0;
  private disposed = false;
  private readonly keyPrefix: string;

  constructor(
    private readonly deps: RenderCacheDeps,
    options: RenderCacheOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? "";
    this.index = new FrameIndex(options.maxBytes ?? DEFAULT_CACHE_BYTES, 30);
    this.snapshot = this.buildSnapshot();
  }

  // ---- observation -------------------------------------------------------

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): RenderCacheSnapshot {
    return this.snapshot;
  }

  get frameRate(): number {
    return this.index.fps;
  }

  isRendering(): boolean {
    return this.job !== null;
  }

  hasFrameAt(time: number): boolean {
    if (!this.project) return false;
    return this.index.has(this.frameForTime(time));
  }

  cachedFrameCount(): number {
    return this.index.count;
  }

  frameForTime(time: number): number {
    return Math.round(time * this.index.fps);
  }

  setBudget(maxBytes: number): void {
    const evicted = this.index.setBudget(maxBytes);
    this.dropFrames(evicted);
    this.emit();
  }

  // ---- project tracking & invalidation ------------------------------------

  /** Called synchronously on every project change; invalidates exactly the affected frames. */
  setProject(next: Project): void {
    if (this.disposed) return;
    this.project = next;
    this.index.setFrameRate(next.settings.frameRate);
    // Nothing cached and nothing rendering: there is nothing to invalidate, so
    // skip the snapshot entirely (keeps editing free until the first render).
    // The baseline is taken when a render starts.
    if (this.index.count === 0 && !this.job && this.decoded.size === 0) {
      this.model = null;
      this.emit();
      return;
    }
    const model = buildPixelModel(next);
    const prev = this.model;
    this.model = model;
    if (!prev) {
      this.invalidateAll();
      return;
    }
    const plan = diffPixelModels(prev, model);
    if (plan.all) {
      this.invalidateAll();
    } else if (plan.ranges.length > 0) {
      this.invalidateRanges(plan.ranges);
    }
  }

  private recordInvalidation(all: boolean, ranges: readonly TimeRange[]): void {
    this.version++;
    this.log.push({ version: this.version, all, ranges });
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
  }

  invalidateRanges(ranges: readonly TimeRange[]): number[] {
    const removed = this.index.invalidateRanges(ranges);
    this.recordInvalidation(false, ranges);
    this.dropFrames(removed);
    this.dropDecodedInRanges(ranges);
    this.emit();
    return removed;
  }

  private invalidateAll(): void {
    const removed = this.index.clear();
    this.recordInvalidation(true, []);
    this.dropFrames(removed);
    this.dropDecodedAll();
    this.disposeCodecIfStale();
    this.emit();
  }

  /** Did a change after `since` possibly alter the pixels of `frame`? */
  private invalidatedSince(frame: number, since: number): boolean {
    if (this.version === since) return false;
    const oldest = this.log[0];
    if (!oldest || oldest.version > since + 1) return true;
    for (const entry of this.log) {
      if (entry.version <= since) continue;
      if (entry.all) return true;
      for (const range of entry.ranges) {
        const span = framesInRange(range, this.index.fps);
        if (span && frame >= span.start && frame <= span.end) return true;
      }
    }
    return false;
  }

  private key(frame: number): string {
    return `${this.keyPrefix}f${frame}`;
  }

  private dropFrames(frames: readonly number[]): void {
    if (frames.length === 0) return;
    void this.deps.store.delete(frames.map((frame) => this.key(frame))).catch(() => undefined);
  }

  private dropDecodedAll(): void {
    for (const pending of this.decoded.values()) void pending.then((bitmap) => bitmap?.close());
    this.decoded.clear();
  }

  private dropDecodedInRanges(ranges: readonly TimeRange[]): void {
    for (const range of ranges) {
      const span = framesInRange(range, this.index.fps);
      if (!span) continue;
      for (const frame of Array.from(this.decoded.keys())) {
        if (frame < span.start || frame > span.end) continue;
        const pending = this.decoded.get(frame);
        this.decoded.delete(frame);
        void pending?.then((bitmap) => bitmap?.close());
      }
    }
  }

  // ---- rendering ----------------------------------------------------------

  private async ensureCodec(): Promise<FrameCodec> {
    const project = this.project;
    if (!project) throw new Error("render cache: no project");
    const size = cacheFrameSize(project.settings.width, project.settings.height);
    const key = `${size.width}x${size.height}@${project.settings.frameRate}`;
    if (this.codec && this.codecKey === key) return this.codec;
    if (this.codecPromise && this.codecKey === key) return this.codecPromise;
    this.codec?.dispose();
    this.codec = null;
    this.codecKey = key;
    const promise = this.deps
      .createCodec({ ...size, frameRate: project.settings.frameRate })
      .then((codec) => {
        if (this.codecKey === key && !this.disposed) this.codec = codec;
        else codec.dispose();
        return codec;
      });
    this.codecPromise = promise;
    promise.catch(() => {
      if (this.codecPromise === promise) this.codecPromise = null;
    });
    return promise;
  }

  private disposeCodecIfStale(): void {
    const project = this.project;
    if (!project || !this.codec) return;
    const size = cacheFrameSize(project.settings.width, project.settings.height);
    if (this.codecKey !== `${size.width}x${size.height}@${project.settings.frameRate}`) {
      this.codec.dispose();
      this.codec = null;
      this.codecPromise = null;
      this.codecKey = "";
    }
  }

  /** Frame numbers whose render time lies in [start, end). */
  framesForRange(range: TimeRange): FrameRange | null {
    return framesInRange(range, this.index.fps);
  }

  /**
   * Render every frame of `range` that is not already cached. Resolves with a
   * summary instead of throwing for cancel/failure so callers can show it.
   */
  renderRange(range: TimeRange, options: RenderRangeOptions = {}): Promise<RenderSummary> {
    if (this.job) return this.job.done;
    const abort = new AbortController();
    options.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    if (options.signal?.aborted) abort.abort();
    const done = this.runRender(range, abort, options.onProgress).finally(() => {
      this.job = null;
      this.progress = null;
      this.emit();
    });
    this.job = { abort, done };
    this.emit();
    return done;
  }

  cancelRender(): void {
    this.job?.abort.abort();
  }

  private async runRender(
    range: TimeRange,
    abort: AbortController,
    onProgress?: (progress: RenderProgress) => void,
  ): Promise<RenderSummary> {
    const now = this.deps.now ?? (() => performance.now());
    const startedAt = now();
    const runId = ++this.runId;
    const project0 = this.project;
    let rendered = 0;
    let skipped = 0;
    let total = 0;
    let codecId = this.codec?.id ?? "";
    const finish = (status: RenderSummary["status"], message?: string): RenderSummary => {
      const summary: RenderSummary = {
        status,
        framesRendered: rendered,
        framesSkipped: skipped,
        totalFrames: total,
        elapsedMs: now() - startedAt,
        bytes: this.index.bytes,
        codec: codecId,
        message,
      };
      this.lastSummary = summary;
      return summary;
    };
    if (!project0) return finish("failed", "No project loaded");
    if (!this.model) this.model = buildPixelModel(project0);
    const span = this.framesForRange(range);
    if (!span) return finish("completed");
    total = span.end - span.start + 1;
    const inJob = (frame: number) => frame >= span.start && frame <= span.end;
    const yieldToUi = this.deps.yieldToUi ?? (() => new Promise<void>((r) => setTimeout(r, 0)));

    try {
      const codec = await this.ensureCodec();
      codecId = codec.id;
      const size = { width: codec.width, height: codec.height };
      const fps = project0.settings.frameRate;

      for (let frame = span.start; frame <= span.end; frame++) {
        if (abort.signal.aborted) return finish("canceled");
        if (this.disposed || runId !== this.runId) return finish("canceled");
        if (this.index.has(frame)) {
          skipped++;
          this.report(range, rendered + skipped, total, onProgress);
          continue;
        }
        let stored = false;
        for (let attempt = 0; attempt < 4 && !stored; attempt++) {
          const project = this.project;
          if (!project) return finish("failed", "Project closed");
          if (project.settings.frameRate !== fps || this.codec !== codec) {
            return finish("failed", "Project format changed during render");
          }
          const since = this.version;
          const image = await this.deps.renderFrame(project, frame / fps, size.width, size.height);
          let encoded: EncodedCacheFrame;
          try {
            if (abort.signal.aborted) return finish("canceled");
            encoded = await codec.encode(image);
          } finally {
            image.close();
          }
          if (abort.signal.aborted) return finish("canceled");
          if (this.invalidatedSince(frame, since)) continue;
          await this.deps.store.put(this.key(frame), encoded.data);
          if (this.invalidatedSince(frame, since) || this.disposed) {
            void this.deps.store.delete([this.key(frame)]).catch(() => undefined);
            continue;
          }
          const result = this.index.put(frame, encoded.data.byteLength, inJob);
          this.dropFrames(result.evicted);
          if (!result.stored) {
            void this.deps.store.delete([this.key(frame)]).catch(() => undefined);
            this.emit();
            return finish(
              "failed",
              "Render cache is full. Raise the cache size or shorten the In/Out range.",
            );
          }
          stored = true;
          rendered++;
        }
        if (!stored) {
          return finish("failed", "The project kept changing while rendering");
        }
        this.report(range, rendered + skipped, total, onProgress);
        this.emitThrottled(now());
        await yieldToUi();
      }
      return finish("completed");
    } catch (error) {
      return finish("failed", error instanceof Error ? error.message : String(error));
    }
  }

  private report(
    range: TimeRange,
    done: number,
    total: number,
    onProgress?: (progress: RenderProgress) => void,
  ): void {
    this.progress = { done, total, range };
    onProgress?.(this.progress);
  }

  // ---- playback -----------------------------------------------------------

  /**
   * Decoded bitmap of the cached frame at `time`, or undefined when the frame
   * is not cached. Ownership of the bitmap passes to the caller. Also keeps
   * a few upcoming frames decoded so steady playback never waits on a decode.
   */
  async takeFrame(time: number): Promise<ImageBitmap | undefined> {
    const frame = this.frameForTime(time);
    if (!this.index.has(frame) || !this.codec) return undefined;
    this.index.touch(frame);
    const since = this.version;
    let pending = this.decoded.get(frame);
    if (!pending) {
      this.startDecode(frame);
      pending = this.decoded.get(frame);
    }
    if (!pending) return undefined;
    this.decoded.delete(frame);
    this.releaseDecodedOutside(frame, frame + LOOKAHEAD * 2);
    const bitmap = await pending;
    this.prefetch(frame + 1);
    if (!bitmap) return undefined;
    if (this.invalidatedSince(frame, since) || !this.index.has(frame)) {
      bitmap.close();
      return undefined;
    }
    return bitmap;
  }

  /** Close prefetched bitmaps left behind by a seek or a stopped playback. */
  private releaseDecodedOutside(from: number, to: number): void {
    for (const [frame, pending] of Array.from(this.decoded)) {
      if (frame >= from && frame <= to) continue;
      this.decoded.delete(frame);
      void pending.then((bitmap) => bitmap?.close());
    }
  }

  /** Warm the decode pipeline (e.g. when playback starts). */
  warm(time: number): void {
    this.prefetch(this.frameForTime(time));
  }

  private prefetch(from: number): void {
    const wanted: number[] = [];
    for (let f = from; f < from + LOOKAHEAD; f++) {
      if (!this.index.has(f)) break;
      if (!this.decoded.has(f)) wanted.push(f);
    }
    if (wanted.length === 0) return;
    if (wanted.length < LOOKAHEAD / 2 && this.decoded.has(from)) return;
    this.startDecode(wanted[0], wanted);
  }

  private startDecode(first: number, frames?: number[]): void {
    const codec = this.codec;
    if (!codec) return;
    const list = frames ?? this.consecutiveFrom(first);
    const since = this.version;
    const batch = this.loadAndDecode(codec, list, since);
    list.forEach((frame, i) => {
      this.decoded.set(
        frame,
        batch.then((bitmaps) => bitmaps[i] ?? null),
      );
    });
  }

  private consecutiveFrom(first: number): number[] {
    const list: number[] = [first];
    for (let f = first + 1; f < first + LOOKAHEAD && this.index.has(f) && !this.decoded.has(f); f++) {
      list.push(f);
    }
    return list;
  }

  private async loadAndDecode(
    codec: FrameCodec,
    frames: number[],
    since: number,
  ): Promise<Array<ImageBitmap | null>> {
    try {
      const blobs = await Promise.all(frames.map((frame) => this.deps.store.get(this.key(frame))));
      const present: Array<{ at: number; data: EncodedCacheFrame }> = [];
      blobs.forEach((data, at) => {
        if (data) present.push({ at, data: { data } });
      });
      const out: Array<ImageBitmap | null> = frames.map(() => null);
      if (present.length === 0) return out;
      const bitmaps = await codec.decodeBatch(present.map((p) => p.data));
      present.forEach((p, i) => {
        const frame = frames[p.at];
        if (this.invalidatedSince(frame, since) || !this.index.has(frame)) bitmaps[i].close();
        else out[p.at] = bitmaps[i];
      });
      return out;
    } catch {
      return frames.map(() => null);
    }
  }

  // ---- management -----------------------------------------------------------

  /** "Delete render files": cancel any render and drop every cached frame. */
  async deleteAll(): Promise<number> {
    this.job?.abort.abort();
    if (this.job) await this.job.done.catch(() => undefined);
    const removed = this.index.clear();
    this.recordInvalidation(true, []);
    this.dropDecodedAll();
    await this.deps.store.delete(removed.map((frame) => this.key(frame))).catch(() => undefined);
    this.emit();
    return removed.length;
  }

  /** Forget the project (closing it) and release codec resources. */
  reset(): void {
    this.job?.abort.abort();
    const removed = this.index.clear();
    this.recordInvalidation(true, []);
    this.dropDecodedAll();
    this.project = null;
    this.codec?.dispose();
    this.codec = null;
    this.codecPromise = null;
    this.codecKey = "";
    this.dropFrames(removed);
    this.emit();
  }

  dispose(): void {
    this.reset();
    this.disposed = true;
    this.listeners.clear();
  }

  private buildSnapshot(): RenderCacheSnapshot {
    return {
      phase: this.job ? "rendering" : "idle",
      progress: this.progress,
      cachedRuns: this.index.cachedRuns(),
      frameRate: this.index.fps,
      bytes: this.index.bytes,
      budget: this.index.budget,
      frameCount: this.index.count,
      codec: this.codec?.id ?? null,
      version: this.version,
      lastSummary: this.lastSummary,
    };
  }

  private lastEmitAt = 0;

  private emitThrottled(at: number): void {
    if (at - this.lastEmitAt < 120) return;
    this.emit();
  }

  private emit(): void {
    this.lastEmitAt = this.deps.now ? this.deps.now() : performance.now();
    this.snapshot = this.buildSnapshot();
    for (const listener of Array.from(this.listeners)) listener();
  }
}
