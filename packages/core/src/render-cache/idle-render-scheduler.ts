import type { TimeRange } from "./time-ranges";

/** Why background rendering is not running right now. */
export type IdleRenderPause = "memory" | "power" | "busy";

export type IdleRenderState =
  | { readonly kind: "off" }
  | { readonly kind: "waiting" }
  | { readonly kind: "rendering"; readonly range: TimeRange }
  | { readonly kind: "paused"; readonly reason: IdleRenderPause }
  | { readonly kind: "done" };

export interface IdleChunkResult {
  readonly status: "completed" | "canceled" | "failed";
  readonly framesRendered: number;
  readonly framesSkipped: number;
}

export interface IdleRenderDeps {
  /** The "Render in background when idle" setting. */
  isEnabled(): boolean;
  /** An export, a manual render or any other job already owns the engine. */
  isBusy(): boolean;
  /** False while the memory governor reports pressure. */
  isMemoryOk(): boolean;
  /** False on battery when the OS reports low power. */
  isPowerOk(): boolean;
  getPlayhead(): number;
  /** Stretches that still need a render (yellow and red parts of the render bar, minus what is cached). */
  getPendingRanges(): readonly TimeRange[];
  /** Brings the cache up to date with the project before a chunk starts. Never throws. */
  prepare?(): void | Promise<void>;
  renderChunk(range: TimeRange, signal: AbortSignal): Promise<IdleChunkResult>;
  onStateChange?(state: IdleRenderState): void;
  /** Quiet period before rendering starts. */
  idleMs?: number;
  /** Length of one cancellable chunk, in seconds of timeline. */
  chunkSeconds?: number;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Lets the UI breathe between chunks. */
  yieldToUi?(): Promise<void>;
}

export const IDLE_RENDER_DELAY_MS = 3000;
export const IDLE_RENDER_CHUNK_SECONDS = 1;

/** Distance from `time` to the range (0 when inside). */
function distanceTo(range: TimeRange, time: number): number {
  if (time < range.start) return range.start - time;
  if (time > range.end) return time - range.end;
  return 0;
}

/**
 * Picks the next chunk: the pending range nearest the playhead (ties go to the one that starts first), and inside it
 * the `chunkSeconds` closest to the playhead, working forward from there.
 */
export function pickIdleChunk(ranges: readonly TimeRange[], playhead: number, chunkSeconds: number): TimeRange | null {
  let best: TimeRange | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const range of ranges) {
    if (!(range.end > range.start)) continue;
    const distance = distanceTo(range, playhead);
    if (distance < bestDistance || (distance === bestDistance && best !== null && range.start < best.start)) {
      best = range;
      bestDistance = distance;
    }
  }
  if (!best) return null;
  const start = playhead > best.start && playhead < best.end ? playhead : best.start;
  return { start, end: Math.min(best.end, start + chunkSeconds) };
}

/**
 * True when the cache can take another chunk without evicting frames it already holds. Background rendering stops
 * there: past the cap each chunk would push out earlier ones, the pending list would never empty and it would
 * churn the disk forever.
 */
export function hasIdleCacheRoom(
  cache: { readonly bytes: number; readonly budget: number; readonly frameCount: number },
  frameRate: number,
  chunkSeconds: number = IDLE_RENDER_CHUNK_SECONDS,
): boolean {
  if (cache.frameCount <= 0 || cache.bytes <= 0) return cache.budget > 0;
  const perFrame = cache.bytes / cache.frameCount;
  const chunkBytes = perFrame * Math.max(1, Math.round(frameRate * chunkSeconds));
  return cache.budget - cache.bytes >= chunkBytes;
}

/**
 * Premiere-style background rendering: after a quiet period with no edits, playback or scrubbing it renders the
 * uncached effect-heavy ranges nearest the playhead, one small chunk at a time. Any activity aborts the running chunk
 * at once and the scheduler waits for the next quiet period. It does not touch frames itself: the render cache's
 * own invalidation decides what a finished chunk may keep, so edits made mid-chunk never leave stale frames.
 */
export class IdleRenderScheduler {
  private readonly idleMs: number;
  private readonly chunkSeconds: number;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  private runPromise: Promise<void> | null = null;
  private suspended = false;
  private disposed = false;
  private current: IdleRenderState = { kind: "off" };

  constructor(private readonly deps: IdleRenderDeps) {
    this.idleMs = deps.idleMs ?? IDLE_RENDER_DELAY_MS;
    this.chunkSeconds = deps.chunkSeconds ?? IDLE_RENDER_CHUNK_SECONDS;
  }

  get state(): IdleRenderState {
    return this.current;
  }

  /** Call on every edit, playback change, scrub or playhead move: stops rendering and restarts the quiet period. */
  notifyActivity(): void {
    this.suspended = false;
    this.abortRun();
    this.arm();
  }

  /** The setting, the memory level or the power state changed. */
  notifyConditionsChanged(): void {
    if (!this.deps.isEnabled() || this.pauseReason() !== null) this.abortRun();
    this.arm();
  }

  /** Stop until the next activity (the user canceled the render, or a chunk failed). */
  suspendUntilActivity(): void {
    this.suspended = true;
    this.abortRun();
    this.clearTimer();
    this.setState(this.deps.isEnabled() ? { kind: "waiting" } : { kind: "off" });
  }

  dispose(): void {
    this.disposed = true;
    this.abortRun();
    this.clearTimer();
    this.setState({ kind: "off" });
  }

  private pauseReason(): IdleRenderPause | null {
    if (!this.deps.isMemoryOk()) return "memory";
    if (!this.deps.isPowerOk()) return "power";
    return null;
  }

  private abortRun(): void {
    this.controller?.abort();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private arm(): void {
    this.clearTimer();
    if (this.disposed) return;
    if (!this.deps.isEnabled()) {
      this.setState({ kind: "off" });
      return;
    }
    if (this.suspended) return;
    const reason = this.pauseReason();
    if (reason) {
      this.setState({ kind: "paused", reason });
      return;
    }
    this.setState({ kind: "waiting" });
    this.timer = (this.deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms)))(() => {
      this.timer = null;
      void this.tick();
    }, this.idleMs);
  }

  private async tick(): Promise<void> {
    if (this.runPromise) await this.runPromise.catch(() => undefined);
    if (this.disposed || this.suspended || this.timer !== null) return;
    if (!this.deps.isEnabled()) return this.arm();
    if (this.deps.isBusy()) {
      this.setState({ kind: "paused", reason: "busy" });
      return this.arm();
    }
    if (this.pauseReason() !== null) return this.arm();
    this.runPromise = this.runLoop().finally(() => {
      this.runPromise = null;
    });
    await this.runPromise;
  }

  private async runLoop(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const yieldToUi = this.deps.yieldToUi ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    let idleChunks = 0;
    let outcome: IdleRenderState = { kind: "done" };
    try {
      while (!controller.signal.aborted) {
        if (this.deps.isBusy() || !this.deps.isEnabled() || this.pauseReason() !== null) {
          outcome = { kind: "waiting" };
          break;
        }
        await this.deps.prepare?.();
        if (controller.signal.aborted) break;
        const chunk = pickIdleChunk(this.deps.getPendingRanges(), this.deps.getPlayhead(), this.chunkSeconds);
        if (!chunk) break;
        this.setState({ kind: "rendering", range: chunk });
        const result = await this.deps.renderChunk(chunk, controller.signal);
        if (controller.signal.aborted) break;
        if (result.status !== "completed") {
          // A canceled-by-someone-else or failed chunk: do not retry until the next edit.
          this.suspended = true;
          outcome = { kind: "waiting" };
          break;
        }
        idleChunks = result.framesRendered === 0 ? idleChunks + 1 : 0;
        if (idleChunks >= 2) break;
        await yieldToUi();
      }
    } catch {
      this.suspended = true;
      outcome = { kind: "waiting" };
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    if (controller.signal.aborted) {
      // Activity or a condition change aborted this run; its handler re-armed the timer and set the state.
      if (this.current.kind === "rendering") this.setState({ kind: "waiting" });
      return;
    }
    this.setState(outcome);
  }

  private setState(next: IdleRenderState): void {
    const previous = this.current;
    if (previous.kind === next.kind) {
      if (next.kind === "paused" && previous.kind === "paused" && previous.reason === next.reason) return;
      if (next.kind !== "rendering" && next.kind !== "paused") return;
    }
    this.current = next;
    this.deps.onStateChange?.(next);
  }
}
